const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const path = require('path');
const yaml = require('yaml');

const db = require('./db');
const { parseUri, parseSubscriptionContent } = require('./parser');
const tester = require('./tester');
const generator = require('./generator');
const fetcher = require('./fetcher');
const coreManager = require('./coreManager');
const fofaManager = require('./fofaManager');
const speedRunner = require('./speedRunner');
const testBundle = require('./testBundle');
const { fetchSubscription, fetchAllSubscriptions } = fetcher;
const scheduler = require('./scheduler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3580;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Broadcast helper for WebSocket
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  });
}
fetcher.setBroadcast(broadcast);
speedRunner.setBroadcast(broadcast);
testBundle.setBroadcast(broadcast);

function getPublicSettings() {
  const { fofaApiKey, ...safeSettings } = db.getSettings();
  return safeSettings;
}

// Auth Middleware for protected API routes
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: '请先登录' });
  }
  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const decoded = jwt.verify(token, db.getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录会话已过期，请重新登录' });
  }
}

// ---------------- Public Endpoints ----------------

// 1. User login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUser();
  if (username !== user.username || !db.verifyPassword(password)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ username: user.username }, db.getJwtSecret(), { expiresIn: '7d' });
  res.json({
    token,
    username: user.username,
    hasDefaultPassword: user.hasDefaultPassword
  });
});

// 2. Export / Public Subscription Generation (No token needed, identified by profile token)
app.get('/sub/:token', (req, res) => {
  const { token } = req.params;
  const format = req.query.format || 'clash'; // 'clash' or 'base64'
  const profile = db.getProfile(token);

  if (!profile || !profile.enabled) {
    return res.status(404).send('# 订阅不存在或已被禁用');
  }

  // Get nodes to include
  let allNodes = [];
  if (profile.subIds && profile.subIds.length > 0) {
    allNodes = db.getNodes().filter(n => profile.subIds.includes(n.subId));
  } else {
    // If no specific subIds chosen, include nodes from all enabled subs plus manual nodes
    const enabledSubIds = new Set(db.getSubscriptions().filter(s => s.enabled).map(s => s.id));
    enabledSubIds.add('manual');
    allNodes = db.getNodes().filter(n => enabledSubIds.has(n.subId));
  }

  // Filter nodes according to profile config
  const filteredNodes = generator.filterNodes(allNodes, profile);

  if (format === 'base64') {
    const base64Data = generator.generateBase64Subscription(filteredNodes);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=1073741824000; expire=0');
    return res.send(base64Data);
  }

  // Clash YAML format
  const clashYaml = generator.generateClashSubscription(filteredNodes, profile);
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('profile-update-interval', '6');
  res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=1073741824000; expire=0');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(profile.name || 'subscription')}.yaml"`);
  res.send(clashYaml);
});

// ---------------- Protected Management APIs ----------------

// Get user profile / stats
app.get('/api/user/info', authMiddleware, (req, res) => {
  res.json(db.getUser());
});

app.post('/api/user/update-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!db.verifyPassword(oldPassword)) {
    return res.status(400).json({ error: '原密码不正确' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码不能少于6位字符' });
  }
  db.updatePassword(newPassword);
  res.json({ message: '密码修改成功' });
});

// Compatible alias for password update
app.post('/api/auth/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!db.verifyPassword(oldPassword)) {
    return res.status(400).json({ error: '原密码不正确' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码不能少于6位字符' });
  }
  db.updatePassword(newPassword);
  res.json({ message: '密码修改成功' });
});

// Overview Statistics
app.get('/api/dashboard/stats', authMiddleware, (req, res) => {
  const subs = db.getSubscriptions();
  const nodes = db.getNodes();
  const profiles = db.getProfiles();

  const totalSubs = subs.length;
  const totalNodes = nodes.length;
  const combinedNodes = nodes.filter(n => n.inCombinedSub).length;
  const aliveNodes = nodes.filter(n => n.delay && n.delay > 0).length;
  const failedNodes = nodes.filter(n => n.delay === -1 || n.status === 'failed').length;
  const untestedNodes = totalNodes - aliveNodes - failedNodes;

  // Protocol distribution
  const protocols = {};
  nodes.forEach(n => {
    const t = n.type || 'unknown';
    protocols[t] = (protocols[t] || 0) + 1;
  });

  res.json({
    totalSubs,
    totalNodes,
    combinedNodes,
    aliveNodes,
    failedNodes,
    untestedNodes,
    totalProfiles: profiles.length,
    protocols,
    isTesting: tester.isTesting
  });
});

// Settings APIs
app.get('/api/settings', authMiddleware, (req, res) => {
  res.json(getPublicSettings());
});

app.post('/api/settings', authMiddleware, (req, res) => {
  const { fofaApiKey, fofaEmail, ...safeUpdates } = req.body || {};
  db.updateSettings(safeUpdates);
  scheduler.restart();
  scheduler.restartScheduledTest();
  res.json(getPublicSettings());
});

// FOFA discovery APIs
app.get('/api/fofa/config', authMiddleware, (req, res) => {
  res.json(fofaManager.getPublicConfig());
});

app.post('/api/fofa/config', authMiddleware, (req, res) => {
  try {
    res.json(fofaManager.saveConfig(req.body || {}));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/fofa/scan', authMiddleware, (req, res) => {
  try {
    const job = fofaManager.startScan(req.body || {}, {
      onProgress: snapshot => broadcast('fofa_progress', snapshot),
      onCompleted: snapshot => broadcast('fofa_completed', snapshot),
      onImported: sub => broadcast('subscription_updated', { id: sub.id, sub })
    });
    res.status(202).json(job);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/fofa/jobs/:id', authMiddleware, (req, res) => {
  const job = fofaManager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'FOFA 扫描任务不存在或已过期' });
  res.json(job);
});

app.post('/api/fofa/jobs/:id/cancel', authMiddleware, (req, res) => {
  const job = fofaManager.cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'FOFA 扫描任务不存在或已过期' });
  res.json(job);
});

// Mihomo core version and manual update
app.get('/api/system/mihomo', authMiddleware, async (req, res) => {
  try {
    res.json(await coreManager.getLocalCoreInfo());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/mihomo/check-update', authMiddleware, async (req, res) => {
  try {
    res.json(await coreManager.checkForUpdate());
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/system/mihomo/update', authMiddleware, async (req, res) => {
  try {
    const result = await coreManager.updateCore();
    db.addLog('info', `Mihomo 内核更新操作：${result.message}`, {
      currentVersion: result.currentVersion,
      previousVersion: result.previousVersion || null,
      downloadSource: result.downloadSource || null
    });
    res.json(result);
  } catch (err) {
    db.addLog('error', `Mihomo 内核更新失败：${err.message}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Subscriptions CRUD
app.get('/api/subscriptions', authMiddleware, (req, res) => {
  res.json(db.getSubscriptions());
});

app.post('/api/subscriptions', authMiddleware, async (req, res) => {
  const { name, url, enabled, autoRefresh } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ error: '订阅地址不能为空' });
  }

  // Support single or multiple URLs (separated by newlines)
  const urlLines = url.split('\n').map(u => u.trim()).filter(Boolean);
  if (urlLines.length === 0) {
    return res.status(400).json({ error: '有效的订阅地址不能为空' });
  }

  if (urlLines.length === 1) {
    const singleUrl = urlLines[0];
    const targetIp = await db.resolveSubscriptionIp(singleUrl);
    const existing = targetIp ? db.findSubscriptionByIp(targetIp) : db.findSubscriptionByUrl(singleUrl);
    if (existing) {
      return res.json({
        skipped: true,
        message: `该订阅地址 IP（${targetIp || singleUrl}）已存在（名称：${existing.name}），已自动跳过重复添加`,
        ...existing
      });
    }

    const finalName = (name && name.trim()) ? name.trim() : db.getNextSubName();
    const newSub = db.addSubscription({
      name: finalName,
      url: singleUrl,
      ip: targetIp,
      enabled,
      autoRefresh
    });

    // Auto fetch immediately
    try {
      await fetchSubscription(newSub.id);
    } catch (e) {
      // Non-fatal on creation
    }

    return res.json({
      skipped: false,
      ...db.getSubscription(newSub.id)
    });
  }

  // Multiple URLs handling
  const resolvedList = await Promise.all(urlLines.map(async (u) => {
    const ip = await db.resolveSubscriptionIp(u);
    return { url: u, ip };
  }));

  const addedSubs = [];
  let skippedCount = 0;
  const seenBatchIps = new Set();

  for (let i = 0; i < resolvedList.length; i++) {
    const { url: u, ip: targetIp } = resolvedList[i];
    const existing = (targetIp && (db.findSubscriptionByIp(targetIp) || seenBatchIps.has(targetIp.toLowerCase())))
      || (!targetIp && db.findSubscriptionByUrl(u));
    if (existing) {
      skippedCount++;
      continue;
    }
    if (targetIp) {
      seenBatchIps.add(targetIp.toLowerCase());
    }
    const finalName = (name && name.trim())
      ? `${name.trim()} (${i + 1})`
      : db.getNextSubName();

    const created = db.addSubscription({
      name: finalName,
      url: u,
      ip: targetIp,
      enabled,
      autoRefresh
    });
    addedSubs.push(created);
    try {
      await fetchSubscription(created.id);
    } catch (e) {}
  }

  res.json({
    batch: true,
    addedCount: addedSubs.length,
    skippedCount,
    message: `添加完成：成功新增 ${addedSubs.length} 个订阅，自动跳过 ${skippedCount} 个重复订阅（相同IP）`
  });
});

app.put('/api/subscriptions/:id', authMiddleware, async (req, res) => {
  const updates = { ...req.body };
  if (updates.url) {
    updates.ip = await db.resolveSubscriptionIp(updates.url);
  }
  // 手动配额（GB / 日期 → bytes / ms）；全空则清除
  if (updates.quotaTotalGb !== undefined || updates.quotaUsedGb !== undefined || updates.quotaExpireDate !== undefined) {
    const GB = 1024 ** 3;
    const total = Math.max(0, Number(updates.quotaTotalGb) || 0) * GB;
    const used = Math.max(0, Number(updates.quotaUsedGb) || 0) * GB;
    const expire = updates.quotaExpireDate ? new Date(updates.quotaExpireDate + 'T00:00:00').getTime() : 0;
    updates.manualQuota = total > 0 ? { used, total, expire } : null;
    delete updates.quotaTotalGb;
    delete updates.quotaUsedGb;
    delete updates.quotaExpireDate;
  }
  const updated = db.updateSubscription(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: '订阅不存在' });
  // 配额变化立即应用到该订阅下所有节点（不覆盖节点级手动数据）
  const applied = db.applySubscriptionQuota(req.params.id);
  if (applied > 0) broadcast('nodes_updated', { count: applied });
  res.json(updated);
});

app.delete('/api/subscriptions/:id', authMiddleware, (req, res) => {
  const success = db.deleteSubscription(req.params.id);
  if (!success) return res.status(404).json({ error: '订阅不存在' });
  res.json({ success: true });
});

// Subscription Actions
app.post('/api/subscriptions/:id/refresh', authMiddleware, async (req, res) => {
  try {
    const result = await fetchSubscription(req.params.id);
    broadcast('subscription_updated', { id: req.params.id });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/subscriptions/refresh-all', authMiddleware, async (req, res) => {
  try {
    const results = await fetchAllSubscriptions();
    broadcast('subscriptions_refreshed_all', results);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Parse custom pasted nodes or links
app.post('/api/nodes/parse-raw', authMiddleware, (req, res) => {
  const { rawText } = req.body;
  if (!rawText) return res.status(400).json({ error: '内容不能为空' });
  const nodes = parseSubscriptionContent(rawText, yaml);
  res.json({ nodes, count: nodes.length });
});

// Import pasted nodes directly
app.post('/api/nodes/import-raw', authMiddleware, (req, res) => {
  const { rawText, subName } = req.body;
  if (!rawText) return res.status(400).json({ error: '内容不能为空' });

  const nodes = parseSubscriptionContent(rawText, yaml);
  if (nodes.length === 0) {
    return res.status(400).json({ error: '未能识别出任何有效节点' });
  }

  // Create as manual subscription or add directly
  const finalSubName = (subName && subName.trim()) ? subName.trim() : db.getNextSubName();
  const sub = db.addSubscription({
    name: finalSubName,
    url: 'manual://' + Date.now(),
    autoRefresh: false
  });

  db.setSubscriptionNodes(sub.id, nodes);
  const updatedSub = db.updateSubscription(sub.id, {
    nodeCount: nodes.length,
    lastStatus: 'updating',
    lastMessage: `已导入 ${nodes.length} 个节点，正在自动测速...`
  });
  broadcast('subscription_updated', { id: sub.id, sub: updatedSub });

  // 导入订阅后，自动测试节点延迟：成功则加入整合订阅，失败则不加入
  setTimeout(async () => {
    try {
      const freshNodes = db.getNodes({ subId: sub.id });
      if (!freshNodes || freshNodes.length === 0) return;
      const settings = db.getSettings();
      const taskId = 'autotest_' + sub.id + '_' + Date.now().toString(36);

      broadcast('test_started', {
        taskId,
        subId: sub.id,
        title: `自动测速: ${sub.name}`,
        total: freshNodes.length,
        nodeNames: freshNodes.map(n => n.name)
      });

      const testResults = await tester.testNodes(freshNodes, {
        taskId,
        testUrl: settings.testUrl,
        timeout: settings.testTimeout,
        concurrency: settings.testConcurrency,
        maxRetries: 2,
        onProgress: (progress) => {
          broadcast('test_progress', { taskId, subId: sub.id, ...progress });
        }
      });

      db.updateNodesBatch(testResults);
      const aliveCount = testResults.filter(r => r.inCombinedSub).length;
      const finalSub = db.updateSubscription(sub.id, {
        nodeCount: freshNodes.length,
        aliveCount,
        lastUpdate: new Date().toISOString(),
        lastStatus: 'success',
        lastMessage: `同步完成：共 ${freshNodes.length} 节点，${aliveCount} 个可用`
      });
      db.addLog('info', `手动导入 [${sub.name}] 自动测试完毕：${aliveCount} 个可用节点已自动纳入整合订阅`, { subId: sub.id, aliveCount });
      broadcast('test_completed', { taskId, subId: sub.id, results: testResults, count: testResults.length });
      broadcast('subscription_updated', { id: sub.id, sub: finalSub });
    } catch (e) {
      console.error('[Manual Import] Auto test error:', e.message);
      const fallbackSub = db.updateSubscription(sub.id, {
        lastStatus: 'success',
        lastMessage: `已导入 ${nodes.length} 个节点 (自动测速异常: ${e.message})`
      });
      broadcast('subscription_updated', { id: sub.id, sub: fallbackSub });
    }
  }, 300);

  res.json({ subId: sub.id, count: nodes.length });
});

// Nodes Management
app.get('/api/nodes', authMiddleware, (req, res) => {
  const { subId, protocol, status, keyword, inCombinedSub } = req.query;
  const nodes = db.getNodes({ subId, protocol, status, keyword, inCombinedSub });
  res.json(nodes);
});

app.put('/api/nodes/:id', authMiddleware, (req, res) => {
  const updated = db.updateNode(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: '节点不存在' });
  broadcast('node_updated', updated);
  res.json(updated);
});

// Toggle or batch set whether nodes are in combined sub
app.post('/api/nodes/batch-combined-status', authMiddleware, (req, res) => {
  const { ids, inCombinedSub } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  const count = db.batchSetCombinedSub(ids, inCombinedSub);
  broadcast('nodes_cleaned', { count });
  res.json({ success: true, count });
});

app.delete('/api/nodes/:id', authMiddleware, (req, res) => {
  db.deleteNode(req.params.id);
  res.json({ success: true });
});

app.post('/api/nodes/batch-delete', authMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  db.deleteNodes(ids);
  res.json({ success: true, count: ids.length });
});

// Clear failed nodes
app.post('/api/nodes/filter-failed', authMiddleware, (req, res) => {
  const result = db.filterFailedNodes();
  broadcast('nodes_cleaned', result);
  res.json(result);
});

// Deduplicate nodes
app.post('/api/nodes/deduplicate', authMiddleware, (req, res) => {
  const result = db.deduplicateNodes();
  broadcast('nodes_cleaned', result);
  res.json(result);
});

// Latency Speed Test (手动测速支持重试 3 次，失败则踢出整合订阅，支持多任务并发)
app.post('/api/nodes/test-speed', authMiddleware, async (req, res) => {
  const { ids, subId, maxRetries = 3 } = req.body;
  let targetNodes = [];

  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    targetNodes = db.getNodes().filter(n => idSet.has(n.id));
  } else if (subId) {
    targetNodes = db.getNodes({ subId });
  } else {
    targetNodes = db.getNodes();
  }

  if (targetNodes.length === 0) {
    return res.status(400).json({ error: '没有需要测速的节点' });
  }

  const sub = subId ? db.getSubscription(subId) : null;
  const taskId = 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const settings = db.getSettings();
  const nodeNames = targetNodes.map(n => n.name);

  // Respond immediately and run in background with WebSocket broadcasts
  res.json({
    message: '测速任务已在后台启动',
    taskId,
    subId,
    total: targetNodes.length,
    nodeNames
  });

  try {
    broadcast('test_started', {
      taskId,
      subId,
      title: sub ? `订阅测速: ${sub.name}` : (targetNodes.length === 1 ? `节点测速: ${nodeNames[0]}` : 'Mihomo 并发测速中'),
      total: targetNodes.length,
      nodeNames
    });

    const results = await tester.testNodes(targetNodes, {
      taskId,
      testUrl: settings.testUrl,
      timeout: settings.testTimeout,
      concurrency: settings.testConcurrency,
      maxRetries: Number(maxRetries) || 3, // 手动测速超时时额外自动重试 3 次
      onProgress: (progress) => {
        broadcast('test_progress', { taskId, subId, ...progress });
      }
    });

    db.updateNodesBatch(results);
    const aliveCount = results.filter(r => r.inCombinedSub).length;

    if (subId) {
      const finalSub = db.updateSubscription(subId, {
        aliveCount,
        lastUpdate: new Date().toISOString(),
        lastStatus: 'success',
        lastMessage: `同步完成：共 ${targetNodes.length} 节点，${aliveCount} 个可用`
      });
      broadcast('subscription_updated', { id: subId, sub: finalSub });
    }

    broadcast('test_completed', { taskId, subId, results, count: results.length });
    db.addLog('info', `完成 ${results.length} 个节点的延迟测速 (已自动维护整合状态: ${aliveCount} 个保留在整合订阅中)`);

  } catch (err) {
    broadcast('test_error', { taskId, subId, error: err.message });
    db.addLog('error', `测速异常: ${err.message}`);
  }
});

// 延迟 + 网速 捆绑测速（先延迟筛存活，再对存活节点测真实带宽）
app.post('/api/nodes/test-bundle', authMiddleware, (req, res) => {
  const { ids, subId, scope, mode, maxRetries } = req.body || {};
  try {
    const job = testBundle.runBundle({ ids, subId, scope, mode, maxRetries, trigger: 'manual' });
    res.json(job);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 清理测速结果（延迟 / 网速，可指定节点或全量）
app.post('/api/nodes/clear-results', authMiddleware, (req, res) => {
  const { ids, types } = req.body || {};
  const result = db.clearTestResults({ ids, types });
  broadcast('nodes_cleared', result);
  db.addLog('info', `清理测速结果：${result.count} 个节点，类型 ${result.types.join('+') || '无'}`);
  res.json(result);
});

// 节点真实带宽（网速）测速：通过每个节点实际下载文件，统计稳态吞吐 (Mbps)
app.post('/api/nodes/speed-test', authMiddleware, (req, res) => {
  const { ids, subId, scope, durationMs, maxBytes, concurrency, url } = req.body || {};
  try {
    const job = speedRunner.startSpeedTest({ ids, subId, scope, durationMs, maxBytes, concurrency, url, trigger: 'manual' });
    res.json({ message: '网速测速任务已在后台启动', ...job });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/nodes/speed-test/status', authMiddleware, (req, res) => {
  res.json({ running: speedRunner.isRunning(), settings: {
    speedTestEnabled: db.getSettings().speedTestEnabled,
    speedTestCron: db.getSettings().speedTestCron,
    speedTestUrl: db.getSettings().speedTestUrl,
    speedTestDurationMs: db.getSettings().speedTestDurationMs,
    speedTestConcurrency: db.getSettings().speedTestConcurrency,
    speedTestScope: db.getSettings().speedTestScope
  } });
});

// Profiles (整合订阅)
app.get('/api/profiles', authMiddleware, (req, res) => {
  res.json(db.getProfiles());
});
app.post('/api/profiles', authMiddleware, (req, res) => {
  const newProf = db.addProfile(req.body);
  res.json(newProf);
});

app.put('/api/profiles/:id', authMiddleware, (req, res) => {
  const updated = db.updateProfile(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: '整合订阅不存在' });
  res.json(updated);
});

app.delete('/api/profiles/:id', authMiddleware, (req, res) => {
  db.deleteProfile(req.params.id);
  res.json({ success: true });
});

// Logs
app.get('/api/logs', authMiddleware, (req, res) => {
  res.json(db.getLogs());
});

// Full System Config Export & Import (备份与恢复全量配置)
app.get('/api/system/config/export', authMiddleware, (req, res) => {
  const fullConfig = db.exportFullConfig();
  res.setHeader('Content-Disposition', `attachment; filename="sub_backup_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(fullConfig, null, 2));
});

app.post('/api/system/config/import', authMiddleware, (req, res) => {
  try {
    const { configData, mode = 'merge' } = req.body;
    if (!configData) {
      return res.status(400).json({ error: '配置内容不能为空' });
    }
    const result = db.importFullConfig(configData, mode);
    db.addLog('info', `全量配置文件导入成功 (模式: ${mode === 'overwrite' ? '完整覆盖' : '智能合并'})`, result);
    broadcast('subscription_updated', {});
    broadcast('nodes_cleaned', {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: '配置文件导入失败: ' + err.message });
  }
});

// Serve frontend static files
const DIST_PATH = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
  // SPA history fallback：/nodes、/settings 这类前端路由直接返回 index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/sub')) return next();
    // 带扩展名的当成静态资源，缺失就让它 404，别把 HTML 当 JS/CSS 返回
    if (path.extname(req.path)) return next();
    const accept = req.headers.accept || '';
    // 只对「想要 HTML」的请求兜底；curl 默认 */*、浏览器默认带 text/html
    const wantsHtml = !accept || accept.includes('text/html') || accept.includes('*/*');
    if (!wantsHtml) return next();
    return res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`SUB 聚合订阅管理平台已启动: http://127.0.0.1:${PORT}`);
  if (db.getUser().hasDefaultPassword) {
    console.log(`[安全提示] 当前仍在使用默认口令 admin / admin123456，请立即在「系统配置」中修改`);
  } else {
    console.log(`管理员口令已自定义`);
  }
  console.log(`===============================================`);
  scheduler.init();
});

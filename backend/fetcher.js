const axios = require('axios');
const https = require('https');
const yaml = require('yaml');
const db = require('./db');
const { parseSubscriptionContent } = require('./parser');
const tester = require('./tester');

const DEFAULT_USER_AGENT = 'ClashMeta/1.19.31 (Clash.Meta; Linux x86_64)';

let broadcastFn = null;
function setBroadcast(fn) {
  broadcastFn = fn;
}
function broadcast(type, payload) {
  if (broadcastFn) {
    try {
      broadcastFn(type, payload);
    } catch (e) {}
  }
}

function buildRequestConfig(sub) {
  const settings = db.getSettings();
  const ignoreTlsVerify = settings.ignoreTlsVerify !== false;
  const config = {
    timeout: 15000,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': '*/*'
    },
    responseType: 'text'
  };

  if (/^https:\/\//i.test(sub.url || '')) {
    config.httpsAgent = new https.Agent({
      rejectUnauthorized: !ignoreTlsVerify
    });
  }

  return config;
}

async function fetchSubscription(subId) {
  const sub = db.getSubscription(subId);
  if (!sub) {
    throw new Error('未找到指定订阅: ' + subId);
  }

  try {
    db.updateSubscription(subId, {
      lastStatus: 'updating',
      lastMessage: '正在请求订阅服务器...'
    });

    if (!sub.ip && sub.url) {
      try {
        const resolvedIp = await db.resolveSubscriptionIp(sub.url);
        if (resolvedIp) {
          db.updateSubscription(subId, { ip: resolvedIp });
        }
      } catch (e) {}
    }

    const response = await axios.get(sub.url, buildRequestConfig(sub));

    const rawData = response.data;
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('订阅内容为空或返回格式不正确');
    }

    const nodes = parseSubscriptionContent(rawData, yaml);
    if (!nodes || nodes.length === 0) {
      throw new Error('未能从订阅中识别出有效节点（请检查订阅链接或内容格式）');
    }

    // Preserve previously tested latency for matching nodes (same server + port + protocol)
    const existingNodes = db.getNodes({ subId });
    const existingMap = new Map();
    existingNodes.forEach(n => {
      const key = `${n.type}:${n.server}:${n.port}:${n.uuid || n.password || ''}`;
      existingMap.set(key, n);
    });

    const mergedNodes = nodes.map(n => {
      const key = `${n.type}:${n.server}:${n.port}:${n.uuid || n.password || ''}`;
      const old = existingMap.get(key);
      if (old) {
        return {
          ...n,
          delay: old.delay || 0,
          status: old.status || 'untested',
          inCombinedSub: Boolean(old.inCombinedSub),
          lastTestTime: old.lastTestTime || null
        };
      }
      return {
        ...n,
        inCombinedSub: false
      };
    });

    db.setSubscriptionNodes(subId, mergedNodes);
    const updatedSub = db.updateSubscription(subId, {
      nodeCount: mergedNodes.length,
      lastStatus: 'updating',
      lastMessage: `已获取 ${mergedNodes.length} 个节点，正在自动测速...`
    });
    db.addLog('info', `订阅 [${sub.name}] 刷新成功，获取到 ${mergedNodes.length} 个节点，开始自动测速`, { subId, count: mergedNodes.length });
    broadcast('subscription_updated', { id: subId, sub: updatedSub });

    // 导入或刷新订阅后，自动测试节点延迟：成功则加入整合订阅，失败则不加入，并同步该条订阅状态
    setTimeout(async () => {
      try {
        const freshNodes = db.getNodes({ subId });
        if (!freshNodes || freshNodes.length === 0) return;
        const settings = db.getSettings();
        const taskId = 'autotest_' + subId + '_' + Date.now().toString(36);

        broadcast('test_started', {
          taskId,
          subId,
          title: `自动测速: ${sub.name}`,
          total: freshNodes.length,
          nodeNames: freshNodes.map(n => n.name)
        });

        const testResults = await tester.testNodes(freshNodes, {
          taskId,
          testUrl: settings.testUrl,
          timeout: settings.testTimeout,
          concurrency: settings.testConcurrency,
          maxRetries: 2, // 自动测速支持重试 2 次，避免节点初始握手抖动导致误判超时
          onProgress: (progress) => {
            broadcast('test_progress', { taskId, subId, ...progress });
          }
        });

        db.updateNodesBatch(testResults);
        const aliveCount = testResults.filter(r => r.inCombinedSub).length;
        const finalSub = db.updateSubscription(subId, {
          nodeCount: freshNodes.length,
          aliveCount,
          lastUpdate: new Date().toISOString(),
          lastStatus: 'success',
          lastMessage: `同步完成：共 ${freshNodes.length} 节点，${aliveCount} 个可用`
        });
        db.addLog('info', `订阅 [${sub.name}] 自动延迟测试完毕：${aliveCount} 个可用节点已自动纳入整合订阅`, { subId, aliveCount });
        broadcast('test_completed', { taskId, subId, results: testResults, count: testResults.length });
        broadcast('subscription_updated', { id: subId, sub: finalSub });
      } catch (e) {
        console.error('[Fetcher] Auto-test after refresh error:', e.message);
        const fallbackSub = db.updateSubscription(subId, {
          lastStatus: 'success',
          lastMessage: `已解析 ${mergedNodes.length} 个节点 (自动测速异常: ${e.message})`
        });
        broadcast('subscription_updated', { id: subId, sub: fallbackSub });
      }
    }, 300);

    return {
      success: true,
      count: mergedNodes.length,
      message: `成功获取 ${mergedNodes.length} 个节点，正在后台自动测速`
    };

  } catch (err) {
    let errorMsg = err.response ? `HTTP ${err.response.status}: ${err.message}` : err.message;
    if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      errorMsg += '。证书域名与订阅地址不匹配；如确认订阅服务器可信，请在系统设置中开启「忽略 TLS 证书校验」后重试。';
    } else if (err.code === 'CERT_HAS_EXPIRED' || /certificate has expired/i.test(err.message || '')) {
      errorMsg += '。服务器证书已过期；确认服务器可信后，可在系统设置中开启「忽略 TLS 证书校验」后重试。';
    }
    const failedSub = db.updateSubscription(subId, {
      lastStatus: 'failed',
      lastMessage: errorMsg
    });
    broadcast('subscription_updated', { id: subId, sub: failedSub });
    db.addLog('error', `订阅 [${sub.name}] 刷新失败: ${errorMsg}`, { subId });
    throw new Error(errorMsg);
  }
}

async function fetchAllSubscriptions() {
  const subs = db.getSubscriptions().filter(s => s.enabled);
  const results = [];
  for (const s of subs) {
    try {
      const res = await fetchSubscription(s.id);
      results.push({ id: s.id, name: s.name, success: true, count: res.count });
    } catch (e) {
      results.push({ id: s.id, name: s.name, success: false, error: e.message });
    }
  }
  return results;
}

module.exports = {
  fetchSubscription,
  fetchAllSubscriptions,
  setBroadcast
};

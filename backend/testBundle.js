/**
 * 延迟 + 网速 捆绑测速任务
 * ------------------------------------------------------------
 * 一次任务里先跑延迟（Mihomo 并发探测），再对「本轮存活」的节点跑网速（真实下载），
 * 手动按钮与定时 cron 共用同一套编排逻辑。
 */

const db = require('./db');
const tester = require('./tester');
const speedRunner = require('./speedRunner');

let broadcastFn = () => { };

function setBroadcast(fn) {
  if (typeof fn === 'function') broadcastFn = fn;
}

function broadcast(type, payload) {
  try { broadcastFn(type, payload); } catch (e) { }
}

let activeBundleId = null;

function isRunning() {
  return Boolean(activeBundleId);
}

function pickNodes({ ids, subId, scope, customIds } = {}) {
  const all = db.getNodes();

  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    return all.filter(n => idSet.has(n.id));
  }
  if (subId) {
    return all.filter(n => n.subId === subId);
  }

  const settings = db.getSettings();
  const mode = scope || settings.schedTestScope || 'combined';

  if (mode === 'custom') {
    const list = (Array.isArray(customIds) && customIds.length) ? customIds : (settings.schedTestNodeIds || []);
    const idSet = new Set(list);
    const picked = all.filter(n => idSet.has(n.id));
    if (picked.length) return picked;
    const fallback = all.filter(n => n.inCombinedSub);
    return fallback.length ? fallback : all;
  }
  if (mode === 'alive') {
    const alive = all.filter(n => n.delay > 0 && n.status !== 'failed');
    return alive.length ? alive : all;
  }
  if (mode === 'all') return all;

  const combined = all.filter(n => n.inCombinedSub);
  return combined.length ? combined : all;
}

async function runDelayPhase(nodes, settings, maxRetries, trigger) {
  const taskId = 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const nodeNames = nodes.map(n => n.name);
  const title = nodes.length === 1
    ? `节点测速: ${nodeNames[0]}`
    : `延迟测速（${nodes.length} 个节点）`;

  broadcast('test_started', { taskId, kind: 'delay', trigger, title, total: nodes.length, nodeNames });

  const results = await tester.testNodes(nodes, {
    taskId,
    testUrl: settings.testUrl,
    timeout: settings.testTimeout,
    concurrency: settings.testConcurrency,
    maxRetries: Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : 3,
    onProgress: (progress) => broadcast('test_progress', { taskId, kind: 'delay', trigger, ...progress })
  });

  db.updateNodesBatch(results);
  broadcast('test_completed', { taskId, kind: 'delay', trigger, results, count: results.length });

  const alive = results.filter(r => r.status === 'alive').length;
  return { results, alive, taskId };
}

/**
 * 启动捆绑测速（立即返回，实际执行在后台）
 * @param {Object} opts { ids, subId, scope, customIds, mode:'both'|'delay'|'speed', maxRetries, trigger }
 */
function runBundle(opts = {}) {
  if (activeBundleId) {
    const err = new Error('已有测速任务正在运行，请稍候再试');
    err.statusCode = 429;
    throw err;
  }

  const settings = db.getSettings();
  const targets = pickNodes(opts);
  if (!targets || targets.length === 0) {
    const err = new Error('没有需要测速的节点');
    err.statusCode = 400;
    throw err;
  }

  const mode = ['both', 'delay', 'speed'].includes(opts.mode)
    ? opts.mode
    : (settings.schedTestMode || 'both');
  const trigger = opts.trigger || 'manual';
  const bundleId = 'bundle_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const nodeNames = targets.map(n => n.name);

  if (mode === 'speed' && speedRunner.isRunning()) {
    const err = new Error('网速测速任务正在运行，请稍候再试');
    err.statusCode = 429;
    throw err;
  }

  activeBundleId = bundleId;

  (async () => {
    try {
      let speedTargetIds = targets.map(n => n.id);

      // 阶段 1：延迟
      if (mode === 'both' || mode === 'delay') {
        console.log(`[Bundle] 延迟测速开始：${targets.length} 个节点 (${trigger})`);
        const { results, alive } = await runDelayPhase(targets, settings, opts.maxRetries, trigger);
        console.log(`[Bundle] 延迟测速完成：${results.length} 个节点，${alive} 个存活`);
        db.addLog('info', `延迟测速完成：${results.length} 个节点，${alive} 个存活${trigger === 'cron' ? '（定时）' : ''}`);

        // 网速阶段只测本轮存活的节点
        if (mode === 'both' && settings.schedTestSpeedAliveOnly !== false) {
          // 延迟跑完到网速开始之间，订阅可能刚好刷新过（历史版本刷新会换 id）。
          // 先按 id 认；认不到就用「subId + 名称」映射到当前库里的节点，避免这批节点被整批漏测。
          const aliveResults = results.filter(r => r.status === 'alive');
          const subOfName = new Map(targets.map(n => [n.name, n.subId || '']));
          const freshNodes = db.getNodes();
          const idSet = new Set(freshNodes.map(n => n.id));
          const bySubName = new Map(freshNodes.map(n => [`${n.subId || ''}|${n.name}`, n.id]));
          let remapped = 0;
          speedTargetIds = [];
          aliveResults.forEach(r => {
            if (idSet.has(r.id)) {
              speedTargetIds.push(r.id);
              return;
            }
            const hit = bySubName.get(`${subOfName.get(r.name) || ''}|${r.name}`);
            if (hit) {
              speedTargetIds.push(hit);
              remapped++;
            }
          });
          if (remapped > 0) {
            console.log(`[Bundle] 网速目标重映射：${remapped} 个节点 id 已变化（订阅刷新），按 subId+名称 对齐`);
          }
          if (speedTargetIds.length !== aliveResults.length) {
            console.warn(`[Bundle] 网速目标缺失：存活 ${aliveResults.length} 个，匹配到 ${speedTargetIds.length} 个`);
          }
        }
      }

      // 阶段 2：网速
      if (mode === 'both' || mode === 'speed') {
        if (speedTargetIds.length === 0) {
          db.addLog('warn', '网速阶段已跳过：本轮没有存活节点');
          console.log('[Bundle] 网速阶段跳过：没有存活节点');
          return;
        }
        console.log(`[Bundle] 网速测速开始：${speedTargetIds.length} 个节点 (${trigger})`);
        speedRunner.startSpeedTest({ ids: speedTargetIds, trigger });
      }
    } catch (err) {
      console.error('[Bundle] 任务异常:', err.message);
      db.addLog('error', `捆绑测速任务异常: ${err.message}`);
      broadcast('test_error', { kind: 'delay', trigger, error: err.message });
    } finally {
      activeBundleId = null;
    }
  })();

  return {
    bundleId,
    total: targets.length,
    mode,
    nodeNames,
    message: mode === 'both' ? '延迟 + 网速 捆绑任务已启动' : (mode === 'delay' ? '延迟测速任务已启动' : '网速测速任务已启动')
  };
}

module.exports = {
  setBroadcast,
  runBundle,
  pickNodes,
  isRunning
};

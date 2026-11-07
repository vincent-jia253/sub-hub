/**
 * 网速测速任务编排：挑选节点 → 调 speedtest 跑带宽 → 落库 → WebSocket 广播
 * 供 server.js 的手动接口与 scheduler.js 的定时任务共用，避免循环依赖。
 */

const db = require('./db');
const speedtest = require('./speedtest');

let broadcastFn = () => { };

function setBroadcast(fn) {
  if (typeof fn === 'function') broadcastFn = fn;
}

function broadcast(type, payload) {
  try { broadcastFn(type, payload); } catch (e) { }
}

/**
 * 依据范围挑选待测节点
 * @param {Object} opts { ids, subId, scope }
 */
function pickNodes({ ids, subId, scope } = {}) {
  const all = db.getNodes();

  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    return all.filter(n => idSet.has(n.id));
  }
  if (subId) {
    return all.filter(n => n.subId === subId);
  }

  const mode = scope || db.getSettings().speedTestScope || 'alive';
  if (mode === 'combined') {
    const list = all.filter(n => n.inCombinedSub);
    return list.length ? list : all;
  }
  if (mode === 'all') return all;

  // 默认 alive：只测延迟正常的节点，省时间也避免对死节点做无用下载
  const alive = all.filter(n => n.delay > 0 && n.status !== 'failed');
  return alive.length ? alive : all;
}

/**
 * 启动一次网速测速（立即返回任务信息，实际测量在后台进行）
 * @returns {{taskId:string, total:number, nodeNames:string[]}}
 */
function startSpeedTest({ ids, subId, scope, trigger = 'manual', durationMs, maxBytes, concurrency, url } = {}) {
  if (speedtest.isRunning()) {
    const err = new Error('已有网速测速任务正在运行，请稍候再试');
    err.statusCode = 429;
    throw err;
  }

  const settings = db.getSettings();
  const targets = pickNodes({ ids, subId, scope });
  if (!targets || targets.length === 0) {
    const err = new Error('没有需要测网速的节点');
    err.statusCode = 400;
    throw err;
  }

  const taskId = 'speed_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const nodeNames = targets.map(n => n.name);
  const title = targets.length === 1
    ? `网速测速: ${nodeNames[0]}`
    : `网速测速（${targets.length} 个节点）`;

  broadcast('test_started', {
    taskId,
    kind: 'speed',
    trigger,
    title,
    total: targets.length,
    nodeNames
  });

  // 参数：显式传入 > 设置项
  const runOptions = {
    taskId,
    url: url || settings.speedTestUrl,
    durationMs: durationMs || settings.speedTestDurationMs,
    maxBytes: maxBytes || settings.speedTestMaxBytes,
    concurrency: concurrency || settings.speedTestConcurrency,
    onProgress: (progress) => {
      broadcast('test_progress', { taskId, kind: 'speed', trigger, ...progress });
    }
  };

  (async () => {
    try {
      const { results } = await speedtest.runSpeedTest(targets, runOptions);
      db.updateNodesBatch(results);
      const okCount = results.filter(r => r.speedStatus === 'ok').length;
      const best = results.filter(r => r.speedStatus === 'ok').sort((a, b) => b.speed - a.speed)[0];
      broadcast('test_completed', { taskId, kind: 'speed', trigger, results, count: results.length });
      // 同时打到 stdout：docker logs 里能看到「开始 → 完成」成对出现，
      // 不会再出现「只有开始没有完成」这种只能靠翻页面日志才能发现的静默失败
      console.log(`[Speed] 网速测速完成：${results.length} 个节点，成功 ${okCount} 个${best ? `，最快 ${best.name} ${best.speed} Mbps` : ''}`);
      db.addLog('info', `完成 ${results.length} 个节点的网速测速（成功 ${okCount} 个${best ? `，最快 ${best.name} ${best.speed} Mbps` : ''}）`, {
        taskId,
        trigger
      });
    } catch (err) {
      broadcast('test_error', { taskId, kind: 'speed', trigger, error: err.message });
      console.error(`[Speed] 网速测速异常: ${err.message}`);
      db.addLog('error', `网速测速异常: ${err.message}`, { taskId, trigger });
    }
  })();

  return { taskId, total: targets.length, nodeNames, kind: 'speed' };
}

function isRunning() {
  return speedtest.isRunning();
}

module.exports = {
  setBroadcast,
  startSpeedTest,
  pickNodes,
  isRunning
};

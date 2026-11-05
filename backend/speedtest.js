/**
 * 节点真实带宽（下载速度）测速器
 * ------------------------------------------------------------
 * 原理：
 *   1. 复用 tester.js 的 Mihomo 内核，但这次以 `mode: global` + 随机 `mixed-port` 启动；
 *   2. 逐个节点通过 `PUT /proxies/GLOBAL` 切换全局出口；
 *   3. 用裸 socket 通过本地 HTTP 代理做 CONNECT 隧道，下载一个已知大小的文件并统计字节数；
 *   4. 去掉前 600ms 的 TCP 慢启动窗口，用稳态区间计算 Mbps，比"看视频卡不卡"客观得多。
 *
 * 之所以不用 YouTube：视频流需要 DRM/会话解析、且按码率自适应封顶（比如 1080p 只有 5Mbps），
 * 测出来的是"YouTube 给了多少码率"而不是"节点有多快"。这里测的是节点出口到 CDN 的真实吞吐。
 */

const http = require('http');
const net = require('net');
const tls = require('tls');
const path = require('path');
const { URL } = require('url');
const tester = require('./tester');

// Cloudflare 官方测速端点：返回指定字节数的随机数据，走 Anycast，全球可达
const DEFAULT_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=31457280';

// 主地址不通时的兜底目标（覆盖不同网络环境）
const FALLBACK_SPEED_URLS = [
  'https://speed.cloudflare.com/__down?bytes=10485760',
  'https://cachefly.cachefly.net/10mb.test'
];

const DEFAULTS = {
  durationMs: 6000,          // 每个节点下载时长（毫秒）
  maxBytes: 48 * 1024 * 1024, // 单节点下载字节上限
  warmupMs: 600,             // 慢启动窗口（不参与速率计算）
  idleTimeoutMs: 10000,      // 连上后多久没数据算失败
  concurrency: 2             // 并发节点数（带宽共享，别开太大）
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseTarget(rawUrl) {
  let str = String(rawUrl || '').trim();
  if (!str) str = DEFAULT_SPEED_URL;
  if (!/^https?:\/\//i.test(str)) str = 'https://' + str;
  const u = new URL(str);
  const isHttps = u.protocol === 'https:';
  return {
    isHttps,
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80),
    path: (u.pathname || '/') + (u.search || ''),
    url: u.toString()
  };
}

function waitForPort(port, timeoutMs = 6000, host = '127.0.0.1') {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const attempt = () => {
      const sock = net.connect(port, host);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function apiRequest(apiPort, secret, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization': `Bearer ${secret}` };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: '127.0.0.1', port: apiPort, method, path: apiPath, headers, timeout: 4000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Mihomo API 超时')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 通过本地 HTTP 代理下载并统计真实吞吐
 * @returns {Promise<{ok:boolean, bytes:number, speedMbps:number, speedBps:number, durationMs:number, firstByteMs:number, statusCode:number, error:string, reason:string}>}
 */
function downloadThroughProxy({ proxyHost = '127.0.0.1', proxyPort, target, durationMs, maxBytes, warmupMs, idleTimeoutMs }) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    let receivedTotal = 0;
    let receivedSteady = 0;
    let steadyStartAt = 0;
    let firstByteAt = 0;
    let lastDataAt = Date.now();
    let done = false;
    let error = '';
    let statusCode = 0;
    let headerBuf = '';
    let headerDone = false;

    let deadlineTimer = null;
    let tickTimer = null;
    let connectReq = null;
    let stream = null;

    const cleanup = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (tickTimer) clearInterval(tickTimer);
      try { stream && stream.destroy(); } catch (e) {}
      try { connectReq && connectReq.destroy(); } catch (e) {}
    };

    const finish = (reason) => {
      if (done) return;
      done = true;
      cleanup();
      const finishedAt = Date.now();
      const elapsed = Math.max(1, finishedAt - startedAt);
      let speedMbps = 0;
      if (receivedSteady > 0 && steadyStartAt) {
        const steadyMs = Math.max(1, finishedAt - steadyStartAt);
        speedMbps = (receivedSteady * 8) / (steadyMs / 1000) / 1e6;
      } else if (receivedTotal > 0) {
        speedMbps = (receivedTotal * 8) / (elapsed / 1000) / 1e6;
      }
      resolve({
        ok: !error && receivedTotal > 0,
        statusCode,
        bytes: receivedTotal,
        durationMs: elapsed,
        firstByteMs: firstByteAt ? firstByteAt - startedAt : 0,
        speedMbps: Math.round(speedMbps * 100) / 100,
        speedBps: Math.round((speedMbps * 1e6) / 8),
        error: error || '',
        reason
      });
    };

    // 硬超时：握手 + 下载总时长上限
    deadlineTimer = setTimeout(() => finish('hard-timeout'), durationMs + idleTimeoutMs + 2000);

    tickTimer = setInterval(() => {
      if (done) return;
      const anchor = firstByteAt || startedAt;
      // 从首字节算起的下载时长到了就收尾（握手耗时不占用下载窗口）
      if (firstByteAt && Date.now() - anchor >= durationMs) { finish('duration'); return; }
      if (firstByteAt && Date.now() - lastDataAt > idleTimeoutMs) { error = error || '下载过程中长时间无数据'; finish('idle'); }
      if (!firstByteAt && Date.now() - startedAt > idleTimeoutMs) { error = error || '建立下载连接超时（节点无响应）'; finish('connect-timeout'); }
    }, 200);

    connectReq = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.host}:${target.port}`,
      headers: { Host: `${target.host}:${target.port}` },
      timeout: idleTimeoutMs
    });

    connectReq.on('timeout', () => {
      error = error || '代理 CONNECT 超时（节点无响应）';
      finish('connect-timeout');
    });
    connectReq.on('error', (e) => {
      error = error || ('本地代理连接失败: ' + e.message);
      finish('proxy-error');
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        error = `节点拒绝 CONNECT（HTTP ${res.statusCode}）`;
        try { socket.destroy(); } catch (e) {}
        return finish('connect-rejected');
      }

      lastDataAt = Date.now();

      const startStream = (sock) => {
        if (done) { try { sock.destroy(); } catch (e) {} return; }
        stream = sock;
        try { stream.setNoDelay(true); } catch (e) {}

        stream.write([
          `GET ${target.path} HTTP/1.1`,
          `Host: ${target.host}`,
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) sub-hub-speedtest/1.0',
          'Accept: */*',
          'Accept-Encoding: identity',
          'Cache-Control: no-cache',
          'Connection: close',
          '', ''
        ].join('\r\n'));

        stream.on('data', (chunk) => {
          const now = Date.now();
          lastDataAt = now;

          if (!headerDone) {
            headerBuf += chunk.toString('latin1');
            const idx = headerBuf.indexOf('\r\n\r\n');
            if (idx === -1) {
              if (headerBuf.length > 32768) { error = '响应头异常（过长）'; finish('bad-header'); }
              return;
            }
            const head = headerBuf.slice(0, idx);
            const m = head.match(/^HTTP\/\d\.\d\s+(\d{3})/);
            statusCode = m ? parseInt(m[1], 10) : 0;
            headerDone = true;
            const body = Buffer.from(headerBuf.slice(idx + 4), 'latin1');
            headerBuf = '';
            if (statusCode >= 400) {
              error = `目标站点返回 HTTP ${statusCode}`;
              return finish('http-error');
            }
            firstByteAt = now;
            steadyStartAt = now + warmupMs;
            if (body.length > 0) {
              receivedTotal += body.length;
              if (now >= steadyStartAt) receivedSteady += body.length;
            }
          } else {
            receivedTotal += chunk.length;
            if (steadyStartAt && now >= steadyStartAt) receivedSteady += chunk.length;
          }

          if (receivedTotal >= maxBytes) finish('max-bytes');
        });

        stream.on('end', () => finish('completed'));
        stream.on('close', () => finish('completed'));
        stream.on('error', (e) => {
          if (!done) { error = error || ('下载中断: ' + e.message); finish('stream-error'); }
        });
      };

      if (target.isHttps) {
        const tlsSock = tls.connect({ socket, servername: target.host, rejectUnauthorized: false }, () => startStream(tlsSock));
        tlsSock.on('error', (e) => {
          if (!done) { error = error || ('TLS 握手失败: ' + e.message); finish('tls-error'); }
        });
      } else {
        startStream(socket);
      }
    });

    connectReq.end();
  });
}

let activeTaskId = null;

function isRunning() {
  return Boolean(activeTaskId);
}

/**
 * 执行一批节点的带宽测速
 * @param {Array} nodes 节点数组（db 结构）
 * @param {Object} options { taskId, url, durationMs, maxBytes, concurrency, onProgress }
 */
async function runSpeedTest(nodes, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return { taskId: null, results: [] };
  if (activeTaskId) {
    const err = new Error('已有网速测速任务正在运行，请稍候');
    err.busy = true;
    throw err;
  }

  const taskId = options.taskId || ('speed_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
  const durationMs = clampInt(options.durationMs, 2000, 30000, DEFAULTS.durationMs);
  const maxBytes = clampInt(options.maxBytes, 1024 * 1024, 200 * 1024 * 1024, DEFAULTS.maxBytes);
  const concurrency = clampInt(options.concurrency, 1, 4, DEFAULTS.concurrency);
  const warmupMs = DEFAULTS.warmupMs;
  const idleTimeoutMs = DEFAULTS.idleTimeoutMs;
  const primaryUrl = options.url || DEFAULT_SPEED_URL;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  activeTaskId = taskId;
  tester.ensureTempDir();

  const apiPort = await tester.getFreePort();
  const mixedPort = await tester.getFreePort();
  const secret = 'mihomo_speed_' + Math.random().toString(36).slice(2, 8);
  const configFile = path.join(tester.configDir, `speed_${taskId}.yaml`);

  // 名称去重（Mihomo 不允许重名），保持与入参同序
  const uniqueNodes = tester.ensureUniqueNodeNames(nodes);

  const results = [];
  let cursor = 0;
  const total = uniqueNodes.length;

  try {
    const startRes = await tester.startMihomoWithNodes(uniqueNodes, {
      taskId,
      apiPort,
      secret,
      configFile,
      mixedPort,
      mode: 'global'
    });

    if (!startRes || !startRes.ok) {
      throw new Error(`无法启动 Mihomo 内核 (${tester.getBinaryPath ? tester.getBinaryPath() : 'mihomo'})：${startRes?.error || '未知错误'}`);
    }

    const portReady = await waitForPort(mixedPort, 8000);
    if (!portReady) throw new Error(`Mihomo 本地代理端口 ${mixedPort} 未就绪`);

    await sleep(400);

    const worker = async () => {
      while (cursor < total) {
        const index = cursor++;
        const item = uniqueNodes[index];
        const originalId = nodes[index].id;

        let res = null;
        let usedUrl = primaryUrl;

        try {
          await apiRequest(apiPort, secret, 'PUT', '/proxies/GLOBAL', { name: item.name });
          await sleep(150);

          const candidates = [primaryUrl, ...FALLBACK_SPEED_URLS.filter(u => u !== primaryUrl)];
          for (const candidate of candidates) {
            usedUrl = candidate;
            const target = parseTarget(candidate);
            res = await downloadThroughProxy({
              proxyPort: mixedPort,
              target,
              durationMs,
              maxBytes,
              warmupMs,
              idleTimeoutMs
            });
            // 有数据就采用；完全没数据才换下一个目标重试
            if (res.bytes > 0) break;
          }
        } catch (e) {
          res = { ok: false, bytes: 0, speedMbps: 0, speedBps: 0, durationMs: 0, firstByteMs: 0, statusCode: 0, error: e.message, reason: 'exception' };
        }

        const ok = Boolean(res && res.ok && res.bytes > 0);
        const result = {
          id: originalId,
          // 用数据库里的原始名称，避免把去重后的 "xxx (2)" 写回节点记录
          name: nodes[index].name || item.name,
          speed: ok ? res.speedMbps : -1,
          speedMbps: ok ? res.speedMbps : 0,
          speedBps: ok ? res.speedBps : 0,
          speedBytes: res ? res.bytes : 0,
          speedDurationMs: res ? res.durationMs : 0,
          speedFirstByteMs: res ? res.firstByteMs : 0,
          speedUrl: usedUrl,
          speedStatus: ok ? 'ok' : 'failed',
          speedError: ok ? '' : (res?.error || '下载失败'),
          speedTime: new Date().toISOString()
        };

        results.push(result);
        if (onProgress) {
          onProgress({ taskId, current: results.length, total, latest: result });
        }
      }
    };

    const workers = [];
    const workerCount = Math.min(concurrency, total);
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    return { taskId, results, port: mixedPort };
  } finally {
    activeTaskId = null;
    await tester.stopMihomoTask(taskId);
  }
}

module.exports = {
  runSpeedTest,
  isRunning,
  parseTarget,
  downloadThroughProxy,
  DEFAULT_SPEED_URL,
  FALLBACK_SPEED_URLS
};

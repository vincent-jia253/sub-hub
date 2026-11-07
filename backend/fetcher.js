const axios = require('axios');
const https = require('https');
const http = require('http');
const dns = require('dns');
const yaml = require('yaml');
const db = require('./db');
const { parseSubscriptionContent } = require('./parser');
const tester = require('./tester');

const DEFAULT_USER_AGENT = 'ClashMeta/1.19.31 (Clash.Meta; Linux x86_64)';

/* ------------------------------------------------------------------
 * 出站网络的 IPv6 问题
 * 部分机场/订阅域名（尤其 Cloudflare 后面的）解析结果是 AAAA 在前，
 * 而本机或容器到该 IPv6 地址的握手会被对端直接 RST，
 * 在 axios 里表现为 `read ECONNRESET`，页面上就是「订阅更新失败」。
 * 处理方式：
 *   1) 进程级默认改成 IPv4 优先（纯 IPv6 域名仍然能解析，因为那时只有 AAAA）；
 *   2) 万一仍然握手失败，自动用强制 IPv4 的 lookup 再试一次。
 * ------------------------------------------------------------------ */
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

function ipv4Lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, Object.assign({}, options || {}, { family: 4 }), callback);
}

// 只对「链路层」错误做 IPv4 重试；证书错误、404、401 等重试也没意义
const NET_ERROR_CODES = [
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'EAI_AGAIN', 'EPIPE', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'UND_ERR_SOCKET'
];

function describeNetError(err) {
  if (!err) return 'unknown';
  return (err.code || (err.cause && err.cause.code) || err.message || 'unknown');
}

/**
 * 解析 subscription-userinfo 响应头
 * 形如: upload=1234; download=2234; total=1073741824000; expire=1640995200
 * 返回 { used, total, expire }（used = upload+download，单位字节；expire 为毫秒时间戳，0 = 未知）
 */
function parseSubscriptionUserinfo(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const kv = {};
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > 0) kv[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  });
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const total = num(kv['total']);
  const used = num(kv['upload']) + num(kv['download']);
  const expire = Math.round(num(kv['expire']) * 1000);
  if (!total && !used && !expire) return null;
  return { used, total, expire };
}

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

function buildRequestConfig(sub, options) {
  const settings = db.getSettings();
  const ignoreTlsVerify = settings.ignoreTlsVerify !== false;
  const forceIpv4 = !!(options && options.forceIpv4);
  const config = {
    timeout: 15000,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': '*/*'
    },
    responseType: 'text',
    // 不让 axios 自己吞掉底层错误码，下面要靠 code 判断是否做 IPv4 重试
    validateStatus: null
  };

  const isHttps = /^https:\/\//i.test(sub.url || '');
  if (isHttps) {
    const agentOptions = { rejectUnauthorized: !ignoreTlsVerify };
    if (forceIpv4) agentOptions.lookup = ipv4Lookup;
    config.httpsAgent = new https.Agent(agentOptions);
  } else if (forceIpv4) {
    config.httpAgent = new http.Agent({ lookup: ipv4Lookup });
  }

  return config;
}

/**
 * 拉取订阅内容：先按默认（IPv4 优先）请求，链路错误时强制 IPv4 重试一次。
 * 只用链路错误触发重试，HTTP 401/403/404 之类直接把状态码抛回去，避免掩盖真实原因。
 */
async function requestSubscription(url, sub) {
  const attempt = async (options) => {
    const res = await axios.get(url, buildRequestConfig(sub, options));
    if (res.status >= 400) {
      const err = new Error(`订阅服务器返回 HTTP ${res.status}`);
      err.httpStatus = res.status;
      throw err;
    }
    return res;
  };

  try {
    return await attempt();
  } catch (err) {
    const code = describeNetError(err);
    const retriable = NET_ERROR_CODES.indexOf(code) !== -1 ||
      /socket hang up|ECONNRESET|Client network socket disconnected/i.test(err.message || '');
    if (!retriable) throw err;
    console.warn(`[Fetcher] 首次请求失败（${code}），改用强制 IPv4 重试: ${url}`);
    try {
      const res = await attempt({ forceIpv4: true });
      console.log(`[Fetcher] IPv4 重试成功: ${url}`);
      return res;
    } catch (err2) {
      const code2 = describeNetError(err2);
      if (err2.httpStatus) throw err2;
      throw new Error(`订阅请求失败：${code2}（已尝试 IPv6/IPv4 双栈）`);
    }
  }
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

    const response = await requestSubscription(sub.url, sub);

    const rawData = response.data;
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('订阅内容为空或返回格式不正确');
    }

    // 解析机场流量信息（subscription-userinfo: upload=..; download=..; total=..; expire=..）
    const subUserinfo = parseSubscriptionUserinfo(
      response.headers && (response.headers['subscription-userinfo'] || response.headers['Subscription-Userinfo'])
    );
    if (subUserinfo) {
      db.updateSubscription(subId, { userInfo: subUserinfo });
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

    // 配额来源优先级：节点手动(manual) > 订阅响应头(subUserinfo) > 订阅手动配额(manualQuota)
    const subRec = db.getSubscription(subId) || {};
    const subManualQuota = subRec.manualQuota && Number(subRec.manualQuota.total) > 0 ? subRec.manualQuota : null;

    const mergedNodes = nodes.map(n => {
      const key = `${n.type}:${n.server}:${n.port}:${n.uuid || n.password || ''}`;
      const old = existingMap.get(key);
      if (old) {
        const merged = {
          ...n,
          // 关键：沿用旧 id。否则每次刷新都换 id，正在跑的测速写不回、前端选中项失效，
          // 网速阶段也会因拿旧 id 找不到节点而整批跳过（机场节点只测延迟不测网速的根因）
          id: old.id,
          delay: old.delay || 0,
          status: old.status || 'untested',
          inCombinedSub: Boolean(old.inCombinedSub),
          lastTestTime: old.lastTestTime || null,
          delayHistory: Array.isArray(old.delayHistory) ? old.delayHistory : [],
          // 网速结果同样要继承：否则每次定时刷新都会把上次带宽成绩抹掉，
          // 表现就是「刷新后节点只剩延迟、网速为空」
          speed: old.speed || 0,
          speedMbps: old.speedMbps || 0,
          speedBps: old.speedBps || 0,
          speedStatus: old.speedStatus || '',
          speedTime: old.speedTime || null,
          speedBytes: old.speedBytes || 0,
          speedDurationMs: old.speedDurationMs || 0,
          speedFirstByteMs: old.speedFirstByteMs || 0,
          speedUrl: old.speedUrl || '',
          speedError: old.speedError || '',
          speedHistory: Array.isArray(old.speedHistory) ? old.speedHistory : [],
          trafficUsed: old.trafficUsed || 0,
          trafficTotal: old.trafficTotal || 0,
          expireAt: old.expireAt || 0,
          trafficSource: old.trafficSource || ''
        };
        if (merged.trafficSource !== 'manual') {
          if (subUserinfo) {
            merged.trafficUsed = subUserinfo.used;
            merged.trafficTotal = subUserinfo.total;
            merged.expireAt = subUserinfo.expire;
            merged.trafficSource = 'sub';
          } else if (subManualQuota) {
            merged.trafficUsed = Number(subManualQuota.used) || 0;
            merged.trafficTotal = Number(subManualQuota.total) || 0;
            merged.expireAt = Number(subManualQuota.expire) || 0;
            merged.trafficSource = 'quota';
          }
        }
        return merged;
      }
      const fresh = { ...n, inCombinedSub: false, delayHistory: [] };
      if (subUserinfo) {
        fresh.trafficUsed = subUserinfo.used;
        fresh.trafficTotal = subUserinfo.total;
        fresh.expireAt = subUserinfo.expire;
        fresh.trafficSource = 'sub';
      } else if (subManualQuota) {
        fresh.trafficUsed = Number(subManualQuota.used) || 0;
        fresh.trafficTotal = Number(subManualQuota.total) || 0;
        fresh.expireAt = Number(subManualQuota.expire) || 0;
        fresh.trafficSource = 'quota';
      }
      return fresh;
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

const axios = require('axios');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const yaml = require('yaml');

const db = require('./db');
const tester = require('./tester');
const { parseSubscriptionContent } = require('./parser');

const FOFA_API_URL = process.env.FOFA_API_URL || 'https://fofa.info/api/v1/search/all';
const FOFA_FIELDS = ['host', 'ip', 'port', 'protocol', 'title'];
const REQUEST_TIMEOUT = Number(process.env.FOFA_REQUEST_TIMEOUT || 15000);
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024;
const MAX_TEST_NODES = 120;
const MAX_CANDIDATES = Number(process.env.FOFA_MAX_CANDIDATES || 500);
const MAX_RESULTS = 300;
const JOB_RETENTION_MS = 60 * 60 * 1000;
const jobs = new Map();

function createError(message, statusCode = 400, fatal = false) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.fatal = fatal;
  return error;
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeQueries(input) {
  const lines = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n/);
  const queries = [...new Set(lines.map(line => String(line || '').trim()).filter(Boolean))];

  if (queries.length === 0) {
    throw createError('请至少填写一条 FOFA 查询语句');
  }
  if (queries.length > 30) {
    throw createError('一次最多执行 30 条 FOFA 查询语句');
  }
  return queries;
}

function getCredentials() {
  const settings = db.getSettings();
  const email = String(settings.fofaEmail || process.env.FOFA_EMAIL || '').trim();
  const apiKey = String(settings.fofaApiKey || process.env.FOFA_API_KEY || '').trim();

  if (!email) {
    throw createError('请先在 FOFA 页面配置账号邮箱');
  }
  if (!apiKey) {
    throw createError('请先在 FOFA 页面配置 API Key');
  }
  return { email, apiKey };
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.length <= 4) return '****';
  return `****${apiKey.slice(-4)}`;
}

function getPublicConfig() {
  const settings = db.getSettings();
  const email = String(settings.fofaEmail || process.env.FOFA_EMAIL || '').trim();
  const apiKey = String(settings.fofaApiKey || process.env.FOFA_API_KEY || '').trim();

  return {
    email,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyHint: maskApiKey(apiKey),
    usingEnvironmentKey: !settings.fofaApiKey && Boolean(process.env.FOFA_API_KEY)
  };
}

function saveConfig({ email, apiKey, clearApiKey } = {}) {
  const updates = {};
  if (email !== undefined) {
    updates.fofaEmail = String(email || '').trim();
  }
  if (clearApiKey === true) {
    updates.fofaApiKey = '';
  } else if (apiKey !== undefined && String(apiKey || '').trim()) {
    updates.fofaApiKey = String(apiKey).trim();
  }
  if (Object.keys(updates).length > 0) {
    db.updateSettings(updates);
  }
  return getPublicConfig();
}

function isPublicIp(address) {
  const ip = String(address || '').trim().toLowerCase().split('%')[0];
  if (!ip) return false;

  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b, c] = parts;
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false;
    return true;
  }

  if (net.isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return false;
    if (ip.startsWith('::ffff:')) {
      return isPublicIp(ip.slice('::ffff:'.length));
    }
    if (/^f[cd]/.test(ip)) return false;
    if (/^fe[89ab]/.test(ip)) return false;
    if (/^ff/.test(ip)) return false;
    if (ip.startsWith('2001:db8:')) return false;
    return true;
  }

  return false;
}

async function resolvePublicAddresses(hostname) {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '');
  if (!host) {
    throw createError('目标地址为空');
  }

  if (net.isIP(host)) {
    if (!isPublicIp(host)) {
      throw createError(`已拦截内网或保留地址: ${host}`);
    }
    return [{ address: host, family: net.isIP(host) }];
  }

  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i.test(host)) {
    throw createError(`已拦截本地域名: ${host}`);
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw createError(`目标域名解析失败: ${error.message}`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw createError(`目标域名没有可用解析记录: ${host}`);
  }
  if (records.some(record => !isPublicIp(record.address))) {
    throw createError(`已拦截解析到内网或保留地址的域名: ${host}`);
  }
  return records;
}

function createSafeLookup() {
  return (hostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof options === 'function') {
      done = options;
      lookupOptions = {};
    }

    resolvePublicAddresses(hostname)
      .then(addresses => {
        if (lookupOptions && lookupOptions.all) {
          done(null, addresses);
          return;
        }
        done(null, addresses[0].address, addresses[0].family);
      })
      .catch(error => done(error));
  };
}

async function safeGet(rawUrl, { ignoreTlsVerify, signal, maxRedirects = 4 } = {}) {
  let currentUrl;
  try {
    currentUrl = new URL(rawUrl);
  } catch (error) {
    throw createError(`无效 URL: ${rawUrl}`);
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      throw createError(`不支持的 URL 协议: ${currentUrl.protocol}`);
    }

    const addresses = await resolvePublicAddresses(currentUrl.hostname);
    const safeLookup = createSafeLookup();
    const httpAgent = new http.Agent({ keepAlive: false, lookup: safeLookup });
    const httpsAgent = new https.Agent({
      keepAlive: false,
      lookup: safeLookup,
      rejectUnauthorized: !ignoreTlsVerify
    });

    let response;
    try {
      response = await axios.get(currentUrl.href, {
        timeout: REQUEST_TIMEOUT,
        responseType: 'text',
        transformResponse: [data => data],
        maxRedirects: 0,
        maxContentLength: MAX_CONTENT_LENGTH,
        signal,
        httpAgent,
        httpsAgent,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'ClashMeta/1.19.33 (Clash.Meta; Linux x86_64)',
          Accept: '*/*'
        }
      });
    } catch (error) {
      const status = error.response?.status ? `HTTP ${error.response.status}: ` : '';
      throw createError(`${status}${error.message}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.location;
      if (!location) {
        throw createError(`HTTP ${response.status} 重定向缺少 Location`);
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return {
      data: String(response.data || ''),
      status: response.status,
      url: currentUrl.href,
      resolvedIp: addresses[0].address
    };
  }

  throw createError('目标地址重定向次数过多');
}

function normalizeProtocol(value, port) {
  const protocol = String(value || '').toLowerCase();
  if (protocol.includes('https')) return 'https';
  if (protocol.includes('http')) return 'http';
  return Number(port) === 443 || Number(port) === 8443 ? 'https' : 'http';
}

function hostHasPort(authority) {
  if (authority.startsWith('[')) {
    return /^\[[^\]]+\]:\d+$/.test(authority);
  }
  return (authority.match(/:/g) || []).length === 1 && /:\d+$/.test(authority);
}

function buildCandidateUrls(hostValue, ipValue, portValue, protocolValue) {
  const rawHost = String(hostValue || '').trim();
  const ip = String(ipValue || '').trim();
  const port = clampInt(portValue, 0, 0, 65535);
  let authority = rawHost || ip;
  if (!authority) return [];

  let explicitProtocol = '';
  if (/^https?:\/\//i.test(authority)) {
    try {
      const parsed = new URL(authority);
      explicitProtocol = parsed.protocol.replace(':', '');
      authority = parsed.host;
    } catch (error) {
      return [];
    }
  } else {
    authority = authority.replace(/\/.*$/, '');
  }

  if (net.isIP(authority) === 6) {
    authority = `[${authority}]`;
  }
  if (!hostHasPort(authority) && port > 0) {
    authority = `${authority}:${port}`;
  }

  const primaryProtocol = explicitProtocol || normalizeProtocol(protocolValue, port);
  const protocols = explicitProtocol
    ? [explicitProtocol]
    : [...new Set([primaryProtocol, primaryProtocol === 'https' ? 'http' : 'https'])];

  return protocols.map(protocol => `${protocol}://${authority}/`);
}

function normalizeSearchRow(row, query) {
  let item;
  if (Array.isArray(row)) {
    item = Object.fromEntries(FOFA_FIELDS.map((field, index) => [field, row[index]]));
  } else {
    item = row || {};
  }

  const host = String(item.host || '').trim();
  const ip = String(item.ip || '').trim();
  const port = clampInt(item.port, 0, 0, 65535);
  const urls = buildCandidateUrls(host, ip, port, item.protocol);

  return {
    query,
    host: host || (ip && port ? `${ip}:${port}` : ip),
    ip,
    port,
    protocol: String(item.protocol || ''),
    title: String(item.title || ''),
    urls
  };
}

function normalizeManualTargets(input) {
  const lines = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n/);
  const targets = lines
    .map(line => String(line || '').trim())
    .filter(line => line && !line.startsWith('#'));

  if (targets.length === 0) {
    throw createError('请至少填写一个候选地址');
  }
  if (targets.length > MAX_CANDIDATES) {
    throw createError(`一次最多填写 ${MAX_CANDIDATES} 个候选地址`);
  }

  const candidates = [];
  const seen = new Set();
  for (const target of targets) {
    const scheme = target.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase() || '';
    if (scheme && !['http', 'https'].includes(scheme)) {
      throw createError(`候选地址仅支持 HTTP/HTTPS: ${target}`);
    }
    const hasProtocol = Boolean(scheme);
    let parsed;
    try {
      parsed = new URL(hasProtocol ? target : `http://${target}`);
    } catch (error) {
      throw createError(`候选地址格式无效: ${target}`);
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const explicitProtocol = hasProtocol ? parsed.protocol.replace(':', '') : '';
    const port = parsed.port ? Number(parsed.port) : 0;
    const path = `${parsed.pathname || '/'}${parsed.search || ''}`;
    const protocols = explicitProtocol
      ? [explicitProtocol]
      : [port === 80 ? 'http' : 'https', port === 80 ? 'https' : 'http'];
    const urls = protocols.map(protocol => `${protocol}://${parsed.host}${path}`);
    const key = urls[0];
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      query: '手动候选',
      host: parsed.host,
      ip: net.isIP(hostname) ? hostname : '',
      port,
      protocol: explicitProtocol,
      title: '',
      urls
    });
  }

  return candidates;
}

async function searchFofa(query, { email, apiKey, page, size, signal }) {
  let response;
  try {
    response = await axios.get(FOFA_API_URL, {
      timeout: REQUEST_TIMEOUT,
      signal,
      params: {
        email,
        key: apiKey,
        qbase64: Buffer.from(query, 'utf8').toString('base64'),
        page,
        size,
        fields: FOFA_FIELDS.join(',')
      },
      headers: {
        'User-Agent': 'sub-hub-fofa-scanner/1.0',
        Accept: 'application/json'
      }
    });
  } catch (error) {
    let apiData = error.response?.data;
    if (typeof apiData === 'string') {
      try {
        apiData = JSON.parse(apiData);
      } catch (parseError) {
        apiData = null;
      }
    }
    if (apiData?.error && apiData.errmsg) {
      throw createFofaApiError(apiData.errmsg);
    }
    const status = error.response?.status ? `HTTP ${error.response.status}: ` : '';
    throw createError(`FOFA API 请求失败: ${status}${error.message}`);
  }

  let data = response.data || {};
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (error) {
      throw createError('FOFA API 返回的不是有效 JSON');
    }
  }
  if (data.error) {
    throw createFofaApiError(data.errmsg);
  }
  if (!Array.isArray(data.results)) {
    throw createError('FOFA API 返回格式不正确');
  }

  return {
    total: Number(data.total || 0),
    results: data.results.map(row => normalizeSearchRow(row, query))
  };
}

function createFofaApiError(message) {
  const text = String(message || '未知错误');
  if (/820031|F\s*点余额不足|余额不足/i.test(text)) {
    return createError(
      'FOFA 账号 F 点余额不足，官方 Search API 无法执行。请充值或开通 API 额度，或切换到“手动候选地址”模式。',
      400,
      true
    );
  }
  const fatal = /-700|账号无效|key.*(无效|错误)|email.*(无效|错误)/i.test(text);
  return createError(`FOFA API 返回错误: ${text}`, 400, fatal);
}

function makeSubscriptionName(ip, port) {
  const base = `FOFA ${ip}${port ? `:${port}` : ''}`;
  const names = new Set(db.getSubscriptions().map(sub => String(sub.name || '').toLowerCase()));
  let name = base;
  let index = 2;
  while (names.has(name.toLowerCase())) {
    name = `${base} #${index++}`;
  }
  return name;
}

function mergeTestResults(nodes, results) {
  const resultMap = new Map(results.map(result => [result.id, result]));
  return nodes.map(node => {
    const result = resultMap.get(node.id);
    if (!result) return node;
    return {
      ...node,
      delay: result.delay,
      status: result.status,
      inCombinedSub: Boolean(result.inCombinedSub),
      retriesUsed: result.retriesUsed || 0,
      lastTestTime: result.lastTestTime
    };
  });
}

async function importCandidate(job, candidate, nodes, aliveCount, resultUrl, targetIp) {
  if (!job.options.autoImport) {
    return { status: 'valid', message: `验证通过，共 ${nodes.length} 节点，${aliveCount} 个可用` };
  }
  if (job.options.maxImports > 0 && job.importedCount >= job.options.maxImports) {
    return { status: 'filtered', message: `已达到本次最多导入 ${job.options.maxImports} 个订阅的限制` };
  }
  if (db.findSubscriptionByUrl(resultUrl) || db.findSubscriptionByIp(targetIp)) {
    return { status: 'duplicate', message: `IP ${targetIp} 或订阅 URL 已存在` };
  }

  const sub = db.addSubscription({
    name: makeSubscriptionName(targetIp, candidate.port),
    url: resultUrl,
    ip: targetIp,
    enabled: true,
    autoRefresh: true
  });
  db.setSubscriptionNodes(sub.id, nodes);
  const updated = db.updateSubscription(sub.id, {
    nodeCount: nodes.length,
    aliveCount,
    lastUpdate: new Date().toISOString(),
    lastStatus: 'success',
    lastMessage: `FOFA 扫描导入：共 ${nodes.length} 节点，${aliveCount} 个可用`,
    source: 'fofa',
    fofaQuery: candidate.query
  });
  job.importedCount++;
  db.addLog('info', `FOFA 扫描导入订阅 [${updated.name}]：${nodes.length} 个节点，${aliveCount} 个可用`, {
    subId: sub.id,
    sourceIp: targetIp,
    query: candidate.query
  });

  if (job.hooks.onImported) {
    job.hooks.onImported(updated);
  }
  return {
    status: 'imported',
    message: `已导入 ${nodes.length} 节点，${aliveCount} 个可用`,
    subId: sub.id
  };
}

async function checkCandidate(job, candidate) {
  const seenIps = job.seenIps;
  const reportedIp = net.isIP(candidate.ip) ? candidate.ip : '';
  if (reportedIp && !isPublicIp(reportedIp)) {
    return { status: 'blocked', message: `已拦截内网或保留地址: ${reportedIp}` };
  }
  if (reportedIp && seenIps.has(reportedIp)) {
    return { status: 'duplicate', message: `本次扫描已处理过 IP ${reportedIp}` };
  }
  if (reportedIp) {
    seenIps.add(reportedIp);
    const existing = db.findSubscriptionByIp(reportedIp);
    if (existing) {
      return { status: 'duplicate', message: `IP ${reportedIp} 已存在于订阅「${existing.name}」` };
    }
  }
  if (candidate.urls.some(url => db.findSubscriptionByUrl(url))) {
    return { status: 'duplicate', message: '该订阅 URL 已存在' };
  }

  let lastError = null;
  for (const url of candidate.urls) {
    if (job.cancelled) {
      throw createError('任务已取消', 409);
    }

    try {
      const response = await safeGet(url, {
        ignoreTlsVerify: job.ignoreTlsVerify,
        signal: job.abortController.signal
      });
      const nodes = parseSubscriptionContent(response.data, yaml);
      if (nodes.length === 0) {
        lastError = `HTTP ${response.status}，但未解析到有效节点`;
        continue;
      }

      const targetIp = reportedIp || response.resolvedIp;
      if (!isPublicIp(targetIp)) {
        return { status: 'blocked', message: `已拦截内网或保留地址: ${targetIp}` };
      }
      if (!reportedIp && seenIps.has(targetIp)) {
        return { status: 'duplicate', message: `本次扫描已处理过 IP ${targetIp}` };
      }
      if (!reportedIp) {
        seenIps.add(targetIp);
      }
      const existing = db.findSubscriptionByIp(targetIp);
      if (existing) {
        return { status: 'duplicate', message: `IP ${targetIp} 已存在于订阅「${existing.name}」` };
      }

      if (nodes.length < job.options.minNodes) {
        return {
          status: 'filtered',
          ip: targetIp,
          nodeCount: nodes.length,
          message: `节点数 ${nodes.length} 小于下限 ${job.options.minNodes}`
        };
      }
      if (job.options.maxNodes > 0 && nodes.length > job.options.maxNodes) {
        return {
          status: 'filtered',
          ip: targetIp,
          nodeCount: nodes.length,
          message: `节点数 ${nodes.length} 超过上限 ${job.options.maxNodes}`
        };
      }
      if (nodes.length > MAX_TEST_NODES) {
        return {
          status: 'filtered',
          ip: targetIp,
          nodeCount: nodes.length,
          message: `节点数 ${nodes.length} 超过单次测速上限 ${MAX_TEST_NODES}`
        };
      }

      const settings = db.getSettings();
      const results = await tester.testNodes(nodes, {
        taskId: `fofa_${job.id}_${Date.now().toString(36)}`,
        testUrl: settings.testUrl,
        timeout: settings.testTimeout,
        concurrency: Math.min(8, Math.max(1, Number(settings.testConcurrency) || 5)),
        maxRetries: 0
      });
      if (job.cancelled) {
        throw createError('任务已取消', 409);
      }

      const testedNodes = mergeTestResults(nodes, results);
      const aliveCount = testedNodes.filter(node => node.inCombinedSub).length;
      if (aliveCount < job.options.minAliveNodes) {
        return {
          status: 'filtered',
          ip: targetIp,
          nodeCount: nodes.length,
          aliveCount,
          message: `可用节点 ${aliveCount} 个，小于下限 ${job.options.minAliveNodes}`
        };
      }
      if (job.options.maxAliveNodes > 0 && aliveCount > job.options.maxAliveNodes) {
        return {
          status: 'filtered',
          ip: targetIp,
          nodeCount: nodes.length,
          aliveCount,
          message: `可用节点 ${aliveCount} 个，超过上限 ${job.options.maxAliveNodes}`
        };
      }

      const imported = await importCandidate(job, candidate, testedNodes, aliveCount, response.url, targetIp);
      return {
        ...imported,
        ip: targetIp,
        nodeCount: nodes.length,
        aliveCount,
        httpStatus: response.status
      };
    } catch (error) {
      if (job.cancelled || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        throw createError('任务已取消', 409);
      }
      lastError = error.message;
    }
  }

  return {
    status: 'unreachable',
    message: lastError || '地址不可访问或内容无法解析为订阅'
  };
}

function updateStats(job, status) {
  const keyMap = {
    imported: 'imported',
    valid: 'valid',
    duplicate: 'duplicates',
    blocked: 'blocked',
    unreachable: 'unreachable',
    invalid: 'invalid',
    filtered: 'filtered',
    failed: 'failed'
  };
  const key = keyMap[status];
  if (key) job.stats[key] = (job.stats[key] || 0) + 1;
}

function addJobResult(job, candidate, result) {
  updateStats(job, result.status);
  const entry = {
    id: `${job.id}_${job.processed + 1}`,
    url: candidate.urls[0] || candidate.host || '',
    host: candidate.host,
    query: candidate.query,
    status: result.status,
    message: result.message || '',
    ip: result.ip || candidate.ip || '',
    nodeCount: result.nodeCount || 0,
    aliveCount: result.aliveCount || 0,
    httpStatus: result.httpStatus || null,
    subId: result.subId || null,
    time: new Date().toISOString()
  };
  job.results.push(entry);
  if (job.results.length > MAX_RESULTS) {
    job.results.shift();
    job.resultsTruncated = true;
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    totalCandidates: job.totalCandidates,
    processedCandidates: job.processed,
    stats: { ...job.stats },
    queryErrors: [...job.queryErrors],
    results: [...job.results],
    resultsTruncated: job.resultsTruncated,
    candidateLimitReached: job.candidateLimitReached,
    options: { ...job.options }
  };
}

function notify(job, type = 'progress') {
  const snapshot = publicJob(job);
  if (job.hooks.onProgress) {
    try {
      job.hooks.onProgress(snapshot);
    } catch (error) {}
  }
  if (type === 'completed' && job.hooks.onCompleted) {
    try {
      job.hooks.onCompleted(snapshot);
    } catch (error) {}
  }
}

async function runJob(job) {
  job.status = 'running';
  job.phase = job.mode === 'manual' ? 'checking' : 'searching';
  job.startedAt = new Date().toISOString();
  notify(job);

  try {
    let candidates = [];
    if (job.mode === 'manual') {
      candidates = job.manualCandidates;
    } else {
      const credentials = getCredentials();
      const candidateKeys = new Set();

      searchLoop:
      for (const query of job.queries) {
        if (job.cancelled) throw createError('任务已取消', 409);
        for (let page = 1; page <= job.options.maxPages; page++) {
          let pageResult;
          try {
            pageResult = await searchFofa(query, {
              ...credentials,
              page,
              size: job.options.pageSize,
              signal: job.abortController.signal
            });
          } catch (error) {
            if (job.cancelled || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
              throw createError('任务已取消', 409);
            }
            if (error.fatal) throw error;
            job.queryErrors.push({ query, message: error.message });
            break;
          }

          job.stats.searchedResults += pageResult.results.length;
          for (const candidate of pageResult.results) {
            const key = [
              candidate.ip || '',
              candidate.host || '',
              candidate.port || '',
              candidate.urls[0] || ''
            ].join('|');
            if (candidateKeys.has(key)) continue;
            if (candidates.length >= MAX_CANDIDATES) {
              job.candidateLimitReached = true;
              break searchLoop;
            }
            candidateKeys.add(key);
            candidates.push(candidate);
          }

          notify(job);
          if (pageResult.results.length < job.options.pageSize || pageResult.total <= page * job.options.pageSize) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    }

    job.totalCandidates = candidates.length;
    job.phase = 'checking';
    notify(job);

    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        if (job.cancelled) return;
        const candidate = candidates[cursor++];
        let result;
        try {
          result = await checkCandidate(job, candidate);
        } catch (error) {
          if (job.cancelled || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
            return;
          }
          result = { status: 'failed', message: error.message };
        }
        addJobResult(job, candidate, result);
        job.processed++;
        notify(job);
      }
    };

    const workerCount = Math.min(job.options.concurrency, Math.max(1, candidates.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (job.cancelled) {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.error = '任务已取消';
    } else {
      job.status = 'completed';
      job.phase = 'completed';
    }
  } catch (error) {
    if (job.cancelled || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.error = '任务已取消';
    } else {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = error.message;
    }
  } finally {
    job.finishedAt = new Date().toISOString();
    notify(job, 'completed');
  }
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && now - new Date(job.finishedAt).getTime() > JOB_RETENTION_MS) {
      jobs.delete(id);
    }
  }
}

function startScan(input = {}, hooks = {}) {
  cleanupJobs();
  const mode = input.mode === 'manual' ? 'manual' : 'api';
  const queries = mode === 'api' ? normalizeQueries(input.queries) : [];
  const manualCandidates = mode === 'manual'
    ? normalizeManualTargets(input.manualTargets)
    : [];
  const options = {
    pageSize: clampInt(input.pageSize, 20, 1, 100),
    maxPages: clampInt(input.maxPages, 1, 1, 10),
    minNodes: clampInt(input.minNodes, 1, 0, 10000),
    maxNodes: clampInt(input.maxNodes, 0, 0, 10000),
    minAliveNodes: clampInt(input.minAliveNodes, 1, 0, 10000),
    maxAliveNodes: clampInt(input.maxAliveNodes, 0, 0, 10000),
    maxImports: clampInt(input.maxImports, 10, 0, 1000),
    concurrency: clampInt(input.concurrency, 2, 1, 6),
    autoImport: input.autoImport !== false
  };

  if (options.maxNodes > 0 && options.minNodes > options.maxNodes) {
    throw createError('最少节点数不能大于最多节点数');
  }
  if (options.maxAliveNodes > 0 && options.minAliveNodes > options.maxAliveNodes) {
    throw createError('最少可用节点数不能大于最多可用节点数');
  }
  if (mode === 'api') {
    getCredentials();
  }

  const id = `fofa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const settings = db.getSettings();
  const job = {
    id,
    mode,
    status: 'queued',
    phase: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    cancelled: false,
    abortController: new AbortController(),
    queries,
    manualCandidates,
    options,
    ignoreTlsVerify: settings.ignoreTlsVerify !== false,
    hooks,
    totalCandidates: 0,
    processed: 0,
    importedCount: 0,
    stats: {
      searchedResults: 0,
      imported: 0,
      valid: 0,
      duplicates: 0,
      blocked: 0,
      unreachable: 0,
      invalid: 0,
      filtered: 0,
      failed: 0
    },
    queryErrors: [],
    candidateLimitReached: false,
    results: [],
    resultsTruncated: false,
    seenIps: new Set()
  };
  jobs.set(id, job);
  setImmediate(() => runJob(job));
  return publicJob(job);
}

function getJob(id) {
  cleanupJobs();
  return publicJob(jobs.get(id));
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (!job.finishedAt) {
    job.cancelled = true;
    job.abortController.abort();
    job.status = 'cancelling';
    job.phase = 'cancelling';
    notify(job);
  }
  return publicJob(job);
}

module.exports = {
  getPublicConfig,
  saveConfig,
  startScan,
  getJob,
  cancelJob,
  isPublicIp
};

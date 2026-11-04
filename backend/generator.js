const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Rule-providers definitions based on Loyalsoldier/clash-rules
const DEFAULT_LOYAL_RULE_PROVIDERS = (baseUrl) => ({
  reject: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/reject.txt`,
    path: './ruleset/reject.yaml',
    interval: 86400
  },
  icloud: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/icloud.txt`,
    path: './ruleset/icloud.yaml',
    interval: 86400
  },
  apple: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/apple.txt`,
    path: './ruleset/apple.yaml',
    interval: 86400
  },
  google: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/google.txt`,
    path: './ruleset/google.yaml',
    interval: 86400
  },
  proxy: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/proxy.txt`,
    path: './ruleset/proxy.yaml',
    interval: 86400
  },
  direct: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/direct.txt`,
    path: './ruleset/direct.yaml',
    interval: 86400
  },
  private: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/private.txt`,
    path: './ruleset/private.yaml',
    interval: 86400
  },
  gfw: {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/gfw.txt`,
    path: './ruleset/gfw.yaml',
    interval: 86400
  },
  'tld-not-cn': {
    type: 'http',
    behavior: 'domain',
    url: `${baseUrl}/tld-not-cn.txt`,
    path: './ruleset/tld-not-cn.yaml',
    interval: 86400
  },
  telegramcidr: {
    type: 'http',
    behavior: 'ipcidr',
    url: `${baseUrl}/telegramcidr.txt`,
    path: './ruleset/telegramcidr.yaml',
    interval: 86400
  },
  cncidr: {
    type: 'http',
    behavior: 'ipcidr',
    url: `${baseUrl}/cncidr.txt`,
    path: './ruleset/cncidr.yaml',
    interval: 86400
  },
  lancidr: {
    type: 'http',
    behavior: 'ipcidr',
    url: `${baseUrl}/lancidr.txt`,
    path: './ruleset/lancidr.yaml',
    interval: 86400
  },
  applications: {
    type: 'http',
    behavior: 'classical',
    url: `${baseUrl}/applications.txt`,
    path: './ruleset/applications.yaml',
    interval: 86400
  }
});

const DEFAULT_LOYAL_RULES = [
  'RULE-SET,applications,DIRECT',
  'RULE-SET,private,DIRECT',
  'RULE-SET,reject,REJECT',
  'RULE-SET,icloud,DIRECT',
  'RULE-SET,apple,DIRECT',
  'RULE-SET,google,PROXY',
  'RULE-SET,proxy,PROXY',
  'RULE-SET,direct,DIRECT',
  'RULE-SET,lancidr,DIRECT,no-resolve',
  'RULE-SET,cncidr,DIRECT,no-resolve',
  'RULE-SET,telegramcidr,PROXY,no-resolve',
  'GEOIP,LAN,DIRECT,no-resolve',
  'GEOIP,CN,DIRECT,no-resolve',
  'MATCH,漏网之鱼'
];

/**
 * Filter nodes according to profile policy
 */
function filterNodes(nodes, profile) {
  let result = [...nodes];

  // 0. Only include nodes that are flagged as inCombinedSub (默认只纳入整合状态为 true 的节点)
  if (profile.onlyCombinedSub !== false) {
    result = result.filter(n => n.inCombinedSub === true);
  }

  // 1. Only alive filter
  if (profile.onlyAlive) {
    result = result.filter(n => n.delay && n.delay > 0);
  }

  // 2. Max delay filter
  if (profile.maxDelay && profile.maxDelay > 0) {
    result = result.filter(n => n.delay && n.delay > 0 && n.delay <= profile.maxDelay);
  }

  // 3. Protocol filter
  if (profile.protocolFilter && profile.protocolFilter.length > 0) {
    result = result.filter(n => profile.protocolFilter.includes(n.type));
  }

  // 4. Keyword include
  if (profile.keywordInclude && profile.keywordInclude.trim()) {
    const kwList = profile.keywordInclude.split('|').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (kwList.length > 0) {
      result = result.filter(n => {
        const name = (n.name || '').toLowerCase();
        return kwList.some(k => name.includes(k));
      });
    }
  }

  // 5. Keyword exclude
  if (profile.keywordExclude && profile.keywordExclude.trim()) {
    const kwList = profile.keywordExclude.split('|').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (kwList.length > 0) {
      result = result.filter(n => {
        const name = (n.name || '').toLowerCase();
        return !kwList.some(k => name.includes(k));
      });
    }
  }

  return result;
}

/**
 * Ensure proxy names are strictly unique to avoid Clash parser rejection
 */
function ensureUniqueProxyNames(nodes) {
  const nameCount = new Map();
  return nodes.map(n => {
    let name = (n.name || 'Proxy').trim();
    if (!nameCount.has(name)) {
      nameCount.set(name, 1);
      return { ...n, name };
    } else {
      const count = nameCount.get(name) + 1;
      nameCount.set(name, count);
      return { ...n, name: `${name} (${count})` };
    }
  });
}

/**
 * Generate full Clash/Mihomo YAML subscription
 */
function generateClashSubscription(rawNodes, profile = {}) {
  const nodes = ensureUniqueProxyNames(rawNodes);
  const proxyNames = nodes.map(n => n.name);

  // Fallback if no proxies
  if (proxyNames.length === 0) {
    proxyNames.push('DIRECT');
  }

  const cleanProxies = nodes.map(n => {
    const p = { ...n };
    delete p.id;
    delete p.subId;
    delete p.delay;
    delete p.status;
    delete p.lastTestTime;
    delete p.createTime;
    delete p.checked;
    if (p.port) p.port = parseInt(p.port, 10);
    if (p.alterId !== undefined) p.alterId = parseInt(p.alterId, 10);
    return p;
  });

  const baseUrl = (profile.ruleProviderUrl || 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release').replace(/\/+$/, '');

  const proxyGroups = [
    {
      name: 'PROXY',
      type: 'select',
      proxies: ['自动选择', '故障转移', '负载均衡', 'DIRECT', ...proxyNames]
    },
    {
      name: '自动选择',
      type: 'url-test',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      tolerance: 50,
      proxies: [...proxyNames]
    },
    {
      name: '故障转移',
      type: 'fallback',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      proxies: [...proxyNames]
    },
    {
      name: '负载均衡',
      type: 'load-balance',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      strategy: 'consistent-hashing',
      proxies: [...proxyNames]
    },
    {
      name: '漏网之鱼',
      type: 'select',
      proxies: ['PROXY', 'DIRECT']
    }
  ];

  const config = {
    port: 7890,
    'socks-port': 7891,
    'mixed-port': 7892,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    dns: {
      enable: true,
      ipv6: false,
      'default-nameserver': ['223.5.5.5', '119.29.29.29'],
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      nameserver: [
        'https://doh.pub/dns-query',
        'https://dns.alidns.com/dns-query'
      ],
      fallback: [
        'https://doh.dns.sb/dns-query',
        'https://dns.cloudflare.com/dns-query',
        'https://dns.google/dns-query'
      ],
      'fallback-filter': {
        geoip: true,
        ipcidr: ['240.0.0.0/4', '0.0.0.0/32']
      }
    },
    proxies: cleanProxies,
    'proxy-groups': proxyGroups
  };

  if (profile.enableLoyalRules !== false) {
    config['rule-providers'] = DEFAULT_LOYAL_RULE_PROVIDERS(baseUrl);
    config.rules = DEFAULT_LOYAL_RULES;
  } else {
    config.rules = [
      'MATCH,PROXY'
    ];
  }

  // 自定义规则/策略组覆盖（backend/custom-generator.js 或 data/generator-override.js）
  const custom = loadCustomConfig();
  if (custom) {
    if (typeof custom.buildProxyGroups === 'function') {
      const customGroups = custom.buildProxyGroups(proxyNames);
      if (Array.isArray(customGroups) && customGroups.length > 0) {
        proxyGroups.splice(0, proxyGroups.length, ...customGroups);
        config['proxy-groups'] = proxyGroups;
      }
    }
    if (Array.isArray(custom.rules) && custom.rules.length > 0) {
      config.rules = custom.rules;
    }
    if (custom.ruleProviders && typeof custom.ruleProviders === 'object') {
      config['rule-providers'] = custom.ruleProviders;
    }
    if (custom.dns && typeof custom.dns === 'object') {
      config.dns = custom.dns;
    }
    if (custom.extraConfig && typeof custom.extraConfig === 'object') {
      Object.assign(config, custom.extraConfig);
      if (custom.extraConfig['mixed-port']) {
        delete config.port;
        delete config['socks-port'];
      }
    }
  }

  return yaml.stringify(config);
}

/**
 * Generate Base64 plain nodes subscription (for v2rayN, Shadowrocket, etc.)
 */
function generateBase64Subscription(nodes) {
  const lines = [];

  for (const node of nodes) {
    try {
      if (node.type === 'ss') {
        const userinfo = Buffer.from(`${node.cipher}:${node.password}`).toString('base64');
        const encodedName = encodeURIComponent(node.name || 'SS');
        lines.push(`ss://${userinfo}@${node.server}:${node.port}#${encodedName}`);
      } else if (node.type === 'vmess') {
        const vmessObj = {
          v: '2',
          ps: node.name,
          add: node.server,
          port: node.port,
          id: node.uuid,
          aid: node.alterId || 0,
          scy: node.cipher || 'auto',
          net: node.network || 'tcp',
          type: 'none',
          host: node['ws-opts']?.headers?.Host || '',
          path: node['ws-opts']?.path || '',
          tls: node.tls ? 'tls' : '',
          sni: node.servername || ''
        };
        lines.push(`vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`);
      } else if (node.type === 'trojan') {
        const params = new URLSearchParams();
        if (node.sni) params.set('sni', node.sni);
        if (node.network) params.set('type', node.network);
        lines.push(`trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(node.name)}`);
      } else if (node.type === 'vless') {
        const params = new URLSearchParams();
        if (node.tls) params.set('security', node['reality-opts'] ? 'reality' : 'tls');
        if (node.flow) params.set('flow', node.flow);
        if (node.network) params.set('type', node.network);
        if (node['ws-opts']?.path) params.set('path', node['ws-opts'].path);
        if (node['ws-opts']?.headers?.Host) params.set('host', node['ws-opts'].headers.Host);
        if (node['reality-opts']?.['public-key']) params.set('pbk', node['reality-opts']['public-key']);
        if (node['reality-opts']?.['short-id']) params.set('sid', node['reality-opts']['short-id']);
        if (node.servername) params.set('sni', node.servername);
        lines.push(`vless://${node.uuid}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(node.name)}`);
      } else if (node.type === 'hysteria2') {
        const params = new URLSearchParams();
        if (node.sni) params.set('sni', node.sni);
        if (node.obfs) params.set('obfs', node.obfs);
        if (node['obfs-password']) params.set('obfs-password', node['obfs-password']);
        lines.push(`hy2://${encodeURIComponent(node.password || node.auth)}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(node.name)}`);
      }
    } catch (e) {}
  }

  return Buffer.from(lines.join('\n')).toString('base64');
}

// ===== 远程规则配置（rule fork 的 overwrite.yaml，分支 sub-hub）=====
const REMOTE_RULE_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/vincent-jia253/rule/sub-hub/config/mihomo/config/overwrite.yaml';
let cachedRemoteConfig = null;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function yamlToCustomConfig(raw) {
  const doc = yaml.parse(raw);
  if (!doc || typeof doc !== 'object') return null;
  const extra = {};
  const extraKeys = ['mixed-port','allow-lan','bind-address','ipv6','unified-delay','tcp-concurrent','log-level','keep-alive-idle','keep-alive-interval','profile','external-controller','secret','external-ui','external-ui-url','tun','sniffer'];
  for (const k of extraKeys) if (doc[k] !== undefined) extra[k] = doc[k];
  return {
    buildProxyGroups: () => (Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : []),
    rules: Array.isArray(doc.rules) ? doc.rules : [],
    ruleProviders: doc['rule-providers'] || {},
    dns: doc.dns || {},
    extraConfig: extra
  };
}

async function refreshCustomConfig() {
  try {
    const raw = await httpGet(REMOTE_RULE_URL);
    const cfg = yamlToCustomConfig(raw);
    if (cfg) {
      cachedRemoteConfig = cfg;
      console.log('[custom] 远程规则配置已加载');
    }
  } catch (e) {
    console.error('[custom] 拉取远程规则失败:', e.message);
  }
}

refreshCustomConfig();
setInterval(refreshCustomConfig, 6 * 3600 * 1000);

/**
 * Load custom generator override: backend/custom-generator.js 优先, 回退 data/generator-override.js
 */
function loadCustomConfig() {
  if (cachedRemoteConfig) return cachedRemoteConfig;
  const candidates = [
    path.join(__dirname, 'custom-generator.js'),
    path.join(__dirname, '..', 'data', 'generator-override.js')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return require(file);
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

module.exports = {
  filterNodes,
  generateClashSubscription,
  generateBase64Subscription
};

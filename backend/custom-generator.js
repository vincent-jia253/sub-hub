// sub-hub 自定义规则与策略组覆盖 (基于「大杂烩」配置)
// generator.js 优先读取 backend/custom-generator.js, 不存在时回退 data/generator-override.js

const META_RULES_BASE = 'https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta';

function mrs(name, kind) {
  const behavior = kind === 'geoip' ? 'ipcidr' : 'domain';
  // 唯一文件名：geosite/google 与 geoip/google 必须分开，否则同目录互相覆盖
  const file = `${kind}-${name}.mrs`;
  return {
    type: 'http',
    format: 'mrs',
    behavior,
    url: `${META_RULES_BASE}/${kind}/${name}.mrs`,
    path: `./ruleset/${file}`,
    interval: 86400
  };
}

const ruleProviders = {
  'category-ai-!cn': mrs('category-ai-!cn', 'geosite'),
  youtube: mrs('youtube', 'geosite'),
  google: mrs('google', 'geosite'),
  'geolocation-cn': mrs('geolocation-cn', 'geosite'),
  cn: mrs('cn', 'geosite'),
  github: mrs('github', 'geosite'),
  gitlab: mrs('gitlab', 'geosite'),
  facebook: mrs('facebook', 'geosite'),
  instagram: mrs('instagram', 'geosite'),
  twitter: mrs('twitter', 'geosite'),
  tiktok: mrs('tiktok', 'geosite'),
  linkedin: mrs('linkedin', 'geosite'),
  steam: mrs('steam', 'geosite'),
  epicgames: mrs('epicgames', 'geosite'),
  ea: mrs('ea', 'geosite'),
  ubisoft: mrs('ubisoft', 'geosite'),
  blizzard: mrs('blizzard', 'geosite'),
  'geolocation-!cn': mrs('geolocation-!cn', 'geosite'),
  'google-ip': mrs('google', 'geoip'),
  'private-ip': mrs('private', 'geoip'),
  'cn-ip': mrs('cn', 'geoip'),
  'telegram-ip': mrs('telegram', 'geoip')
};

const rules = [
  'RULE-SET,category-ai-!cn,💬 AI 服务',
  'RULE-SET,youtube,📹 油管视频',
  'RULE-SET,google,🔍 谷歌服务',
  'RULE-SET,geolocation-cn,🔒 国内服务',
  'RULE-SET,cn,🔒 国内服务',
  'RULE-SET,github,🐱 Github',
  'RULE-SET,gitlab,🐱 Github',
  'RULE-SET,facebook,🌐 社交媒体',
  'RULE-SET,instagram,🌐 社交媒体',
  'RULE-SET,twitter,🌐 社交媒体',
  'RULE-SET,tiktok,🌐 社交媒体',
  'RULE-SET,linkedin,🌐 社交媒体',
  'RULE-SET,steam,🎮 游戏平台',
  'RULE-SET,epicgames,🎮 游戏平台',
  'RULE-SET,ea,🎮 游戏平台',
  'RULE-SET,ubisoft,🎮 游戏平台',
  'RULE-SET,blizzard,🎮 游戏平台',
  'RULE-SET,geolocation-!cn,🌐 非中国',
  'RULE-SET,google-ip,🔍 谷歌服务,no-resolve',
  'RULE-SET,private-ip,🏠 私有网络,no-resolve',
  'RULE-SET,cn-ip,🔒 国内服务,no-resolve',
  'RULE-SET,telegram-ip,📲 电报消息,no-resolve',
  'MATCH,🐟 漏网之鱼'
];

// 自动选择(url-test)分组里排除的节点名(精确匹配)
// 名单来自本地私有文件 data/auto-select-exclude.json（已 gitignore，不随仓库分发），
// 这样公开代码里不需要出现任何机场/节点名称。
const { getAutoSelectExclude } = require('./local-overrides');

function buildProxyGroups(proxyNames) {
  const nodes = (proxyNames && proxyNames.length) ? proxyNames : ['DIRECT'];
  const autoNodes = nodes.filter(n => !getAutoSelectExclude().includes(n));
  const TEST_URL = 'https://www.gstatic.com/generate_204';

  const sel = (name) => ({
    name,
    type: 'select',
    proxies: ['🚀 节点选择', ...nodes, 'DIRECT', 'REJECT']
  });
  const selDirect = (name) => ({
    name,
    type: 'select',
    proxies: ['DIRECT', '🚀 节点选择', ...nodes, 'REJECT']
  });

  return [
    { name: '🚀 节点选择', type: 'select', proxies: ['⚡ 自动选择', ...nodes, 'DIRECT', 'REJECT'] },
    { name: '⚡ 自动选择', type: 'url-test', url: TEST_URL, interval: 300, tolerance: 50, proxies: [...autoNodes] },
    sel('💬 AI 服务'),
    sel('📹 油管视频'),
    sel('🔍 谷歌服务'),
    selDirect('🏠 私有网络'),
    selDirect('🔒 国内服务'),
    sel('📲 电报消息'),
    sel('🐱 Github'),
    sel('🌐 社交媒体'),
    sel('🎮 游戏平台'),
    sel('🌐 非中国'),
    { name: '🐟 漏网之鱼', type: 'select', proxies: ['🚀 节点选择', 'DIRECT', 'REJECT'] }
  ];
}

const dns = {
  enable: true,
  ipv6: true,
  'respect-rules': true,
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  nameserver: [
    'https://120.53.53.53/dns-query',
    'https://223.5.5.5/dns-query'
  ],
  'proxy-server-nameserver': [
    'https://120.53.53.53/dns-query',
    'https://223.5.5.5/dns-query'
  ],
  'nameserver-policy': {
    'geosite:cn,private': [
      'https://120.53.53.53/dns-query',
      'https://223.5.5.5/dns-query'
    ],
    'geosite:geolocation-!cn': [
      'https://dns.cloudflare.com/dns-query',
      'https://dns.google/dns-query'
    ]
  }
};

const extraConfig = {
  'geodata-mode': true,
  'geo-auto-update': true,
  'geodata-loader': 'standard',
  'geo-update-interval': 24,
  'geox-url': {
    geoip: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat',
    geosite: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat',
    mmdb: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb',
    asn: 'https://github.com/xishang0128/geoip/releases/download/latest/GeoLite2-ASN.mmdb'
  }
};

module.exports = {
  ruleProviders,
  rules,
  buildProxyGroups,
  dns,
  extraConfig,
  // 兼容旧调用方：动态读取本地私有排除名单
  get AUTO_SELECT_EXCLUDE() { return getAutoSelectExclude(); }
};

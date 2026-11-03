const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const BACKUP_FILE = path.join(DATA_DIR, 'database.backup.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DB = {
  user: {
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123456', 10),
    jwtSecret: 'sub_secret_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
  },
  settings: {
    mihomoPath: '', // Auto-detected
    testUrl: 'http://www.gstatic.com/generate_204',
    testTimeout: 5000,
    testConcurrency: 15,
    autoRefreshEnabled: true,
    autoRefreshInterval: '0 */6 * * *', // Default every 6 hours
    autoTestAfterRefresh: true,
    autoFilterFailed: false,
    ignoreTlsVerify: true,
    cdnProvider: 'github', // 'github', 'jsdelivr', 'fastly'
    fofaEmail: '',
    fofaApiKey: ''
  },
  subscriptions: [],
  nodes: [],
  profiles: [
    {
      id: 'default-profile',
      name: '主力整合订阅 (Loyalsoldier 完整分流)',
      token: 'sub_' + Math.random().toString(36).substring(2, 10),
      enabled: true,
      subIds: [], // Empty means all enabled subscriptions
      onlyAlive: false,
      maxDelay: 0,
      protocolFilter: [],
      keywordInclude: '',
      keywordExclude: '',
      enableLoyalRules: true,
      ruleProviderUrl: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release',
      createTime: new Date().toISOString()
    }
  ],
  logs: []
};

class Database {
  constructor() {
    this.data = this.load();
    this.ensureSubscriptionIps();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_DB,
          ...parsed,
          settings: { ...DEFAULT_DB.settings, ...(parsed.settings || {}) }
        };
      }
    } catch (err) {
      console.error('[DB] Failed to load database file, attempting backup:', err.message);
      if (fs.existsSync(BACKUP_FILE)) {
        try {
          const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
          return JSON.parse(raw);
        } catch (bErr) {
          console.error('[DB] Backup also failed:', bErr.message);
        }
      }
    }
    const initial = JSON.parse(JSON.stringify(DEFAULT_DB));
    this.save(initial);
    return initial;
  }

  save(data = this.data) {
    try {
      const serialized = JSON.stringify(data, null, 2);
      const tempFile = DB_FILE + '.tmp';
      fs.writeFileSync(tempFile, serialized, 'utf8');
      if (fs.existsSync(DB_FILE)) {
        try {
          fs.copyFileSync(DB_FILE, BACKUP_FILE);
        } catch (e) {}
      }
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error('[DB] Save error:', err.message);
    }
  }

  // --- Auth & User ---
  getUser() {
    return {
      username: this.data.user.username,
      hasDefaultPassword: bcrypt.compareSync('admin123456', this.data.user.passwordHash)
    };
  }

  verifyPassword(password) {
    return bcrypt.compareSync(password, this.data.user.passwordHash);
  }

  updatePassword(newPassword) {
    this.data.user.passwordHash = bcrypt.hashSync(newPassword, 10);
    this.save();
    return true;
  }

  updateUsername(newUsername) {
    this.data.user.username = newUsername;
    this.save();
    return true;
  }

  // --- Full Configuration Import & Export ---
  exportFullConfig() {
    const { fofaApiKey, ...safeSettings } = this.data.settings;
    return {
      version: '1.0.0',
      exportTime: new Date().toISOString(),
      subscriptions: this.data.subscriptions,
      nodes: this.data.nodes,
      profiles: this.data.profiles,
      settings: safeSettings
    };
  }

  importFullConfig(configData, mode = 'merge') {
    if (!configData || typeof configData !== 'object') {
      throw new Error('无效的配置文件格式');
    }

    if (mode === 'overwrite') {
      // 覆盖导入：保留管理员密码和日志，其余全部覆盖
      if (Array.isArray(configData.subscriptions)) {
        this.data.subscriptions = configData.subscriptions;
      }
      if (Array.isArray(configData.nodes)) {
        this.data.nodes = configData.nodes;
      }
      if (Array.isArray(configData.profiles)) {
        this.data.profiles = configData.profiles;
      }
      if (configData.settings && typeof configData.settings === 'object') {
        const { fofaApiKey, ...safeSettings } = configData.settings;
        this.data.settings = { ...this.data.settings, ...safeSettings };
      }
    } else {
      // 合并导入 (默认)：去重合并订阅、节点和聚合配置（优先按订阅IP去重）
      if (Array.isArray(configData.subscriptions)) {
        const existingIps = new Set(
          this.data.subscriptions
            .map(s => (s.ip || this.extractHostFromUrl(s.url) || '').trim().toLowerCase())
            .filter(Boolean)
        );
        const existingUrls = new Set(this.data.subscriptions.map(s => (s.url || '').trim().toLowerCase()));
        configData.subscriptions.forEach(sub => {
          const subIp = (sub.ip || this.extractHostFromUrl(sub.url) || '').trim().toLowerCase();
          const u = (sub.url || '').trim().toLowerCase();
          const isDup = (subIp && existingIps.has(subIp)) || existingUrls.has(u);
          if (!isDup) {
            if (subIp) existingIps.add(subIp);
            if (u) existingUrls.add(u);
            if (!sub.ip && subIp) sub.ip = subIp;
            this.data.subscriptions.push(sub);
          }
        });
      }

      if (Array.isArray(configData.nodes)) {
        const existingNodeKeys = new Set(this.data.nodes.map(n => `${n.server}:${n.port}:${n.type}:${n.uuid || n.password || ''}`));
        configData.nodes.forEach(node => {
          const key = `${node.server}:${node.port}:${node.type}:${node.uuid || node.password || ''}`;
          if (!existingNodeKeys.has(key)) {
            existingNodeKeys.add(key);
            this.data.nodes.push(node);
          }
        });
      }

      if (Array.isArray(configData.profiles)) {
        const existingProfileNames = new Set(this.data.profiles.map(p => p.name));
        configData.profiles.forEach(prof => {
          if (!existingProfileNames.has(prof.name)) {
            existingProfileNames.add(prof.name);
            this.data.profiles.push(prof);
          }
        });
      }

      if (configData.settings && typeof configData.settings === 'object') {
        const { fofaApiKey, ...safeSettings } = configData.settings;
        this.data.settings = { ...this.data.settings, ...safeSettings };
      }
    }

    this.save();
    return {
      totalSubs: this.data.subscriptions.length,
      totalNodes: this.data.nodes.length,
      totalProfiles: this.data.profiles.length
    };
  }

  getJwtSecret() {
    return this.data.user.jwtSecret;
  }

  // --- Settings ---
  getSettings() {
    return this.data.settings;
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  // --- Subscriptions ---
  extractHostFromUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let str = rawUrl.trim();
    if (!/^https?:\/\//i.test(str)) {
      str = 'http://' + str;
    }
    try {
      const u = new URL(str);
      let host = u.hostname;
      if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
      }
      return host;
    } catch (e) {
      const m = rawUrl.match(/(?:https?:\/\/)?\[?([a-zA-Z0-9.\-_:]+)\]?(?::\d+)?/);
      if (m && m[1]) {
        return m[1].split(':')[0];
      }
      return '';
    }
  }

  async resolveSubscriptionIp(rawUrl) {
    const host = this.extractHostFromUrl(rawUrl);
    if (!host) return '';
    if (net.isIP(host)) {
      return host;
    }
    try {
      const lookupPromise = dns.lookup(host);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timeout')), 2500)
      );
      const res = await Promise.race([lookupPromise, timeoutPromise]);
      if (res && res.address) {
        return res.address;
      }
    } catch (err) {
      // Fallback to host if resolution fails
      return host;
    }
    return host;
  }

  ensureSubscriptionIps() {
    if (Array.isArray(this.data.subscriptions)) {
      let syncChanged = false;
      this.data.subscriptions.forEach(s => {
        if (!s.ip && s.url) {
          s.ip = this.extractHostFromUrl(s.url);
          syncChanged = true;
        }
      });
      if (syncChanged) this.save();
    }

    // Background asynchronous DNS resolution for domains without IP
    setTimeout(async () => {
      let changed = false;
      for (const s of (this.data.subscriptions || [])) {
        if (s.url && (!s.ip || !net.isIP(s.ip))) {
          try {
            const resolved = await this.resolveSubscriptionIp(s.url);
            if (resolved && resolved !== s.ip) {
              s.ip = resolved;
              changed = true;
            }
          } catch (e) {}
        }
      }
      if (changed) this.save();
    }, 1500);
  }

  getSubscriptions() {
    return this.data.subscriptions;
  }

  getSubscription(id) {
    return this.data.subscriptions.find(s => s.id === id);
  }

  findSubscriptionByUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const cleanUrl = rawUrl.trim().toLowerCase();
    return this.data.subscriptions.find(s => s.url && s.url.trim().toLowerCase() === cleanUrl);
  }

  findSubscriptionByIp(targetIp) {
    if (!targetIp || typeof targetIp !== 'string') return null;
    const cleanIp = targetIp.trim().toLowerCase();
    return this.data.subscriptions.find(s => {
      const sIp = (s.ip || this.extractHostFromUrl(s.url) || '').trim().toLowerCase();
      return sIp === cleanIp;
    });
  }

  getNextSubName() {
    const existingNames = new Set(this.data.subscriptions.map(s => (s.name || '').trim().toLowerCase()));
    let maxNum = 0;
    this.data.subscriptions.forEach(s => {
      const match = (s.name || '').trim().match(/^sub-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    let nextNum = maxNum + 1;
    while (existingNames.has(`sub-${nextNum}`.toLowerCase())) {
      nextNum++;
    }
    return `sub-${nextNum}`;
  }

  addSubscription(sub) {
    const id = sub.id || 'sub_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const finalName = (sub.name && sub.name.trim()) ? sub.name.trim() : this.getNextSubName();
    const targetIp = sub.ip || this.extractHostFromUrl(sub.url) || '';
    const newSub = {
      id,
      name: finalName,
      url: (sub.url || '').trim(),
      ip: targetIp,
      enabled: sub.enabled !== false,
      autoRefresh: sub.autoRefresh !== false,
      intervalHours: sub.intervalHours || 6,
      nodeCount: 0,
      lastUpdate: null,
      lastStatus: 'pending',
      lastMessage: '',
      createTime: new Date().toISOString()
    };
    this.data.subscriptions.push(newSub);
    this.save();
    return newSub;
  }

  updateSubscription(id, updates) {
    const idx = this.data.subscriptions.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.data.subscriptions[idx] = { ...this.data.subscriptions[idx], ...updates };
    this.save();
    return this.data.subscriptions[idx];
  }

  deleteSubscription(id, deleteAssociatedNodes = true) {
    const idx = this.data.subscriptions.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.data.subscriptions.splice(idx, 1);
    if (deleteAssociatedNodes) {
      this.data.nodes = this.data.nodes.filter(n => n.subId !== id);
    }
    this.save();
    return true;
  }

  // --- Nodes ---
  getNodes(filter = {}) {
    let list = [...this.data.nodes];
    if (filter.subId) {
      list = list.filter(n => n.subId === filter.subId);
    }
    if (filter.protocol) {
      list = list.filter(n => n.type === filter.protocol);
    }
    if (filter.status) {
      if (filter.status === 'alive') list = list.filter(n => n.delay && n.delay > 0);
      else if (filter.status === 'failed') list = list.filter(n => n.delay === -1 || n.status === 'failed');
      else if (filter.status === 'untested') list = list.filter(n => !n.delay || n.delay === 0);
    }
    if (filter.inCombinedSub !== undefined && filter.inCombinedSub !== '') {
      const wantIn = filter.inCombinedSub === true || filter.inCombinedSub === 'true';
      list = list.filter(n => Boolean(n.inCombinedSub) === wantIn);
    }
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      list = list.filter(n =>
        (n.name && n.name.toLowerCase().includes(kw)) ||
        (n.server && n.server.toLowerCase().includes(kw))
      );
    }
    return list;
  }

  getNode(id) {
    return this.data.nodes.find(n => n.id === id);
  }

  setSubscriptionNodes(subId, newNodes) {
    // Remove existing nodes for this subId
    this.data.nodes = this.data.nodes.filter(n => n.subId !== subId);
    // Attach subId to new nodes
    const prepared = newNodes.map(n => ({
      ...n,
      subId,
      status: n.status || 'untested',
      delay: n.delay || 0,
      inCombinedSub: Boolean(n.inCombinedSub),
      lastTestTime: n.lastTestTime || null
    }));
    this.data.nodes.push(...prepared);

    // Update sub node count
    const sub = this.data.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.nodeCount = newNodes.length;
      sub.lastUpdate = new Date().toISOString();
      sub.lastStatus = 'success';
      sub.lastMessage = `成功解析 ${newNodes.length} 个节点`;
    }
    this.save();
    return prepared;
  }

  addManualNode(node) {
    const id = node.id || 'node_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const item = {
      ...node,
      id,
      subId: node.subId || 'manual',
      status: 'untested',
      delay: 0,
      inCombinedSub: Boolean(node.inCombinedSub),
      createTime: new Date().toISOString()
    };
    this.data.nodes.push(item);
    this.save();
    return item;
  }

  batchSetCombinedSub(ids, inCombinedSub) {
    const idSet = new Set(ids);
    let count = 0;
    this.data.nodes.forEach(n => {
      if (idSet.has(n.id)) {
        n.inCombinedSub = Boolean(inCombinedSub);
        count++;
      }
    });
    this.save();
    return count;
  }

  updateNode(id, updates) {
    const idx = this.data.nodes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    this.data.nodes[idx] = { ...this.data.nodes[idx], ...updates };
    this.save();
    return this.data.nodes[idx];
  }

  updateNodesBatch(updatesList) {
    const map = new Map(updatesList.map(u => [u.id, u]));
    for (let i = 0; i < this.data.nodes.length; i++) {
      const u = map.get(this.data.nodes[i].id);
      if (u) {
        this.data.nodes[i] = { ...this.data.nodes[i], ...u };
      }
    }
    this.save();
  }

  deleteNode(id) {
    const idx = this.data.nodes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const subId = this.data.nodes[idx].subId;
    this.data.nodes.splice(idx, 1);
    this.refreshSubNodeCounts(subId);
    this.save();
    return true;
  }

  deleteNodes(ids) {
    const idSet = new Set(ids);
    const affectedSubs = new Set();
    this.data.nodes.forEach(n => {
      if (idSet.has(n.id) && n.subId) affectedSubs.add(n.subId);
    });
    this.data.nodes = this.data.nodes.filter(n => !idSet.has(n.id));
    affectedSubs.forEach(sid => this.refreshSubNodeCounts(sid));
    this.save();
    return true;
  }

  filterFailedNodes() {
    const beforeCount = this.data.nodes.length;
    const affectedSubs = new Set();
    this.data.nodes.forEach(n => {
      if ((n.delay === -1 || n.status === 'failed') && n.subId) {
        affectedSubs.add(n.subId);
      }
    });
    this.data.nodes = this.data.nodes.filter(n => n.delay !== -1 && n.status !== 'failed');
    const removedCount = beforeCount - this.data.nodes.length;
    affectedSubs.forEach(sid => this.refreshSubNodeCounts(sid));
    this.save();
    return { removedCount, remainingCount: this.data.nodes.length };
  }

  deduplicateNodes() {
    const beforeCount = this.data.nodes.length;
    const seen = new Set();
    const kept = [];
    const affectedSubs = new Set();

    for (const node of this.data.nodes) {
      // Key: protocol + server + port + (uuid or password or cipher)
      const key = `${node.type}:${node.server}:${node.port}:${node.uuid || node.password || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(node);
      } else {
        if (node.subId) affectedSubs.add(node.subId);
      }
    }

    this.data.nodes = kept;
    const removedCount = beforeCount - kept.length;
    affectedSubs.forEach(sid => this.refreshSubNodeCounts(sid));
    this.save();
    return { removedCount, remainingCount: kept.length };
  }

  refreshSubNodeCounts(subId) {
    if (!subId || subId === 'manual') return;
    const sub = this.data.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.nodeCount = this.data.nodes.filter(n => n.subId === subId).length;
    }
  }

  // --- Profiles (整合订阅) ---
  getProfiles() {
    return this.data.profiles;
  }

  getProfile(idOrToken) {
    return this.data.profiles.find(p => p.id === idOrToken || p.token === idOrToken);
  }

  addProfile(prof) {
    const id = prof.id || 'prof_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const token = prof.token || 'sub_' + Math.random().toString(36).substring(2, 10);
    const newProf = {
      id,
      name: prof.name || '新建整合订阅',
      token,
      enabled: prof.enabled !== false,
      subIds: prof.subIds || [],
      onlyAlive: prof.onlyAlive !== false,
      maxDelay: prof.maxDelay || 0,
      protocolFilter: prof.protocolFilter || [],
      keywordInclude: prof.keywordInclude || '',
      keywordExclude: prof.keywordExclude || '',
      enableLoyalRules: prof.enableLoyalRules !== false,
      ruleProviderUrl: prof.ruleProviderUrl || 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release',
      createTime: new Date().toISOString()
    };
    this.data.profiles.push(newProf);
    this.save();
    return newProf;
  }

  updateProfile(id, updates) {
    const idx = this.data.profiles.findIndex(p => p.id === id);
    if (idx === -1) return null;
    this.data.profiles[idx] = { ...this.data.profiles[idx], ...updates };
    this.save();
    return this.data.profiles[idx];
  }

  deleteProfile(id) {
    const idx = this.data.profiles.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.data.profiles.splice(idx, 1);
    this.save();
    return true;
  }

  // --- Logs ---
  addLog(type, message, details = null) {
    const log = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      time: new Date().toISOString(),
      type,
      message,
      details
    };
    this.data.logs.unshift(log);
    if (this.data.logs.length > 200) {
      this.data.logs.length = 200;
    }
    this.save();
    return log;
  }

  getLogs(limit = 50) {
    return this.data.logs.slice(0, limit);
  }
}

module.exports = new Database();

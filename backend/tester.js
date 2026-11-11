const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const yaml = require('yaml');
const { applyMihomoCompat } = require('./mihomoCompat');

class MihomoTester {
  constructor() {
    this.activeTasks = new Map();
    this.configDir = path.join(__dirname, '..', 'data', 'temp_mihomo');
    this.mihomoBinary = this.findBinary();
  }

  get isTesting() {
    return this.activeTasks.size > 0;
  }

  getFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }

  findBinary() {
    const isWin = process.platform === 'win32';
    const binName = isWin ? 'mihomo.exe' : 'mihomo';

    // 1. Look in /usr/local/bin or system standard directories
    const usrLocalPath = path.join('/usr/local/bin', binName);
    if (fs.existsSync(usrLocalPath)) return usrLocalPath;

    // 2. Look in root directory of project
    const rootPath = path.join(__dirname, '..', binName);
    if (fs.existsSync(rootPath)) return rootPath;

    // 3. Look in /app directory (Docker container root)
    const appPath = path.join('/app', binName);
    if (fs.existsSync(appPath)) return appPath;

    // 4. Look in backend directory
    const backendPath = path.join(__dirname, binName);
    if (fs.existsSync(backendPath)) return backendPath;

    // 5. Fallback to system PATH
    return binName;
  }

  setBinary(binPath) {
    if (binPath && fs.existsSync(binPath)) {
      this.mihomoBinary = binPath;
      return true;
    }
    return false;
  }

  getBinaryPath() {
    return this.mihomoBinary;
  }

  refreshBinary() {
    this.mihomoBinary = this.findBinary();
    return this.mihomoBinary;
  }

  cleanProxyForMihomo(node) {
    // Clone node and filter out UI-specific fields before feeding into Mihomo yaml
    const p = { ...node };
    delete p.id;
    delete p.subId;
    delete p.delay;
    delete p.status;
    delete p.lastTestTime;
    delete p.createTime;
    delete p.checked;
    delete p.inCombinedSub;
    delete p.retriesUsed;

    // Ensure port is int
    if (p.port) p.port = parseInt(p.port, 10);
    // Ensure alterId is int if vmess
    if (p.alterId !== undefined) p.alterId = parseInt(p.alterId, 10);

    // REALITY 节点补 support-x25519mlkem768，否则连 Xray 25.x+ 服务端会认证失败
    return applyMihomoCompat(p);
  }

  ensureUniqueNodeNames(nodes) {
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

  ensureTempDir() {
    // 优先使用 /tmp/temp_mihomo 或系统临时目录，避免 Docker volume 目录由于宿主机挂载文件权限 umask 导致不可执行或写锁冲突
    if (process.platform !== 'win32') {
      this.configDir = '/tmp/sub_temp_mihomo';
    }
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  async stopMihomoTask(taskId) {
    const task = this.activeTasks.get(taskId);
    if (task) {
      if (task.proc) {
        try {
          task.proc.kill('SIGTERM');
          await new Promise(r => setTimeout(r, 200));
          task.proc.kill('SIGKILL');
        } catch (e) {}
      }
      try {
        if (task.configFile && fs.existsSync(task.configFile)) {
          fs.unlinkSync(task.configFile);
        }
      } catch (e) {}
      this.activeTasks.delete(taskId);
    }
  }

  async stopMihomo() {
    for (const taskId of Array.from(this.activeTasks.keys())) {
      await this.stopMihomoTask(taskId);
    }
  }

  async startMihomoWithNodes(nodes, { taskId, apiPort, secret, configFile, mixedPort = 0, mode = 'rule' }) {
    this.ensureTempDir();

    const cleanProxies = nodes.map(n => this.cleanProxyForMihomo(n));

    // Mihomo configuration
    const configData = {
      'mixed-port': mixedPort, // 0 = 只开 API（纯延迟探测）；>0 = 同时开本地代理端口（带宽测速需要真实出流量）
      'allow-lan': false,
      mode: mode, // 'rule' 用于延迟探测；'global' 用于带宽测速（通过切换 GLOBAL 选择器逐节点下载）
      'log-level': 'warning',
      'external-controller': `127.0.0.1:${apiPort}`,
      secret: secret,
      dns: {
        enable: true,
        ipv6: true,
        'enhanced-mode': 'redir-host',
        nameserver: [
          '223.5.5.5',
          '119.29.29.29',
          '114.114.114.114',
          '8.8.8.8'
        ]
      },
      proxies: cleanProxies
    };

    fs.writeFileSync(configFile, yaml.stringify(configData), 'utf8');

    return new Promise((resolve) => {
      let started = false;
      let lastError = '';
      const timeout = setTimeout(() => {
        if (!started) {
          resolve({ ok: false, error: lastError || '启动超时 (7s 内未收到 Mihomo RESTful API 监听就绪信号)' });
        }
      }, 7000);

      try {
        const proc = spawn(this.mihomoBinary, ['-d', this.configDir, '-f', configFile]);
        this.activeTasks.set(taskId, { proc, configFile, apiPort, secret });

        proc.stdout.on('data', d => {
          const str = d.toString();
          if (str.includes('RESTful API listening at') || str.includes('Initial configuration complete')) {
            if (!started) {
              started = true;
              clearTimeout(timeout);
              resolve({ ok: true });
            }
          }
        });

        proc.stderr.on('data', d => {
          const str = d.toString();
          console.error('[Mihomo stderr]:', str);
          lastError = str.trim();
          if (str.includes('RESTful API listening at') || str.includes('Initial configuration complete')) {
            if (!started) {
              started = true;
              clearTimeout(timeout);
              resolve({ ok: true });
            }
          }
        });

        proc.on('error', err => {
          console.error('[Mihomo] Process spawn error:', err.message);
          lastError = err.message;
          if (!started) {
            started = true;
            clearTimeout(timeout);
            resolve({ ok: false, error: err.message });
          }
        });

        proc.on('exit', (code, signal) => {
          console.warn(`[Mihomo] Task ${taskId} exited with code ${code}, signal ${signal}`);
          if (!started) {
            started = true;
            clearTimeout(timeout);
            resolve({ ok: false, error: lastError || `进程启动后异常退出 (退出码: ${code}, 信号: ${signal})` });
          }
          this.activeTasks.delete(taskId);
        });

        // Also polling health check
        const interval = setInterval(async () => {
          if (started) {
            clearInterval(interval);
            return;
          }
          const ok = await this.pingApi(apiPort, secret);
          if (ok) {
            started = true;
            clearInterval(interval);
            clearTimeout(timeout);
            resolve({ ok: true });
          }
        }, 200);

      } catch (err) {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      }
    });
  }

  pingApi(apiPort, secret) {
    return new Promise(resolve => {
      const req = http.request(`http://127.0.0.1:${apiPort}/version`, {
        headers: { 'Authorization': `Bearer ${secret}` },
        timeout: 1000
      }, res => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  testSingleProxyDelay(proxyName, testUrl = 'http://www.gstatic.com/generate_204', timeout = 5000, apiPort = 29090, secret = '') {
    return new Promise(resolve => {
      const encodedName = encodeURIComponent(proxyName);
      const url = `http://127.0.0.1:${apiPort}/proxies/${encodedName}/delay?url=${encodeURIComponent(testUrl)}&timeout=${timeout}`;

      const req = http.request(url, {
        headers: { 'Authorization': `Bearer ${secret}` },
        timeout: timeout + 1500
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              if (typeof data.delay === 'number') {
                return resolve(data.delay);
              }
            } catch (e) {}
          }
          resolve(-1); // failed or timeout
        });
      });

      req.on('error', () => resolve(-1));
      req.on('timeout', () => {
        req.destroy();
        resolve(-1);
      });
      req.end();
    });
  }

  /**
   * Test single proxy with optional automatic retries on failure
   */
  async testSingleProxyWithRetry(proxyName, testUrl = 'http://www.gstatic.com/generate_204', timeout = 5000, maxRetries = 0, onRetry = null, apiPort = 29090, secret = '') {
    let delay = await this.testSingleProxyDelay(proxyName, testUrl, timeout, apiPort, secret);
    if (delay > 0) {
      return { delay, retriesUsed: 0 };
    }

    // Failed on initial try, run extra retries if configured
    for (let r = 1; r <= maxRetries; r++) {
      if (onRetry) onRetry(proxyName, r, maxRetries);
      // Brief pause between retries
      await new Promise(res => setTimeout(res, 250));
      delay = await this.testSingleProxyDelay(proxyName, testUrl, timeout, apiPort, secret);
      if (delay > 0) {
        return { delay, retriesUsed: r };
      }
    }

    return { delay: -1, retriesUsed: maxRetries };
  }

  /**
   * Run speed / delay test in batches with concurrency limit
   */
  async testNodes(nodes, { taskId, testUrl = 'http://www.gstatic.com/generate_204', timeout = 5000, concurrency = 10, maxRetries = 0, onProgress = null } = {}) {
    if (!nodes || nodes.length === 0) {
      return [];
    }

    const currentTaskId = taskId || 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    this.ensureTempDir();
    const apiPort = await this.getFreePort();
    const secret = 'mihomo_sub_test_' + Math.random().toString(36).substring(2, 8);
    const configFile = path.join(this.configDir, `config_${currentTaskId}.yaml`);

    try {
      // 确保二进制文件拥有可执行权限 (针对 Linux / Docker 运行时)
      if (process.platform !== 'win32' && fs.existsSync(this.mihomoBinary)) {
        try {
          fs.chmodSync(this.mihomoBinary, 0o755);
        } catch (e) {}
      }

      // 对测速节点名称去重，避免 Mihomo 解析 yaml 时出现 duplicate proxy name 错误退出
      const uniqueNamedNodes = this.ensureUniqueNodeNames(nodes);

      // 1. Start mihomo instance loaded with these nodes
      const startRes = await this.startMihomoWithNodes(uniqueNamedNodes, {
        taskId: currentTaskId,
        apiPort,
        secret,
        configFile
      });

      if (!startRes || !startRes.ok) {
        throw new Error(`无法启动 Mihomo 内核程序 (${this.mihomoBinary})，原因: ${startRes?.error || '未知错误'}`);
      }

      // 给 Mihomo 预热 500ms，确保内部出站代理通道与 DNS 解析就绪
      await new Promise(r => setTimeout(r, 500));

      // 2. Queue for testing
      const results = [];
      let index = 0;
      const total = uniqueNamedNodes.length;

      const worker = async () => {
        while (index < total) {
          const currentIndex = index++;
          const node = uniqueNamedNodes[currentIndex];
          const testRes = await this.testSingleProxyWithRetry(
            node.name,
            testUrl,
            timeout,
            maxRetries,
            (name, currentRetry, totalRetries) => {
              if (onProgress) {
                onProgress({
                  current: results.length,
                  total,
                  retrying: { name, currentRetry, totalRetries }
                });
              }
            },
            apiPort,
            secret
          );

          const delay = testRes.delay;
          const isAlive = delay > 0;

          const result = {
            id: node.id,
            name: node.name,
            delay: delay,
            status: isAlive ? 'alive' : 'failed',
            inCombinedSub: isAlive, // 成功的加入整合订阅，失败/重试超时的不加入
            retriesUsed: testRes.retriesUsed,
            lastTestTime: new Date().toISOString()
          };
          results.push(result);
          if (onProgress) {
            onProgress({
              current: results.length,
              total,
              latest: result
            });
          }
        }
      };

      const workers = [];
      const workerCount = Math.min(concurrency, total);
      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
      return results;

    } finally {
      await this.stopMihomoTask(currentTaskId);
    }
  }

  /**
   * 单节点连通性诊断：用 debug 日志跑一次延迟探测，把「失败原因」翻译成人话。
   * 用于「测不出延迟」时定位卡在哪一层（DNS / TCP / TLS / REALITY 认证 / 目标站点）。
   */
  async diagnoseNode(node, { testUrl = 'http://www.gstatic.com/generate_204', timeout = 6000 } = {}) {
    const apiPort = await this.getFreePort();
    const secret = 'diag_' + Math.random().toString(36).slice(2, 8);
    const proxyName = 'diagnose-target';
    const dir = '/tmp/sub_temp_mihomo';
    const configFile = path.join(dir, `diag_${Date.now()}.yaml`);
    fs.mkdirSync(dir, { recursive: true });

    const proxy = this.cleanProxyForMihomo({ ...node, name: proxyName });
    const configData = {
      'mixed-port': 0,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'debug',
      'external-controller': `127.0.0.1:${apiPort}`,
      secret,
      proxies: [proxy],
      rules: ['MATCH,DIRECT']
    };
    fs.writeFileSync(configFile, yaml.stringify(configData), 'utf8');

    const lines = [];
    let proc = null;
    try {
      proc = spawn(this.mihomoBinary, ['-d', dir, '-f', configFile]);
      const collect = d => {
        String(d).split('\n').forEach(l => {
          const t = l.trim();
          if (t) lines.push(t);
        });
        if (lines.length > 400) lines.splice(0, lines.length - 400);
      };
      proc.stdout.on('data', collect);
      proc.stderr.on('data', collect);

      const deadline = Date.now() + 8000;
      let ready = false;
      while (Date.now() < deadline) {
        if (await this.pingApi(apiPort, secret)) { ready = true; break; }
        await new Promise(r => setTimeout(r, 200));
      }
      if (!ready) {
        return { ok: false, delay: -1, reason: 'Mihomo 内核未能启动（生成的配置可能被拒绝）', detail: lines.slice(-12) };
      }

      const delay = await this.testSingleProxyDelay(proxyName, testUrl, timeout, apiPort, secret);
      await new Promise(r => setTimeout(r, 600));

      if (delay > 0) {
        return { ok: true, delay, reason: `连通正常 (${delay} ms)`, detail: lines.slice(-8) };
      }
      const interesting = lines.filter(l => /error|warning|REALITY|fail|refused|timeout|unreachable/i.test(l));
      return {
        ok: false,
        delay,
        reason: this.explainMihomoLogs(lines),
        detail: (interesting.length ? interesting : lines).slice(-10)
      };
    } catch (e) {
      return { ok: false, delay: -1, reason: '诊断异常: ' + e.message, detail: lines.slice(-12) };
    } finally {
      if (proc) {
        try { proc.kill('SIGKILL'); } catch (e) {}
      }
      try { if (fs.existsSync(configFile)) fs.unlinkSync(configFile); } catch (e) {}
    }
  }

  /**
   * 把 mihomo 日志行翻译成一句能看懂的原因
   */
  explainMihomoLogs(lines) {
    const blob = lines.join('\n');
    // mihomo 打的是 "REALITY Authentication: false"，部分版本是 "REALITY authentication failed"
    if (/REALITY\s+authentication/i.test(blob)) {
      return 'REALITY 认证失败：public-key(pbk) / short-id(sid) / SNI 与服务器不一致，或服务器换过密钥后链接没更新';
    }
    if (/connection refused/i.test(blob)) {
      return '端口拒绝连接：服务器上没有服务监听该端口';
    }
    if (/no route to host|network is unreachable/i.test(blob)) {
      return '网络不可达：该 IP/端口被防火墙或运营商拦截';
    }
    if (/x509|certificate|tls:/i.test(blob)) {
      return 'TLS 握手/证书异常：可能把 REALITY 当成普通 TLS（或反之）配置错了';
    }
    if (/invalid user|authentication failed/i.test(blob)) {
      return '身份校验失败：uuid / password 与服务器不一致';
    }
    if (/no such host/i.test(blob)) {
      return '域名解析失败：服务器地址写错或本机 DNS 异常';
    }
    if (/i\/o timeout|context deadline exceeded|timeout/i.test(blob)) {
      return '连接超时：TCP 能到但握手无响应（端口被墙 / 参数不对导致服务端静默丢弃）';
    }
    return '探测超时且内核日志里没有明确错误，可换个测试地址再试';
  }
}

module.exports = new MihomoTester();

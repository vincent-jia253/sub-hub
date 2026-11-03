const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { spawn, execFile } = require('child_process');
const axios = require('axios');
const tester = require('./tester');

const gunzip = promisify(zlib.gunzip);
const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.join(__dirname, '..');
const UPDATE_TEMP_DIR = path.join(PROJECT_ROOT, 'data', 'mihomo_update');
const REPOSITORY = 'MetaCubeX/mihomo';
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const REQUEST_TIMEOUT = Number(process.env.MIHOMO_REQUEST_TIMEOUT || 20000);
const DOWNLOAD_TIMEOUT = Number(process.env.MIHOMO_DOWNLOAD_TIMEOUT || 180000);
const RELEASE_CACHE_MS = 5 * 60 * 1000;

const GITHUB_PROXIES = [
  { name: 'GitHub 加速 ghfast.top', prefix: 'https://ghfast.top/' },
  { name: 'GitHub 加速 gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { name: 'GitHub 加速 ghproxy.net', prefix: 'https://ghproxy.net/' }
];

let cachedRelease = null;
let cachedReleaseTime = 0;
let updateInProgress = false;

function getBinaryName() {
  return process.platform === 'win32' ? 'mihomo.exe' : 'mihomo';
}

function getBinaryTargetPath() {
  const detected = typeof tester.getBinaryPath === 'function'
    ? tester.getBinaryPath()
    : tester.mihomoBinary;

  if (detected && detected !== getBinaryName() && path.isAbsolute(detected)) {
    return detected;
  }

  return path.join(PROJECT_ROOT, getBinaryName());
}

function getArchitecture() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32' && arch === 'x64') {
    return { platform: 'Windows', arch: 'x64', assets: [
      `mihomo-windows-amd64-compatible-{version}.zip`,
      `mihomo-windows-amd64-{version}.zip`
    ]};
  }
  if (platform === 'win32' && arch === 'arm64') {
    return { platform: 'Windows', arch: 'ARM64', assets: [
      `mihomo-windows-arm64-{version}.zip`
    ]};
  }
  if (platform === 'linux' && arch === 'x64') {
    return { platform: 'Linux', arch: 'x64', assets: [
      `mihomo-linux-amd64-compatible-{version}.gz`,
      `mihomo-linux-amd64-{version}.gz`
    ]};
  }
  if (platform === 'linux' && arch === 'arm64') {
    return { platform: 'Linux', arch: 'ARM64', assets: [
      `mihomo-linux-arm64-{version}.gz`
    ]};
  }
  if (platform === 'darwin' && arch === 'x64') {
    return { platform: 'macOS', arch: 'x64', assets: [
      `mihomo-darwin-amd64-compatible-{version}.gz`,
      `mihomo-darwin-amd64-{version}.gz`
    ]};
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { platform: 'macOS', arch: 'ARM64', assets: [
      `mihomo-darwin-arm64-{version}.gz`
    ]};
  }

  return {
    platform,
    arch,
    assets: []
  };
}

function parseVersion(value) {
  const match = String(value || '').match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\s|$|[-+])/i);
  return match ? `v${match[1]}.${match[2]}.${match[3]}` : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  const aParts = a.slice(1).split('.').map(Number);
  const bParts = b.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
  }
  return 0;
}

function runVersionCommand(binaryPath) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let proc;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        if (proc) proc.kill('SIGKILL');
      } catch (e) {}
      finish({ ok: false, output, error: '版本检测超时' });
    }, 5000);

    try {
      proc = spawn(binaryPath, ['-v'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      finish({ ok: false, output, error: err.message });
      return;
    }

    proc.stdout.on('data', data => {
      output += data.toString();
    });
    proc.stderr.on('data', data => {
      output += data.toString();
    });
    proc.on('error', err => {
      finish({ ok: false, output, error: err.message });
    });
    proc.on('close', code => {
      finish({
        ok: code === 0,
        output,
        version: parseVersion(output),
        error: code === 0 ? null : `退出码 ${code}`
      });
    });
  });
}

async function getLocalCoreInfo() {
  const detected = typeof tester.getBinaryPath === 'function'
    ? tester.getBinaryPath()
    : tester.mihomoBinary;
  const targetPath = getBinaryTargetPath();
  const architecture = getArchitecture();
  const versionResult = await runVersionCommand(detected || targetPath);

  return {
    installed: Boolean(versionResult.ok && versionResult.version),
    currentVersion: versionResult.version || null,
    binaryPath: targetPath,
    detectedBinaryPath: detected || null,
    platform: architecture.platform,
    arch: architecture.arch,
    updateInProgress
  };
}

function normalizeRelease(release, sourceName) {
  if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
    throw new Error('GitHub Release 返回格式不正确');
  }

  const version = parseVersion(release.tag_name);
  if (!version) {
    throw new Error(`无法识别最新版本号: ${release.tag_name}`);
  }

  return {
    tag: release.tag_name,
    version,
    publishedAt: release.published_at || null,
    releaseUrl: release.html_url || `https://github.com/${REPOSITORY}/releases/tag/${release.tag_name}`,
    source: sourceName,
    assets: release.assets.map(asset => ({
      name: asset.name,
      size: asset.size,
      downloadUrl: asset.browser_download_url
    }))
  };
}

async function fetchLatestRelease(force = false) {
  if (!force && cachedRelease && Date.now() - cachedReleaseTime < RELEASE_CACHE_MS) {
    return cachedRelease;
  }

  const sources = [
    { name: 'GitHub API', url: RELEASES_API },
    ...GITHUB_PROXIES.map(proxy => ({
      name: `${proxy.name} API`,
      url: `${proxy.prefix}${RELEASES_API}`
    }))
  ];
  const errors = [];

  for (const source of sources) {
    try {
      const response = await axios.get(source.url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'sub-hub-mihomo-updater',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      const release = normalizeRelease(response.data, source.name);
      cachedRelease = release;
      cachedReleaseTime = Date.now();
      return release;
    } catch (err) {
      const status = err.response?.status ? `HTTP ${err.response.status}` : '';
      errors.push(`${source.name}: ${[status, err.message].filter(Boolean).join(' ')}`);
    }
  }

  throw new Error(`无法获取 Mihomo 最新版本，已尝试 GitHub 及加速线路。${errors.join('；')}`);
}

function selectReleaseAsset(release) {
  const architecture = getArchitecture();
  const expectedNames = architecture.assets.map(pattern =>
    pattern.replace('{version}', release.tag)
  );

  for (const name of expectedNames) {
    const asset = release.assets.find(item => item.name === name);
    if (asset) return asset;
  }

  for (const name of expectedNames) {
    const prefix = name.slice(0, name.lastIndexOf(release.tag));
    const suffix = path.extname(name);
    const asset = release.assets.find(item =>
      item.name.startsWith(prefix) && item.name.endsWith(suffix)
    );
    if (asset) return asset;
  }

  throw new Error(`当前系统 ${architecture.platform}/${architecture.arch} 没有匹配的 Mihomo 安装包`);
}

function buildDownloadUrls(asset, release) {
  const directUrl = asset.downloadUrl
    || `https://github.com/${REPOSITORY}/releases/download/${release.tag}/${encodeURIComponent(asset.name)}`;
  const urls = [
    { name: 'GitHub', url: directUrl },
    ...GITHUB_PROXIES.map(proxy => ({
      name: proxy.name,
      url: `${proxy.prefix}${directUrl}`
    }))
  ];

  const seen = new Set();
  return urls.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function downloadAsset(asset, release) {
  const errors = [];

  for (const source of buildDownloadUrls(asset, release)) {
    try {
      const response = await axios.get(source.url, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT,
        maxRedirects: 8,
        maxContentLength: 200 * 1024 * 1024,
        headers: {
          'User-Agent': 'sub-hub-mihomo-updater',
          'Accept': 'application/octet-stream'
        }
      });
      const buffer = Buffer.from(response.data);
      if (buffer.length < 1024) {
        throw new Error(`下载内容过小 (${buffer.length} bytes)`);
      }
      if (buffer.subarray(0, 256).toString('utf8').trimStart().startsWith('<')) {
        throw new Error('下载地址返回了网页而不是安装包');
      }
      return { buffer, source: source.name };
    } catch (err) {
      const status = err.response?.status ? `HTTP ${err.response.status}` : '';
      errors.push(`${source.name}: ${[status, err.message].filter(Boolean).join(' ')}`);
    }
  }

  throw new Error(`Mihomo 安装包下载失败。${errors.join('；')}`);
}

async function findFileRecursively(dir, predicate) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFileRecursively(fullPath, predicate);
      if (nested) return nested;
    } else if (predicate(fullPath, entry.name)) {
      return fullPath;
    }
  }
  return null;
}

async function extractBinary(archiveBuffer, assetName, tempDir) {
  const archivePath = path.join(tempDir, assetName);
  await fsp.writeFile(archivePath, archiveBuffer);

  if (assetName.endsWith('.zip')) {
    if (process.platform !== 'win32') {
      throw new Error('当前运行环境不支持解压 Windows ZIP 内核包');
    }
    const extractDir = path.join(tempDir, 'extracted');
    await fsp.mkdir(extractDir, { recursive: true });
    const command = 'Expand-Archive -LiteralPath $env:MIHOMO_ARCHIVE -DestinationPath $env:MIHOMO_EXTRACT_DIR -Force';
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      timeout: 60000,
      env: {
        ...process.env,
        MIHOMO_ARCHIVE: archivePath,
        MIHOMO_EXTRACT_DIR: extractDir
      }
    });
    const binaryPath = await findFileRecursively(
      extractDir,
      (_fullPath, name) => name.toLowerCase().endsWith('.exe')
    );
    if (!binaryPath) throw new Error('ZIP 安装包中未找到 mihomo.exe');
    return binaryPath;
  }

  if (assetName.endsWith('.gz')) {
    const binaryPath = path.join(tempDir, getBinaryName());
    const binary = await gunzip(archiveBuffer);
    await fsp.writeFile(binaryPath, binary);
    await fsp.chmod(binaryPath, 0o755);
    return binaryPath;
  }

  throw new Error(`不支持的 Mihomo 安装包格式: ${assetName}`);
}

async function replaceBinary(sourcePath, targetPath) {
  const targetDir = path.dirname(targetPath);
  await fsp.mkdir(targetDir, { recursive: true });

  const stagedPath = path.join(targetDir, `.mihomo-update-${Date.now()}-${getBinaryName()}`);
  const backupPath = `${targetPath}.backup-${Date.now()}`;
  await fsp.copyFile(sourcePath, stagedPath);
  if (process.platform !== 'win32') {
    await fsp.chmod(stagedPath, 0o755);
  }

  const hadExistingBinary = fs.existsSync(targetPath);
  if (hadExistingBinary) {
    await fsp.rename(targetPath, backupPath);
  }

  try {
    await fsp.rename(stagedPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(stagedPath)) await fsp.unlink(stagedPath);
      if (hadExistingBinary && fs.existsSync(backupPath)) {
        await fsp.rename(backupPath, targetPath);
      }
    } catch (restoreErr) {
      console.error('[Mihomo Updater] Failed to restore binary backup:', restoreErr.message);
    }
    throw err;
  }

  if (hadExistingBinary) {
    try {
      await fsp.unlink(backupPath);
    } catch (e) {}
  }

  if (process.platform !== 'win32') {
    await fsp.chmod(targetPath, 0o755);
  }
}

async function checkForUpdate() {
  const [local, release] = await Promise.all([
    getLocalCoreInfo(),
    fetchLatestRelease(true)
  ]);
  const asset = selectReleaseAsset(release);
  const hasUpdate = !local.installed || compareVersions(release.version, local.currentVersion) > 0;

  return {
    ...local,
    latestVersion: release.version,
    hasUpdate,
    assetName: asset.name,
    releaseUrl: release.releaseUrl,
    publishedAt: release.publishedAt,
    source: release.source
  };
}

async function updateCore() {
  if (updateInProgress) {
    const err = new Error('Mihomo 内核正在更新，请稍后再试');
    err.statusCode = 409;
    throw err;
  }
  if (tester.isTesting) {
    const err = new Error('当前有测速任务运行中，请等待测速结束后再更新内核');
    err.statusCode = 409;
    throw err;
  }

  updateInProgress = true;
  await fsp.mkdir(UPDATE_TEMP_DIR, { recursive: true });
  const tempDir = await fsp.mkdtemp(path.join(UPDATE_TEMP_DIR, 'update-'));

  try {
    const previous = await getLocalCoreInfo();
    const release = await fetchLatestRelease(true);
    const asset = selectReleaseAsset(release);

    if (previous.installed && compareVersions(release.version, previous.currentVersion) <= 0) {
      return {
        updated: false,
        message: previous.currentVersion === release.version
          ? '当前已是最新版本'
          : `当前版本 ${previous.currentVersion} 不低于最新稳定版 ${release.version}`,
        currentVersion: previous.currentVersion,
        latestVersion: release.version,
        binaryPath: previous.binaryPath
      };
    }

    const download = await downloadAsset(asset, release);
    const downloadedBinary = await extractBinary(download.buffer, asset.name, tempDir);
    const versionResult = await runVersionCommand(downloadedBinary);
    if (!versionResult.ok || !versionResult.version) {
      throw new Error(`下载的 Mihomo 无法执行或版本识别失败: ${versionResult.output || versionResult.error || '未知错误'}`);
    }
    if (compareVersions(versionResult.version, release.version) !== 0) {
      throw new Error(`安装包版本校验失败: 期望 ${release.version}，实际 ${versionResult.version}`);
    }
    if (tester.isTesting) {
      const err = new Error('下载期间启动了测速任务，已取消替换内核');
      err.statusCode = 409;
      throw err;
    }

    const targetPath = getBinaryTargetPath();
    await replaceBinary(downloadedBinary, targetPath);
    if (typeof tester.refreshBinary === 'function') {
      tester.refreshBinary();
    } else {
      tester.setBinary(targetPath);
    }

    return {
      updated: true,
      message: previous.installed
        ? `Mihomo 已从 ${previous.currentVersion} 更新到 ${release.version}`
        : `Mihomo ${release.version} 已安装`,
      previousVersion: previous.currentVersion,
      currentVersion: release.version,
      latestVersion: release.version,
      binaryPath: targetPath,
      assetName: asset.name,
      downloadSource: download.source,
      releaseUrl: release.releaseUrl
    };
  } finally {
    updateInProgress = false;
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

module.exports = {
  getLocalCoreInfo,
  checkForUpdate,
  updateCore
};

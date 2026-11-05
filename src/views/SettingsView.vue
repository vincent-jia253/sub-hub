<template>
  <div class="settings-container">
    <!-- Top Header -->
    <div class="view-header">
      <div>
        <h2>系统配置与维护</h2>
        <p class="subtitle">调整 Mihomo 内核测速参数、配置定时自动更新机制、全量数据导入导出及账号安全</p>
      </div>
      <button class="btn btn-primary" @click="saveSettings" :disabled="saving">
        <Save :size="16" />
        <span>{{ saving ? '保存中...' : '保存系统配置' }}</span>
      </button>
    </div>

    <!-- 1. 全量配置文件备份与恢复 Banner (突出展示) -->
    <div class="card glass backup-banner-card">
      <div class="backup-banner-header">
        <div class="backup-header-left">
          <div class="backup-icon-box">
            <DatabaseBackup :size="24" class="text-primary" />
          </div>
          <div>
            <h3 class="backup-title">系统全量配置文件备份与恢复</h3>
            <p class="backup-desc">
              支持一键将当前系统的所有机场订阅、节点池数据、整合订阅策略（含 Loyalsoldier 规则）及系统设置导出为 JSON 备份，也可在任意设备上直接导入还原。
            </p>
          </div>
        </div>

        <div class="backup-actions">
          <button class="btn btn-primary" @click="exportConfigFile" :disabled="exporting">
            <Download :size="16" />
            <span>{{ exporting ? '生成备份中...' : '导出全部配置文件 (备份)' }}</span>
          </button>

          <label class="btn btn-secondary file-upload-btn">
            <Upload :size="16" />
            <span>导入备份配置文件...</span>
            <input type="file" accept=".json" @change="handleConfigFileSelected" style="display: none;" />
          </label>
        </div>
      </div>
    </div>

    <!-- Mihomo Core Version & Update -->
    <div class="card glass core-card">
      <div class="core-card-header">
        <div class="core-title-wrap">
          <div class="core-icon-box">
            <Cpu :size="22" class="text-primary" />
          </div>
          <div>
            <h3 class="core-title">Mihomo 内核</h3>
            <p class="core-desc">查看当前运行版本，手动检查并安装 GitHub 最新稳定版内核。</p>
          </div>
        </div>
        <span :class="['core-status-pill', coreInfo.installed ? 'is-ready' : 'is-missing']">
          <CheckCircle2 v-if="coreInfo.installed" :size="14" />
          <AlertCircle v-else :size="14" />
          {{ coreInfo.loading ? '检测中' : coreInfo.installed ? '已安装' : '未安装' }}
        </span>
      </div>

      <div class="core-card-body">
        <div class="core-metrics">
          <div class="core-metric">
            <span class="core-metric-label">当前版本</span>
            <strong class="core-metric-value">
              {{ coreInfo.loading ? '检测中...' : (coreInfo.currentVersion || '未安装') }}
            </strong>
            <span class="core-metric-note" v-if="coreInfo.latestVersion">
              最新稳定版 {{ coreInfo.latestVersion }}
            </span>
          </div>
          <div class="core-metric">
            <span class="core-metric-label">系统架构</span>
            <strong class="core-metric-value">{{ coreInfo.platform || '-' }} / {{ coreInfo.arch || '-' }}</strong>
            <span class="core-metric-note">自动匹配官方发布包</span>
          </div>
          <div class="core-metric core-path-metric">
            <span class="core-metric-label">内核路径</span>
            <strong class="core-metric-value core-path" :title="coreInfo.binaryPath">
              {{ coreInfo.binaryPath || '自动检测中' }}
            </strong>
            <span class="core-metric-note" v-if="coreInfo.assetName">{{ coreInfo.assetName }}</span>
          </div>
        </div>

        <div class="core-actions">
          <button class="btn btn-secondary" @click="checkCoreUpdate" :disabled="coreInfo.checking || coreInfo.updating">
            <RefreshCw :size="16" :class="{ 'animate-spin': coreInfo.checking }" />
            <span>{{ coreInfo.checking ? '检查中...' : '检查更新' }}</span>
          </button>
          <button
            class="btn btn-primary"
            @click="updateMihomoCore"
            :disabled="coreInfo.updating || coreInfo.checking || coreInfo.hasUpdate === false"
          >
            <DownloadCloud :size="16" />
            <span>{{ coreUpdateButtonText }}</span>
          </button>
        </div>
      </div>

      <div v-if="coreInfo.message" :class="['core-message', coreInfo.messageType]">
        <AlertCircle v-if="coreInfo.messageType === 'error'" :size="15" />
        <CheckCircle2 v-else :size="15" />
        <span>{{ coreInfo.message }}</span>
        <a
          v-if="coreInfo.releaseUrl"
          :href="coreInfo.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="core-release-link"
        >
          Release
          <ExternalLink :size="13" />
        </a>
      </div>
    </div>

    <!-- 2. 二列网格配置项 -->
    <div class="settings-grid">
      <!-- Speedtest Settings -->
      <div class="card glass">
        <div class="card-header">
          <div class="card-title">
            <Zap class="text-primary" :size="18" />
            <span>Mihomo 延迟测速设置</span>
          </div>
        </div>

        <div class="card-body form-body">
          <div class="form-group">
            <label>测速目标 URL</label>
            <input v-model="settings.testUrl" type="text" placeholder="http://www.gstatic.com/generate_204" />
            <span class="hint">建议使用稳定且无重定向的探测地址（如 Google 204 或 Cloudflare trace）</span>
          </div>

          <div class="form-row">
            <div class="form-group col-6">
              <label>测速超时时间 (毫秒)</label>
              <input v-model.number="settings.testTimeout" type="number" placeholder="5000" />
            </div>
            <div class="form-group col-6">
              <label>并发测速协程数</label>
              <input v-model.number="settings.testConcurrency" type="number" placeholder="15" />
            </div>
          </div>

          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="settings.autoTestAfterRefresh" />
              <span>订阅刷新后自动执行延迟测速</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Bandwidth (real download speed) test -->
      <div class="card glass full-width-card">
        <div class="card-header">
          <div class="card-title">
            <Gauge class="text-primary" :size="18" />
            <span>网速测速（节点真实下载带宽）</span>
          </div>
          <span class="hint">延迟低 ≠ 速度快。网速测速会让每个节点真实下载一段数据，算出实际 Mbps。</span>
        </div>

        <div class="card-body form-body">
          <div class="hint-block">
            定时执行请到下方「定时测速（延迟 + 网速）」卡片配置；这里只影响网速测速本身的参数。
          </div>

          <div class="form-group">
            <label>测速下载地址</label>
            <input v-model="settings.speedTestUrl" type="text" placeholder="https://speed.cloudflare.com/__down?bytes=31457280" />
            <span class="hint">默认 Cloudflare 官方测速端点（Anycast，全球可达）。也可换成任何大文件直链，如 <code>https://cachefly.cachefly.net/10mb.test</code></span>
          </div>

          <div class="form-row">
            <div class="form-group col-6">
              <label>单节点下载时长 (毫秒)</label>
              <input v-model.number="settings.speedTestDurationMs" type="number" placeholder="6000" />
              <span class="hint">建议 5000~8000，太短会受 TCP 慢启动影响；每轮测速会真实消耗节点流量（默认约 30MB/节点）</span>
            </div>
            <div class="form-group col-6">
              <label>并发节点数</label>
              <input v-model.number="settings.speedTestConcurrency" type="number" placeholder="1" />
              <span class="hint">带宽共享，建议 1~3。并发越高单节点读数越低</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Scheduled combined test (delay + speed) -->
      <div class="card glass full-width-card">
        <div class="card-header">
          <div class="card-title">
            <Clock class="text-primary" :size="18" />
            <span>定时测速（延迟 + 网速 捆绑）</span>
          </div>
          <span class="hint">一条 Cron 同时管延迟和网速：先测延迟筛出存活节点，再对存活节点测真实带宽。</span>
        </div>

        <div class="card-body form-body">
          <div class="setting-toggle-row">
            <div class="setting-toggle-copy">
              <span class="setting-toggle-title">开启定时测速任务</span>
              <span class="hint">按下方 Cron 自动执行，进度与结果实时推送到所有已打开的面板气泡</span>
            </div>
            <label class="switch" title="定时测速任务">
              <input type="checkbox" v-model="settings.schedTestEnabled" />
              <span class="slider round"></span>
            </label>
          </div>

          <template v-if="settings.schedTestEnabled">
            <div class="form-row">
              <div class="form-group col-6">
                <label>Crontab 表达式</label>
                <input v-model="settings.schedTestCron" type="text" placeholder="0 4 * * *" />
                <span class="hint">默认每天凌晨 4 点（<code>0 4 * * *</code>）</span>
              </div>
              <div class="form-group col-6">
                <label>测试模式</label>
                <select v-model="settings.schedTestMode">
                  <option value="both">延迟 + 网速（捆绑，推荐）</option>
                  <option value="delay">仅延迟（快，几乎不耗流量）</option>
                  <option value="speed">仅网速（不测延迟）</option>
                </select>
                <span class="hint">捆绑模式下，网速阶段只测本轮延迟存活的节点</span>
              </div>
            </div>

            <div class="quick-cron-tags">
              <span class="cron-tag" @click="settings.schedTestCron = '0 */2 * * *'">每 2 小时</span>
              <span class="cron-tag" @click="settings.schedTestCron = '0 */6 * * *'">每 6 小时</span>
              <span class="cron-tag" @click="settings.schedTestCron = '0 4 * * *'">每天凌晨4点</span>
              <span class="cron-tag" @click="settings.schedTestCron = '0 */12 * * *'">每 12 小时</span>
              <span class="cron-tag" @click="settings.schedTestCron = '0 9,21 * * *'">每天早晚各一次</span>
            </div>

            <div class="settings-divider"></div>

            <div class="form-row">
              <div class="form-group col-6">
                <label>测试范围</label>
                <select v-model="settings.schedTestScope">
                  <option value="combined">仅整合订阅内的节点</option>
                  <option value="alive">仅可用节点（有延迟数据的）</option>
                  <option value="all">全部节点</option>
                  <option value="custom">自定义指定节点</option>
                </select>
                <span class="hint">{{ scopeHint }}</span>
              </div>
              <div class="form-group col-6" v-if="settings.schedTestMode !== 'delay'">
                <label class="checkbox-label" style="margin-top: 26px;">
                  <input type="checkbox" v-model="settings.schedTestSpeedAliveOnly" />
                  <span>网速阶段只测本轮存活节点</span>
                </label>
                <span class="hint">关掉后即使延迟失败也会尝试下载（更慢，一般不用）</span>
              </div>
            </div>

            <!-- 自定义节点多选 -->
            <div v-if="settings.schedTestScope === 'custom'" class="custom-node-picker">
              <div class="picker-toolbar">
                <input v-model="nodePickerKeyword" type="text" placeholder="搜索节点名称 / 服务器..." class="picker-search" />
                <button type="button" class="btn btn-secondary btn-sm" @click="selectAllPickerNodes">
                  全选{{ nodePickerKeyword ? '(筛选)' : '' }}
                </button>
                <button type="button" class="btn btn-secondary btn-sm" @click="settings.schedTestNodeIds = []">
                  清空
                </button>
                <span class="picker-count">已选 {{ (settings.schedTestNodeIds || []).length }} / {{ pickerNodes.length }}</span>
              </div>
              <div class="picker-list">
                <label v-for="n in pickerNodes" :key="n.id" class="picker-item">
                  <input type="checkbox" :value="n.id" v-model="settings.schedTestNodeIds" />
                  <span class="picker-name">{{ n.name }}</span>
                  <span class="picker-meta">
                    <span :class="n.delay > 0 ? 'text-success' : 'text-dim'">{{ n.delay > 0 ? n.delay + ' ms' : '未测' }}</span>
                    <span v-if="n.speedStatus === 'ok'" class="text-primary">{{ n.speed }} Mbps</span>
                  </span>
                </label>
                <div v-if="pickerNodes.length === 0" class="picker-empty">没有匹配的节点</div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Refresh, Schedule & Network -->
      <div class="card glass">
        <div class="card-header">
          <div class="card-title">
            <Clock class="text-primary" :size="18" />
            <span>订阅刷新与网络设置</span>
          </div>
        </div>

        <div class="card-body form-body">
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="settings.autoRefreshEnabled" />
              <span class="font-bold">开启定时自动刷新订阅</span>
            </label>
          </div>

          <div class="form-group" v-if="settings.autoRefreshEnabled">
            <label>Crontab 表达式</label>
            <input v-model="settings.autoRefreshInterval" type="text" placeholder="0 */6 * * *" />
            <span class="hint">默认每 6 小时刷新一次 (<code>0 */6 * * *</code>)，支持标准 Linux Cron 语法</span>
          </div>

          <div class="quick-cron-tags" v-if="settings.autoRefreshEnabled">
            <span class="cron-tag" @click="settings.autoRefreshInterval = '0 */2 * * *'">每 2 小时</span>
            <span class="cron-tag" @click="settings.autoRefreshInterval = '0 */6 * * *'">每 6 小时</span>
            <span class="cron-tag" @click="settings.autoRefreshInterval = '0 0,12 * * *'">每天两次</span>
            <span class="cron-tag" @click="settings.autoRefreshInterval = '0 4 * * *'">每天凌晨4点</span>
          </div>

          <div class="settings-divider"></div>

          <div class="setting-toggle-row">
            <div class="setting-toggle-copy">
              <span class="setting-toggle-title">忽略 TLS 证书校验</span>
              <span class="hint">默认开启。开启后允许抓取证书过期、自签名或域名不匹配的 HTTPS 订阅；请仅在你信任订阅服务器时使用。</span>
            </div>
            <label class="switch" title="忽略 TLS 证书校验">
              <input type="checkbox" v-model="settings.ignoreTlsVerify" />
              <span class="slider round"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Account Security -->
      <div class="card glass full-width-card">
        <div class="card-header">
          <div class="card-title">
            <Lock class="text-primary" :size="18" />
            <span>管理员账号安全</span>
          </div>
        </div>

        <div class="card-body form-body">
          <form @submit.prevent="updatePassword">
            <div class="form-row">
              <div class="form-group col-4">
                <label>当前原密码</label>
                <input v-model="pwdForm.oldPassword" type="password" placeholder="请输入原密码" required />
              </div>
              <div class="form-group col-4">
                <label>设置新密码</label>
                <input v-model="pwdForm.newPassword" type="password" placeholder="最少 6 位" required minlength="6" />
              </div>
              <div class="form-group col-4">
                <label>确认新密码</label>
                <input v-model="pwdForm.confirmPassword" type="password" placeholder="重复新密码" required minlength="6" />
              </div>
            </div>

            <div style="margin-top: 14px;">
              <button type="submit" class="btn btn-secondary btn-sm" :disabled="pwdUpdating">
                <span>{{ pwdUpdating ? '修改中...' : '修改管理员密码' }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Import Config Confirm Modal -->
    <div v-if="showImportModal" class="modal-backdrop" @click.self="showImportModal = false">
      <div class="modal-card glass">
        <div class="modal-header">
          <h3>导入全量系统配置文件</h3>
          <button class="modal-close" @click="showImportModal = false">×</button>
        </div>

        <div class="modal-body">
          <div class="import-preview-box" v-if="importPreview">
            <div class="preview-item">
              <span class="label">机场订阅数：</span>
              <span class="val">{{ (importPreview.subscriptions || []).length }} 个</span>
            </div>
            <div class="preview-item">
              <span class="label">节点池数量：</span>
              <span class="val">{{ (importPreview.nodes || []).length }} 个</span>
            </div>
            <div class="preview-item">
              <span class="label">整合订阅配置：</span>
              <span class="val">{{ (importPreview.profiles || []).length }} 个</span>
            </div>
            <div class="preview-item" v-if="importPreview.exportTime">
              <span class="label">备份导出时间：</span>
              <span class="val">{{ new Date(importPreview.exportTime).toLocaleString() }}</span>
            </div>
          </div>

          <div class="form-group">
            <label>选择导入方式</label>
            <div class="import-mode-options">
              <label class="radio-label">
                <input type="radio" value="merge" v-model="importMode" />
                <div>
                  <div class="mode-title">智能合并 (推荐)</div>
                  <div class="mode-desc">自动比对去重，保留现有订阅和节点，仅追加不存在的内容</div>
                </div>
              </label>

              <label class="radio-label">
                <input type="radio" value="overwrite" v-model="importMode" />
                <div>
                  <div class="mode-title text-danger">完全覆盖</div>
                  <div class="mode-desc">清空并替换现有的所有订阅、节点和聚合规则为备份文件内容</div>
                </div>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showImportModal = false">取消</button>
            <button class="btn btn-primary" @click="executeImportConfig" :disabled="importing">
              <span>{{ importing ? '正在导入中...' : '确认导入' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import {
  Save,
  Zap,
  Clock,
  Lock,
  DatabaseBackup,
  Download,
  Upload,
  Cpu,
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Gauge
} from 'lucide-vue-next';
import api from '../api';

const emit = defineEmits(['data-changed']);

const settings = reactive({
  testUrl: 'http://www.gstatic.com/generate_204',
  testTimeout: 5000,
  testConcurrency: 15,
  autoRefreshEnabled: true,
  autoRefreshInterval: '0 */6 * * *',
  autoTestAfterRefresh: true,
  ignoreTlsVerify: true,
  speedTestEnabled: false,
  speedTestCron: '0 4 * * *',
  speedTestScope: 'combined',
  speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=31457280',
  speedTestDurationMs: 6000,
  speedTestConcurrency: 1,
  // 定时测速（延迟 + 网速 捆绑）
  schedTestEnabled: false,
  schedTestCron: '0 4 * * *',
  schedTestMode: 'both',
  schedTestScope: 'combined',
  schedTestNodeIds: [],
  schedTestRetries: 3,
  schedTestSpeedAliveOnly: true
});

// 自定义节点选择器
const nodes = ref([]);
const nodePickerKeyword = ref('');

const pickerNodes = computed(() => {
  const kw = nodePickerKeyword.value.trim().toLowerCase();
  if (!kw) return nodes.value;
  return nodes.value.filter(n =>
    (n.name || '').toLowerCase().includes(kw) || (n.server || '').toLowerCase().includes(kw)
  );
});

const selectAllPickerNodes = () => {
  const set = new Set(settings.schedTestNodeIds || []);
  pickerNodes.value.forEach(n => set.add(n.id));
  settings.schedTestNodeIds = Array.from(set);
};

const scopeHint = computed(() => {
  const total = nodes.value.length;
  const alive = nodes.value.filter(n => n.delay > 0).length;
  const combined = nodes.value.filter(n => n.inCombinedSub).length;
  switch (settings.schedTestScope) {
    case 'all': return `当前共 ${total} 个节点，全部参与`;
    case 'alive': return `当前 ${alive} 个节点延迟正常，只测这些`;
    case 'custom': return `从下方列表勾选，已选 ${(settings.schedTestNodeIds || []).length} 个`;
    default: return `当前 ${combined} 个节点在整合订阅内，只测这些`;
  }
});

const fetchNodes = async () => {
  try {
    nodes.value = await api.get('/nodes');
  } catch (e) {}
};

const saving = ref(false);
const exporting = ref(false);
const importing = ref(false);

const coreInfo = reactive({
  loading: true,
  installed: false,
  currentVersion: null,
  latestVersion: null,
  hasUpdate: null,
  binaryPath: '',
  detectedBinaryPath: '',
  platform: '',
  arch: '',
  assetName: '',
  releaseUrl: '',
  source: '',
  checking: false,
  updating: false,
  message: '',
  messageType: 'success'
});

const coreUpdateButtonText = computed(() => {
  if (coreInfo.updating) return '更新中...';
  if (coreInfo.hasUpdate === false) return '已是最新版本';
  if (!coreInfo.installed) return '安装最新版';
  if (coreInfo.hasUpdate === true) return '更新到最新版';
  return '安装 / 更新内核';
});

const showImportModal = ref(false);
const importPreview = ref(null);
const importMode = ref('merge');

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
});
const pwdUpdating = ref(false);

const fetchSettings = async () => {
  try {
    const data = await api.get('/settings');
    Object.assign(settings, data);
  } catch (e) {}
};

const fetchCoreInfo = async () => {
  coreInfo.loading = true;
  try {
    const data = await api.get('/system/mihomo');
    Object.assign(coreInfo, data);
  } catch (e) {
    coreInfo.message = '读取 Mihomo 版本失败: ' + e.message;
    coreInfo.messageType = 'error';
  } finally {
    coreInfo.loading = false;
  }
};

const checkCoreUpdate = async () => {
  coreInfo.checking = true;
  coreInfo.message = '';
  try {
    const data = await api.post('/system/mihomo/check-update', {}, { timeout: 70000 });
    Object.assign(coreInfo, data);
    coreInfo.message = data.hasUpdate
      ? `发现新版本 ${data.latestVersion}，当前版本 ${data.currentVersion || '未安装'}`
      : `当前已是最新稳定版 ${data.latestVersion}`;
    coreInfo.messageType = 'success';
  } catch (e) {
    coreInfo.message = '检查更新失败: ' + e.message;
    coreInfo.messageType = 'error';
  } finally {
    coreInfo.checking = false;
  }
};

const updateMihomoCore = async () => {
  const action = coreInfo.installed ? '更新' : '安装';
  if (!confirm(`确定要${action} Mihomo 内核吗？更新期间会暂时阻止新的测速任务。`)) return;

  coreInfo.updating = true;
  coreInfo.message = '';
  try {
    const data = await api.post('/system/mihomo/update', {}, { timeout: 240000 });
    coreInfo.message = data.message;
    coreInfo.messageType = 'success';
    coreInfo.latestVersion = data.latestVersion;
    coreInfo.hasUpdate = false;
    await fetchCoreInfo();
    coreInfo.message = data.message;
    coreInfo.messageType = 'success';
    coreInfo.releaseUrl = data.releaseUrl || coreInfo.releaseUrl;
  } catch (e) {
    coreInfo.message = '内核更新失败: ' + e.message;
    coreInfo.messageType = 'error';
  } finally {
    coreInfo.updating = false;
  }
};

const saveSettings = async () => {
  saving.value = true;
  try {
    await api.post('/settings', settings);
    alert('系统配置已成功保存！');
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    saving.value = false;
  }
};

// 导出全量配置文件
const exportConfigFile = async () => {
  exporting.value = true;
  try {
    const token = localStorage.getItem('sub_token');
    const res = await fetch('/api/system/config/export', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error('导出配置文件失败');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sub_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (e) {
    alert('导出失败: ' + e.message);
  } finally {
    exporting.value = false;
  }
};

// 选中并解析本地导入文件
const handleConfigFileSelected = (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('不是标准的 JSON 格式文件');
      }
      importPreview.value = parsed;
      showImportModal.value = true;
    } catch (err) {
      alert('解析导入文件失败: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// 执行导入配置文件
const executeImportConfig = async () => {
  if (!importPreview.value) return;
  importing.value = true;
  try {
    const res = await api.post('/system/config/import', {
      configData: importPreview.value,
      mode: importMode.value
    });
    showImportModal.value = false;
    alert(`全量配置导入成功！\n- 机场订阅数：${res.totalSubs}\n- 节点池总数：${res.totalNodes}\n- 整合配置数：${res.totalProfiles}`);
    emit('data-changed');
    await fetchSettings();
  } catch (e) {
    alert('导入失败: ' + e.message);
  } finally {
    importing.value = false;
  }
};

const updatePassword = async () => {
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    alert('两次输入的新密码不一致，请重新确认');
    return;
  }

  pwdUpdating.value = true;
  try {
    await api.post('/user/update-password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    });
    alert('密码修改成功，请牢记您的新密码！');
    pwdForm.oldPassword = '';
    pwdForm.newPassword = '';
    pwdForm.confirmPassword = '';
  } catch (e) {
    alert('修改密码失败: ' + e.message);
  } finally {
    pwdUpdating.value = false;
  }
};

onMounted(() => {
  fetchSettings();
  fetchCoreInfo();
  fetchNodes();
});
</script>

<style scoped>
.settings-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.view-header h2 {
  font-size: 20px;
  font-weight: 700;
}

.subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* 顶部全量备份 Banner 卡片 */
.backup-banner-card {
  padding: 24px 28px;
  border-left: 4px solid var(--primary);
}

.backup-banner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.backup-header-left {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  max-width: 650px;
}

.backup-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.backup-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 4px;
}

.backup-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.backup-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.file-upload-btn {
  cursor: pointer;
  margin: 0;
}

/* Mihomo 内核版本卡片 */
.core-card {
  padding: 22px 24px;
  border-left: 4px solid var(--success);
}

.core-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.core-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.core-icon-box {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.core-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.core-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 4px;
}

.core-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.core-status-pill.is-ready {
  color: var(--success);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.core-status-pill.is-missing {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.09);
  border: 1px solid rgba(239, 68, 68, 0.24);
}

.core-card-body {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 20px;
  margin-top: 20px;
}

.core-metrics {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1.6fr);
  gap: 20px;
}

.core-metric {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.core-metric-label {
  font-size: 11px;
  color: var(--text-dim);
}

.core-metric-value {
  font-size: 14px;
  color: var(--text-main);
  font-weight: 650;
}

.core-metric-note {
  font-size: 11px;
  color: var(--text-muted);
}

.core-path {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.core-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.core-message {
  margin-top: 16px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.45;
}

.core-message.success {
  color: var(--success);
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.core-message.error {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.07);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.core-message > span {
  min-width: 0;
}

.core-release-link {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  flex-shrink: 0;
}

.core-release-link:hover {
  text-decoration: underline;
}

/* 栅格布局 */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

@media (max-width: 1180px) {
  .core-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .core-path-metric {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}

.full-width-card {
  grid-column: 1 / -1;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-main);
}

.hint {
  font-size: 11.5px;
  color: var(--text-dim);
}

.form-row {
  display: flex;
  gap: 12px;
}

.col-4 { flex: 4; }
.col-6 { flex: 6; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
}

.checkbox-label input {
  width: auto;
}

.quick-cron-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.settings-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 2px 0;
}

.setting-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.setting-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.setting-toggle-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--border-color);
  transition: 0.2s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  transition: 0.2s;
}

.switch input:checked + .slider {
  background: var(--primary);
}

.switch input:checked + .slider:before {
  transform: translateX(18px);
}

.slider.round {
  border-radius: 999px;
}

.slider.round:before {
  border-radius: 50%;
}

.cron-tag {
  font-size: 11px;
  padding: 4px 10px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.cron-tag:hover {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}

/* 导入配置弹窗样式 */
.import-preview-box {
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.preview-item {
  display: flex;
  justify-content: space-between;
}

.preview-item .label {
  color: var(--text-muted);
}

.preview-item .val {
  font-weight: 600;
  color: var(--text-main);
  font-family: var(--font-mono);
}

.import-mode-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}

.radio-label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: border-color 0.2s;
}

.radio-label:hover {
  border-color: var(--primary);
}

.radio-label input {
  margin-top: 3px;
  width: auto;
}

.mode-title {
  font-size: 13.5px;
  font-weight: 600;
}

.mode-desc {
  font-size: 11.5px;
  color: var(--text-dim);
  margin-top: 2px;
}

@media (max-width: 768px) {
  .backup-banner {
    padding: 16px 14px;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }

  .backup-actions {
    width: 100%;
    gap: 8px;
  }

  .backup-actions .btn {
    flex: 1;
    justify-content: center;
  }

  .core-card {
    padding: 18px 16px;
  }

  .core-card-body {
    align-items: stretch;
    gap: 18px;
  }

  .core-metrics {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .core-actions {
    width: 100%;
    justify-content: stretch;
  }

  .core-actions .btn {
    flex: 1;
    justify-content: center;
  }

  .form-row {
    flex-direction: column;
    gap: 10px;
  }

  .col-4, .col-6 {
    flex: 1;
    width: 100%;
  }
}

/* ---- 定时测速：自定义节点选择器 ---- */
.hint-block {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-card-subtle);
  border-left: 3px solid var(--primary);
  padding: 10px 12px;
  border-radius: 8px;
  line-height: 1.6;
}

.custom-node-picker {
  margin-top: 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 10px;
  background: var(--bg-card-subtle);
}

.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.picker-search {
  flex: 1;
  min-width: 180px;
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-main);
  font-size: 13px;
  font-family: inherit;
}

.picker-count {
  font-size: 12px;
  color: var(--text-dim);
  margin-left: auto;
}

.picker-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.picker-item:hover {
  background: var(--bg-card-hover);
}

.picker-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-dim);
  flex: none;
}

.picker-empty {
  padding: 14px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12px;
}
</style>

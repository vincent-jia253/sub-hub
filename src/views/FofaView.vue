<template>
  <div class="fofa-container">
    <div class="view-header">
      <div>
        <h2>FOFA 订阅发现</h2>
        <p class="subtitle">批量搜索公开资产，验证订阅内容并按 IP、节点数和实测可用节点自动筛选导入。</p>
      </div>
      <div class="header-actions">
        <span :class="['credential-pill', hasCredential ? 'ready' : 'missing']">
          <CheckCircle2 v-if="hasCredential" :size="14" />
          <AlertCircle v-else :size="14" />
          {{ hasCredential ? 'FOFA 凭据已配置' : 'FOFA 凭据未配置' }}
        </span>
        <button class="btn btn-secondary" @click="saveConfig(false)" :disabled="savingConfig">
          <Save :size="15" />
          <span>{{ savingConfig ? '保存中...' : '保存凭据' }}</span>
        </button>
        <button
          v-if="isRunning"
          class="btn btn-danger"
          @click="cancelScan"
          :disabled="cancelling"
        >
          <Loader2 v-if="cancelling" :size="15" class="animate-spin" />
          <Square v-else :size="14" />
          <span>{{ cancelling ? '正在停止...' : '停止扫描' }}</span>
        </button>
        <button v-else class="btn btn-primary" @click="startScan" :disabled="starting">
          <Loader2 v-if="starting" :size="15" class="animate-spin" />
          <Play v-else :size="15" />
          <span>{{ starting ? '正在启动...' : '开始扫描' }}</span>
        </button>
      </div>
    </div>

    <div class="scope-notice glass-sm">
      <ShieldCheck :size="17" class="text-primary" />
      <span>仅应查询和接入你有权使用的资产；系统会拦截内网、回环和保留地址，并对候选 IP 去重。</span>
    </div>

    <div v-if="message.text" :class="['message-banner', message.type]">
      <AlertCircle v-if="message.type === 'error'" :size="16" />
      <CheckCircle2 v-else :size="16" />
      <span>{{ message.text }}</span>
      <button class="message-close" title="关闭提示" @click="message.text = ''">×</button>
    </div>

    <section class="card glass credentials-card">
      <div class="card-header compact-header">
        <div class="card-title">
          <KeyRound :size="18" class="text-primary" />
          <span>FOFA API 凭据</span>
        </div>
        <button
          v-if="config.apiKeyConfigured && !config.usingEnvironmentKey"
          class="btn btn-secondary btn-sm"
          @click="clearApiKey"
          :disabled="savingConfig"
        >
          <Trash2 :size="14" />
          <span>清除 Key</span>
        </button>
      </div>

      <div class="credentials-grid">
        <div class="form-group">
          <label>FOFA 账号邮箱</label>
          <input v-model.trim="config.email" type="email" autocomplete="username" placeholder="name@example.com" />
        </div>
        <div class="form-group">
          <label>FOFA API Key</label>
          <input
            v-model.trim="config.apiKey"
            type="password"
            autocomplete="new-password"
            :placeholder="apiKeyPlaceholder"
          />
          <span class="field-hint">
            {{ config.apiKeyConfigured ? `已保存 ${config.apiKeyHint || '****'}，留空不会覆盖` : '普通账号可使用标准 Search API' }}
          </span>
        </div>
        <div class="credential-note">
          <span class="note-label">请求方式</span>
          <strong>Search API</strong>
          <span>{{ config.usingEnvironmentKey ? '当前 Key 来自环境变量' : '凭据仅保存在本机数据库' }}</span>
        </div>
      </div>
    </section>

    <div class="scan-grid">
      <section class="card glass query-card">
        <div class="card-header compact-header">
          <div class="card-title">
            <Search :size="18" class="text-primary" />
            <span>FOFA 查询语句</span>
          </div>
          <span class="line-count">{{ queryCount }} 条</span>
        </div>
        <textarea
          v-model="queries"
          class="query-textarea"
          rows="12"
          spellcheck="false"
          placeholder='每行一条，例如：body="mixed-port" && body="proxy-groups"'
        ></textarea>
        <span class="field-hint">每行一条，自动去重；一次最多 30 条查询。</span>
      </section>

      <section class="card glass options-card">
        <div class="card-header compact-header">
          <div class="card-title">
            <Filter :size="18" class="text-primary" />
            <span>筛选与导入策略</span>
          </div>
        </div>

        <div class="options-grid">
          <label class="option-field">
            <span>每页结果</span>
            <input v-model.number="options.pageSize" type="number" min="1" max="100" />
          </label>
          <label class="option-field">
            <span>每条查询页数</span>
            <input v-model.number="options.maxPages" type="number" min="1" max="10" />
          </label>
          <label class="option-field">
            <span>最少节点数</span>
            <input v-model.number="options.minNodes" type="number" min="0" />
          </label>
          <label class="option-field">
            <span>最多节点数</span>
            <input v-model.number="options.maxNodes" type="number" min="0" />
            <small>0 表示不限</small>
          </label>
          <label class="option-field">
            <span>最少可用节点</span>
            <input v-model.number="options.minAliveNodes" type="number" min="0" />
          </label>
          <label class="option-field">
            <span>最多可用节点</span>
            <input v-model.number="options.maxAliveNodes" type="number" min="0" />
            <small>0 表示不限</small>
          </label>
          <label class="option-field">
            <span>候选并发检查</span>
            <input v-model.number="options.concurrency" type="number" min="1" max="6" />
          </label>
          <label class="option-field">
            <span>最多导入订阅</span>
            <input v-model.number="options.maxImports" type="number" min="0" />
            <small>0 表示不限</small>
          </label>
        </div>

        <div class="auto-import-row">
          <div>
            <span class="auto-import-title">验证通过后自动加入机场订阅</span>
            <span class="field-hint">至少一个节点通过 Mihomo 实测才会导入。</span>
          </div>
          <label class="switch" title="自动导入验证通过的订阅">
            <input type="checkbox" v-model="options.autoImport" />
            <span class="slider round"></span>
          </label>
        </div>
      </section>
    </div>

    <section v-if="job" class="card glass task-card">
      <div class="task-header">
        <div class="task-heading">
          <div :class="['task-icon', job.status]">
            <Loader2 v-if="isRunning" :size="18" class="animate-spin" />
            <CheckCircle2 v-else-if="job.status === 'completed'" :size="18" />
            <AlertCircle v-else :size="18" />
          </div>
          <div>
            <h3>扫描任务</h3>
            <span class="task-id">{{ job.id }}</span>
          </div>
        </div>
        <div class="task-state-wrap">
          <span :class="['task-state', job.status]">{{ statusLabel(job.status) }}</span>
          <span class="phase-label">{{ phaseLabel(job.phase) }}</span>
        </div>
      </div>

      <div class="progress-block">
        <div class="progress-copy">
          <span v-if="job.phase === 'searching'">正在从 FOFA 收集候选地址</span>
          <span v-else>已检查 {{ job.processedCandidates }} / {{ job.totalCandidates }} 个候选</span>
          <strong>{{ progressPercent }}%</strong>
        </div>
        <div :class="['progress-track', { indeterminate: job.phase === 'searching' && job.totalCandidates === 0 }]">
          <div class="progress-value" :style="{ width: progressPercent + '%' }"></div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <span>FOFA 结果</span>
          <strong>{{ job.stats.searchedResults }}</strong>
        </div>
        <div class="stat-item">
          <span>候选地址</span>
          <strong>{{ job.totalCandidates }}</strong>
        </div>
        <div class="stat-item success">
          <span>已导入</span>
          <strong>{{ job.stats.imported }}</strong>
        </div>
        <div class="stat-item">
          <span>已过滤</span>
          <strong>{{ job.stats.filtered }}</strong>
        </div>
        <div class="stat-item">
          <span>重复 IP / URL</span>
          <strong>{{ job.stats.duplicates }}</strong>
        </div>
        <div class="stat-item danger">
          <span>不可访问</span>
          <strong>{{ job.stats.unreachable }}</strong>
        </div>
        <div class="stat-item">
          <span>安全拦截</span>
          <strong>{{ job.stats.blocked }}</strong>
        </div>
      </div>

      <div v-if="job.error" class="task-error">
        <AlertCircle :size="15" />
        <span>{{ job.error }}</span>
      </div>

      <div v-if="job.candidateLimitReached" class="task-warning">
        <AlertCircle :size="15" />
        <span>候选数量已达到单次扫描上限，本次仅处理前 500 个不重复地址。</span>
      </div>

      <div v-if="job.queryErrors.length > 0" class="query-errors">
        <div class="query-errors-title">部分查询未完成</div>
        <div v-for="(item, index) in job.queryErrors" :key="index" class="query-error-row">
          <code>{{ item.query }}</code>
          <span>{{ item.message }}</span>
        </div>
      </div>

      <div class="results-header">
        <div>
          <h3>处理结果</h3>
          <span>最多保留最近 300 条结果</span>
        </div>
        <button class="btn btn-secondary btn-sm" @click="refreshJob" :disabled="polling">
          <RefreshCw :size="14" :class="{ 'animate-spin': polling }" />
          <span>刷新</span>
        </button>
      </div>

      <div v-if="job.results.length === 0" class="results-empty">
        <Globe2 :size="28" class="text-dim" />
        <span>{{ isRunning ? '正在等待首批结果...' : '本次任务没有产生处理结果' }}</span>
      </div>

      <div v-else class="results-table-wrap">
        <table class="results-table">
          <thead>
            <tr>
              <th width="94">状态</th>
              <th>目标地址</th>
              <th width="82">节点</th>
              <th width="82">可用</th>
              <th>处理信息</th>
              <th width="82">HTTP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in job.results" :key="item.id">
              <td>
                <span :class="['result-status', item.status]">{{ resultStatusLabel(item.status) }}</span>
              </td>
              <td>
                <span class="result-target" :title="item.url">{{ item.ip || item.host }}</span>
                <span class="result-query" :title="item.query">{{ item.query }}</span>
              </td>
              <td class="number-cell">{{ item.nodeCount || '-' }}</td>
              <td class="number-cell">{{ item.aliveCount || '-' }}</td>
              <td>
                <span class="result-message" :title="item.message">{{ item.message }}</span>
              </td>
              <td class="number-cell">{{ item.httpStatus || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  CheckCircle2,
  Filter,
  Globe2,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Square,
  Trash2
} from 'lucide-vue-next';
import api from '../api';

const emit = defineEmits(['data-changed']);

const DEFAULT_QUERIES = `body="mixed-port" && body="proxy-groups"
body="external-controller" && body="proxies"
body="proxy-providers" && body="rules"
body="port: 7890" && body="socks-port"
body="allow-lan" && body="mode: rule"
body="clash" && body="proxy-groups" && body="password"`;

const config = reactive({
  email: '',
  apiKey: '',
  apiKeyConfigured: false,
  apiKeyHint: '',
  usingEnvironmentKey: false
});

const options = reactive({
  pageSize: 20,
  maxPages: 1,
  minNodes: 1,
  maxNodes: 0,
  minAliveNodes: 1,
  maxAliveNodes: 0,
  concurrency: 2,
  maxImports: 10,
  autoImport: true
});

const queries = ref(localStorage.getItem('sub_fofa_queries') || DEFAULT_QUERIES);
const job = ref(null);
const savingConfig = ref(false);
const starting = ref(false);
const cancelling = ref(false);
const polling = ref(false);
const message = reactive({ text: '', type: 'success' });

let pollTimer = null;

const queryCount = computed(() => queries.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length);
const hasCredential = computed(() => Boolean(
  config.email && (config.apiKeyConfigured || config.usingEnvironmentKey || config.apiKey)
));
const isRunning = computed(() => ['queued', 'running', 'cancelling'].includes(job.value?.status));
const apiKeyPlaceholder = computed(() => (
  config.apiKeyConfigured ? `已配置 ${config.apiKeyHint || '****'}，输入新 Key 可覆盖` : '输入 FOFA API Key'
));
const progressPercent = computed(() => {
  if (!job.value) return 0;
  if (job.value.status === 'completed') return 100;
  if (!job.value.totalCandidates) return job.value.phase === 'searching' ? 0 : 0;
  return Math.min(100, Math.round((job.value.processedCandidates / job.value.totalCandidates) * 100));
});

const statusLabel = (status) => ({
  queued: '排队中',
  running: '运行中',
  cancelling: '正在停止',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}[status] || status || '未知');

const phaseLabel = (phase) => ({
  queued: '等待启动',
  searching: '搜索候选',
  checking: '验证订阅',
  completed: '处理完毕',
  failed: '任务异常',
  cancelled: '任务已取消',
  cancelling: '正在取消'
}[phase] || '');

const resultStatusLabel = (status) => ({
  imported: '已导入',
  valid: '验证通过',
  duplicate: '重复跳过',
  blocked: '安全拦截',
  unreachable: '不可访问',
  filtered: '已过滤',
  failed: '处理失败'
}[status] || status);

const showMessage = (text, type = 'success') => {
  message.text = text;
  message.type = type;
};

const fetchConfig = async () => {
  try {
    const data = await api.get('/fofa/config');
    config.email = data.email || '';
    config.apiKeyConfigured = Boolean(data.apiKeyConfigured);
    config.apiKeyHint = data.apiKeyHint || '';
    config.usingEnvironmentKey = Boolean(data.usingEnvironmentKey);
  } catch (err) {
    showMessage('读取 FOFA 配置失败: ' + err.message, 'error');
  }
};

const saveConfig = async (silent = false) => {
  savingConfig.value = true;
  try {
    const data = await api.post('/fofa/config', {
      email: config.email,
      apiKey: config.apiKey
    });
    config.email = data.email || config.email;
    config.apiKey = '';
    config.apiKeyConfigured = Boolean(data.apiKeyConfigured);
    config.apiKeyHint = data.apiKeyHint || '';
    config.usingEnvironmentKey = Boolean(data.usingEnvironmentKey);
    if (!silent) showMessage('FOFA 凭据已保存');
    return true;
  } catch (err) {
    showMessage('保存 FOFA 凭据失败: ' + err.message, 'error');
    return false;
  } finally {
    savingConfig.value = false;
  }
};

const clearApiKey = async () => {
  if (!confirm('确定清除本机保存的 FOFA API Key 吗？')) return;
  savingConfig.value = true;
  try {
    const data = await api.post('/fofa/config', {
      email: config.email,
      clearApiKey: true
    });
    config.apiKey = '';
    config.apiKeyConfigured = Boolean(data.apiKeyConfigured);
    config.apiKeyHint = data.apiKeyHint || '';
    config.usingEnvironmentKey = Boolean(data.usingEnvironmentKey);
    showMessage('已清除本机保存的 FOFA API Key');
  } catch (err) {
    showMessage('清除 FOFA API Key 失败: ' + err.message, 'error');
  } finally {
    savingConfig.value = false;
  }
};

const clearPollTimer = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};

const schedulePoll = (delay = 1000) => {
  clearPollTimer();
  pollTimer = setTimeout(fetchJob, delay);
};

const fetchJob = async () => {
  const jobId = job.value?.id || localStorage.getItem('sub_fofa_job_id');
  if (!jobId) return;

  polling.value = true;
  try {
    const data = await api.get(`/fofa/jobs/${jobId}`);
    job.value = data;
    if (isRunning.value) {
      schedulePoll(1000);
    } else {
      clearPollTimer();
      localStorage.removeItem('sub_fofa_job_id');
      if (data.stats?.imported > 0) emit('data-changed');
    }
  } catch (err) {
    clearPollTimer();
    localStorage.removeItem('sub_fofa_job_id');
    showMessage('读取 FOFA 任务状态失败: ' + err.message, 'error');
  } finally {
    polling.value = false;
  }
};

const refreshJob = async () => {
  clearPollTimer();
  await fetchJob();
};

const startScan = async () => {
  if (!queries.value.trim()) {
    showMessage('请至少填写一条 FOFA 查询语句', 'error');
    return;
  }
  if (!config.email) {
    showMessage('请先填写 FOFA 账号邮箱', 'error');
    return;
  }
  if (!hasCredential.value) {
    showMessage('请先填写 FOFA API Key', 'error');
    return;
  }

  starting.value = true;
  message.text = '';
  try {
    const saved = await saveConfig(true);
    if (!saved) return;
    const data = await api.post('/fofa/scan', {
      queries: queries.value,
      ...options
    }, { timeout: 30000 });
    job.value = data;
    localStorage.setItem('sub_fofa_job_id', data.id);
    schedulePoll(500);
  } catch (err) {
    showMessage('启动 FOFA 扫描失败: ' + err.message, 'error');
  } finally {
    starting.value = false;
  }
};

const cancelScan = async () => {
  if (!job.value?.id) return;
  cancelling.value = true;
  try {
    const data = await api.post(`/fofa/jobs/${job.value.id}/cancel`);
    job.value = data;
    schedulePoll(500);
  } catch (err) {
    showMessage('停止 FOFA 扫描失败: ' + err.message, 'error');
  } finally {
    cancelling.value = false;
  }
};

watch(queries, value => localStorage.setItem('sub_fofa_queries', value));

onMounted(async () => {
  await fetchConfig();
  await fetchJob();
});

onBeforeUnmount(clearPollTimer);
</script>

<style scoped>
.fofa-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  max-width: 760px;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 9px;
}

.credential-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.credential-pill.ready {
  color: var(--success);
  background: rgba(16, 185, 129, 0.09);
  border: 1px solid rgba(16, 185, 129, 0.22);
}

.credential-pill.missing {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.09);
  border: 1px solid rgba(245, 158, 11, 0.22);
}

.scope-notice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.5;
}

.scope-notice svg {
  flex-shrink: 0;
}

.message-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
}

.message-banner.success {
  color: var(--success);
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.message-banner.error {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.message-close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: currentColor;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.compact-header {
  margin-bottom: 16px;
}

.credentials-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(180px, 0.65fr);
  gap: 16px;
  align-items: start;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.form-group label,
.option-field > span,
.note-label {
  color: var(--text-main);
  font-size: 12.5px;
  font-weight: 600;
}

.field-hint {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.45;
}

.credential-note {
  min-height: 68px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 10px 12px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--text-dim);
}

.credential-note strong {
  color: var(--text-main);
  font-family: var(--font-mono);
  font-size: 12px;
}

.scan-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(330px, 0.85fr);
  gap: 20px;
  align-items: stretch;
}

.query-card,
.options-card {
  min-width: 0;
}

.query-card {
  display: flex;
  flex-direction: column;
}

.line-count {
  padding: 3px 8px;
  color: var(--text-muted);
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.query-textarea {
  flex: 1;
  min-height: 228px;
  line-height: 1.7;
  tab-size: 2;
}

.query-card > .field-hint {
  margin-top: 8px;
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.option-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.option-field input {
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.option-field small {
  color: var(--text-dim);
  font-size: 10.5px;
}

.auto-import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.auto-import-row > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.auto-import-title {
  color: var(--text-main);
  font-size: 12.5px;
  font-weight: 600;
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
  width: 14px;
  height: 14px;
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

.task-card {
  min-width: 0;
}

.task-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.task-heading {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.task-heading h3,
.results-header h3 {
  font-size: 15px;
  font-weight: 650;
}

.task-id {
  display: block;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  white-space: nowrap;
}

.task-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 9px;
  color: var(--primary);
  background: var(--primary-light);
}

.task-icon.completed {
  color: var(--success);
  background: rgba(16, 185, 129, 0.1);
}

.task-icon.failed,
.task-icon.cancelled {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.09);
}

.task-state-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-state {
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--primary);
  background: var(--primary-light);
  font-size: 11px;
  font-weight: 600;
}

.task-state.completed {
  color: var(--success);
  background: rgba(16, 185, 129, 0.1);
}

.task-state.failed,
.task-state.cancelled {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.09);
}

.phase-label {
  color: var(--text-dim);
  font-size: 11.5px;
}

.progress-block {
  margin-top: 18px;
}

.progress-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.progress-copy strong {
  color: var(--text-main);
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
}

.progress-value {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary), #06b6d4);
  transition: width 0.35s ease;
}

.progress-track.indeterminate .progress-value {
  width: 32% !important;
  animation: indeterminate 1.2s ease-in-out infinite;
}

@keyframes indeterminate {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(320%); }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.stat-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.stat-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
  font-size: 10.5px;
  white-space: nowrap;
}

.stat-item strong {
  color: var(--text-main);
  font-family: var(--font-mono);
  font-size: 16px;
}

.stat-item.success strong {
  color: var(--success);
}

.stat-item.danger strong {
  color: var(--danger);
}

.task-error,
.task-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
}

.task-error {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.18);
}

.task-warning {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.18);
}

.task-error svg,
.task-warning svg {
  flex-shrink: 0;
}

.query-errors {
  margin-top: 12px;
  padding: 11px 12px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.query-errors-title {
  margin-bottom: 7px;
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
}

.query-error-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 4px 0;
  color: var(--text-muted);
  font-size: 11px;
}

.query-error-row code {
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-main);
  white-space: nowrap;
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--border-subtle);
}

.results-header > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.results-header span {
  color: var(--text-dim);
  font-size: 10.5px;
}

.results-empty {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 12px;
}

.results-table-wrap {
  margin-top: 12px;
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.results-table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
  font-size: 11.5px;
  text-align: left;
}

.results-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 9px 11px;
  color: var(--text-muted);
  background: var(--bg-table-header);
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  white-space: nowrap;
}

.results-table td {
  max-width: 360px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.results-table tbody tr:last-child td {
  border-bottom: none;
}

.results-table tbody tr:hover {
  background: var(--bg-table-hover);
}

.result-status {
  display: inline-flex;
  padding: 3px 7px;
  border-radius: 5px;
  color: var(--text-muted);
  background: var(--bg-card-subtle);
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}

.result-status.imported,
.result-status.valid {
  color: var(--success);
  background: rgba(16, 185, 129, 0.1);
}

.result-status.blocked,
.result-status.failed,
.result-status.unreachable {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.09);
}

.result-status.filtered,
.result-status.duplicate {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.09);
}

.result-target,
.result-query,
.result-message {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-target {
  color: var(--text-main);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
}

.result-query {
  max-width: 320px;
  margin-top: 3px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
}

.result-message {
  max-width: 360px;
  color: var(--text-muted);
}

.number-cell {
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

@media (max-width: 1120px) {
  .credentials-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .credential-note {
    grid-column: 1 / -1;
    min-height: auto;
  }

  .scan-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .header-actions .btn {
    flex: 1;
  }

  .credential-pill {
    width: 100%;
    justify-content: center;
  }

  .credentials-grid,
  .options-grid {
    grid-template-columns: 1fr;
  }

  .query-textarea {
    min-height: 260px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-state-wrap {
    width: 100%;
    justify-content: space-between;
  }

  .query-error-row {
    flex-direction: column;
    gap: 3px;
  }

  .query-error-row code {
    max-width: 100%;
  }
}
</style>

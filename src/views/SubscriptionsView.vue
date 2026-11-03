<template>
  <div class="subs-container">
    <!-- Header with Actions -->
    <div class="view-header">
      <div>
        <h2>机场订阅管理 ({{ subs.length }})</h2>
        <p class="subtitle">支持粘贴标准 Base64 订阅链接、Clash/Mihomo YAML 订阅、Sing-box 订阅及单节点链接</p>
      </div>
      <div class="header-actions">
        <!-- 排序方式选择 -->
        <div class="filter-group">
          <ArrowUpDown :size="15" class="text-dim" />
          <select v-model="sortOrder" class="sort-select">
            <option value="time_desc">添加时间：倒序 (最新在前)</option>
            <option value="time_asc">添加时间：正序 (最早在前)</option>
            <option value="name_asc">名称：A-Z 字母升序</option>
            <option value="node_desc">节点数量：由多到少</option>
          </select>
        </div>

        <!-- 展示视图切换 (网格卡片 / 列表行) -->
        <div class="view-toggle-btns">
          <button
            :class="['toggle-btn', { active: viewMode === 'grid' }]"
            @click="viewMode = 'grid'"
            title="网格卡片视图"
          >
            <LayoutGrid :size="16" />
          </button>
          <button
            :class="['toggle-btn', { active: viewMode === 'list' }]"
            @click="viewMode = 'list'"
            title="一行一行列表视图"
          >
            <List :size="16" />
          </button>
        </div>

        <button class="btn btn-secondary" @click="showRawModal = true">
          <Upload :size="16" />
          <span>直接粘贴节点导入</span>
        </button>
        <button class="btn btn-primary" @click="openAddModal">
          <Plus :size="16" />
          <span>添加机场订阅</span>
        </button>
      </div>
    </div>

    <!-- Subscriptions List -->
    <div v-if="loading && subs.length === 0" class="loading-state">
      <Loader2 class="animate-spin" :size="32" />
      <span>加载订阅中...</span>
    </div>

    <div v-else-if="subs.length === 0" class="empty-card glass">
      <Radio :size="48" class="text-dim" />
      <h3>暂未添加任何机场订阅</h3>
      <p>点击上方「添加机场订阅」，粘贴您的机场订阅链接即可自动同步解析节点</p>
      <button class="btn btn-primary" @click="openAddModal">
        <Plus :size="16" />
        <span>添加首个机场订阅</span>
      </button>
    </div>

    <!-- 1. 网格卡片视图 (Card Grid View) -->
    <div v-else-if="viewMode === 'grid'" class="subs-grid">
      <div v-for="sub in sortedSubs" :key="sub.id" class="sub-card glass">
        <div class="sub-card-top">
          <div class="sub-meta">
            <span class="sub-name">{{ sub.name }}</span>
            <span v-if="sub.ip" class="sub-ip-badge" :title="'订阅地址IP: ' + sub.ip">
              {{ sub.ip }}
            </span>
            <span class="node-count-badge">
              <Layers :size="13" />
              <span>{{ sub.nodeCount || 0 }} 节点</span>
            </span>
          </div>
          <div class="sub-switch">
            <label class="switch">
              <input type="checkbox" :checked="sub.enabled" @change="toggleEnable(sub)" />
              <span class="slider round"></span>
            </label>
          </div>
        </div>

        <div class="sub-url-box glass-sm" @click="copyText(sub.url)">
          <Link2 :size="14" class="text-dim" />
          <span class="url-text">{{ sub.url }}</span>
          <Copy :size="13" class="copy-icon" />
        </div>

        <div class="sub-status-row">
          <div class="status-indicator">
            <span :class="['status-dot', 'dot-' + (sub.lastStatus || 'pending')]"></span>
            <span class="status-text">{{ sub.lastMessage || '待刷新' }}</span>
          </div>
          <div class="last-time" v-if="sub.createTime" title="创建/添加时间">
            {{ formatRelativeTime(sub.createTime) }}
          </div>
        </div>

        <div class="sub-card-footer">
          <div class="auto-refresh-tag" title="定时后台自动更新">
            <Clock :size="13" />
            <span>{{ sub.autoRefresh ? '定时刷新 (每6小时)' : '手动刷新' }}</span>
          </div>
          <div class="card-btn-group">
            <button class="icon-btn" title="立即刷新" @click="refreshSub(sub)" :disabled="refreshingId === sub.id">
              <RefreshCw :size="15" :class="{ 'animate-spin': refreshingId === sub.id }" />
            </button>
            <button class="icon-btn" title="查看所属节点" @click="$emit('view-nodes', sub.id)">
              <Eye :size="15" />
            </button>
            <button class="icon-btn" title="编辑订阅" @click="openEditModal(sub)">
              <Edit3 :size="15" />
            </button>
            <button class="icon-btn btn-trash" title="删除订阅" @click="deleteSub(sub)">
              <Trash2 :size="15" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. 一行一行列表视图 (List Row View) -->
    <div v-else class="card glass no-padding list-table-card">
      <div class="table-responsive">
        <table class="subs-table">
          <thead>
            <tr>
              <th width="60">状态</th>
              <th>订阅备注 / 名称</th>
              <th>订阅链接 (URL)</th>
              <th width="110">节点数量</th>
              <th width="130">同步状态</th>
              <th width="140">添加时间</th>
              <th width="160">更新策略</th>
              <th width="140">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sub in sortedSubs" :key="sub.id" :class="{ 'row-disabled': !sub.enabled }">
              <td>
                <label class="switch switch-sm">
                  <input type="checkbox" :checked="sub.enabled" @change="toggleEnable(sub)" />
                  <span class="slider round"></span>
                </label>
              </td>
              <td class="name-col">
                <span class="table-sub-name">{{ sub.name }}</span>
              </td>
              <td class="url-col">
                <div class="table-url-wrap" @click="copyText(sub.url)" title="点击复制订阅链接">
                  <span class="table-url-text">{{ sub.url }}</span>
                  <Copy :size="12" class="table-copy-icon" />
                </div>
                <div v-if="sub.ip" class="table-sub-ip" :title="'订阅地址IP: ' + sub.ip">
                  IP: {{ sub.ip }}
                </div>
              </td>
              <td>
                <span class="node-count-badge">
                  <Layers :size="12" />
                  <span>{{ sub.nodeCount || 0 }} 节点</span>
                </span>
              </td>
              <td>
                <div class="status-indicator">
                  <span :class="['status-dot', 'dot-' + (sub.lastStatus || 'pending')]"></span>
                  <span class="status-text">{{ sub.lastMessage || '待刷新' }}</span>
                </div>
              </td>
              <td>
                <span class="date-text" :title="sub.createTime ? new Date(sub.createTime).toLocaleString() : ''">
                  {{ sub.createTime ? formatRelativeTime(sub.createTime) : '-' }}
                </span>
              </td>
              <td>
                <div class="strategy-info">
                  <span class="strategy-tag">
                    <Clock :size="12" />
                    <span>{{ sub.autoRefresh ? '自动刷新' : '手动刷新' }}</span>
                  </span>
                  <span
                    class="strategy-last-update"
                    :title="sub.lastUpdate ? new Date(sub.lastUpdate).toLocaleString() : '尚未成功更新'"
                  >
                    上次更新：{{ sub.lastUpdate ? formatRelativeTime(sub.lastUpdate) : '尚未更新' }}
                  </span>
                </div>
              </td>
              <td>
                <div class="table-btn-group">
                  <button class="icon-btn" title="立即刷新" @click="refreshSub(sub)" :disabled="refreshingId === sub.id">
                    <RefreshCw :size="14" :class="{ 'animate-spin': refreshingId === sub.id }" />
                  </button>
                  <button class="icon-btn" title="查看所属节点" @click="$emit('view-nodes', sub.id)">
                    <Eye :size="14" />
                  </button>
                  <button class="icon-btn" title="编辑订阅" @click="openEditModal(sub)">
                    <Edit3 :size="14" />
                  </button>
                  <button class="icon-btn btn-trash" title="删除订阅" @click="deleteSub(sub)">
                    <Trash2 :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Subscription Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="showModal = false">
      <div :class="['modal-card', 'glass', isEditing ? 'modal-lg' : '']">
        <div class="modal-header">
          <h3>{{ isEditing ? '编辑机场订阅' : '添加新机场订阅' }}</h3>
          <button class="modal-close" @click="showModal = false">×</button>
        </div>

        <form @submit.prevent="submitSubForm" class="modal-body">
          <div class="form-group">
            <label>订阅名称 / 备注 (留空自动命名为 sub-1, sub-2...)</label>
            <input v-model="form.name" type="text" placeholder="留空则自动分配递增名称 (例如 sub-1)" />
          </div>

          <div class="form-group">
            <label>订阅链接 (URL，支持多行，按IP去重自动跳过)</label>
            <textarea
              v-model="form.url"
              placeholder="https://airport.com/api/v1/client/subscribe?token=xxx&#10;支持每行一条，多条自动批量添加并按IP跳过重复订阅"
              rows="3"
              required
            ></textarea>
            <span class="input-hint">支持每行一条订阅链接，相同IP的订阅将自动跳过；支持 Clash / V2Ray / 原生 Base64 等</span>
          </div>

          <div class="checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.autoRefresh" />
              <span>开启后台定时自动刷新（获取最新节点）</span>
            </label>
          </div>

          <!-- 编辑模式下展示：该订阅下的节点列表与一键测速 -->
          <div v-if="isEditing" class="sub-nodes-panel glass-sm">
            <div class="sub-nodes-panel-header">
              <div class="sub-nodes-title-wrap">
                <span class="sub-nodes-title">订阅节点与测速</span>
                <span class="sub-nodes-stats-badge" v-if="subNodes.length > 0">
                  共 {{ subNodes.length }} 节点 ({{ subAliveCount }} 可用 / {{ subFailedCount }} 失败 / {{ subUntestedCount }} 未测)
                </span>
              </div>
              <button
                type="button"
                class="btn btn-primary btn-sm btn-sub-test"
                :disabled="subNodesTesting || subNodes.length === 0"
                @click="testAllSubNodes"
                title="一键并发测试该订阅下所有节点的延迟"
              >
                <RefreshCw v-if="subNodesTesting" :size="13" class="animate-spin" />
                <Zap v-else :size="13" />
                <span>{{ subNodesTesting ? '正在并发测速中...' : '一键测试该订阅所有节点' }}</span>
              </button>
            </div>

            <div v-if="loadingSubNodes" class="sub-nodes-loading">
              <Loader2 :size="18" class="animate-spin" />
              <span>正在获取该订阅节点列表...</span>
            </div>

            <div v-else-if="subNodes.length === 0" class="sub-nodes-empty">
              <span>该订阅暂无已解析节点，请保存并同步后查看</span>
            </div>

            <div v-else class="sub-nodes-scroll-wrap">
              <table class="sub-nodes-table">
                <thead>
                  <tr>
                    <th>节点名称</th>
                    <th width="75">协议</th>
                    <th width="190">服务器 : 端口</th>
                    <th width="85">整合状态</th>
                    <th width="95">延迟</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="node in subNodes" :key="node.id">
                    <td class="sub-node-name-cell">
                      <span class="sub-node-name" :title="node.name">{{ node.name }}</span>
                    </td>
                    <td>
                      <span :class="['badge', 'badge-' + (node.type || '').toLowerCase()]">
                        {{ node.type }}
                      </span>
                    </td>
                    <td class="sub-node-server-cell">
                      <div class="server-host-wrap" :title="node.server + ':' + node.port">
                        <span class="server-host">{{ node.server }}</span>
                        <span class="server-port">:{{ node.port }}</span>
                      </div>
                    </td>
                    <td>
                      <span :class="['mini-pill', node.inCombinedSub ? 'pill-in' : 'pill-out']">
                        {{ node.inCombinedSub ? '整合中' : '未整合' }}
                      </span>
                    </td>
                    <td>
                      <span v-if="node.delay && node.delay > 0" :class="['delay-badge', getDelayClass(node.delay)]">
                        {{ node.delay }} ms
                      </span>
                      <span v-else-if="node.delay === -1 || node.status === 'failed'" class="delay-badge delay-failed">
                        超时 / 失败
                      </span>
                      <span v-else class="delay-badge delay-untested">未测速</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="modalError" class="error-msg">
            <AlertCircle :size="16" />
            <span>{{ modalError }}</span>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showModal = false">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting">
              <Loader2 v-if="submitting" class="animate-spin" :size="16" />
              <span>{{ submitting ? '保存并同步中...' : '确定保存' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Paste Raw Nodes Modal -->
    <div v-if="showRawModal" class="modal-backdrop" @click.self="showRawModal = false">
      <div class="modal-card glass modal-lg">
        <div class="modal-header">
          <h3>直接粘贴节点或配置导入</h3>
          <button class="modal-close" @click="showRawModal = false">×</button>
        </div>

        <form @submit.prevent="submitRawImport" class="modal-body">
          <div class="form-group">
            <label>保存分组名称 (留空自动命名为 sub-1, sub-2...)</label>
            <input v-model="rawForm.name" type="text" placeholder="留空则自动分配名称如 sub-1" />
          </div>

          <div class="form-group">
            <label>节点内容 (支持各类链接、多行文本或 Clash YAML)</label>
            <textarea
              v-model="rawForm.rawText"
              placeholder="粘贴包含 vmess://, vless://, ss://, trojan://, hy2:// 或 proxies: 节点的文本..."
              rows="8"
              required
            ></textarea>
          </div>

          <div v-if="rawError" class="error-msg">
            <AlertCircle :size="16" />
            <span>{{ rawError }}</span>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showRawModal = false">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="submittingRaw">
              <Loader2 v-if="submittingRaw" class="animate-spin" :size="16" />
              <span>{{ submittingRaw ? '识别并导入中...' : '识别并导入' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import {
  Plus,
  Radio,
  Layers,
  Link2,
  Copy,
  Clock,
  RefreshCw,
  Zap,
  Eye,
  Edit3,
  Trash2,
  Upload,
  AlertCircle,
  Loader2,
  ArrowUpDown,
  LayoutGrid,
  List
} from 'lucide-vue-next';
import api from '../api';
import { copyToClipboard } from '../utils/clipboard';

const emit = defineEmits(['view-nodes', 'data-changed', 'test-sub']);

const subs = ref([]);
const loading = ref(false);
const refreshingId = ref(null);

// 编辑弹窗中的节点与测速状态
const subNodes = ref([]);
const loadingSubNodes = ref(false);
const subNodesTesting = ref(false);

const subAliveCount = computed(() => subNodes.value.filter(n => n.delay && n.delay > 0).length);
const subFailedCount = computed(() => subNodes.value.filter(n => n.delay === -1 || n.status === 'failed').length);
const subUntestedCount = computed(() => subNodes.value.filter(n => !n.delay || n.delay === 0).length);

// 视图与排序配置（从本地存储读取记忆）
const viewMode = ref(localStorage.getItem('sub_view_mode') || 'grid');
const sortOrder = ref(localStorage.getItem('sub_sort_order') || 'time_desc');

const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const submitting = ref(false);
const modalError = ref('');

const form = reactive({
  name: '',
  url: '',
  autoRefresh: true
});

const showRawModal = ref(false);
const submittingRaw = ref(false);
const rawError = ref('');
const rawForm = reactive({
  name: '',
  rawText: ''
});

// 计算排序后的订阅列表
const sortedSubs = computed(() => {
  const list = [...subs.value];
  if (sortOrder.value === 'time_desc') {
    return list.sort((a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0));
  } else if (sortOrder.value === 'time_asc') {
    return list.sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0));
  } else if (sortOrder.value === 'name_asc') {
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortOrder.value === 'node_desc') {
    return list.sort((a, b) => (b.nodeCount || 0) - (a.nodeCount || 0));
  }
  return list;
});

const fetchSubs = async () => {
  loading.value = true;
  try {
    subs.value = await api.get('/subscriptions');
  } catch (e) {
  } finally {
    loading.value = false;
  }
};

const loadSubNodes = async (subId) => {
  if (!subId) {
    subNodes.value = [];
    return;
  }
  loadingSubNodes.value = true;
  try {
    subNodes.value = await api.get(`/nodes?subId=${subId}`);
  } catch (e) {
    subNodes.value = [];
  } finally {
    loadingSubNodes.value = false;
  }
};

const testAllSubNodes = () => {
  if (!editingId.value || subNodes.value.length === 0) return;
  subNodesTesting.value = true;
  emit('test-sub', editingId.value);
};

const updateSubNodeInPlace = (nodeResult) => {
  if (!nodeResult || !nodeResult.id || !isEditing.value) return;
  const target = subNodes.value.find(n => n.id === nodeResult.id);
  if (target) {
    if (typeof nodeResult.delay === 'number') target.delay = nodeResult.delay;
    if (nodeResult.status) target.status = nodeResult.status;
    if (nodeResult.inCombinedSub !== undefined) target.inCombinedSub = Boolean(nodeResult.inCombinedSub);
    if (nodeResult.lastTestTime) target.lastTestTime = nodeResult.lastTestTime;
  }
};

const updateSubNodesInPlace = (resultsList) => {
  if (!Array.isArray(resultsList) || !isEditing.value) return;
  const map = new Map(resultsList.map(r => [r.id, r]));
  for (let i = 0; i < subNodes.value.length; i++) {
    const n = subNodes.value[i];
    const res = map.get(n.id);
    if (res) {
      if (typeof res.delay === 'number') n.delay = res.delay;
      if (res.status) n.status = res.status;
      if (res.inCombinedSub !== undefined) n.inCombinedSub = Boolean(res.inCombinedSub);
      if (res.lastTestTime) n.lastTestTime = res.lastTestTime;
    }
  }
  subNodesTesting.value = false;
};

const updateSubInPlace = (updatedSub) => {
  if (!updatedSub || !updatedSub.id) return;
  const idx = subs.value.findIndex(s => s.id === updatedSub.id);
  if (idx !== -1) {
    subs.value[idx] = { ...subs.value[idx], ...updatedSub };
  }
};

const getDelayClass = (delay) => {
  if (delay <= 300) return 'delay-fast';
  if (delay <= 800) return 'delay-medium';
  return 'delay-slow';
};

const openAddModal = () => {
  isEditing.value = false;
  editingId.value = null;
  form.name = '';
  form.url = '';
  form.autoRefresh = true;
  modalError.value = '';
  subNodes.value = [];
  subNodesTesting.value = false;
  showModal.value = true;
};

const openEditModal = (sub) => {
  isEditing.value = true;
  editingId.value = sub.id;
  form.name = sub.name;
  form.url = sub.url;
  form.autoRefresh = sub.autoRefresh !== false;
  modalError.value = '';
  subNodesTesting.value = false;
  showModal.value = true;
  loadSubNodes(sub.id);
};

const submitSubForm = async () => {
  modalError.value = '';
  submitting.value = true;
  try {
    if (isEditing.value) {
      await api.put(`/subscriptions/${editingId.value}`, form);
    } else {
      const res = await api.post('/subscriptions', form);
      if (res.skipped) {
        alert(res.message);
      } else if (res.batch) {
        alert(res.message);
      }
    }
    showModal.value = false;
    await fetchSubs();
    emit('data-changed');
  } catch (err) {
    modalError.value = err.message || '操作失败';
  } finally {
    submitting.value = false;
  }
};

const submitRawImport = async () => {
  rawError.value = '';
  submittingRaw.value = true;
  try {
    await api.post('/nodes/import-raw', {
      rawText: rawForm.rawText,
      subName: rawForm.name
    });
    showRawModal.value = false;
    rawForm.rawText = '';
    await fetchSubs();
    emit('data-changed');
  } catch (err) {
    rawError.value = err.message || '解析失败，请检查输入内容';
  } finally {
    submittingRaw.value = false;
  }
};

const toggleEnable = async (sub) => {
  try {
    await api.put(`/subscriptions/${sub.id}`, { enabled: !sub.enabled });
    sub.enabled = !sub.enabled;
    emit('data-changed');
  } catch (e) {}
};

const refreshSub = async (sub) => {
  refreshingId.value = sub.id;
  try {
    await api.post(`/subscriptions/${sub.id}/refresh`);
    await fetchSubs();
    emit('data-changed');
  } catch (err) {
    alert('刷新订阅失败: ' + (err.message || '网络连接超时'));
  } finally {
    refreshingId.value = null;
  }
};

const deleteSub = async (sub) => {
  if (!confirm(`确定要删除机场订阅「${sub.name}」吗？\n该订阅包含的所有关联节点也会一并移除。`)) return;
  try {
    await api.delete(`/subscriptions/${sub.id}`);
    await fetchSubs();
    emit('data-changed');
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
};

const copyText = async (txt) => {
  if (!txt) return;
  const ok = await copyToClipboard(txt);
  if (ok) {
    alert('订阅链接已成功复制到剪贴板！');
  }
};

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const now = Date.now();
  const past = new Date(iso).getTime();
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return `${Math.floor(diffSec / 86400)} 天前`;
};

// 监听视图设置保存到本地存储
watch(viewMode, (v) => localStorage.setItem('sub_view_mode', v));
watch(sortOrder, (s) => localStorage.setItem('sub_sort_order', s));

onMounted(() => {
  fetchSubs();
});

defineExpose({
  fetchSubs,
  updateSubInPlace,
  updateSubNodeInPlace,
  updateSubNodesInPlace
});
</script>

<style scoped>
.subs-container {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* 排序筛选工具 */
.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  padding: 4px 10px;
  border-radius: var(--radius-md);
}

.sort-select {
  border: none !important;
  background: transparent !important;
  padding: 4px 6px !important;
  font-size: 12.5px !important;
  outline: none;
  cursor: pointer;
  color: var(--text-main);
}

/* 切换视图按钮组 */
.view-toggle-btns {
  display: flex;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 3px;
  gap: 2px;
}

.toggle-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.toggle-btn:hover {
  color: var(--text-main);
}

.toggle-btn.active {
  background: var(--primary-light);
  color: var(--primary);
}

/* 网格视图 */
.subs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 20px;
}

.sub-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.sub-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
}

.sub-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sub-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.sub-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.sub-ip-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  white-space: nowrap;
}

.table-sub-ip {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
}

.sub-url-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.sub-url-box:hover {
  border-color: var(--primary);
}

.url-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.copy-icon {
  color: var(--text-dim);
  opacity: 0.6;
}

.sub-url-box:hover .copy-icon {
  opacity: 1;
  color: var(--primary);
}

.sub-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-success { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.5); }
.dot-failed, .dot-error { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); }
.dot-pending { background: #f59e0b; }

.status-text {
  color: var(--text-muted);
  font-size: 12px;
}

.last-time {
  font-size: 11px;
  color: var(--text-dim);
}

.sub-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
  margin-top: 2px;
}

.auto-refresh-tag {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-dim);
}

.card-btn-group, .table-btn-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--bg-card-subtle);
  color: var(--text-main);
}

.btn-trash:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}

/* 一行一行列表表格视图 */
.list-table-card {
  overflow: hidden;
}

.table-responsive {
  overflow-x: auto;
}

.subs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

.subs-table th {
  background: var(--bg-table-header);
  padding: 12px 16px;
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.subs-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.subs-table tr:hover {
  background: var(--bg-table-hover);
}

.row-disabled {
  opacity: 0.65;
}

.table-sub-name {
  font-weight: 600;
  color: var(--text-main);
}

.table-url-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  cursor: pointer;
}

.table-url-text {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-url-wrap:hover .table-url-text {
  color: var(--primary);
}

.table-copy-icon {
  color: var(--text-dim);
  flex-shrink: 0;
}

.strategy-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.strategy-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.strategy-last-update {
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.date-text {
  font-size: 12px;
  color: var(--text-muted);
}

/* Switch UI */
.switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 20px;
}
.switch-sm {
  width: 32px;
  height: 18px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--border-color);
  transition: .3s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
}

.switch-sm .slider:before {
  height: 12px;
  width: 12px;
  left: 3px;
  bottom: 3px;
}

input:checked + .slider {
  background-color: var(--primary);
}

input:checked + .slider:before {
  transform: translateX(18px);
}
.switch-sm input:checked + .slider:before {
  transform: translateX(14px);
}

.slider.round {
  border-radius: 34px;
}

.slider.round:before {
  border-radius: 50%;
}

.empty-card {
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}

.empty-card h3 {
  font-size: 18px;
}

.empty-card p {
  color: var(--text-muted);
  max-width: 400px;
  font-size: 13px;
}

.checkbox-group {
  margin-top: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.checkbox-label input {
  width: auto;
}

.input-hint {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 4px;
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef4444;
  font-size: 12px;
  background: rgba(239, 68, 68, 0.1);
  padding: 10px 14px;
  border-radius: 6px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 20px;
  color: var(--text-muted);
}

/* Sub Nodes Panel inside Edit Modal */
.sub-nodes-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  margin-top: 6px;
}

.sub-nodes-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.sub-nodes-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sub-nodes-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-main);
}

.sub-nodes-stats-badge {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
}

.btn-sub-test {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sub-nodes-loading,
.sub-nodes-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.sub-nodes-scroll-wrap {
  max-height: 250px;
  overflow-y: auto;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
}

.sub-nodes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}

.sub-nodes-table th {
  background: var(--bg-table-header);
  padding: 8px 12px;
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 2;
}

.sub-nodes-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.sub-nodes-table tr:hover {
  background: var(--bg-table-hover);
}

.sub-node-name-cell {
  max-width: 180px;
}

.sub-node-name {
  font-weight: 500;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.sub-node-server-cell {
  max-width: 190px;
}

.server-host-wrap {
  display: flex;
  align-items: center;
  max-width: 190px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.server-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: #2563eb;
}
[data-theme="dark"] .server-host {
  color: #93c5fd;
}

.server-port {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}
[data-theme="dark"] .server-port {
  color: #cbd5e1;
}

.mini-pill {
  display: inline-flex;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 600;
}

.pill-in {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}
[data-theme="dark"] .pill-in {
  color: #34d399;
}

.pill-out {
  background: var(--bg-card-subtle);
  color: var(--text-dim);
  border: 1px solid var(--border-subtle);
}

.delay-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}

.delay-fast {
  color: #059669;
}
[data-theme="dark"] .delay-fast {
  color: #34d399;
}

.delay-medium {
  color: #d97706;
}
[data-theme="dark"] .delay-medium {
  color: #fbbf24;
}

.delay-slow {
  color: #dc2626;
}
[data-theme="dark"] .delay-slow {
  color: #f87171;
}

.delay-failed {
  color: #dc2626;
  font-size: 10.5px;
}

.delay-untested {
  color: var(--text-dim);
  font-size: 10.5px;
}

@media (max-width: 768px) {
  .subs-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
  }

  .filter-group {
    flex: 1;
    min-width: 140px;
  }

  .sort-select {
    width: 100%;
  }

  .header-actions .btn {
    flex: 1;
    justify-content: center;
  }

  .sub-card {
    padding: 16px 14px;
  }

  .sub-footer {
    flex-wrap: wrap;
    gap: 8px;
  }

  .sub-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>

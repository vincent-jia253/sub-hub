<template>
  <div class="nodes-container">
    <!-- Header with Filters & Bulk Actions -->
    <div class="view-header">
      <div>
        <h2>节点列表与测速 ({{ filteredNodes.length }} / {{ totalNodesCount }})</h2>
        <p class="subtitle">实时监控节点延迟、支持失败自动重试、整合订阅状态维护、关键字检索及一键失效过滤</p>
      </div>

      <div class="header-actions">
        <button
          class="btn btn-primary"
          @click="startSpeedTest"
          :disabled="isTesting || filteredNodes.length === 0"
          title="手动测试当前筛选节点（超时时额外自动重试3次，失败则移出整合订阅）"
        >
          <Activity :size="16" :class="{ 'animate-spin': isTesting }" />
          <span>{{ isTesting ? `测速中 (${testProgress.current}/${testProgress.total})` : '测试当前筛选节点 (含3次重试)' }}</span>
        </button>

        <button
          class="btn btn-secondary"
          @click="startSpeedMeasure"
          :disabled="speedTesting || filteredNodes.length === 0"
          title="通过每个节点真实下载一个文件（默认 Cloudflare 30MB 测速点）算出实际带宽，比延迟更能反映真实体感；结果写入「网速」列"
        >
          <Gauge :size="16" />
          <span>{{ speedTesting ? '网速测速中...' : '测网速（当前筛选）' }}</span>
        </button>

        <button
          class="btn btn-secondary"
          @click="startBundleTest"
          :disabled="bundleBusy || filteredNodes.length === 0"
          title="先跑延迟（3 次重试），再对存活节点跑真实网速；定时任务用的是同一套编排"
        >
          <Layers :size="16" />
          <span>延迟 + 网速 一起测</span>
        </button>

        <div class="clear-menu-wrap">
          <button
            class="btn btn-secondary"
            @click="showClearMenu = !showClearMenu"
            :disabled="nodes.length === 0"
            title="清理延迟 / 网速的测速结果"
          >
            <Eraser :size="16" />
            <span>清理结果</span>
            <ChevronDown :size="14" />
          </button>
          <div v-if="showClearMenu" class="clear-menu glass">
            <div class="clear-menu-title">
              {{ selectedIds.length > 0 ? `已选中 ${selectedIds.length} 个节点` : `当前筛选 ${filteredNodes.length} 个节点` }}
            </div>
            <button class="clear-menu-item" @click="doClearResults(['delay'])">
              <Clock :size="13" /> 清理延迟结果
            </button>
            <button class="clear-menu-item" @click="doClearResults(['speed'])">
              <Gauge :size="13" /> 清理网速结果
            </button>
            <button class="clear-menu-item" @click="doClearResults(['delay', 'speed'])">
              <Layers :size="13" /> 清理延迟 + 网速
            </button>
            <div class="clear-menu-divider"></div>
            <button class="clear-menu-item danger" @click="doClearResults(['delay', 'speed'], true)">
              <Trash2 :size="13" /> 清理全部节点（含未筛选）
            </button>
          </div>
          <div v-if="showClearMenu" class="clear-menu-backdrop" @click="showClearMenu = false"></div>
        </div>

        <button class="btn btn-secondary" @click="deduplicateNodes">
          <Copy :size="16" />
          <span>节点去重</span>
        </button>

        <button
          v-if="selectedIds.length > 0"
          class="btn btn-secondary"
          @click="batchIncludeInCombined(true)"
          title="将选中节点纳入整合订阅"
        >
          <ShieldCheck :size="16" class="text-success" />
          <span>设为纳入整合 ({{ selectedIds.length }})</span>
        </button>

        <button
          v-if="selectedIds.length > 0"
          class="btn btn-secondary"
          @click="batchIncludeInCombined(false)"
          title="将选中节点移出整合订阅"
        >
          <ShieldAlert :size="16" class="text-warning" />
          <span>移出整合 ({{ selectedIds.length }})</span>
        </button>

        <button
          v-if="selectedIds.length > 0"
          class="btn btn-danger"
          @click="batchDeleteSelected"
        >
          <span>批量删除 ({{ selectedIds.length }})</span>
        </button>
      </div>
    </div>

    <!-- Filter Toolbar -->
    <div class="toolbar glass">
      <div class="search-box">
        <Search :size="16" class="text-dim" />
        <input
          v-model="filters.keyword"
          type="text"
          placeholder="按名称、服务器 IP 或域名搜索..."
        />
      </div>

      <div class="filter-selects">
        <select v-model="filters.subId">
          <option value="">全部所属订阅</option>
          <option v-for="sub in subs" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
        </select>

        <select v-model="filters.protocol">
          <option value="">全部协议类型</option>
          <option value="vmess">VMess</option>
          <option value="vless">VLESS</option>
          <option value="ss">Shadowsocks</option>
          <option value="ssr">ShadowsocksR</option>
          <option value="trojan">Trojan</option>
          <option value="hysteria2">Hysteria 2</option>
          <option value="hysteria">Hysteria 1</option>
          <option value="tuic">TUIC</option>
          <option value="socks5">SOCKS5 / HTTP</option>
        </select>

        <select v-model="filters.status">
          <option value="">全部测速状态</option>
          <option value="alive">仅可用节点</option>
          <option value="failed">仅失效节点</option>
          <option value="untested">未测速节点</option>
        </select>

        <select v-model="filters.inCombinedSub">
          <option value="">全部整合状态</option>
          <option value="true">处于整合订阅中</option>
          <option value="false">未在整合订阅中</option>
        </select>

        <button
          v-if="sortKey"
          class="btn btn-secondary btn-sm sort-reset-btn"
          :title="'清除排序，恢复服务端返回的原始顺序'"
          @click="clearSort"
        >
          <ArrowUpDown :size="14" />
          <span>{{ activeSortLabel }}</span>
          <X :size="13" class="sort-reset-x" />
        </button>

        <button class="btn btn-secondary btn-sm" @click="fetchNodes">
          <RefreshCw :size="14" />
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- Nodes Table Card -->
    <div class="card glass no-padding table-card">
      <div v-if="loading" class="loading-state">
        <Loader2 class="animate-spin" :size="32" />
        <span>正在加载节点...</span>
      </div>

      <div v-else-if="filteredNodes.length === 0" class="empty-state">
        <Radio :size="40" class="text-dim" />
        <p>没有匹配的节点数据</p>
      </div>

      <div v-else class="table-responsive">
        <table class="nodes-table">
          <thead>
            <tr>
              <th width="36">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                />
              </th>
              <th
                v-for="col in sortableColumns"
                :key="col.key"
                :width="col.width || undefined"
                :class="['th-sortable', { 'th-sorted': sortKey === col.key }]"
                :aria-sort="sortAria(col.key)"
                :title="`${col.label} — 点击切换：升序 / 降序 / 取消排序`"
                @click="toggleSort(col.key)"
              >
                <span class="th-inner">
                  <span>{{ col.label }}</span>
                  <component :is="sortIcon(col.key)" :size="13" class="sort-icon" />
                </span>
              </th>
              <th width="145" class="th-actions">操作</th>            </tr>
          </thead>
          <tbody>
            <tr
              v-for="node in pagedNodes"
              :key="node.id"
              :class="{ 'row-selected': selectedIds.includes(node.id) }"
            >
              <td>
                <input
                  type="checkbox"
                  :value="node.id"
                  v-model="selectedIds"
                />
              </td>

              <td class="node-name-cell">
                <div class="node-name-wrap" :title="node.name">
                  <span class="node-name">{{ node.name }}</span>
                  <span class="sub-source" v-if="getSubName(node.subId)">
                    {{ getSubName(node.subId) }}
                  </span>
                </div>
              </td>

              <td>
                <span :class="['badge', 'badge-' + (node.type || '').toLowerCase()]">
                  {{ node.type }}
                </span>
              </td>

              <td class="node-server-cell">
                <div class="server-host-wrap" :title="node.server + ':' + node.port">
                  <span class="server-host">{{ node.server }}</span>
                  <span class="server-port">:{{ node.port }}</span>
                </div>
              </td>

              <td class="node-net-cell">
                <span class="net-tag">{{ node.network || 'tcp' }}</span>
                <span v-if="node.tls" class="tls-tag">TLS</span>
              </td>

              <!-- 处于整合订阅中状态 -->
              <td>
                <button
                  :class="['combined-toggle-pill', node.inCombinedSub ? 'in-combined' : 'out-combined']"
                  @click="toggleNodeCombined(node)"
                  :title="node.inCombinedSub ? '点击将此节点移出整合订阅' : '点击将此节点加入整合订阅'"
                >
                  <ShieldCheck v-if="node.inCombinedSub" :size="13" />
                  <ShieldAlert v-else :size="13" />
                  <span>{{ node.inCombinedSub ? '整合中' : '未整合' }}</span>
                </button>
              </td>

              <td>
                <div class="delay-wrapper">
                  <span
                    v-if="node.delay && node.delay > 0"
                    :class="getDelayClass(node.delay)"
                  >
                    {{ node.delay }} ms
                  </span>
                  <span v-else-if="node.delay === -1 || node.status === 'failed'" class="delay-failed">
                    超时 / 失败
                  </span>
                  <span v-else class="delay-untested">未测速</span>
                </div>
              </td>

              <td class="node-speed-cell">
                <div class="speed-wrapper" :title="speedTooltip(node)">
                  <template v-if="node.speedStatus === 'ok' && node.speed > 0">
                    <span :class="['speed-value', getSpeedClass(node.speed)]">
                      {{ formatSpeed(node.speed) }}
                    </span>
                    <span class="speed-sub">{{ formatSpeedMeta(node) }}</span>
                  </template>
                  <span v-else-if="node.speedStatus === 'failed'" class="speed-failed">
                    测速失败
                  </span>
                  <span v-else class="speed-untested">未测</span>
                </div>
              </td>

              <td>
                <div class="table-actions">
                  <button
                    class="action-btn"
                    title="单独测延迟 (超时自动重试3次)"
                    @click="testSingleNode(node)"
                    :disabled="testingNodeIds.has(node.id)"
                  >
                    <RefreshCw v-if="testingNodeIds.has(node.id)" :size="14" class="animate-spin text-primary" />
                    <Zap v-else :size="14" />
                  </button>
                  <button
                    class="action-btn"
                    title="单独测网速（真实下载带宽）"
                    @click="speedTestSingleNode(node)"
                    :disabled="speedTestingIds.has(node.id)"
                  >
                    <Loader2 v-if="speedTestingIds.has(node.id)" :size="14" class="animate-spin text-primary" />
                    <Gauge v-else :size="14" />
                  </button>
                  <button class="action-btn" title="清空该节点的延迟与网速结果" @click="clearNodeResults(node)">
                    <Eraser :size="14" />
                  </button>
                  <button class="action-btn" title="编辑节点" @click="openEditNode(node)">
                    <Edit3 :size="14" />
                  </button>
                  <button class="action-btn btn-del" title="删除节点" @click="deleteNode(node)">
                    <Trash2 :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="pagination-footer" v-if="filteredNodes.length > pageSize">
        <span class="page-info">
          显示 {{ (currentPage - 1) * pageSize + 1 }} - {{ Math.min(currentPage * pageSize, filteredNodes.length) }} 项，共 {{ filteredNodes.length }} 项
        </span>
        <div class="page-buttons">
          <button
            class="btn btn-secondary btn-sm"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            上一页
          </button>
          <span class="current-page-num">{{ currentPage }} / {{ totalPages }}</span>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="currentPage >= totalPages"
            @click="currentPage++"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Node Modal -->
    <div v-if="showEditModal" class="modal-backdrop" @click.self="showEditModal = false">
      <div class="modal-card glass">
        <div class="modal-header">
          <h3>编辑节点参数</h3>
          <button class="modal-close" @click="showEditModal = false">×</button>
        </div>

        <form @submit.prevent="submitEditNode" class="modal-body">
          <div class="form-group">
            <label>节点名称 (备注)</label>
            <input v-model="editForm.name" type="text" required />
          </div>

          <div class="form-row">
            <div class="form-group col-8">
              <label>服务器地址 (IP / 域名)</label>
              <input v-model="editForm.server" type="text" required />
            </div>
            <div class="form-group col-4">
              <label>端口</label>
              <input v-model.number="editForm.port" type="number" required />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group col-6">
              <label>协议类型</label>
              <input :value="editForm.type" disabled />
            </div>
            <div class="form-group col-6" v-if="editForm.cipher">
              <label>加密方式</label>
              <input v-model="editForm.cipher" type="text" />
            </div>
          </div>

          <div class="form-group" v-if="editForm.uuid">
            <label>UUID / 密码</label>
            <input v-model="editForm.uuid" type="text" />
          </div>

          <div class="form-group" v-if="editForm.password">
            <label>密码</label>
            <input v-model="editForm.password" type="text" />
          </div>

          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editForm.inCombinedSub" />
              <span>纳入整合订阅 (导出 Clash / Base64 时包含此节点)</span>
            </label>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showEditModal = false">取消</button>
            <button type="submit" class="btn btn-primary">保存修改</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import {
  Activity,
  Trash2,
  Copy,
  Search,
  RefreshCw,
  Zap,
  Edit3,
  Radio,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Gauge,
  Eraser,
  ChevronDown,
  Clock,
  Layers,
  X
} from 'lucide-vue-next';
import api from '../api';

const props = defineProps({
  initialSubId: { type: String, default: '' },
  isTesting: { type: Boolean, default: false },
  testProgress: { type: Object, default: () => ({ current: 0, total: 0 }) }
});

const emit = defineEmits(['start-test', 'data-changed']);

const nodes = ref([]);
const subs = ref([]);
const loading = ref(false);
const selectedIds = ref([]);
const testingNodeIds = ref(new Set());
const speedTesting = ref(false);
const speedTestingIds = ref(new Set());
const bundleBusy = ref(false);
const showClearMenu = ref(false);

const currentPage = ref(1);
const pageSize = ref(30);

/* ---------------- 表头排序 ---------------- */
const SORT_STORAGE_KEY = 'sub_nodes_sort';

// 可排序列定义（顺序即表头顺序）
const sortableColumns = [
  { key: 'name', label: '节点名称', width: '' },
  { key: 'type', label: '协议', width: '85' },
  { key: 'server', label: '服务器 : 端口', width: '190' },
  { key: 'network', label: '网络 / 伪装', width: '95' },
  { key: 'inCombinedSub', label: '整合订阅', width: '115' },
  { key: 'delay', label: '延迟', width: '110' },
  { key: 'speed', label: '网速', width: '120' }
];
const SORT_KEYS = sortableColumns.map(c => c.key);

// 每列的"第一次点击"方向：整合订阅默认降序（整合中在前），其余升序
const SORT_FIRST_DIR = {
  name: 'asc',
  type: 'asc',
  server: 'asc',
  network: 'asc',
  inCombinedSub: 'desc',
  delay: 'asc',
  speed: 'asc'
};

const sortKey = ref('');
const sortDir = ref('asc');

// 恢复上次排序
try {
  const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || 'null');
  if (saved && SORT_KEYS.includes(saved.key)) {
    sortKey.value = saved.key;
    sortDir.value = saved.dir === 'desc' ? 'desc' : 'asc';
  }
} catch (e) {}

const clearSort = () => {
  sortKey.value = '';
  sortDir.value = 'asc';
  currentPage.value = 1;
};

const toggleSort = (key) => {
  const first = SORT_FIRST_DIR[key] || 'asc';
  if (sortKey.value !== key) {
    sortKey.value = key;
    sortDir.value = first;
  } else if (sortDir.value === first) {
    sortDir.value = first === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = '';
    sortDir.value = 'asc';
  }
  currentPage.value = 1;
};

const sortAria = (key) => {
  if (sortKey.value !== key) return 'none';
  return sortDir.value === 'asc' ? 'ascending' : 'descending';
};

const sortIcon = (key) => {
  if (sortKey.value !== key) return ArrowUpDown;
  return sortDir.value === 'asc' ? ArrowUp : ArrowDown;
};

const activeSortLabel = computed(() => {
  const col = sortableColumns.find(c => c.key === sortKey.value);
  if (!col) return '';
  return `${col.label} ${sortDir.value === 'asc' ? '升序' : '降序'}`;
});

watch([sortKey, sortDir], ([k, d]) => {
  try {
    if (!k) localStorage.removeItem(SORT_STORAGE_KEY);
    else localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: k, dir: d }));
  } catch (e) {}
});

// 中文/数字友好的比较器
const nameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

const ipv4ToNumber = (host) => {
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  if (parts.some(p => p > 255)) return null;
  return parts.reduce((acc, p) => acc * 256 + p, 0);
};

const netKey = (n) => `${(n.network || 'tcp').toLowerCase()} ${n.tls ? '1' : '0'}`;

// 延迟排序分组：0=有有效延迟，1=超时/失败，2=未测速（永远排在最后）
const delayRank = (n) => {
  if (n.delay && n.delay > 0) return 0;
  if (n.delay === -1 || n.status === 'failed') return 1;
  return 2;
};

// 网速排序分组：0=有有效速率，1=测速失败，2=未测（永远排在最后）
const speedRank = (n) => {
  if (n.speedStatus === 'ok' && n.speed > 0) return 0;
  if (n.speedStatus === 'failed') return 1;
  return 2;
};

const compareBy = (key) => (a, b) => {
  switch (key) {
    case 'name':
      return nameCollator.compare(a.name || '', b.name || '');
    case 'type':
      return nameCollator.compare((a.type || '').toLowerCase(), (b.type || '').toLowerCase());
    case 'server': {
      const na = ipv4ToNumber(a.server);
      const nb = ipv4ToNumber(b.server);
      if (na !== null && nb !== null) return na - nb;
      return nameCollator.compare(a.server || '', b.server || '');
    }
    case 'network':
      return nameCollator.compare(netKey(a), netKey(b));
    case 'inCombinedSub': {
      const va = a.inCombinedSub ? 1 : 0;
      const vb = b.inCombinedSub ? 1 : 0;
      if (va !== vb) return va - vb;
      return nameCollator.compare(a.name || '', b.name || '');
    }
    case 'delay': {
      const ra = delayRank(a);
      const rb = delayRank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.delay - b.delay;
      return nameCollator.compare(a.name || '', b.name || '');
    }
    case 'speed': {
      const ra = speedRank(a);
      const rb = speedRank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.speed || 0) - (b.speed || 0);
      return nameCollator.compare(a.name || '', b.name || '');
    }
    default:
      return 0;
  }
};
/* ---------------- /表头排序 ---------------- */

const filters = reactive({
  keyword: '',
  subId: props.initialSubId || '',
  protocol: '',
  status: '',
  inCombinedSub: ''
});

// Edit Node Modal State
const showEditModal = ref(false);
const editForm = reactive({});

watch(() => props.initialSubId, (newVal) => {
  if (newVal !== undefined) {
    filters.subId = newVal;
  }
});

const fetchSubs = async () => {
  try {
    subs.value = await api.get('/subscriptions');
  } catch (e) {}
};

const fetchNodes = async () => {
  loading.value = true;
  try {
    nodes.value = await api.get('/nodes');
    testingNodeIds.value.clear();
  } catch (e) {
  } finally {
    loading.value = false;
  }
};

const getSubName = (subId) => {
  if (subId === 'manual') return '手动导入';
  const s = subs.value.find(sub => sub.id === subId);
  return s ? s.name : '';
};

const totalNodesCount = computed(() => nodes.value.length);
const failedNodesCount = computed(() => nodes.value.filter(n => n.delay === -1 || n.status === 'failed').length);

const filteredNodes = computed(() => {
  let list = nodes.value;
  if (filters.subId) {
    list = list.filter(n => n.subId === filters.subId);
  }
  if (filters.protocol) {
    list = list.filter(n => n.type === filters.protocol);
  }
  if (filters.status) {
    if (filters.status === 'alive') list = list.filter(n => n.delay && n.delay > 0);
    else if (filters.status === 'failed') list = list.filter(n => n.delay === -1 || n.status === 'failed');
    else if (filters.status === 'untested') list = list.filter(n => !n.delay || n.delay === 0);
  }
  if (filters.inCombinedSub !== '') {
    const wantIn = filters.inCombinedSub === 'true';
    list = list.filter(n => Boolean(n.inCombinedSub) === wantIn);
  }
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    list = list.filter(n =>
      (n.name && n.name.toLowerCase().includes(kw)) ||
      (n.server && n.server.toLowerCase().includes(kw))
    );
  }
  return list;
});

// 在筛选结果上应用排序（排序只影响展示顺序，不改动后端数据）
const sortedNodes = computed(() => {
  const list = filteredNodes.value;
  const key = sortKey.value;
  if (!key) return list;

  const dir = sortDir.value === 'desc' ? -1 : 1;
  const arr = list.slice();

  // 延迟 / 网速：无数据（超时、失败、未测）永远排末尾，不随升降序翻转
  if (key === 'delay' || key === 'speed') {
    const rankOf = key === 'delay' ? delayRank : speedRank;
    const valueOf = (n) => (key === 'delay' ? (n.delay || 0) : (n.speed || 0));
    arr.sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (valueOf(a) - valueOf(b)) * dir;
      return nameCollator.compare(a.name || '', b.name || '');
    });
    return arr;
  }

  const cmp = compareBy(key);
  arr.sort((a, b) => cmp(a, b) * dir);
  return arr;
});

const totalPages = computed(() => Math.ceil(filteredNodes.value.length / pageSize.value) || 1);

const pagedNodes = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return sortedNodes.value.slice(start, start + pageSize.value);
});

// 筛选条件变化时回到第一页，避免停留在被筛空的页码
watch(filters, () => {
  currentPage.value = 1;
});

const isAllSelected = computed(() => {
  if (pagedNodes.value.length === 0) return false;
  return pagedNodes.value.every(n => selectedIds.value.includes(n.id));
});

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    const pagedIdSet = new Set(pagedNodes.value.map(n => n.id));
    selectedIds.value = selectedIds.value.filter(id => !pagedIdSet.has(id));
  } else {
    const currentSet = new Set(selectedIds.value);
    pagedNodes.value.forEach(n => currentSet.add(n.id));
    selectedIds.value = Array.from(currentSet);
  }
};

const getDelayClass = (delay) => {
  if (delay <= 300) return 'delay-fast';
  if (delay <= 800) return 'delay-medium';
  return 'delay-slow';
};

const startSpeedTest = () => {
  // 按当前展示顺序测速
  const targetIds = sortedNodes.value.map(n => n.id);
  emit('start-test', targetIds);
};

const testSingleNode = (node) => {
  testingNodeIds.value.add(node.id);
  emit('start-test', [node.id]);
};

/* ---------------- 网速（真实带宽） ---------------- */
const startSpeedMeasure = async () => {
  if (speedTesting.value || filteredNodes.value.length === 0) return;
  speedTesting.value = true;
  try {
    await api.post('/nodes/speed-test', { ids: sortedNodes.value.map(n => n.id) });
  } catch (e) {
    speedTesting.value = false;
    alert('启动网速测速失败: ' + e.message);
  }
};

const clearSpeedTesting = () => {
  speedTesting.value = false;
};

const formatSpeed = (mbps) => {
  if (!(mbps > 0)) return '0';
  if (mbps >= 100) return `${Math.round(mbps)} Mbps`;
  return `${mbps.toFixed(1)} Mbps`;
};

const formatSpeedMeta = (node) => {
  const mb = node.speedBytes ? node.speedBytes / 1048576 : 0;
  const sec = node.speedDurationMs ? node.speedDurationMs / 1000 : 0;
  if (!mb || !sec) return '';
  return `${mb.toFixed(1)}MB / ${sec.toFixed(1)}s`;
};

const getSpeedClass = (mbps) => {
  if (mbps >= 50) return 'speed-fast';
  if (mbps >= 10) return 'speed-medium';
  return 'speed-slow';
};

const speedTooltip = (node) => {
  if (node.speedStatus === 'ok' && node.speed > 0) {
    const time = node.speedTime ? new Date(node.speedTime).toLocaleString() : '未知';
    return `实测带宽 ${formatSpeed(node.speed)}｜下载 ${formatSpeedMeta(node)}｜首字节 ${node.speedFirstByteMs || 0} ms｜测试时间 ${time}\n测试目标：${node.speedUrl || '-'}`;
  }
  if (node.speedStatus === 'failed') {
    return `测速失败：${node.speedError || '下载无数据'}\n时间：${node.speedTime ? new Date(node.speedTime).toLocaleString() : '-'}`;
  }
  return '尚未测网速，点击该行的仪表盘图标或工具栏「测网速」开始';
};

// 单节点网速测速
const speedTestSingleNode = async (node) => {
  if (speedTestingIds.value.has(node.id)) return;
  speedTestingIds.value.add(node.id);
  try {
    await api.post('/nodes/speed-test', { ids: [node.id] });
  } catch (e) {
    speedTestingIds.value.delete(node.id);
    alert('启动网速测速失败: ' + e.message);
  }
};

// 延迟 + 网速 捆绑测速
const startBundleTest = async () => {
  if (bundleBusy.value || filteredNodes.value.length === 0) return;
  bundleBusy.value = true;
  try {
    await api.post('/nodes/test-bundle', {
      ids: sortedNodes.value.map(n => n.id),
      mode: 'both'
    });
  } catch (e) {
    alert('启动测速失败: ' + e.message);
  } finally {
    bundleBusy.value = false;
  }
};

// 清理测速结果
const doClearResults = async (types, useAll = false) => {
  showClearMenu.value = false;
  const label = types.includes('delay') && types.includes('speed') ? '延迟与网速' : (types.includes('delay') ? '延迟' : '网速');
  const target = useAll
    ? `全部 ${nodes.value.length} 个节点`
    : (selectedIds.value.length > 0
      ? `选中的 ${selectedIds.value.length} 个节点`
      : `当前筛选的 ${filteredNodes.value.length} 个节点`);
  if (!confirm(`确定清理 ${target} 的 ${label} 结果吗？`)) return;

  const payload = { types };
  if (!useAll) {
    payload.ids = selectedIds.value.length > 0
      ? [...selectedIds.value]
      : sortedNodes.value.map(n => n.id);
  }

  try {
    const res = await api.post('/nodes/clear-results', payload);
    await fetchNodes();
    emit('data-changed');
    if (res && typeof res.count === 'number') {
      console.log(`[clear] 已清理 ${res.count} 个节点的 ${label} 结果`);
    }
  } catch (e) {
    alert('清理失败: ' + e.message);
  }
};

const clearNodeResults = async (node) => {
  if (!confirm(`清空「${node.name}」的延迟与网速结果？`)) return;
  try {
    await api.post('/nodes/clear-results', { ids: [node.id], types: ['delay', 'speed'] });
    Object.assign(node, {
      delay: 0,
      status: 'untested',
      lastTestTime: null,
      speed: null,
      speedMbps: 0,
      speedBps: 0,
      speedBytes: 0,
      speedDurationMs: 0,
      speedFirstByteMs: 0,
      speedUrl: '',
      speedStatus: 'untested',
      speedError: '',
      speedTime: null
    });
    emit('data-changed');
  } catch (e) {
    alert('清理失败: ' + e.message);
  }
};

const toggleNodeCombined = async (node) => {
  const nextVal = !node.inCombinedSub;
  try {
    await api.put(`/nodes/${node.id}`, { inCombinedSub: nextVal });
    node.inCombinedSub = nextVal;
    emit('data-changed');
  } catch (e) {
    alert('修改状态失败: ' + e.message);
  }
};

const batchIncludeInCombined = async (status) => {
  try {
    await api.post('/nodes/batch-combined-status', {
      ids: selectedIds.value,
      inCombinedSub: status
    });
    await fetchNodes();
    emit('data-changed');
    alert(`已更新 ${selectedIds.value.length} 个节点的整合订阅状态`);
  } catch (e) {
    alert('批量设置失败: ' + e.message);
  }
};

const filterFailedNodes = async () => {
  if (!confirm(`确定要一键过滤并删除所有检测失败的 ${failedNodesCount.value} 个节点吗？`)) return;
  try {
    const res = await api.post('/nodes/filter-failed');
    alert(`已成功清除 ${res.removedCount} 个失败节点`);
    await fetchNodes();
    emit('data-changed');
  } catch (e) {
    alert('操作失败: ' + e.message);
  }
};

const deduplicateNodes = async () => {
  try {
    const res = await api.post('/nodes/deduplicate');
    alert(`去重完成：移除了 ${res.removedCount} 个重复节点`);
    await fetchNodes();
    emit('data-changed');
  } catch (e) {
    alert('操作失败: ' + e.message);
  }
};

const batchDeleteSelected = async () => {
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 个节点吗？`)) return;
  try {
    await api.post('/nodes/batch-delete', { ids: selectedIds.value });
    selectedIds.value = [];
    await fetchNodes();
    emit('data-changed');
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
};

const deleteNode = async (node) => {
  if (!confirm(`确定删除节点「${node.name}」吗？`)) return;
  try {
    await api.delete(`/nodes/${node.id}`);
    await fetchNodes();
    emit('data-changed');
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
};

const openEditNode = (node) => {
  Object.assign(editForm, JSON.parse(JSON.stringify(node)));
  showEditModal.value = true;
};

const submitEditNode = async () => {
  try {
    await api.put(`/nodes/${editForm.id}`, editForm);
    showEditModal.value = false;
    await fetchNodes();
    emit('data-changed');
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
};

const updateNodeInPlace = (nodeResult) => {
  if (!nodeResult || !nodeResult.id) return;
  const target = nodes.value.find(n => n.id === nodeResult.id);
  if (target) {
    if (typeof nodeResult.delay === 'number') target.delay = nodeResult.delay;
    if (nodeResult.status) target.status = nodeResult.status;
    if (nodeResult.inCombinedSub !== undefined) target.inCombinedSub = Boolean(nodeResult.inCombinedSub);
    if (nodeResult.lastTestTime) target.lastTestTime = nodeResult.lastTestTime;
    // 网速测速结果（实时增量更新）
    if (nodeResult.speedStatus) {
      target.speedStatus = nodeResult.speedStatus;
      target.speed = typeof nodeResult.speed === 'number' ? nodeResult.speed : target.speed;
      target.speedBps = nodeResult.speedBps;
      target.speedBytes = nodeResult.speedBytes;
      target.speedDurationMs = nodeResult.speedDurationMs;
      target.speedFirstByteMs = nodeResult.speedFirstByteMs;
      target.speedUrl = nodeResult.speedUrl;
      target.speedError = nodeResult.speedError;
      target.speedTime = nodeResult.speedTime;
    }
  }
  testingNodeIds.value.delete(nodeResult.id);
  speedTestingIds.value.delete(nodeResult.id);
};

const updateNodesInPlace = (resultsList) => {
  if (!Array.isArray(resultsList) || resultsList.length === 0) return;
  const map = new Map(resultsList.map(r => [r.id, r]));
  for (let i = 0; i < nodes.value.length; i++) {
    const node = nodes.value[i];
    const res = map.get(node.id);
    if (res) {
      if (typeof res.delay === 'number') node.delay = res.delay;
      if (res.status) node.status = res.status;
      if (res.inCombinedSub !== undefined) node.inCombinedSub = Boolean(res.inCombinedSub);
      if (res.lastTestTime) node.lastTestTime = res.lastTestTime;
      if (res.speedStatus) {
        node.speedStatus = res.speedStatus;
        node.speed = typeof res.speed === 'number' ? res.speed : node.speed;
        node.speedBps = res.speedBps;
        node.speedBytes = res.speedBytes;
        node.speedDurationMs = res.speedDurationMs;
        node.speedFirstByteMs = res.speedFirstByteMs;
        node.speedUrl = res.speedUrl;
        node.speedError = res.speedError;
        node.speedTime = res.speedTime;
      }
      testingNodeIds.value.delete(node.id);
      speedTestingIds.value.delete(node.id);
    }
  }
};

const clearTestingStates = () => {
  testingNodeIds.value.clear();
  speedTestingIds.value.clear();
};

onMounted(() => {
  fetchSubs();
  fetchNodes();
  // 页面刷新后同步"网速测速是否正在跑"的状态
  api.get('/nodes/speed-test/status')
    .then(res => { speedTesting.value = Boolean(res && res.running); })
    .catch(() => {});
});

defineExpose({
  fetchNodes,
  updateNodeInPlace,
  updateNodesInPlace,
  clearTestingStates,
  clearSpeedTesting
});
</script>

<style scoped>
.nodes-container {
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

.toolbar {
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 240px;
}

.search-box input {
  width: 100%;
}

.filter-selects {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-selects select {
  width: auto;
  min-width: 135px;
  padding: 8px 12px;
}

.table-card {
  overflow: hidden;
}

.table-responsive {
  overflow-x: auto;
}

.nodes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

.nodes-table th {
  background: var(--bg-table-header);
  padding: 10px 12px;
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

/* ---- 可排序表头 ---- */
.nodes-table th.th-sortable {
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease, background 0.15s ease;
}

.nodes-table th.th-sortable:hover {
  color: var(--text-main);
  background: var(--bg-table-hover);
}

.nodes-table th.th-sortable:active {
  background: var(--primary-light);
}

.nodes-table th .th-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1;
}

.nodes-table th .sort-icon {
  flex: none;
  opacity: 0.4;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.nodes-table th.th-sortable:hover .sort-icon {
  opacity: 0.8;
}

.nodes-table th.th-sorted {
  color: var(--primary);
}

.nodes-table th.th-sorted .sort-icon {
  opacity: 1;
}

/* 工具栏里的排序状态小标签 */
.sort-reset-btn {
  gap: 6px;
}

.sort-reset-btn .sort-reset-x {
  opacity: 0.55;
  margin-left: 2px;
}

.sort-reset-btn:hover .sort-reset-x {
  opacity: 1;
  color: var(--danger, #ef4444);
}

/* ---- 清理结果下拉菜单 ---- */
.clear-menu-wrap {
  position: relative;
  display: inline-block;
}

.clear-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 224px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.22);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.clear-menu-title {
  font-size: 11px;
  color: var(--text-dim);
  padding: 4px 8px 6px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 4px;
}

.clear-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: none;
  background: transparent;
  color: var(--text-main);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.clear-menu-item:hover {
  background: var(--bg-card-hover);
}

.clear-menu-item.danger {
  color: #dc2626;
}

[data-theme="dark"] .clear-menu-item.danger {
  color: #f87171;
}

.clear-menu-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 2px;
}

.clear-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
}

/* ---- 网速（真实带宽）列 ---- */
.node-speed-cell {
  white-space: nowrap;
}

.speed-wrapper {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.25;
}

.speed-value {
  font-weight: 600;
  font-size: 12.5px;
}

.speed-fast { color: #059669; }
.speed-medium { color: #2563eb; }
.speed-slow { color: #d97706; }

[data-theme="dark"] .speed-fast { color: #34d399; }
[data-theme="dark"] .speed-medium { color: #60a5fa; }
[data-theme="dark"] .speed-slow { color: #fbbf24; }

.speed-sub {
  font-size: 10px;
  color: var(--text-dim);
}

.speed-failed {
  color: #dc2626;
  font-size: 12px;
}

[data-theme="dark"] .speed-failed { color: #f87171; }

.speed-untested {
  color: var(--text-dim);
  font-size: 12px;
}

.nodes-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.nodes-table tr:hover {
  background: var(--bg-table-hover);
}

.row-selected {
  background: rgba(79, 70, 229, 0.08) !important;
}

.node-name-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 200px;
}

.node-name {
  font-weight: 500;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-source {
  font-size: 11px;
  color: var(--text-dim);
}

.node-server-cell {
  max-width: 190px;
  width: 190px;
}

.server-host-wrap {
  display: flex;
  align-items: center;
  max-width: 190px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.3;
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

.node-net-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.net-tag {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
}

.tls-tag {
  font-size: 10px;
  padding: 1px 4px;
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
  border-radius: 4px;
  font-weight: 600;
}
[data-theme="dark"] .tls-tag {
  color: #34d399;
}

/* Combined status toggle pill */
.combined-toggle-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
  white-space: nowrap;
}

.in-combined {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border-color: rgba(16, 185, 129, 0.3);
}
.in-combined:hover {
  background: rgba(16, 185, 129, 0.22);
}

.out-combined {
  background: rgba(156, 163, 175, 0.15);
  color: var(--text-dim);
  border-color: var(--border-subtle);
}
.out-combined:hover {
  background: rgba(156, 163, 175, 0.25);
  color: var(--text-main);
}

.delay-wrapper {
  font-family: var(--font-mono);
  font-size: 12px;
}

.th-actions {
  text-align: right;
}

.table-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
  white-space: nowrap;
  flex-shrink: 0;
}

.action-btn {
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

.action-btn:hover {
  background: var(--bg-card-subtle);
  color: var(--text-main);
}

.btn-del:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}

.pagination-footer {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-muted);
}

.page-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.current-page-num {
  font-family: var(--font-mono);
}

.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
}

/* Modal styles */
.modal-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--modal-backdrop);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-card {
  width: 100%;
  max-width: 500px;
  padding: 24px;
  animation: modalIn 0.25s ease-out;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.modal-header h3 {
  font-size: 17px;
  font-weight: 600;
}

.modal-close {
  background: transparent;
  border: none;
  font-size: 20px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
}

.modal-body {
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
  font-size: 12.5px;
  color: var(--text-muted);
  font-weight: 500;
}

.form-row {
  display: flex;
  gap: 12px;
}

.col-4 { flex: 4; }
.col-6 { flex: 6; }
.col-8 { flex: 8; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px !important;
  color: var(--text-main) !important;
}

.checkbox-label input {
  width: auto;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}

@media (max-width: 768px) {
  .toolbar {
    padding: 12px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .search-box {
    min-width: 100%;
  }

  .filter-selects {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    width: 100%;
  }

  .filter-selects select {
    min-width: 0;
    width: 100%;
  }

  .batch-banner {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
  }

  .batch-actions {
    width: 100%;
    flex-wrap: wrap;
    gap: 6px;
  }

  .batch-actions .btn {
    flex: 1;
    justify-content: center;
    font-size: 11.5px;
    padding: 6px 8px;
  }

  .form-row {
    flex-direction: column;
    gap: 10px;
  }

  .col-4, .col-6, .col-8 {
    flex: 1;
    width: 100%;
  }
}
</style>

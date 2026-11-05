<template>
  <div class="app-layout">
    <!-- Login Screen if not logged in -->
    <LoginModal v-if="!isLoggedIn" @login-success="handleLoginSuccess" />

    <!-- Main Dashboard when logged in -->
    <div v-else class="app-shell">
      <!-- Mobile Backdrop -->
      <div
        v-if="isMobileMenuOpen"
        class="mobile-backdrop"
        @click="closeMobileMenu"
      ></div>

      <!-- Sidebar Navigation -->
      <aside :class="['sidebar', 'glass', { 'sidebar-open': isMobileMenuOpen }]">
        <div class="sidebar-brand">
          <div class="brand-logo">
            <Zap :size="24" />
          </div>
          <div class="brand-text">
            <span class="brand-title">SUB</span>
            <span class="brand-sub">Mihomo Core</span>
          </div>
          <button class="mobile-close-btn" @click="closeMobileMenu">
            <X :size="20" />
          </button>
        </div>

        <nav class="sidebar-nav">
          <button
            :class="['nav-item', { active: currentTab === 'dashboard' }]"
            @click="switchTab('dashboard')"
          >
            <LayoutDashboard :size="18" />
            <span>仪表盘概览</span>
          </button>

          <button
            :class="['nav-item', { active: currentTab === 'subscriptions' }]"
            @click="switchTab('subscriptions')"
          >
            <Radio :size="18" />
            <span>机场订阅管理</span>
            <span class="nav-count" v-if="stats.totalSubs">{{ stats.totalSubs }}</span>
          </button>

          <button
            :class="['nav-item', { active: currentTab === 'nodes' }]"
            @click="viewAllNodesMobile"
          >
            <Layers :size="18" />
            <span>节点池与测速</span>
            <span class="nav-count" v-if="stats.totalNodes">{{ stats.totalNodes }}</span>
          </button>

          <button
            :class="['nav-item', { active: currentTab === 'profiles' }]"
            @click="switchTab('profiles')"
          >
            <Shield :size="18" />
            <span>整合订阅 (分流)</span>
          </button>

          <button
            :class="['nav-item', { active: currentTab === 'settings' }]"
            @click="switchTab('settings')"
          >
            <Settings :size="18" />
            <span>系统配置</span>
          </button>

          <button
            :class="['nav-item', { active: currentTab === 'fofa' }]"
            @click="switchTab('fofa')"
          >
            <Radar :size="18" />
            <span>FOFA 订阅发现</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <div class="user-info">
            <div class="user-avatar">
              <User :size="16" />
            </div>
            <div class="user-text">
              <span class="username">{{ currentUser }}</span>
              <span class="user-role">Administrator</span>
            </div>
          </div>
          <button class="logout-btn" title="退出登录" @click="handleLogout">
            <LogOut :size="16" />
          </button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="main-wrapper">
        <!-- Top App Bar -->
        <header class="app-header glass">
          <div class="header-left">
            <button class="mobile-menu-btn" @click="toggleMobileMenu" title="打开导航菜单">
              <Menu :size="20" />
            </button>
            <span class="tab-crumb">{{ tabNames[currentTab] }}</span>
          </div>

          <div class="header-right">
            <div class="status-pill" v-if="isTesting" title="测速任务进行中">
              <span class="pulse-dot"></span>
              <span class="status-pill-text">测速中: {{ activeTestingSummary }}</span>
            </div>

            <!-- Theme Toggle Button (Light by default) -->
            <button
              class="btn btn-secondary btn-sm theme-btn"
              @click="toggleTheme"
              :title="currentTheme === 'light' ? '切换为暗色模式' : '切换为明亮模式'"
            >
              <Sun v-if="currentTheme === 'light'" :size="15" class="text-warning" />
              <Moon v-else :size="15" class="text-primary" />
              <span class="hide-mobile">{{ currentTheme === 'light' ? '明亮' : '暗色' }}</span>
            </button>

            <button class="btn btn-secondary btn-sm" @click="refreshAllData">
              <RefreshCw :size="14" :class="{ 'animate-spin': isRefreshingData }" />
              <span class="hide-mobile">刷新</span>
            </button>
          </div>
        </header>

        <!-- Dynamic View Content -->
        <div class="content-scroll">
          <DashboardView
            v-if="currentTab === 'dashboard'"
            :stats="stats"
            :isTesting="isTesting"
            :refreshingAll="isRefreshingAllSubs"
            @quick-test="handleStartSpeedTest"
            @quick-filter="handleQuickFilter"
            @quick-refresh="handleQuickRefreshAll"
          />

          <SubscriptionsView
            v-else-if="currentTab === 'subscriptions'"
            ref="subsViewRef"
            @view-nodes="handleViewSubNodes"
            @test-sub="handleStartSpeedTestSub"
            @data-changed="refreshAllData"
          />

          <FofaView
            v-else-if="currentTab === 'fofa'"
            @data-changed="refreshAllData"
          />

          <NodesView
            v-else-if="currentTab === 'nodes'"
            ref="nodesViewRef"
            :initialSubId="selectedSubFilter"
            :isTesting="isTesting"
            :testProgress="latestTestProgress"
            @start-test="handleStartSpeedTest"
            @data-changed="fetchStats"
            @sub-filter-change="handleSubFilterChange"
          />

          <ProfilesView
            v-else-if="currentTab === 'profiles'"
            @data-changed="refreshAllData"
          />

          <SettingsView
            v-else-if="currentTab === 'settings'"
            @data-changed="refreshAllData"
          />
        </div>
      </main>
    </div>

    <!-- Live Speed Test Floating Widget Stack (右下角多任务并发气泡堆栈，新任务在下，旧任务依次往上推) -->
    <div class="test-floating-container" v-if="testTasks.length > 0">
      <transition-group name="test-stack">
        <div
          v-for="task in testTasks"
          :key="task.id"
          class="test-floating-card glass"
          :class="['task-' + task.status]"
        >
          <div class="test-card-header">
            <div class="test-header-left">
              <CheckCircle v-if="task.status === 'completed'" :size="16" class="text-success" />
              <AlertCircle v-else-if="task.status === 'error'" :size="16" class="text-danger" />
              <Activity v-else :size="16" class="text-primary animate-pulse" />
              <span class="test-header-title">{{ task.title }}</span>
            </div>
            <div class="test-header-actions">
              <span v-if="task.status === 'completed'" class="autoclose-tag">
                {{ task.closingCountdown }}s 后自动关闭
              </span>
              <button class="test-icon-btn" title="关闭" @click="closeTask(task.id)">×</button>
            </div>
          </div>

          <div class="test-card-body">
            <div class="test-stats-row">
              <div class="test-stat-item">
                <span class="label">进度</span>
                <span class="val">{{ task.current }} / {{ task.total }}</span>
              </div>
              <div class="test-stat-item">
                <span class="label">完成比例</span>
                <span class="val text-primary">{{ task.percentage }}%</span>
              </div>
              <div class="test-stat-item">
                <span class="label">状态</span>
                <span :class="['val', task.status === 'completed' ? 'text-success' : task.status === 'error' ? 'text-danger' : '']">
                  {{ task.status === 'completed' ? '已完成' : task.status === 'error' ? '异常' : '测试中' }}
                </span>
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="progress-container">
              <div
                class="progress-fill"
                :class="{ 'bg-success': task.status === 'completed', 'bg-danger': task.status === 'error' }"
                :style="{ width: task.percentage + '%' }"
              ></div>
            </div>

            <!-- Latest test node line -->
            <div class="latest-tested-box" v-if="task.latest || task.retrying">
              <div class="latest-label">{{ task.retrying ? '节点超时重试中：' : '最新测速节点：' }}</div>
              <div class="latest-row" v-if="task.retrying">
                <span class="latest-name">{{ task.retrying.name }}</span>
                <span class="latest-delay text-warning">
                  重试第 {{ task.retrying.currentRetry }}/{{ task.retrying.totalRetries }} 次
                </span>
              </div>
              <div class="latest-row" v-else-if="task.latest">
                <span class="latest-name">{{ task.latest.name }}</span>
                <span v-if="task.kind === 'speed'" :class="['latest-delay', task.latest.speed > 0 ? 'text-success' : 'text-danger']">
                  {{ task.latest.speed > 0 ? `${task.latest.speed} Mbps` : '测速失败' }}
                </span>
                <span v-else :class="['latest-delay', task.latest.delay > 0 ? 'text-success' : 'text-danger']">
                  {{ task.latest.delay > 0 ? `${task.latest.delay} ms` : '超时/移出' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Auto-close visual countdown line (5s) -->
          <div v-if="task.status === 'completed'" class="autoclose-timer-bar"></div>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import {
  Zap,
  LayoutDashboard,
  Radio,
  Radar,
  Layers,
  Shield,
  Settings,
  User,
  LogOut,
  RefreshCw,
  Activity,
  CheckCircle,
  AlertCircle,
  Sun,
  Moon,
  Menu,
  X
} from 'lucide-vue-next';
import api from './api';
import LoginModal from './components/LoginModal.vue';
import DashboardView from './views/DashboardView.vue';
import SubscriptionsView from './views/SubscriptionsView.vue';
import FofaView from './views/FofaView.vue';
import NodesView from './views/NodesView.vue';
import ProfilesView from './views/ProfilesView.vue';
import SettingsView from './views/SettingsView.vue';

const isLoggedIn = ref(!!localStorage.getItem('sub_token'));
const currentUser = ref(localStorage.getItem('sub_user') || 'admin');
const isMobileMenuOpen = ref(false);

const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value;
};

const closeMobileMenu = () => {
  isMobileMenuOpen.value = false;
};

/* ---------- 路由同步（history 路径）：刷新 / 分享 / 前进后退都停在当前页 ---------- */
const TABS = ['dashboard', 'subscriptions', 'fofa', 'nodes', 'profiles', 'settings'];
// 支持部署在子路径（vite base），根路径时 BASE 为空串
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

const parsePath = () => {
  let p = window.location.pathname || '/';
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length) || '/';
  const seg = p.replace(/^\/+/, '').split('/')[0];
  const tab = TABS.includes(seg) ? seg : 'dashboard';
  const sub = new URLSearchParams(window.location.search).get('sub') || '';
  return { tab, sub: tab === 'nodes' ? sub : '' };
};

const buildPath = (tab, sub) => {
  // 仪表盘用根路径，地址栏最干净
  if (tab === 'dashboard') return `${BASE}/`;
  return `${BASE}/${tab}${tab === 'nodes' && sub ? '?sub=' + encodeURIComponent(sub) : ''}`;
};

const syncPath = (tab = currentTab.value, sub = selectedSubFilter.value, replace = false) => {
  const target = buildPath(tab, sub);
  if (window.location.pathname + window.location.search === target) return;
  // replace 顺手清掉 ?nocache= 之类的临时查询串；push 保留历史记录便于后退
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
};

const handleLocationChange = () => {
  const { tab, sub } = parsePath();
  if (tab !== currentTab.value) currentTab.value = tab;
  if (sub !== selectedSubFilter.value) selectedSubFilter.value = sub;
  // 非法/空路径规范化（/foobar → /dashboard，多余参数清理）
  syncPath(tab, sub, true);
};

const switchTab = (tab) => {
  currentTab.value = tab;
  if (tab !== 'nodes') selectedSubFilter.value = '';
  syncPath(tab, tab === 'nodes' ? selectedSubFilter.value : '');
  closeMobileMenu();
};

// Default Theme is 'light'
const currentTheme = ref(localStorage.getItem('sub_theme') || 'light');

const toggleTheme = () => {
  currentTheme.value = currentTheme.value === 'light' ? 'dark' : 'light';
  localStorage.setItem('sub_theme', currentTheme.value);
  applyTheme(currentTheme.value);
};

const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

// 兼容上一版的 hash 链接（/#nodes → /nodes），老书签不会一下失效
const migrateLegacyHash = () => {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  if (!raw) return false;
  const [tabPart, queryPart] = raw.split('?');
  if (!TABS.includes(tabPart)) return false;
  const sub = new URLSearchParams(queryPart || '').get('sub') || '';
  window.history.replaceState(null, '', buildPath(tabPart, sub));
  return true;
};

const initialRoute = parsePath();
const currentTab = ref(initialRoute.tab);
const selectedSubFilter = ref(initialRoute.sub);
const nodesViewRef = ref(null);
const subsViewRef = ref(null);

const stats = reactive({
  totalSubs: 0,
  totalNodes: 0,
  combinedNodes: 0,
  aliveNodes: 0,
  failedNodes: 0,
  untestedNodes: 0,
  protocols: {}
});

// 多任务并发测速气泡堆栈 (依次往上推)
const testTasks = ref([]);

const isTesting = computed(() => testTasks.value.some(t => t.status === 'testing'));

const activeTestingSummary = computed(() => {
  const active = testTasks.value.filter(t => t.status === 'testing');
  if (active.length === 0) return '';
  if (active.length === 1) {
    return `${active[0].current}/${active[0].total}`;
  }
  return `${active.length} 个任务`;
});

const latestTestProgress = computed(() => {
  const active = testTasks.value.filter(t => t.status === 'testing');
  if (active.length > 0) {
    return active[active.length - 1];
  }
  return { current: 0, total: 0 };
});

const isRefreshingData = ref(false);
const isRefreshingAllSubs = ref(false);

const tabNames = {
  dashboard: '仪表盘概览',
  subscriptions: '机场订阅管理',
  fofa: 'FOFA 订阅发现',
  nodes: '节点池与测速',
  profiles: '整合订阅生成 (Loyalsoldier 规则)',
  settings: '系统配置'
};

const closeTask = (id) => {
  const idx = testTasks.value.findIndex(t => t.id === id);
  if (idx !== -1) {
    if (testTasks.value[idx].autoCloseTimer) {
      clearInterval(testTasks.value[idx].autoCloseTimer);
    }
    testTasks.value.splice(idx, 1);
  }
};

const startTaskAutoClose = (task) => {
  if (task.autoCloseTimer) clearInterval(task.autoCloseTimer);
  task.closingCountdown = 5;
  task.autoCloseTimer = setInterval(() => {
    task.closingCountdown--;
    if (task.closingCountdown <= 0) {
      clearInterval(task.autoCloseTimer);
      task.autoCloseTimer = null;
      closeTask(task.id);
    }
  }, 1000);
};

const handleLoginSuccess = (res) => {
  isLoggedIn.value = true;
  currentUser.value = res.username;
  refreshAllData();
  setupWebSocket();
};

const handleLogout = () => {
  localStorage.removeItem('sub_token');
  localStorage.removeItem('sub_user');
  isLoggedIn.value = false;
};

const fetchStats = async () => {
  try {
    const data = await api.get('/dashboard/stats');
    Object.assign(stats, data);
  } catch (e) {}
};

const refreshAllData = async () => {
  isRefreshingData.value = true;
  try {
    await fetchStats();
    if (nodesViewRef.value && currentTab.value === 'nodes') {
      nodesViewRef.value.fetchNodes();
    }
  } finally {
    isRefreshingData.value = false;
  }
};

const handleViewSubNodes = (subId) => {
  selectedSubFilter.value = subId;
  currentTab.value = 'nodes';
  syncPath('nodes', subId);
};

const handleSubFilterChange = (subId) => {
  const v = subId || '';
  if (selectedSubFilter.value !== v) selectedSubFilter.value = v;
  // 筛选变化只刷新地址栏，不往历史栈里塞记录（后退仍按页面级走）
  if (currentTab.value === 'nodes') syncPath('nodes', v, true);
};

const viewAllNodes = () => {
  selectedSubFilter.value = '';
  currentTab.value = 'nodes';
  syncPath('nodes', '');
};

const viewAllNodesMobile = () => {
  viewAllNodes();
  closeMobileMenu();
};

const handleStartSpeedTest = async (ids) => {
  try {
    const payload = Array.isArray(ids) ? { ids } : {};
    const res = await api.post('/nodes/test-speed', payload);
    const taskId = res.taskId || 'task_' + Date.now();
    const nodeName = res.nodeNames && res.nodeNames.length === 1 ? res.nodeNames[0] : '';
    let task = testTasks.value.find(t => t.id === taskId);
    if (!task) {
      task = {
        id: taskId,
        status: 'testing',
        title: res.total === 1 ? (nodeName ? `节点测速: ${nodeName}` : '单个节点测速中') : 'Mihomo 并发测速中',
        nodeName,
        total: res.total || 0,
        current: 0,
        percentage: 0,
        latest: null,
        retrying: null,
        closingCountdown: 5,
        autoCloseTimer: null
      };
      testTasks.value.push(task);
    }
  } catch (err) {
    alert(err.message);
  }
};

const handleStartSpeedTestSub = async (subId) => {
  try {
    const res = await api.post('/nodes/test-speed', { subId });
    const taskId = res.taskId || 'task_' + Date.now();
    let task = testTasks.value.find(t => t.id === taskId);
    if (!task) {
      task = {
        id: taskId,
        subId,
        status: 'testing',
        title: '订阅节点测速中',
        total: res.total || 0,
        current: 0,
        percentage: 0,
        latest: null,
        retrying: null,
        closingCountdown: 5,
        autoCloseTimer: null
      };
      testTasks.value.push(task);
    }
  } catch (err) {
    alert(err.message);
  }
};

const handleQuickFilter = async () => {
  if (!confirm(`确定过滤并删除所有检测失败的 ${stats.failedNodes} 个节点吗？`)) return;
  try {
    const res = await api.post('/nodes/filter-failed');
    alert(`已清除 ${res.removedCount} 个失效节点`);
    refreshAllData();
  } catch (e) {
    alert('操作失败: ' + e.message);
  }
};

const handleQuickRefreshAll = async () => {
  isRefreshingAllSubs.value = true;
  try {
    await api.post('/subscriptions/refresh-all');
    alert('全部订阅刷新任务已执行完成');
    refreshAllData();
  } catch (e) {
    alert('刷新失败: ' + e.message);
  } finally {
    isRefreshingAllSubs.value = false;
  }
};

// WebSocket setup for real-time latency test progress
let ws = null;
const setupWebSocket = () => {
  if (ws) {
    ws.close();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.port === '5173' ? `${window.location.hostname}:3580` : window.location.host;
  const wsUrl = `${protocol}//${wsHost}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'test_started') {
        const taskId = data.payload.taskId || 'task_' + Date.now();
        let task = testTasks.value.find(t => t.id === taskId);
        const total = data.payload.total || 0;
        const nodeName = data.payload.nodeNames && data.payload.nodeNames.length === 1 ? data.payload.nodeNames[0] : '';
        const title = data.payload.title || (total === 1 ? (nodeName ? `节点测速: ${nodeName}` : '单个节点测速中') : 'Mihomo 并发测速中');
        if (!task) {
          task = {
            id: taskId,
            subId: data.payload.subId,
            kind: data.payload.kind || 'delay',
            status: 'testing',
            title,
            nodeName,
            total,
            current: 0,
            percentage: 0,
            latest: null,
            retrying: null,
            closingCountdown: 5,
            autoCloseTimer: null
          };
          testTasks.value.push(task);
        } else {
          task.total = total || task.total;
          if (data.payload.kind) task.kind = data.payload.kind;
          if (data.payload.title) task.title = data.payload.title;
        }
      } else if (data.type === 'test_progress') {
        const taskId = data.payload.taskId;
        let task = taskId ? testTasks.value.find(t => t.id === taskId) : testTasks.value[testTasks.value.length - 1];
        if (task) {
          if (data.payload.kind) task.kind = data.payload.kind;
          task.current = data.payload.current;
          task.total = data.payload.total || task.total;
          task.latest = data.payload.latest;
          task.retrying = data.payload.retrying;
          task.percentage = task.total ? Math.min(100, Math.round((task.current / task.total) * 100)) : 0;
        }
        // 即时局部更新对应完成测速的单个节点（不刷新整个页面）
        if (data.payload.latest) {
          if (nodesViewRef.value?.updateNodeInPlace) {
            nodesViewRef.value.updateNodeInPlace(data.payload.latest);
          }
          if (subsViewRef.value?.updateSubNodeInPlace) {
            subsViewRef.value.updateSubNodeInPlace(data.payload.latest);
          }
        }
      } else if (data.type === 'test_completed') {
        const taskId = data.payload.taskId;
        let task = taskId ? testTasks.value.find(t => t.id === taskId) : testTasks.value.find(t => t.status === 'testing');
        if (task) {
          task.status = 'completed';
          task.current = task.total;
          task.percentage = 100;
          task.title = task.kind === 'speed'
            ? (task.total === 1 ? '网速测速完成' : '网速测速完成 (' + task.total + ' 个节点)')
            : (task.total === 1 ? '节点测速完成' : '并发测速完成');
          startTaskAutoClose(task);
        }
        if (data.payload.kind === 'speed') {
          nodesViewRef.value?.clearSpeedTesting?.();
        }
        // 局部更新对应节点数据（不刷新整个页面、不重置分页和滚动条）
        if (data.payload.results) {
          if (nodesViewRef.value?.updateNodesInPlace) {
            nodesViewRef.value.updateNodesInPlace(data.payload.results);
          }
          if (subsViewRef.value?.updateSubNodesInPlace) {
            subsViewRef.value.updateSubNodesInPlace(data.payload.results);
          }
        }
        // 静默更新后台统计（不触发全量重载）
        fetchStats();
      } else if (data.type === 'test_error') {
        const taskId = data.payload.taskId;
        let task = taskId ? testTasks.value.find(t => t.id === taskId) : testTasks.value.find(t => t.status === 'testing');
        if (task) {
          task.status = 'error';
          task.title = '测速异常: ' + (data.payload?.error || '执行失败');
          startTaskAutoClose(task);
        } else {
          alert('测速失败: ' + (data.payload?.error || 'Mihomo 内核启动或执行异常'));
        }
        if (nodesViewRef.value?.clearTestingStates) {
          nodesViewRef.value.clearTestingStates();
        }
        if (data.payload?.kind === 'speed' && nodesViewRef.value?.clearSpeedTesting) {
          nodesViewRef.value.clearSpeedTesting();
        }
        fetchStats();
      } else if (data.type === 'subscription_updated') {
        if (data.payload?.sub && subsViewRef.value?.updateSubInPlace) {
          subsViewRef.value.updateSubInPlace(data.payload.sub);
        } else if (subsViewRef.value?.fetchSubs) {
          subsViewRef.value.fetchSubs();
        }
        fetchStats();
      } else if (data.type === 'nodes_cleaned') {
        refreshAllData();
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(() => {
      if (isLoggedIn.value) setupWebSocket();
    }, 3000);
  };
};

onMounted(() => {
  applyTheme(currentTheme.value);
  if (migrateLegacyHash()) {
    const r = parsePath();
    currentTab.value = r.tab;
    selectedSubFilter.value = r.sub;
  }
  // 非法/空路径规范化成 /nodes 这种干净地址
  syncPath(currentTab.value, selectedSubFilter.value, true);
  window.addEventListener('popstate', handleLocationChange);
  if (isLoggedIn.value) {
    refreshAllData();
    setupWebSocket();
  }
  window.addEventListener('auth-expired', handleLogout);
});
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  width: 250px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border-left: none;
  border-top: none;
  border-bottom: none;
  border-right: 1px solid var(--border-color);
  background: var(--bg-card);
  z-index: 50;
  flex-shrink: 0;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 20px;
  border-bottom: 1px solid var(--border-color);
}

.brand-logo {
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, var(--primary) 0%, #06b6d4 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 12px var(--primary-glow);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1.1;
  color: var(--text-main);
}

.brand-sub {
  font-size: 11px;
  color: var(--text-dim);
}

.sidebar-nav {
  flex: 1;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13.5px;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  text-align: left;
}

.nav-item:hover {
  background: var(--bg-card-subtle);
  color: var(--text-main);
}

.nav-item.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
  border-left: 3px solid var(--primary);
}

.nav-count {
  margin-left: auto;
  font-size: 11px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--text-muted);
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-text {
  display: flex;
  flex-direction: column;
}

.username {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--text-main);
}

.user-role {
  font-size: 11px;
  color: var(--text-dim);
}

.logout-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.logout-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

/* Main Area */
.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.app-header {
  height: 64px;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 0;
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card);
  z-index: 40;
}

.tab-crumb {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--text-main);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: var(--primary-light);
  border: 1px solid rgba(79, 70, 229, 0.3);
  border-radius: 999px;
  font-size: 12px;
  color: var(--primary);
  font-weight: 500;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary);
  animation: pulse 1.5s infinite;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Speedtest Floating Widget Stack (右下角优雅悬浮气泡，新任务在下，旧任务依次往上推) */
.test-floating-container {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 14px;
  pointer-events: none;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
}

.test-floating-card {
  position: relative;
  width: 360px;
  max-width: calc(100vw - 40px);
  border-radius: 16px;
  box-shadow: 0 16px 36px -4px rgba(15, 23, 42, 0.22), 0 0 0 1px var(--border-color);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
  overflow: hidden;
  background: var(--bg-card);
}

.test-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.test-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.test-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.autoclose-tag {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  padding: 2px 7px;
  border-radius: 999px;
  font-family: var(--font-mono);
}

.autoclose-timer-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--success, #10b981);
  width: 100%;
  animation: timer-drain 5s linear forwards;
}

@keyframes timer-drain {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

.bg-success {
  background: var(--success, #10b981) !important;
}

.bg-danger {
  background: var(--danger, #ef4444) !important;
}

.test-icon-btn {
  background: transparent;
  border: none;
  font-size: 18px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  transition: all 0.2s;
}

.test-icon-btn:hover {
  background: var(--bg-card-subtle);
  color: var(--text-main);
}

.test-card-body {
  display: flex;
  flex-direction: column;
}

.test-stats-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.test-stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.test-stat-item .label {
  font-size: 11px;
  color: var(--text-dim);
}

.test-stat-item .val {
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-main);
}

.progress-container {
  width: 100%;
  height: 8px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #06b6d4);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.latest-tested-box {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.latest-label {
  color: var(--text-dim);
  font-size: 11px;
}

.latest-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.latest-name {
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.latest-delay {
  font-family: var(--font-mono);
  font-weight: 600;
  flex-shrink: 0;
  font-size: 12px;
}

/* Stack animation: 进入时从下方浮现并向上推，离开时向右平滑滑出并淡出 */
.test-stack-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.test-stack-leave-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.test-stack-move {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.test-stack-enter-from {
  opacity: 0;
  transform: translateY(28px) scale(0.95);
}

.test-stack-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.92);
}

.cursor-pointer {
  cursor: pointer;
}

/* Mobile Responsive Adjustments */
.mobile-menu-btn,
.mobile-close-btn {
  display: none;
  background: transparent;
  border: none;
  color: var(--text-main);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
}

.mobile-close-btn {
  margin-left: auto;
}

.mobile-backdrop {
  display: none;
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .mobile-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .mobile-backdrop {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.5);
    backdrop-filter: blur(4px);
    z-index: 99;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 270px;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
  }

  .sidebar.sidebar-open {
    transform: translateX(0);
  }

  .app-header {
    padding: 0 16px;
    height: 56px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .tab-crumb {
    font-size: 15px;
  }

  .content-scroll {
    padding: 16px;
  }

  .hide-mobile {
    display: none;
  }

  .status-pill {
    padding: 4px 8px;
    font-size: 11px;
  }

  .status-pill-text {
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .test-floating-container {
    right: 12px;
    bottom: 12px;
    left: 12px;
    max-height: 80vh;
  }

  .test-floating-card {
    width: 100%;
    max-width: none;
    padding: 14px 16px;
  }
}
</style>

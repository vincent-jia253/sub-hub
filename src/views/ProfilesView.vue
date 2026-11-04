<template>
  <div class="profiles-container">
    <!-- Header with Action -->
    <div class="view-header">
      <div>
        <h2>整合订阅生成 (分流规则集)</h2>
        <p class="subtitle">汇聚多个机场节点，基于 Loyalsoldier/clash-rules 规则自动构建高可用 Clash / Base64 聚合订阅</p>
      </div>
      <button class="btn btn-primary" @click="openCreateModal">
        <Plus :size="16" />
        <span>新建整合订阅</span>
      </button>
    </div>

    <!-- Profiles List -->
    <div class="profiles-grid">
      <div v-for="prof in profiles" :key="prof.id" class="profile-card glass">
        <div class="profile-card-header">
          <div class="prof-title-box">
            <span class="prof-name">{{ prof.name }}</span>
            <span class="badge badge-vless" v-if="prof.enableLoyalRules">Loyalsoldier Rules</span>
          </div>
          <div class="switch-box">
            <label class="switch">
              <input type="checkbox" :checked="prof.enabled" @change="toggleEnable(prof)" />
              <span class="slider round"></span>
            </label>
          </div>
        </div>

        <!-- Filter Tags -->
        <div class="filter-tags">
          <span class="tag-pill" v-if="prof.onlyAlive">
            <CheckCircle :size="12" class="text-success" />
            <span>仅在线节点</span>
          </span>
          <span class="tag-pill" v-if="prof.maxDelay > 0">
            <Zap :size="12" class="text-warning" />
            <span>延迟 ≤ {{ prof.maxDelay }}ms</span>
          </span>
          <span class="tag-pill" v-if="prof.keywordExclude">
            <Filter :size="12" />
            <span>排除: {{ prof.keywordExclude }}</span>
          </span>
        </div>

        <!-- Subscription Links Display -->
        <div class="sub-links-group">
          <!-- Clash URL -->
          <div class="link-field glass-sm">
            <div class="link-label">
              <span class="link-type">Clash / Mihomo</span>
              <span class="link-desc">适用于 Clash Verge, Clash Meta, Flclash</span>
            </div>
            <div class="link-action-row">
              <span class="link-url">{{ getFullSubUrl(prof.token, 'clash') }}</span>
              <button class="btn btn-secondary btn-sm" @click="copyLink(getFullSubUrl(prof.token, 'clash'), 'clash_' + prof.id)">
                <Check v-if="copiedKey === 'clash_' + prof.id" :size="13" class="text-success" />
                <Copy v-else :size="13" />
                <span>{{ copiedKey === 'clash_' + prof.id ? '已复制！' : '复制链接' }}</span>
              </button>
              <button class="btn btn-secondary btn-sm" title="扫码导入" @click="openQr(prof, 'clash')">
                <QrCode :size="13" />
                <span>二维码</span>
              </button>
            </div>
          </div>

          <!-- Base64 URL -->
          <div class="link-field glass-sm">
            <div class="link-label">
              <span class="link-type">Base64 / 通用订阅</span>
              <span class="link-desc">适用于 v2rayN, Shadowrocket, Quantumult X</span>
            </div>
            <div class="link-action-row">
              <span class="link-url">{{ getFullSubUrl(prof.token, 'base64') }}</span>
              <button class="btn btn-secondary btn-sm" @click="copyLink(getFullSubUrl(prof.token, 'base64'), 'base64_' + prof.id)">
                <Check v-if="copiedKey === 'base64_' + prof.id" :size="13" class="text-success" />
                <Copy v-else :size="13" />
                <span>{{ copiedKey === 'base64_' + prof.id ? '已复制！' : '复制链接' }}</span>
              </button>
              <button class="btn btn-secondary btn-sm" title="扫码导入" @click="openQr(prof, 'base64')">
                <QrCode :size="13" />
                <span>二维码</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Actions Footer -->
        <div class="profile-card-footer">
          <div class="left-actions">
            <button class="btn btn-secondary btn-sm" @click="previewConfig(prof)">
              <Eye :size="14" />
              <span>预览配置</span>
            </button>
          </div>
          <div class="right-actions">
            <button class="icon-btn" title="编辑" @click="openEditModal(prof)">
              <Edit3 :size="15" />
            </button>
            <button class="icon-btn btn-trash" title="删除" @click="deleteProfile(prof)">
              <Trash2 :size="15" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="showModal = false">
      <div class="modal-card glass modal-lg">
        <div class="modal-header">
          <h3>{{ isEditing ? '编辑整合订阅' : '新建整合订阅' }}</h3>
          <button class="modal-close" @click="showModal = false">×</button>
        </div>

        <form @submit.prevent="submitProfile" class="modal-body">
          <div class="form-group">
            <label>整合订阅名称</label>
            <input v-model="form.name" type="text" placeholder="例如：我的主力去广告极速订阅" required />
          </div>

          <!-- Airport Sources Selection -->
          <div class="form-group">
            <label>包含的机场来源 (默认包含所有已启用机场及手动节点)</label>
            <div class="subs-checkbox-list glass-sm">
              <label v-for="s in subs" :key="s.id" class="sub-check-item">
                <input
                  type="checkbox"
                  :value="s.id"
                  v-model="form.subIds"
                />
                <span>{{ s.name }} ({{ s.nodeCount || 0 }} 节点)</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group col-6">
              <label class="checkbox-label">
                <input type="checkbox" v-model="form.onlyAlive" />
                <span>仅包含在线可用节点 (推荐)</span>
              </label>
            </div>
            <div class="form-group col-6">
              <label>最大允许延迟 (ms，0 为不限)</label>
              <input v-model.number="form.maxDelay" type="number" placeholder="例如 1500" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group col-6">
              <label>包含关键词 (多个用竖线 | 分隔)</label>
              <input v-model="form.keywordInclude" type="text" placeholder="例如：香港|日本|新加坡" />
            </div>
            <div class="form-group col-6">
              <label>排除关键词 (多个用竖线 | 分隔)</label>
              <input v-model="form.keywordExclude" type="text" placeholder="例如：官网|维护|倍率" />
            </div>
          </div>

          <!-- Loyalsoldier Rules Section -->
          <div class="rules-box glass-sm">
            <div class="rules-header">
              <Shield class="text-primary" :size="18" />
              <label class="checkbox-label">
                <input type="checkbox" v-model="form.enableLoyalRules" />
                <span class="font-bold">集成 Loyalsoldier/clash-rules 优质分流规则库</span>
              </label>
            </div>
            <p class="rules-desc">
              包含自动选择、故障转移、负载均衡等策略组，以及广告拦截(Reject)、Apple、Google、Telegram、国内外分流等高精细规则集。
            </p>
            <div class="form-group" v-if="form.enableLoyalRules" style="margin-top: 8px;">
              <label>规则源地址 (Rule Provider URL)</label>
              <input v-model="form.ruleProviderUrl" type="text" />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showModal = false">取消</button>
            <button type="submit" class="btn btn-primary">保存配置</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="showPreview" class="modal-backdrop" @click.self="showPreview = false">
      <div class="modal-card glass modal-xl">
        <div class="modal-header">
          <h3>Clash 订阅预览 ({{ previewTarget?.name }})</h3>
          <button class="modal-close" @click="showPreview = false">×</button>
        </div>
        <div class="modal-body">
          <div v-if="previewLoading" class="loading-state">
            <Loader2 class="animate-spin" :size="28" />
            <span>生成配置预览中...</span>
          </div>
          <textarea v-else class="preview-textarea" readonly :value="previewContent"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="copyLink(previewContent, 'preview')">
            <Check v-if="copiedKey === 'preview'" :size="14" class="text-success" />
            <Copy v-else :size="14" />
            <span>{{ copiedKey === 'preview' ? '已复制全部！' : '复制全部文本' }}</span>
          </button>
          <button class="btn btn-primary" @click="showPreview = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- QR Code Modal -->
    <div v-if="showQr" class="modal-backdrop" @click.self="showQr = false">
      <div class="modal-card glass modal-qr">
        <div class="modal-header">
          <div>
            <h3>订阅二维码</h3>
            <p class="qr-subtitle">{{ qrProfile?.name }}</p>
          </div>
          <button class="modal-close" @click="showQr = false">×</button>
        </div>
        <div class="modal-body">
          <div class="qr-tabs">
            <button
              class="qr-tab"
              :class="{ active: qrFormat === 'clash' }"
              @click="switchQrFormat('clash')"
            >Clash / Mihomo</button>
            <button
              class="qr-tab"
              :class="{ active: qrFormat === 'base64' }"
              @click="switchQrFormat('base64')"
            >Base64 / 通用</button>
          </div>

          <div class="qr-canvas-box">
            <canvas ref="qrCanvasRef"></canvas>
          </div>

          <div class="qr-url-box">
            <span class="qr-url">{{ qrUrl }}</span>
            <button class="btn btn-secondary btn-sm" @click="copyLink(qrUrl, 'qr')">
              <Check v-if="copiedKey === 'qr'" :size="13" class="text-success" />
              <Copy v-else :size="13" />
              <span>{{ copiedKey === 'qr' ? '已复制！' : '复制' }}</span>
            </button>
          </div>

          <p class="qr-hint">
            手机客户端里选「扫描二维码 / 从二维码导入」，对准屏幕即可添加，无需手动输入链接。
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="downloadQr">
            <Download :size="14" />
            <span>下载 PNG</span>
          </button>
          <button class="btn btn-primary" @click="showQr = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue';
import {
  Plus,
  Shield,
  CheckCircle,
  Zap,
  Filter,
  Copy,
  Check,
  Eye,
  Edit3,
  Trash2,
  Loader2,
  QrCode,
  Download
} from 'lucide-vue-next';
import QRCode from 'qrcode';
import api from '../api';
import axios from 'axios';
import { copyToClipboard } from '../utils/clipboard';

const profiles = ref([]);
const subs = ref([]);
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const copiedKey = ref('');

const form = reactive({
  name: '',
  subIds: [],
  onlyAlive: true,
  maxDelay: 0,
  keywordInclude: '',
  keywordExclude: '',
  enableLoyalRules: true,
  ruleProviderUrl: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release'
});

const showPreview = ref(false);
const previewLoading = ref(false);
const previewContent = ref('');
const previewTarget = ref(null);

// ---- QR code ----
const showQr = ref(false);
const qrProfile = ref(null);
const qrFormat = ref('clash');
const qrUrl = ref('');
const qrCanvasRef = ref(null);

const renderQr = async () => {
  if (!qrProfile.value) return;
  qrUrl.value = getFullSubUrl(qrProfile.value.token, qrFormat.value);
  await nextTick();
  if (!qrCanvasRef.value) return;
  try {
    await QRCode.toCanvas(qrCanvasRef.value, qrUrl.value, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' }
    });
  } catch (e) {
    console.error('二维码生成失败', e);
  }
};

const openQr = async (prof, format = 'clash') => {
  qrProfile.value = prof;
  qrFormat.value = format;
  showQr.value = true;
  await renderQr();
};

const switchQrFormat = async (format) => {
  if (qrFormat.value === format) return;
  qrFormat.value = format;
  await renderQr();
};

const downloadQr = () => {
  const canvas = qrCanvasRef.value;
  if (!canvas || !qrProfile.value) return;
  const link = document.createElement('a');
  const safeName = (qrProfile.value.name || 'subscription').replace(/[\\/:*?"<>|\s]+/g, '_');
  link.download = `${safeName}_${qrFormat.value}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};

const fetchProfiles = async () => {
  try {
    profiles.value = await api.get('/profiles');
  } catch (e) {}
};

const fetchSubs = async () => {
  try {
    subs.value = await api.get('/subscriptions');
  } catch (e) {}
};

const getFullSubUrl = (token, format = 'clash') => {
  const origin = window.location.origin;
  return `${origin}/sub/${token}?format=${format}`;
};

const copyLink = async (txt, key = '') => {
  const ok = await copyToClipboard(txt);
  if (ok && key) {
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = '';
    }, 2000);
  }
};

const openCreateModal = () => {
  isEditing.value = false;
  editingId.value = null;
  form.name = '我的整合订阅';
  form.subIds = [];
  form.onlyAlive = true;
  form.maxDelay = 0;
  form.keywordInclude = '';
  form.keywordExclude = '';
  form.enableLoyalRules = true;
  form.ruleProviderUrl = 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release';
  showModal.value = true;
};

const openEditModal = (prof) => {
  isEditing.value = true;
  editingId.value = prof.id;
  form.name = prof.name;
  form.subIds = [...(prof.subIds || [])];
  form.onlyAlive = prof.onlyAlive !== false;
  form.maxDelay = prof.maxDelay || 0;
  form.keywordInclude = prof.keywordInclude || '';
  form.keywordExclude = prof.keywordExclude || '';
  form.enableLoyalRules = prof.enableLoyalRules !== false;
  form.ruleProviderUrl = prof.ruleProviderUrl || 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release';
  showModal.value = true;
};

const submitProfile = async () => {
  try {
    if (isEditing.value) {
      await api.put(`/profiles/${editingId.value}`, form);
    } else {
      await api.post('/profiles', form);
    }
    showModal.value = false;
    await fetchProfiles();
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
};

const toggleEnable = async (prof) => {
  try {
    await api.put(`/profiles/${prof.id}`, { enabled: !prof.enabled });
    prof.enabled = !prof.enabled;
  } catch (e) {}
};

const deleteProfile = async (prof) => {
  if (!confirm(`确定删除整合订阅「${prof.name}」吗？`)) return;
  try {
    await api.delete(`/profiles/${prof.id}`);
    await fetchProfiles();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
};

const previewConfig = async (prof) => {
  previewTarget.value = prof;
  showPreview.value = true;
  previewLoading.value = true;
  try {
    const res = await axios.get(getFullSubUrl(prof.token, 'clash'), { responseType: 'text' });
    previewContent.value = res.data;
  } catch (e) {
    previewContent.value = '# 获取预览失败: ' + e.message;
  } finally {
    previewLoading.value = false;
  }
};

onMounted(() => {
  fetchProfiles();
  fetchSubs();
});
</script>

<style scoped>
.profiles-container {
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

.profiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
  gap: 20px;
}

.profile-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.profile-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.prof-title-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.prof-name {
  font-size: 17px;
  font-weight: 600;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-muted);
}

.sub-links-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-field {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
}

.link-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.link-type {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
}

.link-desc {
  font-size: 11px;
  color: var(--text-dim);
}

.link-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.link-url {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding-top: 14px;
}

.right-actions {
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

.subs-checkbox-list {
  max-height: 140px;
  overflow-y: auto;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
}

.sub-check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.sub-check-item input {
  width: auto;
}

.rules-box {
  padding: 14px;
  border-radius: 8px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
}

.rules-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.font-bold {
  font-weight: 600;
}

.rules-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.preview-textarea {
  width: 100%;
  height: 480px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  padding: 14px;
  color: var(--text-main);
  border-radius: var(--radius-md);
}

.modal-xl {
  max-width: 850px;
}

/* QR Code Modal */
.modal-qr {
  max-width: 460px;
}

.qr-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

.qr-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.qr-tab {
  flex: 1;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.qr-tab:hover {
  color: var(--text-main);
}

.qr-tab.active {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 4px 12px var(--primary-glow);
}

.qr-canvas-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #fff;
  border-radius: var(--radius-md);
}

.qr-canvas-box canvas {
  width: 260px !important;
  height: 260px !important;
  display: block;
  image-rendering: pixelated;
}

.qr-url-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-card-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.qr-url {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.4;
}

.qr-hint {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}

/* Switch Styles */
.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}
.switch input { opacity: 0; width: 0; height: 0; }
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
  height: 14px; width: 14px;
  left: 3px; bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
input:checked + .slider { background-color: var(--primary); }
input:checked + .slider:before { transform: translateX(16px); }
.slider.round { border-radius: 34px; }

/* Modals */
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
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-lg {
  max-width: 680px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 24px;
  cursor: pointer;
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.form-row {
  display: flex;
  gap: 12px;
}

.col-6 { flex: 1; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
}

.checkbox-label input {
  width: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 10px;
}

@media (max-width: 768px) {
  .profiles-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .profile-card {
    padding: 16px 14px;
  }

  .form-row {
    flex-direction: column;
    gap: 10px;
  }

  .col-6 {
    flex: 1;
    width: 100%;
  }

  .preview-textarea {
    height: 320px;
    font-size: 11px;
  }
}
</style>

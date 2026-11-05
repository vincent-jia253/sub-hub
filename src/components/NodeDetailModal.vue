<template>
  <div class="nd-backdrop" @click.self="$emit('close')">
    <div class="nd-card glass">
      <!-- 头部 -->
      <div class="nd-head">
        <div class="nd-title-wrap">
          <span class="nd-name" :title="node.name">{{ node.name }}</span>
          <span class="nd-badge">{{ (node.type || '').toUpperCase() }}</span>
          <span class="nd-badge nd-badge-sub" v-if="subName">{{ subName }}</span>
          <span v-if="consecutiveFailures >= 3" class="nd-badge nd-badge-warn" :title="`最近连续 ${consecutiveFailures} 次延迟测速失败`">
            ⚠ 连续失败 {{ consecutiveFailures }} 次
          </span>
        </div>
        <button class="nd-close" @click="$emit('close')">×</button>
      </div>

      <div class="nd-meta">
        <span>{{ node.server }}:{{ node.port }}</span>
        <span class="nd-meta-sep">|</span>
        <span>{{ (node.network || 'tcp').toUpperCase() }}<template v-if="node.tls"> · TLS</template></span>
        <span class="nd-meta-sep">|</span>
        <span :class="node.delay > 0 ? 'nd-good' : 'nd-bad'">{{ node.delay > 0 ? node.delay + ' ms' : (node.delay === -1 ? '超时' : '未测') }}</span>
        <span class="nd-meta-sep" v-if="node.speedStatus === 'ok'">|</span>
        <span v-if="node.speedStatus === 'ok'" class="nd-good">{{ node.speedMbps }} Mbps</span>
      </div>

      <!-- 范围 / 粒度 / 对比 / 导出 -->
      <div class="nd-ranges">
        <button
          v-for="r in ranges"
          :key="r.key"
          :class="['nd-range-btn', { active: rangeKey === r.key }]"
          @click="rangeKey = r.key"
        >{{ r.label }}</button>

        <select v-model="granularity" class="nd-gran" title="折线图采样粒度">
          <option value="auto">自动粒度</option>
          <option value="hour">按小时</option>
          <option value="day">按天</option>
        </select>

        <select v-model="compareId" class="nd-compare" title="选择另一个节点叠加对比折线">
          <option value="">对比：无</option>
          <option v-for="n in compareOptions" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>

        <span class="nd-range-hint">{{ rangeHint }}</span>
        <button class="nd-export" title="导出当前范围的原始记录（CSV，含 BOM 可直接用 Excel 打开）" @click="exportCsv">导出 CSV</button>
      </div>

      <!-- 延迟 -->
      <section class="nd-sec">
        <div class="nd-sec-head">
          <span class="nd-sec-title">延迟测试记录</span>
          <span class="nd-sec-stat" v-if="filteredDelay.length">
            平均 {{ delayStats.avg }} ms · 最低 {{ delayStats.min }} · 最高 {{ delayStats.max }} · 成功率 {{ delayStats.rate }}% · 样本 {{ filteredDelay.length }}
          </span>
          <span class="nd-sec-stat" v-else>该时间范围内没有延迟记录</span>
        </div>

        <div class="nd-blocks" v-if="filteredDelay.length">
          <div
            v-for="(b, i) in delayBlocks"
            :key="'db' + i"
            :class="['nd-block', 'nd-block-' + b.level]"
            :style="{ flexGrow: b.n }"
            @mouseenter="showTip($event, b.tip)"
            @mouseleave="hideTip"
          ></div>
        </div>

        <div class="nd-chart-wrap" v-if="filteredDelay.length">
          <svg class="nd-chart" viewBox="0 0 1000 220" preserveAspectRatio="none">
            <!-- 网格 + 阈值线 -->
            <line v-for="g in delayGrid" :key="'g' + g.y" x1="0" :y1="g.y" x2="1000" :y2="g.y"
                  :stroke="g.threshold ? '#ef4444' : 'rgba(148,163,184,0.28)'"
                  :stroke-width="g.threshold ? 1.2 : 1"
                  :stroke-dasharray="g.threshold ? '6 6' : '0'"></line>
            <text v-for="g in delayGrid" :key="'t' + g.y" x="4" :y="g.y - 4" class="nd-axis">{{ g.label }}</text>

            <!-- 面积 -->
            <path v-for="(a, i) in delayAreaPaths" :key="'a' + i" :d="a" fill="rgba(99,102,241,0.12)" stroke="none"></path>
            <!-- 主折线 -->
            <path v-for="(p, i) in delayPaths" :key="'p' + i" :d="p" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linejoin="round"></path>
            <!-- 对比折线 -->
            <path v-for="(p, i) in compareDelayPaths" :key="'c' + i" :d="p" fill="none" stroke="#f97316" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round"></path>

            <!-- 超时点 -->
            <rect v-for="(d, i) in delayTimeouts" :key="'to' + i" :x="d.x - 3" :y="212" width="6" height="8" fill="#7f1d1d" rx="1"></rect>

            <!-- 热区 -->
            <circle v-for="(d, i) in delayDots" :key="'d' + i" :cx="d.x" :cy="d.y" r="5.5"
                    fill="transparent" style="cursor: crosshair"
                    @mouseenter="showTip($event, d.tip)" @mouseleave="hideTip"></circle>
          </svg>
          <div class="nd-axis-x">
            <span>{{ fmt(rangeAxisStart) }}</span>
            <span>{{ fmt(rangeAxisEnd) }}</span>
          </div>
          <div class="nd-legend" v-if="compareNode">
            <span class="nd-lg nd-lg-main"></span>{{ node.name }}
            <span class="nd-lg nd-lg-cmp"></span>{{ compareNode.name }}
            <span class="nd-lg-note">（色块与统计仅统计本节点）</span>
          </div>
        </div>

        <details class="nd-anomaly" v-if="delayAnomalies.length">
          <summary>异常记录 {{ delayAnomalies.length }} 条（超时 / &gt; 1000 ms）</summary>
          <div class="nd-anomaly-list">
            <div v-for="(a, i) in delayAnomalies" :key="'da' + i" class="nd-anomaly-row">
              <span class="nd-anomaly-time">{{ fmt(a.t) }}</span>
              <span :class="a.d === -1 ? 'nd-bad' : 'nd-warn'">{{ a.d === -1 ? '超时' : a.d + ' ms' }}</span>
            </div>
          </div>
        </details>
      </section>

      <!-- 网速 -->
      <section class="nd-sec">
        <div class="nd-sec-head">
          <span class="nd-sec-title">网速测试记录</span>
          <span class="nd-sec-stat" v-if="filteredSpeed.length">
            平均 {{ speedStats.avg }} Mbps · 峰值 {{ speedStats.max }} · 最低 {{ speedStats.min }} · 样本 {{ filteredSpeed.length }}
          </span>
          <span class="nd-sec-stat" v-else>该时间范围内没有网速记录</span>
        </div>

        <div class="nd-blocks" v-if="filteredSpeed.length">
          <div
            v-for="(b, i) in speedBlocks"
            :key="'sb' + i"
            :class="['nd-block', 'nd-block-' + b.level]"
            :style="{ flexGrow: b.n }"
            @mouseenter="showTip($event, b.tip)"
            @mouseleave="hideTip"
          ></div>
        </div>

        <div class="nd-chart-wrap" v-if="filteredSpeed.length">
          <svg class="nd-chart" viewBox="0 0 1000 220" preserveAspectRatio="none">
            <line v-for="g in speedGrid" :key="'sg' + g.y" x1="0" :y1="g.y" x2="1000" :y2="g.y" stroke="rgba(148,163,184,0.28)" stroke-width="1"></line>
            <text v-for="g in speedGrid" :key="'st' + g.y" x="4" :y="g.y - 4" class="nd-axis">{{ g.label }}</text>

            <path v-for="(a, i) in speedAreaPaths" :key="'sa' + i" :d="a" fill="rgba(16,185,129,0.12)" stroke="none"></path>
            <path v-for="(p, i) in speedPaths" :key="'sp' + i" :d="p" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linejoin="round"></path>
            <path v-for="(p, i) in compareSpeedPaths" :key="'sc' + i" :d="p" fill="none" stroke="#f97316" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round"></path>

            <rect v-for="(d, i) in speedFails" :key="'sf' + i" :x="d.x - 3" :y="212" width="6" height="8" fill="#7f1d1d" rx="1"></rect>

            <circle v-for="(d, i) in speedDots" :key="'sd' + i" :cx="d.x" :cy="d.y" r="5.5"
                    fill="transparent" style="cursor: crosshair"
                    @mouseenter="showTip($event, d.tip)" @mouseleave="hideTip"></circle>
          </svg>
          <div class="nd-axis-x">
            <span>{{ fmt(rangeAxisStart) }}</span>
            <span>{{ fmt(rangeAxisEnd) }}</span>
          </div>
        </div>

        <details class="nd-anomaly" v-if="speedAnomalies.length">
          <summary>异常记录 {{ speedAnomalies.length }} 条（失败 / &lt; 50 Mbps）</summary>
          <div class="nd-anomaly-list">
            <div v-for="(a, i) in speedAnomalies" :key="'sa2' + i" class="nd-anomaly-row">
              <span class="nd-anomaly-time">{{ fmt(a.t) }}</span>
              <span :class="a.s === -1 ? 'nd-bad' : 'nd-warn'">{{ a.s === -1 ? '测速失败' : a.s + ' Mbps' }}</span>
            </div>
          </div>
        </details>
      </section>

      <!-- 健康度 -->
      <div class="nd-health">
        <span>记录区间：{{ fmt(filteredRangeStart) }} → {{ fmt(filteredRangeEnd) }}</span>
        <span class="nd-health-sep">·</span>
        <span :class="consecutiveFailures >= 3 ? 'nd-bad' : consecutiveFailures > 0 ? 'nd-warn' : 'nd-good'">
          连续失败 {{ consecutiveFailures }} 次
        </span>
        <span class="nd-health-sep">·</span>
        <span>最后测速 {{ node.lastTestTime ? fmt(node.lastTestTime) : '—' }}</span>
        <span class="nd-health-sep" v-if="node.speedTime">·</span>
        <span v-if="node.speedTime">最后测速(带宽) {{ fmt(node.speedTime) }}</span>
      </div>

      <!-- 操作 -->
      <div class="nd-actions">
        <button class="btn btn-secondary btn-sm" @click="$emit('test-delay', node)">
          <Zap :size="14" /> 测延迟
        </button>
        <button class="btn btn-secondary btn-sm" @click="$emit('test-speed', node)">
          <Gauge :size="14" /> 测网速
        </button>
        <button class="btn btn-secondary btn-sm" @click="$emit('clear', node)">
          <Eraser :size="14" /> 清空结果
        </button>
        <button class="btn btn-secondary btn-sm" @click="$emit('edit', node)">
          <Edit3 :size="14" /> 编辑
        </button>
        <button class="btn btn-primary btn-sm" @click="$emit('close')">关闭</button>
      </div>
    </div>

    <div v-if="tip.visible" class="nd-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }" v-html="tip.html"></div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Zap, Gauge, Eraser, Edit3 } from 'lucide-vue-next';

const props = defineProps({
  node: { type: Object, required: true },
  subName: { type: String, default: '' },
  allNodes: { type: Array, default: () => [] }
});
defineEmits(['close', 'test-delay', 'test-speed', 'clear', 'edit']);

const ranges = [
  { key: '2h', label: '2 小时', ms: 2 * 3600 * 1000 },
  { key: '4h', label: '4 小时', ms: 4 * 3600 * 1000 },
  { key: '8h', label: '8 小时', ms: 8 * 3600 * 1000 },
  { key: '12h', label: '12 小时', ms: 12 * 3600 * 1000 },
  { key: '24h', label: '24 小时', ms: 24 * 3600 * 1000 },
  { key: '7d', label: '7 天', ms: 7 * 86400 * 1000 },
  { key: '15d', label: '15 天', ms: 15 * 86400 * 1000 },
  { key: '30d', label: '30 天', ms: 30 * 86400 * 1000 }
];

const rangeKey = ref('24h');
const granularity = ref('auto');
const compareId = ref('');
const tip = ref({ visible: false, x: 0, y: 0, html: '' });

const now = Date.now();
const rangeMs = computed(() => (ranges.find(r => r.key === rangeKey.value) || ranges[4]).ms);
const since = computed(() => Date.now() - rangeMs.value);

const compareNode = computed(() => props.allNodes.find(n => n.id === compareId.value && n.id !== props.node.id) || null);
const compareOptions = computed(() => props.allNodes.filter(n => n.id !== props.node.id));

const filteredDelay = computed(() => (props.node.delayHistory || []).filter(h => h.t >= since.value));
const filteredSpeed = computed(() => (props.node.speedHistory || []).filter(h => h.t >= since.value));
const compareDelay = computed(() => (compareNode.value?.delayHistory || []).filter(h => h.t >= since.value));
const compareSpeed = computed(() => (compareNode.value?.speedHistory || []).filter(h => h.t >= since.value));

const fmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const filteredRangeStart = computed(() => {
  const all = [...filteredDelay.value, ...filteredSpeed.value].map(h => h.t);
  return all.length ? Math.min(...all) : 0;
});
const filteredRangeEnd = computed(() => {
  const all = [...filteredDelay.value, ...filteredSpeed.value].map(h => h.t);
  return all.length ? Math.max(...all) : 0;
});
const rangeAxisStart = computed(() => (filteredRangeStart.value || since.value));
const rangeAxisEnd = computed(() => Math.max(filteredRangeEnd.value, rangeAxisStart.value + 60000));
const rangeHint = computed(() => {
  const n = filteredDelay.value.length + filteredSpeed.value.length;
  return `${ranges.find(r => r.key === rangeKey.value).label}内 ${n} 条记录`;
});

/* ---------- 统计 ---------- */
const delayStats = computed(() => {
  const ok = filteredDelay.value.filter(h => h.d > 0).map(h => h.d);
  if (!ok.length) return { avg: '—', min: '—', max: '—', rate: 0 };
  const sum = ok.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round(sum / ok.length),
    min: Math.min(...ok),
    max: Math.max(...ok),
    rate: Math.round((ok.length / filteredDelay.value.length) * 100)
  };
});

const speedStats = computed(() => {
  const ok = filteredSpeed.value.filter(h => h.s > 0).map(h => h.s);
  if (!ok.length) return { avg: '—', min: '—', max: '—' };
  return {
    avg: Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10,
    min: Math.min(...ok),
    max: Math.max(...ok)
  };
});

const consecutiveFailures = computed(() => {
  const list = props.node.delayHistory || [];
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].d === -1) n++;
    else break;
  }
  return n;
});

/* ---------- 色块聚合 ---------- */
const MAX_BLOCKS = 48;

const buildBlocks = (list, valOf, levelOf, unit) => {
  if (!list.length) return [];
  const bucketSize = Math.ceil(list.length / MAX_BLOCKS);
  const out = [];
  for (let i = 0; i < list.length; i += bucketSize) {
    const chunk = list.slice(i, i + bucketSize);
    const vals = chunk.map(valOf).filter(v => v > 0);
    const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : -1;
    out.push({
      n: chunk.length,
      level: levelOf(avg, vals.length === 0),
      tip: `${fmt(chunk[0].t)}${chunk.length > 1 ? ' – ' + fmt(chunk[chunk.length - 1].t) : ''}<br/>${chunk.length} 次 · 均值 ${avg > 0 ? avg + ' ' + unit : '全部失败'}${avg > 0 ? '<br/>最差 ' + Math.max(...vals) + ' ' + unit : ''}`
    });
  }
  return out;
};

const delayBlocks = computed(() => buildBlocks(
  filteredDelay.value, h => h.d, (avg, allFail) => {
    if (allFail || avg === -1) return 'timeout';
    if (avg < 200) return 'fast';
    if (avg < 500) return 'mid';
    if (avg < 1000) return 'slow';
    return 'bad';
  }, 'ms'
));

const speedBlocks = computed(() => buildBlocks(
  filteredSpeed.value, h => h.s, (avg, allFail) => {
    if (allFail || avg === -1) return 'sfail';
    if (avg >= 300) return 'sfast';
    if (avg >= 150) return 'smid';
    if (avg >= 50) return 'sslow';
    return 'sbad';
  }, 'Mbps'
));

/* ---------- 折线数据 ---------- */
const toSeries = (list, valOf, granMode) => {
  if (!list.length) return [];
  const auto = granMode === 'auto';
  const useRaw = auto ? list.length <= 200 : false;
  if (useRaw || (auto && granMode === 'raw')) {
    return list.map(h => ({ t: h.t, v: valOf(h), n: 1 }));
  }
  let bucket = granMode === 'day' ? 86400000 : 3600000;
  if (auto) bucket = list.length <= 600 ? 3600000 : 86400000;
  const map = new Map();
  list.forEach(h => {
    const k = Math.floor(h.t / bucket) * bucket;
    if (!map.has(k)) map.set(k, { t: k, vals: [], total: 0 });
    const rec = map.get(k);
    rec.total++;
    const v = valOf(h);
    if (v > 0) rec.vals.push(v);
  });
  return [...map.values()].sort((a, b) => a.t - b.t).map(rec => ({
    t: rec.t,
    v: rec.vals.length ? Math.round((rec.vals.reduce((a, b) => a + b, 0) / rec.vals.length) * 10) / 10 : -1,
    n: rec.total
  }));
};

const xOf = (t) => {
  const a = rangeAxisStart.value;
  const b = rangeAxisEnd.value;
  if (b <= a) return 500;
  return Math.max(0, Math.min(1000, ((t - a) / (b - a)) * 1000));
};

const buildGeom = (series, yMax) => {
  const yOf = (v) => 210 - (Math.max(0, Math.min(v, yMax)) / yMax) * 190;
  const segs = [];
  let cur = [];
  const fails = [];
  series.forEach((p, i) => {
    const x = xOf(p.t);
    if (p.v < 0) {
      fails.push({ x });
      if (cur.length) { segs.push(cur); cur = []; }
      return;
    }
    cur.push({ x, y: yOf(p.v), ...p, idx: i });
  });
  if (cur.length) segs.push(cur);
  const paths = segs.map(seg => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  const areas = segs.map(seg => {
    if (seg.length < 2) return '';
    const head = `M${seg[0].x.toFixed(1)},210`;
    const body = seg.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const tail = `L${seg[seg.length - 1].x.toFixed(1)},210 Z`;
    return head + ' ' + body + ' ' + tail;
  }).filter(Boolean);
  const dots = series.filter(p => p.v >= 0).map(p => ({
    x: xOf(p.t),
    y: yOf(p.v),
    tip: `${fmt(p.t)} · ${p.n} 次 · 均值 ${p.v}`
  }));
  return { paths, areas, fails, dots };
};

const delaySeries = computed(() => toSeries(filteredDelay.value, h => h.d, granularity.value));
const delayYMax = computed(() => {
  const vals = delaySeries.value.filter(p => p.v > 0).map(p => p.v);
  if (compareNode.value) vals.push(...toSeries(compareDelay.value, h => h.d, granularity.value).filter(p => p.v > 0).map(p => p.v));
  const m = vals.length ? Math.max(...vals) : 1000;
  return Math.max(500, Math.ceil((m * 1.15) / 100) * 100);
});

const delayGeom = computed(() => buildGeom(delaySeries.value, delayYMax.value));
const delayPaths = computed(() => delayGeom.value.paths);
const delayAreaPaths = computed(() => delayGeom.value.areas);
const delayTimeouts = computed(() => delayGeom.value.fails);
const delayDots = computed(() => delayGeom.value.dots.map(d => ({ ...d, tip: d.tip + ' ms' })));

const compareDelayPaths = computed(() => {
  if (!compareNode.value) return [];
  return buildGeom(toSeries(compareDelay.value, h => h.d, granularity.value), delayYMax.value).paths;
});

const delayGrid = computed(() => {
  const yMax = delayYMax.value;
  const rows = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: 210 - f * 190,
    label: Math.round(f * yMax) + ' ms',
    threshold: false
  }));
  [300, 800].forEach(th => {
    if (th <= yMax) rows.push({ y: 210 - (th / yMax) * 190, label: th + ' ms', threshold: true });
  });
  return rows;
});

const speedSeries = computed(() => toSeries(filteredSpeed.value, h => h.s, granularity.value));
const speedYMax = computed(() => {
  const vals = speedSeries.value.filter(p => p.v > 0).map(p => p.v);
  if (compareNode.value) vals.push(...toSeries(compareSpeed.value, h => h.s, granularity.value).filter(p => p.v > 0).map(p => p.v));
  const m = vals.length ? Math.max(...vals) : 100;
  return Math.max(50, Math.ceil((m * 1.15) / 10) * 10);
});
const speedGeom = computed(() => buildGeom(speedSeries.value, speedYMax.value));
const speedPaths = computed(() => speedGeom.value.paths);
const speedAreaPaths = computed(() => speedGeom.value.areas);
const speedFails = computed(() => speedGeom.value.fails);
const speedDots = computed(() => speedGeom.value.dots.map(d => ({ ...d, tip: d.tip + ' Mbps' })));

const compareSpeedPaths = computed(() => {
  if (!compareNode.value) return [];
  return buildGeom(toSeries(compareSpeed.value, h => h.s, granularity.value), speedYMax.value).paths;
});

const speedGrid = computed(() => {
  const yMax = speedYMax.value;
  return [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: 210 - f * 190,
    label: Math.round(f * yMax) + ' Mbps'
  }));
});

/* ---------- 异常明细 ---------- */
const delayAnomalies = computed(() => filteredDelay.value.filter(h => h.d === -1 || h.d > 1000).slice().reverse());
const speedAnomalies = computed(() => filteredSpeed.value.filter(h => h.s === -1 || (h.s > 0 && h.s < 50)).slice().reverse());

/* ---------- tooltip ---------- */
const showTip = (e, html) => {
  tip.value = { visible: true, x: e.clientX + 14, y: e.clientY + 14, html };
};
const hideTip = () => { tip.value.visible = false; };

/* ---------- 导出 ---------- */
const exportCsv = () => {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [];
  lines.push('类型,时间,ISO时间,值,单位');
  filteredDelay.value.forEach(h => {
    lines.push(['延迟', fmt(h.t), new Date(h.t).toISOString(), h.d === -1 ? 'timeout' : h.d, h.d === -1 ? '' : 'ms'].map(esc).join(','));
  });
  filteredSpeed.value.forEach(h => {
    lines.push(['网速', fmt(h.t), new Date(h.t).toISOString(), h.s === -1 ? 'failed' : h.s, h.s === -1 ? '' : 'Mbps'].map(esc).join(','));
  });
  const csv = '\ufeff' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${props.node.name}-${rangeKey.value}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
</script>

<style scoped>
.nd-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 24px;
}

.nd-card {
  width: min(1120px, 96vw);
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 16px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.nd-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.nd-name {
  font-size: 17px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}

.nd-badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-card-subtle, var(--bg-secondary));
  color: var(--text-dim);
}

.nd-badge-sub { background: rgba(99, 102, 241, 0.14); color: var(--primary); }
.nd-badge-warn { background: rgba(239, 68, 68, 0.14); color: #dc2626; }

.nd-close {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-dim);
  cursor: pointer;
}

.nd-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
  flex-wrap: wrap;
}

.nd-meta-sep { opacity: 0.4; }
.nd-good { color: #059669; font-weight: 600; }
.nd-bad { color: #dc2626; font-weight: 600; }
.nd-warn { color: #d97706; font-weight: 600; }

.nd-ranges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}

.nd-range-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-dim);
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nd-range-btn:hover { border-color: var(--primary); color: var(--primary); }

.nd-range-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

.nd-gran, .nd-compare {
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-main);
  width: auto;
}

.nd-range-hint { font-size: 11.5px; color: var(--text-dim); margin-left: auto; }

.nd-export {
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-main);
  cursor: pointer;
}

.nd-export:hover { border-color: var(--primary); color: var(--primary); }

.nd-sec {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  background: var(--bg-secondary);
}

.nd-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.nd-sec-title { font-size: 13px; font-weight: 700; }
.nd-sec-stat { font-size: 11.5px; color: var(--text-dim); }

.nd-blocks {
  display: flex;
  gap: 2px;
  height: 10px;
  margin-bottom: 10px;
}

.nd-block {
  flex: 1 1 0;
  border-radius: 2.5px;
  min-width: 3px;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.nd-block:hover { transform: scaleY(1.7); }

.nd-block-fast { background: #10b981; }
.nd-block-mid { background: #f59e0b; }
.nd-block-slow { background: #f97316; }
.nd-block-bad { background: #ef4444; }
.nd-block-timeout { background: #7f1d1d; }
.nd-block-sfast { background: #10b981; }
.nd-block-smid { background: #f59e0b; }
.nd-block-sslow { background: #f97316; }
.nd-block-sbad { background: #ef4444; }
.nd-block-sfail { background: #7f1d1d; }

.nd-chart-wrap { position: relative; }

.nd-chart {
  width: 100%;
  height: 190px;
  display: block;
}

.nd-axis { font-size: 9px; fill: var(--text-dim); }

.nd-axis-x {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--text-dim);
  margin-top: 2px;
}

.nd-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
  margin-top: 8px;
}

.nd-lg {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}

.nd-lg-main { background: #6366f1; }
.nd-lg-cmp { background: #f97316; margin-left: 10px; }
.nd-lg-note { margin-left: 6px; opacity: 0.75; }

.nd-anomaly {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-dim);
}

.nd-anomaly summary { cursor: pointer; color: var(--text-main); font-weight: 600; }

.nd-anomaly-list {
  max-height: 140px;
  overflow-y: auto;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nd-anomaly-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--bg-card-subtle, rgba(148, 163, 184, 0.08));
}

.nd-anomaly-time { color: var(--text-dim); }

.nd-health {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
  flex-wrap: wrap;
  border-top: 1px dashed var(--border-color);
  padding-top: 10px;
}

.nd-health-sep { opacity: 0.5; }

.nd-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.nd-tip {
  position: fixed;
  z-index: 1300;
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  font-size: 11.5px;
  line-height: 1.5;
  padding: 6px 9px;
  border-radius: 7px;
  pointer-events: none;
  max-width: 260px;
}
</style>

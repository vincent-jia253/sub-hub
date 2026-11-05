<template>
  <div class="nd-backdrop" @click.self="$emit('close')">
    <div class="nd-card glass">
      <div class="nd-head">
        <div class="nd-title-wrap">
          <span class="nd-name" :title="node.name">{{ node.name }}</span>
          <span class="nd-badge">{{ (node.type || '').toUpperCase() }}</span>
          <span class="nd-badge nd-badge-sub" v-if="subName">{{ subName }}</span>
        </div>
        <button class="nd-close" @click="$emit('close')">×</button>
      </div>

      <div class="nd-meta">
        {{ node.server }}:{{ node.port }} · {{ (node.network || 'tcp').toUpperCase() }}<template v-if="node.tls"> · TLS</template>
        <span class="nd-meta-sep">|</span>
        最新延迟 <b :class="delayChipClass">{{ node.delay > 0 ? node.delay + ' ms' : (node.delay === -1 ? '超时' : '未测') }}</b>
        <span class="nd-meta-sep">|</span>
        最新网速 <b>{{ node.speedStatus === 'ok' ? node.speedMbps.toFixed(1) + ' Mbps' : '未测' }}</b>
      </div>

      <div class="nd-ranges">
        <button
          v-for="r in RANGES"
          :key="r.key"
          :class="['nd-range-btn', { active: rangeKey === r.key }]"
          @click="rangeKey = r.key"
        >{{ r.label }}</button>
        <span class="nd-range-hint">
          {{ filteredDelay.length + filteredSpeed.length }} 条记录 · 历史保留 30 天
        </span>
        <button class="nd-export" title="导出该时间范围的原始测试记录（JSON）" @click="exportRecords">导出</button>
      </div>

      <!-- 延迟 -->
      <section class="nd-sec">
        <div class="nd-sec-head">
          <span class="nd-sec-title">延迟测试记录</span>
          <span class="nd-sec-stat" v-if="filteredDelay.length">
            平均 <b>{{ delayStats.avg }} ms</b> · 最低 <b>{{ delayStats.min }}</b> · 最高 <b>{{ delayStats.max }}</b>
            · 成功率 <b>{{ delayStats.aliveRate }}%</b> · 样本 <b>{{ filteredDelay.length }}</b>
          </span>
          <span class="nd-sec-stat" v-else>该时间范围内没有延迟记录</span>
        </div>

        <div class="nd-blocks" v-if="filteredDelay.length">
          <span
            v-for="(b, i) in delayBlocks"
            :key="'db' + i"
            :class="['nd-block', 'seg-' + b.cls]"
            @mouseenter="showTip($event, b.tip)"
            @mouseleave="hideTip"
          ></span>
        </div>

        <div class="nd-chart-wrap" v-if="filteredDelay.length" @mouseleave="hideTip">
          <svg class="nd-chart" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none">
            <line v-for="(gy, gi) in [0.25, 0.5, 0.75, 1]" :key="'g' + gi"
              :x1="0" :x2="CHART_W" :y1="CHART_H * gy" :y2="CHART_H * gy" class="nd-grid" />
            <polyline :points="delayLine.points" class="nd-line nd-line-delay" />
            <circle
              v-for="(p, i) in delayLine.dots"
              :key="'d' + i"
              :cx="p.x" :cy="p.y" :r="7"
              class="nd-dot-hit"
              @mouseenter="showTip($event, p.tip)"
            />
            <circle v-for="(p, i) in delayLine.timeouts" :key="'to' + i" :cx="p.x" :cy="CHART_H - 2" r="2.5" class="nd-timeout-dot" />
          </svg>
          <div class="nd-axis">
            <span>{{ axisLabels.start }}</span>
            <span>{{ axisLabels.mid }}</span>
            <span>{{ axisLabels.end }}</span>
          </div>
        </div>
      </section>

      <!-- 网速 -->
      <section class="nd-sec">
        <div class="nd-sec-head">
          <span class="nd-sec-title">网速测试记录</span>
          <span class="nd-sec-stat" v-if="filteredSpeed.length">
            平均 <b>{{ speedStats.avg }} Mbps</b> · 峰值 <b>{{ speedStats.max }}</b> · 最低 <b>{{ speedStats.min }}</b>
            · 样本 <b>{{ filteredSpeed.length }}</b>
          </span>
          <span class="nd-sec-stat" v-else>该时间范围内没有网速记录</span>
        </div>

        <div class="nd-blocks" v-if="filteredSpeed.length">
          <span
            v-for="(b, i) in speedBlocks"
            :key="'sb' + i"
            :class="['nd-block', 'seg-' + b.cls]"
            @mouseenter="showTip($event, b.tip)"
            @mouseleave="hideTip"
          ></span>
        </div>

        <div class="nd-chart-wrap" v-if="filteredSpeed.length" @mouseleave="hideTip">
          <svg class="nd-chart" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none">
            <line v-for="(gy, gi) in [0.25, 0.5, 0.75, 1]" :key="'sg' + gi"
              :x1="0" :x2="CHART_W" :y1="CHART_H * gy" :y2="CHART_H * gy" class="nd-grid" />
            <polyline :points="speedLine.points" class="nd-line nd-line-speed" />
            <circle
              v-for="(p, i) in speedLine.dots"
              :key="'sd' + i"
              :cx="p.x" :cy="p.y" :r="7"
              class="nd-dot-hit"
              @mouseenter="showTip($event, p.tip)"
            />
          </svg>
          <div class="nd-axis">
            <span>{{ axisLabels.start }}</span>
            <span>{{ axisLabels.mid }}</span>
            <span>{{ axisLabels.end }}</span>
          </div>
        </div>
      </section>

      <div class="nd-foot">
        <button class="btn btn-primary btn-sm" @click="$emit('test-delay', node)">测延迟</button>
        <button class="btn btn-secondary btn-sm" @click="$emit('test-speed', node)">测网速</button>
        <button class="btn btn-secondary btn-sm" @click="$emit('edit', node); $emit('close')">编辑节点</button>
        <button class="btn btn-danger btn-sm" @click="$emit('clear', node)">清理结果</button>
        <span class="nd-foot-hint">点击色块或折线点可看具体那次的测试信息</span>
      </div>

      <div v-if="tip.visible" class="nd-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">{{ tip.text }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  node: { type: Object, required: true },
  subName: { type: String, default: '' }
});
defineEmits(['close', 'test-delay', 'test-speed', 'clear', 'edit']);

const RANGES = [
  { key: '2h', label: '2 小时', ms: 2 * 3600e3 },
  { key: '4h', label: '4 小时', ms: 4 * 3600e3 },
  { key: '8h', label: '8 小时', ms: 8 * 3600e3 },
  { key: '12h', label: '12 小时', ms: 12 * 3600e3 },
  { key: '24h', label: '24 小时', ms: 24 * 3600e3 },
  { key: '7d', label: '7 天', ms: 7 * 86400e3 },
  { key: '15d', label: '15 天', ms: 15 * 86400e3 },
  { key: '30d', label: '30 天', ms: 30 * 86400e3 }
];

const rangeKey = ref('24h');
const rangeMs = computed(() => (RANGES.find(r => r.key === rangeKey.value) || RANGES[4]).ms);
const since = computed(() => Date.now() - rangeMs.value);

const filteredDelay = computed(() =>
  (Array.isArray(props.node.delayHistory) ? props.node.delayHistory : []).filter(h => h.t >= since.value)
);
const filteredSpeed = computed(() =>
  (Array.isArray(props.node.speedHistory) ? props.node.speedHistory : []).filter(h => h.t >= since.value)
);

/* ---------- 悬浮提示 ---------- */
const tip = ref({ visible: false, x: 0, y: 0, text: '' });
const showTip = (evt, text) => {
  tip.value = { visible: true, x: evt.clientX + 14, y: evt.clientY + 14, text };
};
const hideTip = () => { tip.value.visible = false; };

const fmtTime = (t) => {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* ---------- 延迟：色块 / 折线 ---------- */
const delayChipClass = computed(() => {
  const d = props.node.delay;
  if (!d) return 'delay-none';
  if (d === -1 || d > 1000) return 'delay-slow';
  if (d > 500) return 'delay-slow';
  if (d > 200) return 'delay-medium';
  return 'delay-fast';
});

const segOfDelay = (d) => {
  if (d === -1) return 'timeout';
  if (d < 200) return 'fast';
  if (d < 500) return 'mid';
  if (d < 1000) return 'slow';
  return 'bad';
};

const segOfSpeed = (s) => {
  if (s === -1) return 'sfail';
  if (s >= 300) return 'sfast';
  if (s >= 150) return 'smid';
  if (s >= 50) return 'sslow';
  return 'sbad';
};

// 聚合到最多 48 个色块：块内取平均（延迟超时块单独标记）
const bucketize = (list, maxBlocks, valueOf, isFail) => {
  if (!list.length) return [];
  const size = Math.ceil(list.length / maxBlocks);
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const slice = list.slice(i, i + size);
    const vals = slice.map(valueOf);
    const okVals = vals.filter(v => !isFail(v));
    const avg = okVals.length ? Math.round(okVals.reduce((a, b) => a + b, 0) / okVals.length) : -1;
    const t0 = slice[0].t;
    const t1 = slice[slice.length - 1].t;
    out.push({
      value: avg,
      fail: okVals.length === 0,
      t0, t1, count: slice.length,
      tip: `${fmtTime(t0)}${slice.length > 1 ? ' ~ ' + fmtTime(t1).slice(6) : ''} · ${slice.length} 次 · ${okVals.length === 0 ? '全部失败' : '均值 ' + avg + (isFail(-1) ? ' ms' : ' Mbps')}`
    });
  }
  return out;
};

const delayBlocks = computed(() =>
  bucketize(filteredDelay.value, 48, h => h.d, v => v === -1)
    .map(b => ({ ...b, cls: b.fail ? 'timeout' : segOfDelay(b.value) }))
);
const speedBlocks = computed(() =>
  bucketize(filteredSpeed.value, 48, h => h.s, v => v === -1)
    .map(b => ({ ...b, cls: b.fail ? 'sfail' : segOfSpeed(b.value) }))
);

const CHART_W = 1000;
const CHART_H = 160;

const delayStats = computed(() => {
  const ok = filteredDelay.value.filter(h => h.d > 0).map(h => h.d);
  if (!ok.length) return { avg: 0, min: 0, max: 0, aliveRate: 0 };
  return {
    avg: Math.round(ok.reduce((a, b) => a + b, 0) / ok.length),
    min: Math.min(...ok),
    max: Math.max(...ok),
    aliveRate: Math.round((ok.length / filteredDelay.value.length) * 100)
  };
});

const speedStats = computed(() => {
  const ok = filteredSpeed.value.filter(h => h.s > 0).map(h => h.s);
  if (!ok.length) return { avg: 0, max: 0, min: 0 };
  return {
    avg: Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10,
    max: Math.max(...ok),
    min: Math.min(...ok)
  };
});

// 折线：x 按时间线性（since → now），y 按值（0 → max*1.15）
const makeLine = (list, valueOf, maxHint) => {
  const pts = list.map(h => ({ t: h.t, v: valueOf(h) }));
  const maxV = Math.max(10, ...pts.map(p => (p.v > 0 ? p.v : 0)), maxHint || 0) * 1.15;
  const t0 = since.value;
  const t1 = Date.now();
  const span = Math.max(1, t1 - t0);
  const toX = t => Math.max(0, Math.min(CHART_W, ((t - t0) / span) * CHART_W));
  const toY = v => CHART_H - Math.max(0, Math.min(CHART_H, (v / maxV) * CHART_H));
  const okPts = pts.filter(p => p.v > 0);
  const points = okPts.map(p => `${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ');
  const dots = pts.map(p => ({
    x: toX(p.t),
    y: p.v > 0 ? toY(p.v) : CHART_H - 2,
    tip: `${fmtTime(p.t)} · ${p.v > 0 ? p.v + (maxHint !== undefined && maxHint !== null ? ' ms' : '') : '失败/超时'}`
  }));
  const timeouts = pts.filter(p => p.v <= 0).map(p => ({ x: toX(p.t) }));
  return { points, dots, timeouts };
};

const delayLine = computed(() => {
  const l = makeLine(filteredDelay.value, h => h.d, 0);
  l.dots.forEach((d, i) => {
    const src = filteredDelay.value[i];
    d.tip = `${fmtTime(src.t)} · ${src.d > 0 ? src.d + ' ms' : '超时'}`;
  });
  return l;
});

const speedLine = computed(() => {
  const l = makeLine(filteredSpeed.value, h => h.s, 0);
  l.dots.forEach((d, i) => {
    const src = filteredSpeed.value[i];
    d.tip = `${fmtTime(src.t)} · ${src.s > 0 ? src.s + ' Mbps' : '测速失败'}`;
  });
  return l;
});

/* ---------- 时间轴标签 / 导出 ---------- */
const axisLabels = computed(() => {
  const end = Date.now();
  const start = end - rangeMs.value;
  const p = n => String(n).padStart(2, '0');
  const f = (t) => { const d = new Date(t); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  return { start: f(start), mid: f((start + end) / 2), end: '现在' };
});

const exportRecords = () => {
  const payload = {
    node: { id: props.node.id, name: props.node.name, type: props.node.type, server: props.node.server, port: props.node.port },
    range: rangeKey.value,
    exportedAt: new Date().toISOString(),
    delay: filteredDelay.value,
    speed: filteredSpeed.value
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${props.node.name}-${rangeKey.value}-records.json`;
  a.click();
  URL.revokeObjectURL(url);
};
</script>

<style scoped>
.nd-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 24px;
}

.nd-card {
  width: min(1080px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 16px;
  padding: 18px 20px 16px;
  position: relative;
}

.nd-head { display: flex; align-items: center; gap: 8px; }
.nd-title-wrap { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.nd-name { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nd-badge { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: rgba(99,102,241,.14); color: var(--primary); }
.nd-badge-sub { background: rgba(148,163,184,.18); color: var(--text-dim); }
.nd-close { background: none; border: none; font-size: 24px; line-height: 1; color: var(--text-dim); cursor: pointer; width: 28px; height: 28px; border-radius: 8px; }
.nd-close:hover { background: var(--bg-card-hover); color: var(--text-main); }

.nd-meta { font-size: 12px; color: var(--text-dim); margin: 6px 0 12px; }
.nd-meta b { color: var(--text-main); }
.nd-meta-sep { margin: 0 6px; opacity: .5; }
.delay-fast { color: #059669; }
.delay-medium { color: #d97706; }
.delay-slow { color: #dc2626; }
.delay-none { color: var(--text-dim); }

.nd-ranges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.nd-range-btn {
  font-size: 12px; padding: 5px 11px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-dim);
}
.nd-range-btn:hover { border-color: var(--primary); color: var(--text-main); }
.nd-range-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
.nd-range-hint { font-size: 11px; color: var(--text-dim); margin-left: 4px; }
.nd-export { margin-left: auto; font-size: 11.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-dim); cursor: pointer; }
.nd-export:hover { color: var(--text-main); border-color: var(--primary); }

.nd-sec { border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; margin-bottom: 12px; background: var(--bg-secondary); }
.nd-sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 9px; }
.nd-sec-title { font-size: 12px; font-weight: 700; letter-spacing: .5px; color: var(--text-dim); }
.nd-sec-stat { font-size: 11.5px; color: var(--text-dim); }
.nd-sec-stat b { color: var(--text-main); }

.nd-blocks { display: flex; gap: 2px; height: 14px; margin-bottom: 10px; }
.nd-block { flex: 1 1 0; min-width: 4px; border-radius: 3px; cursor: pointer; }
.nd-block:hover { outline: 1.5px solid var(--primary); outline-offset: 1px; }

.seg-fast { background: #10b981; }
.seg-mid { background: #f59e0b; }
.seg-slow { background: #f97316; }
.seg-bad { background: #ef4444; }
.seg-timeout { background: #7f1d1d; }
.seg-sfast { background: #10b981; }
.seg-smid { background: #f59e0b; }
.seg-sslow { background: #f97316; }
.seg-sbad { background: #ef4444; }
.seg-sfail { background: #7f1d1d; }

.nd-chart-wrap { position: relative; }
.nd-chart { width: 100%; height: 160px; display: block; }
.nd-grid { stroke: var(--border-color); stroke-width: 1; opacity: .5; }
.nd-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.nd-line-delay { stroke: #6366f1; }
.nd-line-speed { stroke: #10b981; }
.nd-dot-hit { fill: transparent; cursor: pointer; }
.nd-dot-hit:hover { fill: var(--primary); opacity: .45; }
.nd-timeout-dot { fill: #ef4444; }

.nd-axis { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text-dim); margin-top: 2px; }

.nd-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
.nd-foot-hint { font-size: 11px; color: var(--text-dim); margin-left: auto; }
.btn-danger { background: rgba(239,68,68,.12); color: #dc2626; border: 1px solid rgba(239,68,68,.35); }
.btn-danger:hover { background: rgba(239,68,68,.2); }

.nd-tip {
  position: fixed;
  z-index: 1300;
  pointer-events: none;
  background: rgba(15, 23, 42, .94);
  color: #f8fafc;
  font-size: 11.5px;
  padding: 5px 9px;
  border-radius: 7px;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0,0,0,.28);
}

@media (max-width: 720px) {
  .nd-backdrop { padding: 10px; }
  .nd-card { padding: 14px; }
  .nd-chart { height: 120px; }
  .nd-foot-hint { display: none; }
}
</style>

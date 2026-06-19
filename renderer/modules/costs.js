// ── Cost Tracking & Settings Panel Module ────────────────────
// Extracted from app.js — cost log persistence and the "Kosten"
// settings tab (stacked bar chart + per-session breakdown).
//
// Relies on globals provided elsewhere in the renderer:
//   - getPref / setPref          (app.js — preference persistence)
//   - escapeHtml                 (modules/utils.js)
// Logic helpers are read directly from window.RendererLogic (loaded
// before this script) so this module is self-contained and does not
// depend on app.js destructuring them.
'use strict';

const { buildCostBuckets, aggregateCostBySession, trimCostLog } = window.RendererLogic;

// ── Cost Log ─────────────────────────────────────────────────

const COST_LOG_KEY = 'costLog';
const COST_LOG_MAX_ENTRIES = 5000;

function getCostLog() {
  return getPref(COST_LOG_KEY, []);
}

function recordCostEntry(sessionId, sessionName, credits) {
  const log = getCostLog();
  log.push({ ts: Date.now(), sessionId, sessionName, credits });
  trimCostLog(log, COST_LOG_MAX_ENTRIES);
  setPref(COST_LOG_KEY, log);
}

function clearCostLog() {
  setPref(COST_LOG_KEY, []);
}

// ── Cost Settings Panel ──────────────────────────────────────

let _costsRange = 'week'; // 'week' | 'day'

const CHART_COLORS = [
  '#4e8ef7', '#f7a44e', '#5cd45c', '#e05c5c', '#a07cf0',
  '#f06090', '#4ecdc4', '#ffd166', '#06d6a0', '#ef476f',
];

function initCostsPanel() {
  document.querySelectorAll('.costs-view__toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.costs-view__toggle-btn').forEach(b => b.classList.remove('costs-view__toggle-btn--active'));
      btn.classList.add('costs-view__toggle-btn--active');
      _costsRange = btn.dataset.range;
      renderCostsPanel();
    });
  });
  document.getElementById('btnClearCostLog')?.addEventListener('click', () => {
    if (confirm('Kostenverlauf wirklich löschen?')) {
      clearCostLog();
      renderCostsPanel();
    }
  });
  // Open the costs page from the session-actions bar.
  document.getElementById('btnOpenCosts')?.addEventListener('click', () => {
    window.switchToCostsView();
  });
}

function renderCostsPanel() {
  const log = getCostLog();
  const now = Date.now();
  const isWeek = _costsRange === 'week';
  const bucketCount = isWeek ? 7 : 24;
  const bucketMs = isWeek ? 86400000 : 3600000;
  const windowMs = bucketCount * bucketMs;
  const startMs = now - windowMs;

  const filtered = log.filter(e => e.ts >= startMs);

  // Collect unique sessions
  const sessionMap = new Map(); // sessionId|'__unnamed' → { name, colorIdx }
  let colorIdx = 0;
  for (const e of filtered) {
    const key = e.sessionId || '__unnamed';
    if (!sessionMap.has(key)) {
      sessionMap.set(key, { name: e.sessionName || 'Unbenannte Sessions', colorIdx: colorIdx++ });
    }
  }

  const buckets = buildCostBuckets(filtered, startMs, bucketMs, bucketCount);

  drawCostsChart(buckets, sessionMap, bucketCount, isWeek, startMs, bucketMs);
  renderCostsBreakdown(filtered, sessionMap);
}

function drawCostsChart(buckets, sessionMap, bucketCount, isWeek, startMs, bucketMs) {
  const canvas = document.getElementById('costsChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 400;
  const H = 180;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 42, padR = 8, padT = 12, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Max value for Y axis
  const bucketTotals = buckets.map(b => [...b.values()].reduce((s, v) => s + v, 0));
  const maxVal = Math.max(...bucketTotals, 0.1);
  const yStep = niceStep(maxVal);
  const yMax = Math.ceil(maxVal / yStep) * yStep;

  const style = getComputedStyle(document.documentElement);
  const colorBorder = style.getPropertyValue('--border').trim() || '#333';
  const colorMuted = style.getPropertyValue('--text-muted').trim() || '#888';

  ctx.clearRect(0, 0, W, H);

  // Y grid + labels
  const ySteps = Math.ceil(yMax / yStep);
  for (let i = 0; i <= ySteps; i++) {
    const val = i * yStep;
    const y = padT + chartH - (val / yMax) * chartH;
    ctx.strokeStyle = colorBorder;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
    ctx.fillStyle = colorMuted;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(val < 10 ? 1 : 0) + 'C', padL - 4, y + 3.5);
  }

  // Bars (stacked)
  const sessionKeys = [...sessionMap.keys()];
  const barW = Math.max(4, (chartW / bucketCount) * 0.7);
  const barGap = chartW / bucketCount;

  for (let i = 0; i < bucketCount; i++) {
    const x = padL + i * barGap + (barGap - barW) / 2;
    let yBase = padT + chartH;
    for (const key of sessionKeys) {
      const val = buckets[i].get(key) || 0;
      if (val <= 0) continue;
      const barH = (val / yMax) * chartH;
      const { colorIdx } = sessionMap.get(key);
      ctx.fillStyle = CHART_COLORS[colorIdx % CHART_COLORS.length];
      ctx.fillRect(x, yBase - barH, barW, barH);
      yBase -= barH;
    }
  }

  // X labels
  ctx.fillStyle = colorMuted;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(startMs + i * bucketMs);
    const label = isWeek
      ? d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' })
      : d.getHours() + ':00';
    const x = padL + i * barGap + barGap / 2;
    ctx.fillText(label, x, padT + chartH + 18);
  }
}

function niceStep(max) {
  if (!(max > 0)) return 0.1; // guard against 0 / negative / NaN → avoids -Infinity log10
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const n of [1, 2, 5, 10]) {
    if (n * mag >= rough) return n * mag;
  }
  return mag * 10;
}

function renderCostsBreakdown(entries, sessionMap) {
  const el = document.getElementById('costsBreakdown');
  if (!el) return;

  const { totals, grand } = aggregateCostBySession(entries);

  if (totals.size === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Noch keine Kostendaten erfasst.</div>';
    return;
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  let html = sorted.map(([key, val]) => {
    const info = sessionMap.get(key);
    const color = CHART_COLORS[(info?.colorIdx || 0) % CHART_COLORS.length];
    const name = info?.name || 'Unbenannte Sessions';
    return `<div class="costs-breakdown__row">
      <div class="costs-breakdown__dot" style="background:${color}"></div>
      <span class="costs-breakdown__name">${escapeHtml(name)}</span>
      <span class="costs-breakdown__value">${val.toFixed(1)}C</span>
    </div>`;
  }).join('');

  html += `<div class="costs-breakdown__row" style="margin-top:4px;">
    <div class="costs-breakdown__dot"></div>
    <span class="costs-breakdown__name costs-breakdown__name--total">Gesamt</span>
    <span class="costs-breakdown__value">${grand.toFixed(1)}C</span>
  </div>`;

  el.innerHTML = html;
}

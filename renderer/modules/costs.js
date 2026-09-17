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

const { buildCostBuckets, aggregateCostBySession, trimCostLog, costPeriod, buildTokenWindows } = window.RendererLogic;

// ── Cost Log ─────────────────────────────────────────────────

const COST_LOG_KEY = 'costLog';
const COST_LOG_MAX_ENTRIES = 50000; // ~1 year of entries; keep past-period views usable

// ── Claude Token Log ─────────────────────────────────────────
// Separate from the cost log on purpose: that one accounts in USD (entryUsd,
// the chart, the USD migration) and deliberately records nothing for
// subscription providers. Token counts per limit window are a different
// dimension with its own retention, so mixing them would complicate both.
//
// Claude exposes no consumption history at all — this log IS the history, built
// from the deltas between successive `/usage` reads. It therefore starts empty
// and only covers usage since the feature was installed.

const TOKEN_LOG_KEY = 'claudeTokenLog';
const TOKEN_LOG_MAX_ENTRIES = 20000;

function getTokenLog() {
  return getPref(TOKEN_LOG_KEY, []);
}

/**
 * Append one consumption delta. `resetsAt` identifies the limit window the
 * tokens fell into (epoch seconds, as reported by /usage at that moment).
 * @param {{resetsAt:number, sessionId:string|null, input:number, output:number, cacheRead:number, cacheWrite:number}} delta
 */
function recordTokenDelta(delta) {
  const log = getTokenLog();
  log.push({ ts: Date.now(), ...delta });
  trimCostLog(log, TOKEN_LOG_MAX_ENTRIES); // same trim helper, same semantics
  setPref(TOKEN_LOG_KEY, log);
}

function clearTokenLog() {
  setPref(TOKEN_LOG_KEY, []);
}

function getCostLog() {
  return getPref(COST_LOG_KEY, []);
}

function recordCostEntry(sessionId, sessionName, usd, provider) {
  const log = getCostLog();
  log.push({ ts: Date.now(), sessionId, sessionName, usd, provider: provider || null });
  trimCostLog(log, COST_LOG_MAX_ENTRIES);
  setPref(COST_LOG_KEY, log);
}

function clearCostLog() {
  setPref(COST_LOG_KEY, []);
}

// One-time migration: earlier entries stored `credits` in MIXED units (Copilot
// in AI Credits, direct-API in USD), which can't be reconciled to a single
// currency. Reset the log once so all displayed costs are clean USD.
// NOTE: must run AFTER app.js defines getPref/setPref, so it is invoked from
// initCostsPanel() — not at module load (costs.js is parsed before app.js).
function migrateCostLogToUsd() {
  if (getPref('costLogUsdMigrated', false)) return;
  const log = getCostLog();
  if (log.some(e => typeof e.usd !== 'number')) setPref(COST_LOG_KEY, []);
  setPref('costLogUsdMigrated', true);
}

// ── Cost Settings Panel ──────────────────────────────────────

let _costsRange = 'week';     // 'day' | 'week' | 'month'
let _costsOffset = 0;         // 0 = current period, 1 = previous, … (calendar-aligned)
let _costsProvider = 'all';   // 'all' → je Provider; sonst Provider-ID → dessen Sessions

// Display names for provider grouping.
const PROVIDER_DISPLAY = {
  copilot: 'GitHub Copilot', anthropic: 'Anthropic', gemini: 'Gemini',
  openai: 'OpenAI', ollama: 'Ollama', glm: 'GLM',
};

// Session display name: prefer the app's session naming (namedSessions),
// fall back to the short id — so sessions aren't all shown as "Unbenannt".
function sessionDisplayName(sessionId) {
  if (!sessionId || sessionId === '__unnamed') return 'Unbenannte Sessions';
  const named = (typeof getSessionName === 'function') ? getSessionName(sessionId) : null;
  return named || sessionId.slice(0, 8);
}

const CHART_COLORS = [
  '#4e8ef7', '#f7a44e', '#5cd45c', '#e05c5c', '#a07cf0',
  '#f06090', '#4ecdc4', '#ffd166', '#06d6a0', '#ef476f',
];

function initCostsPanel() {
  migrateCostLogToUsd(); // safe here — app.js (getPref/setPref) is loaded
  document.querySelectorAll('.costs-view__toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.costs-view__toggle-btn').forEach(b => b.classList.remove('costs-view__toggle-btn--active'));
      btn.classList.add('costs-view__toggle-btn--active');
      _costsRange = btn.dataset.range;
      _costsOffset = 0; // switching granularity jumps back to the current period
      renderCostsPanel();
    });
  });
  // ◀ / ▶ step through calendar-aligned periods (▶ is disabled at the present).
  document.getElementById('costsPrev')?.addEventListener('click', () => {
    _costsOffset += 1;
    renderCostsPanel();
  });
  document.getElementById('costsNext')?.addEventListener('click', () => {
    if (_costsOffset > 0) { _costsOffset -= 1; renderCostsPanel(); }
  });
  document.getElementById('costsProviderFilter')?.addEventListener('change', (e) => {
    _costsProvider = e.target.value;
    renderCostsPanel();
  });
  document.getElementById('btnClearCostLog')?.addEventListener('click', () => {
    if (confirm('Kostenverlauf und Token-Historie wirklich löschen?')) {
      clearCostLog();
      clearTokenLog();
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
  const { startMs, bucketMs, bucketCount, isCurrent, range, label } = costPeriod(_costsRange, _costsOffset, Date.now());
  const endMs = startMs + bucketMs * bucketCount;

  // Period label + navigation state (no stepping into the future).
  const labelEl = document.getElementById('costsPeriodLabel');
  if (labelEl) labelEl.textContent = label;
  const nextBtn = document.getElementById('costsNext');
  if (nextBtn) nextBtn.disabled = isCurrent;

  // Keep the provider dropdown in sync with the providers present in the log.
  populateProviderFilter(log);

  const inWindow = log.filter(e => e.ts >= startMs && e.ts < endMs);

  // "Alle Provider" → ein Balken/Eintrag je Provider. Ein konkreter Provider →
  // nur dessen Einträge, aufgeschlüsselt nach Session (#1).
  const byProvider = _costsProvider === 'all';
  const entries = byProvider ? inWindow : inWindow.filter(e => (e.provider || 'copilot') === _costsProvider);
  const groupBy = byProvider ? 'provider' : 'session';

  const sessionMap = new Map(); // key → { name, colorIdx }
  let colorIdx = 0;
  for (const e of entries) {
    const key = byProvider ? (e.provider || 'copilot') : (e.sessionId || '__unnamed');
    if (!sessionMap.has(key)) {
      const name = byProvider ? (PROVIDER_DISPLAY[key] || key) : sessionDisplayName(key);
      sessionMap.set(key, { name, colorIdx: colorIdx++ });
    }
  }

  const buckets = buildCostBuckets(entries, startMs, bucketMs, bucketCount, groupBy);

  drawCostsChart(buckets, sessionMap, bucketCount, range, startMs, bucketMs);
  renderCostsBreakdown(entries, sessionMap, groupBy);
  // Deliberately NOT filtered by the period/provider controls above: the limit
  // windows are Claude's own 5-hour buckets, not calendar periods, and mapping
  // one onto the other would only invite misreading.
  renderTokenWindows();
}

/** Fill the provider filter dropdown with "Alle" + the providers present in the log. */
function populateProviderFilter(log) {
  const sel = document.getElementById('costsProviderFilter');
  if (!sel) return;
  const present = [...new Set(log.map(e => e.provider || 'copilot'))];
  const opts = ['all', ...present];
  // Drop the selected provider if it no longer has data.
  if (!opts.includes(_costsProvider)) _costsProvider = 'all';
  sel.innerHTML = opts
    .map(p => `<option value="${p}">${p === 'all' ? 'Alle Provider' : (PROVIDER_DISPLAY[p] || p)}</option>`)
    .join('');
  sel.value = _costsProvider;
}

function drawCostsChart(buckets, sessionMap, bucketCount, range, startMs, bucketMs) {
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
    ctx.fillText('$' + val.toFixed(val < 1 ? 2 : val < 10 ? 1 : 0), padL - 4, y + 3.5);
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

  // X labels. Month has ~30 bars → only label every 5th (plus the 1st) to keep
  // it readable; day shows hours, week shows weekday + date.
  ctx.fillStyle = colorMuted;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(startMs + i * bucketMs);
    let label;
    if (range === 'day') label = d.getHours() + ':00';
    else if (range === 'month') label = (i === 0 || (i + 1) % 5 === 0) ? String(d.getDate()) : '';
    else label = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' });
    if (!label) continue;
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

function renderCostsBreakdown(entries, sessionMap, groupBy) {
  const el = document.getElementById('costsBreakdown');
  if (!el) return;

  const { totals, grand } = aggregateCostBySession(entries, groupBy);

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
      <span class="costs-breakdown__value">$${val.toFixed(2)}</span>
    </div>`;
  }).join('');

  html += `<div class="costs-breakdown__row" style="margin-top:4px;">
    <div class="costs-breakdown__dot"></div>
    <span class="costs-breakdown__name costs-breakdown__name--total">Gesamt</span>
    <span class="costs-breakdown__value">$${grand.toFixed(2)}</span>
  </div>`;

  el.innerHTML = html;
}

// ── Claude Token Windows ─────────────────────────────────────

/** "15.09., 16:10 – 21:10" for one limit window. */
function formatWindowRange(startMs, endMs) {
  const d = new Date(startMs);
  const e = new Date(endMs);
  const day = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const t = (x) => x.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t(d)} – ${t(e)}`;
}

/** Compact token count: 1234 → "1.234", 1234567 → "1,23 Mio." */
function formatTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Mio.`;
  return n.toLocaleString('de-DE');
}

/**
 * Renders the per-window token list. Lives below the cost breakdown because it
 * answers a related but different question ("how much did I consume against my
 * limit") than the USD chart above it.
 */
function renderTokenWindows() {
  const el = document.getElementById('tokenWindows');
  if (!el) return;

  const windows = buildTokenWindows(getTokenLog());
  if (!windows.length) {
    el.innerHTML = '<div class="costs-tokens__empty">Noch keine Daten. Claude liefert keinen Verbrauch aus der Vergangenheit — die Aufzeichnung beginnt mit der nächsten Anfrage an Claude Code.</div>';
    return;
  }

  const now = Date.now();
  el.innerHTML = windows.map((w) => {
    const current = now < w.endMs;
    return `<div class="costs-tokens__row">
      <span class="costs-tokens__range">${escapeHtml(formatWindowRange(w.startMs, w.endMs))}${current ? ' <span class="costs-tokens__badge">laufend</span>' : ''}</span>
      <span class="costs-tokens__detail" data-tooltip="Eingabe ${formatTokens(w.input)} · Ausgabe ${formatTokens(w.output)} · Cache gelesen ${formatTokens(w.cacheRead)} · Cache geschrieben ${formatTokens(w.cacheWrite)}">${escapeHtml(formatTokens(w.total))}</span>
    </div>`;
  }).join('');
}

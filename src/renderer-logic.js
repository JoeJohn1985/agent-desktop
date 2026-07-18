'use strict';

// Pure business logic extracted from renderer/app.js for testability.
// No DOM, no Electron, no side-effects — just data transformations.
//
// UMD wrapper: exposes `module.exports` under Node/Jest and
// `window.RendererLogic` in the renderer (which has no `require`).
// Wrapped in an IIFE so the function/const declarations below do NOT
// leak into the renderer's global scope (would collide with utils.js).
(function (global) {

// ── Constants ────────────────────────────────────────────────
const TOOL_ARGS_MAX_LENGTH = 60;
const TOOL_PREVIEW_MAX_LENGTH = 150;

// ── Path Helpers ─────────────────────────────────────────────

/**
 * Shortens a path by replacing the user home directory with ~\
 */
function shortenPath(p, homeDir) {
  if (!p || !homeDir) return p || '';
  const homeEscaped = homeDir.replace(/[\\/]+/g, '\\\\');
  return p.replace(new RegExp(homeEscaped, 'gi'), '~\\');
}

/**
 * Truncates a long path to show only the last 2 segments.
 */
function truncatePath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

// ── Formatting ───────────────────────────────────────────────

/**
 * Formats an ISO date string as a German relative-time string.
 * @param {string} iso - ISO date string
 * @param {Date} [now] - Reference date (for testing)
 */
function formatDate(iso, now) {
  if (!iso) return '–';
  const d = new Date(iso);
  const ref = now || new Date();
  const diffMs = ref - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `vor ${diffD} Tag${diffD > 1 ? 'en' : ''}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Escapes HTML-special characters in a string (no DOM needed).
 */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes attribute-safe characters.
 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a string for safe use inside a JavaScript string literal in an HTML attribute (onclick etc).
 * Doubles backslashes so they survive JS parsing, then applies HTML attribute escaping.
 */
function escapeAttrJs(s) {
  return escapeAttr(String(s).replace(/\\/g, '\\\\'));
}

// ── Context & Color ──────────────────────────────────────────

/**
 * Returns a color (hex) for a context usage percentage.
 */
function contextColor(percent) {
  return percent > 80 ? '#f38ba8' : percent > 60 ? '#fab387' : '#a6e3a1';
}

/**
 * Returns the category color for a given context category name.
 */
function categoryColor(name) {
  if (name === 'Free Space') return '#a6e3a1';
  if (name === 'Messages') return '#89b4fa';
  if (name === 'Buffer') return '#a6adc8';
  return '#f5c2e7';
}

// ── Tool Helpers ─────────────────────────────────────────────

const TOOL_ICONS = {
  view: '📄', edit: '✏️', create: '📝', grep: '🔍', glob: '📂',
  powershell: '⚡', task: '🤖', ask_user: '❓', sql: '🗄️',
  web_search: '🌐', web_fetch: '🌐',
  // Direct-API providers' own tool runtime (src/providers/agent-tools.js) —
  // a separate, custom-built tool set (not translated through a shared "kind"
  // vocabulary like Copilot/Claude Code's ACP tool_call events), so its names
  // need their own entries here rather than reusing the ones above.
  shell: '⚡', read_file: '📄', write_file: '📝', edit_file: '✏️', list_dir: '📂',
};

const TOOL_DISPLAY_NAMES = {
  grep: 'search', view: 'read', glob: 'find',
  edit: 'edit', create: 'create', powershell: 'run',
  task: 'task', ask_user: 'ask', sql: 'query',
  web_search: 'web search', web_fetch: 'web fetch',
  shell: 'run', read_file: 'read', write_file: 'write', edit_file: 'edit', list_dir: 'list',
};

/**
 * Returns an emoji icon for a tool name.
 */
function toolIcon(name) {
  return TOOL_ICONS[name] || null;
}

/**
 * Returns a human-friendly display name for a tool.
 */
function toolDisplayName(name) {
  return TOOL_DISPLAY_NAMES[name] || name;
}

/**
 * Collapses whitespace (including newlines) into single spaces and truncates
 * to maxLen, appending an ellipsis if anything was cut. Used to keep
 * always-visible summary lines from growing without bound while the full,
 * untruncated text stays available elsewhere (an expandable detail block).
 */
function truncateInline(text, maxLen) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) + '…' : collapsed;
}

/**
 * Full, untruncated primary argument text for a tool call — used for the
 * expanded view. Mirrors the key priority of formatToolArgs().
 */
function toolArgFullText(args) {
  if (!args) return '';
  // `path` (Copilot's own tool schema) vs. `file_path` (Claude's native
  // Read/Edit/Write/NotebookEdit tools, forwarded as-is via the Claude Code
  // ACP adapter's `rawInput`) — same meaning, different provider, both real.
  if (args.path) return args.path;
  if (args.file_path) return args.file_path;
  if (args.pattern) return args.pattern;
  if (args.command) return args.command;
  if (args.query) return args.query;
  if (args.prompt) return args.prompt;
  // Common MCP tool argument keys (e.g. Playwright): show something useful.
  if (args.url) return args.url;
  if (args.selector) return args.selector;
  if (args.element) return args.element;
  if (args.text) return String(args.text);
  return '';
}

/**
 * Formats tool arguments into a short, single-line summary string for the
 * collapsed view. The untruncated text is available via toolArgFullText().
 */
function formatToolArgs(name, args, maxLen) {
  if (!args) return '';
  if (args.path) return truncatePath(args.path);
  if (args.file_path) return truncatePath(args.file_path);
  const full = toolArgFullText(args);
  return full ? truncateInline(full, maxLen || TOOL_ARGS_MAX_LENGTH) : '';
}

/**
 * Short, single-line preview of a tool's result content for the collapsed
 * summary. The untruncated resultContent stays available in the expandable
 * body, so nothing is lost — this only bounds what's always visible.
 */
function formatToolResultPreview(resultContent, maxLen) {
  return truncateInline(resultContent || '', maxLen || TOOL_PREVIEW_MAX_LENGTH);
}

// ── Session Filtering ────────────────────────────────────────

/**
 * Filters a sessions array by a search query (matches summary, cwd, id).
 */
function filterSessions(sessions, query) {
  if (!query) return sessions;
  const lower = query.toLowerCase();
  return sessions.filter(s =>
    (s.name || '').toLowerCase().includes(lower) ||
    s.id.toLowerCase().includes(lower)
  );
}

// ── Usage / Cost Parsing ─────────────────────────────────────

// Preise pro 1M Tokens. Copilot-Modelle (mit Punkt in der ID) in AI Credits;
// Direkt-API-Modelle (mit Bindestrich) in US-Dollar (input/cache-read/output).
// Bei neuen Modellen hier ergänzen.
const MODEL_PRICING = {
  // Copilot CLI (Credits)
  'claude-haiku-4.5':  { input: 100, cache: 10, output: 500  },
  'claude-sonnet-4.6': { input: 300, cache: 30, output: 1500 },
  'claude-opus-4.6':   { input: 500, cache: 50, output: 2500 },
  'claude-opus-4.8':   { input: 500, cache: 50, output: 2500 },
  // Sonnet 5: Einführungspreis (200/20/1000) bis 31.08.2026, danach regulär (300/30/1500).
  'claude-sonnet-5':   { input: 200, cache: 20, output: 1000, until: '2026-08-31', then: { input: 300, cache: 30, output: 1500 } },
  // Anthropic API (USD pro 1M)
  'claude-haiku-4-5':  { input: 1,   cache: 0.1, output: 5  },
  'claude-sonnet-4-6': { input: 3,   cache: 0.3, output: 15 },
  'claude-opus-4-7':   { input: 5,   cache: 0.5, output: 25 },
  'claude-opus-4-8':   { input: 5,   cache: 0.5, output: 25 },
  // Google Gemini API (USD pro 1M)
  'gemini-2.5-pro':    { input: 1.25, cache: 0.31,  output: 10  },
  'gemini-2.5-flash':  { input: 0.30, cache: 0.075, output: 2.5 },
  // TODO: Preise bestätigen — vorläufig wie 2.5 Flash übernommen.
  'gemini-3.5-flash':  { input: 0.30, cache: 0.075, output: 2.5 },
  // OpenAI API (USD pro 1M) — TODO: bei Preisänderungen aktualisieren.
  'gpt-5.1':           { input: 1.25, cache: 0.125, output: 10 },
  'gpt-5.1-mini':      { input: 0.25, cache: 0.025, output: 2  },
  'gpt-4.1':           { input: 2,    cache: 0.5,   output: 8  },
  // GLM / Zhipu (USD pro 1M, ca.) — TODO: bestätigen.
  'glm-4.6':           { input: 0.6,  cache: 0.11,  output: 2.2 },
  'glm-4.5':           { input: 0.6,  cache: 0.11,  output: 2.2 },
  'glm-4.5-air':       { input: 0.2,  cache: 0.03,  output: 1.1 },
  // Ollama (lokal, kostenlos)
  'llama3.1':          { input: 0, cache: 0, output: 0 },
  'qwen2.5-coder':     { input: 0, cache: 0, output: 0 },
  'gpt-oss:20b':       { input: 0, cache: 0, output: 0 },
};

// Maps a model ID to its backend provider. Unknown IDs default to 'copilot'
// (the CLI passthrough accepts arbitrary model strings), preserving the
// existing behaviour for anything not explicitly an API model.
const MODEL_PROVIDERS = {
  'claude-haiku-4-5':  'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-opus-4-7':   'anthropic',
  'claude-opus-4-8':   'anthropic',
  'gemini-2.5-pro':    'gemini',
  'gemini-2.5-flash':  'gemini',
  'gemini-3.5-flash':  'gemini',
  'gpt-5.1':           'openai',
  'gpt-5.1-mini':      'openai',
  'gpt-4.1':           'openai',
  'glm-4.6':           'glm',
  'glm-4.5':           'glm',
  'glm-4.5-air':       'glm',
  'llama3.1':          'ollama',
  'qwen2.5-coder':     'ollama',
  'gpt-oss:20b':       'ollama',
};

function getModelProvider(modelId) {
  return MODEL_PROVIDERS[modelId] || 'copilot';
}

function parseTokenK(str) {
  if (!str) return null;
  const m = str.match(/([\d.]+)(k?)/i);
  if (!m) return null;
  return m[2].toLowerCase() === 'k' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
}

function parseUsageTokens(text) {
  const m = text.match(/Tokens:\s*input\s*([\d.]+k?),\s*output\s*([\d.]+k?),\s*cached\s*([\d.]+k?)(?:,\s*cachewrite\s*([\d.]+k?))?/i);
  if (!m) return null;
  const tokens = {
    input:  parseTokenK(m[1]),
    output: parseTokenK(m[2]),
    cache:  parseTokenK(m[3]),
  };
  // Direct-API providers also report cache-write tokens (billed at 1.25x input).
  // Copilot's /usage line has no such field, so the key is only added when present.
  if (m[4] !== undefined) tokens.cacheWrite = parseTokenK(m[4]);
  return tokens;
}

function parseUsageRequests(text) {
  const m = text.match(/Requests:\s*([\d.]+)\s*(AI Credits?|AI Units?|premium requests?)/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2] };
}

// ── Dynamic pricing fallback ─────────────────────────────────
// When a model has no hardcoded MODEL_PRICING entry (e.g. a Copilot model the
// CLI reports dynamically), fall back to a public pricing source (LiteLLM),
// injected at runtime as a normalized-key → {input,cache,output} (USD per 1M) map.
let _dynamicPricing = {};

/** Normalize a model id for pricing lookup: lowercase, strip provider prefix. */
function normalizeModelKey(id) {
  return String(id || '').toLowerCase().split('/').pop().trim();
}

/** Inject the dynamic pricing map (from the main process / LiteLLM snapshot). */
function setDynamicPricing(map) {
  _dynamicPricing = (map && typeof map === 'object') ? map : {};
}

/**
 * Look up dynamic pricing for a model, scaled into the model's NATIVE unit:
 * Copilot → AI Credits (USD × 100), direct-API → USD. Returns null if unknown.
 */
function lookupDynamicPrice(modelId) {
  const entry = _dynamicPricing[normalizeModelKey(modelId)];
  if (!entry || typeof entry.input !== 'number' || typeof entry.output !== 'number') return null;
  const scale = getModelProvider(modelId) === 'copilot' ? AIC_PER_USD : 1;
  return {
    input: entry.input * scale,
    cache: (entry.cache != null ? entry.cache : entry.input * 0.1) * scale,
    output: entry.output * scale,
  };
}

/**
 * Resolve a possibly time-boxed pricing entry. An entry may carry an intro price
 * plus `until` (YYYY-MM-DD, inclusive) and `then` (the price after that date):
 *   { input, cache, output, until: '2026-08-31', then: { input, cache, output } }
 * Before/at `until` the intro price applies; afterwards `then`.
 */
function resolveTimedPricing(entry, now) {
  if (!entry || !entry.until || !entry.then) return entry;
  const cutoff = Date.parse(entry.until + 'T23:59:59Z');
  if (!Number.isNaN(cutoff) && now > cutoff) return entry.then;
  const { until, then, ...intro } = entry; // eslint-disable-line no-unused-vars
  return intro;
}

/** Pricing for a model: hardcoded table (time-resolved) first, then the dynamic source. */
function getModelPricing(modelId, now = Date.now()) {
  const hard = MODEL_PRICING[modelId];
  if (hard) return resolveTimedPricing(hard, now);
  return lookupDynamicPrice(modelId) || null;
}

// Raw, UNROUNDED cost in the model's native unit (Copilot → AI Credits,
// direct API → USD) per the pricing table. Keep this unrounded so small USD
// amounts aren't lost; rounding happens only at display time.
function computeRawCost(tokens, modelId) {
  const pricing = getModelPricing(modelId);
  if (!pricing || !tokens) return null;
  // Cache-write tokens (first time a prefix is cached) bill at 1.25x input.
  const cacheWritePrice = pricing.cacheWrite != null ? pricing.cacheWrite : pricing.input * 1.25;
  return (
    (tokens.input || 0) * pricing.input +
    (tokens.cache || 0) * pricing.cache +
    (tokens.cacheWrite || 0) * cacheWritePrice +
    (tokens.output || 0) * pricing.output
  ) / 1_000_000;
}

// Positive per-field delta vs. the previous cumulative reading (clamped ≥ 0).
function deltaTokens(currentTokens, previousTokens) {
  const prev = previousTokens || {};
  return {
    input:      Math.max(0, (currentTokens.input      || 0) - (prev.input      || 0)),
    output:     Math.max(0, (currentTokens.output     || 0) - (prev.output     || 0)),
    cache:      Math.max(0, (currentTokens.cache      || 0) - (prev.cache      || 0)),
    cacheWrite: Math.max(0, (currentTokens.cacheWrite || 0) - (prev.cacheWrite || 0)),
  };
}

function estimateCredits(tokens, modelId) {
  const c = computeRawCost(tokens, modelId);
  return c == null ? null : Math.round(c * 10) / 10;
}

/**
 * Credits for the *new* tokens consumed since the last reading, priced at
 * the model active right now. `/usage` reports cumulative session tokens,
 * so we bill only the positive per-field delta — this avoids retroactively
 * re-pricing earlier tokens when the model is switched mid-session.
 * Negative deltas (e.g. after /clear or /compact) are clamped to 0.
 * @param {{input?:number,output?:number,cache?:number}|null} currentTokens cumulative now
 * @param {{input?:number,output?:number,cache?:number}|null} previousTokens cumulative at last reading
 * @param {string} modelId
 * @returns {number|null} delta credits, or null if model has no pricing / no data
 */
function estimateCreditsDelta(currentTokens, previousTokens, modelId) {
  if (!getModelPricing(modelId) || !currentTokens) return null;
  return estimateCredits(deltaTokens(currentTokens, previousTokens), modelId);
}

// Copilot bills in AI Credits (100 AIC = 1 USD); direct APIs already in USD.
const AIC_PER_USD = 100;

/**
 * Estimate cost in US dollars for the given tokens under a model. Copilot
 * (credit-priced) models are converted from AIC to USD; direct-API models are
 * already USD.
 * @returns {number|null}
 */
function estimateCostUsd(tokens, modelId) {
  const v = computeRawCost(tokens, modelId); // unrounded — don't lose cents
  if (v == null) return null;
  return getModelProvider(modelId) === 'copilot' ? v / AIC_PER_USD : v;
}

/** USD cost for the *new* tokens since the last reading (see estimateCreditsDelta). */
function estimateCostUsdDelta(currentTokens, previousTokens, modelId) {
  if (!getModelPricing(modelId) || !currentTokens) return null;
  return estimateCostUsd(deltaTokens(currentTokens, previousTokens), modelId);
}

// ── Cost Log Helpers ─────────────────────────────────────────

// Entry amount in USD. New entries store `usd`; older entries stored `credits`
// (mixed units) — those are reset on migration, so `usd` is authoritative.
function entryUsd(e) {
  return typeof e.usd === 'number' ? e.usd : 0;
}

// Grouping key for a cost entry: by provider (#5) or by session.
function costEntryKey(e, groupBy) {
  if (groupBy === 'provider') return e.provider || 'copilot';
  return e.sessionId || '__unnamed';
}

function buildCostBuckets(entries, startMs, bucketMs, bucketCount, groupBy = 'session') {
  const buckets = Array.from({ length: bucketCount }, () => new Map());
  for (const e of entries) {
    const idx = Math.floor((e.ts - startMs) / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;
    const key = costEntryKey(e, groupBy);
    buckets[idx].set(key, (buckets[idx].get(key) || 0) + entryUsd(e));
  }
  return buckets;
}

function aggregateCostBySession(entries, groupBy = 'session') {
  const totals = new Map();
  let grand = 0;
  for (const e of entries) {
    const key = costEntryKey(e, groupBy);
    const v = entryUsd(e);
    totals.set(key, (totals.get(key) || 0) + v);
    grand += v;
  }
  return { totals, grand };
}

function trimCostLog(log, maxEntries) {
  if (log.length > maxEntries) log.splice(0, log.length - maxEntries);
  return log;
}

const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DE_WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** ISO-8601 week number (weeks start Monday; week 1 holds the first Thursday). */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((d - firstThu) / (7 * 86400000));
}

/**
 * Calendar-aligned cost period for the chart. `range` is 'day' | 'week' |
 * 'month'; `offset` steps into the past (0 = current period, 1 = previous, …).
 * Returns the local window start, the stacked-chart bucket size/count, whether
 * it is the current period (→ disable the "next" arrow), the range, and a German
 * label. Bucket size is a fixed 24h/1h (a calendar day can differ by an hour at
 * a DST switch — negligible for a cost chart). `now` is injectable for tests.
 * @returns {{startMs:number, bucketMs:number, bucketCount:number, isCurrent:boolean, range:string, label:string}}
 */
function costPeriod(range, offset, now) {
  const o = Math.max(0, Math.floor(offset) || 0);
  const base = new Date(typeof now === 'number' ? now : Date.now());
  if (range === 'day') {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - o);
    const label = o === 0 ? 'Heute' : o === 1 ? 'Gestern'
      : `${DE_WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()}. ${DE_MONTHS[d.getMonth()]}`;
    return { startMs: d.getTime(), bucketMs: 3600000, bucketCount: 24, isCurrent: o === 0, range, label };
  }
  if (range === 'month') {
    const d = new Date(base.getFullYear(), base.getMonth() - o, 1);
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return {
      startMs: d.getTime(), bucketMs: 86400000, bucketCount: days, isCurrent: o === 0, range,
      label: `${DE_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    };
  }
  // week (Mon–Sun)
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const dow = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - o * 7);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const span = mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()}.–${sun.getDate()}. ${DE_MONTHS[mon.getMonth()]}`
    : `${mon.getDate()}. ${DE_MONTHS[mon.getMonth()]} – ${sun.getDate()}. ${DE_MONTHS[sun.getMonth()]}`;
  return {
    startMs: mon.getTime(), bucketMs: 86400000, bucketCount: 7, isCurrent: o === 0, range,
    label: `KW ${isoWeekNumber(mon)} · ${span}`,
  };
}

// ── Provider error parsing ───────────────────────────────────

/**
 * Recognise quota / rate-limit / billing errors from any provider (Gemini,
 * Anthropic, OpenAI, …) and turn the raw error text into a short, friendly
 * German message. Returns null if the error is not quota/limit related (so the
 * caller can fall back to showing the raw message).
 *
 * @param {string|object} raw - Raw error message or object.
 * @returns {{title:string, detail:string, retrySeconds:number|null, model:string|null}|null}
 */
function parseQuotaError(raw) {
  if (!raw) return null;
  const text = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw); } catch { return String(raw); } })();

  const codeMatch = text.match(/"code"\s*:\s*(\d{3})/);
  const code = codeMatch ? parseInt(codeMatch[1], 10) : null;

  const isQuota =
    code === 429 ||
    /resource_exhausted|too many requests|rate[\s_-]?limit|\bquota\b|insufficient_quota|overloaded/i.test(text) ||
    /credit balance is too low|out of credits|insufficient funds|exceeded your current quota|billing|limit:\s*0/i.test(text);
  if (!isQuota) return null;

  // Optional retry hint (Gemini "Please retry in 4.4s" / retryDelay "4s").
  let retrySeconds = null;
  const retry = text.match(/retry in\s*(\d+(?:\.\d+)?)\s*s/i) || text.match(/retry(?:delay)?["':\s]+(\d+(?:\.\d+)?)\s*s/i);
  if (retry) retrySeconds = Math.ceil(parseFloat(retry[1]));

  const modelMatch = text.match(/model:\s*([\w.\-]+)/i) || text.match(/"model"\s*:\s*"([^"]+)"/i);
  const model = modelMatch ? modelMatch[1] : null;

  const noFreeQuota = /limit:\s*0/i.test(text);
  const billing = /credit balance is too low|out of credits|insufficient funds|exceeded your current quota|billing/i.test(text);

  let title, detail;
  if (noFreeQuota) {
    title = 'Modell im aktuellen Kontingent nicht verfügbar';
    detail = (model ? `„${model}" ` : 'Dieses Modell ') +
      'hat im kostenlosen Kontingent kein Guthaben (Limit 0). Aktiviere die Abrechnung beim Provider oder wähle ein kostenloses Modell.';
  } else if (billing) {
    title = 'Kosten-/Nutzungslimit erreicht';
    detail = 'Das Guthaben bzw. Ausgabenlimit dieses Providers ist erschöpft. Bitte Plan/Abrechnung prüfen oder ein anderes Modell wählen.';
  } else {
    title = 'Rate-Limit erreicht';
    detail = 'Zu viele Anfragen in kurzer Zeit.' +
      (retrySeconds ? ` Bitte in ~${retrySeconds}s erneut versuchen.` : ' Bitte kurz warten und erneut versuchen.');
  }
  return { title, detail, retrySeconds, model };
}

// ── Agent Prefix ─────────────────────────────────────────────

/**
 * Builds the invisible instruction prefix prepended to a prompt when one or
 * more agents (personas) are active. Copilot's CLI understands its own
 * `/agent Name` slash command to switch persona; every other provider gets a
 * plain-language hint instead, since the model looks up the agent's full
 * instructions itself via the agents index already in its system context and
 * adopts that persona from there.
 * @param {Array<{name: string}>} activeAgentInfos - Active agents (must have a `name`).
 * @param {string} provider - Tab's provider id (e.g. 'copilot', 'claude-code', 'anthropic').
 * @returns {string} Prefix text (ending in `\n\n`), or '' if no agents are active.
 */
function buildAgentPrefix(activeAgentInfos, provider) {
  if (!Array.isArray(activeAgentInfos) || activeAgentInfos.length === 0) return '';
  if (provider === 'copilot') {
    return `${activeAgentInfos.map(ai => `/agent ${ai.name}`).join('\n')}\n\n`;
  }
  return `Nimm für diese Aufgabe die Rolle/Herangehensweise folgender Agenten ein:\n${activeAgentInfos.map(ai => `- ${ai.name}`).join('\n')}\n\n`;
}

// ── Subscription usage (Claude Code plan quota) ──────────────
//
// The claude-agent-acp adapter streams one `SDKRateLimitInfo` per
// `rate_limit_event` (via `_claude/rateLimit`), and each event carries only a
// single window — the one currently binding (`rateLimitType`). Claude plans
// have several windows in parallel (the rolling 5-hour session limit and the
// 7-day weekly limit, plus overage). To show them together we bucket the live
// events by a coarse *family* and remember the latest info per family, so the
// session bar can display e.g. the weekly *and* the 5-hour utilization at once.
//
// The live stream carries the window + status + reset but usually NOT the
// percentage. The exact utilization comes from the `/usage` slash command,
// parsed by `parseUsageWindows()` — the same numbers the official app shows.

/** Short labels for the coarse rate-limit window families. */
const RATE_LIMIT_FAMILY_LABELS = { weekly: 'Woche', session: '5 Std.', overage: 'Overage', other: 'Limit' };
/** Display/sort order of the families (session first — it's the fast-moving one). */
const RATE_LIMIT_FAMILY_ORDER = { session: 0, weekly: 1, overage: 2, other: 3 };
/** Higher = more urgent; drives which window leads the display. */
const RATE_LIMIT_STATUS_SEVERITY = { rejected: 2, allowed_warning: 1, allowed: 0 };
/** German status words appended per window (allowed has none). */
const RATE_LIMIT_STATUS_WORD = { rejected: 'Limit erreicht', allowed_warning: 'fast erreicht' };

/**
 * Maps an SDK `rateLimitType` to a coarse window family. All `seven_day*`
 * variants (incl. opus/sonnet/overage-included) collapse to `weekly`.
 * @param {string} [type]
 * @returns {'session'|'weekly'|'overage'|'other'}
 */
function rateLimitFamily(type) {
  if (type === 'five_hour') return 'session';
  if (type === 'overage') return 'overage';
  if (typeof type === 'string' && type.startsWith('seven_day')) return 'weekly';
  return 'other';
}

/**
 * Normalizes a utilization value to an integer percentage. Both the SDK
 * (`SDKRateLimitInfo.utilization`) and `/usage` report this as 0–100 already,
 * so we only round and clamp. Returns null when no usable number is present.
 * @param {*} utilization
 * @returns {number|null}
 */
function normalizeUtilizationPct(utilization) {
  if (typeof utilization !== 'number' || !isFinite(utilization) || utilization < 0) return null;
  return Math.min(100, Math.round(utilization));
}

/**
 * Formats a millisecond duration as a compact German countdown, e.g.
 * `45 Min.`, `3 Std. 12 Min.`, `2 Std.`, `1 Tag 2 Std.`, `6 Tagen`. A countdown
 * is far easier to grasp than an absolute timestamp. Never negative.
 */
function formatDurationDe(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) {
    const dayWord = d === 1 ? 'Tag' : 'Tagen';
    return h ? `${d} ${dayWord} ${h} Std.` : `${d} ${dayWord}`;
  }
  if (h > 0) return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  return `${m} Min.`;
}

const RESET_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * UTC offset (ms) of an IANA timezone at a given instant, DST included. Throws
 * (via Intl) if the zone name is unknown — the caller falls back to local time.
 */
function tzOffsetMs(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(epochMs))) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUTC - epochMs;
}

/**
 * Epoch ms for a wall-clock time interpreted in `timeZone` (honouring DST via a
 * two-pass offset lookup). With no zone — or an unrecognized one — it falls back
 * to the machine's local time.
 */
function zonedWallClockToEpoch(year, mon, day, hour, min, timeZone) {
  if (!timeZone) return new Date(year, mon, day, hour, min, 0, 0).getTime();
  try {
    const utcGuess = Date.UTC(year, mon, day, hour, min, 0, 0);
    const off1 = tzOffsetMs(utcGuess, timeZone);
    let epoch = utcGuess - off1;
    const off2 = tzOffsetMs(epoch, timeZone); // refine across a DST boundary
    if (off2 !== off1) epoch = utcGuess - off2;
    return epoch;
  } catch (_) {
    return new Date(year, mon, day, hour, min, 0, 0).getTime();
  }
}

/**
 * Parses a `/usage` reset timestamp like `Jul 10, 3:29am (Europe/Berlin)` into
 * epoch ms so it can be rendered as a live countdown. The wall-clock time is
 * interpreted in the timezone named in parentheses (honouring DST), so the
 * countdown stays correct even when the machine's local zone differs; the year
 * is inferred, since reset times are always in the future. Returns null when the
 * text can't be parsed.
 */
function parseResetTextToMs(resetText, nowMs) {
  if (typeof resetText !== 'string') return null;
  // Minutes are optional: on the hour Claude prints e.g. `3pm`, otherwise `3:29am`.
  const m = resetText.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  const mon = RESET_MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  const day = parseInt(m[2], 10);
  let hour = parseInt(m[3], 10) % 12;
  if (/pm/i.test(m[5])) hour += 12;
  const min = m[4] ? parseInt(m[4], 10) : 0;
  const tzMatch = resetText.match(/\(([^)]+)\)/);
  const timeZone = tzMatch ? tzMatch[1].trim() : null;
  const year = new Date(nowMs).getFullYear();
  let t = zonedWallClockToEpoch(year, mon, day, hour, min, timeZone);
  // Reset lies in the future; a computed past time means the year rolled over.
  if (t < nowMs - 24 * 3600 * 1000) t = zonedWallClockToEpoch(year + 1, mon, day, hour, min, timeZone);
  return t;
}

/**
 * Human "Reset …" phrase for a window: a live countdown from the epoch
 * `resetsAt` (from the stream, or parsed out of `/usage`), else the literal
 * reset text as a fallback. Returns null when neither is present.
 */
function resetPhrase(rl, nowMs) {
  if (rl.resetsAt) return `Reset in ${formatDurationDe(rl.resetsAt * 1000 - nowMs)}`;
  if (rl.resetText) return `Reset ${rl.resetText}`;
  return null;
}

/**
 * Records a freshly received `SDKRateLimitInfo` into a family-keyed window map
 * (latest info wins per family), so the 5-hour and weekly limits accumulate
 * across the single-window `rate_limit_event`s. Pure — returns a new object.
 * @param {Object<string,Object>|null|undefined} windows - Existing family map.
 * @param {Object|null} rl - The incoming `_claude/rateLimit` payload.
 * @returns {Object<string,Object>} New family map.
 */
function mergeRateLimitWindows(windows, rl) {
  const base = (windows && typeof windows === 'object') ? { ...windows } : {};
  if (rl && typeof rl === 'object') base[rateLimitFamily(rl.rateLimitType)] = rl;
  return base;
}

/** Normalizes the `formatSubscriptionUsage` input into a flat array of infos. */
function rateLimitList(rateLimits) {
  if (Array.isArray(rateLimits)) return rateLimits.filter(Boolean);
  if (rateLimits && typeof rateLimits === 'object') {
    // A bare SDKRateLimitInfo (has status/utilization/rateLimitType) vs. a
    // family map ({weekly:{…}, session:{…}}).
    if (rateLimits.status !== undefined || rateLimits.utilization !== undefined || rateLimits.rateLimitType !== undefined) {
      return [rateLimits];
    }
    return Object.values(rateLimits).filter(Boolean);
  }
  return [];
}

/** Compact per-window segment for the session bar, e.g. `Woche 86 % (fast erreicht)`. */
function formatWindowSegment(rl, nowMs) {
  const label = rl.label || RATE_LIMIT_FAMILY_LABELS[rateLimitFamily(rl.rateLimitType)];
  const pct = normalizeUtilizationPct(rl.utilization);
  const word = RATE_LIMIT_STATUS_WORD[rl.status];
  // Prefer the %, else a reset countdown, else the bare label — but always keep
  // the status word ("fast erreicht"/"erreicht") when present: the live stream
  // frequently omits `utilization`, so the status is the only warning signal.
  let head;
  if (pct != null) head = `${label} ${pct} %`;
  else {
    const reset = resetPhrase(rl, nowMs);
    head = reset ? `${label} · ${reset}` : label;
  }
  return word ? `${head} (${word})` : head;
}

/**
 * Builds the subscription-usage display (Claude Code plan quota) from the live
 * rate-limit windows. Subscriptions have no per-token price, so instead of a
 * USD cost we surface each window's utilization %, its three-state status
 * (allowed / allowed_warning = „fast erreicht" / rejected = „erreicht") and
 * reset time — the weekly and the 5-hour limit side by side when both are
 * known. Windows are ordered by urgency so the binding one leads. The caller
 * prepends a ⚠️ icon when `warn` is set.
 * @param {Object|Array|null} rateLimits - Family map, array, or a single SDKRateLimitInfo.
 * @param {number|null} [subCostUsd] - Token-equivalent USD cost, if known.
 * @param {number} [now] - Current epoch ms (injectable for tests; defaults to Date.now()).
 * @returns {{ text: string, warn: boolean, tooltip: string }}
 */
function formatSubscriptionUsage(rateLimits, subCostUsd, now) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const all = rateLimitList(rateLimits).slice().sort((a, b) => {
    const sev = (RATE_LIMIT_STATUS_SEVERITY[b.status] || 0) - (RATE_LIMIT_STATUS_SEVERITY[a.status] || 0);
    if (sev) return sev;
    return (RATE_LIMIT_FAMILY_ORDER[rateLimitFamily(a.rateLimitType)] ?? 9)
      - (RATE_LIMIT_FAMILY_ORDER[rateLimitFamily(b.rateLimitType)] ?? 9);
  });

  // Session bar: stay quiet while healthy — surface a window only when it has a
  // utilization % to show or is actively warning/blocking. (The live stream
  // often omits `utilization`, so a plain `allowed` window with only a reset
  // time would just add noise; it still lives in the tooltip below.) Secondary
  // windows (e.g. model-scoped weekly buckets) only appear when actively warning.
  const shown = all.filter(rl => {
    const active = rl.status === 'allowed_warning' || rl.status === 'rejected';
    if (rl.secondary) return active;
    return normalizeUtilizationPct(rl.utilization) != null || active;
  });

  let text = 'Abo';
  let warn = false;
  for (const rl of shown) {
    text += ' · ' + formatWindowSegment(rl, nowMs);
    if (rl.status === 'allowed_warning' || rl.status === 'rejected') warn = true;
  }

  // Tooltip: every known window (incl. healthy ones), so the reset stays discoverable.
  const parts = [];
  for (const rl of all) {
    const label = rl.label || RATE_LIMIT_FAMILY_LABELS[rateLimitFamily(rl.rateLimitType)];
    const pct = normalizeUtilizationPct(rl.utilization);
    const reset = resetPhrase(rl, nowMs);
    const pieces = [];
    if (pct != null) pieces.push(`${pct} %`);
    if (RATE_LIMIT_STATUS_WORD[rl.status]) pieces.push(RATE_LIMIT_STATUS_WORD[rl.status]);
    if (reset) pieces.push(reset);
    parts.push(`${label}: ${pieces.join(' · ') || '—'}`);
  }
  const withOverage = all.find(rl => rl.overageStatus);
  if (withOverage) {
    parts.push(`Overage: ${withOverage.overageStatus}${withOverage.overageDisabledReason ? ' (' + withOverage.overageDisabledReason + ')' : ''}`);
  }
  if (typeof subCostUsd === 'number') parts.push(`Token-Äquivalent: $${subCostUsd.toFixed(4)}`);

  return { text, warn, tooltip: parts.join('\n') || 'Über dein Claude-Abo abgerechnet' };
}

/** Utilization (%) at/above which a plan window is flagged „fast erreicht". */
const SUBSCRIPTION_WARN_PCT = 80;
/** Matches a `/usage` plan line: `Current session: 35% used · resets …`. */
const USAGE_LINE_RE = /Current (session|week)(?:\s*\(([^)]+)\))?:\s*(\d+)\s*%\s*used(?:\s*[·•]\s*resets\s+([^\n]+?))?\s*(?:\n|$)/gi;

/**
 * Parses the plan rate-limit lines from a Claude Code `/usage` response, e.g.
 * `Current session: 35% used · resets Jul 10, 3:29am (Europe/Berlin)` and
 * `Current week (all models): 3% used · resets …`. Returns display-ready window
 * infos (utilization %, literal reset text, status derived from the %). The
 * `Current week (<model>)` buckets are flagged `secondary` so they stay in the
 * tooltip only. The literal reset timestamp is also converted to an epoch
 * (`resetsAt`) so the UI can show a live countdown. Returns [] when nothing
 * matches.
 * @param {string} text - Raw `/usage` output.
 * @param {number} [now] - Current epoch ms (for reset parsing; defaults to Date.now()).
 * @returns {Array<Object>}
 */
function parseUsageWindows(text, now) {
  if (typeof text !== 'string' || !text) return [];
  const nowMs = typeof now === 'number' ? now : Date.now();
  const out = [];
  USAGE_LINE_RE.lastIndex = 0;
  let m;
  while ((m = USAGE_LINE_RE.exec(text)) !== null) {
    const [, scope, qualifierRaw, pctRaw, resetRaw] = m;
    const pct = parseInt(pctRaw, 10);
    const status = pct >= 100 ? 'rejected' : pct >= SUBSCRIPTION_WARN_PCT ? 'allowed_warning' : 'allowed';
    const resetText = resetRaw ? resetRaw.trim() : undefined;
    const resetMs = resetText ? parseResetTextToMs(resetText, nowMs) : null;
    const resetsAt = resetMs != null ? Math.round(resetMs / 1000) : undefined;
    if (scope.toLowerCase() === 'session') {
      out.push({ rateLimitType: 'five_hour', label: RATE_LIMIT_FAMILY_LABELS.session, utilization: pct, status, resetText, resetsAt });
    } else {
      const qualifier = qualifierRaw ? qualifierRaw.trim() : '';
      const allModels = qualifier === '' || /^all models$/i.test(qualifier);
      out.push({
        rateLimitType: 'seven_day',
        label: allModels ? RATE_LIMIT_FAMILY_LABELS.weekly : `${RATE_LIMIT_FAMILY_LABELS.weekly} (${qualifier})`,
        utilization: pct,
        status,
        resetText,
        resetsAt,
        secondary: !allModels,
      });
    }
  }
  return out;
}

// ── Mode persistence ─────────────────────────────────────────

/**
 * Chooses which mode to restore for a provider from a remembered id and the
 * provider's currently-known modes. Returns the saved id when it's still valid,
 * or when the mode list isn't known yet (ACP providers like Claude Code discover
 * their modes only after connecting and will correct an invalid one). Returns
 * null when the saved id is absent or no longer offered by a known list.
 * @param {string|null|undefined} savedModeId
 * @param {Array<{id: string}>} availableModes
 * @returns {string|null}
 */
function pickSavedMode(savedModeId, availableModes) {
  if (!savedModeId) return null;
  const modes = Array.isArray(availableModes) ? availableModes : [];
  if (modes.length && !modes.some(m => m && m.id === savedModeId)) return null;
  return savedModeId;
}

// ── Exports ──────────────────────────────────────────────────
const _api = {
  shortenPath,
  truncatePath,
  formatDate,
  escapeHtml,
  escapeAttr,
  escapeAttrJs,
  contextColor,
  categoryColor,
  toolIcon,
  toolDisplayName,
  formatToolArgs,
  toolArgFullText,
  truncateInline,
  formatToolResultPreview,
  filterSessions,
  TOOL_ICONS,
  TOOL_DISPLAY_NAMES,
  TOOL_ARGS_MAX_LENGTH,
  TOOL_PREVIEW_MAX_LENGTH,
  MODEL_PRICING,
  MODEL_PROVIDERS,
  getModelProvider,
  parseTokenK,
  parseUsageTokens,
  parseUsageRequests,
  estimateCredits,
  estimateCreditsDelta,
  estimateCostUsd,
  estimateCostUsdDelta,
  getModelPricing,
  setDynamicPricing,
  normalizeModelKey,
  buildCostBuckets,
  aggregateCostBySession,
  trimCostLog,
  costPeriod,
  parseQuotaError,
  buildAgentPrefix,
  formatSubscriptionUsage,
  mergeRateLimitWindows,
  rateLimitFamily,
  parseUsageWindows,
  formatDurationDe,
  pickSavedMode,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;        // Node / Jest
} else {
  global.RendererLogic = _api;  // Renderer (browser)
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

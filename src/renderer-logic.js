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
};

const TOOL_DISPLAY_NAMES = {
  grep: 'search', view: 'read', glob: 'find',
  edit: 'edit', create: 'create', powershell: 'run',
  task: 'task', ask_user: 'ask', sql: 'query',
  web_search: 'web search', web_fetch: 'web fetch',
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
 * Formats tool arguments into a short summary string.
 */
function formatToolArgs(name, args, maxLen) {
  const limit = maxLen || TOOL_ARGS_MAX_LENGTH;
  if (!args) return '';
  if (args.path) return truncatePath(args.path);
  if (args.pattern) return args.pattern;
  if (args.command) return args.command.substring(0, limit) + (args.command.length > limit ? '…' : '');
  if (args.query) return args.query.substring(0, limit) + (args.query.length > limit ? '…' : '');
  if (args.prompt) return args.prompt.substring(0, limit) + (args.prompt.length > limit ? '…' : '');
  return '';
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
  filterSessions,
  TOOL_ICONS,
  TOOL_DISPLAY_NAMES,
  TOOL_ARGS_MAX_LENGTH,
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
  parseQuotaError,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;        // Node / Jest
} else {
  global.RendererLogic = _api;  // Renderer (browser)
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

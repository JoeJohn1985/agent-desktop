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
  // Anthropic API (USD pro 1M)
  'claude-haiku-4-5':  { input: 1,   cache: 0.1, output: 5  },
  'claude-sonnet-4-6': { input: 3,   cache: 0.3, output: 15 },
  'claude-opus-4-7':   { input: 5,   cache: 0.5, output: 25 },
  'claude-opus-4-8':   { input: 5,   cache: 0.5, output: 25 },
};

// Maps a model ID to its backend provider. Unknown IDs default to 'copilot'
// (the CLI passthrough accepts arbitrary model strings), preserving the
// existing behaviour for anything not explicitly an API model.
const MODEL_PROVIDERS = {
  'claude-haiku-4-5':  'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-opus-4-7':   'anthropic',
  'claude-opus-4-8':   'anthropic',
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

function estimateCredits(tokens, modelId) {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing || !tokens) return null;
  // Cache-write tokens (first time a prefix is cached) bill at 1.25x input.
  const cacheWritePrice = pricing.cacheWrite != null ? pricing.cacheWrite : pricing.input * 1.25;
  const c = (
    (tokens.input || 0) * pricing.input +
    (tokens.cache || 0) * pricing.cache +
    (tokens.cacheWrite || 0) * cacheWritePrice +
    (tokens.output || 0) * pricing.output
  ) / 1_000_000;
  return Math.round(c * 10) / 10;
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
  if (!MODEL_PRICING[modelId] || !currentTokens) return null;
  const prev = previousTokens || {};
  const deltaTokens = {
    input:      Math.max(0, (currentTokens.input      || 0) - (prev.input      || 0)),
    output:     Math.max(0, (currentTokens.output     || 0) - (prev.output     || 0)),
    cache:      Math.max(0, (currentTokens.cache      || 0) - (prev.cache      || 0)),
    cacheWrite: Math.max(0, (currentTokens.cacheWrite || 0) - (prev.cacheWrite || 0)),
  };
  return estimateCredits(deltaTokens, modelId);
}

// ── Cost Log Helpers ─────────────────────────────────────────

function buildCostBuckets(entries, startMs, bucketMs, bucketCount) {
  const buckets = Array.from({ length: bucketCount }, () => new Map());
  for (const e of entries) {
    const idx = Math.floor((e.ts - startMs) / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;
    const key = e.sessionId || '__unnamed';
    buckets[idx].set(key, (buckets[idx].get(key) || 0) + e.credits);
  }
  return buckets;
}

function aggregateCostBySession(entries) {
  const totals = new Map();
  let grand = 0;
  for (const e of entries) {
    const key = e.sessionId || '__unnamed';
    totals.set(key, (totals.get(key) || 0) + e.credits);
    grand += e.credits;
  }
  return { totals, grand };
}

function trimCostLog(log, maxEntries) {
  if (log.length > maxEntries) log.splice(0, log.length - maxEntries);
  return log;
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
  buildCostBuckets,
  aggregateCostBySession,
  trimCostLog,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;        // Node / Jest
} else {
  global.RendererLogic = _api;  // Renderer (browser)
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';

// Pure business logic extracted from renderer/app.js for testability.
// No DOM, no Electron, no side-effects — just data transformations.

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

// ── Exports ──────────────────────────────────────────────────
module.exports = {
  shortenPath,
  truncatePath,
  formatDate,
  escapeHtml,
  escapeAttr,
  contextColor,
  categoryColor,
  toolIcon,
  toolDisplayName,
  formatToolArgs,
  filterSessions,
  TOOL_ICONS,
  TOOL_DISPLAY_NAMES,
  TOOL_ARGS_MAX_LENGTH,
};

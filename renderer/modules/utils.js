// ── Shared Utilities ──────────────────────────────────────────
// Loaded before all other modules — provides common helpers
'use strict';

// ── UI Constants (shared across all modules) ─────────────────
const SCROLL_BOTTOM_THRESHOLD = 60;
const NOTIFICATION_FREQUENCY_HZ = 880;
const NOTIFICATION_DURATION_S = 0.3;
const TOAST_DISPLAY_MS = 3000;
const TOAST_FADE_MS = 300;
const CHAT_INPUT_MAX_HEIGHT = 150;
const TOOL_PREVIEW_MAX_LENGTH = 150;
const TOOL_ARGS_MAX_LENGTH = 60;
const TERMINAL_SCROLLBACK = 1000;
const TERMINAL_FIT_DELAY_MS = 150;
const RESIZE_FIT_DELAY_MS = 100;
const SESSION_REFRESH_DELAY_MS = 400;

function truncatePath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toolIcon(name) {
  const icons = {
    view: '📄', edit: '✏️', create: '📝', grep: '🔍', glob: '📂',
    powershell: '⚡', task: '🤖', ask_user: '❓', sql: '🗄️',
    web_search: '🌐', web_fetch: '🌐',
  };
  return icons[name] || null;
}

function toolDisplayName(name) {
  const names = {
    grep: 'search', view: 'read', glob: 'find',
    edit: 'edit', create: 'create', powershell: 'run',
    task: 'task', ask_user: 'ask', sql: 'query',
    web_search: 'web search', web_fetch: 'web fetch',
  };
  return names[name] || name;
}

function formatToolArgs(name, args) {
  if (!args) return '';
  if (args.path) return truncatePath(args.path);
  if (args.pattern) return args.pattern;
  if (args.command) return args.command;
  if (args.query) return args.query;
  if (args.prompt) return args.prompt;
  return '';
}

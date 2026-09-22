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
const TERMINAL_SCROLLBACK = 1000;
const TERMINAL_FIT_DELAY_MS = 150;
const RESIZE_FIT_DELAY_MS = 100;
const SESSION_REFRESH_DELAY_MS = 400;

// truncatePath/escapeHtml/escapeAttr/escapeAttrJs/toolIcon/toolDisplayName/
// formatToolArgs/toolArgFullText/formatToolResultPreview and their length
// constants live in src/renderer-logic.js (the single tested source — see
// its own comment on why it's IIFE-wrapped) and are pulled in here as bare
// names so the rest of the renderer can keep calling them unprefixed.
const {
  truncatePath, escapeHtml, escapeAttr, escapeAttrJs, formatMessageTime,
  toolIcon, toolDisplayName, formatToolArgs, toolArgFullText, formatToolResultPreview,
  buildAgentPrefix, formatSubscriptionUsage, mergeRateLimitWindows, parseUsageWindows, pickSavedMode,
  TOOL_ARGS_MAX_LENGTH, TOOL_PREVIEW_MAX_LENGTH,
} = window.RendererLogic;

// Relies on globals provided elsewhere: getSettings (app.js).

// ── Notification Sound ──────────────────────────────────────
/** @type {AudioContext|null} Shared audio context for notification sounds. */
let _audioCtx = null;

/**
 * Play a short sine-wave notification beep (respects sound-enabled setting).
 */
function playNotificationSound() {
  if (getSettings().soundEnabled === false) return;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = NOTIFICATION_FREQUENCY_HZ;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + NOTIFICATION_DURATION_S);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + NOTIFICATION_DURATION_S);
  } catch (e) { console.warn('[audio] Benachrichtigungston fehlgeschlagen:', e.message); }
}

// ── Generic Tag List Rendering ───────────────────────────────
function stripShellWrapper(name) {
  const m = name.match(/^shell\((.+)\)$/);
  return m ? m[1] : name;
}

/**
 * Render a list of removable tag elements into a container.
 * @param {string} containerId - DOM id of the container element.
 * @param {string[]} items - Tag label strings.
 * @param {string} removeFnName - Global function name called on remove click.
 * @param {Array<string>} [extraArgs] - Extra string args passed before the
 *   index (e.g. a provider id), for remove-functions scoped to more than
 *   just a list position.
 */
function renderTagList(containerId, items, removeFnName, extraArgs = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.map((item, i) =>
    `<span class="settings__tool-tag">${escapeHtml(stripShellWrapper(item))} <span class="settings__tool-tag__remove" data-remove-index="${i}">&times;</span></span>`
  ).join('');
  // One delegated listener per render (innerHTML above dropped the previous
  // one along with its nodes) — no inline onclick, so nothing here has to be
  // safe against breaking out of a JS string literal.
  container.onclick = (e) => {
    const btn = e.target.closest('.settings__tool-tag__remove');
    if (!btn || !container.contains(btn)) return;
    const fn = window[removeFnName];
    if (typeof fn === 'function') fn(...extraArgs, Number(btn.dataset.removeIndex));
  };
}

// ── Generic Tag Input Init ───────────────────────────────────
/**
 * Wire up a button + input pair so that clicking the button (or pressing
 * Enter in the input) calls the given add-function with the trimmed value.
 * @param {string} btnId - DOM id of the add button.
 * @param {string} inputId - DOM id of the text input.
 * @param {function(string): void} addFn - Callback receiving the input value.
 */
function initTagInput(btnId, inputId, addFn) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;

  const handler = () => {
    const val = input.value.trim();
    if (val) { addFn(val); input.value = ''; }
  };

  btn.addEventListener('click', handler);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handler(); }
  });
}

// ── Generic Button-Busy Helper ─────────────────────────────────
/**
 * Shows a spinner and disables a button for the duration of an async action,
 * so slow IPC calls (key save/delete, …) give visible feedback instead of
 * looking unresponsive. Always restores the button's original content
 * afterward, even on error — a no-op if the handler already replaced the
 * button's markup (e.g. via a full re-render) by then.
 * @param {HTMLButtonElement} btn
 * @param {() => Promise<void>} asyncFn
 */
async function withButtonBusy(btn, asyncFn) {
  if (!btn) return asyncFn();
  const originalHtml = btn.innerHTML;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>';
  try {
    await asyncFn();
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = originalDisabled;
  }
}

// ── Shared Empty-State Markup ─────────────────────────────────
/**
 * Consistent icon+text markup for an empty sidebar list (Todos, Sessions,
 * Images, session-tools popup, skill manager, …), instead of each spot
 * hand-rolling its own inline-styled placeholder text.
 * @param {string} icon - Single emoji/icon character.
 * @param {string} text - Message shown below the icon.
 * @returns {string}
 */
function emptyStateHtml(icon, text) {
  return `<div class="sidebar__empty"><span class="sidebar__empty-icon">${icon}</span><span>${escapeHtml(text)}</span></div>`;
}

// ── Toast Notifications ─────────────────────────────────────
/**
 * Display a toast notification that auto-dismisses after a timeout.
 * @param {string} message - Text to display.
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - Visual style.
 */
function showNotification(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  (document.getElementById('toastStack') || document.body).appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DISPLAY_MS);
}

// ── Date Formatting ──────────────────────────────────────────
/**
 * Human-relative timestamp for session/message lists ("vor 5 Min.", falls
 * back to a short date past a week).
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `vor ${diffD} Tag${diffD > 1 ? 'en' : ''}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ── Tooltips ──────────────────────────────────────────────────
/**
 * Global delegated tooltip: any element with a `data-tooltip` attribute gets
 * a hover tooltip positioned above (or below, if clipped) the element.
 */
function initTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'js-tooltip';
  document.body.appendChild(tooltip);
  let showTimeout = null;
  let currentTarget = null;

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target || target === currentTarget) return;
    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    currentTarget = target;
    clearTimeout(showTimeout);
    showTimeout = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      tooltip.textContent = text;
      tooltip.style.visibility = 'hidden';
      tooltip.classList.add('js-tooltip--visible');

      requestAnimationFrame(() => {
        const ttWidth = tooltip.offsetWidth;
        const ttHeight = tooltip.offsetHeight;
        let left = rect.left + rect.width / 2 - ttWidth / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - ttWidth - 4));
        tooltip.style.left = left + 'px';
        tooltip.style.transform = 'none';
        if (rect.top - ttHeight - 8 > 0) {
          tooltip.style.top = (rect.top - ttHeight - 8) + 'px';
        } else {
          tooltip.style.top = (rect.bottom + 8) + 'px';
        }
        tooltip.style.visibility = '';
      });
    }, SESSION_REFRESH_DELAY_MS);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    if (target === currentTarget) currentTarget = null;
    clearTimeout(showTimeout);
    tooltip.classList.remove('js-tooltip--visible');
  });
}

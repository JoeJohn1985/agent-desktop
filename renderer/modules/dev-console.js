// ── Developer Console Module ──────────────────────────────────
// Extracted from app.js — Dev console for debug/log output
'use strict';

const devConsoleLogs = [];
const DEV_CONSOLE_MAX_ENTRIES = 1000;
let devConsoleFilter = 'all';

function addDevConsoleEntry(entry) {
  devConsoleLogs.push(entry);
  if (devConsoleLogs.length > DEV_CONSOLE_MAX_ENTRIES) devConsoleLogs.shift();

  const body = document.getElementById('devConsoleBody');
  const panel = document.getElementById('devConsolePanel');
  if (!body || !panel || panel.style.display === 'none') return;
  if (devConsoleFilter !== 'all' && entry.level !== devConsoleFilter) return;

  appendDevConsoleRow(body, entry);
}

function appendDevConsoleRow(body, entry) {
  const row = document.createElement('div');
  row.className = `dev-console__entry dev-console__entry--${entry.level}`;
  const time = new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  row.innerHTML = `<span class="dev-console__time">${time}</span><span class="dev-console__level dev-console__level--${entry.level}">${entry.level}</span><span class="dev-console__msg">${escapeHtml(entry.message)}</span>`;
  body.appendChild(row);
  // Cap the DOM like the array — while the panel stays open, live-appended
  // rows would otherwise accumulate without limit.
  while (body.childElementCount > DEV_CONSOLE_MAX_ENTRIES) body.firstElementChild.remove();
  body.scrollTop = body.scrollHeight;
}

function renderDevConsole() {
  const body = document.getElementById('devConsoleBody');
  if (!body) return;
  body.innerHTML = '';
  const filtered = devConsoleFilter === 'all' ? devConsoleLogs : devConsoleLogs.filter(e => e.level === devConsoleFilter);
  filtered.forEach(entry => appendDevConsoleRow(body, entry));
}

function formatDevConsoleForClipboard() {
  const entries = devConsoleFilter === 'all'
    ? devConsoleLogs
    : devConsoleLogs.filter(e => e.level === devConsoleFilter);
  return entries.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    return `${time} [${entry.level.toUpperCase()}] ${entry.message}`;
  }).join('\n');
}

function toggleDevConsole() {
  const panel = document.getElementById('devConsolePanel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  if (!visible) renderDevConsole();
}

function updateStatus(text, color) {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  badge.textContent = text;
  badge.style.color = color || 'var(--green)';
}

function updateStatusbar(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Initialize the developer console panel: log capture, filtering,
 * and renderer console re-wiring for live log display.
 * Relies on globals provided elsewhere: showNotification (modules/utils.js).
 */
function initDevConsole() {
  document.getElementById('btnDevConsole')?.addEventListener('click', toggleDevConsole);
  document.getElementById('devConsoleClose')?.addEventListener('click', () => {
    document.getElementById('devConsolePanel').style.display = 'none';
  });
  document.getElementById('devConsoleClear')?.addEventListener('click', () => {
    devConsoleLogs.length = 0;
    document.getElementById('devConsoleBody').innerHTML = '';
  });

  document.getElementById('devConsoleCopy')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = formatDevConsoleForClipboard();
    if (!text) {
      showNotification('Konsole ist leer', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = original; }, 1200);
      showNotification('Konsole kopiert', 'success');
    } catch (err) {
      showNotification(`Kopieren fehlgeschlagen: ${err.message}`, 'error');
    }
  });

  document.querySelectorAll('.dev-console__filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dev-console__filter').forEach(b => b.classList.remove('dev-console__filter--active'));
      btn.classList.add('dev-console__filter--active');
      devConsoleFilter = btn.dataset.level;
      renderDevConsole();
    });
  });

  if (desktop.devConsole) {
    desktop.devConsole.onLog((entry) => addDevConsoleEntry(entry));
  }
  // Renderer logs already flow into addDevConsoleEntry via the single console
  // override at the top of app.js — no replay or re-override needed here.
}

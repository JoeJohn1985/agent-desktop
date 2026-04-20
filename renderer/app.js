const { Terminal } = window;
const { FitAddon } = window.FitAddon;
const { WebLinksAddon } = window.WebLinksAddon;

// ── Skills Definition ────────────────────────────────────────
let skills = []; // dynamically loaded from main process

// ── State ────────────────────────────────────────────────────
let sessions = [];
let activeSessionId = null;
let activeSkills = new Set();

// Multi-Tab Terminal State
const tabs = new Map(); // tabId → { term, fitAddon, container, label }
let activeTabId = null;

const TERM_THEME_LIGHT = {
  background: '#f5f3ef',
  foreground: '#1a1a1a',
  cursor: '#0078d4',
  selectionBackground: '#add6ff',
  black: '#1a1a1a',
  red: '#d1383d',
  green: '#16825d',
  yellow: '#c08b30',
  blue: '#0078d4',
  magenta: '#8b5fc7',
  cyan: '#1a9ba1',
  white: '#e5e5e5',
  brightBlack: '#555555',
  brightRed: '#e64b4b',
  brightGreen: '#1ea870',
  brightYellow: '#d4a04a',
  brightBlue: '#2b8fdb',
  brightMagenta: '#a472d9',
  brightCyan: '#28b3b8',
  brightWhite: '#f5f3ef',
};

const TERM_THEME_DARK = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#45475a',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

const TERM_THEME_GEBIT = {
  background: '#EFF1F4',
  foreground: '#00335E',
  cursor: '#3B63A0',
  selectionBackground: '#C8CCD4',
  black: '#3E4143',
  red: '#C00000',
  green: '#006C52',
  yellow: '#FFC000',
  blue: '#3B63A0',
  magenta: '#6B5B95',
  cyan: '#109FDA',
  white: '#EFF1F4',
  brightBlack: '#5F5F5F',
  brightRed: '#C00000',
  brightGreen: '#006C52',
  brightYellow: '#FFC000',
  brightBlue: '#109FDA',
  brightMagenta: '#6B5B95',
  brightCyan: '#109FDA',
  brightWhite: '#FFFFFF',
};

const THEMES = ['light', 'dark', 'gebit'];

function getCurrentTheme() {
  return localStorage.getItem('theme') || 'light';
}

function getTermTheme() {
  const theme = getCurrentTheme();
  if (theme === 'dark') return TERM_THEME_DARK;
  if (theme === 'gebit') return TERM_THEME_GEBIT;
  return TERM_THEME_LIGHT;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  // Update toggle button
  const btn = document.getElementById('btnThemeToggle');
  if (btn) {
    if (theme === 'light') {
      btn.innerHTML = '<span style="filter:grayscale(1) brightness(0.4)">🌙</span>';
      btn.title = 'Dunkel-Modus';
    } else if (theme === 'dark') {
      btn.innerHTML = '<img src="../assets/gebit-logo-white.svg" style="width:18px;height:18px;vertical-align:middle;" alt="GEBIT">';
      btn.title = 'GEBIT-Modus';
    } else {
      btn.innerHTML = '☀️';
      btn.title = 'Hell-Modus';
    }
  }

  // Update all terminal themes
  const termTheme = theme === 'dark' ? TERM_THEME_DARK : theme === 'gebit' ? TERM_THEME_GEBIT : TERM_THEME_LIGHT;
  tabs.forEach(tab => {
    tab.term.options.theme = termTheme;
  });
}

// ── Terminal Tab Management ──────────────────────────────────
async function createTab(command, label) {
  const tabLabel = label || (command === 'copilot' ? '🤖 Copilot' : `Terminal`);

  // Create xterm instance
  const term = new Terminal({
    fontFamily: "'Cascadia Mono', 'Consolas', 'Segoe UI Mono', monospace",
    fontSize: 14,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: getTermTheme(),
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  // Create DOM container
  const container = document.createElement('div');
  container.className = 'terminal-instance';
  document.getElementById('terminals').appendChild(container);

  // Open terminal in DOM so it gets its real size
  term.open(container);

  // Make container visible so layout is calculated
  container.classList.add('terminal-instance--active');

  // Fit to get actual cols/rows from the rendered container
  fitAddon.fit();

  // Wait one frame for layout to settle, then fit again
  await new Promise(r => requestAnimationFrame(r));
  fitAddon.fit();

  const cols = term.cols;
  const rows = term.rows;

  // NOW spawn the PTY with the correct size
  const tabId = await copilot.terminal.create(command, cols, rows);
  container.id = `term-${tabId}`;

  // User input → PTY (and clear status on user input)
  term.onData((data) => {
    copilot.terminal.write(tabId, data);
    const tab = tabs.get(tabId);
    if (tab && tab.status) {
      tab.status = null;
      scheduleStatusRender();
    }
  });

  // Store tab
  tabs.set(tabId, { term, fitAddon, container, label: tabLabel, status: null });

  // Switch to new tab
  switchTab(tabId);
  renderTabs();

  // One more fit pass after everything is settled
  setTimeout(() => {
    fitAddon.fit();
    copilot.terminal.resize(tabId, term.cols, term.rows);
  }, 500);

  updateStatus(`⚡ ${tabLabel}`, 'var(--green)');

  return tabId;
}

function switchTab(tabId) {
  // Hide all terminals
  tabs.forEach((tab, id) => {
    tab.container.classList.toggle('terminal-instance--active', id === tabId);
  });
  activeTabId = tabId;

  // Fit after switch
  const tab = tabs.get(tabId);
  if (tab) {
    setTimeout(() => {
      tab.fitAddon.fit();
      copilot.terminal.resize(tabId, tab.term.cols, tab.term.rows);
      tab.term.focus();
    }, 50);
  }
  renderTabs();
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  copilot.terminal.close(tabId);
  tab.term.dispose();
  tab.container.remove();
  tabs.delete(tabId);

  // Switch to another tab or create new one
  if (tabs.size === 0) {
    createTab('copilot', '🤖 Copilot');
  } else if (activeTabId === tabId) {
    const nextId = tabs.keys().next().value;
    switchTab(nextId);
  }
  renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tabBar');
  const addBtn = document.getElementById('btnAddTab');

  // Remove existing tabs (keep + button)
  bar.querySelectorAll('.tab').forEach(el => el.remove());

  tabs.forEach((tab, id) => {
    const el = document.createElement('div');
    el.className = `tab ${id === activeTabId ? 'tab--active' : ''}`;
    const statusBadge = tab.status === 'question' ? '<span class="tab__status" title="Wartet auf Eingabe">❓</span>'
      : tab.status === 'done' ? '<span class="tab__status" title="Erledigt">✅</span>'
      : '';
    el.innerHTML = `
      <span class="tab__label">${escapeHtml(tab.label)}</span>
      ${statusBadge}
      ${tabs.size > 1 ? `<span class="tab__close">✕</span>` : ''}
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab__close')) {
        closeTab(id);
      } else {
        switchTab(id);
      }
    });
    bar.insertBefore(el, addBtn);
  });
}

// Strip ANSI escape sequences for pattern matching
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// Debounced tab status rendering to avoid flicker and click issues
let statusRenderTimer = null;
function scheduleStatusRender() {
  if (statusRenderTimer) return;
  statusRenderTimer = setTimeout(() => {
    statusRenderTimer = null;
    renderTabs();
  }, 500);
}

// Detect tab status from terminal output
function detectStatus(tab, rawData) {
  const clean = stripAnsi(rawData);

  // Copilot CLI ask_user pattern: line that is ONLY a question (short, ends with ?)
  // Also match explicit (y/n) prompts and selection arrows
  if (/\(y\/n\)/i.test(clean) || /\(Y\/N\)/i.test(clean) || /^\s*[❯›]\s/m.test(clean)) {
    if (tab.status !== 'question') { tab.status = 'question'; scheduleStatusRender(); }
    return;
  }

  // Done patterns: explicit completion markers from Copilot
  if (/✅/.test(clean) || /\bTask complete\b/i.test(clean)) {
    if (tab.status !== 'done') { tab.status = 'done'; scheduleStatusRender(); }
    return;
  }

  // User typed something (input sent) → clear status
  // This is handled by onData from user input side — not here
}

// Route PTY data to correct terminal
function initTerminalIPC() {
  copilot.terminal.onData((tabId, data) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.term.write(data);
      detectStatus(tab, data);
    }
  });

  copilot.terminal.onExit((tabId, code) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.term.writeln(`\r\n\x1b[90m[Prozess beendet mit Code ${code}]\x1b[0m`);
      tab.label = `💀 ${tab.label}`;
      renderTabs();
    }
  });

  // Debounced fit+resize helper to keep PTY and xterm in sync
  let fitTimer = null;
  function debouncedFit() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const tab = tabs.get(activeTabId);
      if (tab) {
        tab.fitAddon.fit();
        copilot.terminal.resize(activeTabId, tab.term.cols, tab.term.rows);
      }
    }, 100);
  }

  // Resize observer for terminal area
  const resizeObserver = new ResizeObserver(() => debouncedFit());
  resizeObserver.observe(document.getElementById('terminals'));

  // Re-fit on window focus (catches IME/speech-to-text layout shifts)
  window.addEventListener('focus', () => {
    setTimeout(() => debouncedFit(), 100);
  });

  // Periodic sync: check every 3s if PTY size matches xterm
  setInterval(() => {
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    tab.fitAddon.fit();
    const { cols, rows } = tab.term;
    if (cols !== tab._lastCols || rows !== tab._lastRows) {
      copilot.terminal.resize(activeTabId, cols, rows);
      tab._lastCols = cols;
      tab._lastRows = rows;
    }
  }, 3000);
}

// Make functions available from HTML onclick
window.switchTab = switchTab;
window.closeTab = closeTab;
window.resumeSession = resumeSession;
window.confirmDeleteSession = confirmDeleteSession;

// ── Sessions ─────────────────────────────────────────────────
async function loadSessions() {
  const allSessions = await copilot.sessions.list();
  sessions = allSessions.filter(s => s.name);
  document.getElementById('sessionCount').textContent = sessions.length;
  renderSessions(sessions);
}

function renderSessions(list) {
  const container = document.getElementById('sessionList');
  if (list.length === 0) {
    container.innerHTML = '<p style="padding:10px;color:var(--text-muted);font-size:12px;">Keine Sessions gefunden</p>';
    return;
  }

  container.innerHTML = list.map(s => {
    const isActive = s.id === activeSessionId;
    const date = s.updatedAt ? formatDate(s.updatedAt) : '–';
    const title = s.summary || shortenPath(s.cwd) || s.id.substring(0, 8);
    const badges = [];
    if (s.isActive) badges.push('<span class="session-card__badge session-card__badge--active">● Live</span>');
    if (s.hasPlan) badges.push('<span class="session-card__badge session-card__badge--plan">📋 Plan</span>');
    if (s.checkpointCount > 0) badges.push(`<span class="session-card__badge">🏁 ${s.checkpointCount}</span>`);

    return `
      <div class="session-card ${isActive ? 'session-card--active' : ''}" title="${s.cwd}">
        <div class="session-card__row">
          <div class="session-card__main" onclick="resumeSession('${s.id}')">
            <div class="session-card__title">${escapeHtml(title)}</div>
            <div class="session-card__meta">
              <span>${date}</span>
              ${badges.join('')}
            </div>
          </div>
          <button class="session-card__delete" onclick="event.stopPropagation();confirmDeleteSession('${s.id}','${escapeHtml(title).replace(/'/g, "\\'")}')" title="Session löschen">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function resumeSession(sessionId) {
  activeSessionId = sessionId;
  renderSessions(filterSessions());

  const session = sessions.find(s => s.id === sessionId);
  const label = '🤖 ' + (session?.name || session?.summary || sessionId.substring(0, 8));
  createTab(`copilot --resume ${sessionId}`, label);

  // Load status info
  loadSessionStatus(sessionId);
}

// ── Delete Session ────────────────────────────────────────────
let pendingDeleteId = null;

function confirmDeleteSession(sessionId, title) {
  pendingDeleteId = sessionId;
  document.getElementById('deleteMessage').textContent =
    `Möchtest du die Session "${title}" wirklich unwiderruflich löschen?`;
  document.getElementById('deleteOverlay').classList.add('overlay--visible');
}

async function executeDeleteSession() {
  if (!pendingDeleteId) return;
  await copilot.sessions.delete(pendingDeleteId);
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
  await loadSessions();
}

function cancelDeleteSession() {
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
}

async function loadSessionStatus(sessionId) {
  const plan = await copilot.sessions.readPlan(sessionId);
  const panel = document.getElementById('statusPanel');

  if (!plan) {
    panel.innerHTML = '<p class="status-panel__empty">Kein Plan vorhanden</p>';
    return;
  }

  // Extract first heading and first few lines
  const lines = plan.split('\n').filter(l => l.trim());
  const title = lines[0]?.replace(/^#+\s*/, '') || 'Plan';
  const preview = lines.slice(1, 6).join('\n');

  panel.innerHTML = `
    <div class="status-panel__item">
      <span class="status-panel__label">Plan</span>
      <span class="status-panel__value">${escapeHtml(title)}</span>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted);white-space:pre-wrap;max-height:150px;overflow-y:auto;">
      ${escapeHtml(preview)}
    </div>
  `;
}

// ── Skills ───────────────────────────────────────────────────
function renderSkills() {
  const container = document.getElementById('skillList');
  container.innerHTML = skills.map(s => {
    const isActive = activeSkills.has(s.id);
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''}"
           onclick="toggleSkill('${s.id}')" title="${escapeHtml(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
        <div class="skill-card__toggle"></div>
      </div>
    `;
  }).join('');
}

function toggleSkill(skillId) {
  if (activeSkills.has(skillId)) activeSkills.delete(skillId);
  else activeSkills.add(skillId);
  renderSkills();

  // Send /skills command to active terminal tab
  if (activeTabId != null) {
    copilot.terminal.write(activeTabId, `/skills ${skillId}\r`);
  }
}

// ── Sidebar Resize ───────────────────────────────────────────
function initResize() {
  const handle = document.getElementById('resizeHandle');
  const sidebar = document.getElementById('sidebar');
  let isResizing = false;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.min(Math.max(e.clientX, 220), 500);
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    // PTY resize is handled by the ResizeObserver on #terminals
  });
}

// ── Search & Filter ──────────────────────────────────────────
function filterSessions() {
  const query = document.getElementById('sessionSearch').value.toLowerCase();
  if (!query) return sessions;
  return sessions.filter(s =>
    (s.summary || '').toLowerCase().includes(query) ||
    (s.cwd || '').toLowerCase().includes(query) ||
    s.id.toLowerCase().includes(query)
  );
}

// ── Section Toggle ───────────────────────────────────────────
window.toggleSection = function(name) {
  const el = document.getElementById(name + 'Content');
  const chevron = document.getElementById(name + 'Chevron');
  if (el) {
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.classList.toggle('sidebar__chevron--collapsed', !isHidden);
  }
};

// ── Helpers ──────────────────────────────────────────────────
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

function shortenPath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function updateStatus(text, color) {
  const badge = document.getElementById('statusBadge');
  badge.textContent = text;
  badge.style.color = color || 'var(--green)';
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme
  applyTheme(getCurrentTheme());

  initTerminalIPC();
  initResize();

  // Load skills dynamically
  skills = await copilot.skills.list();
  renderSkills();

  await loadSessions();

  // Create first tab with Copilot
  await createTab('copilot', '🤖 Copilot');

  // Search
  document.getElementById('sessionSearch').addEventListener('input', () => {
    renderSessions(filterSessions());
  });

  // New Session — opens a new Copilot tab
  document.getElementById('btnNewSession').addEventListener('click', () => {
    createTab('copilot', '🤖 Copilot');
  });

  // + Button — new Copilot tab
  document.getElementById('btnAddTab').addEventListener('click', () => {
    createTab('copilot', '🤖 Copilot');
  });

  // Theme toggle — cycles: light → dark → gebit → light
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    const current = getCurrentTheme();
    const nextIdx = (THEMES.indexOf(current) + 1) % THEMES.length;
    applyTheme(THEMES[nextIdx]);
  });

  // Refresh
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadSessions();
  });

  // Delete session overlay
  document.getElementById('btnDeleteConfirm').addEventListener('click', () => executeDeleteSession());
  document.getElementById('btnDeleteCancel').addEventListener('click', () => cancelDeleteSession());
  document.getElementById('deleteOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deleteOverlay') cancelDeleteSession();
  });
});

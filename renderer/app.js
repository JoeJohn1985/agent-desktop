const { Terminal } = window;
const { FitAddon } = window.FitAddon;
const { WebLinksAddon } = window.WebLinksAddon;

// ── Skills Definition ────────────────────────────────────────
const SKILLS = [
  { id: 'pdf', name: 'PDF', desc: 'PDF-Dateien lesen und analysieren', icon: '📄' },
  { id: 'xlsx', name: 'Excel', desc: 'Excel-Dateien verarbeiten', icon: '📊' },
  { id: 'code-review', name: 'Code Review', desc: 'Code-Änderungen prüfen', icon: '🔍' },
  { id: 'customize-cloud-agent', name: 'Cloud Agent', desc: 'Copilot Cloud Agent konfigurieren', icon: '☁️' },
];

// ── State ────────────────────────────────────────────────────
let sessions = [];
let activeSessionId = null;
let activeSkills = new Set();

// Multi-Tab Terminal State
const tabs = new Map(); // tabId → { term, fitAddon, container, label }
let activeTabId = null;

const TERM_THEME = {
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

// ── Terminal Tab Management ──────────────────────────────────
async function createTab(command, label) {
  const tabId = await copilot.terminal.create(command);
  const tabLabel = label || (command === 'copilot' ? '🤖 Copilot' : `Terminal ${tabId}`);

  // Create xterm instance
  const term = new Terminal({
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: TERM_THEME,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  // Create DOM container
  const container = document.createElement('div');
  container.className = 'terminal-instance';
  container.id = `term-${tabId}`;
  document.getElementById('terminals').appendChild(container);

  term.open(container);

  // User input → PTY
  term.onData((data) => copilot.terminal.write(tabId, data));

  // Store tab
  tabs.set(tabId, { term, fitAddon, container, label: tabLabel });

  // Switch to new tab
  switchTab(tabId);
  renderTabs();
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
    el.innerHTML = `
      <span onclick="switchTab(${id})">${escapeHtml(tab.label)}</span>
      ${tabs.size > 1 ? `<span class="tab__close" onclick="event.stopPropagation();closeTab(${id})">✕</span>` : ''}
    `;
    el.addEventListener('click', () => switchTab(id));
    bar.insertBefore(el, addBtn);
  });
}

// Route PTY data to correct terminal
function initTerminalIPC() {
  copilot.terminal.onData((tabId, data) => {
    const tab = tabs.get(tabId);
    if (tab) tab.term.write(data);
  });

  copilot.terminal.onExit((tabId, code) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.term.writeln(`\r\n\x1b[90m[Prozess beendet mit Code ${code}]\x1b[0m`);
      tab.label = `💀 ${tab.label}`;
      renderTabs();
    }
  });

  // Resize observer for terminal area
  const resizeObserver = new ResizeObserver(() => {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.fitAddon.fit();
      copilot.terminal.resize(activeTabId, tab.term.cols, tab.term.rows);
    }
  });
  resizeObserver.observe(document.getElementById('terminals'));
}

// Make functions available from HTML onclick
window.switchTab = switchTab;
window.closeTab = closeTab;

// ── Sessions ─────────────────────────────────────────────────
async function loadSessions() {
  sessions = await copilot.sessions.list();
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
      <div class="session-card ${isActive ? 'session-card--active' : ''}"
           onclick="resumeSession('${s.id}')" title="${s.cwd}">
        <div class="session-card__title">${escapeHtml(title)}</div>
        <div class="session-card__meta">
          <span>${date}</span>
          ${badges.join('')}
        </div>
      </div>
    `;
  }).join('');
}

function resumeSession(sessionId) {
  activeSessionId = sessionId;
  renderSessions(filterSessions());

  // Open new tab with plain copilot, then type resume command
  const session = sessions.find(s => s.id === sessionId);
  const label = '🤖 ' + (session?.summary || sessionId.substring(0, 8));
  createTab('copilot', label).then(tabId => {
    // Wait for copilot to start, then send resume command
    setTimeout(() => {
      copilot.terminal.write(tabId, `/resume ${sessionId}\r`);
    }, 2000);
  });

  // Load status info
  loadSessionStatus(sessionId);
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
  container.innerHTML = SKILLS.map(s => {
    const isActive = activeSkills.has(s.id);
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''}"
           onclick="toggleSkill('${s.id}')">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${s.name}</div>
          <div class="skill-card__desc">${s.desc}</div>
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
    const tab = tabs.get(activeTabId);
    if (tab) tab.fitAddon.fit();
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    const tab = tabs.get(activeTabId);
    if (tab) tab.fitAddon.fit();
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
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
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
  initTerminalIPC();
  initResize();
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

  // Refresh
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadSessions();
  });
});

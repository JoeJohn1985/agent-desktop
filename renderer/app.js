// Capture renderer console for dev console
const _rendererOrigLog = console.log;
const _rendererOrigWarn = console.warn;
const _rendererOrigError = console.error;
window._rendererLogs = [];
console.log = (...args) => {
  _rendererOrigLog(...args);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  window._rendererLogs.push({ level: 'info', message: '[renderer] ' + msg, timestamp: Date.now() });
};
console.warn = (...args) => {
  _rendererOrigWarn(...args);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  window._rendererLogs.push({ level: 'warn', message: '[renderer] ' + msg, timestamp: Date.now() });
};
console.error = (...args) => {
  _rendererOrigError(...args);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  window._rendererLogs.push({ level: 'error', message: '[renderer] ' + msg, timestamp: Date.now() });
};

// ── Terminal Panel State ──────────────────────────────────────
// Per-tab terminal state is stored in the tab object:
//   tab.terminal = { instance, fitAddon, bodyEl, alive }

// ── Skills Definition ────────────────────────────────────────
let skills = []; // dynamically loaded from main process

// ── State ────────────────────────────────────────────────────
let sessions = [];
let activeSessionId = null;
let activeSkills = new Set();
let userHomeDir = ''; // loaded from main process at startup
const inputHistory = [];
let historyIndex = -1;
let historySavedInput = '';

// Multi-Tab State
const tabs = new Map(); // tabId → { streamEl, label, status }
const pendingToolCalls = new Map(); // toolCallId → {toolName, arguments}
let activeTabId = null;

// ── UI Constants ─────────────────────────────────────────────
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

// ── Global Safety-Net ────────────────────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[App] Unhandled rejection:', e.reason);
});

// ── Path Helper ──────────────────────────────────────────────
function shortenPath(p) {
  if (!p || !userHomeDir) return p || '';
  const homeEscaped = userHomeDir.replace(/[\\/]+/g, '\\\\');
  return p.replace(new RegExp(homeEscaped, 'gi'), '~\\');
}

// ── Auto-Scroll (per-tab) ──────────────────────────────────
function scrollToBottom(streamEl) {
  if (!streamEl) return;
  // Check per-tab autoScroll flag (default true)
  const tabEntry = [...tabs.entries()].find(([, t]) => t.streamEl === streamEl);
  if (tabEntry && tabEntry[1].autoScrollEnabled === false) return;
  streamEl.scrollTop = streamEl.scrollHeight;
}

function initAutoScroll(streamEl) {
  streamEl.addEventListener('scroll', () => {
    const atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < SCROLL_BOTTOM_THRESHOLD;
    // Store per-tab
    const tabEntry = [...tabs.entries()].find(([, t]) => t.streamEl === streamEl);
    if (tabEntry) tabEntry[1].autoScrollEnabled = atBottom;
    const btn = document.getElementById('btnScrollBottom');
    if (btn) btn.style.display = atBottom ? 'none' : 'flex';
  });
}

const THEMES = ['light', 'dark', 'gebit'];

// ── Preferences (file-based persistence) ────────────────────
let _prefs = {};

async function loadPreferences() {
  try {
    _prefs = await copilot.preferences.read() || {};
  } catch (e) {
    console.warn('[prefs] Laden fehlgeschlagen:', e.message);
    _prefs = {};
  }
}

function getPref(key, defaultValue) {
  return _prefs[key] !== undefined ? _prefs[key] : defaultValue;
}

function setPref(key, value) {
  _prefs[key] = value;
  copilot.preferences.write(_prefs).catch(e => {
    console.warn('[prefs] Speichern fehlgeschlagen:', e.message);
  });
}

function getCurrentTheme() {
  return getPref('theme', 'dark');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  setPref('theme', theme);
}

// ── Session Restore ─────────────────────────────────────────
function saveOpenTabs() {
  const openTabs = [];
  tabs.forEach((tab, id) => {
    if (tab.sessionId) {
      openTabs.push({ sessionId: tab.sessionId, label: tab.label });
    }
  });
  setPref('openTabs', openTabs);
}

async function restoreOpenTabs() {
  const openTabs = getPref('openTabs', []);
  if (!openTabs.length) return false;
  try {
    for (const t of openTabs) {
      const tabId = await createTab(t.label || '🤖 Copilot');
      const tab = tabs.get(tabId);
      if (tab) {
        tab.sessionId = t.sessionId;
        activeSessionId = t.sessionId;
        loadTodos(t.sessionId);
        // Start background terminal for restored tab
        if (t.sessionId) {
          copilot.terminal.spawnBackground(tabId, t.sessionId).catch(e => {
            console.warn('[terminal] spawnBackground fehlgeschlagen:', e.message);
          });
        }
        // Display session context for restored tabs
        const session = sessions.find(s => s.id === t.sessionId);
        if (session) displaySessionContext(tab, session);
      }
    }
    return true;
  } catch (e) { console.warn('[app] Tab-Restore fehlgeschlagen:', e.message); return false; }
}

// ── Settings ────────────────────────────────────────────────
function getSettings() {
  return getPref('settings', {});
}

function saveSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  setPref('settings', s);
}

function getAllowedTools() {
  return getSettings().allowedTools || [];
}

function getDeniedTools() {
  return getSettings().deniedTools || [];
}

function getExtraDirs() {
  return getSettings().extraDirs || [];
}

function addAllowedTool(toolName) {
  const tools = getAllowedTools();
  if (!tools.includes(toolName)) {
    tools.push(toolName);
    saveSetting('allowedTools', tools);
  }
  renderAllowedTools();
}

function removeAllowedTool(idx) {
  const tools = getAllowedTools();
  tools.splice(idx, 1);
  saveSetting('allowedTools', tools);
  renderAllowedTools();
}

function renderAllowedTools() { renderTagList('settAllowedToolsList', getAllowedTools(), 'removeAllowedTool'); }

function addDeniedTool(toolName) {
  const tools = getDeniedTools();
  if (!tools.includes(toolName)) {
    tools.push(toolName);
    saveSetting('deniedTools', tools);
  }
  renderDeniedTools();
}

function removeDeniedTool(idx) {
  const tools = getDeniedTools();
  tools.splice(idx, 1);
  saveSetting('deniedTools', tools);
  renderDeniedTools();
}

function renderDeniedTools() { renderTagList('settDeniedToolsList', getDeniedTools(), 'removeDeniedTool'); }

function addExtraDir(dir) {
  const dirs = getExtraDirs();
  if (!dirs.includes(dir)) {
    dirs.push(dir);
    saveSetting('extraDirs', dirs);
  }
  renderExtraDirs();
}

function removeExtraDir(idx) {
  const dirs = getExtraDirs();
  dirs.splice(idx, 1);
  saveSetting('extraDirs', dirs);
  renderExtraDirs();
}

function renderExtraDirs() { renderTagList('settExtraDirsList', getExtraDirs(), 'removeExtraDir'); }

// ── Shell Exceptions (synced to copilot-instructions.md) ────
let shellExceptions = [];

async function loadShellExceptions() {
  shellExceptions = await copilot.instructions.getShellExceptions();
  renderShellExceptions();
}

function renderShellExceptions() { renderTagList('settShellExceptionsList', shellExceptions, 'removeShellException'); }

async function addShellException(text) {
  if (!text || shellExceptions.includes(text)) return;
  shellExceptions.push(text);
  await copilot.instructions.setShellExceptions(shellExceptions);
  renderShellExceptions();
}

async function removeShellException(idx) {
  shellExceptions.splice(idx, 1);
  await copilot.instructions.setShellExceptions(shellExceptions);
  renderShellExceptions();
}

function applyChatFontSize(size) {
  document.querySelectorAll('.stream-output').forEach(el => {
    el.style.fontSize = size + 'px';
  });
}

// ── Developer Mode ──────────────────────────────────────────
function applyDevMode(enabled) {
  const btnTests = document.getElementById('btnTests');
  const btnDevConsole = document.getElementById('btnDevConsole');
  if (btnTests) btnTests.style.display = enabled ? '' : 'none';
  if (btnDevConsole) btnDevConsole.style.display = enabled ? '' : 'none';
  // Hide console panel when devMode is disabled
  if (!enabled) {
    const panel = document.getElementById('devConsolePanel');
    if (panel) panel.style.display = 'none';
  }
}

// ── Notification Sound ──────────────────────────────────────
let _audioCtx = null;
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

// ── Context Color Helper ─────────────────────────────────────
function contextColor(percent) {
  return percent > 80 ? '#f38ba8' : percent > 60 ? '#fab387' : '#a6e3a1';
}

// ── Context Category HTML Builder ────────────────────────────
function buildContextCategoryHtml(categories) {
  if (!categories || !categories.length) return '';
  let html = '<div style="border-top:1px solid var(--border-color,#45475a);padding-top:10px;">';
  for (const cat of categories) {
    const catColor = cat.name === 'Free Space' ? '#a6e3a1' : cat.name === 'Messages' ? '#89b4fa' : cat.name === 'Buffer' ? '#a6adc8' : '#f5c2e7';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px;">
      <span style="color:var(--text-secondary,#a6adc8);">${escapeHtml(cat.name)}</span>
      <span style="font-weight:600;">${cat.tokens} <span style="color:${catColor};">(${cat.percent}%)</span></span>
    </div>
    <div style="background:var(--bg-tertiary,#313244);border-radius:3px;height:4px;overflow:hidden;margin-bottom:8px;">
      <div style="width:${cat.percent}%;height:100%;background:${catColor};border-radius:3px;"></div>
    </div>`;
  }
  html += '</div>';
  return html;
}

// ── Generic Tag List Rendering ───────────────────────────────
function renderTagList(containerId, items, removeFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.map((item, i) =>
    `<span class="settings__tool-tag">${escapeHtml(item)} <span class="settings__tool-tag__remove" onclick="${removeFnName}(${i})">&times;</span></span>`
  ).join('');
}

// ── Generic Tag Input Init ───────────────────────────────────
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

// ── Toast Notifications ─────────────────────────────────────
function showNotification(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DISPLAY_MS);
}

// ── Tab Management ──────────────────────────────────────────
async function createTab(label) {
  const tabLabel = label || '🤖 Copilot';
  const tabId = await copilot.chat.newTab();

  // Create stream output element
  const streamEl = document.createElement('div');
  streamEl.className = 'stream-output';
  streamEl.id = `stream-${tabId}`;
  document.getElementById('streamArea').appendChild(streamEl);
  initAutoScroll(streamEl);
  const savedFontSize = getSettings().chatFontSize;
  if (savedFontSize) streamEl.style.fontSize = savedFontSize + 'px';

  // Status line element — shows thinking/loading indicators
  const statusEl = document.createElement('div');
  statusEl.className = 'stream-status-line';
  streamEl.appendChild(statusEl);

  tabs.set(tabId, {
    streamEl,
    statusEl,
    label: tabLabel,
    sessionId: null,    // filled after first response
    isProcessing: false,
    allowedTools: new Set(),
    context: { model: null, mcp: null, skills: null, instructions: null, cwd: null, files: new Set() },
  });

  switchTab(tabId);
  renderTabs();
  updateStatus(`⚡ ${tabLabel}`, 'var(--green)');
  return tabId;
}

function switchTab(tabId) {
  const panel = document.getElementById('terminalPanel');
  const body = document.getElementById('terminalBody');

  // Hide all stream outputs, show only active
  tabs.forEach((tab, id) => {
    tab.streamEl.classList.toggle('stream-output--active', id === tabId);
    // Hide all terminal bodies
    if (tab.terminal && tab.terminal.bodyEl) {
      tab.terminal.bodyEl.style.display = 'none';
    }
  });

  activeTabId = tabId;
  const activeTab = tabs.get(tabId);

  // Show/hide terminal panel based on whether this tab has a visible terminal
  if (activeTab && activeTab.terminal && activeTab.terminalVisible !== false) {
    activeTab.terminal.bodyEl.style.display = '';
    panel.classList.add('terminal-panel--open');
    // Re-fit after showing
    requestAnimationFrame(() => {
      if (activeTab.terminal.fitAddon) activeTab.terminal.fitAddon.fit();
    });
  } else {
    panel.classList.remove('terminal-panel--open');
  }

  // Load todos and context for this tab's session
  if (activeTab && activeTab.sessionId) {
    activeSessionId = activeTab.sessionId;
    loadTodos(activeTab.sessionId);
  } else {
    loadTodos(null);
  }

  renderTabs();
  
  // Update context button for this tab
  const ctxBtn = document.getElementById('btnSlashContext');
  if (activeTab && activeTab.contextPercent != null) {
    const pct = activeTab.contextPercent;
    const color = contextColor(pct);
    ctxBtn.innerHTML = `📊 <span style="color:${color}">${pct}%</span>`;
  } else {
    ctxBtn.textContent = '📊 Kontext';
  }
  
  document.getElementById('chatInput')?.focus();
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  try { copilot.chat.stop(tabId); } catch (_) {}
  tab.streamEl.remove();

  // Clean up terminal if present
  if (tab.terminal) {
    copilot.terminal.close(tabId);
    if (tab.terminal.instance) tab.terminal.instance.dispose();
    if (tab.terminal.bodyEl) tab.terminal.bodyEl.remove();
    tab.terminal = null;
  }

  tabs.delete(tabId);

  if (tabs.size === 0) {
    createTab('🤖 Copilot');
  } else if (activeTabId === tabId) {
    switchTab(tabs.keys().next().value);
  }
  renderTabs();
  renderSessions(filterSessions());
}

function renderTabs() {
  const bar = document.getElementById('tabBar');
  const addBtn = document.getElementById('btnAddTab');

  bar.querySelectorAll('.tab').forEach(el => el.remove());

  tabs.forEach((tab, id) => {
    const el = document.createElement('div');
    el.className = `tab ${id === activeTabId ? 'tab--active' : ''}`;
    el.setAttribute('data-tooltip', 'Benennen um zu Speichern');

    // Status indicator (for non-active tabs)
    if (id !== activeTabId && tab.tabStatus && tab.tabStatus !== 'idle') {
      const badge = document.createElement('span');
      badge.className = `tab__badge tab__badge--${tab.tabStatus}`;
      const badgeIcons = {
        working: '<svg viewBox="0 0 16 16"><path d="M8 3v5l3 3"/><circle cx="8" cy="8" r="6"/></svg>',
        question: '?',
        done: '<svg viewBox="0 0 16 16"><polyline points="3 8 7 12 13 4"/></svg>',
        error: '!'
      };
      badge.innerHTML = badgeIcons[tab.tabStatus] || '';
      badge.setAttribute('data-tooltip', tab.tabStatus === 'working' ? 'Arbeitet…'
        : tab.tabStatus === 'question' ? 'Wartet auf Eingabe'
        : tab.tabStatus === 'done' ? 'Fertig'
        : tab.tabStatus === 'error' ? 'Fehler' : '');
      el.appendChild(badge);
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab__label';
    labelSpan.textContent = tab.label;
    el.appendChild(labelSpan);

    // Edit (pencil) button — visible on hover
    const editBtn = document.createElement('span');
    editBtn.className = 'tab__edit';
    editBtn.textContent = '✎';
    editBtn.setAttribute('data-tooltip', 'Umbenennen');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startTabRename(id, el, labelSpan);
    });
    el.appendChild(editBtn);

    if (tabs.size > 1) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab__close';
      closeBtn.textContent = '✕';
      closeBtn.setAttribute('data-tooltip', 'Tab schließen (Ctrl+W)');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
      });
      el.appendChild(closeBtn);
    }

    el.addEventListener('click', () => switchTab(id));
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startTabRename(id, el, labelSpan);
    });

    bar.insertBefore(el, addBtn);
  });
  saveOpenTabs();
}

function startTabRename(tabId, tabEl, labelSpan) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Replace label with input
  const input = document.createElement('input');
  input.className = 'tab__rename-input';
  input.value = tab.label.replace(/^🤖\s*/, '');
  input.type = 'text';

  labelSpan.style.display = 'none';
  tabEl.insertBefore(input, labelSpan.nextSibling);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.remove();
    labelSpan.style.display = '';

    if (newName && newName !== tab.label.replace(/^🤖\s*/, '')) {
      tab.label = '🤖 ' + newName;
      labelSpan.textContent = tab.label;

      if (tab.sessionId) {
        // Existing session — just rename
        try {
          await copilot.sessions.rename(tab.sessionId, newName);
        } catch (e) {
          console.warn('[sessions] Umbenennen fehlgeschlagen:', e.message);
          showNotification('Session konnte nicht umbenannt werden', 'error');
        }
      } else {
        // No session yet — create one
        try {
          const newId = await copilot.sessions.create(newName);
          if (newId) {
            tab.sessionId = newId;
            activeSessionId = newId;
            saveOpenTabs();
          }
        } catch (e) {
          console.warn('[sessions] Erstellen fehlgeschlagen:', e.message);
          showNotification('Session konnte nicht erstellt werden', 'error');
        }
      }
      loadSessions(); // refresh sidebar
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.value = tab.label.replace(/^🤖\s*/, '');
      input.blur();
    }
  });
}

// ── Tab Status ───────────────────────────────────────────────
// Status: 'idle' | 'working' | 'question' | 'done' | 'error'
function setTabStatus(tabId, status) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.tabStatus = status;
  renderTabs();
}

// ── Send Message ─────────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || activeTabId == null) return;

  // Add to input history
  if (!inputHistory.length || inputHistory[inputHistory.length - 1] !== text) {
    inputHistory.push(text);
  }
  historyIndex = -1;
  historySavedInput = '';

  const tab = tabs.get(activeTabId);
  if (!tab) return;

  // Detect slash commands → open terminal
  if (text.startsWith('/')) {
    input.value = '';
    input.style.height = 'auto';
    openTerminal(activeTabId, tab.sessionId, text);
    return;
  }

  if (tab.isProcessing) return;

  // Show user message in stream
  const inputEl = document.createElement('div');
  inputEl.className = 'stream-input';
  inputEl.textContent = text;
  tab.streamEl.insertBefore(inputEl, tab.statusEl);

  // Build skill instructions prefix for active skills
  let skillPrefix = '';
  const activeSkillInfos = [];
  if (activeSkills.size > 0) {
    for (const id of activeSkills) {
      const s = skills.find(sk => sk.id === id);
      if (s) {
        activeSkillInfos.push({ name: s.name, icon: s.icon || '🧩' });
      }
    }
    if (activeSkillInfos.length > 0) {
      const skillDescs = [...activeSkills].map(id => {
        const s = skills.find(sk => sk.id === id);
        return s ? `- **${s.name}**: ${s.description}` : null;
      }).filter(Boolean);
      skillPrefix = `Verwende folgende Skills für diese Aufgabe:\n${skillDescs.join('\n')}\n\n`;
    }
  }

  // Show skill indicator tags below user message
  if (activeSkillInfos.length > 0) {
    const skillBar = document.createElement('div');
    skillBar.className = 'stream-input__skills';
    skillBar.innerHTML = activeSkillInfos.map(si =>
      `<span class="stream-input__skill-tag">${si.icon} ${escapeHtml(si.name)}</span>`
    ).join('');
    tab.streamEl.insertBefore(skillBar, tab.statusEl);
  }

  // Show thinking indicator
  tab.statusEl.textContent = '● Thinking…';
  tab.statusEl.style.display = 'block';
  tab.isProcessing = true;
  setTabStatus(activeTabId, 'working');

  // Send to Copilot via JSON API
  const settings = getSettings();
  const autoApprove = settings.autoApproveTools !== false; // default: true
  const mergedTools = new Set([...tab.allowedTools, ...getAllowedTools()]);

  copilot.chat.send(activeTabId, skillPrefix + text, {
    sessionId: tab.sessionId || undefined,
    autoApprove,
    allowedTools: [...mergedTools],
    deniedTools: getDeniedTools(),
    allowAllPaths: settings.allowAllPaths === true,
    addDirs: getExtraDirs(),
  });

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  scrollToBottom(tab.streamEl);
}

// ── Copilot Event Processing (JSONL) ─────────────────────────
function initCopilotIPC() {
  copilot.chat.onEvent((tabId, event) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    switch (event.type) {
      // ── Reasoning / Thinking ──────────────────────────────
      case 'assistant.reasoning_delta': {
        if (!tab._thinkingEl) {
          const details = document.createElement('details');
          details.className = 'stream-thinking';
          details.open = true;
          const summary = document.createElement('summary');
          summary.textContent = '💭 Thinking…';
          details.appendChild(summary);
          const content = document.createElement('div');
          content.className = 'stream-thinking__content';
          details.appendChild(content);
          tab.streamEl.insertBefore(details, tab.statusEl);
          tab._thinkingEl = content;
          tab._thinkingDetails = details;
        }
        tab._thinkingEl.textContent += event.data.deltaContent || '';
        scrollToBottom(tab.streamEl);
        break;
      }

      case 'assistant.reasoning': {
        // Final reasoning — update label but keep open
        if (tab._thinkingDetails) {
          const summary = tab._thinkingDetails.querySelector('summary');
          if (summary) summary.textContent = '💭 Thought process';
        }
        tab._thinkingEl = null;
        tab._thinkingDetails = null;
        break;
      }

      // ── Streaming response text ───────────────────────────
      case 'assistant.message_delta': {
        // Finalize thinking label if still open
        if (tab._thinkingDetails) {
          const summary = tab._thinkingDetails.querySelector('summary');
          if (summary) summary.textContent = '💭 Thought process';
          tab._thinkingEl = null;
          tab._thinkingDetails = null;
        }
        if (!tab._responseEl) {
          tab._responseEl = document.createElement('div');
          tab._responseEl.className = 'stream-response markdown-body';
          tab.streamEl.insertBefore(tab._responseEl, tab.statusEl);
          tab._responseRaw = '';
        }
        tab._responseRaw += event.data.deltaContent || '';
        // Throttled markdown render
        if (!tab._mdTimer) {
          tab._mdTimer = setTimeout(() => {
            tab._mdTimer = null;
            if (tab._responseEl && tab._responseRaw) {
              tab._responseEl.innerHTML = window.markdown.render(tab._responseRaw);
            }
          }, RESIZE_FIT_DELAY_MS);
        }
        scrollToBottom(tab.streamEl);
        break;
      }

      case 'assistant.turn_start':
        tab.statusEl.textContent = '● Thinking…';
        tab.statusEl.style.display = 'block';
        break;

      case 'assistant.turn_end':
        tab.statusEl.style.display = 'none';
        break;

      case 'assistant.message': {
        // Final complete message — render full markdown
        if (tab._responseEl && event.data.content) {
          // Clear any pending throttle timer
          if (tab._mdTimer) { clearTimeout(tab._mdTimer); tab._mdTimer = null; }
          tab._responseEl.innerHTML = window.markdown.render(event.data.content);
        }
        tab._responseEl = null;
        tab._responseRaw = '';

        // Show tool requests (what the assistant wants to call)
        if (event.data.toolRequests && event.data.toolRequests.length > 0) {
          for (const req of event.data.toolRequests) {
            if (req.name === 'report_intent') continue;
            const icon = toolIcon(req.name);
            if (!icon) continue; // hide unknown tools
            const el = document.createElement('div');
            el.className = 'stream-tool-call';
            const args = formatToolArgs(req.name, req.arguments);
            el.innerHTML = `<span class="stream-tool-call__icon">${icon}</span> <span class="stream-tool-call__name">${escapeHtml(toolDisplayName(req.name))}</span> <span class="stream-tool-call__args">${escapeHtml(args)}</span>`;
            tab.streamEl.insertBefore(el, tab.statusEl);
          }
        }
        scrollToBottom(tab.streamEl);
        break;
      }

      // ── Tool execution ────────────────────────────────────
      case 'tool.execution_start': {
        // Track tool call info for denied messages
        if (event.data.toolCallId) {
          pendingToolCalls.set(event.data.toolCallId, {
            toolName: event.data.toolName,
            arguments: event.data.arguments || {},
          });
        }
        if (event.data.toolName === 'report_intent') {
          // Show intent in status line
          tab.statusEl.textContent = `● ${event.data.arguments?.intent || 'Working…'}`;
          tab.statusEl.style.display = 'block';
          break;
        }
        if (event.data.toolName === 'ask_user') {
          setTabStatus(tabId, 'question');
        }
        // Track files from tool arguments
        const args = event.data.arguments || {};
        const filePath = args.path || args.file_path || args.file || null;
        if (filePath && typeof filePath === 'string') {
          tab.context.files.add(filePath);
        }
        // Update status with current tool
        tab.statusEl.textContent = `● Running ${event.data.toolName}…`;
        tab.statusEl.style.display = 'block';
        break;
      }

      case 'tool.execution_complete': {
        // Detect permission denied → show info, don't kill process
        if (event.data.success === false && event.data.error && event.data.error.code === 'denied') {
          const toolInfo = pendingToolCalls.get(event.data.toolCallId) || {};
          const toolName = toolInfo.toolName || event.data.toolName || 'unbekannt';
          const toolArgs = toolInfo.arguments || {};
          // Show denial in stream
          const deniedEl = document.createElement('div');
          deniedEl.className = 'stream-error';
          let detail = toolArgs.path || toolArgs.command || '';
          if (detail) detail = `: ${detail}`;
          deniedEl.textContent = `🔐 ${toolDisplayName(toolName)}${detail} — Keine Berechtigung`;
          tab.streamEl.insertBefore(deniedEl, tab.statusEl);
          scrollToBottom(tab.streamEl);
          // Let the process continue — the agent will find alternative approaches
          break;
        }
        if (!event.data || !event.data.result) break;
        const toolName = event.data.toolName || '';
        if (toolName === 'report_intent') break;
        const icon = toolIcon(toolName);
        if (!icon) break; // hide unknown tools

        const toolEl = document.createElement('details');
        toolEl.className = 'stream-tool-result';
        const success = event.data.success !== false;
        const statusIcon = success ? '✓' : '✗';
        const preview = (event.data.result.content || '').substring(0, TOOL_PREVIEW_MAX_LENGTH).replace(/\n/g, ' ');

        const summary = document.createElement('summary');
        summary.innerHTML = `<span class="stream-tool-result__status ${success ? '' : 'stream-tool-result__status--error'}">${statusIcon}</span> ${icon} <strong>${escapeHtml(toolDisplayName(toolName))}</strong> <span class="stream-tool-result__preview">${escapeHtml(preview)}${preview.length >= TOOL_PREVIEW_MAX_LENGTH ? '…' : ''}</span>`;
        toolEl.appendChild(summary);

        const content = document.createElement('pre');
        content.className = 'stream-tool-result__content';
        content.textContent = event.data.result.content || '';
        toolEl.appendChild(content);

        tab.streamEl.insertBefore(toolEl, tab.statusEl);
        scrollToBottom(tab.streamEl);
        break;
      }

      // ── Session / Setup events ────────────────────────────
      case 'session.mcp_server_status_changed':
        if (event.data.status === 'connected') {
          tab.statusEl.textContent = `● ${event.data.serverName} verbunden`;
          tab.statusEl.style.display = 'block';
        }
        break;

      case 'session.mcp_servers_loaded': {
        const servers = event.data.servers || [];
        const connected = servers.filter(s => s.status === 'connected');
        updateStatusbar('sbMcp', `🔌 ${connected.length}/${servers.length} MCP`);
        tab.context.mcp = `${connected.length}/${servers.length}`;
        tab.statusEl.textContent = '● MCP Server geladen';
        break;
      }

      case 'session.skills_loaded': {
        const skillsList = event.data.skills || [];
        updateStatusbar('sbSkills', `🛠️ ${skillsList.length} Skills`);
        tab.context.skills = skillsList.length;
        tab.statusEl.textContent = '● Skills geladen';
        tab.statusEl.style.display = 'block';
        break;
      }

      case 'session.tools_updated': {
        const modelName = event.data.model || '?';
        // Only set the model on first update — sub-agents send their own model
        // info later but we always want to show the main agent's model.
        if (!tab.context.model) {
          tab.context.model = modelName;
          tab.statusEl.textContent = `● Modell: ${modelName}`;
          tab.statusEl.style.display = 'block';
          updateStatusbar('sbModel', `🧠 ${modelName}`);
        }
        break;
      }

      case 'user.message': {
        // Extract from transformedContent
        const tc = event.data.transformedContent || '';
        // Count instructions
        const instructionMatches = tc.match(/<custom_instruction>|<copilot-instructions>/gi);
        const instrCount = instructionMatches ? instructionMatches.length : 0;
        if (instrCount > 0) {
          updateStatusbar('sbInstructions', `📜 ${instrCount} Instructions`);
          tab.context.instructions = instrCount;
        }
        // Extract working directory
        const cwdMatch = tc.match(/Current working directory:\s*(.+)/i);
        if (cwdMatch) {
          const cwd = cwdMatch[1].trim();
          tab.context.cwd = cwd;
          const short = shortenPath(cwd);
          updateStatusbar('sbCwd', `📁 ${short}`);
        }
        break;
      }

      case 'result':
        // Store sessionId for resume
        if (event.sessionId) {
          tab.sessionId = event.sessionId;
          saveOpenTabs();
          // Start background terminal for this session
          copilot.terminal.spawnBackground(tabId, event.sessionId).catch(e => {
            console.warn('[terminal] spawnBackground fehlgeschlagen:', e.message);
            showNotification('Terminal-Hintergrundprozess konnte nicht gestartet werden', 'error');
          });
          // Show todos panel for this session
          if (!activeSessionId) {
            activeSessionId = event.sessionId;
            loadTodos(event.sessionId);
          }
        }
        break;

      case 'error': {
        const errEl = document.createElement('div');
        errEl.className = 'stream-error';
        errEl.textContent = `⚠️ ${event.data.message}`;
        tab.streamEl.insertBefore(errEl, tab.statusEl);
        break;
      }
    }
  });

  copilot.chat.onDone((tabId, code) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.isProcessing = false;
    tab._responseEl = null;
    tab._thinkingEl = null;
    tab._thinkingDetails = null;
    tab.statusEl.style.display = 'none';

    if (code !== 0) {
      const el = document.createElement('div');
      el.className = 'stream-error';
      el.textContent = `[Prozess beendet mit Code ${code}]`;
      tab.streamEl.insertBefore(el, tab.statusEl);
      setTabStatus(tabId, 'error');
    } else {
      // Only set 'done' if not already 'question'
      if (tab.tabStatus !== 'question') {
        setTabStatus(tabId, 'done');
      }
    }

    scrollToBottom(tab.streamEl);

    // Play sound if tab finished in background
    if (tabId !== activeTabId) {
      playNotificationSound();
    }
  });
}

// Make functions available from HTML onclick
window.switchTab = switchTab;
window.closeTab = closeTab;
window.resumeSession = resumeSession;
window.confirmDeleteSession = confirmDeleteSession;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;

// ── Session Export ──────────────────────────────────────────
function openCwd() {
  copilot.chat.openCwd();
}

function exportChat() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const lines = [];
  const name = tab.label || 'Copilot Chat';
  lines.push(`# ${name}\n`);
  lines.push(`*Exportiert am ${new Date().toLocaleString('de-DE')}*\n`);

  for (const el of tab.streamEl.children) {
    if (el.classList.contains('stream-input')) {
      lines.push(`\n## 👤 Du\n\n${el.textContent.trim()}\n`);
    } else if (el.classList.contains('stream-response')) {
      // Use raw markdown if available, otherwise extract text
      const raw = tab._responseRaw && el === tab._responseEl ? tab._responseRaw : el.textContent.trim();
      lines.push(`\n## 🤖 Copilot\n\n${raw}\n`);
    } else if (el.classList.contains('stream-tool-call')) {
      const toolName = el.querySelector('.stream-tool-call__name')?.textContent || '';
      const toolArgs = el.querySelector('.stream-tool-call__args')?.textContent || '';
      lines.push(`\n> 🔧 **${toolName}** ${toolArgs}\n`);
    }
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '')}_${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Todos ────────────────────────────────────────────────────
let currentTodos = [];

async function loadTodos(sessionId) {
  if (!sessionId) {
    currentTodos = [];
    renderTodos();
    document.getElementById('todosSection').style.display = 'none';
    return;
  }
  document.getElementById('todosSection').style.display = '';
  try {
    currentTodos = await copilot.todos.list(sessionId) || [];
  } catch (e) {
    console.warn('[todos] Laden fehlgeschlagen:', e.message);
    currentTodos = [];
  }
  renderTodos();
}

function renderTodos() {
  const container = document.getElementById('todoList');
  const openCount = currentTodos.filter(t => t.status === 'open').length;
  const totalCount = currentTodos.length;
  document.getElementById('todoCount').textContent =
    totalCount > 0 ? `${openCount}/${totalCount}` : '0';

  if (currentTodos.length === 0) {
    container.innerHTML = '<p style="padding:8px 10px;color:var(--text-muted);font-size:12px;">Keine Todos vorhanden</p>';
    return;
  }

  // Open items first, then done
  const sorted = [...currentTodos].sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    return 0;
  });

  container.innerHTML = sorted.map(t => {
    const checked = t.status === 'done' ? 'checked' : '';
    const doneClass = t.status === 'done' ? 'todo-item--done' : '';
    return `
      <div class="todo-item ${doneClass}" data-id="${t.id}" draggable="true">
        <span class="todo-item__grip">⠿</span>
        <label class="todo-item__check">
          <input type="checkbox" ${checked} onchange="toggleTodo('${escapeAttr(t.id)}')" />
        </label>
        <span class="todo-item__text" data-tooltip="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
        <button class="todo-item__delete" onclick="deleteTodo('${escapeAttr(t.id)}')" data-tooltip="Löschen">✕</button>
      </div>
    `;
  }).join('');

  // Attach drag-and-drop handlers
  initTodoDragDrop(container);
}

function initTodoDragDrop(container) {
  let dragEl = null;

  container.querySelectorAll('.todo-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragEl = el;
      el.classList.add('todo-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      if (dragEl) dragEl.classList.remove('todo-item--dragging');
      dragEl = null;
      container.querySelectorAll('.todo-item--drag-over').forEach(x => x.classList.remove('todo-item--drag-over'));
      // Persist new order
      const orderedIds = [...container.querySelectorAll('.todo-item[data-id]')].map(x => x.dataset.id);
      // Update local array to match new order
      const byId = new Map(currentTodos.map(t => [t.id, t]));
      currentTodos = orderedIds.map(id => byId.get(id)).filter(Boolean);
      if (activeSessionId) {
        copilot.todos.reorder(activeSessionId, orderedIds);
      }
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragEl || el === dragEl) return;
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        container.insertBefore(dragEl, el);
      } else {
        container.insertBefore(dragEl, el.nextSibling);
      }
    });

    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (el !== dragEl) el.classList.add('todo-item--drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('todo-item--drag-over');
    });
  });
}

async function addTodo() {
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (!text || !activeSessionId) return;

  try {
    currentTodos = await copilot.todos.add(activeSessionId, { text }) || currentTodos;
  } catch (e) {
    console.warn('[todos] Hinzufügen fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht hinzugefügt werden', 'error');
    return;
  }
  input.value = '';
  renderTodos();
}

async function toggleTodo(todoId) {
  const todo = currentTodos.find(t => t.id === todoId);
  if (!todo || !activeSessionId) return;
  const newStatus = todo.status === 'done' ? 'open' : 'done';
  try {
    currentTodos = await copilot.todos.update(activeSessionId, todoId, { status: newStatus }) || currentTodos;
  } catch (e) {
    console.warn('[todos] Aktualisieren fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht aktualisiert werden', 'error');
    return;
  }
  renderTodos();
}

async function deleteTodo(todoId) {
  if (!activeSessionId) return;
  try {
    currentTodos = await copilot.todos.delete(activeSessionId, todoId) || currentTodos;
  } catch (e) {
    console.warn('[todos] Löschen fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht gelöscht werden', 'error');
    return;
  }
  renderTodos();
}

// ── Image Gallery ────────────────────────────────────────────
let currentImages = [];

async function loadImages() {
  try {
    currentImages = await copilot.images.list() || [];
  } catch (e) {
    console.warn('[images] Laden fehlgeschlagen:', e.message);
    currentImages = [];
  }
  document.getElementById('imageCount').textContent = currentImages.length;
  renderImages();
}

function renderImages() {
  const container = document.getElementById('imageGallery');
  if (currentImages.length === 0) {
    container.innerHTML = '<div class="image-gallery__empty">Keine Bilder/Videos vorhanden</div>';
    return;
  }

  container.innerHTML = currentImages.map((img, i) => {
    if (img.type === 'video') {
      return `
      <div class="image-gallery__thumb image-gallery__thumb--video" data-tooltip="${escapeHtml(img.name)}" data-index="${i}">
        <div class="image-gallery__video-icon">🎬</div>
        <span class="image-gallery__video-name">${escapeHtml(img.name.length > 15 ? img.name.slice(0, 12) + '…' : img.name)}</span>
        <button class="image-gallery__thumb-extract" data-index="${i}" data-tooltip="Frames extrahieren">🖼️</button>
        <button class="image-gallery__thumb-delete" data-index="${i}" data-tooltip="Löschen">✕</button>
      </div>`;
    }
    return `
    <div class="image-gallery__thumb" data-tooltip="${escapeHtml(img.name)}" data-index="${i}">
      <img src="file:///${img.path.replace(/\\/g, '/')}" alt="${escapeHtml(img.name)}" loading="lazy" />
      <button class="image-gallery__thumb-delete" data-index="${i}" data-tooltip="Löschen">✕</button>
    </div>`;
  }).join('');

  // Event delegation
  container.querySelectorAll('.image-gallery__thumb').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('image-gallery__thumb-delete')) return;
      if (e.target.classList.contains('image-gallery__thumb-extract')) return;
      const img = currentImages[el.dataset.index];
      if (!img) return;
      if (img.type === 'video') {
        extractVideoFrames(img);
      } else {
        openLightbox(img.path, img.name);
      }
    });
  });
  container.querySelectorAll('.image-gallery__thumb-extract').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = currentImages[btn.dataset.index];
      if (img) extractVideoFrames(img);
    });
  });
  container.querySelectorAll('.image-gallery__thumb-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = currentImages[btn.dataset.index];
      if (img) deleteImage(img.path);
    });
  });
}

async function extractVideoFrames(video) {
  showNotification('🎬 Frames werden extrahiert…', 'info');
  try {
    const result = await copilot.videos.extractFrames(video.path, { interval: 1, maxFrames: 30 });
    if (!result.success) {
      showNotification(`❌ ${result.error}`, 'error');
      return;
    }
    const cached = result.cached ? ' (Cache)' : '';
    showNotification(`✅ ${result.count} Frames extrahiert${cached} (${result.duration || '?'}s Video)`, 'success');
    openFrameViewer(result.frames, video.name);
  } catch (e) {
    showNotification(`❌ Fehler: ${e.message}`, 'error');
  }
}

function openFrameViewer(frames, videoName) {
  const lb = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  const info = document.getElementById('lightboxInfo');

  let currentFrame = 0;

  function showFrame(idx) {
    currentFrame = Math.max(0, Math.min(idx, frames.length - 1));
    img.src = 'file:///' + frames[currentFrame].replace(/\\/g, '/');
    info.textContent = `${videoName} — Frame ${currentFrame + 1}/${frames.length}`;
  }

  showFrame(0);
  lb.classList.add('image-lightbox--visible');

  // Keyboard navigation for frames
  function onKey(e) {
    if (!lb.classList.contains('image-lightbox--visible')) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { showFrame(currentFrame + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { showFrame(currentFrame - 1); e.preventDefault(); }
    else if (e.key === 'Home') { showFrame(0); e.preventDefault(); }
    else if (e.key === 'End') { showFrame(frames.length - 1); e.preventDefault(); }
    else if (e.key === 'Escape') {
      lb.classList.remove('image-lightbox--visible');
      document.removeEventListener('keydown', onKey);
    }
  }
  document.addEventListener('keydown', onKey);
}

function openLightbox(filePath, name) {
  const lb = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  const info = document.getElementById('lightboxInfo');
  img.src = 'file:///' + filePath.replace(/\\/g, '/');
  info.textContent = name;
  lb.classList.add('image-lightbox--visible');
}

function closeLightbox(e) {
  if (e && e.target !== document.getElementById('imageLightbox') && !e.target.classList.contains('image-lightbox__close')) return;
  document.getElementById('imageLightbox').classList.remove('image-lightbox--visible');
}

async function deleteImage(filePath) {
  try {
    await copilot.images.delete(filePath);
  } catch (e) {
    console.warn('[images] Löschen fehlgeschlagen:', e.message);
    showNotification('Bild konnte nicht gelöscht werden', 'error');
    return;
  }
  await loadImages();
}

function openImagesFolder() {
  copilot.images.openFolder();
}

// ── Sessions ─────────────────────────────────────────────────

async function loadSessions() {
  let allSessions = [];
  try {
    allSessions = await copilot.sessions.list() || [];
  } catch (e) {
    console.warn('[sessions] Laden fehlgeschlagen:', e.message);
    showNotification('Sessions konnten nicht geladen werden', 'error');
  }
  sessions = allSessions.filter(s => s.userNamed);
  document.getElementById('sessionCount').textContent = sessions.length;
  renderSessions(sessions);
}

function renderSessions(list) {
  const container = document.getElementById('sessionList');
  if (list.length === 0) {
    container.innerHTML = '<p style="padding:10px;color:var(--text-muted);font-size:12px;">Keine Sessions gefunden</p>';
    return;
  }

  const openSessionIds = new Set([...tabs.values()].map(t => t.sessionId).filter(Boolean));
  container.innerHTML = list.map(s => {
    const isLive = openSessionIds.has(s.id);
    const title = s.name || s.summary || truncatePath(s.cwd) || s.id.substring(0, 8);

    return `
      <div class="session-card ${isLive ? 'session-card--live' : ''}" data-tooltip="${s.cwd}">
        <div class="session-card__row">
          <div class="session-card__main" onclick="resumeSession('${escapeAttr(s.id)}')">
            <div class="session-card__title">${escapeHtml(title)}</div>
          </div>
          <button class="session-card__delete" onclick="event.stopPropagation();confirmDeleteSession('${escapeAttr(s.id)}','${escapeAttr(title)}')" data-tooltip="Session löschen">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

async function resumeSession(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  const label = '🤖 ' + (session?.name || session?.summary || sessionId.substring(0, 8));
  const tabId = await createTab(label);
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Immediately set sessionId so the next prompt resumes this session
  tab.sessionId = sessionId;
  // Start background terminal for instant /context access
  copilot.terminal.spawnBackground(tabId, sessionId).catch(e => {
    console.warn('[terminal] spawnBackground fehlgeschlagen:', e.message);
    showNotification('Terminal-Hintergrundprozess konnte nicht gestartet werden', 'error');
  });
  activeSessionId = sessionId;
  loadTodos(sessionId);
  saveOpenTabs();
  renderSessions(filterSessions());

  // Load and display session context (checkpoints, plan) as history overview
  await displaySessionContext(tab, session);
}

async function displaySessionContext(tab, session) {
  if (!session) return;

  const sessionId = session.id;
  const contextEl = document.createElement('div');
  contextEl.className = 'stream-session-context';

  // Header
  const title = session.name || session.summary || sessionId.substring(0, 8);
  let html = `<div class="stream-session-context__header">📋 Session: ${escapeHtml(title)}</div>`;

  // Metadata
  const meta = [];
  if (session.updatedAt) {
    const d = new Date(session.updatedAt);
    meta.push(`Letzte Aktivität: ${d.toLocaleString('de-DE')}`);
  }
  if (session.checkpointCount > 0) {
    meta.push(`${session.checkpointCount} Checkpoint(s)`);
  }
  if (meta.length) {
    html += `<div class="stream-session-context__meta">${escapeHtml(meta.join(' · '))}</div>`;
  }

  // Load checkpoints
  try {
    const checkpoints = await copilot.sessions.readCheckpoints(sessionId);
    if (checkpoints && checkpoints.length > 0) {
      html += '<div class="stream-session-context__section">';
      html += '<div class="stream-session-context__label">🔖 Checkpoints</div>';
      html += '<ul class="stream-session-context__list">';
      // Show last 5 checkpoints
      const recent = checkpoints.slice(-5);
      for (const cp of recent) {
        html += `<li>${escapeHtml(cp.title)}</li>`;
      }
      if (checkpoints.length > 5) {
        html += `<li class="stream-session-context__more">… und ${checkpoints.length - 5} weitere</li>`;
      }
      html += '</ul></div>';
    }
  } catch (e) { console.warn('[sessions] Checkpoints nicht verfügbar:', e.message); }

  // Load plan
  try {
    const plan = await copilot.sessions.readPlan(sessionId);
    if (plan) {
      html += '<div class="stream-session-context__section">';
      html += '<div class="stream-session-context__label">📝 Plan</div>';
      html += `<div class="stream-session-context__plan markdown-body">${window.markdown.render(plan)}</div>`;
      html += '</div>';
    }
  } catch (e) { console.warn('[sessions] Plan nicht verfügbar:', e.message); }

  html += '<div class="stream-session-context__footer">Session bereit — schreibe eine Nachricht um fortzufahren</div>';

  contextEl.innerHTML = html;
  tab.streamEl.insertBefore(contextEl, tab.statusEl);
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

// ── Skills ───────────────────────────────────────────────────
function renderSkills() {
  const container = document.getElementById('skillList');
  container.innerHTML = skills.map(s => {
    const isActive = activeSkills.has(s.id);
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''}"
           onclick="toggleSkill('${s.id}')" data-tooltip="${escapeHtml(s.description)}">
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
  saveSetting('activeSkills', [...activeSkills]);
  renderSkills();
}

// ── Sidebar Resize ───────────────────────────────────────────
function initResize() {
  const handle = document.getElementById('resizeHandle');
  const sidebar = document.getElementById('sidebar');
  let isResizing = false;

  // Restore saved width
  const savedWidth = getPref('sidebarWidth', null);
  if (savedWidth) sidebar.style.width = savedWidth + 'px';

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
    setPref('sidebarWidth', parseInt(sidebar.style.width));
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
  const search = document.querySelector(`#${name}Content`)?.parentElement?.querySelector('.sidebar__search');
  if (el) {
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? '' : 'none';
    if (search) search.style.display = isHidden ? '' : 'none';
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

// ── Test Runner ──────────────────────────────────────────────
function openTestRunner() {
  let backdrop = document.getElementById('testRunnerBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'testRunnerBackdrop';
    backdrop.className = 'test-runner-backdrop';
    backdrop.addEventListener('click', closeTestRunner);
    document.body.appendChild(backdrop);
  }
  backdrop.style.display = 'block';
  document.getElementById('testRunnerPopup').style.display = 'flex';
}

function closeTestRunner() {
  document.getElementById('testRunnerPopup').style.display = 'none';
  const backdrop = document.getElementById('testRunnerBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

async function runTests() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">Tests werden ausgeführt…</div>';

  try {
    const result = await copilot.tests.run();
    renderTestResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

async function runCoverage() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">Coverage wird berechnet…</div>';

  try {
    const result = await copilot.tests.coverage();
    renderCoverageResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

async function runE2E() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">🎭 Playwright E2E Tests werden ausgeführt…</div>';

  try {
    const result = await copilot.tests.e2e();
    renderTestResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTestResults(result, body) {
  if (result.error) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">❌ ${escapeHtml(result.error)}</div>`;
    return;
  }

  const icon = result.success ? '✅' : '❌';
  const durationSec = (result.duration / 1000).toFixed(1);

  let html = `<div class="test-runner__summary">
    <span class="test-runner__stat test-runner__stat--total">${icon} ${result.numTotal} Tests</span>
    <span class="test-runner__stat test-runner__stat--pass">✅ ${result.numPassed} bestanden</span>
    <span class="test-runner__stat test-runner__stat--fail">❌ ${result.numFailed} fehlgeschlagen</span>
    <span class="test-runner__stat test-runner__stat--time">⏱️ ${durationSec}s</span>
  </div>`;

  for (const suite of (result.testResults || [])) {
    const suiteIcon = suite.status === 'passed' ? '✅' : '❌';
    const suiteDuration = suite.duration ? `${suite.duration}ms` : '';

    html += `<div class="test-runner__suite">
      <div class="test-runner__suite-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
        <span>${suiteIcon} ${escapeHtml(suite.name)}</span>
        <span class="test-runner__test-duration">${suiteDuration}</span>
      </div>
      <ul class="test-runner__suite-tests">`;

    for (const test of (suite.tests || [])) {
      const testIcon = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
      const testClass = test.status === 'passed' ? 'test-runner__test--passed' : test.status === 'failed' ? 'test-runner__test--failed' : '';
      const testDur = test.duration != null ? `${test.duration}ms` : '';

      html += `<li class="test-runner__test ${testClass}">
        <span>${testIcon} ${escapeHtml(test.title)}</span>
        <span class="test-runner__test-duration">${testDur}</span>
      </li>`;

      if (test.failureMessages && test.failureMessages.length) {
        html += `<li class="test-runner__test" style="color:#f38ba8;padding-left:36px;font-family:monospace;font-size:10px;white-space:pre-wrap;">${escapeHtml(test.failureMessages.join('\n'))}</li>`;
      }
    }

    html += `</ul></div>`;
  }

  body.innerHTML = html;
}

function renderCoverageResults(result, body) {
  if (result.error) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">❌ ${escapeHtml(result.error)}</div>`;
    return;
  }

  let html = `<div class="test-runner__summary">
    <span class="test-runner__stat test-runner__stat--total">📊 Coverage</span>
    <span class="test-runner__stat test-runner__stat--pass">✅ ${result.numPassed}/${result.numTotal} Tests</span>
  </div>`;

  if (result.files && result.files.length) {
    html += '<div class="test-runner__suite"><div class="test-runner__suite-header" style="cursor:default;"><span>Datei</span><span>Statements</span></div><ul class="test-runner__suite-tests">';
    for (const file of result.files) {
      const color = file.stmts > 80 ? '#a6e3a1' : file.stmts > 50 ? '#fab387' : '#f38ba8';
      html += `<li class="test-runner__test"><span>${escapeHtml(file.file)}</span><span style="color:${color};font-weight:600;">${file.stmts}%</span></li>`;
    }
    html += '</ul></div>';
  }

  body.innerHTML = html;
}

// ── Developer Console ──────────────────────────────────────
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
  body.scrollTop = body.scrollHeight;
}

function renderDevConsole() {
  const body = document.getElementById('devConsoleBody');
  if (!body) return;
  body.innerHTML = '';
  const filtered = devConsoleFilter === 'all' ? devConsoleLogs : devConsoleLogs.filter(e => e.level === devConsoleFilter);
  filtered.forEach(entry => appendDevConsoleRow(body, entry));
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

// ── Context Widget (opens terminal with /context) ────────────

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
  if (args.command) return args.command.substring(0, TOOL_ARGS_MAX_LENGTH) + (args.command.length > TOOL_ARGS_MAX_LENGTH ? '…' : '');
  if (args.query) return args.query.substring(0, TOOL_ARGS_MAX_LENGTH) + (args.query.length > TOOL_ARGS_MAX_LENGTH ? '…' : '');
  if (args.prompt) return args.prompt.substring(0, TOOL_ARGS_MAX_LENGTH) + (args.prompt.length > TOOL_ARGS_MAX_LENGTH ? '…' : '');
  return '';
}

// ── Terminal Panel ────────────────────────────────────────────
async function openTerminal(tabId, sessionId, slashCommand) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Check if node-pty is available
  const available = await copilot.terminal.available();
  if (!available) {
    const errEl = document.createElement('div');
    errEl.className = 'stream-error';
    errEl.textContent = '⚠️ Terminal nicht verfügbar. Bitte "npm install" und "npx electron-rebuild" im copilot-desktop Ordner ausführen.';
    tab.streamEl.insertBefore(errEl, tab.statusEl);
    return;
  }

  // If this tab already has a terminal, just show it and send slash command
  if (tab.terminal && tab.terminal.alive) {
    const panel = document.getElementById('terminalPanel');
    panel.classList.add('terminal-panel--open');
    tab.terminalVisible = true;
    tab.terminal.bodyEl.style.display = '';
    requestAnimationFrame(() => tab.terminal.fitAddon.fit());
    tab.terminal.instance.focus();
    // Send slash command if provided
    if (slashCommand) {
      copilot.terminal.sendCommand(tabId, slashCommand);
    }
    return;
  }

  // Close previous terminal on this tab if dead
  if (tab.terminal) {
    if (tab.terminal.instance) tab.terminal.instance.dispose();
    if (tab.terminal.bodyEl) tab.terminal.bodyEl.remove();
    tab.terminal = null;
  }

  const panel = document.getElementById('terminalPanel');
  const container = document.getElementById('terminalBody');

  // Create a per-tab body element inside the shared terminal body container
  const bodyEl = document.createElement('div');
  bodyEl.className = 'terminal-tab-body';
  bodyEl.style.width = '100%';
  bodyEl.style.height = '100%';
  container.appendChild(bodyEl);

  // Hide other tabs' terminal bodies
  tabs.forEach((t, id) => {
    if (id !== tabId && t.terminal && t.terminal.bodyEl) {
      t.terminal.bodyEl.style.display = 'none';
    }
  });

  // Create xterm instance
  const instance = new Terminal({
    fontSize: 13,
    fontFamily: "'Cascadia Mono', 'Consolas', monospace",
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#1e1e2e',
      selectionBackground: 'rgba(137, 180, 250, 0.3)',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
    cursorBlink: true,
    scrollback: TERMINAL_SCROLLBACK,
  });

  const fitAddon = new FitAddon.FitAddon();
  instance.loadAddon(fitAddon);

  // Store terminal state on the tab
  tab.terminal = { instance, fitAddon, bodyEl, alive: true };
  tab.terminalVisible = true;

  // Show panel
  panel.classList.add('terminal-panel--open');

  // Mount xterm
  instance.open(bodyEl);
  requestAnimationFrame(() => {
    fitAddon.fit();
    setTimeout(() => fitAddon.fit(), TERMINAL_FIT_DELAY_MS);
    setTimeout(() => fitAddon.fit(), 500);
  });

  // Wire up input → PTY
  instance.onData((data) => {
    copilot.terminal.input(tabId, data);
  });

  // Sync PTY size when xterm resizes
  instance.onResize(({ cols, rows }) => {
    copilot.terminal.resize(tabId, cols, rows);
  });

  // Spawn PTY (reuses background PTY if available)
  const result = await copilot.terminal.spawn(tabId, sessionId, slashCommand);
  if (!result.success) {
    instance.writeln(`\r\n\x1b[31m⚠️ ${result.error}\x1b[0m`);
  }

  // If reusing background PTY, replay buffered output
  if (result.reused) {
    const buffer = await copilot.terminal.getBuffer(tabId);
    if (buffer && buffer.length > 0) {
      for (const chunk of buffer) {
        instance.write(chunk);
      }
    }
  }

  // Re-fit and sync terminal size after spawn
  setTimeout(() => {
    if (tab.terminal && tab.terminal.fitAddon) {
      tab.terminal.fitAddon.fit();
      copilot.terminal.resize(tabId, instance.cols, instance.rows);
    }
  }, 200);

  instance.focus();

  // Show in chat stream
  const inputEl = document.createElement('div');
  inputEl.className = 'stream-input';
  inputEl.textContent = slashCommand ? `❯ ${slashCommand} (Terminal)` : '❯ Terminal geöffnet';
  tab.streamEl.insertBefore(inputEl, tab.statusEl);
}

function closeTerminalForTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.terminal) return;

  copilot.terminal.close(tabId);

  if (tab.terminal.instance) {
    tab.terminal.instance.dispose();
  }
  if (tab.terminal.bodyEl) {
    tab.terminal.bodyEl.remove();
  }
  tab.terminal = null;

  // Hide panel if active tab has no terminal
  if (tabId === activeTabId) {
    document.getElementById('terminalPanel').classList.remove('terminal-panel--open');
  }

  document.getElementById('chatInput')?.focus();
}

function minimizeTerminal() {
  document.getElementById('terminalPanel').classList.remove('terminal-panel--open');
  const tab = tabs.get(activeTabId);
  if (tab) tab.terminalVisible = false;
  document.getElementById('chatInput')?.focus();
}

function closeTerminal() {
  // Close terminal of the active tab
  if (activeTabId != null) {
    closeTerminalForTab(activeTabId);
  }
}

function initTerminalIPC() {
  // Receive data from PTY → route to correct tab's terminal
  copilot.terminal.onData((tabId, data) => {
    const tab = tabs.get(tabId);
    if (tab && tab.terminal && tab.terminal.instance) {
      tab.terminal.instance.write(data);
    }
  });

  // Handle PTY exit
  copilot.terminal.onExit((tabId, code) => {
    const tab = tabs.get(tabId);
    if (tab && tab.terminal && tab.terminal.instance) {
      tab.terminal.instance.writeln(`\r\n\x1b[90m[Terminal beendet mit Code ${code}]\x1b[0m`);
      tab.terminal.alive = false;
      // Auto-close after a short delay
      setTimeout(() => {
        if (tab.terminal && !tab.terminal.alive) {
          closeTerminalForTab(tabId);
        }
      }, 2000);
    }
  });
}

function initTerminalResize() {
  const handle = document.getElementById('terminalResize');
  const panel = document.getElementById('terminalPanel');
  let isResizing = false;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const container = panel.parentElement;
    const containerRect = container.getBoundingClientRect();
    const newHeight = containerRect.bottom - e.clientY;
    const clamped = Math.min(Math.max(newHeight, 120), containerRect.height * 0.7);
    panel.style.height = clamped + 'px';
    const tab = tabs.get(activeTabId);
    if (tab && tab.terminal && tab.terminal.fitAddon) tab.terminal.fitAddon.fit();
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    const tab = tabs.get(activeTabId);
    if (tab && tab.terminal && tab.terminal.fitAddon) tab.terminal.fitAddon.fit();
  });
}

// ── Init ─────────────────────────────────────────────────────

async function initStatusbar() {
  try {
    const folders = await copilot.folders.read();
    userHomeDir = folders.homeDir || '';
  } catch (e) { console.warn('[app] Home-Verzeichnis nicht geladen:', e.message); }

  try {
    const cwd = await copilot.chat.getCwd();
    if (cwd) {
      const short = shortenPath(cwd);
      updateStatusbar('sbCwd', `📁 ${short}`);
    }
  } catch (e) { console.warn('[app] CWD nicht geladen:', e.message); }

  try {
    const instrFiles = await copilot.chat.getInstructions();
    if (instrFiles && instrFiles.length > 0) {
      const tooltip = instrFiles.map(f => f.path).join('\n');
      const el = document.getElementById('sbInstructions');
      if (el) {
        el.textContent = `📜 ${instrFiles.length} Instruction${instrFiles.length > 1 ? 's' : ''}`;
        el.setAttribute('data-tooltip', tooltip);
      }
    }
  } catch (e) { console.warn('[app] Instructions nicht geladen:', e.message); }

  try {
    const ver = await copilot.chat.getVersions();
    const el = document.getElementById('sbVersion');
    if (el) {
      el.textContent = `🏷️ v${ver.app}`;
      el.setAttribute('data-tooltip', `App: v${ver.app}\nCLI: ${ver.cli}`);
    }
  } catch (e) { console.warn('[app] Version nicht geladen:', e.message); }
}

async function initDataLoad() {
  try {
    skills = await copilot.skills.list() || [];
  } catch (e) {
    console.warn('[skills] Laden fehlgeschlagen:', e.message);
    skills = [];
  }
  const savedActiveSkills = getSettings().activeSkills || [];
  activeSkills = new Set(savedActiveSkills);
  renderSkills();

  await loadSessions();
  await loadImages();
  copilot.images.onChanged(() => loadImages());
}

function initChatInput() {
  const chatInput = document.getElementById('chatInput');
  const btnSend = document.getElementById('btnSend');

  btnSend.addEventListener('click', () => sendMessage());

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      if (chatInput.value.length > 0 && historyIndex === -1) return;
      e.preventDefault();
      if (historyIndex === -1) {
        historySavedInput = chatInput.value;
        historyIndex = inputHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      chatInput.value = inputHistory[historyIndex];
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
    }
    if (e.key === 'ArrowDown' && historyIndex !== -1) {
      e.preventDefault();
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++;
        chatInput.value = inputHistory[historyIndex];
      } else {
        historyIndex = -1;
        chatInput.value = historySavedInput;
      }
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
  });

  document.getElementById('sessionSearch').addEventListener('input', () => {
    renderSessions(filterSessions());
  });

  document.getElementById('btnAddTab').addEventListener('click', () => {
    createTab('🤖 Copilot');
  });
}

function initWindowControls() {
  document.getElementById('btnWindowMinimize').addEventListener('click', () => copilot.window.minimize());
  document.getElementById('btnWindowMaximize').addEventListener('click', () => copilot.window.maximize());
  document.getElementById('btnWindowClose').addEventListener('click', () => copilot.window.close());

  document.getElementById('btnOpenTerminal').addEventListener('click', () => {
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    if (tab.terminal && tab.terminalVisible !== false) {
      minimizeTerminal();
    } else if (tab.terminal && tab.terminalVisible === false) {
      tab.terminalVisible = true;
      document.getElementById('terminalPanel').classList.add('terminal-panel--open');
      tab.terminal.bodyEl.style.display = '';
      requestAnimationFrame(() => { if (tab.terminal.fitAddon) tab.terminal.fitAddon.fit(); });
    } else {
      openTerminal(activeTabId, tab.sessionId, null);
    }
  });

  document.getElementById('btnExportChat').addEventListener('click', () => exportChat());
  document.getElementById('btnTerminalMinimize').addEventListener('click', () => minimizeTerminal());

  document.getElementById('btnScrollBottom').addEventListener('click', () => {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.autoScrollEnabled = true;
      tab.streamEl.scrollTop = tab.streamEl.scrollHeight;
      document.getElementById('btnScrollBottom').style.display = 'none';
    }
  });

  window.addEventListener('resize', () => {
    const tab = tabs.get(activeTabId);
    if (tab && tab.terminal && tab.terminal.fitAddon) {
      setTimeout(() => tab.terminal.fitAddon.fit(), RESIZE_FIT_DELAY_MS);
    }
  });
}

function initContextPopup() {
  const sbContextBtn = document.getElementById('btnSlashContext');
  const contextPopup = document.getElementById('contextPopup');
  const contextPopupBody = document.getElementById('contextPopupBody');

  document.addEventListener('click', (e) => {
    if (contextPopup.style.display !== 'none' && !contextPopup.contains(e.target) && e.target !== sbContextBtn) {
      contextPopup.style.display = 'none';
    }
  });

  sbContextBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (contextPopup.style.display !== 'none') {
      contextPopup.style.display = 'none';
      return;
    }
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab || !tab.sessionId) {
      showNotification('Keine aktive Session', 'warning');
      return;
    }
    contextPopup.style.display = '';
    contextPopupBody.innerHTML = '<div class="context-popup__loading">⏳ Lade Kontext…</div>';

    let result;
    try {
      result = await copilot.terminal.fetchContext(activeTabId);
    } catch (err) {
      contextPopupBody.innerHTML = `<div class="context-popup__loading">⚠️ ${escapeHtml(err.message || 'Unbekannter Fehler')}</div>`;
      return;
    }
    if (!result.success) {
      contextPopupBody.innerHTML = `<div class="context-popup__loading">⚠️ ${escapeHtml(result.error)}</div>`;
      return;
    }
    if (result.percent != null) {
      const color = contextColor(result.percent);
      let html = `<div style="margin-bottom:12px;">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
          <span style="font-size:20px;font-weight:700;color:${color};">${result.percent}%</span>
          <span style="color:var(--text-secondary,#a6adc8);font-size:11px;">${result.usedTokens || '?'} / ${result.totalTokens || '?'} Tokens</span>
        </div>
        <div style="background:var(--bg-tertiary,#313244);border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${result.percent}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
        </div>
      </div>`;
      html += buildContextCategoryHtml(result.categories);
      contextPopupBody.innerHTML = DOMPurify.sanitize(html);

      const tab = tabs.get(activeTabId);
      if (tab) tab.contextPercent = result.percent;
      sbContextBtn.innerHTML = `📊 <span style="color:${color}">${result.percent}%</span>`;
    } else {
      contextPopupBody.textContent = result.raw;
    }
  });
}

function initCompactPopup() {
  const compactBtn = document.getElementById('btnSlashCompact');
  const compactPopup = document.getElementById('compactPopup');
  const compactPopupBody = document.getElementById('compactPopupBody');

  document.addEventListener('click', (e) => {
    if (compactPopup.style.display !== 'none' && !compactPopup.contains(e.target) && e.target !== compactBtn) {
      compactPopup.style.display = 'none';
    }
  });

  compactBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (compactPopup.style.display !== 'none') {
      compactPopup.style.display = 'none';
      return;
    }
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab || !tab.sessionId) {
      showNotification('Keine aktive Session', 'warning');
      return;
    }
    compactPopup.style.display = '';
    compactPopupBody.innerHTML = '<div class="context-popup__loading">🗜️ Komprimiere Kontext…</div>';
    compactBtn.classList.add('session-actions__btn--loading');

    let result;
    try {
      result = await copilot.terminal.sendSlash(activeTabId, '/compact');
    } catch (err) {
      result = { success: false, error: err.message || 'Unbekannter Fehler' };
    }
    compactBtn.classList.remove('session-actions__btn--loading');

    if (!result.success) {
      compactPopupBody.innerHTML = `<div class="context-popup__loading">⚠️ ${escapeHtml(result.error)}</div>`;
      return;
    }
    if (result.percent != null) {
      const oldPct = tab.contextPercent;
      const newPct = result.percent;
      const color = contextColor(newPct);
      const saved = oldPct != null ? oldPct - newPct : null;

      let html = '<div style="text-align:center;margin-bottom:12px;">';
      html += '<div style="font-size:11px;color:var(--text-secondary,#a6adc8);margin-bottom:4px;">Kontext komprimiert</div>';
      if (saved != null && saved > 0) {
        html += `<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:16px;color:var(--text-secondary,#a6adc8);text-decoration:line-through;">${oldPct}%</span>
          <span style="font-size:14px;color:var(--text-secondary,#a6adc8);">→</span>
          <span style="font-size:22px;font-weight:700;color:${color};">${newPct}%</span>
        </div>`;
        html += `<div style="font-size:12px;color:#a6e3a1;font-weight:600;">−${saved}% freigeräumt</div>`;
      } else {
        html += `<div style="font-size:22px;font-weight:700;color:${color};margin-bottom:4px;">${newPct}%</div>`;
      }
      html += `<div style="background:var(--bg-tertiary,#313244);border-radius:4px;height:8px;overflow:hidden;margin-top:8px;">
        <div style="width:${newPct}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
      </div>`;
      if (result.usedTokens && result.totalTokens) {
        html += `<div style="font-size:10px;color:var(--text-secondary,#a6adc8);margin-top:4px;">${result.usedTokens} / ${result.totalTokens} Tokens</div>`;
      }
      html += '</div>';
      html += buildContextCategoryHtml(result.categories);
      compactPopupBody.innerHTML = html;

      tab.contextPercent = newPct;
      const ctxBtn = document.getElementById('btnSlashContext');
      ctxBtn.innerHTML = `📊 <span style="color:${color}">${newPct}%</span>`;
      showNotification(`Kontext komprimiert: ${newPct}%`, 'success');
    } else {
      compactPopupBody.innerHTML = `<div style="font-size:12px;line-height:1.6;white-space:pre-wrap;max-height:300px;overflow-y:auto;">${escapeHtml(result.output)}</div>`;
      showNotification('Kontext komprimiert ✓', 'success');
    }
  });
}

function initSlashButtons() {
  document.getElementById('btnSlashClear').addEventListener('click', async () => {
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab || !tab.sessionId) {
      showNotification('Keine aktive Session', 'warning');
      return;
    }
    const btn = document.getElementById('btnSlashClear');
    btn.classList.add('session-actions__btn--loading');
    let result;
    try {
      result = await copilot.terminal.sendSlash(activeTabId, '/clear');
    } catch (err) {
      result = { success: false, error: err.message || 'Unbekannter Fehler' };
    }
    btn.classList.remove('session-actions__btn--loading');
    if (result.success) {
      showNotification('Chat-Kontext geleert ✓', 'success');
      const ctxBtn = document.getElementById('btnSlashContext');
      ctxBtn.textContent = '📊 Kontext';
      const tab2 = tabs.get(activeTabId);
      if (tab2) tab2.contextPercent = null;
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  });

  document.getElementById('btnAddTodo').addEventListener('click', () => addTodo());
  document.getElementById('todoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
  });

  document.getElementById('btnSyncTodos').addEventListener('click', async () => {
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab || !tab.sessionId) {
      showNotification('Keine aktive Session', 'warning');
      return;
    }
    if (tab.isProcessing) {
      showNotification('Chat ist noch beschäftigt', 'warning');
      return;
    }
    const openTodos = currentTodos.filter(t => t.status === 'open').slice(0, 5);
    if (openTodos.length === 0) {
      showNotification('Keine offenen Todos', 'info');
      return;
    }
    const todoList = openTodos.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
    const prompt = `Hier sind meine nächsten Todos. Bitte arbeite sie der Reihe nach ab:\n\n${todoList}`;
    try {
      for (const todo of openTodos) {
        await copilot.todos.update(tab.sessionId, todo.id, { status: 'done' });
      }
      await loadTodos(tab.sessionId);
    } catch (err) {
      showNotification(`Fehler: ${err.message}`, 'error');
      return;
    }
    document.getElementById('chatInput').value = prompt;
    sendMessage();
    showNotification(`${openTodos.length} Todos gesendet ✓`, 'success');
  });

  document.getElementById('btnDeleteConfirm').addEventListener('click', () => executeDeleteSession());
  document.getElementById('btnDeleteCancel').addEventListener('click', () => cancelDeleteSession());
  document.getElementById('deleteOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deleteOverlay') cancelDeleteSession();
  });
}

function initSettings() {
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settTheme = document.getElementById('settTheme');
  const settFontSize = document.getElementById('settFontSize');
  const settFontSizeVal = document.getElementById('settFontSizeVal');
  const settSound = document.getElementById('settSound');
  const settDevMode = document.getElementById('settDevMode');
  const settAutoApprove = document.getElementById('settAutoApprove');
  const settAllowAllPaths = document.getElementById('settAllowAllPaths');

  document.querySelectorAll('.settings__tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings__tab').forEach(t => t.classList.remove('settings__tab--active'));
      document.querySelectorAll('.settings__panel').forEach(p => p.classList.remove('settings__panel--active'));
      tab.classList.add('settings__tab--active');
      const panel = document.querySelector(`.settings__panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add('settings__panel--active');
    });
  });

  const savedSettings = getSettings();
  settTheme.value = getCurrentTheme();
  const fontSize = savedSettings.chatFontSize || 16;
  settFontSize.value = fontSize;
  settFontSizeVal.textContent = fontSize + 'px';
  applyChatFontSize(fontSize);
  settSound.checked = savedSettings.soundEnabled !== false;
  settDevMode.checked = savedSettings.devMode === true;
  applyDevMode(savedSettings.devMode === true);
  settAutoApprove.checked = savedSettings.autoApproveTools !== false;
  settAllowAllPaths.checked = savedSettings.allowAllPaths === true;

  document.getElementById('btnSettings').addEventListener('click', () => {
    settTheme.value = getCurrentTheme();
    settingsOverlay.classList.add('overlay--visible');
  });

  document.getElementById('btnSettingsClose').addEventListener('click', () => {
    settingsOverlay.classList.remove('overlay--visible');
  });

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.remove('overlay--visible');
  });

  settTheme.addEventListener('change', () => applyTheme(settTheme.value));
  settFontSize.addEventListener('input', () => {
    const size = parseInt(settFontSize.value);
    settFontSizeVal.textContent = size + 'px';
    saveSetting('chatFontSize', size);
    applyChatFontSize(size);
  });
  settSound.addEventListener('change', () => saveSetting('soundEnabled', settSound.checked));
  settDevMode.addEventListener('change', () => { saveSetting('devMode', settDevMode.checked); applyDevMode(settDevMode.checked); });
  settAutoApprove.addEventListener('change', () => saveSetting('autoApproveTools', settAutoApprove.checked));
  settAllowAllPaths.addEventListener('change', () => saveSetting('allowAllPaths', settAllowAllPaths.checked));

  renderAllowedTools();
  renderDeniedTools();
  renderExtraDirs();
  loadShellExceptions();
  initTagInput('btnAddTool', 'settToolInput', addAllowedTool);
  initTagInput('btnAddDeniedTool', 'settDeniedToolInput', addDeniedTool);
  initTagInput('btnAddDir', 'settDirInput', addExtraDir);
  initTagInput('btnAddShellEx', 'settShellExInput', addShellException);

  // Folder settings
  async function loadFolderSettings() {
    const folders = await copilot.folders.read();
    document.getElementById('settFolderCwd').value = folders.cwd || '';
    document.getElementById('settFolderCopilotDir').value = folders.copilotDir || '';
    document.getElementById('settFolderSessions').value = folders.sessionsDir || '';
    document.getElementById('settFolderSkills').value = folders.skillsDir || '';
    document.getElementById('settFolderImages').value = folders.imagesDir || '';
  }

  const folderFields = [
    { btn: 'btnBrowseCwd', input: 'settFolderCwd' },
    { btn: 'btnBrowseCopilotDir', input: 'settFolderCopilotDir' },
    { btn: 'btnBrowseSessions', input: 'settFolderSessions' },
    { btn: 'btnBrowseSkills', input: 'settFolderSkills' },
    { btn: 'btnBrowseImages', input: 'settFolderImages' },
  ];
  folderFields.forEach(({ btn, input }) => {
    document.getElementById(btn).addEventListener('click', async () => {
      const folder = await copilot.folders.browse();
      if (folder) document.getElementById(input).value = folder;
    });
  });

  document.getElementById('btnFoldersSave').addEventListener('click', async () => {
    const config = {
      cwd: document.getElementById('settFolderCwd').value || undefined,
      copilotDir: document.getElementById('settFolderCopilotDir').value || undefined,
      sessionsDir: document.getElementById('settFolderSessions').value || undefined,
      skillsDir: document.getElementById('settFolderSkills').value || undefined,
      imagesDir: document.getElementById('settFolderImages').value || undefined,
    };
    Object.keys(config).forEach(k => config[k] === undefined && delete config[k]);
    const result = await copilot.folders.save(config);
    if (result.success) {
      showNotification('Ordner gespeichert — bitte App neu starten', 'success');
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  });

  document.getElementById('btnFoldersReset').addEventListener('click', async () => {
    const result = await copilot.folders.save({});
    if (result.success) {
      await loadFolderSettings();
      showNotification('Ordner auf Standard zurückgesetzt — bitte App neu starten', 'success');
    }
  });

  document.querySelector('.settings__tab[data-tab="folders"]')?.addEventListener('click', loadFolderSettings);
  loadFolderSettings();
}

function initSidebar() {
  const collapseBtn = document.getElementById('btnCollapseSidebar');
  const sidebar = document.getElementById('sidebar');
  if (getPref('sidebarCollapsed', false)) {
    sidebar.classList.add('sidebar--collapsed');
    collapseBtn.textContent = '▶';
    collapseBtn.setAttribute('data-tooltip', 'Sidebar erweitern');
  }
  collapseBtn.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('sidebar--collapsed');
    collapseBtn.textContent = isCollapsed ? '▶' : '◀';
    collapseBtn.setAttribute('data-tooltip', isCollapsed ? 'Sidebar erweitern' : 'Sidebar minimieren');
    setPref('sidebarCollapsed', isCollapsed);
  });
}

function initTestRunner() {
  document.getElementById('btnTests')?.addEventListener('click', openTestRunner);
  document.getElementById('btnCloseTestRunner')?.addEventListener('click', closeTestRunner);
  document.getElementById('btnRunTests')?.addEventListener('click', runTests);
  document.getElementById('btnRunE2E')?.addEventListener('click', runE2E);
  document.getElementById('btnRunCoverage')?.addEventListener('click', runCoverage);
}

function initDevConsole() {
  document.getElementById('btnDevConsole')?.addEventListener('click', toggleDevConsole);
  document.getElementById('devConsoleClose')?.addEventListener('click', () => {
    document.getElementById('devConsolePanel').style.display = 'none';
  });
  document.getElementById('devConsoleClear')?.addEventListener('click', () => {
    devConsoleLogs.length = 0;
    document.getElementById('devConsoleBody').innerHTML = '';
  });

  document.querySelectorAll('.dev-console__filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dev-console__filter').forEach(b => b.classList.remove('dev-console__filter--active'));
      btn.classList.add('dev-console__filter--active');
      devConsoleFilter = btn.dataset.level;
      renderDevConsole();
    });
  });

  if (copilot.devConsole) {
    copilot.devConsole.onLog((entry) => addDevConsoleEntry(entry));
  }

  if (window._rendererLogs) {
    window._rendererLogs.forEach(entry => addDevConsoleEntry(entry));
    console.log = (...args) => {
      _rendererOrigLog(...args);
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      addDevConsoleEntry({ level: 'info', message: '[renderer] ' + msg, timestamp: Date.now() });
    };
    console.warn = (...args) => {
      _rendererOrigWarn(...args);
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      addDevConsoleEntry({ level: 'warn', message: '[renderer] ' + msg, timestamp: Date.now() });
    };
    console.error = (...args) => {
      _rendererOrigError(...args);
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      addDevConsoleEntry({ level: 'error', message: '[renderer] ' + msg, timestamp: Date.now() });
    };
  }
}

function initChatSearch() {
  const searchBar = document.getElementById('chatSearchBar');
  const searchInput = document.getElementById('chatSearchInput');
  const searchCount = document.getElementById('chatSearchCount');
  let searchMarks = [];
  let searchActiveIdx = -1;

  function clearSearchHighlights() {
    searchMarks.forEach(m => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    searchMarks = [];
    searchActiveIdx = -1;
    searchCount.textContent = '';
  }

  function highlightSearch(query) {
    clearSearchHighlights();
    if (!query || !activeTabId) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    const walker = document.createTreeWalker(tab.streamEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const lowerQ = query.toLowerCase();
    for (const node of textNodes) {
      const text = node.textContent;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerQ);
      if (idx === -1) continue;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.className = 'chat-search-highlight';
        mark.textContent = text.substring(idx, idx + query.length);
        frag.appendChild(mark);
        searchMarks.push(mark);
        lastIdx = idx + query.length;
        idx = lower.indexOf(lowerQ, lastIdx);
      }
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    }
    searchCount.textContent = searchMarks.length ? `${searchMarks.length} Treffer` : 'Keine Treffer';
    if (searchMarks.length > 0) jumpToMatch(0);
  }

  function jumpToMatch(idx) {
    if (searchMarks.length === 0) return;
    if (searchActiveIdx >= 0 && searchActiveIdx < searchMarks.length) {
      searchMarks[searchActiveIdx].classList.remove('chat-search-highlight--active');
    }
    searchActiveIdx = ((idx % searchMarks.length) + searchMarks.length) % searchMarks.length;
    const mark = searchMarks[searchActiveIdx];
    mark.classList.add('chat-search-highlight--active');
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    searchCount.textContent = `${searchActiveIdx + 1}/${searchMarks.length}`;
  }

  function openSearch() {
    searchBar.classList.add('chat-search--visible');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchBar.classList.remove('chat-search--visible');
    clearSearchHighlights();
    searchInput.value = '';
  }

  // Store openSearch globally for keyboard shortcut access
  window._openSearch = openSearch;

  searchInput.addEventListener('input', () => highlightSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) jumpToMatch(searchActiveIdx - 1);
      else jumpToMatch(searchActiveIdx + 1);
    }
    if (e.key === 'Escape') closeSearch();
  });
  document.getElementById('chatSearchPrev').addEventListener('click', () => jumpToMatch(searchActiveIdx - 1));
  document.getElementById('chatSearchNext').addEventListener('click', () => jumpToMatch(searchActiveIdx + 1));
  document.getElementById('chatSearchClose').addEventListener('click', () => closeSearch());
}

function initKeyboardShortcuts() {
  const searchBar = document.getElementById('chatSearchBar');

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      createTab('🤖 Copilot');
    }
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (activeTabId != null) closeTab(activeTabId);
    }
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      const tabIds = [...tabs.keys()];
      if (idx < tabIds.length) switchTab(tabIds[idx]);
    }
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      document.getElementById('chatInput')?.focus();
    }
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      exportChat();
    }
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      if (window._openSearch) window._openSearch();
    }
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      document.getElementById('btnCollapseSidebar').click();
    }
    if (e.key === 'Escape') {
      const testPopup = document.getElementById('testRunnerPopup');
      if (testPopup && testPopup.style.display !== 'none') {
        closeTestRunner();
        return;
      }
      const lb = document.getElementById('imageLightbox');
      if (lb.classList.contains('image-lightbox--visible')) {
        lb.classList.remove('image-lightbox--visible');
      } else if (searchBar.classList.contains('chat-search--visible')) {
        if (window._openSearch) {
          document.getElementById('chatSearchBar').classList.remove('chat-search--visible');
          document.getElementById('chatSearchInput').value = '';
        }
      } else if (activeTabId != null) {
        const tab = tabs.get(activeTabId);
        if (tab && tab.isProcessing) {
          try { copilot.chat.stop(activeTabId); } catch (_) {}
        }
      }
    }
  });
}

function initDragDrop() {
  const streamArea = document.getElementById('streamArea');
  const dropOverlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  streamArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dropOverlay) dropOverlay.style.display = 'flex';
  });

  streamArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dropOverlay) dropOverlay.style.display = 'none';
    }
  });

  streamArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  streamArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropOverlay) dropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const chatInput = document.getElementById('chatInput');
    const parts = [];

    for (const file of files) {
      let filePath;
      try { filePath = copilot.files.getPath(file); } catch (err) { console.warn('[files] getPath fehlgeschlagen:', err.message); continue; }
      if (!filePath) continue;

      const result = await copilot.files.processDropped(filePath);
      switch (result.type) {
        case 'path':
          parts.push(`@${result.path}`);
          break;
        case 'text':
          parts.push(`Datei: \`${result.filename}\`\n\`\`\`${result.lang}\n${result.content}\n\`\`\``);
          break;
        case 'image':
          parts.push(`Bild kopiert: @${result.path}`);
          break;
        case 'copied':
          parts.push(`Datei kopiert: @${result.path}`);
          break;
        case 'error':
          parts.push(`⚠️ ${result.message}`);
          break;
      }
    }

    if (parts.length > 0) {
      const prefix = chatInput.value ? '\n' : '';
      chatInput.value += prefix + parts.join('\n');
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
      chatInput.focus();
    }
  });
}

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

document.addEventListener('DOMContentLoaded', async () => {
  await loadPreferences();
  applyTheme(getCurrentTheme());
  initCopilotIPC();
  initTerminalIPC();
  initResize();
  initTerminalResize();

  await initStatusbar();
  await initDataLoad();

  const restored = await restoreOpenTabs();
  if (!restored) {
    await createTab('🤖 Copilot');
  }

  initChatInput();
  initWindowControls();
  initContextPopup();
  initCompactPopup();
  initSlashButtons();
  initSettings();
  initSidebar();
  initTestRunner();
  initDevConsole();
  initChatSearch();
  initKeyboardShortcuts();
  initDragDrop();
  initTooltips();
});

// Capture renderer console for dev console + file logging
const _rendererOrigLog = console.log;
const _rendererOrigWarn = console.warn;
const _rendererOrigError = console.error;
window._rendererLogs = [];

/**
 * Redirect renderer console.log/warn/error to both the original console
 * and the main-process file logger via the copilot bridge.
 * @param {'info'|'warn'|'error'} level
 * @param {Array} args - Console arguments.
 */
function _rendererLog(level, args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  window._rendererLogs.push({ level, message: '[renderer] ' + msg, timestamp: Date.now() });
  try { window.copilot.log.write(level, '[renderer] ' + msg); } catch (_) { /* bridge not ready */ }
}

console.log = (...args) => { _rendererOrigLog(...args); _rendererLog('info', args); };
console.warn = (...args) => { _rendererOrigWarn(...args); _rendererLog('warn', args); };
console.error = (...args) => { _rendererOrigError(...args); _rendererLog('error', args); };

// ── Terminal Panel State ──────────────────────────────────────
// Per-tab terminal state is stored in the tab object:
//   tab.terminal = { instance, fitAddon, bodyEl, alive }

// ── Skills Definition ────────────────────────────────────────
/** @type {Array<{id: string, name: string, icon: string, description: string, source: string, dirName?: string}>} Skill definitions loaded from main process. */
let skills = [];

// ── Agents Definition ────────────────────────────────────────
/** @type {Array<{id: string, name: string, icon: string, description: string, fileSlug?: string}>} Agent definitions loaded from main process. */
let agents = [];

// ── Plugins State ────────────────────────────────────────────
/** @type {Array<{success: boolean, marketplace: string, name: string, plugins: Array, error?: string}>} Marketplace browse results. */
let marketplaces = [];
/** @type {Array<{name: string, version: string, updateAvailable?: boolean}>} Currently installed plugins. */
let installedPlugins = [];

// ── State ────────────────────────────────────────────────────
/** @type {Array<{id: string, name: string, lastUsed: string}>} Named sessions for the sidebar, sorted by last-used. */
let sessions = [];
/** @type {string|null} Session ID of the currently active tab. */
let activeSessionId = null;
/** @type {Set<string>} IDs of currently enabled skills (persisted to preferences). */
let activeSkills = new Set();
/** @type {Set<string>} DirNames of skills disabled in ~/.copilot/settings.json */
let disabledSkills = new Set();
/** @type {Set<string>} IDs of currently enabled agents (persisted to preferences). */
let activeAgents = new Set();
/** @type {string} User home directory path, loaded from main process at startup. */
let userHomeDir = '';
/** @type {string[]} Chat input history for arrow-key recall. */
const inputHistory = [];
/** @type {number} Current position in the input history (-1 = not browsing). */
let historyIndex = -1;
/** @type {string} Saved input text before browsing history. */
let historySavedInput = '';
/** @type {boolean} Rich-Text-Editor mode toggle (global). */
let richTextMode = false;

// Multi-Tab State
/**
 * Map of all open chat tabs. Each entry holds the tab's DOM elements, session
 * state, processing flags, terminal reference, and context metadata.
 * @type {Map<string, {streamEl: HTMLElement, statusEl: HTMLElement, label: string, sessionId: string|null, isProcessing: boolean, lastActivityAt: number|null, terminal?: Object, autopilot: boolean, context: Object}>}
 */
const tabs = new Map();
/** @type {Map<string, {toolName: string, arguments: Object}>} Pending tool calls awaiting completion, keyed by toolCallId. */
const pendingToolCalls = new Map();
/** @type {string|null} Tab ID of the currently visible/active tab. */
let activeTabId = null;
/** @type {Set<string>} Tab IDs waiting for onboarding generation to finish. */
let _pendingOnboardingTabs = new Set();

// ── UI Constants → modules/utils.js ──────────────────────────

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
/** @type {Object<string, *>} In-memory cache of user preferences (file-backed). */
let _prefs = {};

/**
 * Load all user preferences from the main process file store into memory.
 * @returns {Promise<void>}
 */
async function loadPreferences() {
  try {
    _prefs = await copilot.preferences.read() || {};
  } catch (e) {
    console.warn('[prefs] Laden fehlgeschlagen:', e.message);
    _prefs = {};
  }
}

/**
 * Read a single preference value from the in-memory cache.
 * @param {string} key - Preference key.
 * @param {*} defaultValue - Fallback if the key is not set.
 * @returns {*}
 */
function getPref(key, defaultValue) {
  return _prefs[key] !== undefined ? _prefs[key] : defaultValue;
}

/**
 * Write a preference value and persist asynchronously to disk.
 * @param {string} key - Preference key.
 * @param {*} value - Value to store.
 */
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
/**
 * Persist the list of currently open tabs (with session IDs) to preferences
 * so they can be restored on next launch.
 */
function saveOpenTabs() {
  const openTabs = [];
  tabs.forEach((tab, id) => {
    if (tab.sessionId) {
      openTabs.push({ sessionId: tab.sessionId, label: tab.label });
      // Persist denied tools in namedSessions
      saveSessionDeniedTools(tab.sessionId, tab.sessionDeniedTools || []);
    }
  });
  setPref('openTabs', openTabs);
}

/**
 * Restore previously open tabs from preferences. Recreates tabs, loads
 * session state, and spawns background terminals.
 * @returns {Promise<boolean>} True if at least one tab was restored.
 */
async function restoreOpenTabs() {
  const openTabs = getPref('openTabs', []);
  if (!openTabs.length) return false;
  try {
    for (const t of openTabs) {
      // Use namedSessions as primary label source
      const customName = t.sessionId ? getSessionName(t.sessionId) : null;
      const label = customName ? '🤖 ' + customName : (t.label || '🤖 Copilot');
      const tabId = await createTab(label);
      const tab = tabs.get(tabId);
      if (tab) {
        tab.sessionId = t.sessionId;
        // Load denied tools from namedSessions
        tab.sessionDeniedTools = t.sessionId ? getSessionDeniedTools(t.sessionId) : [];
        // Restore persisted model for this session
        if (t.sessionId) {
          const sessionModel = getSessionModel(t.sessionId);
          if (sessionModel) {
            tab.selectedModel = sessionModel;
            updateModelSelectBtn(tabId);
          }
        }
        activeSessionId = t.sessionId;
        loadTodos(t.sessionId);
        // Render pinned tools now that sessionDeniedTools are loaded
        renderPinnedTools();
        // Start background terminal for restored tab
        if (t.sessionId) {
          copilot.terminal.spawnBackground(tabId, t.sessionId).catch(e => {
            console.warn('[terminal] spawnBackground fehlgeschlagen:', e.message);
          });
        }
        // Display session context for restored tabs
        if (t.sessionId) displaySessionContext(tab, t.sessionId);
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

// ── Named Sessions (persistent, CLI-sicher) ──────────────────
/**
 * Retrieve the named-sessions map from preferences.
 * @returns {Object<string, {name: string, deniedTools: Array, lastUsed: string}>}
 */
function getNamedSessions() {
  return getPref('namedSessions', {});
}

/**
 * Get the user-assigned display name for a session.
 * @param {string} sessionId
 * @returns {string|null}
 */
function getSessionName(sessionId) {
  const entry = getNamedSessions()[sessionId];
  return entry?.name || null;
}

function getSessionEntry(sessionId) {
  return getNamedSessions()[sessionId] || null;
}

/**
 * Set or update the display name for a session in the named-sessions map.
 * Creates the entry if it does not yet exist.
 * @param {string} sessionId
 * @param {string} name - Human-readable session name.
 */
function setSessionName(sessionId, name) {
  const all = getNamedSessions();
  if (!all[sessionId]) {
    all[sessionId] = { name, deniedTools: [], lastUsed: new Date().toISOString() };
  } else {
    all[sessionId].name = name;
  }
  setPref('namedSessions', all);
}

function removeSessionName(sessionId) {
  const all = getNamedSessions();
  delete all[sessionId];
  setPref('namedSessions', all);
}

/**
 * Update the lastUsed timestamp of a named session (for sorting).
 * @param {string} sessionId
 */
function touchSession(sessionId) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    all[sessionId].lastUsed = new Date().toISOString();
    setPref('namedSessions', all);
  }
}

/**
 * Get the list of denied tool names for a specific session.
 * @param {string} sessionId
 * @returns {string[]}
 */
function getSessionDeniedTools(sessionId) {
  const entry = getNamedSessions()[sessionId];
  return entry?.deniedTools || [];
}

/**
 * Persist the denied-tools list for a specific session.
 * @param {string} sessionId
 * @param {string[]} tools - Tool names to deny.
 */
function saveSessionDeniedTools(sessionId, tools) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    all[sessionId].deniedTools = tools;
    setPref('namedSessions', all);
  }
}

/**
 * Get the persisted model for a specific session.
 * Uses a dedicated 'sessionModels' preference map so model selection is
 * preserved for all sessions, not just explicitly named ones.
 * @param {string} sessionId
 * @returns {string|null}
 */
function getSessionModel(sessionId) {
  const models = getPref('sessionModels', {});
  return models[sessionId] || null;
}

/**
 * Persist the selected model for a specific session.
 * Stores in a dedicated 'sessionModels' pref (separate from namedSessions)
 * so the model is saved for all sessions — including unnamed ones.
 * @param {string} sessionId
 * @param {string} modelId
 */
function saveSessionModel(sessionId, modelId) {
  const models = getPref('sessionModels', {});
  models[sessionId] = modelId;
  setPref('sessionModels', models);
}

function getDeniedTools() {
  return getSettings().deniedTools || [];
}

function getAdminDeniedTools() {
  return getSettings().adminDeniedTools || [];
}

function getExtraDirs() {
  return getSettings().extraDirs || [];
}

/**
 * Merge user-configured extra directories with auto-derived paths from
 * folder settings (skills dir, agents dir, instructions file directory).
 * @returns {string[]} Deduplicated array of directory paths.
 */
let _cachedFolders = null;
function getEffectiveExtraDirs() {
  const userDirs = getExtraDirs();
  if (!_cachedFolders) return userDirs;
  const autoDirs = [];
  if (_cachedFolders.skillsDir) autoDirs.push(_cachedFolders.skillsDir);
  if (_cachedFolders.agentsDir) autoDirs.push(_cachedFolders.agentsDir);
  if (_cachedFolders.instructionsFile) {
    const dir = _cachedFolders.instructionsFile.replace(/[\\/][^\\/]+$/, '');
    if (dir) autoDirs.push(dir);
  }
  return [...new Set([...userDirs, ...autoDirs])];
}

/**
 * Add a tool to the global denied-tools list (wraps in shell() if needed).
 * @param {string} toolName - Tool or shell command name to deny.
 */
function addDeniedTool(toolName) {
  const wrapped = toolName.startsWith('shell(') ? toolName : `shell(${toolName})`;
  const tools = getDeniedTools();
  if (!tools.includes(wrapped)) {
    tools.push(wrapped);
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

function addAdminDeniedTool(toolName) {
  const wrapped = toolName.startsWith('shell(') ? toolName : `shell(${toolName})`;
  const tools = getAdminDeniedTools();
  if (!tools.includes(wrapped)) {
    tools.push(wrapped);
    saveSetting('adminDeniedTools', tools);
  }
  renderAdminDeniedTools();
}

function removeAdminDeniedTool(idx) {
  const tools = getAdminDeniedTools();
  tools.splice(idx, 1);
  saveSetting('adminDeniedTools', tools);
  renderAdminDeniedTools();
}

function renderAdminDeniedTools() { renderTagList('settAdminDeniedToolsList', getAdminDeniedTools(), 'removeAdminDeniedTool'); }

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


function applyChatFontSize(size) {
  document.querySelectorAll('.stream-output').forEach(el => {
    el.style.fontSize = size + 'px';
  });
}

// ── Developer Mode ──────────────────────────────────────────
/**
 * Show or hide developer-mode UI elements (test runner, dev console,
 * admin tools section).
 * @param {boolean} enabled
 */
function applyDevMode(enabled) {
  const btnTests = document.getElementById('btnTests');
  const btnDevConsole = document.getElementById('btnDevConsole');
  const adminToolsGroup = document.getElementById('settAdminToolsGroup');
  if (btnTests) btnTests.style.display = enabled ? '' : 'none';
  if (btnDevConsole) btnDevConsole.style.display = enabled ? '' : 'none';
  if (adminToolsGroup) adminToolsGroup.style.display = enabled ? '' : 'none';
  // Hide console panel when devMode is disabled
  if (!enabled) {
    const panel = document.getElementById('devConsolePanel');
    if (panel) panel.style.display = 'none';
  }
  const onboardingResetGroup = document.getElementById('settOnboardingResetGroup');
  const onboardingResetSeparator = document.getElementById('settOnboardingResetSeparator');
  if (onboardingResetGroup) onboardingResetGroup.style.display = enabled ? '' : 'none';
  if (onboardingResetSeparator) onboardingResetSeparator.style.display = enabled ? '' : 'none';
}

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

// ── Context Color Helper ─────────────────────────────────────
/**
 * Return a CSS color string for a context-usage percentage (red/orange/green).
 * @param {number} percent - Context usage 0–100.
 * @returns {string} CSS color hex code.
 */
function contextColor(percent) {
  return percent > 80 ? '#f38ba8' : percent > 60 ? '#fab387' : '#a6e3a1';
}

// ── Context Category HTML Builder ────────────────────────────
/**
 * Build an HTML snippet showing token-usage bars for each context category.
 * @param {Array<{name: string, tokens: number, percent: number}>} categories
 * @returns {string} HTML string (must be sanitized before insertion).
 */
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
function stripShellWrapper(name) {
  const m = name.match(/^shell\((.+)\)$/);
  return m ? m[1] : name;
}

/**
 * Render a list of removable tag elements into a container.
 * @param {string} containerId - DOM id of the container element.
 * @param {string[]} items - Tag label strings.
 * @param {string} removeFnName - Global function name called on remove click.
 */
function renderTagList(containerId, items, removeFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.map((item, i) =>
    `<span class="settings__tool-tag">${escapeHtml(stripShellWrapper(item))} <span class="settings__tool-tag__remove" onclick="${removeFnName}(${i})">&times;</span></span>`
  ).join('');
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
  document.body.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DISPLAY_MS);
}

// ── Tab Management ──────────────────────────────────────────
/**
 * Create a new chat tab, register it in the tabs map, and switch to it.
 * Also allocates a stream-output element and a status-line element.
 * @param {string} [label='🤖 Copilot'] - Display label for the tab.
 * @returns {Promise<string>} The new tab's unique ID.
 */
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
    lastActivityAt: null,
    _inactivityTimer: null,
    _unlockBtnTimer: null,
    _unlockBtnEl: null,
    allowedTools: new Set(),
    sessionDeniedTools: [],  // per-session denied tools [{name, enabled}]
    autopilot: false,
    selectedModel: DEFAULT_MODEL_ID,
    context: { model: null, mcp: null, skills: null, instructions: null, cwd: null, files: new Set() },
    inputText: '',
    inputRichHtml: '',
    inputRichMode: false,
  });

  switchTab(tabId);
  renderTabs();
  updateStatus(`⚡ ${tabLabel}`, 'var(--green)');
  return tabId;
}

/**
 * Activate a tab: show its stream output, terminal panel, load its
 * session todos, and update the context/statusbar display.
 * @param {string} tabId - ID of the tab to activate.
 */
function switchTab(tabId) {
  // Save current input state to the active tab before switching
  if (activeTabId) {
    const prevTab = tabs.get(activeTabId);
    if (prevTab) {
      const chatInput = document.getElementById('chatInput');
      const chatInputRich = document.getElementById('chatInputRich');
      prevTab.inputText = chatInput?.value || '';
      prevTab.inputRichHtml = chatInputRich?.innerHTML || '';
      prevTab.inputRichMode = richTextMode;
    }
  }

  // Close model dropdown if open
  document.querySelector('.model-dropdown--below')?.remove();

  // If plugins view is active, switch back to chat view
  switchToChatView();

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
    ctxBtn.textContent = '📊 Context';
  }

  // Refresh session tools list for this tab
  renderSessionTools();

  // Update autopilot button for this tab
  const autopilotBtn = document.getElementById('btnAutopilot');
  autopilotBtn.classList.toggle('session-actions__btn--active', !!activeTab?.autopilot);

  // Update model select button for this tab
  updateModelSelectBtn();

  // Restore input state for the newly activated tab
  const chatInput = document.getElementById('chatInput');
  const chatInputRich = document.getElementById('chatInputRich');
  const btnToggle = document.getElementById('btnToggleRichText');
  const toolbar = document.querySelector('.rich-text-toolbar');
  const btnSend = document.getElementById('btnSend');

  if (activeTab) {
    chatInput.value = activeTab.inputText || '';
    chatInputRich.innerHTML = activeTab.inputRichHtml || '';

    richTextMode = activeTab.inputRichMode || false;
    btnToggle?.classList.toggle('active', richTextMode);
    if (btnToggle) btnToggle.textContent = richTextMode ? '📝' : '✏️';
    toolbar?.classList.toggle('visible', richTextMode);

    if (richTextMode) {
      chatInput.style.display = 'none';
      chatInputRich.style.display = '';
      btnSend?.setAttribute('data-tooltip', 'Senden (Strg+Enter)');
    } else {
      chatInput.style.display = '';
      chatInputRich.style.display = 'none';
      btnSend?.setAttribute('data-tooltip', 'Senden (Enter)');
    }

    chatInput.style.height = 'auto';
    if (chatInput.value) {
      chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
    }
  }

  if (richTextMode) {
    chatInputRich?.focus();
  } else {
    chatInput?.focus();
  }
}

/**
 * Close a tab: stop its chat process, dispose its terminal, remove DOM
 * elements, and switch to the next available tab (or create a new one).
 * @param {string} tabId - ID of the tab to close.
 */
function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  stopInactivityMonitor(tabId);
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

/**
 * Re-render the tab bar DOM from the current tabs map.
 * Each tab gets a label, optional status badge, edit/close buttons,
 * and click/double-click handlers.
 */
function renderTabs() {
  const bar = document.getElementById('tabBar');
  const addBtn = document.getElementById('btnAddTab');

  bar.querySelectorAll('.tab:not(.tab--fixed)').forEach(el => el.remove());

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

/**
 * Replace the tab label with an inline input field for renaming.
 * On commit, updates the tab label, persists the session name, and
 * optionally creates a new CLI session if none exists yet.
 * @param {string} tabId - Tab to rename.
 * @param {HTMLElement} tabEl - The tab's DOM element.
 * @param {HTMLElement} labelSpan - The span containing the label text.
 */
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
        // Existing session — save name in preferences (CLI-safe)
        setSessionName(tab.sessionId, newName);
      } else {
        // No session yet — create one
        try {
          const newId = await copilot.sessions.create(newName);
          if (newId) {
            tab.sessionId = newId;
            activeSessionId = newId;
            setSessionName(newId, newName);
            saveOpenTabs();
          }
        } catch (e) {
          console.warn('[sessions] Erstellen fehlgeschlagen:', e.message);
          showNotification('Session konnte nicht erstellt werden', 'error');
        }
      }
      loadSessions(); // refresh sidebar
      document.dispatchEvent(new CustomEvent('tab:renamed'));
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
/**
 * Update the visual status badge of a tab and trigger tutorial popups
 * when all pending onboarding tabs reach 'done'.
 * @param {string} tabId
 * @param {'idle'|'working'|'question'|'done'|'error'} status
 */
function setTabStatus(tabId, status) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.tabStatus = status;
  renderTabs();

  if (status === 'done' && _pendingOnboardingTabs.has(tabId)) {
    _pendingOnboardingTabs.delete(tabId);
    if (_pendingOnboardingTabs.size === 0) {
      setTimeout(() => showTutorialPopup(), 1500);
    }
  }
}

// ── Inactivity Timeout & Force Unlock ────────────────────────
const INACTIVITY_TIMEOUT_MS = 180_000;
const INACTIVITY_CHECK_INTERVAL_MS = 10_000;
const UNLOCK_BTN_DELAY_MS = 30_000;

/**
 * Start monitoring a tab for inactivity while it is processing.
 * Shows an unlock button after UNLOCK_BTN_DELAY_MS and auto-unlocks
 * the tab after INACTIVITY_TIMEOUT_MS of no activity.
 * @param {string} tabId
 */
function startInactivityMonitor(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.lastActivityAt = Date.now();
  stopInactivityMonitor(tabId);

  tab._inactivityTimer = setInterval(() => {
    if (!tab.isProcessing) { stopInactivityMonitor(tabId); return; }
    const elapsed = Date.now() - (tab.lastActivityAt || 0);
    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      forceUnlockTab(tabId, true);
    } else if (elapsed >= UNLOCK_BTN_DELAY_MS && !tab._unlockBtnEl) {
      showUnlockButton(tabId);
    } else if (elapsed < UNLOCK_BTN_DELAY_MS && tab._unlockBtnEl) {
      hideUnlockButton(tabId);
    }
  }, INACTIVITY_CHECK_INTERVAL_MS);

  tab._unlockBtnTimer = setTimeout(() => {
    if (tab.isProcessing && !tab._unlockBtnEl) {
      const elapsed = Date.now() - (tab.lastActivityAt || 0);
      if (elapsed >= UNLOCK_BTN_DELAY_MS) showUnlockButton(tabId);
    }
  }, UNLOCK_BTN_DELAY_MS);
}

/**
 * Stop the inactivity monitor and hide the unlock button for a tab.
 * @param {string} tabId
 */
function stopInactivityMonitor(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (tab._inactivityTimer) { clearInterval(tab._inactivityTimer); tab._inactivityTimer = null; }
  if (tab._unlockBtnTimer) { clearTimeout(tab._unlockBtnTimer); tab._unlockBtnTimer = null; }
  hideUnlockButton(tabId);
}

/**
 * Force-unlock a stuck/inactive tab by stopping the chat process and
 * resetting all processing state. Shows an info banner in the stream.
 * @param {string} tabId
 * @param {boolean} isAutomatic - True if triggered by the inactivity timer.
 */
function forceUnlockTab(tabId, isAutomatic) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.isProcessing) return;

  try { copilot.chat.stop(tabId); } catch (_) {}
  tab.isProcessing = false;
  tab._responseEl = null;
  tab._thinkingEl = null;
  tab._thinkingDetails = null;
  if (tab._mdTimer) { clearTimeout(tab._mdTimer); tab._mdTimer = null; }
  tab.statusEl.style.display = 'none';
  setTabStatus(tabId, 'done');
  stopInactivityMonitor(tabId);

  const infoEl = document.createElement('div');
  infoEl.className = 'stream-unlock-info';
  infoEl.textContent = isAutomatic
    ? '⏱ Keine Aktivität — Tab automatisch entsperrt'
    : '⏱ Tab manuell entsperrt';
  tab.streamEl.insertBefore(infoEl, tab.statusEl);
  scrollToBottom(tab.streamEl);
}

function showUnlockButton(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || tab._unlockBtnEl) return;

  const btn = document.createElement('button');
  btn.className = 'stream-unlock-btn';
  btn.textContent = '⏱ Hängt? Entsperren';
  btn.addEventListener('click', () => forceUnlockTab(tabId, false));
  tab.streamEl.insertBefore(btn, tab.statusEl);
  tab._unlockBtnEl = btn;
  scrollToBottom(tab.streamEl);
}

function hideUnlockButton(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab._unlockBtnEl) return;
  tab._unlockBtnEl.remove();
  tab._unlockBtnEl = null;
}

// ── Send Message ─────────────────────────────────────────────
/**
 * Convert HTML from the rich-text contenteditable to Markdown.
 * @param {string} html - The innerHTML from the contenteditable element.
 * @returns {string} Markdown-formatted text.
 */
function convertHtmlToMarkdown(html) {
  // Process ordered lists
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let idx = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, content) => {
      idx++;
      return idx + '. ' + content.replace(/<[^>]+>/g, '').trim() + '\n';
    });
  });
  // Process unordered lists
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, content) => {
      return '- ' + content.replace(/<[^>]+>/g, '').trim() + '\n';
    });
  });
  // Bold
  html = html.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  // Italic
  html = html.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  // Strikethrough
  html = html.replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');
  // Line breaks
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/p>/gi, '\n');
  html = html.replace(/<\/div>/gi, '\n');
  // Remove remaining HTML tags
  html = html.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  html = textarea.value;
  // Collapse multiple blank lines
  html = html.replace(/\n{3,}/g, '\n\n');
  return html;
}

/**
 * Send the current chat input to the Copilot CLI backend.
 * Handles slash-command detection, input history, skill/agent prefix
 * injection, denied-tools merging, and UI state updates.
 */
function sendMessage() {
  const input = document.getElementById('chatInput');
  const richInput = document.getElementById('chatInputRich');
  let text;

  if (richTextMode) {
    const html = richInput.innerHTML.trim();
    if (!html || html === '<br>') return;
    text = convertHtmlToMarkdown(html).trim();
    if (!text) return;
  } else {
    text = input.value.trim();
    if (!text) return;
  }

  if (activeTabId == null) return;

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
    if (richTextMode) {
      richInput.innerHTML = '';
    } else {
      input.value = '';
      input.style.height = 'auto';
    }
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
      const skillNames = [...activeSkills].map(id => {
        const s = skills.find(sk => sk.id === id);
        return s ? `- ${s.name}` : null;
      }).filter(Boolean);
      skillPrefix = `Verwende folgende Skills für diese Aufgabe:\n${skillNames.join('\n')}\n\n`;
    }
  }

  // Build agent instructions prefix for active agents
  let agentPrefix = '';
  const activeAgentInfos = [];
  if (activeAgents.size > 0) {
    for (const id of activeAgents) {
      const a = agents.find(ag => ag.id === id);
      if (a) {
        activeAgentInfos.push({ name: a.name, icon: a.icon || '🤖' });
      }
    }
    if (activeAgentInfos.length > 0) {
      const agentNames = [...activeAgents].map(id => {
        const a = agents.find(ag => ag.id === id);
        return a ? `/agent ${a.name}` : null;
      }).filter(Boolean);
      agentPrefix = `${agentNames.join('\n')}\n\n`;
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

  // Show agent indicator tags below user message
  if (activeAgentInfos.length > 0) {
    const agentBar = document.createElement('div');
    agentBar.className = 'stream-input__skills';
    agentBar.innerHTML = activeAgentInfos.map(ai =>
      `<span class="stream-input__skill-tag">${ai.icon} ${escapeHtml(ai.name)}</span>`
    ).join('');
    tab.streamEl.insertBefore(agentBar, tab.statusEl);
  }

  // Show thinking indicator
  tab.statusEl.textContent = '● Thinking…';
  tab.statusEl.style.display = 'block';
  tab.isProcessing = true;
  setTabStatus(activeTabId, 'working');
  startInactivityMonitor(activeTabId);

  // Send to Copilot via JSON API
  const settings = getSettings();
  const sessionDenied = (tab.sessionDeniedTools || []).filter(t => t.enabled).map(t => t.name);
  const mergedDenied = [...new Set([...getAdminDeniedTools(), ...getDeniedTools(), ...sessionDenied])];

  copilot.chat.send(activeTabId, agentPrefix + skillPrefix + text, {
    sessionId: tab.sessionId || undefined,
    autoApprove: true,
    allowedTools: [],
    deniedTools: mergedDenied,
    allowAllPaths: settings.allowAllPaths === true,
    addDirs: getEffectiveExtraDirs(),
    autopilot: tab.autopilot || undefined,
    model: tab.selectedModel || DEFAULT_MODEL_ID,
  });

  // Update lastUsed for sorting
  if (tab.sessionId) touchSession(tab.sessionId);

  // Clear input
  if (richTextMode) {
    richInput.innerHTML = '';
  } else {
    input.value = '';
    input.style.height = 'auto';
  }

  // Clear tab input state
  tab.inputText = '';
  tab.inputRichHtml = '';

  scrollToBottom(tab.streamEl);
}

// ── Copilot Event Processing (JSONL) ─────────────────────────
/**
 * Register IPC event handlers for all Copilot CLI JSONL events.
 * Handles reasoning deltas, streaming message text, tool execution,
 * session setup events, errors, and process completion.
 */
function initCopilotIPC() {
  copilot.chat.onEvent((tabId, event) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    switch (event.type) {
      // ── Reasoning / Thinking ──────────────────────────────
      case 'assistant.reasoning_delta': {
        tab.lastActivityAt = Date.now();
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
        tab.lastActivityAt = Date.now();
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
        tab.lastActivityAt = Date.now();
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
        tab.lastActivityAt = Date.now();
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
        tab.lastActivityAt = Date.now();
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
          updateModelSelectBtn(tabId);
        }
        break;
      }

      case 'user.message': {
        // Extract from transformedContent
        const tc = event.data.transformedContent || '';
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
          // Persist selected model for this new session
          if (tab.selectedModel) saveSessionModel(event.sessionId, tab.selectedModel);
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

    stopInactivityMonitor(tabId);
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
window.confirmDeleteSkill = confirmDeleteSkill;
window.confirmDeleteAgent = confirmDeleteAgent;

// ── Model Switcher ────────────────────────────────────────────
// NOTE: `/model` without argument opens an interactive TUI picker that crashes
// the background terminal. We use a preferences-stored model list instead.
const DEFAULT_MODEL_ID = 'claude-sonnet-4.6';
const DEFAULT_MODELS = [
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', short: 'Opus 4.6' },
  { id: 'claude-opus-4.7', label: 'Claude Opus 4.7', short: 'Opus 4.7' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', short: 'GPT-5.3' },
  { id: 'gpt-4.1', label: 'GPT-4.1', short: 'GPT-4.1' },
];

function getAvailableModels() {
  return DEFAULT_MODELS;
}

/**
 * Update the tab-header model select button to reflect the active tab's
 * selected model state. Called on tab switch and after model selection.
 */
function updateModelSelectBtn(tabId) {
  const btn = document.getElementById('btnModelSelect');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  // Explicit selection takes priority, fallback to actual model from session,
  // then DEFAULT_MODEL_ID — so modelId is always a non-empty string.
  const modelId = tab?.selectedModel || tab?.context?.model || DEFAULT_MODEL_ID;
  const found = DEFAULT_MODELS.find(m => m.id === modelId);
  btn.textContent = `🧠 ${found ? found.short : modelId}`;
  btn.classList.remove('session-actions__btn--active');
}

/**
 * Initialize the tab-specific model selector button in the session-actions bar.
 * Clicking the button opens a dropdown that sets tab.selectedModel, which is
 * then passed as --model to the Copilot process on the next sendMessage() call.
 */
function initTabModelSelector() {
  const btn = document.getElementById('btnModelSelect');
  if (!btn) return;

  let activeCloseHandler = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.model-dropdown--below');
    if (existing) {
      existing.remove();
      if (activeCloseHandler) {
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
      return;
    }

    const models = getAvailableModels();
    const openedForTabId = activeTabId;
    const tab = tabs.get(openedForTabId);
    const currentModel = tab?.selectedModel || '';

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below';

    models.forEach(m => {
      const isActive = currentModel === m.id;
      const item = document.createElement('div');
      item.className = 'model-dropdown__item' + (isActive ? ' model-dropdown__item--active' : '');
      item.innerHTML = `<span class="model-dropdown__label">${escapeHtml(m.label)}</span><span class="model-dropdown__id">${escapeHtml(m.id)}</span>`;
      item.addEventListener('click', () => {
        dropdown.remove();
        if (activeCloseHandler) {
          document.removeEventListener('click', activeCloseHandler, true);
          activeCloseHandler = null;
        }
        const t = tabs.get(openedForTabId);
        if (!t) return;
        t.selectedModel = m.id;
        if (t.sessionId) saveSessionModel(t.sessionId, m.id);
        updateModelSelectBtn(openedForTabId);
      });
      dropdown.appendChild(item);
    });

    btn.closest('.model-select-wrapper').appendChild(dropdown);

    activeCloseHandler = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== btn) {
        dropdown.remove();
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
    };
    setTimeout(() => document.addEventListener('click', activeCloseHandler, true), 0);
  });
}

// ── Session Export ──────────────────────────────────────────
function openCwd() {
  copilot.chat.openCwd();
}

/**
 * Export the active tab's chat history as a Markdown file download.
 * Includes user messages, assistant responses, and tool call summaries.
 */
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

// ── Todos → modules/todos.js ─────────────────────────────────

// ── Image Gallery → modules/images.js ────────────────────────

// ── Sessions ─────────────────────────────────────────────────

/**
 * Load all named sessions from preferences and re-render the sidebar list.
 * Sessions are sorted by lastUsed timestamp (most recent first).
 * @returns {Promise<void>}
 */
async function loadSessions() {
  const all = getNamedSessions();
  sessions = Object.entries(all)
    .map(([id, entry]) => ({ id, name: entry.name, lastUsed: entry.lastUsed || '' }))
    .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  document.getElementById('sessionCount').textContent = sessions.length;
  renderSessions(filterSessions());
}

/**
 * Render the session list in the sidebar. Shows session cards with
 * resume/delete actions and supports direct resume by session ID.
 * @param {Array<{id: string, name: string, lastUsed: string}>} list - Filtered session list.
 */
function renderSessions(list) {
  const container = document.getElementById('sessionList');
  const query = document.getElementById('sessionSearch').value.trim();

  if (list.length === 0) {
    // If query looks like a session ID, offer to resume it directly
    if (query && isSessionIdLike(query)) {
      container.innerHTML = `
        <div class="session-card session-card--id-resume">
          <div class="session-card__row">
            <div class="session-card__main" onclick="resumeSessionById('${escapeAttr(query)}')">
              <div class="session-card__title" style="font-size:11px;color:var(--text-muted);">⏎ Session per ID öffnen:</div>
              <div class="session-card__id" style="font-size:10px;font-family:monospace;color:var(--accent);word-break:break-all;">${escapeHtml(query)}</div>
            </div>
          </div>
        </div>`;
    } else {
      container.innerHTML = '<p style="padding:10px;color:var(--text-muted);font-size:12px;">Keine Sessions gefunden</p>';
    }
    return;
  }

  const openSessionIds = new Set([...tabs.values()].map(t => t.sessionId).filter(Boolean));
  let html = list.map(s => {
    const isLive = openSessionIds.has(s.id);
    const title = s.name;

    return `
      <div class="session-card ${isLive ? 'session-card--live' : ''}" >
        <div class="session-card__row">
          <div class="session-card__main" onclick="resumeSession('${escapeAttr(s.id)}')">
            <div class="session-card__title">${escapeHtml(title)}</div>
          </div>
          <button class="session-card__delete" onclick="event.stopPropagation();confirmDeleteSession('${escapeAttr(s.id)}','${escapeAttr(title)}')" data-tooltip="Session löschen">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  // If query looks like an ID and isn't already in the list, also offer direct resume
  if (query && isSessionIdLike(query) && !list.find(s => s.id === query)) {
    html += `
      <div class="session-card session-card--id-resume" style="border-top:1px dashed var(--border);margin-top:4px;padding-top:4px;">
        <div class="session-card__row">
          <div class="session-card__main" onclick="resumeSessionById('${escapeAttr(query)}')">
            <div class="session-card__title" style="font-size:11px;color:var(--text-muted);">⏎ Andere Session per ID öffnen:</div>
            <div class="session-card__id" style="font-size:10px;font-family:monospace;color:var(--accent);word-break:break-all;">${escapeHtml(query)}</div>
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

/**
 * Resume (or switch to) a named session. If a tab for this session is
 * already open, switches to it. Otherwise creates a new tab, restores
 * session state, spawns the background terminal, and displays context.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function resumeSession(sessionId) {
  // Check if tab with this session is already open → just switch to it
  for (const [tabId, tab] of tabs) {
    if (tab.sessionId === sessionId) {
      switchTab(tabId);
      renderTabs();
      return;
    }
  }

  // Name kommt aus namedSessions (einzige Quelle)
  const customName = getSessionName(sessionId);
  const label = '🤖 ' + (customName || sessionId.substring(0, 8));

  const tabId = await createTab(label);
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Restore session denied tools from namedSessions
  tab.sessionDeniedTools = getSessionDeniedTools(sessionId);

  // Restore persisted model for this session
  const sessionModel = getSessionModel(sessionId);
  if (sessionModel) {
    tab.selectedModel = sessionModel;
    updateModelSelectBtn(tabId);
  }

  // Immediately set sessionId so the next prompt resumes this session
  tab.sessionId = sessionId;
  // Update lastUsed timestamp
  touchSession(sessionId);
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
  await displaySessionContext(tab, sessionId);
}

/**
 * Resume a session by raw ID (e.g. pasted from CLI output). Creates a
 * placeholder named-session entry and delegates to resumeSession().
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function resumeSessionById(sessionId) {
  // Resume a session by raw ID — add to namedSessions with short ID as placeholder name
  const placeholderName = sessionId.substring(0, 12);
  setSessionName(sessionId, placeholderName);
  await loadSessions();
  await resumeSession(sessionId);
  // Clear search field
  document.getElementById('sessionSearch').value = '';
  renderSessions(filterSessions());
}

/**
 * Display session context (recent messages) as history bubbles in the
 * tab's stream output. Called when resuming or restoring a session.
 * @param {Object} tab - Tab object from the tabs map.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function displaySessionContext(tab, sessionId) {
  if (!sessionId) return;

  const title = getSessionName(sessionId) || sessionId.substring(0, 8);

  // Helper: insert a bubble element before the status element
  function insertBefore(el) {
    tab.streamEl.insertBefore(el, tab.statusEl);
  }

  // Header block (nur Titel)
  const headerEl = document.createElement('div');
  headerEl.className = 'stream-session-context';
  headerEl.innerHTML = `<div class="stream-session-context__header">📋 Session: ${escapeHtml(title)}</div>`;
  insertBefore(headerEl);

  // 2. Letzte Nachrichten als echte Chat-Bubbles
  try {
    const messages = await copilot.sessions.readRecentMessages(sessionId);
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const el = document.createElement('div');
        if (msg.role === 'user') {
          el.className = 'stream-input stream-input--history';
          el.textContent = msg.content;
        } else {
          el.className = 'stream-response markdown-body stream-response--history';
          el.innerHTML = window.markdown ? window.markdown.render(msg.content) : escapeHtml(msg.content);
        }
        insertBefore(el);
      }
    }
  } catch (e) { console.warn('[sessions] Nachrichten nicht verfügbar:', e.message); }

  // Footer
  const footerEl = document.createElement('div');
  footerEl.className = 'stream-session-context';
  footerEl.innerHTML = '<div class="stream-session-context__footer">Session bereit — schreibe eine Nachricht um fortzufahren</div>';
  insertBefore(footerEl);
}

// ── Delete Session ────────────────────────────────────────────
let pendingDeleteId = null;

/**
 * Show a confirmation dialog for session deletion.
 * @param {string} sessionId
 * @param {string} title - Session display name for the confirmation message.
 */
function confirmDeleteSession(sessionId, title) {
  pendingDeleteId = sessionId;
  document.getElementById('deleteMessage').textContent =
    `Möchtest du die Session "${title}" wirklich unwiderruflich löschen?`;
  document.getElementById('deleteOverlay').classList.add('overlay--visible');
}

/**
 * Execute the pending session deletion (confirmed via dialog).
 * Removes the session from both the CLI backend and named-sessions prefs.
 * @returns {Promise<void>}
 */
async function executeDeleteSession() {
  if (!pendingDeleteId) return;
  await copilot.sessions.delete(pendingDeleteId);
  removeSessionName(pendingDeleteId);
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
  await loadSessions();
}

function cancelDeleteSession() {
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
}

// ── Skills ───────────────────────────────────────────────────
/**
 * Render the skills list in the sidebar. Each skill card shows an icon,
 * name, active toggle, and an optional delete button for user-created skills.
 */
function renderSkills() {
  const container = document.getElementById('skillList');
  container.innerHTML = skills.map(s => {
    const isActive = activeSkills.has(s.id);
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    const deleteBtn = s.source === 'user' && s.dirName
      ? `<button class="skill-card__delete" onclick="event.stopPropagation(); confirmDeleteSkill('${escapeAttr(s.dirName)}', '${escapeAttr(s.name)}')" data-tooltip="Skill löschen" aria-label="Skill löschen">🗑️</button>`
      : '';
    const cliToggleBtn = s.dirName
      ? `<button class="skill-card__cli-toggle ${isCLIDisabled ? 'skill-card__cli-toggle--enable' : 'skill-card__cli-toggle--disable'}"
               onclick="event.stopPropagation(); toggleSkillDisabled('${escapeAttr(s.dirName)}')"
               data-tooltip="${isCLIDisabled ? 'Skill in Copilot CLI aktivieren' : 'Skill in Copilot CLI deaktivieren'}"
               aria-label="${isCLIDisabled ? 'In CLI aktivieren' : 'In CLI deaktivieren'}">
         ${isCLIDisabled ? '✓' : '⊘'}
       </button>`
      : '';
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isCLIDisabled ? 'skill-card--cli-disabled' : ''}"
           onclick="toggleSkill('${escapeAttr(s.id)}')" data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
        ${deleteBtn}
        ${cliToggleBtn}
        <div class="skill-card__toggle"></div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle a skill's active state and persist the change.
 * @param {string} skillId
 */
function toggleSkill(skillId) {
  if (activeSkills.has(skillId)) activeSkills.delete(skillId);
  else activeSkills.add(skillId);
  saveSetting('activeSkills', [...activeSkills]);
  renderSkills();
}

/**
 * Toggle a skill's CLI-disabled state and persist to ~/.copilot/settings.json.
 * @param {string} dirName
 */
async function toggleSkillDisabled(dirName) {
  if (disabledSkills.has(dirName)) disabledSkills.delete(dirName);
  else disabledSkills.add(dirName);
  await copilot.skills.setDisabled([...disabledSkills]);
  renderSkills();
}

/**
 * Reload skills from the main process and re-render the sidebar list.
 * Shows a spinning indicator on the reload button during the operation.
 * @returns {Promise<void>}
 */
async function reloadSkills() {
  const btn = document.querySelector('[aria-label="Skills neu laden"]');
  if (btn) btn.classList.add('sidebar__reload-btn--spinning');
  try {
    skills = await copilot.skills.list() || [];
    const savedActiveSkills = getSettings().activeSkills || [];
    activeSkills = new Set(savedActiveSkills);
    const savedDisabledSkills = await copilot.skills.getDisabled() || [];
    disabledSkills = new Set(savedDisabledSkills);
    renderSkills();
  } catch (e) {
    console.warn('[skills] Reload fehlgeschlagen:', e.message);
  } finally {
    if (btn) btn.classList.remove('sidebar__reload-btn--spinning');
  }
}

// ── Agents ───────────────────────────────────────────────────
/**
 * Render the agents list in the sidebar. Each agent card shows an icon,
 * name, active toggle, and an optional delete button.
 */
function renderAgents() {
  const container = document.getElementById('agentList');
  container.innerHTML = agents.map(a => {
    const isActive = activeAgents.has(a.id);
    const deleteBtn = a.fileSlug
      ? `<button class="agent-card__delete" onclick="event.stopPropagation(); confirmDeleteAgent('${escapeAttr(a.fileSlug)}', '${escapeAttr(a.name)}')" data-tooltip="Agent löschen" aria-label="Agent löschen">🗑️</button>`
      : '';
    return `
      <div class="agent-card ${isActive ? 'agent-card--active' : ''}"
           onclick="toggleAgent('${escapeAttr(a.id)}')" data-tooltip="${escapeAttr(a.description)}">
        <span class="agent-card__icon">${a.icon}</span>
        <div class="agent-card__info">
          <div class="agent-card__name">${escapeHtml(a.name)}</div>
        </div>
        ${deleteBtn}
        <div class="agent-card__toggle"></div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle an agent's active state and persist the change.
 * @param {string} agentId
 */
function toggleAgent(agentId) {
  if (activeAgents.has(agentId)) activeAgents.delete(agentId);
  else activeAgents.add(agentId);
  saveSetting('activeAgents', [...activeAgents]);
  renderAgents();
}

/**
 * Reload agents from the main process and re-render the sidebar list.
 * @returns {Promise<void>}
 */
async function reloadAgents() {
  const btn = document.querySelector('[aria-label="Agents neu laden"]');
  if (btn) btn.classList.add('sidebar__reload-btn--spinning');
  try {
    agents = await copilot.agents.list() || [];
    const savedActiveAgents = getSettings().activeAgents || [];
    activeAgents = new Set(savedActiveAgents);
    renderAgents();
  } catch (e) {
    console.warn('[agents] Reload fehlgeschlagen:', e.message);
  } finally {
    if (btn) btn.classList.remove('sidebar__reload-btn--spinning');
  }
}

// ── Skill/Agent Delete Confirmation ──────────────────────────
/**
 * Show an inline confirmation dialog to delete a user-created skill.
 * @param {string} dirName - Skill directory name on disk.
 * @param {string} skillName - Human-readable skill name for display.
 */
function confirmDeleteSkill(dirName, skillName) {
  document.querySelectorAll('.sidebar-confirm').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-confirm';
  overlay.innerHTML = `
    <div class="sidebar-confirm__box">
      <p class="sidebar-confirm__text">Skill <strong>${escapeHtml(skillName)}</strong> löschen?</p>
      <div class="sidebar-confirm__actions">
        <button class="action-btn action-btn--danger" id="confirmDeleteYes">Löschen</button>
        <button class="action-btn" id="confirmDeleteNo">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('confirmDeleteYes').addEventListener('click', async () => {
    overlay.remove();
    const result = await copilot.skills.delete(dirName);
    if (result.success) {
      await reloadSkills();
    } else {
      console.error('[skills] Löschen fehlgeschlagen:', result.error);
    }
  });
  document.getElementById('confirmDeleteNo').addEventListener('click', () => overlay.remove());
}

/**
 * Show an inline confirmation dialog to delete a user-created agent.
 * @param {string} fileSlug - Agent file slug on disk.
 * @param {string} agentName - Human-readable agent name for display.
 */
function confirmDeleteAgent(fileSlug, agentName) {
  document.querySelectorAll('.sidebar-confirm').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-confirm';
  overlay.innerHTML = `
    <div class="sidebar-confirm__box">
      <p class="sidebar-confirm__text">Agent <strong>${escapeHtml(agentName)}</strong> löschen?</p>
      <div class="sidebar-confirm__actions">
        <button class="action-btn action-btn--danger" id="confirmDeleteYes">Löschen</button>
        <button class="action-btn" id="confirmDeleteNo">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('confirmDeleteYes').addEventListener('click', async () => {
    overlay.remove();
    const result = await copilot.agents.delete(fileSlug);
    if (result.success) {
      await reloadAgents();
    } else {
      console.error('[agents] Löschen fehlgeschlagen:', result.error);
    }
  });
  document.getElementById('confirmDeleteNo').addEventListener('click', () => overlay.remove());
}

// ── Plugins ─────────────────────────────────────────────────
/**
 * Load installed plugins and all configured marketplace catalogues.
 * Fetches plugin lists in parallel, updates counts, and re-renders.
 * @returns {Promise<void>}
 */
async function loadPlugins() {
  console.log('[plugins] Lade Plugin-Liste und Marketplaces…');
  try {
    const result = await copilot.plugins.list();
    installedPlugins = (result && result.success) ? result.plugins : [];
    console.log(`[plugins] Installierte Plugins: ${installedPlugins.length}`, installedPlugins.map(p => p.name));
  } catch (e) {
    console.warn('[plugins] Liste laden fehlgeschlagen:', e.message);
    installedPlugins = [];
  }

  let mpList = [];
  try {
    const listResult = await copilot.plugins.listMarketplaces();
    mpList = (listResult && listResult.success) ? listResult.marketplaces : [];
    console.log('[plugins] Marketplaces:', mpList.map(m => m.name));
  } catch (e) {
    console.warn('[plugins] Marketplace-Liste fehlgeschlagen:', e.message);
  }

  const results = await Promise.allSettled(
    mpList.map(mp => copilot.plugins.browseMarketplace(mp.name))
  );

  marketplaces = results.map((r, i) => {
    const mpInfo = mpList[i];
    if (r.status === 'fulfilled' && r.value && r.value.success) {
      console.log(`[plugins] "${mpInfo.name}": ${r.value.plugins.length} Plugins`);
      return {
        success: true,
        marketplace: mpInfo.source || mpInfo.name,
        name: mpInfo.name,
        plugins: r.value.plugins,
      };
    }
    const err = r.status === 'rejected' ? r.reason?.message : (r.value?.error || 'Unbekannter Fehler');
    console.warn(`[plugins] "${mpInfo.name}" fehlgeschlagen:`, err);
    return {
      success: false,
      marketplace: mpInfo.source || mpInfo.name,
      name: mpInfo.name,
      plugins: [],
      error: err,
    };
  });

  const countEl = document.getElementById('pluginCount');
  if (countEl) countEl.textContent = String(installedPlugins.length);

  renderPlugins();
}

/**
 * Determine the installation status of a plugin by name.
 * @param {string} pluginName
 * @returns {'installed'|'update-available'|'not-installed'}
 */
function getPluginStatus(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  if (!installed) return 'not-installed';
  return installed.updateAvailable ? 'update-available' : 'installed';
}

function getInstalledVersion(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  return installed ? installed.version : '';
}

/**
 * Render the full plugins view: installed plugins section followed by
 * marketplace sections with search filtering and sidebar navigation.
 */
function renderPlugins() {
  const container = document.getElementById('pluginList');
  const sidebar = document.getElementById('pluginSidebar');
  if (!container) return;

  const searchEl = document.getElementById('pluginSearch');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

  function matchesQuery(plugin) {
    if (!query) return true;
    return (plugin.name || '').toLowerCase().includes(query) ||
           (plugin.description || '').toLowerCase().includes(query) ||
           (plugin.author || '').toLowerCase().includes(query);
  }

  if (marketplaces.length === 0 && installedPlugins.length === 0) {
    container.innerHTML = `
      <div class="plugin-empty-state">
        <div class="plugin-empty-state__icon">🧩</div>
        <div class="plugin-empty-state__title">Keine Marketplaces konfiguriert</div>
        <div class="plugin-empty-state__desc">Füge einen Marketplace hinzu um Plugins zu entdecken.</div>
        <button class="plugin-btn plugin-btn--install" onclick="document.getElementById('btnAddPlugin').click()">+ Marketplace hinzufügen</button>
      </div>`;
    if (sidebar) sidebar.innerHTML = '';
    return;
  }

  let html = '';
  let sidebarHtml = '';

  const visibleInstalled = installedPlugins.filter(matchesQuery);
  const installedSectionId = 'plugin-section-installed';
  sidebarHtml += `<div class="plugins-sidebar__item ${visibleInstalled.length > 0 ? '' : 'plugins-sidebar__item--empty'}" onclick="document.getElementById('${installedSectionId}').scrollIntoView({behavior:'smooth'})">
    <span class="plugins-sidebar__icon">✓</span>
    <span class="plugins-sidebar__label">Installiert</span>
    <span class="plugins-sidebar__badge">${installedPlugins.length}</span>
  </div>`;

  html += `<section class="plugin-section" id="${installedSectionId}">`;
  html += `<div class="plugin-section__header">`;
  html += `<h3 class="plugin-section__title">Installierte Plugins</h3>`;
  html += `<span class="plugin-section__count">${installedPlugins.length}</span>`;
  html += `</div>`;

  if (visibleInstalled.length > 0) {
    html += `<div class="plugin-grid">`;
    for (const plugin of visibleInstalled) {
      const version = plugin.version || '';
      html += renderPluginTile({ name: plugin.name, version, description: '', author: '' }, 'installed', '');
    }
    html += `</div>`;
  } else if (installedPlugins.length === 0) {
    html += `<div class="plugin-section__empty">Noch keine Plugins installiert.</div>`;
  } else {
    html += `<div class="plugin-section__empty">Keine Ergebnisse für „${escapeHtml(query)}"</div>`;
  }
  html += `</section>`;

  for (let i = 0; i < marketplaces.length; i++) {
    const mp = marketplaces[i];
    const sectionId = `plugin-section-mp-${i}`;
    const mpParts = (mp.marketplace || '').split('/');
    const mpDisplayName = mpParts[mpParts.length - 1] || mp.marketplace;
    const mpSubtitle = mp.marketplace || '';
    const filteredPlugins = (mp.plugins || []).filter(matchesQuery);
    const totalCount = (mp.plugins || []).length;

    sidebarHtml += `<div class="plugins-sidebar__item" onclick="document.getElementById('${sectionId}').scrollIntoView({behavior:'smooth'})">
      <span class="plugins-sidebar__icon">🏪</span>
      <span class="plugins-sidebar__label">${escapeHtml(mpDisplayName)}</span>
      <span class="plugins-sidebar__badge">${totalCount}</span>
    </div>`;

    html += `<section class="plugin-section" id="${sectionId}">`;
    html += `<div class="plugin-section__header">`;
    html += `<div class="plugin-section__header-text">`;
    html += `<h3 class="plugin-section__title">${escapeHtml(mpDisplayName)}</h3>`;
    html += `<span class="plugin-section__subtitle">${escapeHtml(mpSubtitle)}</span>`;
    html += `</div>`;
    html += `<span class="plugin-section__count">${totalCount}</span>`;
    html += `<button class="plugin-section__remove-btn" onclick="removeMarketplace('${escapeAttr(mp.name || mp.marketplace)}')" title="Marketplace entfernen">✕</button>`;
    html += `</div>`;

    if (mp.error) {
      html += `<div class="plugin-section__error">⚠️ ${escapeHtml(mp.error)}</div>`;
    }

    if (filteredPlugins.length > 0) {
      html += `<div class="plugin-grid">`;
      for (const plugin of filteredPlugins) {
        const status = getPluginStatus(plugin.name);
        const target = `${escapeAttr(plugin.name)}@${escapeAttr(mp.name || mp.marketplace)}`;
        html += renderPluginTile(plugin, status, target);
      }
      html += `</div>`;
    } else if (totalCount > 0) {
      html += `<div class="plugin-section__empty">Keine Ergebnisse für „${escapeHtml(query)}"</div>`;
    } else if (!mp.error) {
      html += `<div class="plugin-section__empty">Keine Plugins in diesem Marketplace.</div>`;
    }

    html += `</section>`;
  }

  container.innerHTML = html;
  if (sidebar) sidebar.innerHTML = sidebarHtml;
}

/**
 * Render a single plugin tile card with status badge and action buttons.
 * @param {{name: string, version?: string, description?: string, author?: string}} plugin
 * @param {'installed'|'update-available'|'not-installed'} status
 * @param {string} target - Install target string (name@marketplace).
 * @returns {string} HTML string for the plugin tile.
 */
function renderPluginTile(plugin, status, target) {
  const version = getInstalledVersion(plugin.name) || plugin.version || '';
  const desc = plugin.description || '';
  const author = plugin.author || '';
  const name = plugin.name || '';

  let badgeHtml = '';
  if (status === 'installed') {
    badgeHtml = `<span class="plugin-tile__badge plugin-tile__badge--installed">✓ Installiert</span>`;
  } else if (status === 'update-available') {
    badgeHtml = `<span class="plugin-tile__badge plugin-tile__badge--update">● Update</span>`;
  }

  let actionsHtml = '';
  if (status === 'not-installed') {
    actionsHtml = `<button class="plugin-btn plugin-btn--install" onclick="installPlugin('${escapeAttr(target)}')">Installieren</button>`;
  } else if (status === 'installed') {
    actionsHtml = `<button class="plugin-btn plugin-btn--remove" onclick="uninstallPlugin('${escapeAttr(name)}')">Entfernen</button>`;
  } else if (status === 'update-available') {
    actionsHtml = `<button class="plugin-btn plugin-btn--update-available" onclick="updatePlugin('${escapeAttr(name)}')">Updaten</button>`;
    actionsHtml += `<button class="plugin-btn plugin-btn--remove" onclick="uninstallPlugin('${escapeAttr(name)}')">✕</button>`;
  }

  const meta = [author ? `👤 ${escapeHtml(author)}` : '', version ? `v${escapeHtml(version)}` : ''].filter(Boolean).join(' · ');

  return `<div class="plugin-tile plugin-tile--${status}" data-plugin="${escapeAttr(name)}">
    <div class="plugin-tile__top">
      <span class="plugin-tile__icon">🧩</span>
      <div class="plugin-tile__title-area">
        <span class="plugin-tile__name">${escapeHtml(name)}</span>
        ${badgeHtml}
      </div>
    </div>
    <div class="plugin-tile__desc">${desc ? escapeHtml(desc) : '<span class="plugin-tile__no-desc">Keine Beschreibung</span>'}</div>
    ${meta ? `<div class="plugin-tile__meta">${meta}</div>` : ''}
    <div class="plugin-tile__actions">${actionsHtml}</div>
  </div>`;
}

window.installPlugin = async function(target) {
  const pluginName = target.split('@')[0];
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(pluginName)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await copilot.plugins.install(target);
    if (result && result.success) {
      showNotification('Plugin installiert', 'success');
    } else {
      showNotification(result?.error || 'Installation fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Installation fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
};

window.uninstallPlugin = async function(name) {
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(name)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await copilot.plugins.uninstall(name);
    if (result && result.success) {
      showNotification('Plugin deinstalliert', 'success');
    } else {
      showNotification(result?.error || 'Deinstallation fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Deinstallation fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
};

window.updatePlugin = async function(name) {
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(name)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await copilot.plugins.update(name);
    if (result && result.success) {
      showNotification('Plugin aktualisiert', 'success');
    } else {
      showNotification(result?.error || 'Update fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Update fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
};

/**
 * Show an inline dialog to add a new marketplace URL or install a plugin.
 */
function showAddPluginDialog() {
  const container = document.getElementById('pluginList');
  if (!container) return;

  const existing = container.querySelector('.plugin-add-dialog');
  if (existing) { existing.remove(); return; }

  const dialog = document.createElement('div');
  dialog.className = 'plugin-add-dialog';
  dialog.innerHTML = `
    <div class="plugin-add-dialog__fields">
      <input type="text" class="plugin-add-dialog__input" placeholder="Marketplace-URL oder Plugin-Name…" />
    </div>
    <div class="plugin-add-dialog__buttons">
      <button class="plugin-btn plugin-btn--install" id="pluginDialogAdd">Hinzufügen</button>
      <button class="plugin-btn plugin-btn--remove" id="pluginDialogCancel">Abbrechen</button>
    </div>
  `;
  container.prepend(dialog);

  const input = dialog.querySelector('.plugin-add-dialog__input');
  input.focus();

  dialog.querySelector('#pluginDialogAdd').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return;

    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    const isOwnerRepo = !isUrl && value.includes('/');

    if (isUrl || isOwnerRepo) {
      // Show spinner inside dialog
      const addBtn = dialog.querySelector('#pluginDialogAdd');
      const cancelBtn = dialog.querySelector('#pluginDialogCancel');
      addBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      addBtn.innerHTML = '<span class="plugin-spinner"></span> Wird hinzugefügt…';
      try {
        const result = await copilot.plugins.addMarketplace(value);
        dialog.remove();
        if (result && result.success) {
          showNotification('Marketplace hinzugefügt', 'success');
        } else {
          showNotification(result?.error || 'Marketplace hinzufügen fehlgeschlagen', 'error');
        }
      } catch (e) {
        dialog.remove();
        showNotification('Marketplace hinzufügen fehlgeschlagen: ' + e.message, 'error');
      }
      await loadPlugins();
    } else {
      dialog.remove();
      await installPlugin(value);
    }
  });

  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dialog.querySelector('#pluginDialogAdd').click();
    }
    if (e.key === 'Escape') {
      dialog.remove();
    }
  };
  input.addEventListener('keydown', handleKeydown);

  dialog.querySelector('#pluginDialogCancel').addEventListener('click', () => {
    dialog.remove();
  });
}

function initPluginButtons() {
  const btnAdd = document.getElementById('btnAddPlugin');
  if (btnAdd) btnAdd.addEventListener('click', () => showAddPluginDialog());

  const btnRefresh = document.getElementById('btnRefreshPlugins');
  if (btnRefresh) btnRefresh.addEventListener('click', () => loadPlugins());

  const searchEl = document.getElementById('pluginSearch');
  if (searchEl) searchEl.addEventListener('input', () => renderPlugins());
}

// ── Plugin View Switching ────────────────────────────────────
window.pluginsViewActive = false;

window.removeMarketplace = async function(name) {
  console.log(`[plugins] removeMarketplace: "${name}"`);

  // Show spinner on the clicked remove button
  const btn = document.querySelector(`.plugin-section__remove-btn[onclick*="${CSS.escape(name)}"]`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="plugin-spinner plugin-spinner--sm"></span>';
  }

  try {
    const result = await copilot.plugins.removeMarketplace(name);
    console.log('[plugins] removeMarketplace result:', result);
    if (result && result.success) {
      showNotification('Marketplace entfernt', 'success');
    } else {
      showNotification(result?.error || 'Marketplace entfernen fehlgeschlagen', 'error');
    }
  } catch (e) {
    console.error('[plugins] removeMarketplace error:', e);
    showNotification('Marketplace entfernen fehlgeschlagen: ' + (e?.message || JSON.stringify(e)), 'error');
  }
  loadPlugins().catch(e => console.error('[plugins] loadPlugins nach removeMarketplace:', e));
};

/**
 * Switch the main content area from chat to the plugins marketplace view.
 */
window.switchToPluginsView = function() {
  window.pluginsViewActive = true;
  const pluginsView = document.getElementById('pluginsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const terminalPanel = document.getElementById('terminalPanel');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const sessionStatusbar = document.getElementById('sessionStatusbar');
  const tabPlugins = document.getElementById('tabPlugins');

  // Hide chat content, show plugin view (both inside terminal-container)
  if (sessionActions) sessionActions.style.display = 'none';
  if (streamArea) streamArea.style.display = 'none';
  if (terminalPanel) terminalPanel.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';
  if (sessionStatusbar) sessionStatusbar.style.display = 'none';
  if (pluginsView) pluginsView.style.display = 'flex';

  // Deactivate all chat tabs, activate plugin tab
  document.querySelectorAll('#tabBar .tab:not(.tab--fixed)').forEach(el => {
    el.classList.remove('tab--active');
  });
  if (tabPlugins) tabPlugins.classList.add('tab--active');

  renderPlugins();
};

/**
 * Switch the main content area back from plugins to chat view.
 */
function switchToChatView() {
  if (!window.pluginsViewActive) return;
  window.pluginsViewActive = false;
  const pluginsView = document.getElementById('pluginsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const terminalPanel = document.getElementById('terminalPanel');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const sessionStatusbar = document.getElementById('sessionStatusbar');
  const tabPlugins = document.getElementById('tabPlugins');

  if (pluginsView) pluginsView.style.display = 'none';
  if (sessionActions) sessionActions.style.display = '';
  if (streamArea) streamArea.style.display = '';
  if (chatInputBar) chatInputBar.style.display = '';
  if (sessionStatusbar) sessionStatusbar.style.display = '';
  // terminalPanel nur zeigen wenn es vorher sichtbar war (collapsed state respektieren)
  const terminalCollapsed = terminalPanel && terminalPanel.classList.contains('terminal-panel--collapsed');
  if (terminalPanel && !terminalCollapsed) terminalPanel.style.display = '';

  if (tabPlugins) tabPlugins.classList.remove('tab--active');
}

// ── Sidebar Resize ───────────────────────────────────────────
/**
 * Initialize the sidebar resize handle with drag behavior.
 * Restores previously saved width from preferences.
 */
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
/**
 * Filter the sessions list by the current search input value.
 * Matches against session name and ID (case-insensitive).
 * @returns {Array<{id: string, name: string, lastUsed: string}>}
 */
function filterSessions() {
  const query = document.getElementById('sessionSearch').value.trim();
  const lower = query.toLowerCase();
  if (!lower) return sessions;
  return sessions.filter(s =>
    (s.name || '').toLowerCase().includes(lower) ||
    s.id.toLowerCase().includes(lower)
  );
}

/**
 * Check whether a string looks like a raw session ID (8+ alphanum chars).
 * @param {string} str
 * @returns {boolean}
 */
function isSessionIdLike(str) {
  // Session IDs are typically UUIDs or long hex/alphanum strings (8+ chars)
  return str.length >= 8 && /^[a-z0-9_-]+$/i.test(str);
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
    const collapsed = getPref('sidebarSectionsCollapsed', {});
    collapsed[name] = !isHidden;
    setPref('sidebarSectionsCollapsed', collapsed);
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

// truncatePath, escapeHtml, escapeAttr → modules/utils.js

// ── Test Runner → modules/test-runner.js ─────────────────────

// ── Developer Console → modules/dev-console.js ──────────────

// ── Context Widget (opens terminal with /context) ────────────

// toolIcon, toolDisplayName, formatToolArgs → modules/utils.js

// ── Terminal Panel → modules/terminal.js ─────────────────────

// ── Init ─────────────────────────────────────────────────────

/**
 * Initialize the session statusbar: load home directory, current working
 * directory, and app/CLI version into their respective statusbar segments.
 * @returns {Promise<void>}
 */
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
    const ver = await copilot.chat.getVersions();
    const el = document.getElementById('sbVersion');
    if (el) {
      el.textContent = `🏷️ v${ver.app}`;
      el.setAttribute('data-tooltip', `App: v${ver.app}\nCLI: ${ver.cli}`);
    }
  } catch (e) { console.warn('[app] Version nicht geladen:', e.message); }
}

/**
 * Load all application data on startup: skills, agents, sessions, images,
 * and plugins. Restores persisted active selections from settings.
 * @returns {Promise<void>}
 */
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

  try {
    agents = await copilot.agents.list() || [];
  } catch (e) {
    console.warn('[agents] Laden fehlgeschlagen:', e.message);
    agents = [];
  }
  const savedActiveAgents = getSettings().activeAgents || [];
  activeAgents = new Set(savedActiveAgents);
  renderAgents();

  await loadSessions();
  await loadImages();
  copilot.images.onChanged(() => loadImages());

  loadPlugins().catch(e => console.warn('[plugins] Hintergrundladen fehlgeschlagen:', e.message));
}

/**
 * Initialize the chat input textarea: send on Enter, arrow-key history
 * navigation, auto-resize on input, and the add-tab button.
 */
function initChatInput() {
  const chatInput = document.getElementById('chatInput');
  const chatInputRich = document.getElementById('chatInputRich');
  const btnSend = document.getElementById('btnSend');
  const btnToggle = document.getElementById('btnToggleRichText');
  const toolbar = document.getElementById('richTextToolbar');

  btnSend.addEventListener('click', () => sendMessage());

  // Normal textarea key handling
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

  // Rich-Text contenteditable key handling
  chatInputRich.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
    }
    // Normal Enter and Shift+Enter insert line break (default behavior)
  });

  // Rich-Text toolbar buttons
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.rt-btn');
    if (!btn) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    document.execCommand(cmd, false, null);
    chatInputRich.focus();
  });

  // Toggle Rich-Text mode
  btnToggle.addEventListener('click', () => {
    richTextMode = !richTextMode;
    btnToggle.classList.toggle('active', richTextMode);
    btnToggle.textContent = richTextMode ? '📝' : '✏️';
    toolbar.classList.toggle('visible', richTextMode);

    if (richTextMode) {
      // Sync plain text → rich text (immer, auch bei leerem Inhalt)
      chatInputRich.innerText = chatInput.value;
      chatInput.style.display = 'none';
      chatInputRich.style.display = '';
      chatInputRich.focus();
      btnSend.setAttribute('data-tooltip', 'Senden (Strg+Enter)');
    } else {
      // Sync rich text → plain text / markdown (immer, auch bei leerem Inhalt)
      const markdown = convertHtmlToMarkdown(chatInputRich.innerHTML).trim();
      chatInput.value = markdown;
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT) + 'px';
      chatInputRich.style.display = 'none';
      chatInput.style.display = '';
      chatInput.focus();
      btnSend.setAttribute('data-tooltip', 'Senden (Enter)');
    }
  });

  document.getElementById('sessionSearch').addEventListener('input', () => {
    renderSessions(filterSessions());
  });

  document.getElementById('btnAddTab').addEventListener('click', () => {
    createTab('🤖 Copilot');
  });
}

/**
 * Wire up window control buttons (minimize, maximize, close), terminal
 * toggle, export, scroll-to-bottom, and window resize handling.
 */
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

/**
 * Initialize the context popup (📊 button) that shows token usage
 * and category breakdowns fetched from the background terminal.
 */
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

/**
 * Initialize the compact popup (🗜️ button) that triggers /compact
 * and displays before/after token usage comparison.
 */
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

/**
 * Initialize all session action buttons: /clear, todo sync, todo add,
 * and session delete confirmation handlers.
 */
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
      ctxBtn.textContent = '📊 Context';
      const tab2 = tabs.get(activeTabId);
      if (tab2) tab2.contextPercent = null;
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  });

  document.getElementById('btnAutopilot').addEventListener('click', () => {
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    tab.autopilot = !tab.autopilot;
    document.getElementById('btnAutopilot').classList.toggle('session-actions__btn--active', tab.autopilot);
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

// ── Session Tools Popup → modules/session-tools.js ───────────

/**
 * Initialize the settings overlay: theme, font size, sound, dev mode,
 * denied tools, extra dirs, folder paths, and instructions editor.
 */
function initSettings() {
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settTheme = document.getElementById('settTheme');
  const settFontSize = document.getElementById('settFontSize');
  const settFontSizeVal = document.getElementById('settFontSizeVal');
  const settSound = document.getElementById('settSound');
  const settDevMode = document.getElementById('settDevMode');
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
  settAllowAllPaths.checked = savedSettings.allowAllPaths === true;

  document.getElementById('btnSettings').addEventListener('click', () => {
    settTheme.value = getCurrentTheme();
    settingsOverlay.classList.add('overlay--visible');
    loadDevOnboardingState();
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
  settAllowAllPaths.addEventListener('change', () => saveSetting('allowAllPaths', settAllowAllPaths.checked));

  renderDeniedTools();
  renderExtraDirs();
  renderAdminDeniedTools();
  initTagInput('btnAddDeniedTool', 'settDeniedToolInput', addDeniedTool);
  initTagInput('btnAddAdminDeniedTool', 'settAdminDeniedToolInput', addAdminDeniedTool);
  initTagInput('btnAddDir', 'settDirInput', addExtraDir);

  // Folder settings
  async function loadFolderSettings() {
    const folders = await copilot.folders.read();
    _cachedFolders = folders;
    document.getElementById('settFolderCwd').value = folders.cwd || '';
    document.getElementById('settFolderSessions').value = folders.sessionsDir || '';
    document.getElementById('settFolderSkills').value = folders.skillsDir || '';
    document.getElementById('settFolderAgents').value = folders.agentsDir || '';
    document.getElementById('settFolderImages').value = folders.imagesDir || '';
    document.getElementById('settFolderInstructions').value = folders.instructionsFile || '';
  }

  const folderFields = [
    { btn: 'btnBrowseCwd', input: 'settFolderCwd' },
    { btn: 'btnBrowseSessions', input: 'settFolderSessions' },
    { btn: 'btnBrowseSkills', input: 'settFolderSkills' },
    { btn: 'btnBrowseAgents', input: 'settFolderAgents' },
    { btn: 'btnBrowseImages', input: 'settFolderImages' },
  ];
  folderFields.forEach(({ btn, input }) => {
    document.getElementById(btn).addEventListener('click', async () => {
      const folder = await copilot.folders.browse();
      if (folder) document.getElementById(input).value = folder;
    });
  });

  // Instructions file browse (file dialog, not folder)
  document.getElementById('btnBrowseInstructions').addEventListener('click', async () => {
    const file = await copilot.folders.browseFile([{ name: 'Markdown', extensions: ['md'] }]);
    if (file) document.getElementById('settFolderInstructions').value = file;
  });

  // Instructions editor
  document.getElementById('btnEditInstructions').addEventListener('click', async () => {
    const result = await copilot.instructions.read();
    if (!result.success) {
      showNotification(`Fehler: ${result.error}`, 'error');
      return;
    }
    openInstructionsEditor(result.content, result.path);
  });

  document.getElementById('btnFoldersSave').addEventListener('click', async () => {
    const config = {
      cwd: document.getElementById('settFolderCwd').value || undefined,
      sessionsDir: document.getElementById('settFolderSessions').value || undefined,
      skillsDir: document.getElementById('settFolderSkills').value || undefined,
      agentsDir: document.getElementById('settFolderAgents').value || undefined,
      imagesDir: document.getElementById('settFolderImages').value || undefined,
      instructionsFile: document.getElementById('settFolderInstructions').value || undefined,
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
  initShortcutsSettings();

  // Dev tools: Onboarding toggle
  async function loadDevOnboardingState() {
    const { onboardingComplete } = await copilot.dev.getOnboardingState();
    const statusEl = document.getElementById('devOnboardingStatus');
    const btnEl = document.getElementById('btnDevOnboardingToggle');
    if (onboardingComplete) {
      statusEl.textContent = 'Status: ● Abgeschlossen';
      statusEl.style.color = 'var(--accent)';
      btnEl.textContent = 'Zurücksetzen';
    } else {
      statusEl.textContent = 'Status: ○ Ausstehend';
      statusEl.style.color = 'var(--text-muted)';
      btnEl.textContent = 'Als erledigt markieren';
    }
  }

  document.getElementById('btnDevOnboardingToggle').addEventListener('click', async () => {
    const { onboardingComplete } = await copilot.dev.getOnboardingState();
    const result = await copilot.dev.setOnboardingComplete(!onboardingComplete);
    if (result.success) {
      await loadDevOnboardingState();
      showNotification(
        !onboardingComplete ? 'Onboarding als erledigt markiert' : 'Onboarding zurückgesetzt — Wizard erscheint beim nächsten Start',
        'success'
      );
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  });

  document.querySelector('.settings__tab[data-tab="ui"]')?.addEventListener('click', loadDevOnboardingState);
}

// ── Instructions Editor Modal ──────────────────────────────────────
/**
 * Open a modal editor for the copilot instructions markdown file.
 * @param {string} content - Current file content to pre-fill.
 * @param {string} filePath - Absolute path shown in the header.
 */
function openInstructionsEditor(content, filePath) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'instructions-editor-overlay';
  overlay.innerHTML = `
    <div class="instructions-editor">
      <div class="instructions-editor__header">
        <span class="instructions-editor__title">📝 Copilot Instructions</span>
        <span class="instructions-editor__path">${escapeHtml(filePath)}</span>
        <button class="instructions-editor__close" data-tooltip="Schließen">✕</button>
      </div>
      <textarea class="instructions-editor__textarea" spellcheck="false">${escapeHtml(content)}</textarea>
      <div class="instructions-editor__footer">
        <button class="action-btn" id="btnInstructionsCancel">Abbrechen</button>
        <button class="action-btn action-btn--primary" id="btnInstructionsSave">💾 Speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector('.instructions-editor__textarea');
  const closeBtn = overlay.querySelector('.instructions-editor__close');
  const cancelBtn = overlay.querySelector('#btnInstructionsCancel');
  const saveBtn = overlay.querySelector('#btnInstructionsSave');

  function close() { overlay.remove(); }
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  saveBtn.addEventListener('click', async () => {
    const result = await copilot.instructions.write(textarea.value);
    if (result.success) {
      showNotification('Instructions gespeichert', 'success');
      close();
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  });

  // Focus textarea
  setTimeout(() => textarea.focus(), 100);
}

/**
 * Initialize the sidebar collapse button and restore persisted state.
 */
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

  // Restore section collapse states
  const sectionsCollapsed = getPref('sidebarSectionsCollapsed', {});
  for (const [name, isCollapsed] of Object.entries(sectionsCollapsed)) {
    if (!isCollapsed) continue;
    const el = document.getElementById(name + 'Content');
    const chevron = document.getElementById(name + 'Chevron');
    const search = el?.parentElement?.querySelector('.sidebar__search');
    if (el) {
      el.style.display = 'none';
      if (search) search.style.display = 'none';
      if (chevron) chevron.classList.add('sidebar__chevron--collapsed');
    }
  }
}

function initTestRunner() {
  document.getElementById('btnTests')?.addEventListener('click', openTestRunner);
  document.getElementById('btnCloseTestRunner')?.addEventListener('click', closeTestRunner);
  document.getElementById('btnRunTests')?.addEventListener('click', runTests);
  document.getElementById('btnRunE2E')?.addEventListener('click', runE2E);
  document.getElementById('btnRunCoverage')?.addEventListener('click', runCoverage);
}

/**
 * Initialize the developer console panel: log capture, filtering,
 * and renderer console re-wiring for live log display.
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

/**
 * Initialize the in-chat search bar (Ctrl+F). Implements incremental
 * text highlighting with mark elements and keyboard navigation.
 */
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

// ── Keyboard Shortcut System ──────────────────────────────
/**
 * @type {Array<{id: string, label: string, category: string, default: {ctrl: boolean, shift: boolean, alt: boolean, key: string}}>}
 * Configurable keyboard shortcut definitions with default bindings.
 */
const SHORTCUT_DEFS = [
  { id: 'newTab',        label: 'Neuer Tab',              category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 't' } },
  { id: 'closeTab',      label: 'Tab schließen',          category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'w' } },
  { id: 'nextTab',       label: 'Nächster Tab',           category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'Tab' } },
  { id: 'prevTab',       label: 'Vorheriger Tab',         category: 'Tabs', default: { ctrl: true,  shift: true,  alt: false, key: 'Tab' } },
  { id: 'focusInput',    label: 'Eingabe fokussieren',    category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'l' } },
  { id: 'search',        label: 'Suche',                  category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'f' } },
  { id: 'exportChat',    label: 'Chat exportieren',       category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'e' } },
  { id: 'toggleSidebar', label: 'Sidebar ein/ausblenden', category: 'UI',   default: { ctrl: true,  shift: false, alt: false, key: 'b' } },
  { id: 'showShortcuts', label: 'Tastenkürzel anzeigen',  category: 'UI',   default: { ctrl: true,  shift: false, alt: false, key: '/' } },
];

const FIXED_SHORTCUTS = [
  { label: 'Tab 1–8 direkt',   binding: { ctrl: true,  shift: false, alt: false, key: '1–8' },    category: 'Tabs' },
  { label: 'Letzter Tab',      binding: { ctrl: true,  shift: false, alt: false, key: '9' },       category: 'Tabs' },
  { label: 'Aktion abbrechen', binding: { ctrl: false, shift: false, alt: false, key: 'Escape' },  category: 'Chat' },
];

function _getShortcutPrefs() { return getSettings().shortcuts || {}; }

/**
 * Get the effective keybinding for a shortcut (user override or default).
 * @param {string} id - Shortcut definition ID.
 * @returns {{ctrl: boolean, shift: boolean, alt: boolean, key: string}|null}
 */
function getShortcut(id) {
  const def = SHORTCUT_DEFS.find(d => d.id === id);
  if (!def) return null;
  return _getShortcutPrefs()[id] || def.default;
}

function saveShortcut(id, binding) {
  const prefs = _getShortcutPrefs();
  prefs[id] = binding;
  saveSetting('shortcuts', prefs);
}

function resetAllShortcuts() { saveSetting('shortcuts', {}); }

/**
 * Test whether a keyboard event matches a shortcut binding.
 * @param {KeyboardEvent} e
 * @param {{ctrl: boolean, shift: boolean, alt: boolean, key: string}} binding
 * @returns {boolean}
 */
function matchShortcut(e, binding) {
  return e.key === binding.key
    && !!e.ctrlKey  === !!binding.ctrl
    && !!e.shiftKey === !!binding.shift
    && !!e.altKey   === !!binding.alt;
}

/**
 * Format a shortcut binding as a human-readable label (e.g. "Ctrl+Shift+T").
 * @param {{ctrl: boolean, shift: boolean, alt: boolean, key: string}} binding
 * @returns {string}
 */
function shortcutLabel(binding) {
  const parts = [];
  if (binding.ctrl)  parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt)   parts.push('Alt');
  parts.push(binding.key === ' ' ? 'Space' : binding.key);
  return parts.join('+');
}

/**
 * Render the keyboard shortcuts help overlay content, grouped by category.
 */
function renderShortcutsHelp() {
  const container = document.getElementById('shortcutsHelpContent');
  if (!container) return;
  const byCategory = {};
  for (const def of SHORTCUT_DEFS) {
    (byCategory[def.category] ??= []).push({ label: def.label, binding: getShortcut(def.id) });
  }
  for (const sc of FIXED_SHORTCUTS) {
    (byCategory[sc.category] ??= []).push({ label: sc.label, binding: sc.binding });
  }
  container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div class="shortcuts-group">
      <div class="shortcuts-group__title">${escapeHtml(cat)}</div>
      <table class="shortcuts-table">
        ${items.map(it => `
          <tr>
            <td class="shortcuts-table__label">${escapeHtml(it.label)}</td>
            <td class="shortcuts-table__binding"><kbd class="shortcut-kbd">${escapeHtml(shortcutLabel(it.binding))}</kbd></td>
          </tr>`).join('')}
      </table>
    </div>
  `).join('');
}

/**
 * Initialize the shortcuts settings panel with per-shortcut recording
 * and reset functionality.
 */
function initShortcutsSettings() {
  let _recordingId = null;

  function renderShortcutsSettings() {
    const list = document.getElementById('settShortcutsList');
    if (!list) return;
    const byCategory = {};
    for (const def of SHORTCUT_DEFS) {
      (byCategory[def.category] ??= []).push(def);
    }
    list.innerHTML = Object.entries(byCategory).map(([cat, defs]) => `
      <div class="settings__group">
        <label class="settings__label">${escapeHtml(cat)}</label>
        ${defs.map(def => {
          const binding = getShortcut(def.id);
          const isCustom = !!_getShortcutPrefs()[def.id];
          const isRecording = _recordingId === def.id;
          return `
            <div class="shortcut-row" data-id="${def.id}">
              <span class="shortcut-row__label">${escapeHtml(def.label)}</span>
              <div class="shortcut-row__right">
                <kbd class="shortcut-kbd${isCustom ? ' shortcut-kbd--custom' : ''}">${escapeHtml(shortcutLabel(binding))}</kbd>
                <button class="action-btn shortcut-record-btn${isRecording ? ' shortcut-record-btn--active' : ''}" data-id="${def.id}">${isRecording ? 'Drücken…' : 'Ändern'}</button>
                ${isCustom ? `<button class="action-btn shortcut-reset-btn" data-id="${def.id}" data-tooltip="Zurücksetzen">↩</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    `).join('');

    list.querySelectorAll('.shortcut-record-btn').forEach(btn => {
      btn.addEventListener('click', () => startRecording(btn.dataset.id));
    });
    list.querySelectorAll('.shortcut-reset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prefs = _getShortcutPrefs();
        delete prefs[btn.dataset.id];
        saveSetting('shortcuts', prefs);
        renderShortcutsSettings();
        renderShortcutsHelp();
      });
    });
  }

  function startRecording(id) {
    if (_recordingId) { _recordingId = null; }
    _recordingId = id;
    renderShortcutsSettings();

    function onKeydown(e) {
      if (e.key === 'Escape') { _recordingId = null; renderShortcutsSettings(); document.removeEventListener('keydown', onKeydown, true); return; }
      e.preventDefault();
      e.stopPropagation();
      saveShortcut(id, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key });
      _recordingId = null;
      document.removeEventListener('keydown', onKeydown, true);
      renderShortcutsSettings();
      renderShortcutsHelp();
    }
    document.addEventListener('keydown', onKeydown, true);
  }

  document.getElementById('btnResetShortcuts')?.addEventListener('click', () => {
    resetAllShortcuts();
    renderShortcutsSettings();
    renderShortcutsHelp();
  });
  document.querySelector('.settings__tab[data-tab="shortcuts"]')?.addEventListener('click', renderShortcutsSettings);
  renderShortcutsSettings();
}

/**
 * Register the global keydown handler that dispatches all configurable
 * shortcuts (tab cycling, new/close tab, search, export, etc.).
 */
function initKeyboardShortcuts() {
  const searchBar = document.getElementById('chatSearchBar');
  const sc = (id, e) => matchShortcut(e, getShortcut(id));

  document.addEventListener('keydown', (e) => {
    // Tab cycling (Ctrl+Tab / Ctrl+Shift+Tab)
    if (sc('nextTab', e)) {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (tabIds.length > 0) switchTab(tabIds[(tabIds.indexOf(activeTabId) + 1) % tabIds.length]);
      return;
    }
    if (sc('prevTab', e)) {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (tabIds.length > 0) switchTab(tabIds[(tabIds.indexOf(activeTabId) - 1 + tabIds.length) % tabIds.length]);
      return;
    }

    if (sc('newTab', e))   { e.preventDefault(); createTab('🤖 Copilot'); return; }
    if (sc('closeTab', e)) { e.preventDefault(); if (activeTabId != null) closeTab(activeTabId); return; }

    // Ctrl+1–8: go to tab by index; Ctrl+9: always last tab
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (e.key === '9') {
        if (tabIds.length > 0) switchTab(tabIds[tabIds.length - 1]);
      } else {
        const idx = parseInt(e.key) - 1;
        if (idx < tabIds.length) switchTab(tabIds[idx]);
      }
      return;
    }

    // Ctrl+/ — show shortcuts (always works, no typing check needed)
    if (sc('showShortcuts', e)) {
      e.preventDefault();
      renderShortcutsHelp();
      document.getElementById('shortcutsOverlay').classList.add('overlay--visible');
      return;
    }

    if (sc('focusInput', e))    { e.preventDefault(); document.getElementById('chatInput')?.focus(); return; }
    if (sc('exportChat', e))    { e.preventDefault(); exportChat(); return; }
    if (sc('search', e))        { e.preventDefault(); if (window._openSearch) window._openSearch(); return; }
    if (sc('toggleSidebar', e)) { e.preventDefault(); document.getElementById('btnCollapseSidebar').click(); return; }

    if (e.key === 'Escape') {
      // Close model dropdown first (highest priority)
      const modelDd = document.querySelector('.model-dropdown--below');
      if (modelDd) { modelDd.remove(); return; }
      const testPopup = document.getElementById('testRunnerPopup');
      if (testPopup && testPopup.style.display !== 'none') { closeTestRunner(); return; }
      const shortcutsOverlay = document.getElementById('shortcutsOverlay');
      if (shortcutsOverlay.classList.contains('overlay--visible')) { shortcutsOverlay.classList.remove('overlay--visible'); return; }
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

  // ⌨️ button in sidebar footer
  document.getElementById('btnShortcutsHelp')?.addEventListener('click', () => {
    renderShortcutsHelp();
    document.getElementById('shortcutsOverlay').classList.add('overlay--visible');
  });

  // Shortcuts help overlay controls
  document.getElementById('btnShortcutsClose').addEventListener('click', () => {
    document.getElementById('shortcutsOverlay').classList.remove('overlay--visible');
  });
  document.getElementById('shortcutsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcutsOverlay'))
      document.getElementById('shortcutsOverlay').classList.remove('overlay--visible');
  });

  renderShortcutsHelp();
}

/**
 * Initialize drag-and-drop on the stream area. Dropped files are processed
 * and inserted into the chat input as @-references or inline code blocks.
 */
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

/**
 * Initialize the global tooltip system. Tooltips appear for any element
 * with a `data-tooltip` attribute after a short hover delay.
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

// ── Onboarding Wizard ────────────────────────────────────────
/** @type {number} Current onboarding wizard step (1-based). */
let _onboardingStep = 1;
/** @type {number} Current intro-slide index within the final onboarding step. */
let _onboardingSlide = 0;
/** @type {number} Total number of onboarding wizard steps. */
const ONBOARDING_TOTAL_STEPS = 4;

/**
 * Check if this is the user's first run and launch the onboarding wizard if so.
 * @returns {Promise<void>}
 */
async function initOnboarding() {
  let isFirstRun;
  try {
    isFirstRun = await copilot.onboarding.isFirstRun();
  } catch (e) {
    console.warn('[onboarding] Check fehlgeschlagen:', e.message);
    return;
  }
  if (!isFirstRun) return;

  const overlay = document.getElementById('onboarding-overlay');
  overlay.style.display = 'flex';

  document.getElementById('btnOnboardingNext').addEventListener('click', nextOnboardingStep);

  showOnboardingStep(1);
}

function updateStepIndicators(step) {
  const steps = document.querySelectorAll('.onboarding-step');
  steps.forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle('onboarding-step--active', s === step);
    el.classList.toggle('onboarding-step--done', s < step);
  });
}

/**
 * Render a specific onboarding wizard step (CWD, Login, Folders, or Categories).
 * @param {number} step - Step number (1–4).
 */
function showOnboardingStep(step) {
  _onboardingStep = step;
  updateStepIndicators(step);

  const body = document.getElementById('onboarding-body');
  const btnNext = document.getElementById('btnOnboardingNext');
  btnNext.disabled = true;
  btnNext.onclick = null;
  btnNext.textContent = step < ONBOARDING_TOTAL_STEPS ? 'Weiter →' : 'Fertig ✓';

  if (step === 1) {
    renderCwdStep(body, btnNext);
  } else if (step === 2) {
    renderLoginStep(body, btnNext);
  } else if (step === 3) {
    renderFolderStep(body, btnNext);
  } else if (step === 4) {
    renderCategoryStep(body, btnNext);
  }
}

/**
 * Render the CWD (working directory) selection step of the onboarding wizard.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable when valid.
 * @returns {Promise<void>}
 */
async function renderCwdStep(body, btnNext) {
  body.innerHTML = `
    <div class="onboarding-cwd">
      <h2 class="onboarding-cwd__title">📂 Arbeitsverzeichnis</h2>
      <p class="onboarding-cwd__desc">Wähle das Verzeichnis, in dem Copilot Desktop arbeiten soll. Dort werden deine Sessions und Dateien gespeichert.</p>
      <div id="onboarding-cwd-status" class="onboarding-cwd__status">
        <span class="onboarding-login__spinner"></span> Lade aktuelles Verzeichnis…
      </div>
    </div>`;

  try {
    const currentCwd = await copilot.chat.getCwd();
    const statusEl = document.getElementById('onboarding-cwd-status');
    if (!statusEl) return;

    statusEl.className = 'onboarding-cwd__path-row';
    statusEl.innerHTML = `
      <input type="text" id="onboarding-cwd-input" class="onboarding-role__input" value="${escapeHtml(currentCwd || '')}" readonly />
      <button class="action-btn action-btn--primary" id="btnOnboardingBrowseCwd">📁 Ändern</button>`;

    if (currentCwd) {
      btnNext.disabled = false;
    }

    document.getElementById('btnOnboardingBrowseCwd').addEventListener('click', async () => {
      const selectedPath = await copilot.folders.browse();
      if (selectedPath) {
        document.getElementById('onboarding-cwd-input').value = selectedPath;
        await copilot.folders.save({ cwd: selectedPath });
        btnNext.disabled = false;
      }
    });
  } catch (e) {
    const statusEl = document.getElementById('onboarding-cwd-status');
    if (statusEl) {
      statusEl.className = 'onboarding-login__status onboarding-login__status--error';
      statusEl.innerHTML = `❌ Fehler: ${escapeHtml(e.message)}`;
    }
  }
}

/**
 * Render the GitHub Copilot login check/prompt step.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable when authenticated.
 * @returns {Promise<void>}
 */
async function renderLoginStep(body, btnNext) {
  body.innerHTML = `
    <div class="onboarding-login">
      <h2 class="onboarding-login__title">🔐 GitHub Copilot Login</h2>
      <p class="onboarding-login__desc">Für die Nutzung von Copilot Desktop benötigst du einen aktiven GitHub Copilot Account. Der Login erfolgt über die Copilot CLI.</p>
      <div class="onboarding-login__status" id="onboarding-login-status">
        <span class="onboarding-login__spinner"></span> Prüfe Login-Status…
      </div>
    </div>`;

  try {
    const result = await copilot.auth.check();
    const statusEl = document.getElementById('onboarding-login-status');
    if (!statusEl) return;

    if (result.authenticated) {
      const user = result.user ? escapeHtml(result.user) : '';
      statusEl.className = 'onboarding-login__status onboarding-login__status--ok';
      statusEl.innerHTML = `✅ Eingeloggt${user ? ' als <strong>' + user + '</strong>' : ''}`;
      btnNext.disabled = false;
    } else {
      statusEl.className = 'onboarding-login__status onboarding-login__status--warn';
      statusEl.innerHTML = `⚠️ Nicht eingeloggt. <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Jetzt einloggen</button> <button class="action-btn onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button>`;
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin(btnNext));
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderLoginStep(document.getElementById('onboarding-body'), btnNext));
    }
  } catch (e) {
    const statusEl = document.getElementById('onboarding-login-status');
    if (statusEl) {
      statusEl.className = 'onboarding-login__status onboarding-login__status--error';
      statusEl.innerHTML = `❌ Prüfung fehlgeschlagen: ${escapeHtml(e.message)}`;
    }
  }
}

/**
 * Handle the login flow within the onboarding wizard. Opens the auth
 * window and provides re-check buttons.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable on success.
 * @returns {Promise<void>}
 */
async function handleOnboardingLogin(btnNext) {
  const statusEl = document.getElementById('onboarding-login-status');
  if (!statusEl) return;
  statusEl.className = 'onboarding-login__status';
  statusEl.innerHTML = '<span class="onboarding-login__spinner"></span> Login-Fenster wird geöffnet… Bitte im neuen Fenster einloggen.';

  try {
    const result = await copilot.auth.login();
    if (result.success) {
      statusEl.className = 'onboarding-login__status onboarding-login__status--warn';
      statusEl.innerHTML = `ℹ️ Login-Fenster geöffnet. Bitte melde dich dort an und klicke dann <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button>`;
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderLoginStep(document.getElementById('onboarding-body'), btnNext));
    } else {
      statusEl.className = 'onboarding-login__status onboarding-login__status--error';
      statusEl.innerHTML = `❌ Login fehlgeschlagen: ${escapeHtml(result.error || 'Unbekannter Fehler')} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button>`;
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin(btnNext));
    }
  } catch (e) {
    statusEl.className = 'onboarding-login__status onboarding-login__status--error';
    statusEl.innerHTML = `❌ Fehler: ${escapeHtml(e.message)} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button>`;
    document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin(btnNext));
  }
}

/**
 * Render the folder setup step: check which required directories exist
 * and offer to create missing ones.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable when all folders exist.
 * @returns {Promise<void>}
 */
async function renderFolderStep(body, btnNext) {
  body.innerHTML = `
    <div class="onboarding-folders">
      <h2 class="onboarding-folders__title">📁 Ordner einrichten</h2>
      <p class="onboarding-folders__desc">Copilot Desktop benötigt einige Ordner für Skills, Agents, Sessions und Instructions. Diese werden in deinem Home-Verzeichnis angelegt.</p>
      <ul class="onboarding-folder-list" id="onboarding-folder-list">
        <li class="onboarding-folder-item"><span class="onboarding-login__spinner"></span> Prüfe…</li>
      </ul>
    </div>`;

  try {
    const status = await copilot.setup.getFolderStatus();
    renderFolderList(status, btnNext);
  } catch (e) {
    const list = document.getElementById('onboarding-folder-list');
    if (list) list.innerHTML = `<li class="onboarding-folder-item onboarding-folder-item--missing">❌ Fehler: ${escapeHtml(e.message)}</li>`;
  }
}

/**
 * Render the folder status checklist and a "Create folders" button if needed.
 * @param {Object<string, {exists: boolean, path: string}>} status - Folder existence status.
 * @param {HTMLButtonElement} btnNext
 */
function renderFolderList(status, btnNext) {
  const list = document.getElementById('onboarding-folder-list');
  if (!list) return;

  const keys = ['skills', 'agents', 'sessions', 'instructions'];
  const allExist = keys.every(k => status[k] && status[k].exists);

  let html = '';
  for (const key of keys) {
    const item = status[key];
    if (!item) continue;
    const cls = item.exists ? 'onboarding-folder-item--ok' : 'onboarding-folder-item--missing';
    const icon = item.exists ? '✅' : '⬜';
    html += `<li class="onboarding-folder-item ${cls}"><span class="onboarding-folder-item__icon">${icon}</span><code class="onboarding-folder-item__path">${escapeHtml(item.path)}</code></li>`;
  }
  list.innerHTML = html;

  const container = list.parentElement;
  const existingBtn = container.querySelector('.onboarding-create-btn');
  if (existingBtn) existingBtn.remove();

  if (allExist) {
    btnNext.disabled = false;
  } else {
    const btn = document.createElement('button');
    btn.className = 'action-btn action-btn--primary onboarding-create-btn';
    btn.textContent = '📁 Ordner anlegen';
    btn.addEventListener('click', () => handleCreateFolders(btn, btnNext));
    container.appendChild(btn);
  }
}

async function handleCreateFolders(createBtn, btnNext) {
  createBtn.disabled = true;
  createBtn.innerHTML = '<span class="onboarding-login__spinner"></span> Erstelle…';

  try {
    await copilot.setup.createFolders();
    const status = await copilot.setup.getFolderStatus();
    renderFolderList(status, btnNext);
  } catch (e) {
    createBtn.disabled = false;
    createBtn.textContent = '📁 Ordner anlegen';
    const list = document.getElementById('onboarding-folder-list');
    if (list) {
      const errLi = document.createElement('li');
      errLi.className = 'onboarding-folder-item onboarding-folder-item--missing';
      errLi.textContent = `❌ ${e.message}`;
      list.appendChild(errLi);
    }
  }
}

/**
 * Render the role/category personalization step where users enter their
 * job role and missing team positions to generate skills and agents.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next/Finish" button.
 * @returns {Promise<void>}
 */
async function renderCategoryStep(body, btnNext) {
  const missingRoles = [];

  body.innerHTML = `
    <div class="onboarding-role">
      <h2 class="onboarding-categories__title">🎯 Dein Aufgabenbereich</h2>
      <p class="onboarding-categories__desc">Was machst du in deinem Job? Wir legen passende Skills für dich an.</p>

      <div class="onboarding-role__field">
        <label for="onboarding-role-input">Deine Rolle</label>
        <input type="text" id="onboarding-role-input"
               placeholder="z.B. Marketing Manager, Backend-Entwickler, Projektleiter…"
               class="onboarding-role__input" />
      </div>

      <div class="onboarding-role__team-section" id="onboarding-team-section" style="display:none">
        <h3 class="onboarding-role__section-title">👥 Fehlende Team-Positionen</h3>
        <p class="onboarding-categories__desc">Welche Rollen vermisst du in deinem Team? Wir legen für jede Position einen Agent an.</p>
        <div class="onboarding-role__chips" id="onboarding-role-chips"></div>
        <div class="onboarding-role__chip-input-row">
          <input type="text" id="onboarding-team-input"
                 placeholder="z.B. Event Manager, Webdesigner… (Enter zum Hinzufügen)"
                 class="onboarding-role__input onboarding-role__chip-input" />
          <button class="action-btn" id="onboarding-add-chip">Hinzufügen</button>
        </div>
      </div>

      <div id="onboarding-role-action"></div>
      <div id="onboarding-role-status"></div>
    </div>`;

  const roleInput = document.getElementById('onboarding-role-input');
  const teamSection = document.getElementById('onboarding-team-section');
  const teamInput = document.getElementById('onboarding-team-input');
  const addChipBtn = document.getElementById('onboarding-add-chip');
  const chipsContainer = document.getElementById('onboarding-role-chips');
  const actionContainer = document.getElementById('onboarding-role-action');
  const statusContainer = document.getElementById('onboarding-role-status');

  btnNext.disabled = true;

  function showTeamSection() {
    if (roleInput.value.trim() && teamSection.style.display === 'none') {
      teamSection.style.display = '';
      updateSetupButton();
    }
  }

  function addChip() {
    const val = teamInput.value.trim();
    if (!val) return;
    if (missingRoles.includes(val)) { teamInput.value = ''; return; }
    missingRoles.push(val);
    teamInput.value = '';
    renderChips();
  }

  function renderChips() {
    chipsContainer.innerHTML = '';
    missingRoles.forEach((role, idx) => {
      const chip = document.createElement('span');
      chip.className = 'onboarding-role__chip';
      chip.innerHTML = `${escapeHtml(role)} <button class="onboarding-role__chip-remove" data-idx="${idx}">&times;</button>`;
      chipsContainer.appendChild(chip);
    });
    chipsContainer.querySelectorAll('.onboarding-role__chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        missingRoles.splice(parseInt(btn.dataset.idx), 1);
        renderChips();
      });
    });
  }

  function updateSetupButton() {
    const role = roleInput.value.trim();
    const existing = actionContainer.querySelector('.onboarding-role__setup-btn');
    if (role && !existing) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-btn--primary onboarding-role__setup-btn';
      btn.textContent = '✨ Einrichten';
      btn.style.marginTop = '12px';
      btn.style.width = '100%';
      btn.addEventListener('click', () => handleGeneratePersonalized(btn));
      actionContainer.appendChild(btn);
    } else if (!role && existing) {
      existing.remove();
    }
  }

  async function handleGeneratePersonalized(setupBtn) {
    const role = roleInput.value.trim();
    if (!role) return;

    setupBtn.disabled = true;
    setupBtn.innerHTML = '<span class="onboarding-login__spinner"></span> Wird vorbereitet…';
    statusContainer.innerHTML = '';

    try {
      const { skillPrompt, agentPrompt } = await copilot.setup.startPersonalizedSessions({ role, missingRoles });

      // Close onboarding immediately
      await finishOnboarding();

      // Open tab for skill generation
      const skillTabId = await createTab('⚡ Skills generieren');
      _pendingOnboardingTabs.add(skillTabId);
      const skillTab = tabs.get(skillTabId);
      if (skillTab) {
        skillTab.isProcessing = true;
        setTabStatus(skillTabId, 'working');
        const skillInputEl = document.createElement('div');
        skillInputEl.className = 'stream-input';
        skillInputEl.textContent = 'Skills für "' + role + '" generieren…';
        skillTab.streamEl.insertBefore(skillInputEl, skillTab.statusEl);
        skillTab.statusEl.textContent = '● Thinking…';
        skillTab.statusEl.style.display = 'block';
        copilot.chat.send(skillTabId, skillPrompt, {
          autoApprove: true,
          allowedTools: [],
          deniedTools: [],
          allowAllPaths: true,
        });
      }

      // Open tab for agent generation (if roles specified)
      if (agentPrompt) {
        const agentTabId = await createTab('👥 Agents generieren');
        _pendingOnboardingTabs.add(agentTabId);
        const agentTab = tabs.get(agentTabId);
        if (agentTab) {
          agentTab.isProcessing = true;
          setTabStatus(agentTabId, 'working');
          const agentInputEl = document.createElement('div');
          agentInputEl.className = 'stream-input';
          agentInputEl.textContent = 'Agents für fehlende Team-Positionen generieren…';
          agentTab.streamEl.insertBefore(agentInputEl, agentTab.statusEl);
          agentTab.statusEl.textContent = '● Thinking…';
          agentTab.statusEl.style.display = 'block';
          copilot.chat.send(agentTabId, agentPrompt, {
            autoApprove: true,
            allowedTools: [],
            deniedTools: [],
            allowAllPaths: true,
          });
        }
      }
    } catch (e) {
      setupBtn.disabled = false;
      setupBtn.textContent = '✨ Einrichten';
      statusContainer.innerHTML = `<p class="onboarding-categories__error">❌ ${escapeHtml(e.message)}</p>`;
    }
  }

  roleInput.addEventListener('blur', showTeamSection);
  roleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); showTeamSection(); roleInput.blur(); }
  });
  roleInput.addEventListener('input', updateSetupButton);

  teamInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChip(); }
  });
  addChipBtn.addEventListener('click', addChip);
}

const _introSlides = [
  { icon: '💬', title: 'Chat-Tabs', text: 'Jede Aufgabe bekommt ihren eigenen Tab. Starte neue Chats mit dem + Button und wechsle zwischen ihnen.' },
  { icon: '🤖', title: 'Skills & Agents', text: 'Aktiviere Skills über das Plugin-Menü. Deine eingerichteten Agents findest du als Befehle direkt im Chat.' },
  { icon: '🚀', title: 'Alles bereit!', text: 'Du kannst jederzeit zurückkehren und weitere Agents und Skills in den Einstellungen hinzufügen.' }
];

function renderIntroStep(body, btnNext) {
  _onboardingSlide = 0;
  renderIntroSlide(body);
  updateIntroNextButton(btnNext);
}

function renderIntroSlide(body) {
  const slide = _introSlides[_onboardingSlide];
  const dots = _introSlides.map((_, i) =>
    `<span class="onboarding-intro__dot${i === _onboardingSlide ? ' onboarding-intro__dot--active' : ''}"></span>`
  ).join('');

  body.innerHTML = `
    <div class="onboarding-intro">
      <span class="onboarding-intro__icon">${slide.icon}</span>
      <h2 class="onboarding-intro__title">${escapeHtml(slide.title)}</h2>
      <p class="onboarding-intro__text">${escapeHtml(slide.text)}</p>
      <div class="onboarding-intro__dots">${dots}</div>
      <div class="onboarding-intro__nav">
        <button class="action-btn onboarding-intro__btn-prev" ${_onboardingSlide === 0 ? 'style="visibility:hidden"' : ''}>← Zurück</button>
        <button class="action-btn onboarding-intro__btn-next" ${_onboardingSlide >= _introSlides.length - 1 ? 'style="visibility:hidden"' : ''}>Weiter →</button>
      </div>
    </div>`;

  const prevBtn = body.querySelector('.onboarding-intro__btn-prev');
  const nextBtn = body.querySelector('.onboarding-intro__btn-next');

  prevBtn.addEventListener('click', () => {
    if (_onboardingSlide > 0) {
      _onboardingSlide--;
      renderIntroSlide(body);
      updateIntroNextButton(document.getElementById('btnOnboardingNext'));
    }
  });

  nextBtn.addEventListener('click', () => {
    if (_onboardingSlide < _introSlides.length - 1) {
      _onboardingSlide++;
      renderIntroSlide(body);
      updateIntroNextButton(document.getElementById('btnOnboardingNext'));
    }
  });
}

function updateIntroNextButton(btnNext) {
  if (_onboardingSlide >= _introSlides.length - 1) {
    btnNext.disabled = false;
    btnNext.textContent = 'Fertig 🎉';
    btnNext.onclick = null; // nextOnboardingStep handles finish
  } else {
    btnNext.disabled = true;
    btnNext.textContent = 'Weiter →';
    btnNext.onclick = null;
  }
}

/**
 * Advance the onboarding wizard to the next step, or finish if on the last step.
 */
function nextOnboardingStep() {
  if (_onboardingStep >= ONBOARDING_TOTAL_STEPS) {
    finishOnboarding();
    return;
  }
  showOnboardingStep(_onboardingStep + 1);
}

// ── Tutorial Popup ─────────────────────────────────────────
/**
 * Show a tutorial popup next to the Skills section header, teaching
 * the user about hovering for tooltips and reloading. Auto-dismisses
 * after 30s or when the user clicks the reload button.
 * @returns {Promise<void>}
 */
async function showTutorialPopup() {
  const flags = await copilot.tutorial.getFlags();
  if (flags.tutorialSkillsShown) return;

  const skillsHeader = document.querySelector('.sidebar__section[data-icon="🛠️"] .sidebar__header');
  if (!skillsHeader) return;

  const existing = document.getElementById('tutorialSkillsPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'tutorial-popup';
  popup.id = 'tutorialSkillsPopup';
  popup.innerHTML =
    '<div class="tutorial-popup__arrow"></div>' +
    '<div class="tutorial-popup__header">' +
      '<span class="tutorial-popup__title">💡 Tipp</span>' +
      '<button class="tutorial-popup__close" id="tutorialSkillsClose">×</button>' +
    '</div>' +
    '<div class="tutorial-popup__body">' +
      'Über <strong>Skills &amp; Agents</strong> hovern — Beschreibung erscheint als Tooltip.<br>' +
      'Über den Header hovern um neu zu laden <strong>↻</strong>' +
    '</div>';
  document.body.appendChild(popup);

  const rect = skillsHeader.getBoundingClientRect();
  popup.style.top = (rect.top + rect.height / 2 - popup.offsetHeight / 2) + 'px';
  popup.style.left = (rect.right + 12) + 'px';

  await copilot.tutorial.setFlag('tutorialSkillsShown', true);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popup.remove();
    document.removeEventListener('click', onReloadClick);
    setTimeout(() => showTutorialRenamePopup(), 1000);
  };

  // Close when user clicks the reload button
  const onReloadClick = (e) => {
    if (e.target.closest('[aria-label="Skills neu laden"], [aria-label="Agents neu laden"]')) close();
  };

  popup.querySelector('.tutorial-popup__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  setTimeout(() => document.addEventListener('click', onReloadClick), 200);

  // Safety: auto-close after 30s to prevent listener leak if user ignores popup
  setTimeout(() => close(), 30000);
}

/**
 * Show a tutorial popup below the first tab, teaching the user to rename
 * tabs for session persistence. Auto-dismisses after 30s or on rename.
 * @returns {Promise<void>}
 */
async function showTutorialRenamePopup() {
  const flags = await copilot.tutorial.getFlags();
  if (flags.tutorialRenameShown) return;

  const tabBar = document.getElementById('tabBar');
  const firstTab = tabBar && tabBar.querySelector('.tab');
  if (!firstTab) return;

  const existing = document.getElementById('tutorialRenamePopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'tutorial-popup tutorial-popup--below';
  popup.id = 'tutorialRenamePopup';
  popup.innerHTML =
    '<div class="tutorial-popup__arrow tutorial-popup__arrow--up"></div>' +
    '<div class="tutorial-popup__header">' +
      '<span class="tutorial-popup__title">💡 Tipp</span>' +
      '<button class="tutorial-popup__close" id="tutorialRenameClose">×</button>' +
    '</div>' +
    '<div class="tutorial-popup__body">' +
      'Tab <strong>✎ umbenennen</strong> um den Gesprächsverlauf zu speichern' +
    '</div>';
  document.body.appendChild(popup);

  const rect = firstTab.getBoundingClientRect();
  popup.style.left = (rect.left + rect.width / 2 - popup.offsetWidth / 2) + 'px';
  popup.style.top = (rect.bottom + 10) + 'px';

  await copilot.tutorial.setFlag('tutorialRenameShown', true);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popup.remove();
    document.removeEventListener('tab:renamed', onTabRenamed);
  };

  // Close when user successfully renames a tab
  const onTabRenamed = () => close();

  popup.querySelector('.tutorial-popup__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  setTimeout(() => document.addEventListener('tab:renamed', onTabRenamed), 200);

  // Safety: auto-close after 30s to prevent listener leak if user ignores popup
  setTimeout(() => close(), 30000);
}

/**
 * Mark onboarding as complete and hide the overlay.
 * @returns {Promise<void>}
 */
async function finishOnboarding() {
  try {
    await copilot.onboarding.complete();
  } catch (e) {
    console.warn('[onboarding] Complete fehlgeschlagen:', e.message);
  }
  const overlay = document.getElementById('onboarding-overlay');
  overlay.style.display = 'none';
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
  initSessionTools();
  initSettings();
  initSidebar();
  initPluginButtons();
  initTestRunner();
  initDevConsole();
  initChatSearch();
  initKeyboardShortcuts();
  initDragDrop();
  initTooltips();
  initTabModelSelector();
  initOnboarding();
});

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

// ── Skills Definition ────────────────────────────────────────
/** @type {Array<{id: string, name: string, icon: string, description: string, source: string, dirName?: string}>} Skill definitions loaded from main process. */
let skills = [];

// ── Agents Definition ────────────────────────────────────────
/** @type {Array<{id: string, name: string, icon: string, description: string, fileSlug?: string}>} Agent definitions loaded from main process. */
let agents = [];

// ── MCP Servers State ────────────────────────────────────────
/** @type {Array<{name: string, status: string}>} MCP server list for the active tab. */
let mcpServers = [];
/** @type {Array<{name: string, type: string, status: string}>} User/workspace MCP servers from `copilot mcp list`. */
let globalMcpServers = [];

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
/** @type {Set<string>} DirNames of skills hidden globally in ~/.copilot/settings.json */
let hiddenSkillsGlobal = new Set();
/** @type {Set<string>} DirNames of skills hidden for the current session only */
let hiddenSkillsSession = new Set();
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
 * @type {Map<string, {streamEl: HTMLElement, statusEl: HTMLElement, label: string, sessionId: string|null, isProcessing: boolean, lastActivityAt: number|null, terminal?: Object, mode: string, context: Object}>}
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
  tabs.forEach((tab) => {
    // Persist the chosen model with every tab so the provider survives a
    // restart even for tabs saved before their first message (no sessionId).
    // The ProviderID must be persisted explicitly — it can't always be derived
    // from the model (Claude Code and the Anthropic API share the same model ids).
    const provider = getTabProvider(tab);
    if (tab.sessionId) {
      openTabs.push({ sessionId: tab.sessionId, label: tab.label, selectedModel: tab.selectedModel || null, provider });
      // Persist denied tools in namedSessions
      saveSessionDeniedTools(tab.sessionId, tab.sessionDeniedTools || []);
    } else if (provider !== getDefaultProvider() || (tab.selectedModel && tab.selectedModel !== getDefaultModelId())) {
      // Unsent tab with a non-default provider/model chosen.
      openTabs.push({ sessionId: null, label: tab.label, selectedModel: tab.selectedModel, provider });
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
      const label = customName ? '🤖 ' + customName : (t.label || '🤖 Chat');
      // Resolve the model up front (entry first, then per-session map) so the
      // provider is correct from creation — including unsent tabs without id.
      const model = t.selectedModel || (t.sessionId ? getSessionModel(t.sessionId) : null) || undefined;
      const tabId = await createTab(label, model, t.provider);
      const tab = tabs.get(tabId);
      if (tab) {
        tab.sessionId = t.sessionId || null;
        tab.cwd = t.sessionId ? getSessionCwd(t.sessionId) : null;
        // Load denied tools from namedSessions
        tab.sessionDeniedTools = t.sessionId ? getSessionDeniedTools(t.sessionId) : [];
        updateModelSelectBtn(tabId);
        activeSessionId = t.sessionId;
        loadTodos(tab.cwd);
        renderSessionTools();
        // Display session context for restored tabs
        if (t.sessionId) displaySessionContext(tab, t.sessionId, tabId);
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

// Providers that get their own, fully independent "Verbotene Shell-Tools"
// list — see the denylist flag in PROVIDER_CAPABILITIES for why Gemini/Claude
// Code are excluded.
const DENYLIST_PROVIDERS = ['copilot', 'anthropic', 'openai', 'glm', 'ollama'];

/**
 * One-shot migration from the old flat, single global `deniedTools` list to
 * the new per-provider `deniedToolsByProvider` map: every provider that had
 * the shared list applied to it (all of DENYLIST_PROVIDERS) starts out with
 * a copy of whatever was configured, then they're fully independent from
 * then on. No-op once `deniedToolsByProvider` exists (regardless of content,
 * including `{}` — that's a legitimate "nothing denied anywhere" state).
 */
function migrateDeniedToolsToPerProvider() {
  const settings = getSettings();
  if (settings.deniedToolsByProvider !== undefined) return;
  const legacy = settings.deniedTools || [];
  const map = {};
  for (const p of DENYLIST_PROVIDERS) map[p] = [...legacy];
  saveSetting('deniedToolsByProvider', map);
}

function getDeniedTools(provider) {
  const map = getSettings().deniedToolsByProvider || {};
  return map[provider] || [];
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
 * Add a tool to one provider's own denied-tools list (wraps in shell() if needed).
 * @param {string} provider
 * @param {string} toolName - Tool or shell command name to deny.
 */
function addDeniedTool(provider, toolName) {
  const wrapped = toolName.startsWith('shell(') ? toolName : `shell(${toolName})`;
  const map = { ...(getSettings().deniedToolsByProvider || {}) };
  const tools = [...(map[provider] || [])];
  if (!tools.includes(wrapped)) {
    tools.push(wrapped);
    map[provider] = tools;
    saveSetting('deniedToolsByProvider', map);
  }
  renderDeniedTools(provider);
}

function removeDeniedTool(provider, idx) {
  const map = { ...(getSettings().deniedToolsByProvider || {}) };
  const tools = [...(map[provider] || [])];
  tools.splice(idx, 1);
  map[provider] = tools;
  saveSetting('deniedToolsByProvider', map);
  renderDeniedTools(provider);
}

function renderDeniedTools(provider) {
  renderTagList(`settDeniedToolsList-${provider}`, getDeniedTools(provider), 'removeDeniedTool', [provider]);
}

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
 * Show or hide developer-mode UI elements (test runner, dev console).
 * @param {boolean} enabled
 */
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
  const argsPrefix = extraArgs.map(a => `'${escapeAttrJs(a)}'`).join(', ');
  const callArgs = argsPrefix ? `${argsPrefix}, ` : '';
  container.innerHTML = items.map((item, i) =>
    `<span class="settings__tool-tag">${escapeHtml(stripShellWrapper(item))} <span class="settings__tool-tag__remove" onclick="${removeFnName}(${callArgs}${i})">&times;</span></span>`
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

// ── Tab Management ──────────────────────────────────────────
/**
 * Create a new chat tab, register it in the tabs map, and switch to it.
 * Also allocates a stream-output element and a status-line element.
 * @param {string} [label='🤖 Chat'] - Display label for the tab.
 * @returns {Promise<string>} The new tab's unique ID.
 */
async function createTab(label, initialModel, provider) {
  const tabLabel = label || '🤖 Chat';
  // The ProviderID is the authoritative discriminator (it determines available
  // models and provider-specific behaviour). Prefer the explicit arg; else derive
  // from the model (legacy), else the configured default provider.
  const tabProvider = provider
    || (initialModel ? window.RendererLogic.getModelProvider(initialModel) : null)
    || getDefaultProvider();
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
    cwd: null,          // per-tab working directory
    isProcessing: false,
    lastActivityAt: null,
    _inactivityTimer: null,
    _unlockBtnTimer: null,
    _unlockBtnEl: null,
    allowedTools: new Set(),
    sessionDeniedTools: [],
    // Restore the provider's last-picked mode, else the default.
    mode: getSavedModeForProvider(tabProvider) || DEFAULT_MODE_ID,
    _lastUsageParsed: null,
    _lastUsageText: null,
    _lastUsageTokens: null,
    _costUsd: 0,
    _sessionName: null,
    provider: tabProvider,
    // Per-tab manual-approval toggle; new tabs inherit the global default.
    manualApproval: getSettings().manualApproval === true,
    selectedModel: initialModel || getDefaultModelForProvider(tabProvider),
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

  // Hide all stream outputs, show only active
  tabs.forEach((tab, id) => {
    tab.streamEl.classList.toggle('stream-output--active', id === tabId);
  });

  activeTabId = tabId;
  const activeTab = tabs.get(tabId);

  // Load context for this tab's session; todos are project-scoped (by cwd).
  if (activeTab && activeTab.sessionId) {
    activeSessionId = activeTab.sessionId;
  }
  loadTodos(activeTab ? activeTab.cwd : null);

  renderTabs();

  // Global skills/agents follow the newly active tab's provider (Copilot
  // keeps its native ~/.copilot/{skills,agents}; every other provider has
  // its own folder).
  loadGlobalSkillsForProvider(getTabProvider(activeTab));
  loadGlobalAgentsForProvider(getTabProvider(activeTab));

  // Reload project skills/agents for the newly active tab's CWD
  loadProjectSkillsAndAgents(activeTab?.cwd || null);
  
  // Refresh session tools list for this tab
  renderSessionTools();

  // Update MCP servers for this tab: global (user/workspace) servers as base,
  // plus any tab-specific servers — deduplicated by name (global wins).
  mcpServers = mergeMcpByName(globalMcpServers, activeTab?.context?.mcpServers || []);
  renderMcpServers();

  // Update mode select button for this tab
  updateModeSelectBtn();

  // Update model select button for this tab
  updateModelSelectBtn();

  // Reflect the active tab's stored context-% in the button.
  updateContextButtonPct(activeTab ? (activeTab._contextPercent ?? null) : null);

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

  if (activeTab && isSubscriptionProvider(getTabProvider(activeTab))) {
    // Subscription (Claude Code): show the plan quota, not a USD/credit cost.
    updateSubscriptionUsageDisplay(activeTab);
  } else {
    updateUsageDisplay(activeTab?._lastUsageParsed ?? null, activeTab?._lastUsageTokens ?? null, activeTab?._lastUsageText ?? null);
    if (activeTab?.sessionId && !activeTab.isProcessing) {
      refreshUsageDisplay(tabId);
    }
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

  tabs.delete(tabId);

  if (tabs.size === 0) {
    createTab('🤖 Chat');
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

    const fullLabel = tab.label.replace(/^(🤖|🔌)\s*/, '');

    // Provider brand icon before the tab name (instead of the app logo).
    const iconWrap = document.createElement('span');
    iconWrap.className = 'tab__provider-icon';
    iconWrap.innerHTML = providerIconHtml(getTabProvider(tab));
    el.appendChild(iconWrap);

    // Short label (first 3 chars) shown only when the tab is collapsed — CSS
    // truncation looked cut-off, so we render the exact short text ourselves.
    const shortSpan = document.createElement('span');
    shortSpan.className = 'tab__short';
    shortSpan.textContent = fullLabel.slice(0, 3);
    el.appendChild(shortSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab__label';
    labelSpan.textContent = fullLabel;
    el.appendChild(labelSpan);

    // Edit (pencil) button — visible on hover. Renaming persists the session,
    // so only show it for providers that support session saving.
    const canSaveSession = providerSupports(getTabProvider(tab), 'sessions');
    if (canSaveSession) {
      const editBtn = document.createElement('span');
      editBtn.className = 'tab__edit';
      editBtn.textContent = '✎';
      editBtn.setAttribute('data-tooltip', 'Umbenennen');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startTabRename(id, el, labelSpan);
      });
      el.appendChild(editBtn);
    }

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
      if (canSaveSession) startTabRename(id, el, labelSpan);
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
        // Persist provider/cwd now that the session has a namedSessions entry.
        saveSessionProvider(tab.sessionId, getTabProvider(tab));
        if (tab.cwd) saveSessionCwd(tab.sessionId, tab.cwd);
        if (tab.selectedModel) saveSessionModel(tab.sessionId, tab.selectedModel);
      } else {
        // No session yet — create one
        try {
          const newId = await copilot.sessions.create(newName);
          if (newId) {
            tab.sessionId = newId;
            activeSessionId = newId;
            setSessionName(newId, newName);
            // Persist the tab's chosen model/provider (and cwd) against the new
            // session id. Without this, a tab saved before its first message
            // would lose its provider and fall back to Copilot on resume.
            if (tab.selectedModel) saveSessionModel(newId, tab.selectedModel);
            if (tab.cwd) saveSessionCwd(newId, tab.cwd);
            saveSessionProvider(newId, getTabProvider(tab));
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

  // Prevent clicks/mousedowns inside the input from bubbling to the tab
  // element, which would trigger switchTab() → renderTabs() and destroy
  // the input before the user has finished editing.
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());

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
// No automatic kill — only show unlock button for manual intervention
const INACTIVITY_CHECK_INTERVAL_MS = 10_000;
const UNLOCK_BTN_DELAY_MS = 60_000;

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
    // No automatic kill — user can manually unlock via button
    if (elapsed >= UNLOCK_BTN_DELAY_MS && !tab._unlockBtnEl) {
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

  if (tab.isProcessing) return;

  // Guard: a Copilot model that the CLI no longer offers (removed from the
  // dynamic list) can't be used — tell the user instead of failing opaquely.
  if (getTabProvider(tab) === 'copilot' && tab.selectedModel && !isCopilotModelAvailable(tab.selectedModel)) {
    showNotification(`Modell „${tab.selectedModel}" ist bei Copilot nicht mehr verfügbar. Bitte im 🧠-Menü ein anderes wählen.`, 'error');
    return;
  }

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

  // Build agent instructions prefix for active agents. Copilot's CLI has its
  // own "/agent Name" slash command to switch persona; every other provider
  // gets a plain-language hint instead — the model looks up the agent's full
  // instructions itself via the agents index already in its context
  // (composeSystemContext for API providers, the first-prompt index
  // injection for Claude Code) and adopts that persona from there.
  let agentPrefix = '';
  const activeAgentInfos = [];
  if (activeAgents.size > 0) {
    for (const id of activeAgents) {
      const a = agents.find(ag => ag.id === id);
      if (a) {
        activeAgentInfos.push({ name: a.name, icon: a.icon || '🤖' });
      }
    }
    agentPrefix = buildAgentPrefix(activeAgentInfos, getTabProvider(tab));
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
  const mergedDenied = [...new Set([...getDeniedTools(getTabProvider(tab)), ...sessionDenied])];

  const sendTabId = activeTabId;
  // Freeze the model this prompt actually runs on. The token delta measured after
  // completion must be priced at THIS model — not tab.selectedModel, which the
  // user may switch (for the next prompt) before /usage is read.
  tab._billingModel = tab.selectedModel || DEFAULT_MODEL_ID;
  copilot.chat.send(activeTabId, agentPrefix + skillPrefix + text, {
    sessionId: tab.sessionId || undefined,
    autoApprove: true,
    allowedTools: [],
    deniedTools: mergedDenied,
    allowAllPaths: settings.allowAllPaths === true,
    // Per-tab: when on, drop --allow-all / auto-approve so the agent asks per action.
    manualApproval: tab.manualApproval === true,
    addDirs: getEffectiveExtraDirs(),
    mode: tab.mode || DEFAULT_MODE_ID,
    // Empty → let the backend use its own default model (e.g. Claude Code before
    // we know its real model ids). Don't force a Copilot id onto other providers.
    model: tab.selectedModel || undefined,
    provider: getTabProvider(tab),
    cwd: tab.cwd || undefined,
    geminiMode: tab.geminiMode || 'search',
    baseURL: getProviderBaseUrl(getTabProvider(tab)) || undefined,
  })
    .then((res) => handleSendResult(sendTabId, res))
    .catch((err) => handleSendResult(sendTabId, { success: false, error: err?.message || String(err) }));

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

/**
 * Handle the result of copilot.chat.send. On success the backend streams events
 * and emits copilot:done; on failure no events arrive, so we must unstick the
 * tab's "processing" state here and surface the error (with an auth action when
 * the failure is an authentication problem).
 * @param {number} tabId
 * @param {number|{success:false,error:string}} res
 */
function handleSendResult(tabId, res) {
  // Success → res is the tab id (number). Failure → { success:false, error }.
  if (!res || typeof res !== 'object' || res.success !== false) return;
  const tab = tabs.get(tabId);
  if (!tab) return;

  stopInactivityMonitor(tabId);
  tab.isProcessing = false;
  if (tab.statusEl) tab.statusEl.style.display = 'none';

  const err = res.error || 'Unbekannter Fehler';
  if (/auth/i.test(err)) {
    showAuthRequiredBanner(tab);
  } else {
    const quota = appendStreamError(tab, err);
    showNotification(quota ? `${quota.title}: ${quota.detail}` : err, quota ? 'warning' : 'error');
  }
  setTabStatus(tabId, 'error');
  scrollToBottom(tab.streamEl);
}

/**
 * Insert an "authentication required" banner with a login button into a tab's
 * stream. The button triggers the existing Copilot CLI login flow.
 * @param {Object} tab
 */
function showAuthRequiredBanner(tab) {
  const el = document.createElement('div');
  el.className = 'stream-auth-required';
  const msg = document.createElement('span');
  msg.textContent = '🔐 Copilot-Anmeldung erforderlich — im Terminal anmelden, danach die App neu starten, damit die Sitzung übernommen wird.';
  el.appendChild(msg);

  // Restart button — hidden until login is triggered; the new auth state is only
  // picked up at main-process startup, so a renderer reload is not enough.
  const restartBtn = document.createElement('button');
  restartBtn.className = 'stream-auth-required__btn';
  restartBtn.textContent = 'App neu starten';
  restartBtn.style.display = 'none';
  restartBtn.addEventListener('click', () => {
    restartBtn.disabled = true;
    restartBtn.textContent = 'Wird neu gestartet…';
    copilot.window.relaunch().catch((e) => {
      showNotification('Neustart fehlgeschlagen: ' + (e?.message || e), 'error');
      restartBtn.disabled = false;
      restartBtn.textContent = 'App neu starten';
    });
  });

  const btn = document.createElement('button');
  btn.className = 'stream-auth-required__btn';
  btn.textContent = 'Anmelden';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Login geöffnet…';
    try {
      const r = await copilot.auth.login();
      showNotification(
        r && r.pendingInTerminal
          ? 'Login im Terminal abschließen, danach „App neu starten" klicken.'
          : 'Anmeldung gestartet.',
        'info',
      );
      // Offer the restart once login is running in the terminal.
      restartBtn.style.display = '';
      btn.textContent = 'Login erneut öffnen';
      btn.disabled = false;
    } catch (e) {
      showNotification('Login fehlgeschlagen: ' + (e?.message || e), 'error');
      btn.disabled = false;
      btn.textContent = 'Anmelden';
    }
  });
  el.appendChild(btn);
  el.appendChild(restartBtn);

  tab.streamEl.insertBefore(el, tab.statusEl);
  showNotification('Copilot-Anmeldung erforderlich.', 'warning');
}

// ── Copilot Event Processing (JSONL) ─────────────────────────

/**
 * Finalize the current streaming response bubble: flush the throttled markdown
 * render and detach it, so the next message text starts a fresh bubble. Called
 * at tool-call boundaries so interleaved "narrate → act → narrate" turns are
 * shown as separate messages instead of one concatenated blob.
 * @param {Object} tab
 */
function finalizeResponseBubble(tab) {
  if (tab._mdTimer) { clearTimeout(tab._mdTimer); tab._mdTimer = null; }
  if (tab._responseEl && tab._responseRaw) {
    tab._responseEl.innerHTML = window.markdown.render(tab._responseRaw);
  }
  tab._responseEl = null;
  tab._responseRaw = '';
}

/**
 * Append an error bubble to a tab's stream. Quota / rate-limit / billing errors
 * (Gemini 429, Anthropic credit limit, OpenAI insufficient_quota, …) are parsed
 * into a short, friendly info message; anything else is shown verbatim.
 * @param {Object} tab
 * @param {string} message - Raw error message/JSON.
 * @returns {{title:string, detail:string}|null} The parsed quota info, or null.
 */
function appendStreamError(tab, message) {
  const quota = window.RendererLogic.parseQuotaError(message);
  const el = document.createElement('div');
  if (quota) {
    el.className = 'stream-error stream-error--quota';
    el.innerHTML = `<strong>ℹ️ ${escapeHtml(quota.title)}</strong><br>${escapeHtml(quota.detail)}`;
  } else {
    el.className = 'stream-error';
    el.textContent = `⚠️ ${message}`;
  }
  tab.streamEl.insertBefore(el, tab.statusEl);
  return quota;
}

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
        {
          // A tool call (incl. report_intent) interrupted the reasoning stream.
          // Insert a break so the resumed thought doesn't glue onto the previous
          // one ("…protocol.Now I'm…"). Only when both sides lack whitespace.
          const delta = event.data.deltaContent || '';
          if (tab._pendingThinkBreak) {
            tab._pendingThinkBreak = false;
            const cur = tab._thinkingEl.textContent;
            if (cur && !/\s$/.test(cur) && delta && !/^\s/.test(delta)) {
              tab._thinkingEl.textContent += '\n\n';
            }
          }
          tab._thinkingEl.textContent += delta;
        }
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
        {
          // A report_intent (or other tool) interrupted the text without ending
          // the bubble → insert a paragraph break so sentences before/after don't
          // glue together (".mdDas Protokoll…"). Only when both sides lack whitespace.
          const delta = event.data.deltaContent || '';
          if (tab._pendingTextBreak) {
            tab._pendingTextBreak = false;
            if (tab._responseRaw && !/\s$/.test(tab._responseRaw) && delta && !/^\s/.test(delta)) {
              tab._responseRaw += '\n\n';
            }
          }
          tab._responseRaw += delta;
        }
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
        // Fresh turn → forget prior tool-result elements (dedup is per turn).
        tab._toolResultEls = new Map();
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
        // Tool calls are rendered centrally in tool.execution_start (single source
        // of truth), so nothing to do here for toolRequests.
        scrollToBottom(tab.streamEl);
        break;
      }

      // ── Tool execution ────────────────────────────────────
      case 'tool.execution_start': {
        tab.lastActivityAt = Date.now();
        // A tool call interrupts the assistant's text/reasoning stream. Mark a
        // pending break so the next delta doesn't glue onto the previous text —
        // report_intent keeps the same bubble, so without this the sentences merge.
        tab._pendingTextBreak = true;
        tab._pendingThinkBreak = true;
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
        // A real tool call ends the current message — close its bubble so the
        // text after the tool renders as a separate message.
        finalizeResponseBubble(tab);
        // Render the tool call as ONE element per callId, in a "pending" state
        // (⏳ + name + args). tool.execution_complete updates THIS same element
        // in place (→ ✓/✗ + result) instead of appending a second line, so each
        // tool call shows exactly once. MCP/unknown tools get a generic icon.
        // (report_intent already returned above.)
        {
          const callIcon = toolIcon(event.data.toolName) || '🔧';
          const callArgs = formatToolArgs(event.data.toolName, event.data.arguments || {});
          const callFull = toolArgFullText(event.data.arguments || {});
          const summaryHtml = `<span class="stream-tool-result__status">⏳</span> ${callIcon} <strong>${escapeHtml(toolDisplayName(event.data.toolName))}</strong> <span class="stream-tool-result__preview">${escapeHtml(callArgs)}</span>`;
          if (!tab._toolResultEls) tab._toolResultEls = new Map();
          const callId = event.data.toolCallId || '';
          const callEl = document.createElement('details');
          callEl.className = 'stream-tool-result';
          const summary = document.createElement('summary');
          summary.innerHTML = summaryHtml;
          callEl.appendChild(summary);
          const content = document.createElement('pre');
          content.className = 'stream-tool-result__content';
          content.textContent = (callFull && callFull !== callArgs) ? callFull : '';
          callEl.appendChild(content);
          tab.streamEl.insertBefore(callEl, tab.statusEl);
          if (callId) tab._toolResultEls.set(callId, callEl);
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

      // Claude Code streams large tool inputs (e.g. Edit's old_string/new_string)
      // incrementally: the initial tool.execution_start can carry partial/empty
      // arguments, refined here once the input finishes streaming — well before
      // the tool actually runs (see acp-client.js's tool_call_update handling).
      // Refresh the pending element's displayed args in place; the ⏳ status,
      // icon position, and expand state are untouched — this isn't a completion.
      case 'tool.execution_update': {
        const callId = event.data.toolCallId || '';
        if (event.data.toolCallId) {
          const existing = pendingToolCalls.get(callId) || {};
          pendingToolCalls.set(callId, { toolName: existing.toolName || event.data.toolName, arguments: event.data.arguments || {} });
        }
        const toolEl = callId ? tab._toolResultEls?.get(callId) : null;
        if (!toolEl) break;
        const callIcon = toolIcon(event.data.toolName) || '🔧';
        const callArgs = formatToolArgs(event.data.toolName, event.data.arguments || {});
        const callFull = toolArgFullText(event.data.arguments || {});
        const summary = toolEl.querySelector('summary');
        if (summary) {
          summary.innerHTML = `<span class="stream-tool-result__status">⏳</span> ${callIcon} <strong>${escapeHtml(toolDisplayName(event.data.toolName))}</strong> <span class="stream-tool-result__preview">${escapeHtml(callArgs)}</span>`;
        }
        const contentEl = toolEl.querySelector('.stream-tool-result__content');
        if (contentEl) contentEl.textContent = (callFull && callFull !== callArgs) ? callFull : '';
        break;
      }

      case 'tool.execution_complete': {
        tab.lastActivityAt = Date.now();
        // Detect permission denied → show info, don't kill process
        if (event.data.success === false && event.data.error && event.data.error.code === 'denied') {
          const toolInfo = pendingToolCalls.get(event.data.toolCallId) || {};
          const toolName = toolInfo.toolName || event.data.toolName || 'unbekannt';
          const toolArgs = toolInfo.arguments || {};
          // Drop the pending call element from tool.execution_start — the denial
          // line below replaces it (otherwise a ⏳ would linger).
          const pendingEl = tab._toolResultEls?.get(event.data.toolCallId);
          if (pendingEl) { pendingEl.remove(); tab._toolResultEls.delete(event.data.toolCallId); }
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
        if (!event.data) break;
        const toolName = event.data.toolName || '';
        if (toolName === 'report_intent') break;
        // MCP/unknown tools have no built-in icon → show a generic one instead of
        // hiding the result (previously all Playwright MCP results were suppressed).
        const icon = toolIcon(toolName) || '🔧';

        const success = event.data.success !== false;
        const statusIcon = success ? '✓' : '✗';
        const resultContent = event.data.result?.content || '';
        if (!tab._toolResultEls) tab._toolResultEls = new Map();
        const callId = event.data.toolCallId || '';
        // Keep the call's arguments in the collapsed line (what ran) — more
        // identifying at a glance than the result; the full result stays one
        // click away in the expandable .stream-tool-result__content. Prefer
        // the arguments carried directly on this event (acp-client.js resolves
        // these from the latest refine, not just the original tool_call) —
        // fall back to the pendingToolCalls snapshot for backends that don't
        // supply them here (Copilot, direct-API providers — neither streams
        // tool input incrementally, so their original snapshot is already complete).
        const callArgs = formatToolArgs(toolName, event.data.arguments || (pendingToolCalls.get(callId) || {}).arguments || {});
        const preview = callArgs || formatToolResultPreview(resultContent);
        const summaryHtml = `<span class="stream-tool-result__status ${success ? '' : 'stream-tool-result__status--error'}">${statusIcon}</span> ${icon} <strong>${escapeHtml(toolDisplayName(toolName))}</strong> <span class="stream-tool-result__preview">${escapeHtml(preview)}</span>`;

        // Finalize the pending element created in tool.execution_start in place
        // (ACP also emits several updates per call: pending → in_progress →
        // completed). Only fall back to creating one if the start was missed.
        let toolEl = callId ? tab._toolResultEls.get(callId) : null;
        if (toolEl) {
          toolEl.querySelector('summary').innerHTML = summaryHtml;
          if (resultContent) toolEl.querySelector('.stream-tool-result__content').textContent = resultContent;
        } else {
          toolEl = document.createElement('details');
          toolEl.className = 'stream-tool-result';
          const summary = document.createElement('summary');
          summary.innerHTML = summaryHtml;
          toolEl.appendChild(summary);
          const content = document.createElement('pre');
          content.className = 'stream-tool-result__content';
          content.textContent = resultContent;
          toolEl.appendChild(content);
          tab.streamEl.insertBefore(toolEl, tab.statusEl);
          if (callId) tab._toolResultEls.set(callId, toolEl);
        }
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
        tab.context.mcp = `${connected.length}/${servers.length}`;
        tab.context.mcpServers = servers;
        if (tabId === activeTabId) {
          mcpServers = servers;
          renderMcpServers();
          // Re-merge project MCP entries from .github/mcp.json
          if (tab.cwd) loadProjectSkillsAndAgents(tab.cwd);
        }
        tab.statusEl.textContent = '● MCP Server geladen';
        break;
      }

      case 'session.skills_loaded': {
        const skillsList = event.data.skills || [];
        tab.context.skills = skillsList.length;
        tab.context.skillsList = skillsList;
        tab.statusEl.textContent = '● Skills geladen';
        tab.statusEl.style.display = 'block';
        // Reload project skills from .github/skills/ using the tab's CWD
        if (tabId === activeTabId) {
          loadProjectSkillsAndAgents(tab.cwd);
        }
        break;
      }

      case 'copilot.models_available': {
        // The ACP backend reported which models this account can use → assign them
        // to THIS tab's provider (Copilot or Claude Code) rather than assuming
        // Copilot, so each ACP provider gets its own discovered model list.
        applyDynamicModels(getTabProvider(tab), event.data.models);
        // Adopt the backend's current model when the tab hasn't chosen one yet
        // (e.g. Claude Code, where we don't force a default) so the 🧠 button
        // shows the active model instead of being blank.
        if (!tab.selectedModel && event.data.currentModelId) {
          tab.selectedModel = event.data.currentModelId;
          updateModelSelectBtn(tabId);
        }
        break;
      }

      case 'session.modes_available': {
        // The ACP backend reported its session modes → assign them to this tab's
        // provider (Claude Code has its own permission modes).
        const provider = getTabProvider(tab);
        const mapped = (event.data.modes || [])
          .filter(m => m && m.id)
          .map(m => ({ id: m.id, short: m.name || m.id, label: m.name || m.id, desc: m.description || '' }));
        if (mapped.length) {
          _dynamicModes[provider] = mapped;
          setPref('dynamicModes', _dynamicModes); // survive restarts → dropdown filled pre-prompt
          // Adopt the backend's current mode when the tab's mode isn't valid here.
          if (!mapped.some(m => m.id === tab.mode)) {
            tab.mode = event.data.currentModeId || mapped[0].id;
          }
          updateModeSelectBtn(tabId);
        }
        break;
      }

      case 'session.usage_update': {
        // Claude Code live usage: context %, subscription rate-limit, USD cost.
        const d = event.data || {};
        // Pure-usage events report the context window (size ~200k); the cost-
        // bearing event uses a different size — use it only for cost, not context.
        if (!d.cost && d.size && d.used != null) {
          const pct = Math.min(100, Math.round((d.used / d.size) * 100));
          tab._contextPercent = pct;
          if (tabId === activeTabId) updateContextButtonPct(pct);
        }
        // Each event carries one window (5-hour or weekly …); accumulate them
        // per family so both limits can be shown together.
        if (d.rateLimit) tab._subRateLimits = mergeRateLimitWindows(tab._subRateLimits, d.rateLimit);
        if (d.cost && typeof d.cost.amount === 'number') tab._subCostUsd = d.cost.amount;
        if (tabId === activeTabId) updateSubscriptionUsageDisplay(tab);
        break;
      }

      case 'session.permission_request': {
        // The agent (Claude Code / Copilot) asks whether to run an action →
        // queue it and show the dropup above the chat input.
        enqueuePermissionRequest(tabId, event.data);
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
          if (!tab.cwd) {
            tab.cwd = cwd;
            // First time we learn this tab's project dir → load its todos.
            if (tabId === activeTabId) loadTodos(tab.cwd);
          }
        }
        break;
      }

      case 'result':
        // Store sessionId for resume
        if (event.sessionId) {
          tab.sessionId = event.sessionId;
          // The backend may report the session's real cwd (e.g. Claude Code resume
          // corrected a cwd mismatch) → adopt it so it's persisted and used going forward.
          if (event.cwd && event.cwd !== tab.cwd) {
            tab.cwd = event.cwd;
            loadTodos(tab.cwd);
          }
          // Carry a name over to the freshly-created session (folder change on a
          // named Claude Code tab replaced the old session with this new one).
          if (tab._renameOnNextSession) {
            setSessionName(event.sessionId, tab._renameOnNextSession);
            tab._sessionName = tab._renameOnNextSession;
            tab.label = '🤖 ' + tab._renameOnNextSession;
            tab._renameOnNextSession = null;
            renderTabs();
          }
          // Persist selected model for this new session
          if (tab.selectedModel) saveSessionModel(event.sessionId, tab.selectedModel);
          // Persist CWD for this session
          if (tab.cwd) saveSessionCwd(event.sessionId, tab.cwd);
          // Persist provider so a resumed session uses the right backend.
          saveSessionProvider(event.sessionId, getTabProvider(tab));
          saveOpenTabs();
          // Show todos panel (project-scoped by cwd) for this session
          if (!activeSessionId) {
            activeSessionId = event.sessionId;
            loadTodos(tab.cwd);
          }
        }
        break;

      case 'session.restore_failed': {
        const el = document.createElement('div');
        el.className = 'stream-unlock-info';
        el.textContent = 'ℹ️ Frühere Session konnte nicht wiederhergestellt werden — eine neue Session wurde gestartet.';
        tab.streamEl.insertBefore(el, tab.statusEl);
        scrollToBottom(tab.streamEl);
        break;
      }

      case 'error': {
        appendStreamError(tab, event.data.message);
        break;
      }
    }
  });

  copilot.chat.onDone((tabId, code) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    stopInactivityMonitor(tabId);
    tab.isProcessing = false;
    // Flush any pending throttled markdown render so the final streamed
    // chunks aren't lost when the response element is cleared below.
    if (tab._mdTimer) { clearTimeout(tab._mdTimer); tab._mdTimer = null; }
    if (tab._responseEl && tab._responseRaw) {
      tab._responseEl.innerHTML = window.markdown.render(tab._responseRaw);
    }
    tab._responseEl = null;
    tab._responseRaw = '';
    tab._thinkingEl = null;
    tab._thinkingDetails = null;
    tab.statusEl.style.display = 'none';

    if (code === -1) {
      // Cancelled by user — keep partial output, show an "aborted" indicator.
      const el = document.createElement('div');
      el.className = 'stream-unlock-info';
      el.textContent = '⏹ Antwort abgebrochen';
      tab.streamEl.insertBefore(el, tab.statusEl);
      setTabStatus(tabId, 'done');
    } else if (code !== 0) {
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

    if (code === 0) {
      // Run /usage first, then /context — the backend handles only one silent
      // command at a time ("Cannot run command while busy" otherwise). Refresh
      // runs for background tabs too so cost tracking stays accurate.
      if (isSubscriptionProvider(getTabProvider(tab))) {
        // Subscription (Claude Code): no per-token billing, and the context %
        // arrives live via usage_update. The rate-limit *percentage*, however,
        // is NOT in the live stream — fetch it from /usage.
        refreshSubscriptionUsage(tabId);
      } else {
        refreshUsageDisplay(tabId).finally(() => {
          // /context is free for all providers. Direct-API tabs additionally
          // auto-compact when high; ACP backends (Copilot) manage their own.
          if (isAcpProvider(getTabProvider(tab))) {
            refreshContextDisplay(tabId);
          } else {
            refreshApiContext(tabId);
          }
        });
      }
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
// `tier`: 'aic' = über Copilot-Abo/AI Credits abgerechnet, 'free' = im
// kostenlosen Kontingent des Providers nutzbar, 'paid' = direkt kostenpflichtig.
const DEFAULT_MODELS = [
  // Copilot CLI (provider: 'copilot')
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5', provider: 'copilot', tier: 'aic' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', provider: 'copilot', tier: 'aic' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', short: 'Opus 4.6', provider: 'copilot', tier: 'aic' },
  { id: 'claude-opus-4.8', label: 'Claude Opus 4.8', short: 'Opus 4.8', provider: 'copilot', tier: 'aic' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', short: 'GPT-5.3', provider: 'copilot', tier: 'aic' },
  // Claude Code (provider: 'claude-code') — billed via the Claude subscription
  // (CLI login, no API key). The adapter uses ALIASES (default/sonnet/opus/haiku),
  // not full model ids; the real list is discovered via ACP and replaces these.
  { id: 'default', label: 'Default (Sonnet 5)', short: 'Sonnet 5', provider: 'claude-code', tier: 'sub' },
  { id: 'sonnet', label: 'Sonnet 5', short: 'Sonnet 5', provider: 'claude-code', tier: 'sub' },
  { id: 'opus', label: 'Opus 4.8', short: 'Opus 4.8', provider: 'claude-code', tier: 'sub' },
  { id: 'haiku', label: 'Haiku 4.5', short: 'Haiku 4.5', provider: 'claude-code', tier: 'sub' },
  // Anthropic API (provider: 'anthropic') — benötigt API-Key in den Einstellungen
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5', provider: 'anthropic', tier: 'paid' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', provider: 'anthropic', tier: 'paid' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', short: 'Opus 4.8', provider: 'anthropic', tier: 'paid' },
  // Google Gemini API (provider: 'gemini') — benötigt API-Key in den Einstellungen
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', short: 'Gemini Pro', provider: 'gemini', tier: 'paid' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', short: 'Gemini Flash', provider: 'gemini', tier: 'free' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', short: 'Gemini 3.5 Flash', provider: 'gemini', tier: 'paid' },
  // OpenAI API (provider: 'openai') — benötigt API-Key
  { id: 'gpt-5.1', label: 'GPT-5.1', short: 'GPT-5.1', provider: 'openai', tier: 'paid' },
  { id: 'gpt-5.1-mini', label: 'GPT-5.1 mini', short: 'GPT-5.1 mini', provider: 'openai', tier: 'paid' },
  { id: 'gpt-4.1', label: 'GPT-4.1', short: 'GPT-4.1', provider: 'openai', tier: 'paid' },
  // GLM / Zhipu (provider: 'glm') — benötigt API-Key
  { id: 'glm-4.6', label: 'GLM-4.6', short: 'GLM-4.6', provider: 'glm', tier: 'paid' },
  { id: 'glm-4.5', label: 'GLM-4.5', short: 'GLM-4.5', provider: 'glm', tier: 'paid' },
  { id: 'glm-4.5-air', label: 'GLM-4.5 Air', short: 'GLM-4.5 Air', provider: 'glm', tier: 'paid' },
  // Ollama (provider: 'ollama') — lokal, kein Key, kostenlos
  { id: 'llama3.1', label: 'Llama 3.1 (Ollama)', short: 'Llama 3.1', provider: 'ollama', tier: 'free' },
  { id: 'qwen2.5-coder', label: 'Qwen2.5 Coder (Ollama)', short: 'Qwen2.5 Coder', provider: 'ollama', tier: 'free' },
  { id: 'gpt-oss:20b', label: 'gpt-oss 20B (Ollama)', short: 'gpt-oss 20B', provider: 'ollama', tier: 'free' },
];

// Badge-Markup für die Modell-Kennzeichnung (kostenpflichtig / kostenlos / AIC).
const MODEL_TIER_BADGE = {
  paid: '<span class="model-tier model-tier--paid" data-tooltip="Direkt kostenpflichtig (Abrechnung pro Token beim Provider)">💲 kostenpflichtig</span>',
  free: '<span class="model-tier model-tier--free" data-tooltip="Im kostenlosen Kontingent des Providers nutzbar">🆓 kostenlos</span>',
  aic: '<span class="model-tier model-tier--aic" data-tooltip="Abrechnung über dein GitHub-Copilot-Abo / AI Credits">AIC</span>',
  sub: '<span class="model-tier model-tier--aic" data-tooltip="Über dein Claude-Abo abgerechnet (kein Token-Preis)">Abo</span>',
};
function modelTierBadge(model) {
  return model && model.tier ? (MODEL_TIER_BADGE[model.tier] || '') : '';
}

const PROVIDER_LABELS = {
  copilot: 'GitHub Copilot',
  'claude-code': 'Claude Code',
  anthropic: 'Anthropic API',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama (lokal)',
  glm: 'GLM (Zhipu)',
};

// Shorter labels for the settings dialog's tab bar specifically — up to one
// per connected provider, so keeping these tight matters more there than in
// the model dropdown/provider list (which use the full PROVIDER_LABELS).
const SETTINGS_TAB_LABELS = {
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  glm: 'GLM',
};

const PROVIDER_ICON = '🔌';

// Maturity markers per provider. Beta = tested but not final; Alpha = untested.
// Copilot is the primary, fully-tested provider and carries no badge.
const BETA_PROVIDERS = new Set(['gemini']);
const ALPHA_PROVIDERS = new Set(['anthropic', 'openai', 'glm', 'ollama']);

/** Maturity badge (Alpha/Beta) HTML for a provider, or '' for none. */
function providerStageBadge(provider) {
  if (BETA_PROVIDERS.has(provider)) {
    return ' <span class="beta-badge" title="Getestet nicht final">Beta</span>';
  }
  if (ALPHA_PROVIDERS.has(provider)) {
    return ' <span class="alpha-badge" title="Nicht getestet">Alpha</span>';
  }
  return '';
}

/** Providers that have selectable models (in display order). */
function getProvidersWithModels() {
  const seen = [];
  for (const m of DEFAULT_MODELS) {
    const p = m.provider || 'copilot';
    if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

/** The configured default provider for new tabs (falls back to copilot). */
function getDefaultProvider() {
  const p = getSettings().defaultProvider;
  return getProvidersWithModels().includes(p) ? p : 'copilot';
}

// Sensible out-of-box default model per provider (used when the user hasn't
// chosen one in settings). Copilot intentionally defaults to Sonnet, NOT the
// first list entry (Haiku) — see DEFAULT_MODEL_ID.
const PROVIDER_DEFAULT_MODEL = {
  copilot: DEFAULT_MODEL_ID,        // claude-sonnet-4.6
  'claude-code': 'claude-sonnet-5', // refined once ACP reports the real models
  anthropic: 'claude-opus-4-8',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5.1',
  glm: 'glm-4.6',
  ollama: 'llama3.1',
};

/**
 * Default model for a provider: the user-configured choice if valid, else a
 * sensible per-provider default, else the first model of that provider. Used by
 * the "+" menu and new-tab creation.
 */
function getDefaultModelForProvider(provider) {
  // Validate against the provider's ACTUAL model list (incl. dynamically
  // discovered Copilot/API models), not just the hardcoded DEFAULT_MODELS —
  // otherwise a configured default that is a discovered model is wrongly rejected.
  const valid = (id) => id && getModelsForProvider(provider).some(m => m.id === id);
  const configured = (getSettings().defaultModels || {})[provider];
  if (valid(configured)) return configured;
  // Claude Code: don't force a model — let the ACP adapter use its own default
  // (the subscription default) unless the user explicitly configured one. Forcing
  // an id we're unsure about would make the adapter reject the prompt.
  if (provider === 'claude-code') return '';
  if (valid(PROVIDER_DEFAULT_MODEL[provider])) return PROVIDER_DEFAULT_MODEL[provider];
  const m = DEFAULT_MODELS.find(x => (x.provider || 'copilot') === provider);
  if (m) return m.id;
  // No known model for this provider yet (e.g. Claude Code before ACP discovery).
  // Return '' so the backend uses its own default instead of a foreign model id
  // (forcing a Copilot id like claude-sonnet-4.6 makes Claude Code reject it).
  return '';
}

/** Persist the default model for one provider. */
function saveDefaultModelForProvider(provider, modelId) {
  const map = { ...(getSettings().defaultModels || {}) };
  map[provider] = modelId;
  saveSetting('defaultModels', map);
}

/**
 * The mode a provider was last set to, remembered across restarts. Validated
 * against the provider's known modes (an ACP provider whose modes aren't
 * discovered yet trusts the saved id — modes_available corrects an invalid one).
 * @param {string} provider
 * @returns {string|null}
 */
function getSavedModeForProvider(provider) {
  const saved = (getPref('lastModes', {}) || {})[provider];
  return pickSavedMode(saved, getModesForProvider(provider));
}

/** Remember the mode a provider was last set to (persisted to preferences). */
function saveModeForProvider(provider, modeId) {
  const map = { ...(getPref('lastModes', {}) || {}) };
  map[provider] = modeId;
  setPref('lastModes', map);
}

const MODEL_TIER_TEXT = { paid: ' (kostenpflichtig)', free: ' (kostenlos)', aic: ' (AIC)', sub: ' (Abo)' };

/** Render the global "default provider" (which provider new tabs/"+" start with) select. */
function renderDefaultModelSettings() {
  const provSel = document.getElementById('settDefaultProvider');
  if (!provSel) return;
  const providers = getProvidersWithModels();
  provSel.innerHTML = providers
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(PROVIDER_SHORT[p] || p)}</option>`)
    .join('');
  provSel.value = getDefaultProvider();
}

/**
 * Fills one provider's "default model" <select> (used both by Copilot's static
 * settings tab and by each dynamically-generated provider-config tab, so the
 * per-provider default model setting lives in that provider's own tab instead
 * of one long combined list).
 * @param {string} provider
 * @param {HTMLSelectElement} sel
 */
function renderProviderModelSelect(provider, sel) {
  if (!sel) return;
  sel.innerHTML = getModelsForProvider(provider)
    .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${MODEL_TIER_TEXT[m.tier] || ''}</option>`)
    .join('');
  sel.value = getDefaultModelForProvider(provider);
  sel.addEventListener('change', () => saveDefaultModelForProvider(provider, sel.value));
}

/**
 * Dynamically discovered models per provider. Copilot models arrive via ACP; the
 * direct-API providers are polled via providers:listModels. When a provider has
 * an entry here it replaces that provider's hardcoded list, so the dropdown
 * reflects the account's actually-available models.
 * @type {Object<string, Array<{id:string,label:string,short:string,provider:string,tier:string}>>}
 */
const _dynamicModels = {};

/** Default cost tier for freshly-discovered models, by provider. */
const PROVIDER_DEFAULT_TIER = {
  copilot: 'aic', 'claude-code': 'sub', ollama: 'free', anthropic: 'paid', openai: 'paid', gemini: 'paid', glm: 'paid',
};

/**
 * Merge a freshly discovered model list for a provider: normalize to the internal
 * shape, announce models we've never seen before, persist, and refresh the UI.
 * @param {string} provider
 * @param {Array<{id:string,name?:string}>} models - raw {id,name} pairs
 */
function applyDynamicModels(provider, models) {
  if (!Array.isArray(models) || !models.length) return;
  const tier = PROVIDER_DEFAULT_TIER[provider] || 'paid';
  const mapped = models
    .filter(m => m && m.id)
    .map(m => ({ id: m.id, label: m.name || m.id, short: m.name || m.id, provider, tier }));
  if (!mapped.length) return;

  // "New" = neither in the hardcoded list nor in the previously-known dynamic
  // list. The very first discovery for a provider is treated as initial
  // population (no notification); only genuinely new arrivals later are announced.
  const hadPrevious = Array.isArray(_dynamicModels[provider]) && _dynamicModels[provider].length > 0;
  const known = new Set([
    ...DEFAULT_MODELS.filter(m => (m.provider || 'copilot') === provider).map(m => m.id),
    ...((_dynamicModels[provider] || []).map(m => m.id)),
  ]);
  const fresh = mapped.filter(m => !known.has(m.id));

  _dynamicModels[provider] = mapped;
  setPref('dynamicModels', _dynamicModels);

  if (hadPrevious && fresh.length) {
    const names = fresh.map(m => m.short).slice(0, 4).join(', ');
    const more = fresh.length > 4 ? ` +${fresh.length - 4}` : '';
    showNotification(`🆕 Neues Modell bei ${PROVIDER_SHORT[provider] || provider}: ${names}${more}`, 'info');
  }

  updateModelSelectBtn(activeTabId);
  if (document.getElementById('settDefaultProvider')) renderDefaultModelSettings();
}

/** Merge the CLI-reported Copilot models into the selectable list (via ACP). */
function updateCopilotModels(models) {
  applyDynamicModels('copilot', models);
}

/** Load persisted dynamic models (incl. the legacy Copilot-only list) at startup. */
function initCopilotModels() {
  const stored = getPref('dynamicModels', null);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [prov, list] of Object.entries(stored)) {
      if (Array.isArray(list) && list.length) _dynamicModels[prov] = list;
    }
  }
  // Back-compat: older builds stored only the Copilot list under 'copilotModels'.
  if (!_dynamicModels.copilot) {
    const legacy = getPref('copilotModels', null);
    if (Array.isArray(legacy) && legacy.length) _dynamicModels.copilot = legacy;
  }
  // Restore discovered session modes per provider so the mode dropdown has content
  // before the first prompt (e.g. Claude Code's modes after a restart).
  const storedModes = getPref('dynamicModes', null);
  if (storedModes && typeof storedModes === 'object' && !Array.isArray(storedModes)) {
    for (const [prov, list] of Object.entries(storedModes)) {
      if (Array.isArray(list) && list.length) _dynamicModes[prov] = list;
    }
  }
}

/**
 * Fetch a direct-API provider's current models and merge them in. Best-effort:
 * failures (no key, offline, unsupported endpoint) leave the hardcoded list intact.
 * @param {string} provider
 */
async function refreshProviderModels(provider) {
  if (provider === 'copilot') return; // Copilot models arrive via ACP, not here.
  try {
    const res = await copilot.providers.listModels(provider);
    if (res && res.ok && Array.isArray(res.models) && res.models.length) {
      applyDynamicModels(provider, res.models);
    }
  } catch (_) { /* discovery is best-effort */ }
}

/** Discover models for every direct-API provider that has a key (or is keyless). */
async function refreshAllProviderModels() {
  const KEYLESS = new Set(['ollama']);
  let status = null;
  try { status = await copilot.providers.status(); } catch (_) { /* ignore */ }
  const keyed = (status && status.keyed) || {};
  for (const p of ['anthropic', 'gemini', 'openai', 'glm', 'ollama']) {
    if (KEYLESS.has(p) || keyed[p]) refreshProviderModels(p);
  }
}

/**
 * Whether a Copilot model is currently offered by the CLI. Permissive when we
 * have no dynamic list yet (the static fallback list is in use).
 * @param {string} modelId
 */
function isCopilotModelAvailable(modelId) {
  const list = _dynamicModels.copilot;
  if (!list || !list.length) return true;
  return list.some(m => m.id === modelId);
}

/** Models belonging to a given provider (the dynamic list wins when known). */
function getModelsForProvider(provider) {
  const dyn = _dynamicModels[provider];
  if (dyn && dyn.length) return dyn;
  return DEFAULT_MODELS.filter(m => (m.provider || 'copilot') === provider);
}

/**
 * The provider of a tab, always derived from its selected model (the model is
 * the single source of truth; the provider is implied by it).
 */
function getTabProvider(tab) {
  // The tab's explicit ProviderID is authoritative; fall back to deriving it from
  // the model only for legacy tabs that predate the provider field.
  return tab?.provider
    || window.RendererLogic.getModelProvider(tab?.selectedModel || '')
    || 'copilot';
}

const PROVIDER_SHORT = { copilot: 'Copilot', 'claude-code': 'Claude Code', anthropic: 'Anthropic', gemini: 'Gemini', openai: 'OpenAI', ollama: 'Ollama', glm: 'GLM' };

/** Inline brand-icon HTML for a provider (via provider-icons.js). */
function providerIconHtml(provider, cls) {
  return window.ProviderIcons ? window.ProviderIcons.iconSvg(provider, cls) : '';
}

/** ACP-based backends (CLI/adapter over stdio), as opposed to direct-API providers. */
function isAcpProvider(provider) {
  return provider === 'copilot' || provider === 'claude-code';
}

/** Whether a provider is billed via a subscription (no per-token USD cost). */
function isSubscriptionProvider(provider) {
  return provider === 'claude-code';
}

// Which app features each provider actually supports. This is the single source
// of truth: the sidebar hides unsupported skills/agents/MCP sections and the tab
// rename button while a tab of that provider is active, and the settings
// "Features" panel renders the same data as a comparison matrix.
// (Claude Code and the direct-API providers use the app's own lazy-loaded
// per-provider Skills/Agents (see LAZY_CONTEXT_PROVIDERS in main.js) — Gemini
// is deliberately excluded to keep it context-light. MCP and Marketplace stay
// Copilot-only; the Copilot CLI supports the full feature set. Instructions
// covers two different underlying mechanisms, both editable in-app: Copilot
// and Claude Code each get a single native global file (copilot-instructions.md
// / CLAUDE.md, an editor convenience in their own settings tab — the CLI
// itself discovers these, we don't inject anything); the direct-API providers
// instead get multiple toggle-free `*.instructions.md` files under their own
// ~/.agent-desktop/<provider>/instructions/ (see INSTRUCTIONS_PROVIDERS in
// main.js), always fully inlined, no sidebar section. Only Gemini has neither.
// denylist marks which providers get a per-provider "Verbotene Shell-Tools"
// list in their own settings tab — only providers with an own shell tool we
// enforce this against: Gemini has no shell tool at all (file tools only),
// Claude Code has its own approval mechanism and is unaffected by our deny
// lists.)
const PROVIDER_CAPABILITIES = {
  copilot:       { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: true,  sessions: true,  marketplace: true,  denylist: true },
  'claude-code': { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: true,  marketplace: false, denylist: false },
  anthropic:     { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  openai:        { models: true, modes: false, tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  gemini:        { models: true, modes: false, tools: true, context: true, costs: true,  skills: false, agents: false, instructions: false, mcp: false, sessions: true,  marketplace: false, denylist: false },
  glm:           { models: true, modes: false, tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  ollama:        { models: true, modes: false, tools: true, context: true, costs: false, skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
};

// Feature metadata for the settings comparison matrix (label + icon + hint).
const PROVIDER_FEATURE_META = [
  { key: 'models',       icon: '🧠', label: 'Modellauswahl', hint: 'Zwischen mehreren Modellen des Providers wählen.' },
  { key: 'modes',        icon: '⚙️', label: 'Modi',          hint: 'Betriebs-/Denkmodi (z.B. Reasoning, Agent-Modi).' },
  { key: 'tools',        icon: '🔧', label: 'Toolverwendung', hint: 'Ausführung von Tools/Funktionen (Dateien, Shell …).' },
  { key: 'context',      icon: '📏', label: 'Kontext',        hint: 'Kontextauslastung wird angezeigt/verwaltet.' },
  { key: 'costs',        icon: '💰', label: 'Kosten',         hint: 'Kosten-/Token-Tracking verfügbar.' },
  { key: 'skills',       icon: '🧩', label: 'Skills',         hint: 'SKILL.md-basierte KI-Skills.' },
  { key: 'agents',       icon: '🤖', label: 'Agents',         hint: 'Wiederverwendbare Agent-Definitionen.' },
  { key: 'instructions', icon: '📋', label: 'Instructions',  hint: 'Bearbeitbare Instructions-Datei(en) für das Modell (nativ bei Copilot/Claude Code, mehrere togglebare Sets bei Direkt-API-Providern).' },
  { key: 'mcp',          icon: '🔌', label: 'MCP',            hint: 'Model-Context-Protocol-Server.' },
  { key: 'sessions',     icon: '💾', label: 'Sessions speichern', hint: 'Gesprächsverlauf persistent speichern/fortsetzen.' },
  { key: 'marketplace',  icon: '🛒', label: 'Marketplace',    hint: 'Erweiterungen/Extensions aus dem Marketplace.' },
  { key: 'denylist',     icon: '🚫', label: 'Tool-Verbote',   hint: 'Eigene Liste blockierter Shell-Befehle pro Provider.' },
];

// Providers shown as columns in the feature matrix (order matters).
const PROVIDER_MATRIX_ORDER = ['copilot', 'claude-code', 'anthropic', 'openai', 'gemini', 'glm', 'ollama'];

/** Whether a provider supports a given app feature (default true if unknown). */
function providerSupports(provider, feature) {
  const caps = PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.copilot;
  return caps[feature] !== false;
}

/** Render the provider feature comparison matrix into the settings panel. */
function renderFeatureMatrix() {
  const container = document.getElementById('featuresMatrix');
  if (!container) return;
  const providers = PROVIDER_MATRIX_ORDER.filter((p) => PROVIDER_CAPABILITIES[p]);
  const head = providers.map((p) =>
    `<th class="feature-matrix__provider" data-tooltip="${escapeAttr(PROVIDER_SHORT[p] || p)}">` +
      `<span class="feature-matrix__provider-icon">${providerIconHtml(p)}</span>` +
      `<span class="feature-matrix__provider-name">${escapeHtml(PROVIDER_SHORT[p] || p)}</span>` +
    '</th>').join('');
  const rows = PROVIDER_FEATURE_META.map((f) => {
    const cells = providers.map((p) => {
      const ok = providerSupports(p, f.key);
      return `<td class="feature-matrix__cell feature-matrix__cell--${ok ? 'yes' : 'no'}" data-tooltip="${escapeAttr((PROVIDER_SHORT[p] || p) + ': ' + f.label + (ok ? ' ✓' : ' — noch nicht'))}">${ok ? '✓' : '—'}</td>`;
    }).join('');
    return `<tr><th class="feature-matrix__feature" data-tooltip="${escapeAttr(f.hint)}"><span class="feature-matrix__feature-icon">${f.icon}</span>${escapeHtml(f.label)}</th>${cells}</tr>`;
  }).join('');
  container.innerHTML =
    '<table class="feature-matrix">' +
      `<thead><tr><th class="feature-matrix__corner">Feature</th>${head}</tr></thead>` +
      `<tbody>${rows}</tbody>` +
    '</table>';
}

/** Show/hide sidebar sections based on the active provider's capabilities. */
function updateSidebarForProvider(provider) {
  // Sessions stay visible for every provider (needed to resume other providers'
  // sessions); session *saving* is gated separately on the tab rename button.
  const sections = { skills: 'skillsSection', agents: 'agentsSection', mcp: 'mcpSection' };
  for (const [feature, id] of Object.entries(sections)) {
    const el = document.getElementById(id);
    if (el) el.style.display = providerSupports(provider, feature) ? '' : 'none';
  }
}

/** Update the read-only provider label (shown next to the cost) for a tab. */
function updateProviderSelectBtn(tabId) {
  const el = document.getElementById('sessionProvider');
  if (!el) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const provider = getTabProvider(tab);
  el.innerHTML = `${providerIconHtml(provider)} ${escapeHtml(PROVIDER_SHORT[provider] || provider)}${providerStageBadge(provider)}`;
  // Subtle accent for non-default (direct-API) providers.
  el.classList.toggle('session-actions__provider--api', provider !== 'copilot');
  updateGeminiModeBtn(tabId);
}

const GEMINI_MODE_LABELS = {
  search: '🔍 Recherche',
  files: '📁 Dateien',
};

/**
 * Show/refresh the Gemini tool-mode toggle. Only visible for Gemini tabs, since
 * Gemini 2.5 cannot use live search and file tools in the same request.
 */
function updateGeminiModeBtn(tabId) {
  const wrapper = document.getElementById('geminiModeWrapper');
  const btn = document.getElementById('btnGeminiMode');
  if (!wrapper || !btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const isGemini = tab && getTabProvider(tab) === 'gemini';
  wrapper.style.display = isGemini ? '' : 'none';
  if (!isGemini) return;
  const mode = tab.geminiMode || 'search';
  btn.textContent = GEMINI_MODE_LABELS[mode] || GEMINI_MODE_LABELS.search;
}

/** Wire the Gemini mode toggle (switches the active tab between search/files). */
function initGeminiModeToggle() {
  const btn = document.getElementById('btnGeminiMode');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const tab = tabs.get(activeTabId);
    if (!tab || getTabProvider(tab) !== 'gemini') return;
    tab.geminiMode = (tab.geminiMode || 'search') === 'search' ? 'files' : 'search';
    updateGeminiModeBtn(activeTabId);
    const label = tab.geminiMode === 'search'
      ? 'Gemini: Live-Suche aktiv (Datei-Tools aus).'
      : 'Gemini: Datei-Tools aktiv (Live-Suche aus).';
    showNotification(label, 'info');
  });
}

/** @type {{available: boolean, keyed: Object<string,boolean>}} Cached provider key status. */
let _providerStatus = { available: false, keyed: {} };

async function refreshProviderStatus() {
  try {
    _providerStatus = await window.copilot.providers.status();
  } catch (e) {
    console.warn('[providers] status fehlgeschlagen:', e?.message);
  }
}

function getAvailableModels() {
  return DEFAULT_MODELS;
}

// ── Session Modes (Agent / Plan / Autopilot) ──────────────────
const DEFAULT_MODE_ID = 'agent';
const SESSION_MODES = [
  { id: 'agent', label: 'Agent', short: '🤖 Agent', desc: 'Standard — dialogorientiert' },
  { id: 'plan', label: 'Plan', short: '📋 Plan', desc: 'Plant mehrstufige Aufgaben' },
  { id: 'autopilot', label: 'Autopilot', short: '🚀 Autopilot', desc: 'Autonom bis Task-Abschluss (experimentell)' },
];

// Session modes discovered per provider via ACP (Claude Code reports its own
// permission modes: default/acceptEdits/plan/bypassPermissions/…).
const _dynamicModes = {};

/** Modes selectable for a provider (discovered list wins; Copilot has a static one). */
function getModesForProvider(provider) {
  const dyn = _dynamicModes[provider];
  if (dyn && dyn.length) return dyn;
  return provider === 'copilot' ? SESSION_MODES : [];
}

/**
 * Update the tab-header mode select button to reflect the active tab's mode.
 * @param {string} [tabId]
 */
function updateModeSelectBtn(tabId) {
  const btn = document.getElementById('btnModeSelect');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const modes = getModesForProvider(tab ? getTabProvider(tab) : 'copilot');
  const modeId = tab?.mode || DEFAULT_MODE_ID;
  const found = modes.find(m => m.id === modeId);
  btn.textContent = found ? found.short : '🤖 Agent';
  // Highlight when not on the provider's first/default mode.
  btn.classList.toggle('session-actions__btn--active', !!found && modes[0] && found.id !== modes[0].id);
}

/**
 * The default model new tabs start with: the default model of the configured
 * default provider. Falls back to legacy `defaultModel` / DEFAULT_MODEL_ID.
 * @returns {string}
 */
function getDefaultModelId() {
  // Per-provider default of the configured default provider (#2 + #3).
  const byProvider = getDefaultModelForProvider(getDefaultProvider());
  if (byProvider) return byProvider;
  // Legacy single-default fallback.
  const configured = getSettings().defaultModel;
  return DEFAULT_MODELS.some(m => m.id === configured) ? configured : DEFAULT_MODEL_ID;
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
  const found = DEFAULT_MODELS.find(m => m.id === modelId)
    || Object.values(_dynamicModels).flat().find(m => m.id === modelId);
  btn.textContent = `🧠 ${found ? found.short : modelId}`;
  btn.classList.remove('session-actions__btn--active');
  updateProviderSelectBtn(tabId);
  updateApprovalBtn(tabId);
  updateProviderSpecificControls(tabId);
}

/**
 * Hide the session tools deny-list for Claude Code (it governs permissions via
 * its mode/permission prompts, not --deny-tool). The mode dropdown IS shown for
 * Claude Code — it carries the provider's own discovered modes.
 * @param {string} [tabId]
 */
function updateProviderSpecificControls(tabId) {
  const tab = tabs.get(tabId ?? activeTabId);
  const provider = tab ? getTabProvider(tab) : 'copilot';
  const isClaudeCode = provider === 'claude-code';
  const toolsWrap = document.getElementById('btnSessionTools')?.closest('.tools-popup-wrapper');
  if (toolsWrap) toolsWrap.style.display = isClaudeCode ? 'none' : '';
  // Hide sidebar sections the active provider doesn't support (skills/agents/MCP/sessions).
  updateSidebarForProvider(provider);
}

/**
 * Reflect the active tab's manual-approval state on the toggle button.
 * @param {string} [tabId]
 */
function updateApprovalBtn(tabId) {
  const btn = document.getElementById('btnApprovalToggle');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  // Only Copilot uses this app-side toggle. Claude Code has its own native
  // permission modes (default/acceptEdits/plan/bypassPermissions, selectable via
  // the mode button) which would otherwise fight with this blanket override.
  const wrapper = btn.closest('.model-select-wrapper') || btn;
  if (!tab || getTabProvider(tab) !== 'copilot') { wrapper.style.display = 'none'; return; }
  wrapper.style.display = '';
  const manual = tab?.manualApproval === true;
  btn.textContent = manual ? '🔒 Bestätigen' : '🔓 Auto';
  btn.classList.toggle('session-actions__btn--active', manual);
  btn.setAttribute('data-tooltip', manual
    ? 'Aktionen werden einzeln bestätigt (Dropup). Klick: alles erlauben'
    : 'Alles erlauben — keine Rückfragen. Klick: Bestätigen aktivieren');
}

/** Flip the active tab's manual-approval mode and apply it to the backend. */
async function toggleApproval(tabId) {
  const id = tabId ?? activeTabId;
  const tab = tabs.get(id);
  if (!tab) return;
  tab.manualApproval = !tab.manualApproval;
  if (tab.sessionId) saveSessionApproval(tab.sessionId, tab.manualApproval);
  updateApprovalBtn(id);
  if (tab.sessionId) {
    // Copilot restarts transparently (spawn flag); Claude Code applies live.
    try { await copilot.chat.setApproval(id, tab.manualApproval); } catch (_) { /* ignore */ }
  }
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

    const openedForTabId = activeTabId;
    const tab = tabs.get(openedForTabId);
    const currentModel = tab?.selectedModel || '';
    // Only show models for the tab's currently selected provider.
    const models = getModelsForProvider(getTabProvider(tab));

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below';

    models.forEach(m => {
      const isActive = currentModel === m.id;
      const item = document.createElement('div');
      item.className = 'model-dropdown__item' + (isActive ? ' model-dropdown__item--active' : '');
      item.innerHTML = `<span class="model-dropdown__label">${escapeHtml(m.label)}</span>${modelTierBadge(m)}`;
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

/**
 * Initialize the tab-specific mode selector (Agent / Plan / Autopilot).
 * Sets tab.mode, which is sent to the ACP process via session/set_mode on the
 * next sendMessage() call.
 */
function initTabModeSelector() {
  document.getElementById('btnApprovalToggle')?.addEventListener('click', () => toggleApproval(activeTabId));

  const btn = document.getElementById('btnModeSelect');
  if (!btn) return;

  let activeCloseHandler = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.mode-dropdown');
    if (existing) {
      existing.remove();
      if (activeCloseHandler) {
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
      return;
    }

    const openedForTabId = activeTabId;
    const tab = tabs.get(openedForTabId);
    const currentMode = tab?.mode || DEFAULT_MODE_ID;
    const modes = getModesForProvider(getTabProvider(tab));

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below mode-dropdown';

    modes.forEach(m => {
      const isActive = currentMode === m.id;
      const item = document.createElement('div');
      item.className = 'model-dropdown__item' + (isActive ? ' model-dropdown__item--active' : '');
      item.innerHTML = `<span class="model-dropdown__label">${escapeHtml(m.short)}</span><span class="model-dropdown__desc">${escapeHtml(m.desc)}</span>`;
      item.addEventListener('click', () => {
        dropdown.remove();
        if (activeCloseHandler) {
          document.removeEventListener('click', activeCloseHandler, true);
          activeCloseHandler = null;
        }
        const t = tabs.get(openedForTabId);
        if (!t) return;
        t.mode = m.id;
        saveModeForProvider(getTabProvider(t), m.id); // remember per provider across restarts
        updateModeSelectBtn(openedForTabId);
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

// ── Context Info ───────────────────────────────────────────

/**
 * Initialize the context info button — queries /context silently and shows
 * the result in a popup overlay.
 */
const CONTEXT_ACTIONS = [
  { id: 'show',    label: '📊 Kontext anzeigen',   desc: 'Token-Auslastung im Detail' },
  { id: 'compact', label: '📦 Compact',            desc: 'Konversation zusammenfassen, Kontext freigeben' },
  { id: 'clear',   label: '🗑️ Clear',              desc: 'Konversation löschen, Kontext zurücksetzen' },
];

function parseContextPercent(text) {
  const m = text.match(/(\d+)%\)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Set the context button to a given percentage (null → default label). */
function updateContextButtonPct(pct) {
  const btn = document.getElementById('btnContextInfo');
  if (!btn) return;
  btn.textContent = pct != null ? `📊 ${pct}%` : '📊 Kontext';
}

/**
 * Store a tab's context-% (parsed from a /context response) and, if the tab is
 * active, reflect it in the button. Persisting per tab keeps the button correct
 * across tab switches.
 * @param {number} tabId
 * @param {string} text - Raw /context response.
 */
function setTabContext(tabId, text) {
  const tab = tabs.get(tabId);
  const pct = parseContextPercent(text);
  if (tab) tab._contextPercent = pct;
  if (tabId === activeTabId) updateContextButtonPct(pct);
}

/** Manual/active-tab convenience wrapper. */
function updateContextButton(text) {
  setTabContext(activeTabId, text);
}

async function runContextAction(actionId) {
  const btn = document.getElementById('btnContextInfo');
  const tab = tabs.get(activeTabId);
  if (!tab || tab.isProcessing) return;

  btn.classList.add('session-actions__btn--loading');
  const origText = btn.textContent;
  btn.textContent = '⏳ …';

  try {
    if (actionId === 'show') {
      const result = await window.copilot.chat.silentCommand(activeTabId, '/context');
      if (result.success) {
        updateContextButton(result.text);
        showContextPanel(result.text);
      }
    } else if (actionId === 'compact') {
      const result = await window.copilot.chat.silentCommand(activeTabId, '/compact');
      // /compact response may contain context info; also query explicitly
      const ctx = await window.copilot.chat.silentCommand(activeTabId, '/context');
      if (ctx.success) updateContextButton(ctx.text);
    } else if (actionId === 'clear') {
      await window.copilot.chat.silentCommand(activeTabId, '/clear');
      const ctx = await window.copilot.chat.silentCommand(activeTabId, '/context');
      if (ctx.success) updateContextButton(ctx.text);
    }
  } catch (err) {
    console.warn('[context]', err.message);
  } finally {
    btn.classList.remove('session-actions__btn--loading');
    // If button text wasn't updated by updateContextButton, restore it
    if (btn.textContent === '⏳ …') btn.textContent = origText;
  }
}

function showContextPanel(text) {
  let panel = document.getElementById('contextPanel');
  if (panel) panel.remove();

  const btn = document.getElementById('btnContextInfo');
  panel = document.createElement('div');
  panel.id = 'contextPanel';
  panel.className = 'context-panel';
  panel.innerHTML = `
    <div class="context-panel__header">
      <span>Kontext-Auslastung</span>
      <button class="context-panel__close" title="Schließen">✕</button>
    </div>
    <pre class="context-panel__body"></pre>
  `;
  panel.querySelector('.context-panel__body').textContent = text;
  panel.querySelector('.context-panel__close').addEventListener('click', () => panel.remove());

  btn.closest('.model-select-wrapper').appendChild(panel);

  const closeOnClick = (e) => {
    if (!panel.contains(e.target) && e.target !== btn) {
      panel.remove();
      document.removeEventListener('click', closeOnClick, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnClick, true), 0);
}

function initContextInfo() {
  const btn = document.getElementById('btnContextInfo');
  if (!btn) return;

  let activeCloseHandler = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close context detail panel if open
    const panel = document.getElementById('contextPanel');
    if (panel) panel.remove();

    const existing = document.querySelector('.context-dropdown');
    if (existing) {
      existing.remove();
      if (activeCloseHandler) {
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
      return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below context-dropdown';

    CONTEXT_ACTIONS.forEach(action => {
      const item = document.createElement('div');
      item.className = 'model-dropdown__item';
      item.innerHTML = `<span class="model-dropdown__label">${escapeHtml(action.label)}</span><span class="model-dropdown__desc">${escapeHtml(action.desc)}</span>`;
      item.addEventListener('click', () => {
        dropdown.remove();
        if (activeCloseHandler) {
          document.removeEventListener('click', activeCloseHandler, true);
          activeCloseHandler = null;
        }
        runContextAction(action.id);
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

// ── Usage Display ──────────────────────────────────────────

// renderer-logic.js is loaded as a classic <script> before app.js and
// exposes its API on window.RendererLogic (the renderer has no require()).
const {
  parseUsageTokens,
  parseUsageRequests,
  estimateCostUsdDelta,
  getModelPricing,
  setDynamicPricing,
} = window.RendererLogic;

/**
 * Load the public pricing fallback (LiteLLM) so models without a hardcoded
 * price still show costs. Runs in the background at startup; failures are silent.
 */
async function initDynamicPricing() {
  try {
    const map = await window.copilot.pricing.getMap();
    if (map && Object.keys(map).length) {
      setDynamicPricing(map);
      // Recompute the visible cost display now that more prices are known.
      const tab = tabs.get(activeTabId);
      if (tab) refreshUsageDisplay(activeTabId);
    }
  } catch (e) {
    console.warn('[pricing] init failed:', e?.message);
  }
}

/** Format a USD amount for display (more precision for tiny amounts). */
function formatUsd(v) {
  const n = Number(v) || 0;
  if (n > 0 && n < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}
// Other RendererLogic helpers (parseTokenK, estimateCredits, buildCostBuckets,
// aggregateCostBySession, trimCostLog) are used internally by the above or
// consumed directly by modules/costs.js via window.RendererLogic.

async function refreshUsageDisplay(tabId) {
  try {
    const result = await window.copilot.chat.silentCommand(tabId, '/usage');
    if (!result.success) return;
    const parsed = parseUsageRequests(result.text);
    const tokens = parseUsageTokens(result.text);
    const tab = tabs.get(tabId);
    if (tab && tab._usageBaselinePending) {
      // First read after reopening a session: adopt the cumulative counts as the
      // baseline WITHOUT billing — the prior tokens were already paid for earlier.
      tab._usageBaselinePending = false;
      tab._lastUsageParsed = parsed;
      tab._lastUsageText = result.text;
      tab._lastUsageTokens = tokens;
      if (tabId === activeTabId) updateUsageDisplay(parsed, tokens, result.text);
      return;
    }
    if (tab) {
      // Price the new tokens at the model that actually PRODUCED them — the one
      // frozen when this prompt was sent (_billingModel) — not tab.selectedModel,
      // which may already point at a different model chosen for the next prompt.
      // This keeps a mid-session model switch from mis-pricing prior tokens.
      const modelId = tab._billingModel || tab.selectedModel || '';
      // Subscription providers (Claude Code) are covered by the plan — no USD
      // billing yet (token-based accounting for add-on budgets comes later).
      const deltaUsd = isSubscriptionProvider(getTabProvider(tab))
        ? 0
        : estimateCostUsdDelta(tokens, tab._lastUsageTokens, modelId);
      if (deltaUsd && deltaUsd > 0) {
        tab._costUsd = (tab._costUsd || 0) + deltaUsd;
        recordCostEntry(tab.sessionId || null, tab._sessionName || null, deltaUsd, getTabProvider(tab));
      }
      tab._lastUsageParsed = parsed;
      tab._lastUsageText = result.text;
      tab._lastUsageTokens = tokens;
    }
    if (tabId === activeTabId) updateUsageDisplay(parsed, tokens, result.text);
  } catch (e) {
    console.warn('[usage] refreshUsageDisplay fehlgeschlagen:', e?.message);
  }
}

/**
 * Fetch the Claude Code subscription plan limits via /usage and refresh the Abo
 * display. Unlike the live usage_update stream (window + status + reset, but no
 * %), /usage carries the authoritative "Current session/week … % used" numbers
 * — the same the official app shows. Runs after each turn for subscription tabs.
 * @param {number} tabId
 */
async function refreshSubscriptionUsage(tabId) {
  try {
    const result = await window.copilot.chat.silentCommand(tabId, '/usage');
    if (!result.success) return;
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab._subUsageWindows = parseUsageWindows(result.text, Date.now());
    if (tabId === activeTabId) updateSubscriptionUsageDisplay(tab);
  } catch (e) {
    console.warn('[usage] refreshSubscriptionUsage fehlgeschlagen:', e?.message);
  }
}

/**
 * Read & display the context-% for a tab without auto-compacting. Used for
 * Copilot tabs (the CLI manages its own context window). /context is free.
 * @param {number} tabId
 */
async function refreshContextDisplay(tabId) {
  try {
    const res = await window.copilot.chat.silentCommand(tabId, '/context');
    if (res.success) setTabContext(tabId, res.text);
  } catch (e) {
    console.warn('[context] refreshContextDisplay fehlgeschlagen:', e?.message);
  }
}

/** Context utilisation (%) at which a direct-API tab auto-compacts. */
const AUTO_COMPACT_PERCENT = 80;

/**
 * For direct-API tabs: refresh the context-% button after a turn and, if the
 * window is filling up, automatically compact the conversation. Copilot tabs
 * are unaffected (their context is managed by the CLI).
 * @param {number} tabId
 */
async function refreshApiContext(tabId) {
  try {
    const res = await window.copilot.chat.silentCommand(tabId, '/context');
    if (!res.success) return;
    setTabContext(tabId, res.text);

    const pct = parseContextPercent(res.text);
    if (pct != null && pct >= AUTO_COMPACT_PERCENT) {
      showNotification(`Kontext bei ${pct}% — wird automatisch verdichtet…`, 'info');
      await window.copilot.chat.silentCommand(tabId, '/compact');
      const after = await window.copilot.chat.silentCommand(tabId, '/context');
      if (after.success) setTabContext(tabId, after.text);
    }
  } catch (e) {
    console.warn('[context] refreshApiContext fehlgeschlagen:', e?.message);
  }
}

function updateUsageDisplay(parsed, tokens, fullText) {
  const el = document.getElementById('sessionUsage');
  if (!el) return;

  const tab = tabs.get(activeTabId);
  const modelId = tab?.selectedModel || '';

  let display;
  if (getModelPricing(modelId)) {
    // Known pricing (hardcoded or from the dynamic source) → show the running
    // per-prompt cost in USD (≥ 0, $0.00 before the first prompt).
    display = '~' + formatUsd(tab?._costUsd || 0);
  } else if (parsed) {
    // Unknown model → fall back to the raw /usage figure.
    const short = parsed.unit?.toLowerCase().includes('credit') ? 'AIC'
      : parsed.unit?.toLowerCase().includes('unit') ? 'AIU'
      : 'Req';
    display = `${parsed.value} ${short}`;
  } else {
    display = '~$0.00';
  }
  el.textContent = display;
  el.title = fullText ? fullText.trim() : 'Noch keine Nutzung erfasst';
}

/**
 * Subscription usage display (Claude Code): shows the plan quota / rate-limit
 * status in the session bar instead of a USD/credit cost — subscriptions have
 * no per-token price. Fed by usage_update events.
 * @param {Object} tab
 */
function updateSubscriptionUsageDisplay(tab) {
  const el = document.getElementById('sessionUsage');
  if (!el || !tab || getTabProvider(tab) !== 'claude-code') return;
  // Prefer the /usage windows (they carry the authoritative utilization %);
  // fall back to the live stream events (window + status + reset, usually no %).
  const windows = (Array.isArray(tab._subUsageWindows) && tab._subUsageWindows.length)
    ? tab._subUsageWindows
    : tab._subRateLimits;
  const { text, warn, tooltip } = formatSubscriptionUsage(
    windows,
    typeof tab._subCostUsd === 'number' ? tab._subCostUsd : undefined,
  );
  el.textContent = (warn ? '⚠️ ' : '') + text;
  el.title = tooltip;
}

/** How often the "Reset in …" countdown re-renders against the current time. */
const SUBSCRIPTION_USAGE_TICK_MS = 30_000;

/**
 * Keeps the "Reset in …" countdown live: formatSubscriptionUsage() computes
 * the remaining time from Date.now() at render time, but updateSubscriptionUsageDisplay()
 * is otherwise only called when new usage data arrives (after each turn) — so
 * without this, the tooltip would show a countdown frozen at whenever /usage
 * was last fetched, drifting further from reality the longer you look at it.
 * Re-renders from the already-stored data (no new /usage call) every tick.
 */
function initSubscriptionUsageTicker() {
  setInterval(() => {
    const tab = tabs.get(activeTabId);
    if (tab) updateSubscriptionUsageDisplay(tab);
  }, SUBSCRIPTION_USAGE_TICK_MS);
}

// ── Permission requests (ACP session/request_permission) ─────
// The agent asks whether to run an action; we show a dropup above the chat
// input with the offered options and route the answer back to the backend.
const _permissionQueue = [];
let _permissionActive = null;

/** Queue an incoming permission request and show it if none is active. */
function enqueuePermissionRequest(tabId, data) {
  _permissionQueue.push({ tabId, ...data });
  if (!_permissionActive) showNextPermission();
}

/** Render the next queued permission request (or hide the dropup when empty). */
function showNextPermission() {
  const el = document.getElementById('permissionDropup');
  if (!el) return;
  _permissionActive = _permissionQueue.shift() || null;
  if (!_permissionActive) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const p = _permissionActive;
  const tab = tabs.get(p.tabId);
  const providerName = PROVIDER_SHORT[tab ? getTabProvider(tab) : 'copilot'] || 'Agent';
  const icon = toolIcon(p.toolName) || '🔧';
  const opts = (Array.isArray(p.options) && p.options.length) ? p.options : [
    { optionId: 'allow', name: 'Erlauben', kind: 'allow_once' },
    { optionId: 'reject', name: 'Ablehnen', kind: 'reject_once' },
  ];
  const btns = opts.map(o => {
    const cls = /allow/.test(o.kind || '') ? 'permission-dropup__btn--allow'
      : /reject/.test(o.kind || '') ? 'permission-dropup__btn--reject' : '';
    return `<button class="permission-dropup__btn ${cls}" data-opt="${escapeAttr(o.optionId)}">${escapeHtml(o.name || o.optionId)}</button>`;
  }).join('');
  const more = _permissionQueue.length ? `<div class="permission-dropup__queue">+${_permissionQueue.length} weitere Anfrage(n)</div>` : '';
  el.innerHTML = `
    <div class="permission-dropup__head">🔐 <strong>${escapeHtml(providerName)}</strong> möchte ausführen: <span class="permission-dropup__title">${icon} ${escapeHtml(p.title || p.toolName || 'Aktion')}</span></div>
    <div class="permission-dropup__actions">${btns}</div>${more}`;
  el.querySelectorAll('.permission-dropup__btn').forEach(b => {
    b.addEventListener('click', () => answerPermission(b.dataset.opt));
  });
  el.style.display = 'block';
}

/** Send the chosen option back to the backend and advance the queue. */
function answerPermission(optionId) {
  if (!_permissionActive) return;
  const { tabId, requestId } = _permissionActive;
  try { copilot.chat.respondPermission(tabId, requestId, optionId || null); } catch (_) { /* ignore */ }
  showNextPermission();
}

// ── Cost Log + Cost Settings Panel → modules/costs.js ────────
// getCostLog, recordCostEntry, clearCostLog, initCostsPanel,
// renderCostsPanel, drawCostsChart, niceStep, renderCostsBreakdown
// live in modules/costs.js (loaded before app.js). They use the
// globals getPref/setPref (here) and buildCostBuckets/
// aggregateCostBySession/trimCostLog (from renderer-logic, below).

// ── Session Export ──────────────────────────────────────────
/**
 * Save the CWD for a named session in preferences.
 * @param {string} sessionId
 * @param {string} cwd
 */
function saveSessionCwd(sessionId, cwd) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    all[sessionId].cwd = cwd;
    setPref('namedSessions', all);
  }
}

/**
 * Get the persisted CWD for a session.
 * @param {string} sessionId
 * @returns {string|null}
 */
function getSessionCwd(sessionId) {
  const entry = getNamedSessions()[sessionId];
  return entry?.cwd ?? null;
}

/** Persist the provider (ProviderID) of a named session so resume uses the right backend. */
function saveSessionProvider(sessionId, provider) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    all[sessionId].provider = provider;
    setPref('namedSessions', all);
  }
}

/** Get the persisted provider for a session (null → treat as Copilot). */
function getSessionProvider(sessionId) {
  const entry = getNamedSessions()[sessionId];
  return entry?.provider || null;
}

/** Persist the per-session manual-approval flag in namedSessions. */
function saveSessionApproval(sessionId, manualApproval) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    all[sessionId].manualApproval = manualApproval === true;
    setPref('namedSessions', all);
  }
}

/** Read the per-session manual-approval flag (null when unset). */
function getSessionApproval(sessionId) {
  const entry = getNamedSessions()[sessionId];
  return typeof entry?.manualApproval === 'boolean' ? entry.manualApproval : null;
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
    .map(([id, entry]) => ({ id, name: entry.name, lastUsed: entry.lastUsed || '', cwd: entry.cwd || null }))
    .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  renderSessions(filterSessions());
}

/**
 * Render the session list in the sidebar. Shows session cards with
 * resume/delete actions and supports direct resume by session ID.
 * @param {Array<{id: string, name: string, lastUsed: string}>} list - Filtered session list.
 */
function renderSessions(list) {
  const container = document.getElementById('sessionList');
  // #sessionSearch only exists while the Sessions ⋮ menu is open.
  const query = (document.getElementById('sessionSearch')?.value || '').trim();

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
      container.innerHTML = emptyStateHtml('💾', 'Keine Sessions gefunden');
    }
    return;
  }

  const openSessionIds = new Set([...tabs.values()].map(t => t.sessionId).filter(Boolean));
  function _cwdBasename(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
  }
  let html = list.map(s => {
    const isLive = openSessionIds.has(s.id);
    const title = s.name;
    // Show the source provider's brand icon on each session card.
    const provider = getSessionProvider(s.id) || 'copilot';
    const provIcon = `<span class="session-card__provider" data-tooltip="${escapeAttr(PROVIDER_SHORT[provider] || provider)}">${providerIconHtml(provider)}</span>`;

    return `
      <div class="session-card ${isLive ? 'session-card--live' : ''}" >
        <div class="session-card__row">
          <div class="session-card__main" onclick="resumeSession('${escapeAttr(s.id)}')">
            <div class="session-card__title">${provIcon}<span class="session-card__title-text">${escapeHtml(title)}</span></div>
          </div>
          <button class="session-card__menu-btn" onclick="event.stopPropagation(); openSessionCardMenu('${escapeAttr(s.id)}', this)" data-tooltip="Optionen" aria-label="Session-Optionen">⋮</button>
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
 * Opens the per-card ⋮ menu for a saved session (rename / change folder /
 * delete) — fixed-positioned so it's never clipped by the scrollable
 * session list, closes on outside click. Only one menu (of any kind) is
 * ever open at a time; opening this one implicitly closes any other via the
 * shared document-click listener each dropdown registers.
 * @param {string} sessionId
 * @param {HTMLElement} btn - The ⋮ button that was clicked.
 */
function openSessionCardMenu(sessionId, btn) {
  const already = document.querySelector('.section-menu[data-session-id]');
  if (already) {
    const wasSameCard = already.dataset.sessionId === sessionId;
    already.remove();
    if (already._closeHandler) document.removeEventListener('click', already._closeHandler, true);
    if (wasSameCard) return; // clicking the same card's ⋮ again just closes it
  }

  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  const card = btn.closest('.session-card');

  const menu = document.createElement('div');
  menu.className = 'section-menu';
  menu.dataset.sessionId = sessionId;
  const cwdLabel = s.cwd ? '📁 Ordner ändern' : '📁 Ordner festlegen';
  menu.innerHTML = `
    <div class="section-menu__item" data-action="rename">✏️ Umbenennen</div>
    <div class="section-menu__item" data-action="cwd">${cwdLabel}</div>
    <div class="section-menu__item section-menu__item--danger" data-action="delete">🗑️ Session löschen</div>
  `;

  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  document.body.appendChild(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener('click', closeHandler, true);
  };
  const closeHandler = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) close(); };
  menu._closeHandler = closeHandler;
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

  menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
    close();
    if (card) startSessionRename(sessionId, card);
  });
  menu.querySelector('[data-action="cwd"]').addEventListener('click', () => {
    close();
    pickSessionCwd(sessionId);
  });
  menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
    close();
    confirmDeleteSession(sessionId, s.name);
  });
}

/**
 * Inline-renames a saved session, swapping its title for a text input in
 * place — same pattern as startTabRename() but for a sidebar session card
 * rather than an open tab.
 * @param {string} sessionId
 * @param {HTMLElement} card - The `.session-card` element to edit in place.
 */
function startSessionRename(sessionId, card) {
  const titleTextEl = card.querySelector('.session-card__title-text');
  if (!titleTextEl) return;
  const currentName = getSessionName(sessionId) || titleTextEl.textContent;

  const input = document.createElement('input');
  input.className = 'session-card__rename-input';
  input.type = 'text';
  input.value = currentName;

  titleTextEl.style.display = 'none';
  titleTextEl.insertAdjacentElement('afterend', input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.remove();
    titleTextEl.style.display = '';
    if (newName && newName !== currentName) {
      setSessionName(sessionId, newName);
      loadSessions();
    }
  };

  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  });
}

/**
 * Open a folder dialog to pick/change the CWD for a session card.
 * Updates persistent storage and any open tabs using this session.
 * @param {string} sessionId
 */
async function pickSessionCwd(sessionId) {
  const selected = await copilot.folders.browse();
  if (!selected) return;

  // If the session is open in a tab, route through changeTabCwd (Claude Code
  // replaces the session with a fresh one in the new folder). Otherwise just
  // update the stored cwd.
  let handled = false;
  for (const [tabId, tab] of tabs) {
    if (tab.sessionId === sessionId) { await changeTabCwd(tabId, tab, selected); handled = true; }
  }
  if (!handled) saveSessionCwd(sessionId, selected);

  await loadSessions();
}

/**
 * Change a tab's working directory. Claude Code sessions are bound to their
 * folder, so changing the folder on a Claude Code tab starts a FRESH session in
 * the new folder (the old session stays in Claude Code's own store). Other
 * providers just switch the cwd on the same session.
 * @param {number} tabId
 * @param {Object} tab
 * @param {string} newCwd
 */
async function changeTabCwd(tabId, tab, newCwd) {
  if (getTabProvider(tab) === 'claude-code' && tab.sessionId) {
    const oldId = tab.sessionId;
    const name = tab._sessionName || getSessionName(oldId) || null;
    // Drop our named reference to the old session — this tab now starts anew.
    deleteNamedSessionEntry(oldId);
    try { await copilot.chat.resetBackend(tabId); } catch (_) { /* ignore */ }
    tab.sessionId = null;
    tab.cwd = newCwd;
    tab._renameOnNextSession = name; // re-apply the name to the new session
    clearTabStream(tab);
    const note = document.createElement('div');
    note.className = 'stream-session-context';
    note.innerHTML = `<div class="stream-session-context__footer">📁 Neuer Ordner gewählt — es wird eine <strong>neue</strong> Claude-Code-Session in <code>${escapeHtml(newCwd)}</code> gestartet (die alte bleibt in Claude Code erhalten).</div>`;
    tab.streamEl.insertBefore(note, tab.statusEl);
    saveOpenTabs();
  } else {
    tab.cwd = newCwd;
    if (tab.sessionId) saveSessionCwd(tab.sessionId, newCwd);
  }
  if (tabId === activeTabId) {
    loadProjectSkillsAndAgents(newCwd);
    loadTodos(newCwd); // todos are project-scoped → follow the new cwd
  }
}

/** Remove all message bubbles from a tab's stream, keeping the status line. */
function clearTabStream(tab) {
  for (const el of [...tab.streamEl.children]) {
    if (el !== tab.statusEl) el.remove();
  }
  tab._responseEl = null;
  tab._responseRaw = '';
  tab._toolResultEls = new Map();
}

/** Delete a named-session entry (used when a Claude Code session is replaced). */
function deleteNamedSessionEntry(sessionId) {
  const all = getNamedSessions();
  if (all[sessionId]) {
    delete all[sessionId];
    setPref('namedSessions', all);
  }
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

  // Resume with the session's own provider (Copilot vs Claude Code — they share
  // model ids, so the ProviderID must come from the stored session, not the model).
  const provider = getSessionProvider(sessionId) || 'copilot';
  const sessionModel = getSessionModel(sessionId);
  const tabId = await createTab(label, sessionModel || undefined, provider);
  const tab = tabs.get(tabId);
  if (!tab) return;

  tab._sessionName = customName || null;

  // Restore session denied tools from namedSessions
  tab.sessionDeniedTools = getSessionDeniedTools(sessionId);

  // Model was already applied via createTab(initialModel); just refresh the button.
  if (sessionModel) updateModelSelectBtn(tabId);

  // Immediately set sessionId so the next prompt resumes this session
  tab.sessionId = sessionId;
  // The CLI's /usage is cumulative across restarts. Without a baseline the first
  // reading after reopening would be billed in full (re-charging the whole prior
  // session). Flag it so the next /usage read only establishes the baseline.
  tab._usageBaselinePending = true;
  // Restore the per-session manual-approval flag (else the global default).
  const savedApproval = getSessionApproval(sessionId);
  tab.manualApproval = savedApproval != null ? savedApproval : (getSettings().manualApproval === true);
  // Restore the project directory so project-scoped todos load correctly.
  if (!tab.cwd) tab.cwd = getSessionCwd(sessionId) || null;
  // Update lastUsed timestamp
  touchSession(sessionId);
  activeSessionId = sessionId;
  loadTodos(tab.cwd);
  saveOpenTabs();
  renderSessions(filterSessions());

  // Load and display session context (checkpoints, plan) as history overview
  await displaySessionContext(tab, sessionId, tabId);
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
  // Clear search field, if the Sessions ⋮ menu is still open.
  const searchEl = document.getElementById('sessionSearch');
  if (searchEl) searchEl.value = '';
  renderSessions(filterSessions());
}

/**
 * Display session context (recent messages) as history bubbles in the
 * tab's stream output. Called when resuming or restoring a session.
 * @param {Object} tab - Tab object from the tabs map.
 * @param {string} sessionId
 * @param {number} [tabId] - Tab id, only needed to refresh provider-specific
 *   UI (e.g. Gemini's search/files mode toggle) after restoring extras.
 * @returns {Promise<void>}
 */
async function displaySessionContext(tab, sessionId, tabId) {
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

  // 2. Letzte Nachrichten als echte Chat-Bubbles. Direkt-API-Sessions haben
  // keine CLI-State-Dateien — ihren Verlauf laden wir aus dem API-Session-Store.
  // Claude Code führt ebenfalls kein solches Store, hat aber sein eigenes
  // Transkript-Format (~/.claude/projects/…), das wir separat auslesen.
  try {
    const provider = getTabProvider(tab);
    if (provider === 'copilot') {
      // Full conversation history (not just the last few) so reopening a
      // Copilot session restores the whole verlauf in the tab.
      renderSimpleHistory(await copilot.sessions.readAllMessages(sessionId), insertBefore);
    } else if (provider === 'claude-code') {
      renderSimpleHistory(await copilot.sessions.readClaudeCodeTranscript(tab.cwd, sessionId), insertBefore);
    } else {
      const { messages, geminiMode } = await window.copilot.providers.loadSessionHistory(sessionId);
      renderApiHistory(messages, insertBefore);
      // Restore Gemini's search/files mode so a resumed session doesn't
      // silently fall back to the default (fresh tabs start with no mode set).
      if (provider === 'gemini' && geminiMode) {
        tab.geminiMode = geminiMode;
        updateGeminiModeBtn(tabId ?? activeTabId);
      }
    }
  } catch (e) { console.warn('[sessions] Nachrichten nicht verfügbar:', e.message); }

  // Footer
  const footerEl = document.createElement('div');
  footerEl.className = 'stream-session-context';
  footerEl.innerHTML = '<div class="stream-session-context__footer">Session bereit — schreibe eine Nachricht um fortzufahren</div>';
  insertBefore(footerEl);

  // Jump to the latest message — otherwise a long restored history leaves the
  // view pinned at the very top and the user has to scroll all the way down.
  // rAF so the browser has laid out the freshly-inserted bubbles first.
  requestAnimationFrame(() => scrollToBottom(tab.streamEl));
}

/**
 * Renders a simple {role, content}[] history (Copilot's events.jsonl or
 * Claude Code's own transcript — both already reduced to plain text turns)
 * as history bubbles.
 * @param {Array<{role: string, content: string}>} messages
 * @param {(el: HTMLElement) => void} insertBefore - Inserts an element into the stream.
 */
function renderSimpleHistory(messages, insertBefore) {
  if (!Array.isArray(messages)) return;
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

/**
 * Render a persisted direct-API conversation (Anthropic-native messages) as
 * history bubbles + tool-call lines. Tool-result messages (internal to the
 * agent loop) and thinking blocks are skipped.
 * @param {Array} messages - Provider-native message history.
 * @param {(el: HTMLElement) => void} insertBefore - Inserts an element into the stream.
 */
function renderApiHistory(messages, insertBefore) {
  if (!Array.isArray(messages)) return;

  const userBubble = (text) => {
    const el = document.createElement('div');
    el.className = 'stream-input stream-input--history';
    el.textContent = text;
    insertBefore(el);
  };
  const assistantBubble = (text) => {
    const el = document.createElement('div');
    el.className = 'stream-response markdown-body stream-response--history';
    el.innerHTML = window.markdown ? window.markdown.render(text) : escapeHtml(text);
    insertBefore(el);
  };
  const toolLine = (name, input) => {
    const el = document.createElement('div');
    el.className = 'stream-tool--history';
    let args = '';
    try { args = typeof formatToolArgs === 'function' ? formatToolArgs(input) : ''; } catch (_) { /* ignore */ }
    if (!args && input) { try { args = JSON.stringify(input).slice(0, 120); } catch (_) { /* ignore */ } }
    el.textContent = `🔧 ${name}${args ? ' — ' + args : ''}`;
    insertBefore(el);
  };

  for (const msg of messages) {
    if (Array.isArray(msg.parts)) {
      // Gemini shape: { role: 'user' | 'model', parts: [{text}|{functionCall}|{functionResponse}] }
      const text = msg.parts.filter(p => p.text).map(p => p.text).join('\n').trim();
      if (msg.role === 'model') {
        if (text) assistantBubble(text);
        for (const p of msg.parts) {
          if (p.functionCall) toolLine(p.functionCall.name, p.functionCall.args);
        }
      } else if (text) {
        userBubble(text); // functionResponse parts (internal) skipped
      }
    } else if (msg.role === 'user') {
      // Anthropic shape
      if (typeof msg.content === 'string' && msg.content.trim()) userBubble(msg.content);
      // array content = tool_result blocks (internal) → skip
    } else if (msg.role === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (text) assistantBubble(text);
      for (const b of blocks) {
        if (b.type === 'tool_use') toolLine(b.name, b.input);
      }
      // OpenAI-compatible shape: tool calls live on msg.tool_calls.
      for (const tc of msg.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (_) { /* ignore */ }
        toolLine(tc.function?.name || 'tool', input);
      }
    }
  }
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
  const section = container.closest('.sidebar__section');
  const visibleSkills = skills.filter(s => {
    if (!s.dirName) return true;
    return !hiddenSkillsGlobal.has(s.dirName) && !hiddenSkillsSession.has(s.dirName) && !disabledSkills.has(s.dirName);
  });

  if (visibleSkills.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = visibleSkills.map(s => {
    const isActive = activeSkills.has(s.id);
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    const isProject = s.source === 'project';
    const deleteBtn = s.source === 'user' && s.dirName
      ? `<button class="skill-card__delete" onclick="event.stopPropagation(); confirmDeleteSkill('${escapeAttr(s.dirName)}', '${escapeAttr(s.name)}')" data-tooltip="Skill löschen" aria-label="Skill löschen">🗑️</button>`
      : '';
    const projectBadge = '';
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isCLIDisabled ? 'skill-card--cli-disabled' : ''} ${isProject ? 'skill-card--project' : ''}"
           onclick="toggleSkill('${escapeAttr(s.id)}')" data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}${projectBadge}</div>
        </div>
        ${deleteBtn}
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
 * Render the MCP servers list in the sidebar.
 */
/**
 * Merges MCP server lists, deduplicating by name. Earlier lists win, so the
 * global (probed) entries take precedence over tab-context copies.
 * @param {...Array<{name: string}>} lists
 * @returns {Array<Object>}
 */
function mergeMcpByName(...lists) {
  const byName = new Map();
  for (const list of lists) {
    for (const s of (list || [])) {
      if (!byName.has(s.name)) byName.set(s.name, { ...s });
    }
  }
  return [...byName.values()];
}

/**
 * Probes MCP server connectivity in the background and updates the status
 * badges. HTTP/SSE servers get a real reachable/offline status; stdio servers
 * stay 'configured'. Merges results by name into the current server lists.
 */
async function refreshMcpStatus() {
  let probed;
  try {
    probed = await copilot.mcp.probe();
  } catch (e) {
    console.warn('[mcp] Status-Probe fehlgeschlagen:', e.message);
    return;
  }
  if (!Array.isArray(probed)) return;
  const statusByName = new Map(probed.map(s => [s.name, s.status]));
  const applyStatus = (list) => list.forEach(s => {
    if (statusByName.has(s.name)) s.status = statusByName.get(s.name);
  });
  applyStatus(globalMcpServers);
  applyStatus(mcpServers);
  renderMcpServers();
}

function renderMcpServers() {
  const container = document.getElementById('mcpList');
  if (!container) return;
  const section = container.closest('.sidebar__section');

  // MCP servers are only wired to the Copilot CLI. Direct-API providers
  // (Anthropic/Gemini/OpenAI/Ollama/GLM) have no MCP connection by design
  // (internal/sensitive servers must not reach external APIs) — hide the
  // section entirely for those tabs.
  const activeTab = tabs.get(activeTabId);
  if (activeTab && getTabProvider(activeTab) !== 'copilot') {
    if (section) section.style.display = 'none';
    return;
  }

  if (mcpServers.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = mcpServers.map(s => {
    const isConnected = s.status === 'connected';
    const isConfigured = s.status === 'configured';
    const statusIcon = isConnected ? '🟢' : isConfigured ? '⚪' : '🔴';
    const statusLabel = isConnected ? 'verbunden' : isConfigured ? 'konfiguriert' : 'getrennt';
    const cardClass = isConnected ? 'mcp-card--connected' : 'mcp-card--disconnected';
    const projectBadge = '';
    return `
      <div class="mcp-card ${cardClass}"
           data-tooltip="${escapeAttr(s.name)}">
        <span class="mcp-card__status">${statusIcon}</span>
        <div class="mcp-card__info">
          <div class="mcp-card__name">${escapeHtml(s.name)}${projectBadge}</div>
        </div>
        <span class="mcp-card__label">${statusLabel}</span>
      </div>
    `;
  }).join('');
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
  renderSkillManager();
}

/**
 * Toggle a skill's global hidden state and persist to ~/.copilot/settings.json.
 * @param {string} dirName
 */
async function toggleHideGlobal(dirName) {
  if (hiddenSkillsGlobal.has(dirName)) hiddenSkillsGlobal.delete(dirName);
  else hiddenSkillsGlobal.add(dirName);
  await copilot.skills.setHidden([...hiddenSkillsGlobal]);
  renderSkills();
  renderSkillManager();
}

/**
 * Toggle a skill's session hidden state and persist to preferences.
 * @param {string} dirName
 */
async function toggleHideSession(dirName) {
  if (hiddenSkillsSession.has(dirName)) hiddenSkillsSession.delete(dirName);
  else hiddenSkillsSession.add(dirName);
  const sessionId = activeTabId ? tabs.get(activeTabId)?.sessionId : null;
  if (sessionId) {
    const all = getNamedSessions();
    if (!all[sessionId]) all[sessionId] = { name: '', deniedTools: [], lastUsed: new Date().toISOString() };
    all[sessionId].hiddenSkills = [...hiddenSkillsSession];
    setPref('namedSessions', all);
  }
  renderSkills();
  renderSkillManager();
}

/**
 * Open the Skill Manager overlay.
 */
function openSkillManager() {
  const overlay = document.getElementById('skillManagerOverlay');
  if (overlay) {
    overlay.classList.add('overlay--visible');
    renderSkillManager();
  }
}

/**
 * Close the Skill Manager overlay.
 */
function closeSkillManager() {
  const overlay = document.getElementById('skillManagerOverlay');
  if (overlay) overlay.classList.remove('overlay--visible');
}

/**
 * Render the Skill Manager overlay content with all skills and their actions.
 */
function renderSkillManager() {
  const body = document.getElementById('skillManagerBody');
  if (!body) return;

  const globalSkills = skills.filter(s => s.source !== 'project');
  const projectSkills = skills.filter(s => s.source === 'project');

  let html = '';

  // Global Skills section
  html += '<div class="skill-manager__section">';
  html += '<div class="skill-manager__section-title">Globale Skills</div>';
  if (globalSkills.length === 0) {
    html += '<div class="skill-manager__empty">Keine globalen Skills vorhanden</div>';
  }
  for (const s of globalSkills) {
    const isHiddenGlobal = s.dirName && hiddenSkillsGlobal.has(s.dirName);
    const isHiddenSession = s.dirName && hiddenSkillsSession.has(s.dirName);
    const isHidden = isHiddenGlobal || isHiddenSession;
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    const nameClass = isHidden ? 'skill-manager__name skill-manager__name--hidden' : 'skill-manager__name';

    const hideBtn = s.dirName ? `
      <div class="split-btn">
        <button class="split-btn__item ${isHiddenSession ? 'split-btn__item--active' : ''}" onclick="toggleHideSession('${escapeAttr(s.dirName)}')" data-tooltip="Nur in dieser Session ausblenden">👁 Session</button>
        <button class="split-btn__item ${isHiddenGlobal ? 'split-btn__item--active' : ''}" onclick="toggleHideGlobal('${escapeAttr(s.dirName)}')" data-tooltip="Global ausblenden">🌍 Global</button>
      </div>` : '';

    const disableBtn = s.dirName ? `
      <button class="skill-manager__toggle-btn ${isCLIDisabled ? 'skill-manager__toggle-btn--disabled' : ''}" onclick="toggleSkillDisabled('${escapeAttr(s.dirName)}')" data-tooltip="${isCLIDisabled ? 'Skill aktivieren' : 'Skill deaktivieren'}">
        ${isCLIDisabled ? '⊘ Deakt.' : '✓ Aktiv'}
      </button>` : '';

    const deleteBtn = s.source === 'user' && s.dirName ? `
      <button class="skill-manager__delete" onclick="confirmDeleteSkill('${escapeAttr(s.dirName)}', '${escapeAttr(s.name)}')" data-tooltip="Skill löschen">🗑️</button>` : '';

    html += `<div class="skill-manager__row">
      <span class="${nameClass}">${s.icon || '🎯'} ${escapeHtml(s.name)}</span>
      ${hideBtn}${disableBtn}${deleteBtn}
    </div>`;
  }
  html += '</div>';

  // Project Skills section
  if (projectSkills.length > 0) {
    html += '<div class="skill-manager__section">';
    html += '<div class="skill-manager__section-title">Projekt-Skills</div>';
    for (const s of projectSkills) {
      const isHiddenSession = s.dirName && hiddenSkillsSession.has(s.dirName);
      const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
      const nameClass = isHiddenSession ? 'skill-manager__name skill-manager__name--hidden' : 'skill-manager__name';

      const hideBtn = s.dirName ? `
        <button class="skill-manager__toggle-btn ${isHiddenSession ? 'skill-manager__toggle-btn--active' : ''}" onclick="toggleHideSession('${escapeAttr(s.dirName)}')" data-tooltip="In dieser Session ausblenden">
          ${isHiddenSession ? '👁\u0336 Ausgeblendet' : '👁 Sichtbar'}
        </button>` : '';

      const disableBtn = s.dirName ? `
        <button class="skill-manager__toggle-btn ${isCLIDisabled ? 'skill-manager__toggle-btn--disabled' : ''}" onclick="toggleSkillDisabled('${escapeAttr(s.dirName)}')" data-tooltip="${isCLIDisabled ? 'Skill aktivieren' : 'Skill deaktivieren — wirkt global für alle Projekte mit diesem Skill-Namen'}">
          ${isCLIDisabled ? '⊘ Deakt.' : '✓ Aktiv'} ${!isCLIDisabled ? '' : ''}
        </button>
        ${isCLIDisabled ? '<span class="skill-manager__warning">⚠️ Wirkt global</span>' : ''}` : '';

      const deleteBtn = s.dirName && s.projectCwd ? `
        <button class="skill-manager__delete" onclick="confirmDeleteSkill('${escapeAttr(s.dirName)}', '${escapeAttr(s.name)}', '${escapeAttrJs(s.projectCwd)}')" data-tooltip="Skill löschen">🗑️</button>` : '';

      html += `<div class="skill-manager__row">
        <span class="${nameClass}">${s.icon || '🧪'} ${escapeHtml(s.name)}</span>
        ${hideBtn}${disableBtn}${deleteBtn}
      </div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;
}

/**
 * Loads the "global" (non-project) skill list for a given provider and
 * replaces whatever global skills were previously in `skills`, keeping any
 * merged-in project skills (source 'project') intact. Copilot keeps its
 * native ~/.copilot/skills scan (builtin+user+plugin); every other provider
 * reads its own ~/.agent-desktop/<provider>/skills folder — the model
 * decides itself which skill to read, so there's no "active" list to send.
 * @param {string} provider
 * @returns {Promise<void>}
 */
let _lastGlobalSkillsProvider = null;
async function loadGlobalSkillsForProvider(provider) {
  if (provider === _lastGlobalSkillsProvider) return;
  _lastGlobalSkillsProvider = provider;
  const projectSkills = skills.filter(s => s.source === 'project');
  try {
    const globalSkills = provider === 'copilot'
      ? (await copilot.skills.list() || [])
      : (await copilot.skills.listProvider(provider) || []);
    skills = [...globalSkills, ...projectSkills];
  } catch (e) {
    console.warn('[skills] Laden fehlgeschlagen:', e.message);
  }
  renderSkills();
}

/**
 * Reload skills from the main process and re-render the sidebar list.
 * Shows a spinning indicator on the reload button during the operation.
 * @returns {Promise<void>}
 */
async function reloadSkills() {
  const provider = activeTabId ? getTabProvider(tabs.get(activeTabId)) : 'copilot';
  _lastGlobalSkillsProvider = provider;
  skills = provider === 'copilot'
    ? (await copilot.skills.list() || [])
    : (await copilot.skills.listProvider(provider) || []);
  const savedActiveSkills = getSettings().activeSkills || [];
  activeSkills = new Set(savedActiveSkills);
  const savedDisabledSkills = await copilot.skills.getDisabled() || [];
  disabledSkills = new Set(savedDisabledSkills);
  const savedHidden = await copilot.skills.getHidden() || [];
  hiddenSkillsGlobal = new Set(savedHidden);
  // Session-hidden aus preferences laden
  const sessionId = activeTabId ? tabs.get(activeTabId)?.sessionId : null;
  const allSessions = getNamedSessions();
  hiddenSkillsSession = new Set(allSessions[sessionId]?.hiddenSkills || []);
  renderSkills();
  renderSkillManager();
}

// ── Agents ───────────────────────────────────────────────────
/**
 * Load project-specific skills and agents from .github/skills/ and .github/agents/
 * in the given CWD, merge them into the global lists, and re-render the sidebar.
 * Removes previously loaded project skills/agents before merging fresh ones.
 * @param {string|null} cwd - Absolute path to scan, or null to clear project entries
 * @returns {Promise<void>}
 */
async function loadProjectSkillsAndAgents(cwd) {
  // Remove stale project skills
  skills = skills.filter(s => s.source !== 'project');
  agents = agents.filter(a => a.source !== 'project');

  if (cwd) {
    try {
      const projectSkills = await copilot.skills.listProject(cwd) || [];
      for (const ps of projectSkills) {
        ps.source = 'project';
        ps.projectCwd = cwd;  // Speichere das Projekt-CWD für späteres Löschen
        if (!skills.find(s => s.id === ps.id)) skills.push(ps);
      }
    } catch (e) {
      console.warn('[skills] Projekt-Skills konnten nicht geladen werden:', e.message);
    }
    try {
      const projectAgents = await copilot.agents.listProject(cwd) || [];
      for (const pa of projectAgents) {
        pa.source = 'project';
        if (!agents.find(a => a.id === pa.id)) agents.push(pa);
      }
    } catch (e) {
      console.warn('[agents] Projekt-Agents konnten nicht geladen werden:', e.message);
    }
  }

  // Rebuild from the global (user/workspace) servers, then merge project
  // MCP servers from .github/mcp.json on top.
  mcpServers = globalMcpServers.map(s => ({ ...s }));

  if (cwd) {
    try {
      const projectMcpList = await copilot.mcp.listProject(cwd) || [];
      for (const pm of projectMcpList) {
        const existing = mcpServers.find(s => s.name === pm.name);
        if (existing) {
          existing.fromProject = true;
        } else {
          mcpServers.push({ ...pm, status: 'configured', fromProject: true });
        }
      }
    } catch (e) {
      console.warn('[mcp] Projekt-MCP-Config konnte nicht geladen werden:', e.message);
    }
  }

  renderSkills();
  renderAgents();

  // Persist merged mcpServers back to tab context
  const tab = tabs.get(activeTabId);
  if (tab) tab.context.mcpServers = mcpServers;
  renderMcpServers();
}

/**
 * Render the agents list in the sidebar. Each agent card shows an icon,
 * name, active toggle, and an optional delete button.
 */
function renderAgents() {
  const container = document.getElementById('agentList');
  const section = container.closest('.sidebar__section');

  if (agents.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = agents.map(a => {
    const isActive = activeAgents.has(a.id);
    const isProject = a.source === 'project';
    // Provider-scoped agents (~/.agent-desktop/<provider>/agents) have no
    // delete button here — agents:delete only knows Copilot's own
    // ~/.copilot/agents folder and would delete the wrong file.
    const deleteBtn = a.fileSlug && !isProject && a.source !== 'provider'
      ? `<button class="agent-card__delete" onclick="event.stopPropagation(); confirmDeleteAgent('${escapeAttr(a.fileSlug)}', '${escapeAttr(a.name)}')" data-tooltip="Agent löschen" aria-label="Agent löschen">🗑️</button>`
      : '';
    const projectBadge = '';
    return `
      <div class="agent-card ${isActive ? 'agent-card--active' : ''} ${isProject ? 'agent-card--project' : ''}"
           onclick="toggleAgent('${escapeAttr(a.id)}')" data-tooltip="${escapeAttr(a.description)}">
        <span class="agent-card__icon">${a.icon}</span>
        <div class="agent-card__info">
          <div class="agent-card__name">${escapeHtml(a.name)}${projectBadge}</div>
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
  try {
    const provider = activeTabId ? getTabProvider(tabs.get(activeTabId)) : 'copilot';
    _lastGlobalAgentsProvider = provider;
    agents = provider === 'copilot'
      ? (await copilot.agents.list() || [])
      : (await copilot.agents.listProvider(provider) || []);
    const savedActiveAgents = getSettings().activeAgents || [];
    activeAgents = new Set(savedActiveAgents);
    renderAgents();
  } catch (e) {
    console.warn('[agents] Reload fehlgeschlagen:', e.message);
  }
}

/**
 * Loads the "global" (non-project) agent list for a given provider and
 * replaces whatever global agents were previously in `agents`, keeping any
 * merged-in project agents (source 'project') intact. Copilot keeps its
 * native ~/.copilot/agents scan; every other provider reads its own
 * ~/.agent-desktop/<provider>/agents folder — the model decides itself
 * which agent's persona to adopt, so there's no "active" list to send.
 * @param {string} provider
 * @returns {Promise<void>}
 */
let _lastGlobalAgentsProvider = null;
async function loadGlobalAgentsForProvider(provider) {
  if (provider === _lastGlobalAgentsProvider) return;
  _lastGlobalAgentsProvider = provider;
  const projectAgents = agents.filter(a => a.source === 'project');
  try {
    const globalAgents = provider === 'copilot'
      ? (await copilot.agents.list() || [])
      : (await copilot.agents.listProvider(provider) || []);
    agents = [...globalAgents, ...projectAgents];
  } catch (e) {
    console.warn('[agents] Laden fehlgeschlagen:', e.message);
  }
  renderAgents();
}

// ── Skill/Agent Delete Confirmation ──────────────────────────
/**
 * Show an inline confirmation dialog to delete a skill.
 * @param {string} dirName - Skill directory name on disk.
 * @param {string} skillName - Human-readable skill name for display.
 * @param {string|null} [cwd] - CWD for project skills; null for user skills.
 */
function confirmDeleteSkill(dirName, skillName, cwd = null) {
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
    try {
      const result = cwd
        ? await copilot.skills.deleteProject(cwd, dirName)
        : await copilot.skills.delete(dirName);
      
      if (result.success) {
        console.log(`[skills] Gelöscht: ${dirName} (cwd: ${cwd ? 'project' : 'user'})`);
        if (cwd) {
          await loadProjectSkillsAndAgents(cwd);
          renderSkills();
          renderSkillManager();
        } else {
          await reloadSkills();
        }
      } else {
        console.error('[skills] Löschen fehlgeschlagen:', result.error);
        alert(`Fehler beim Löschen: ${result.error}`);
      }
    } catch (e) {
      console.error('[skills] Löschen Exception:', e);
      alert(`Fehler: ${e.message}`);
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
  await reloadSkills();
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
  await reloadSkills();
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
  await reloadSkills();
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
  // Leave the costs view if it happens to be open.
  window.costsViewActive = false;
  const costsView = document.getElementById('costsView');
  if (costsView) costsView.style.display = 'none';

  window.pluginsViewActive = true;
  const pluginsView = document.getElementById('pluginsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const tabPlugins = document.getElementById('tabPlugins');

  // Hide chat content, show plugin view (both inside terminal-container)
  if (sessionActions) sessionActions.style.display = 'none';
  if (streamArea) streamArea.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';
  if (pluginsView) pluginsView.style.display = 'flex';

  // Deactivate all chat tabs, activate plugin tab
  document.querySelectorAll('#tabBar .tab:not(.tab--fixed)').forEach(el => {
    el.classList.remove('tab--active');
  });
  if (tabPlugins) tabPlugins.classList.add('tab--active');

  renderPlugins();
};

/**
 * Switch the main content area from chat to the costs view (own page,
 * like the plugin marketplace — not a modal).
 */
window.switchToCostsView = function() {
  // Leave the plugins view if it happens to be open.
  window.pluginsViewActive = false;
  const pluginsView = document.getElementById('pluginsView');
  const tabPlugins = document.getElementById('tabPlugins');
  if (pluginsView) pluginsView.style.display = 'none';
  if (tabPlugins) tabPlugins.classList.remove('tab--active');

  window.costsViewActive = true;
  const costsView = document.getElementById('costsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');

  if (sessionActions) sessionActions.style.display = 'none';
  if (streamArea) streamArea.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';
  if (costsView) costsView.style.display = 'flex';

  // Render after layout so the canvas has its final width.
  requestAnimationFrame(renderCostsPanel);
};

/**
 * Switch the main content area back from plugins/costs to chat view.
 */
function switchToChatView() {
  if (!window.pluginsViewActive && !window.costsViewActive) return;
  window.pluginsViewActive = false;
  window.costsViewActive = false;
  const pluginsView = document.getElementById('pluginsView');
  const costsView = document.getElementById('costsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const tabPlugins = document.getElementById('tabPlugins');

  if (pluginsView) pluginsView.style.display = 'none';
  if (costsView) costsView.style.display = 'none';
  if (sessionActions) sessionActions.style.display = '';
  if (streamArea) streamArea.style.display = '';
  if (chatInputBar) chatInputBar.style.display = '';

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
  // #sessionSearch only exists while the Sessions section's ⋮ menu is open
  // (see openSectionMenu) — no query means "show everything" otherwise.
  const query = (document.getElementById('sessionSearch')?.value || '').trim();
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
  if (el) {
    const wasCollapsed = el.classList.contains('sidebar__content--collapsed');
    el.classList.toggle('sidebar__content--collapsed', !wasCollapsed);
    if (chevron) chevron.classList.toggle('sidebar__chevron--collapsed', !wasCollapsed);
    const collapsed = getPref('sidebarSectionsCollapsed', {});
    collapsed[name] = !wasCollapsed;
    setPref('sidebarSectionsCollapsed', collapsed);
  }
};

// ── Sidebar Section ⋮ Menus ──────────────────────────────────
/**
 * Per-section config for the header's ⋮ dropdown: `buildHtml()` returns the
 * menu's inner markup, `wire(menu, close)` attaches listeners to it once
 * inserted, and `onClose()` (optional) runs any cleanup right before the
 * menu is removed (e.g. the Sessions search resets the visible list).
 * Sections not listed here have no ⋮ button in index.html at all.
 */
const SECTION_MENUS = {
  sessions: {
    buildHtml: () => `
      <div class="section-menu__search">
        <input type="text" id="sessionSearch" placeholder="Sessions durchsuchen…" autocomplete="off" />
      </div>
    `,
    wire(menu) {
      const input = menu.querySelector('#sessionSearch');
      input.addEventListener('input', () => renderSessions(filterSessions()));
      setTimeout(() => input.focus(), 50);
    },
    onClose() {
      // Search is "find & open", not a persistent filter — always show the
      // full list again once the menu (and its search box) is gone.
      renderSessions(sessions);
    },
  },
  skills: {
    buildHtml: () => `
      <div class="section-menu__item" data-action="reload">↻ Skills neu laden</div>
      <div class="section-menu__item" data-action="manage">⚙️ Skills verwalten</div>
    `,
    wire(menu, close) {
      menu.querySelector('[data-action="reload"]').addEventListener('click', async (e) => {
        e.currentTarget.innerHTML = '<span class="btn-spinner"></span> Wird geladen…';
        await reloadSkills();
        close();
      });
      menu.querySelector('[data-action="manage"]').addEventListener('click', () => {
        close();
        openSkillManager();
      });
    },
  },
  agents: {
    buildHtml: () => `
      <div class="section-menu__item" data-action="reload">↻ Agents neu laden</div>
    `,
    wire(menu, close) {
      menu.querySelector('[data-action="reload"]').addEventListener('click', async (e) => {
        e.currentTarget.innerHTML = '<span class="btn-spinner"></span> Wird geladen…';
        await reloadAgents();
        close();
      });
    },
  },
  todos: {
    buildHtml: () => `
      <div class="section-menu__search">
        <input type="text" id="todoInput" placeholder="Neues Todo… (Enter zum Hinzufügen)" autocomplete="off" />
      </div>
      <div class="section-menu__item" data-action="sync">🔄 Nächste 5 Todos an Chat senden</div>
    `,
    wire(menu, close) {
      const input = menu.querySelector('#todoInput');
      input.addEventListener('keydown', (e) => {
        // addTodo() reads/clears #todoInput itself on success.
        if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
      });
      setTimeout(() => input.focus(), 50);
      menu.querySelector('[data-action="sync"]').addEventListener('click', async () => {
        close();
        await syncTodosToChat();
      });
    },
  },
};

/**
 * Opens a sidebar section header's ⋮ dropdown (Sessions search, Skills/
 * Agents reload+manage, Todos add+sync — see SECTION_MENUS). Fixed-
 * positioned so it's never clipped by the section's scrollable list;
 * closes on outside click. Only one menu (section or session-card) is ever
 * open at a time — opening a new one is itself a document click that closes
 * whichever other menu's own outside-click listener is currently active.
 * @param {string} name - Section name (key into SECTION_MENUS).
 * @param {HTMLElement} btn - The ⋮ button that was clicked.
 */
function openSectionMenu(name, btn) {
  const already = document.querySelector('.section-menu[data-for-section]');
  if (already) {
    const wasSameSection = already.dataset.forSection === name;
    already._close?.();
    if (wasSameSection) return; // clicking the same section's ⋮ again just closes it
  }

  const config = SECTION_MENUS[name];
  if (!config) return;

  const menu = document.createElement('div');
  menu.className = 'section-menu';
  menu.dataset.forSection = name;
  menu.innerHTML = config.buildHtml();

  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  document.body.appendChild(menu);

  const close = () => {
    config.onClose?.();
    menu.remove();
    document.removeEventListener('click', closeHandler, true);
  };
  menu._close = close;
  const closeHandler = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) close(); };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

  config.wire(menu, close);
}

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

// toolIcon, toolDisplayName, formatToolArgs → modules/utils.js

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
    if (cwd && !tabs.get(activeTabId)?.cwd) {
      const tab = tabs.get(activeTabId);
      if (tab) tab.cwd = cwd;
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
    _lastGlobalSkillsProvider = 'copilot';
  } catch (e) {
    console.warn('[skills] Laden fehlgeschlagen:', e.message);
    skills = [];
  }
  const savedActiveSkills = getSettings().activeSkills || [];
  activeSkills = new Set(savedActiveSkills);
  renderSkills();

  try {
    agents = await copilot.agents.list() || [];
    _lastGlobalAgentsProvider = 'copilot';
  } catch (e) {
    console.warn('[agents] Laden fehlgeschlagen:', e.message);
    agents = [];
  }
  const savedActiveAgents = getSettings().activeAgents || [];
  activeAgents = new Set(savedActiveAgents);
  renderAgents();

  try {
    globalMcpServers = await copilot.mcp.list() || [];
  } catch (e) {
    console.warn('[mcp] Laden fehlgeschlagen:', e.message);
    globalMcpServers = [];
  }
  mcpServers = globalMcpServers.map(s => ({ ...s }));
  renderMcpServers();
  // Probe connectivity in the background (http/sse reachability) — don't block startup.
  refreshMcpStatus();

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

  // Note: #sessionSearch's own input listener is wired inside openSectionMenu()
  // (renderer/app.js SECTION_MENUS.sessions.wire) since the field is created
  // dynamically only while the Sessions ⋮ menu is open, not present at startup.

  document.getElementById('btnAddTab').addEventListener('click', (e) => {
    e.stopPropagation();
    openAddTabProviderMenu(e.currentTarget);
  });
}

/**
 * Opens the provider chooser anchored to the "+" new-tab button. Selecting a
 * provider creates a new tab pre-set to that provider's default model (the
 * model implies the provider; switching providers within a tab is not offered
 * because it would discard the tab's conversation).
 * @param {HTMLElement} btn - The "+" button.
 */
async function openAddTabProviderMenu(btn) {
  const existing = document.querySelector('.provider-add-dropdown');
  if (existing) { existing.remove(); return; }

  const dropdown = document.createElement('div');
  // Own panel class (fixed-positioned) — not .model-dropdown, whose
  // bottom/animation rules conflict with fixed anchoring under the "+".
  dropdown.className = 'provider-add-dropdown';
  const rect = btn.getBoundingClientRect();
  // Right-align to the button so it doesn't overflow the window edge.
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

  let closeHandler = null;
  const close = () => {
    dropdown.remove();
    if (closeHandler) { document.removeEventListener('click', closeHandler, true); closeHandler = null; }
  };

  // Only providers with an actual working connection are offered here.
  const providers = await getConnectedProviders();
  providers.forEach(p => {
    const item = document.createElement('div');
    item.className = 'model-dropdown__item';
    const badge = providerStageBadge(p.id);
    item.innerHTML = `<span class="model-dropdown__provider-icon">${providerIconHtml(p.id)}</span><span class="model-dropdown__label">${escapeHtml(PROVIDER_LABELS[p.id] || p.id)}</span>${badge}`;
    item.addEventListener('click', () => {
      close();
      const label = p.id === 'copilot' ? '🤖 Chat' : `🔌 ${PROVIDER_SHORT[p.id] || p.id}`;
      createTab(label, getDefaultModelForProvider(p.id), p.id);
    });
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);
  closeHandler = (ev) => { if (!dropdown.contains(ev.target) && ev.target !== btn) close(); };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
}

/**
 * Wire up window control buttons (minimize, maximize, close), terminal
 * toggle, export, scroll-to-bottom, and window resize handling.
 */
function initWindowControls() {
  document.getElementById('btnWindowMinimize').addEventListener('click', () => copilot.window.minimize());
  document.getElementById('btnWindowMaximize').addEventListener('click', () => copilot.window.maximize());
  document.getElementById('btnWindowClose').addEventListener('click', () => copilot.window.close());

  document.getElementById('btnScrollBottom').addEventListener('click', () => {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.autoScrollEnabled = true;
      tab.streamEl.scrollTop = tab.streamEl.scrollHeight;
      document.getElementById('btnScrollBottom').style.display = 'none';
    }
  });

}



/**
 * Initialize all session action buttons: todo sync, todo add,
 * and session delete confirmation handlers.
 */
/**
 * Marks the next 5 open todos as done and sends them as a chat prompt to
 * the active tab. Used by the Todos section's ⋮ menu (see openSectionMenu).
 * @returns {Promise<void>}
 */
async function syncTodosToChat() {
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
      await copilot.todos.update(tab.cwd, todo.id, { status: 'done' });
    }
    await loadTodos(tab.cwd);
  } catch (err) {
    showNotification(`Fehler: ${err.message}`, 'error');
    return;
  }
  document.getElementById('chatInput').value = prompt;
  sendMessage();
  showNotification(`${openTodos.length} Todos gesendet ✓`, 'success');
}

function initSlashButtons() {
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
  const settDefaultProvider = document.getElementById('settDefaultProvider');

  // Event delegation (not a per-button listener loop): provider-config tabs
  // are inserted dynamically after this runs once at startup (see
  // renderProviderConfigTabs) — a listener bound only to buttons that exist
  // right now would silently never fire for those.
  document.querySelector('.settings__tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.settings__tab');
    if (!tab) return;
    document.querySelectorAll('.settings__tab').forEach(t => t.classList.remove('settings__tab--active'));
    document.querySelectorAll('.settings__panel').forEach(p => p.classList.remove('settings__panel--active'));
    tab.classList.add('settings__tab--active');
    const panel = document.querySelector(`.settings__panel[data-panel="${tab.dataset.tab}"]`);
    if (panel) panel.classList.add('settings__panel--active');
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
  const settManualApproval = document.getElementById('settManualApproval');
  if (settManualApproval) {
    settManualApproval.checked = savedSettings.manualApproval === true;
    settManualApproval.addEventListener('change', () => saveSetting('manualApproval', settManualApproval.checked));
  }

  // Default provider (App tab).
  renderDefaultModelSettings();
  // Copilot's own default-model select lives in its static provider tab.
  renderProviderModelSelect('copilot', document.getElementById('settProviderModel-copilot'));
  // Claude Code / Anthropic / OpenAI / GLM / Ollama / Gemini each get their own
  // tab only when actually connected (CLI installed / key stored) — built
  // dynamically since that set changes at runtime (a key can be added while
  // Settings is open).
  renderProviderConfigTabs();

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
  settDefaultProvider?.addEventListener('change', () => {
    saveSetting('defaultProvider', settDefaultProvider.value);
  });

  renderExtraDirs();
  initTagInput('btnAddDir', 'settDirInput', addExtraDir);

  // Copilot tab's own "Verbotene Shell-Tools" (static HTML, unlike the
  // other DENYLIST_PROVIDERS which get theirs via buildProviderConfigPanelHtml).
  renderDeniedTools('copilot');
  initTagInput('btnAddDeniedTool-copilot', 'settDeniedToolInput-copilot', (val) => addDeniedTool('copilot', val));

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

  // Every folder-path field auto-saves the moment it's picked (no separate
  // "Save" button/step) — folders:save merges just this one key into the
  // existing config, so browsing e.g. the Skills folder on the Copilot tab
  // never touches what's saved for CWD/Bilder on the App tab, or vice versa.
  // All of these still require an app restart to actually take effect
  // (main-process globals are only read once at startup), hence the toast.
  async function autoSaveFolderField(key, value) {
    const result = await copilot.folders.save({ [key]: value });
    if (result.success) {
      showNotification('Gespeichert — Neustart erforderlich, damit es wirkt', 'success');
    } else {
      showNotification(`Fehler: ${result.error}`, 'error');
    }
  }

  const folderFields = [
    { btn: 'btnBrowseCwd', input: 'settFolderCwd', key: 'cwd' },
    { btn: 'btnBrowseSessions', input: 'settFolderSessions', key: 'sessionsDir' },
    { btn: 'btnBrowseSkills', input: 'settFolderSkills', key: 'skillsDir' },
    { btn: 'btnBrowseAgents', input: 'settFolderAgents', key: 'agentsDir' },
    { btn: 'btnBrowseImages', input: 'settFolderImages', key: 'imagesDir' },
  ];
  folderFields.forEach(({ btn, input, key }) => {
    document.getElementById(btn).addEventListener('click', async () => {
      const folder = await copilot.folders.browse();
      if (!folder) return;
      document.getElementById(input).value = folder;
      await autoSaveFolderField(key, folder);
    });
  });

  // Instructions file browse (file dialog, not folder) — auto-saves too.
  document.getElementById('btnBrowseInstructions').addEventListener('click', async () => {
    const file = await copilot.folders.browseFile([{ name: 'Markdown', extensions: ['md'] }]);
    if (!file) return;
    document.getElementById('settFolderInstructions').value = file;
    await autoSaveFolderField('instructionsFile', file);
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

  // Resets ALL folder config (App + Copilot tab fields) back to defaults —
  // the one action that intentionally does NOT merge, so it gets its own IPC.
  document.getElementById('btnFoldersReset').addEventListener('click', async () => {
    const result = await copilot.folders.reset();
    if (result.success) {
      await loadFolderSettings();
      showNotification('Auf Standard zurückgesetzt — bitte App neu starten', 'success');
    }
  });

  loadFolderSettings();
  initShortcutsSettings();

  document.querySelector('.settings__tab[data-tab="providers"]')?.addEventListener('click', () => {
    renderProvidersSettings();
    renderProviderConfigTabs(); // a key may have just been added/removed
  });
  document.querySelector('.settings__tab[data-tab="features"]')?.addEventListener('click', renderFeatureMatrix);

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
/**
 * Opens a modal textarea editor for a native, single global instructions
 * file (Copilot's copilot-instructions.md or Claude Code's CLAUDE.md).
 * @param {string} content
 * @param {string} filePath
 * @param {Object} [opts]
 * @param {string} [opts.title='📝 Copilot Instructions']
 * @param {(content: string) => Promise<{success: boolean, error?: string}>} [opts.writeFn] - Defaults to copilot.instructions.write.
 */
function openInstructionsEditor(content, filePath, opts = {}) {
  const title = opts.title || '📝 Copilot Instructions';
  const writeFn = opts.writeFn || ((c) => copilot.instructions.write(c));

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'instructions-editor-overlay';
  overlay.innerHTML = `
    <div class="instructions-editor">
      <div class="instructions-editor__header">
        <span class="instructions-editor__title">${escapeHtml(title)}</span>
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
    const result = await writeFn(textarea.value);
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
 * Restore each sidebar section's persisted collapse/expand state.
 */
function initSidebar() {
  const sectionsCollapsed = getPref('sidebarSectionsCollapsed', {});
  for (const [name, isCollapsed] of Object.entries(sectionsCollapsed)) {
    if (!isCollapsed) continue;
    const el = document.getElementById(name + 'Content');
    const chevron = document.getElementById(name + 'Chevron');
    if (el) {
      el.classList.add('sidebar__content--collapsed');
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

// ── API-Provider Settings ────────────────────────────────────

/** Providers shown in the settings panel. `active` ones have a working backend. */
const PROVIDER_SETTINGS = [
  {
    id: 'copilot', active: true, cli: true,
    info: [
      'GitHub Copilot – voll agentisch über die Copilot CLI.',
      '',
      'Als einziger Provider mit MCP-Server-Unterstützung.',
      'Anmeldung über die CLI (Terminal), kein API-Key.',
      'Benötigt die installierte „copilot"-CLI.',
    ].join('\n'),
  },
  {
    id: 'claude-code', active: true, cli: true,
    info: [
      'Claude Code – voll agentisch über das Abo (kein API-Key).',
      '',
      'Läuft über den ACP-Adapter (npx @agentclientprotocol/claude-agent-acp).',
      'Abrechnung über dein Claude-Abo (Pro/Max) statt pro Token —',
      'sofern kein ANTHROPIC_API_KEY gesetzt ist (wird bewusst entfernt).',
      '',
      'Voraussetzung: einmalig „claude" (Claude Code CLI) mit dem Abo einloggen.',
    ].join('\n'),
  },
  {
    id: 'anthropic', active: true, placeholder: 'sk-ant-…',
    info: [
      'Claude – voll agentisch (direkte API).',
      '',
      'Tools:',
      '• Shell (Befehle ausführen)',
      '• Datei lesen / schreiben / bearbeiten',
      '• Verzeichnis auflisten, glob, grep',
      '',
      'Besonderheiten:',
      '• Skills, Agents & Instructions werden mitgegeben',
      '• Prompt-Caching + adaptives Thinking',
      '• Exakte Token-/Kostenabrechnung',
    ].join('\n'),
  },
  {
    id: 'gemini', active: true, placeholder: 'AIza…',
    info: [
      'Gemini – recherche-orientiert (direkte API).',
      '',
      'Zwei Modi pro Tab umschaltbar (nicht gleichzeitig):',
      '🔍 Recherche: Live-Google-Suche mit Quellenangaben',
      '📁 Dateien: lesen / schreiben / bearbeiten, Verzeichnis, glob, grep',
      '',
      'Besonderheiten:',
      '• Kein Shell-Zugriff',
      '• Keine Skills/Agents/Instructions',
      '• Suche & Datei-Tools schließen sich pro Anfrage aus',
    ].join('\n'),
  },
  {
    id: 'openai', active: true, placeholder: 'sk-…', baseUrl: true, defaultBaseUrl: 'https://api.openai.com/v1',
    info: [
      'OpenAI – voll agentisch (Chat Completions + Function Calling).',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
      'Base-URL überschreibbar (z.B. für OpenRouter).',
    ].join('\n'),
  },
  {
    id: 'glm', active: true, placeholder: 'xxxx.xxxx (Zhipu API-Key)', baseUrl: true, defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    info: [
      'GLM (Zhipu) – voll agentisch über OpenAI-kompatible API.',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
    ].join('\n'),
  },
  {
    id: 'ollama', active: true, placeholder: '(kein Key nötig)', keyless: true, baseUrl: true, defaultBaseUrl: 'http://localhost:11434/v1',
    info: [
      'Ollama – lokale Modelle, kein API-Key, kostenlos.',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
      'Base-URL = Adresse deines Ollama-Servers (Standard localhost:11434).',
    ].join('\n'),
  },
];

/**
 * (Re)render the API-provider key settings panel: one row per provider with a
 * masked input, save/delete buttons and the stored/empty status.
 */
/**
 * Providers with an actual working connection right now: Copilot (always
 * available), Claude Code (once its CLI is installed), and the direct-API
 * providers (once a key is stored). Ollama is keyless, so a saved base URL is
 * its equivalent "connected" signal instead — otherwise it'd always show up
 * regardless of whether Ollama is even installed. Shared by the new-tab
 * provider menu and the Settings dialog's dynamic provider tabs.
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getConnectedProviders() {
  const result = [{ id: 'copilot', label: PROVIDER_LABELS.copilot || 'Copilot' }];
  let cc = { installed: false };
  try { cc = await window.copilot.chat.claudeCodeStatus(); } catch (_) { /* old build */ }
  if (cc.installed) result.push({ id: 'claude-code', label: SETTINGS_TAB_LABELS['claude-code'] || PROVIDER_LABELS['claude-code'] || 'Claude Code' });

  await refreshProviderStatus();
  for (const p of PROVIDER_SETTINGS) {
    if (p.cli) continue; // Copilot/Claude Code handled separately (native, not key-based)
    const connected = p.keyless
      ? (p.baseUrl ? Boolean(getProviderBaseUrl(p.id)) : true)
      : Boolean(_providerStatus.keyed && _providerStatus.keyed[p.id]);
    if (connected) result.push({ id: p.id, label: SETTINGS_TAB_LABELS[p.id] || PROVIDER_LABELS[p.id] || p.id });
  }
  return result;
}

/**
 * Providers that get their own dynamically-generated settings tab. Copilot is
 * static HTML (always present, handled separately by the Settings dialog), so
 * it's excluded here.
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getConnectedProviderConfigs() {
  const providers = await getConnectedProviders();
  return providers.filter(p => p.id !== 'copilot');
}

/**
 * Builds the inner HTML for one dynamically-generated provider settings tab:
 * a default-model select (every provider), plus a read-only Skills/Agents/
 * Instructions folder row (with an "open in explorer" button) for whichever
 * of those features that provider actually supports — see providerSupports();
 * e.g. Gemini has none of the three, Claude Code has no instructions folder.
 * @param {string} providerId
 * @returns {string}
 */
function buildProviderConfigPanelHtml(providerId) {
  const label = PROVIDER_LABELS[providerId] || providerId;
  const parts = [`
    <div class="settings__group">
      <label class="settings__label">Standard-Modell</label>
      <div class="settings__hint">Modell, mit dem ein neuer ${escapeHtml(label)}-Tab startet. Pro Tab über das 🧠-Menü überschreibbar.</div>
      <select class="settings__select" data-provider-model-select="${escapeAttr(providerId)}"></select>
    </div>
  `];

  const folderRows = [];
  if (providerSupports(providerId, 'skills')) folderRows.push({ key: 'skillsDir', icon: '🧩', title: 'Skills' });
  if (providerSupports(providerId, 'agents')) folderRows.push({ key: 'agentsDir', icon: '🤖', title: 'Agents' });
  // Claude Code's `instructions: true` means its own single native CLAUDE.md
  // editor (added separately below) — NOT the direct-API providers' multi-file
  // instructionsDir folder, so it's excluded here despite the shared flag.
  if (providerSupports(providerId, 'instructions') && providerId !== 'claude-code') {
    folderRows.push({ key: 'instructionsDir', icon: '📝', title: 'Instructions' });
  }

  if (folderRows.length) {
    parts.push('<div class="settings__separator"></div>');
    for (const row of folderRows) {
      parts.push(`
        <div class="settings__group">
          <label class="settings__label">${row.icon} ${row.title}</label>
          <div class="settings__hint">Wird automatisch angelegt — hier abgelegte Dateien werden bei ${escapeHtml(label)} eingebunden.</div>
          <div class="settings__folder-row">
            <input type="text" class="settings__folder-input" data-provider-folder-input="${escapeAttr(providerId)}:${row.key}" readonly />
            <button class="action-btn" data-provider-folder-open="${escapeAttr(providerId)}:${row.key}" data-tooltip="Ordner öffnen">📁</button>
          </div>
        </div>
      `);
    }
  }

  if (providerSupports(providerId, 'denylist')) {
    parts.push(`
      <div class="settings__separator"></div>
      <div class="settings__group">
        <label class="settings__label">🚫 Verbotene Shell-Tools</label>
        <div class="settings__hint">Nur für ${escapeHtml(label)} — jeder Provider hat seine eigene, unabhängige Liste (z.B. <code>git push</code>, <code>rm -rf</code>).</div>
        <div class="settings__tool-list" id="settDeniedToolsList-${escapeAttr(providerId)}"></div>
        <div class="settings__tool-add">
          <input type="text" class="settings__tool-input" id="settDeniedToolInput-${escapeAttr(providerId)}" placeholder="z.B. git push" />
          <button class="action-btn" id="btnAddDeniedTool-${escapeAttr(providerId)}" data-tooltip="Tool blockieren">+</button>
        </div>
      </div>
    `);
  }

  if (providerId === 'claude-code') {
    parts.push(`
      <div class="settings__separator"></div>
      <div class="settings__group">
        <label class="settings__label">📝 Instructions</label>
        <div class="settings__hint">Claude Codes eigene, native globale Instructions-Datei — analog zu Copilots copilot-instructions.md.</div>
        <div class="settings__folder-row">
          <input type="text" class="settings__folder-input" value="~/.claude/CLAUDE.md" readonly />
          <button class="action-btn" id="btnEditInstructionsClaudeCode" data-tooltip="Instructions bearbeiten">✏️</button>
        </div>
      </div>
      <div class="settings__hint" style="margin-top:8px;">
        Claude Code entdeckt Skills selbst nativ unter <code>~/.claude/skills/</code> — eine dort abgelegte Datei wird automatisch erkannt, ohne dass hier etwas konfiguriert werden muss.
      </div>
    `);
  }

  return parts.join('');
}

/**
 * Wires one dynamically-generated provider tab's controls after it's been
 * inserted into the DOM: fills the default-model select, loads and displays
 * the Skills/Agents/Instructions folder paths, and wires the "open" buttons.
 * @param {string} providerId
 * @param {HTMLElement} panel
 */
async function wireProviderConfigPanel(providerId, panel) {
  renderProviderModelSelect(providerId, panel.querySelector(`[data-provider-model-select="${providerId}"]`));

  if (providerSupports(providerId, 'denylist')) {
    renderDeniedTools(providerId);
    initTagInput(`btnAddDeniedTool-${providerId}`, `settDeniedToolInput-${providerId}`, (val) => addDeniedTool(providerId, val));
  }

  if (providerId === 'claude-code') {
    panel.querySelector('#btnEditInstructionsClaudeCode')?.addEventListener('click', async () => {
      const result = await copilot.instructions.readClaudeCode();
      if (!result.success) {
        showNotification(`Fehler: ${result.error}`, 'error');
        return;
      }
      openInstructionsEditor(result.content, result.path, {
        title: '📝 Claude Code Instructions',
        writeFn: (content) => copilot.instructions.writeClaudeCode(content),
      });
    });
  }

  const folderInputs = panel.querySelectorAll('[data-provider-folder-input]');
  if (!folderInputs.length) return;
  let paths = {};
  try { paths = await window.copilot.folders.providerPaths(providerId) || {}; } catch (_) { /* old build */ }
  folderInputs.forEach((input) => {
    const key = input.dataset.providerFolderInput.split(':')[1];
    input.value = paths[key] || '';
  });
  panel.querySelectorAll('[data-provider-folder-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.providerFolderOpen.split(':')[1];
      if (paths[key]) window.copilot.folders.openPath(paths[key]);
    });
  });
}

/**
 * (Re)builds the dynamic per-provider settings tabs (Claude Code + whichever
 * direct-API providers currently have a key stored). Removes any previously
 * generated tabs/panels first, so this is safe to call repeatedly — e.g.
 * whenever a key is added/removed on the "Provider" tab — without
 * accumulating duplicates. Inserted right before the Features tab.
 */
async function renderProviderConfigTabs() {
  const tabsBar = document.querySelector('.settings__tabs');
  const panelsHost = document.querySelector('.settings');
  const featuresTab = document.querySelector('.settings__tab[data-tab="features"]');
  const featuresPanel = document.querySelector('.settings__panel[data-panel="features"]');
  if (!tabsBar || !panelsHost || !featuresTab || !featuresPanel) return;

  document.querySelectorAll('.settings__tab[data-provider-tab]').forEach(el => el.remove());
  document.querySelectorAll('.settings__panel[data-provider-panel]').forEach(el => el.remove());

  const configs = await getConnectedProviderConfigs();
  for (const cfg of configs) {
    const btn = document.createElement('button');
    btn.className = 'settings__tab';
    btn.dataset.tab = `provider-${cfg.id}`;
    btn.dataset.providerTab = '1';
    btn.textContent = cfg.label;
    tabsBar.insertBefore(btn, featuresTab);

    const panel = document.createElement('div');
    panel.className = 'settings__panel';
    panel.dataset.panel = `provider-${cfg.id}`;
    panel.dataset.providerPanel = '1';
    panel.innerHTML = buildProviderConfigPanelHtml(cfg.id);
    panelsHost.insertBefore(panel, featuresPanel);

    wireProviderConfigPanel(cfg.id, panel);
  }
}

async function renderProvidersSettings() {
  const list = document.getElementById('providersKeyList');
  if (!list) return;
  await refreshProviderStatus();

  document.getElementById('providersUnavailable').style.display =
    _providerStatus.available ? 'none' : 'block';

  list.innerHTML = '';
  for (const p of PROVIDER_SETTINGS) {
    if (p.cli) { renderCopilotProviderRow(list, p); continue; }
    const hasKey = Boolean(_providerStatus.keyed && _providerStatus.keyed[p.id]);
    const status = p.keyless ? 'kein Key nötig' : (hasKey ? '● hinterlegt' : '○ leer');
    const row = document.createElement('div');
    row.className = 'providers-row';
    const keyControls = p.keyless ? '' : `
      <div class="providers-row__controls">
        <input type="password" class="providers-row__input" placeholder="${escapeAttr(p.placeholder)}" autocomplete="off" />
        <button class="action-btn providers-row__save">Speichern</button>
        <button class="action-btn providers-row__delete" ${hasKey ? '' : 'disabled'}>Löschen</button>
      </div>`;
    const baseUrlControls = p.baseUrl ? `
      <div class="providers-row__controls">
        <input type="text" class="providers-row__baseurl" placeholder="${escapeAttr(p.defaultBaseUrl || '')}" autocomplete="off" value="${escapeAttr(getProviderBaseUrl(p.id))}" />
        <button class="action-btn providers-row__save-url">Base-URL speichern</button>
      </div>` : '';
    row.innerHTML = `
      <div class="providers-row__head">
        <span class="providers-row__name"><span class="providers-row__icon">${providerIconHtml(p.id)}</span>${escapeHtml(PROVIDER_LABELS[p.id] || p.id)}</span>
        ${p.info ? `<span class="providers-row__info" data-tooltip="${escapeAttr(p.info)}" aria-label="Tools & Besonderheiten">ⓘ</span>` : ''}
        ${providerStageBadge(p.id).trim()}
        <span class="providers-row__status ${hasKey || p.keyless ? 'is-set' : ''}">${status}</span>
        ${p.active ? '' : '<span class="providers-row__soon">in Vorbereitung</span>'}
      </div>
      ${keyControls}
      ${baseUrlControls}`;

    if (!p.keyless) {
      const input = row.querySelector('.providers-row__input');
      row.querySelector('.providers-row__save').addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        const key = input.value.trim();
        if (!key) { showNotification('Bitte einen API-Key eingeben.', 'warning'); return; }
        const res = await window.copilot.providers.setKey(p.id, key);
        if (res.success) {
          input.value = '';
          showNotification(`${PROVIDER_LABELS[p.id]}-Key gespeichert.`, 'success');
          renderProvidersSettings();
          refreshProviderModels(p.id); // discover this provider's models now that it has a key
        } else {
          showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
        }
      }));
      row.querySelector('.providers-row__delete').addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        await window.copilot.providers.deleteKey(p.id);
        showNotification(`${PROVIDER_LABELS[p.id]}-Key entfernt.`, 'info');
        renderProvidersSettings();
      }));
    }

    if (p.baseUrl) {
      const urlInput = row.querySelector('.providers-row__baseurl');
      row.querySelector('.providers-row__save-url').addEventListener('click', () => {
        saveProviderBaseUrl(p.id, urlInput.value.trim());
        showNotification(`${PROVIDER_LABELS[p.id]} Base-URL gespeichert.`, 'success');
      });
    }

    list.appendChild(row);
  }
}

/** Per-provider base URL override (empty → provider default). */
function getProviderBaseUrl(provider) {
  return (getSettings().providerBaseUrls || {})[provider] || '';
}
function saveProviderBaseUrl(provider, url) {
  const map = { ...(getSettings().providerBaseUrls || {}) };
  if (url) map[provider] = url; else delete map[provider];
  saveSetting('providerBaseUrls', map);
}

/**
 * Render the Copilot row in the provider settings — presented like the other
 * providers, but driven by the CLI status (installed? logged in?) instead of an
 * API key. Shows an install hint, "Anmelden" (terminal login) and re-check.
 */
async function renderCopilotProviderRow(list, p) {
  const row = document.createElement('div');
  row.className = 'providers-row';
  row.innerHTML = `
    <div class="providers-row__head">
      <span class="providers-row__name"><span class="providers-row__icon">${providerIconHtml(p.id)}</span>${escapeHtml(PROVIDER_LABELS[p.id] || p.id)}</span>
      ${p.info ? `<span class="providers-row__info" data-tooltip="${escapeAttr(p.info)}" aria-label="Tools & Besonderheiten">ⓘ</span>` : ''}
      ${providerStageBadge(p.id).trim()}
      <span class="providers-row__status">… wird geprüft</span>
    </div>
    <div class="providers-row__controls"></div>`;
  list.appendChild(row);

  const statusEl = row.querySelector('.providers-row__status');
  const controls = row.querySelector('.providers-row__controls');

  // Claude Code: launched on demand via npx; billed through the subscription.
  // Live-detect the CLI; the subscription login itself can't be checked
  // non-interactively, so we point the user to `claude` for it.
  if (p.id === 'claude-code') {
    let cc = { installed: false };
    try { cc = await window.copilot.chat.claudeCodeStatus(); } catch (_) { /* old build */ }
    if (cc.installed) {
      statusEl.textContent = '● „claude"-CLI installiert' + (cc.version ? ` (v${cc.version})` : '');
      statusEl.classList.add('is-set');
    } else {
      statusEl.textContent = '⚠ „claude"-CLI nicht gefunden';
    }
    const hint = document.createElement('span');
    hint.className = 'providers-row__hint';
    hint.textContent = cc.installed
      ? 'Melde dich einmalig mit dem Abo an (Terminal: „claude" → Login). Kein API-Key nötig — ANTHROPIC_API_KEY wird für Claude Code entfernt.'
      : 'Installiere die „claude"-CLI (npm i -g @anthropic-ai/claude-code) und melde dich mit dem Abo an.';
    controls.appendChild(hint);
    const recheck = document.createElement('button');
    recheck.className = 'action-btn';
    recheck.textContent = 'Status prüfen';
    recheck.addEventListener('click', () => renderProvidersSettings());
    controls.appendChild(recheck);
    return;
  }

  let status = { cliInstalled: false, authenticated: false, user: null };
  try { status = await window.copilot.auth.status(); } catch (_) { /* old build / offline */ }

  const addBtn = (label, primary, onClick) => {
    const b = document.createElement('button');
    b.className = 'action-btn' + (primary ? ' action-btn--primary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    controls.appendChild(b);
  };

  if (!status.cliInstalled) {
    statusEl.textContent = '⚠ CLI nicht gefunden';
    const hint = document.createElement('span');
    hint.className = 'providers-row__hint';
    hint.textContent = 'Bitte die „copilot"-CLI installieren und die App neu starten.';
    controls.appendChild(hint);
  } else if (status.authenticated) {
    statusEl.textContent = '● eingeloggt' + (status.user ? ' als ' + status.user : '');
    statusEl.classList.add('is-set');
    addBtn('Neu anmelden', false, () => window.copilot.auth.login());
  } else {
    statusEl.textContent = '○ CLI installiert, nicht eingeloggt';
    addBtn('Anmelden', true, async () => {
      await window.copilot.auth.login();
      showNotification('Login im Terminal abschließen, danach „Status prüfen".', 'info');
    });
    addBtn('Status prüfen', false, () => renderProvidersSettings());
  }
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

  initCostsPanel();
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

    if (sc('newTab', e))   { e.preventDefault(); createTab('🤖 Chat'); return; }
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
    if (sc('search', e))        { e.preventDefault(); if (window._openSearch) window._openSearch(); return; }

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
// ── Self-Update (git-basiert) ────────────────────────────────

/** True while an update check or apply is in flight (prevents double-clicks). */
let _updateBusy = false;
/** Version the user dismissed — suppresses re-nagging for the same version on silent checks. */
let _dismissedUpdateVersion = null;
/** Interval between background update checks while the app runs (6 h). */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Check for a newer release. On startup this runs silently (only surfaces a
 * banner if an update exists); the settings button passes silent=false to also
 * report "up to date" / errors.
 * @param {{silent?: boolean}} [opts]
 */
async function checkForUpdates({ silent = true } = {}) {
  if (_updateBusy) return;
  if (!window.copilot?.updates) return;
  _updateBusy = true;
  const statusEl = document.getElementById('updateCheckStatus');
  if (!silent && statusEl) statusEl.textContent = 'Suche…';
  try {
    const res = await copilot.updates.check();
    if (res.updateAvailable) {
      // On silent (background) checks, don't re-show a banner the user already
      // dismissed for this exact version; the settings button (silent=false)
      // always shows it again.
      if (silent && res.latestVersion === _dismissedUpdateVersion) {
        if (statusEl) statusEl.textContent = `Neue Version v${res.latestVersion} verfügbar.`;
      } else {
        showUpdateBanner(res.currentVersion, res.latestVersion);
        if (statusEl) statusEl.textContent = `Neue Version v${res.latestVersion} verfügbar.`;
      }
    } else if (!silent) {
      if (res.ok) {
        if (statusEl) statusEl.textContent = `Aktuell (v${res.currentVersion}).`;
        showNotification(`Du nutzt bereits die neueste Version (v${res.currentVersion}).`, 'success');
      } else {
        const msg = updateReasonText(res.reason, res.error);
        if (statusEl) statusEl.textContent = msg;
        showNotification('Update-Prüfung fehlgeschlagen: ' + msg, 'warning');
      }
    }
  } catch (e) {
    if (!silent) showNotification('Update-Prüfung fehlgeschlagen: ' + (e?.message || e), 'error');
  } finally {
    _updateBusy = false;
  }
}

/** Human-readable explanation for a non-ok check/apply reason. */
function updateReasonText(reason, error) {
  switch (reason) {
    case 'not-a-git-checkout': return 'App läuft nicht aus einem Git-Checkout.';
    case 'git-failed': return 'Git-Abfrage fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    case 'dirty-working-tree': return 'Lokale, nicht gespeicherte Änderungen vorhanden — bitte committen oder verwerfen.';
    case 'pull-failed': return 'git pull fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    case 'npm-install-failed': return 'npm install fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    default: return error || 'Unbekannter Fehler.';
  }
}

/** Show the top update banner (idempotent — replaces any existing one). */
function showUpdateBanner(currentVersion, latestVersion) {
  document.getElementById('updateBanner')?.remove();
  const bar = document.createElement('div');
  bar.id = 'updateBanner';
  bar.className = 'update-banner';
  bar.innerHTML = `
    <span class="update-banner__text">🔄 Neue Version <strong>v${escapeHtml(latestVersion)}</strong> verfügbar (aktuell v${escapeHtml(currentVersion)}).</span>
    <button class="update-banner__btn" id="btnApplyUpdate">Herunterladen & Neustarten</button>
    <button class="update-banner__close" id="btnDismissUpdate" aria-label="Schließen">✕</button>`;
  document.body.appendChild(bar);
  document.getElementById('btnDismissUpdate').addEventListener('click', () => {
    _dismissedUpdateVersion = latestVersion; // don't re-nag on background checks
    bar.remove();
  });
  document.getElementById('btnApplyUpdate').addEventListener('click', () => applyUpdate(bar));
}

/** Apply the update: confirm, run via main, handle failure reasons. */
async function applyUpdate(bar) {
  if (_updateBusy) return;
  const btn = document.getElementById('btnApplyUpdate');
  _updateBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Wird aktualisiert…'; }
  try {
    const res = await copilot.updates.apply();
    if (res.ok) {
      if (btn) btn.textContent = 'Neustart…';
      showNotification('Update geladen' + (res.depsInstalled ? ' (inkl. Abhängigkeiten)' : '') + ' — App startet neu.', 'success');
      // Main process relaunches shortly; nothing else to do here.
    } else {
      const msg = updateReasonText(res.reason, res.error);
      showNotification('Update fehlgeschlagen: ' + msg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Herunterladen & Neustarten'; }
    }
  } catch (e) {
    showNotification('Update fehlgeschlagen: ' + (e?.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Herunterladen & Neustarten'; }
  } finally {
    _updateBusy = false;
  }
}

/** Wire the settings "check for updates" button and run the silent startup check. */
function initUpdateChecker() {
  document.getElementById('btnCheckUpdates')?.addEventListener('click', () => checkForUpdates({ silent: false }));
  // Silent check shortly after startup so it never blocks the UI, then
  // periodically while the app stays open.
  setTimeout(() => checkForUpdates({ silent: true }), 3000);
  setInterval(() => checkForUpdates({ silent: true }), UPDATE_CHECK_INTERVAL_MS);
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
    renderProviderStep(body, btnNext);
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
      <p class="onboarding-cwd__desc">Wähle das Verzeichnis, in dem Agent Desktop arbeiten soll. Dort werden deine Sessions und Dateien gespeichert.</p>
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
 * Render the provider-choice step: the user picks which provider to start with
 * (Copilot OR an API provider OR Ollama). Copilot is no longer mandatory — any
 * choice lets the user continue. The choice sets settings.defaultProvider.
 * @param {HTMLElement} body
 * @param {HTMLButtonElement} btnNext
 */
function renderProviderStep(body, btnNext) {
  const choices = [
    { id: 'copilot', label: '🔌 GitHub Copilot', sub: 'CLI-Login, MCP-Unterstützung' },
    { id: 'claude-code', label: '🟣 Claude Code', sub: 'CLI-Login, über dein Claude-Abo' },
    { id: 'anthropic', label: '🟣 Anthropic', sub: 'API-Key (Claude)' },
    { id: 'gemini', label: '🔷 Google Gemini', sub: 'API-Key, Live-Suche' },
    { id: 'openai', label: '🟢 OpenAI', sub: 'API-Key (GPT)' },
    { id: 'glm', label: '🟡 GLM (Zhipu)', sub: 'API-Key' },
    { id: 'ollama', label: '💻 Ollama', sub: 'lokal, kein Key' },
  ];
  const current = getDefaultProvider();
  body.innerHTML = `
    <div class="onboarding-login">
      <h2 class="onboarding-login__title">🧩 Provider wählen</h2>
      <p class="onboarding-login__desc">Womit möchtest du starten? Du kannst das später jederzeit in den Einstellungen ändern und weitere Provider hinzufügen.</p>
      <div class="onboarding-provider-grid">
        ${choices.map(c => `
          <button class="onboarding-provider-card${c.id === current ? ' onboarding-provider-card--active' : ''}" data-provider="${c.id}">
            <span class="onboarding-provider-card__label">${escapeHtml(c.label)}</span>
            <span class="onboarding-provider-card__sub">${escapeHtml(c.sub)}</span>
          </button>`).join('')}
      </div>
      <div class="onboarding-provider-detail" id="onboarding-provider-detail"></div>
    </div>`;

  const detail = document.getElementById('onboarding-provider-detail');
  const select = (provider) => {
    saveSetting('defaultProvider', provider);
    body.querySelectorAll('.onboarding-provider-card').forEach(el =>
      el.classList.toggle('onboarding-provider-card--active', el.dataset.provider === provider));
    // A provider is chosen → the user may continue (login/key are optional and
    // can be completed here or later in settings).
    btnNext.disabled = false;
    renderProviderDetail(detail, provider);
  };

  body.querySelectorAll('.onboarding-provider-card').forEach(card => {
    card.addEventListener('click', () => select(card.dataset.provider));
  });

  // Pre-select the current default so "Weiter" is reachable immediately.
  select(current);
}

/** Render the provider-specific sub-area (Copilot login / API key / Ollama info). */
async function renderProviderDetail(container, provider) {
  if (provider === 'claude-code') {
    container.innerHTML = '<div class="onboarding-login__status">🟣 Claude Code läuft über deine <strong>Claude Code CLI</strong> und dein <strong>Abo</strong> — kein API-Key nötig. Installiere die „claude"-CLI und melde dich einmalig an (<code>claude</code> → Login). Danach kannst du fortfahren.</div>';
    return;
  }
  if (provider === 'copilot') {
    container.innerHTML = '<div class="onboarding-login__status"><span class="onboarding-login__spinner"></span> Prüfe Copilot-Status…</div>';
    let status = { cliInstalled: false, authenticated: false, user: null };
    try { status = await window.copilot.auth.status(); } catch (_) { /* ignore */ }
    if (!status.cliInstalled) {
      container.innerHTML = '<div class="onboarding-login__status onboarding-login__status--warn">⚠️ Copilot-CLI nicht gefunden. Installiere die „copilot"-CLI oder wähle einen API-Provider. Du kannst trotzdem fortfahren.</div>';
    } else if (status.authenticated) {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--ok">✅ Eingeloggt${status.user ? ' als <strong>' + escapeHtml(status.user) + '</strong>' : ''}</div>`;
    } else {
      container.innerHTML = '<div class="onboarding-login__status onboarding-login__status--warn">⚠️ Nicht eingeloggt. <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Jetzt einloggen</button> <button class="action-btn onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button></div>';
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderProviderDetail(container, 'copilot'));
    }
  } else if (provider === 'ollama') {
    container.innerHTML = '<div class="onboarding-login__status">💻 Ollama läuft lokal — kein API-Key nötig. Stelle sicher, dass der Ollama-Server läuft (Standard: localhost:11434).</div>';
  } else {
    // API providers: inline key entry (reuses the secure store).
    const label = PROVIDER_LABELS[provider] || provider;
    const stored = Boolean(_providerStatus.keyed && _providerStatus.keyed[provider]);
    container.innerHTML = `
      <div class="onboarding-login__status">
        🔑 ${escapeHtml(label)}: ${stored ? 'Key bereits hinterlegt.' : 'API-Key eingeben (optional — auch später in den Einstellungen möglich).'}
      </div>
      <div class="onboarding-provider-key">
        <input type="password" id="onboardingProviderKey" class="onboarding-role__input" placeholder="API-Key" autocomplete="off" />
        <button class="action-btn action-btn--primary" id="btnOnboardingSaveKey">Speichern</button>
      </div>`;
    document.getElementById('btnOnboardingSaveKey').addEventListener('click', async () => {
      const key = document.getElementById('onboardingProviderKey').value.trim();
      if (!key) { showNotification('Bitte einen API-Key eingeben.', 'warning'); return; }
      const res = await window.copilot.providers.setKey(provider, key);
      if (res.success) {
        await refreshProviderStatus();
        showNotification(`${label}-Key gespeichert.`, 'success');
        renderProviderDetail(container, provider);
      } else {
        showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
      }
    });
  }
}

/**
 * Handle the login flow within the onboarding wizard. Opens the auth
 * window and provides re-check buttons.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable on success.
 * @returns {Promise<void>}
 */
async function handleOnboardingLogin() {
  const container = document.getElementById('onboarding-provider-detail');
  if (!container) return;
  container.innerHTML = '<div class="onboarding-login__status"><span class="onboarding-login__spinner"></span> Login-Fenster wird geöffnet… Bitte im neuen Fenster einloggen.</div>';

  try {
    const result = await copilot.auth.login();
    if (result.success) {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--warn">ℹ️ Login-Fenster geöffnet. Melde dich dort an und klicke dann <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button></div>`;
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderProviderDetail(container, 'copilot'));
    } else {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--error">❌ Login fehlgeschlagen: ${escapeHtml(result.error || 'Unbekannter Fehler')} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button></div>`;
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
    }
  } catch (e) {
    container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--error">❌ Fehler: ${escapeHtml(e.message)} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button></div>`;
    document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
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
      <p class="onboarding-folders__desc">Agent Desktop benötigt einige Ordner für Skills, Agents, Sessions und Instructions. Diese werden in deinem Home-Verzeichnis angelegt.</p>
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

  // Don't advertise renaming-to-save on providers that can't persist sessions.
  const activeTab = tabs.get(activeTabId);
  if (activeTab && !providerSupports(getTabProvider(activeTab), 'sessions')) return;

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

/**
 * Fades out and removes the app-loading splash shown from first paint until
 * startup finishes. Called from a `finally` so it always runs, even if some
 * startup step throws — otherwise the app could get stuck behind the splash.
 */
function hideAppLoadingSplash() {
  const el = document.getElementById('appLoading');
  if (!el) return;
  el.classList.add('app-loading--hidden');
  setTimeout(() => el.remove(), 300); // match the CSS opacity transition
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadPreferences();
    migrateDeniedToolsToPerProvider();
    initCopilotModels(); // seed the persisted model lists before tabs/dropdowns render
    refreshAllProviderModels(); // discover direct-API provider models in the background
    applyTheme(getCurrentTheme());
    initCopilotIPC();
    initResize();

    await initStatusbar();
    await initDataLoad();

    const restored = await restoreOpenTabs();
    if (!restored) {
      await createTab('🤖 Chat');
    } else {
      // Re-run after restore so project skills load with the now-set tab.cwd.
      // (createTab triggers switchTab before tab.cwd is assigned, so the first
      // loadProjectSkillsAndAgents call runs with null cwd and clears results.)
      const restoredActiveTab = tabs.get(activeTabId);
      if (restoredActiveTab?.cwd) {
        loadProjectSkillsAndAgents(restoredActiveTab.cwd);
      }
    }

    initChatInput();
    initWindowControls();
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
    initTabModeSelector();
    initGeminiModeToggle();
    initContextInfo();
    initOnboarding();
    refreshProviderStatus();
    initUpdateChecker();
    initDynamicPricing();
    initSubscriptionUsageTicker();
  } finally {
    hideAppLoadingSplash();
  }
});

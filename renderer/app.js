// Capture renderer console for dev console + file logging
const _rendererOrigLog = console.log;
const _rendererOrigWarn = console.warn;
const _rendererOrigError = console.error;

/**
 * Single console override: original console + main-process file logger +
 * in-app dev console (modules/dev-console.js loads before app.js, so
 * addDevConsoleEntry — which caps its buffer — exists here). Deliberately ONE
 * chain: a previous version had initDevConsole() re-override these again,
 * which silently dropped the file-log leg, and kept every line forever in an
 * uncapped window._rendererLogs array (slow leak).
 * @param {'info'|'warn'|'error'} level
 * @param {Array} args - Console arguments.
 */
function _rendererLog(level, args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (typeof addDevConsoleEntry === 'function') {
    addDevConsoleEntry({ level, message: '[renderer] ' + msg, timestamp: Date.now() });
  }
  try { window.desktop.log.write(level, '[renderer] ' + msg); } catch (_) { /* bridge not ready */ }
}

console.log = (...args) => { _rendererOrigLog(...args); _rendererLog('info', args); };
console.warn = (...args) => { _rendererOrigWarn(...args); _rendererLog('warn', args); };
console.error = (...args) => { _rendererOrigError(...args); _rendererLog('error', args); };

// skills, agents, mcpServers, globalMcpServers, _liveMcpStatus →
// modules/skills-mcp.js

// marketplaces, installedPlugins → modules/plugins.js

// ── State ────────────────────────────────────────────────────
// sessions, activeSessionId → modules/sessions-sidebar.js
// activeAgents → modules/skills-mcp.js
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
 * @type {Map<string, {streamEl: HTMLElement, statusEl: HTMLElement, label: string, sessionId: string|null, isProcessing: boolean, lastActivityAt: number|null, terminal?: Object, mode: string, selectedModel: string|null, reasoningByModel: Object<string, string|null>, context: Object}>}
 */
const tabs = new Map();
// pendingToolCalls → modules/agent-ipc.js
/** @type {string|null} Tab ID of the currently visible/active tab. */
let activeTabId = null; // eslint-disable-line prefer-const -- reassigned in modules/tabs.js (switchTab, startTabRename)
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
/**
 * Scrolls a tab's stream to the bottom — batched to one real scroll per
 * animation frame. Callers fire this for every streamed delta/tool event;
 * reading scrollHeight synchronously each time forced a full layout pass per
 * event, which on a large chat DOM dominated streaming cost. Deferring into
 * rAF coalesces any number of calls per frame into a single layout.
 */
function scrollToBottom(streamEl) {
  if (!streamEl || streamEl._scrollPending) return;
  streamEl._scrollPending = true;
  requestAnimationFrame(() => {
    streamEl._scrollPending = false;
    // Check per-tab autoScroll flag (default true) at execution time.
    const tabEntry = [...tabs.entries()].find(([, t]) => t.streamEl === streamEl);
    if (tabEntry && tabEntry[1].autoScrollEnabled === false) return;
    streamEl.scrollTop = streamEl.scrollHeight;
    // Keep the direction baseline in sync so this jump is never later read as
    // the user scrolling up (see initAutoScroll).
    streamEl._lastScrollTop = streamEl.scrollTop;
  });
}

function initAutoScroll(streamEl) {
  streamEl.addEventListener('scroll', () => {
    const prevTop = streamEl._lastScrollTop ?? 0;
    const curTop = streamEl.scrollTop;
    streamEl._lastScrollTop = curTop;
    const atBottom = streamEl.scrollHeight - curTop - streamEl.clientHeight < SCROLL_BOTTOM_THRESHOLD;
    // Only an actual upward scroll means "user wants to stay put". Deriving it
    // from atBottom alone breaks with batched scrolling: content appended
    // between scrollToBottom()'s rAF write and this event makes the element
    // look scrolled-away, which latched auto-scroll off permanently.
    const scrolledUp = curTop < prevTop - 1;
    const tabEntry = [...tabs.entries()].find(([, t]) => t.streamEl === streamEl);
    if (tabEntry) {
      if (atBottom) tabEntry[1].autoScrollEnabled = true;
      else if (scrolledUp) tabEntry[1].autoScrollEnabled = false;
    }
    const btn = document.getElementById('btnScrollBottom');
    if (btn) btn.style.display = atBottom ? 'none' : 'flex';

    // Near the top → pull back in older messages pruned from the DOM (see
    // pruneOldMessages), like scrolling up in a normal chat history.
    if (tabEntry && streamEl.scrollTop < SCROLL_BOTTOM_THRESHOLD) {
      restorePrunedHistory(tabEntry[1]);
    }
  });
}

// ── Chat History Pruning ────────────────────────────────────
// Long-running tabs (hours of use, or a resumed session with lots of
// history) keep every message in the DOM forever, which makes every reflow
// (typing, tab switches) slower as the page grows. Content older than
// CHAT_HISTORY_PRUNE_AGE_MS gets detached from the DOM and kept in memory
// (tab._prunedNodes, oldest-first) instead — cheap to hold, no layout cost —
// and is reinserted in batches when the user scrolls near the top, like
// infinite scroll in reverse.
const CHAT_HISTORY_PRUNE_AGE_MS = 30 * 60 * 1000;
const CHAT_HISTORY_RESTORE_BATCH = 30;

/**
 * Detaches stream children older than CHAT_HISTORY_PRUNE_AGE_MS from the DOM.
 * Only top-of-turn elements (.stream-input, history bubbles) carry a
 * `data-ts` timestamp; everything between one and the next inherits its age
 * — children are always chronological, so age is monotonically increasing
 * and scanning stops at the first still-fresh element. The most recent turn
 * is always left in place so a quiet tab never looks empty.
 * @param {Object} tab
 */
function pruneOldMessages(tab) {
  if (!tab?.streamEl) return;
  const cutoff = Date.now() - CHAT_HISTORY_PRUNE_AGE_MS;
  const children = [...tab.streamEl.children];
  let lastTs = null;
  let lastTurnStart = -1;
  const toPrune = [];
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el === tab.statusEl) break;
    if (el.dataset.ts) { lastTs = Number(el.dataset.ts); lastTurnStart = toPrune.length; }
    if (lastTs == null) continue; // age not established yet — leave it, keep scanning
    if (lastTs < cutoff) {
      toPrune.push(el);
    } else {
      break; // first still-fresh element — everything after is newer
    }
  }
  // Never prune the last turn we saw, even if it qualifies, so the view
  // isn't left empty.
  const keepFrom = lastTurnStart >= 0 ? lastTurnStart : toPrune.length;
  const pruneNow = toPrune.slice(0, keepFrom);
  if (pruneNow.length === 0) return;

  tab._prunedNodes = tab._prunedNodes || [];
  for (const el of pruneNow) {
    el.remove();
    tab._prunedNodes.push(el);
  }
}

/**
 * Reinserts the most recently pruned batch of messages at the top of the
 * stream, adjusting scrollTop so the visible content doesn't jump.
 * Entries in _prunedNodes are either real (detached) elements from live
 * pruning, or builder FUNCTIONS staged by insertHistoryGroups() — those are
 * only now turned into elements (incl. their markdown parse), so restoring a
 * long history costs one batch at a time instead of everything on resume.
 * @param {Object} tab
 */
function restorePrunedHistory(tab) {
  if (!tab?._prunedNodes?.length || !tab.streamEl || tab._restoringHistory) return;
  const streamEl = tab.streamEl;
  // Guard against re-entrancy: the scrollTop write below fires another
  // 'scroll' event, which would otherwise immediately re-trigger this same
  // restore (still "near the top") and drain _prunedNodes in a tight loop.
  tab._restoringHistory = true;
  const batch = tab._prunedNodes.splice(-CHAT_HISTORY_RESTORE_BATCH, CHAT_HISTORY_RESTORE_BATCH);
  const prevScrollHeight = streamEl.scrollHeight;
  const prevScrollTop = streamEl.scrollTop;
  const firstChild = streamEl.firstChild;
  for (const entry of batch) {
    const els = typeof entry === 'function' ? entry() : [entry];
    for (const el of els) streamEl.insertBefore(el, firstChild);
  }
  streamEl.scrollTop = prevScrollTop + (streamEl.scrollHeight - prevScrollHeight);
  requestAnimationFrame(() => { tab._restoringHistory = false; });
}

// Periodic sweep across all tabs — catches tabs left open and idle rather
// than only pruning right after a turn finishes in that specific tab.
setInterval(() => tabs.forEach(pruneOldMessages), 5 * 60 * 1000);

const THEMES = ['light', 'dark'];

// ── Preferences (file-based persistence) ────────────────────
/** @type {Object<string, *>} In-memory cache of user preferences (file-backed). */
let _prefs = {};

/**
 * Load all user preferences from the main process file store into memory.
 * @returns {Promise<void>}
 */
async function loadPreferences() {
  try {
    _prefs = await desktop.preferences.read() || {};
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

/** @type {number|null} Debounce timer for the preferences write. */
let _prefsSaveTimer = null;

/** Persists the in-memory prefs to disk now (used by the debounce + unload flush). */
function _flushPrefs() {
  if (_prefsSaveTimer) { clearTimeout(_prefsSaveTimer); _prefsSaveTimer = null; }
  desktop.preferences.write(_prefs).catch(e => {
    console.warn('[prefs] Speichern fehlgeschlagen:', e.message);
  });
}

/**
 * Write a preference value and persist asynchronously to disk — debounced.
 * setPref serializes the WHOLE prefs object over IPC and the main process
 * rewrites the file; callers like saveOpenTabs() fire on every tab render,
 * so bursts are collapsed into one write. The unload flush below covers the
 * shutdown race (a write scheduled <300ms before closing the window).
 * @param {string} key - Preference key.
 * @param {*} value - Value to store.
 */
function setPref(key, value) {
  _prefs[key] = value;
  if (_prefsSaveTimer) return;
  _prefsSaveTimer = setTimeout(_flushPrefs, 300);
}

window.addEventListener('beforeunload', () => { if (_prefsSaveTimer) _flushPrefs(); });

// REASONING_EFFORTS, VALID_REASONING_EFFORTS, normalizeReasoningEffort,
// normalizeKnownReasoningEffort, normalizeReasoningByModel,
// reasoningEffortMeta, reasoningEffortLabel → modules/model-catalog.js

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
    const reasoningByModel = normalizeReasoningByModel(tab.reasoningByModel);
    tab.reasoningByModel = reasoningByModel;
    if (tab.sessionId) {
      openTabs.push({
        sessionId: tab.sessionId,
        label: tab.label,
        selectedModel: tab.selectedModel || null,
        provider,
        reasoningByModel,
      });
      saveSessionReasoningByModel(tab.sessionId, reasoningByModel);
      // Persist denied tools in namedSessions
      saveSessionDeniedTools(tab.sessionId, tab.sessionDeniedTools || []);
    } else if (
      provider !== getDefaultProvider()
      || (tab.selectedModel && tab.selectedModel !== getDefaultModelId())
      || Object.keys(reasoningByModel).length > 0
    ) {
      // Unsent tab with a non-default provider/model chosen.
      openTabs.push({
        sessionId: null,
        label: tab.label,
        selectedModel: tab.selectedModel,
        provider,
        reasoningByModel,
      });
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
      const sessionReasoningByModel = t.sessionId ? getSessionReasoningByModel(t.sessionId) : {};
      const reasoningByModel = {
        ...sessionReasoningByModel,
        ...normalizeReasoningByModel(t.reasoningByModel),
      };
      const tabId = await createTab(label, model, t.provider, reasoningByModel);
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

/**
 * Get the persisted model-to-reasoning map for a session.
 * @param {string} sessionId
 * @returns {Object<string, string|null>}
 */
function getSessionReasoningByModel(sessionId) {
  const all = getPref('sessionReasoningByModel', {});
  if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
  return normalizeReasoningByModel(all[sessionId]);
}

/**
 * Persist the model-to-reasoning map for a session.
 * @param {string} sessionId
 * @param {Object<string, string|null>} reasoningByModel
 */
function saveSessionReasoningByModel(sessionId, reasoningByModel) {
  if (!sessionId) return;
  const stored = getPref('sessionReasoningByModel', {});
  const all = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  all[sessionId] = normalizeReasoningByModel(reasoningByModel);
  setPref('sessionReasoningByModel', all);
}

/** Persist the complete model selection state for a session. */
function saveSessionModelConfiguration(sessionId, tab) {
  if (!sessionId || !tab) return;
  if (tab.selectedModel) saveSessionModel(sessionId, tab.selectedModel);
  saveSessionReasoningByModel(sessionId, tab.reasoningByModel);
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
  const devRow = document.getElementById('sidebarDevRow');
  if (devRow) devRow.style.display = enabled ? '' : 'none';
  // Hide console panel when devMode is disabled
  if (!enabled) {
    const panel = document.getElementById('devConsolePanel');
    if (panel) panel.style.display = 'none';
  }
  const onboardingResetGroup = document.getElementById('settOnboardingResetGroup');
  const onboardingResetSeparator = document.getElementById('settOnboardingResetSeparator');
  if (onboardingResetGroup) onboardingResetGroup.style.display = enabled ? '' : 'none';
  if (onboardingResetSeparator) onboardingResetSeparator.style.display = enabled ? '' : 'none';
  // The adapter-update banner is a developer affordance (see
  // checkClaudeAdapterUpdate) — a banner already on screen has to go when dev
  // mode is switched off, otherwise it would sit there un-dismissable by the
  // rules that produced it.
  if (!enabled) document.getElementById('claudeAdapterUpdateBanner')?.remove();
}

// _audioCtx, playNotificationSound, stripShellWrapper, renderTagList,
// initTagInput, withButtonBusy, emptyStateHtml, showNotification →
// modules/utils.js

// createTab, switchTab, closeTab, renderTabs, _draggedTabId, reorderTabs,
// startTabRename → modules/tabs.js

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

  try { desktop.chat.stop(tabId); } catch (_) {}
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

  const tabProvider = getTabProvider(tab);
  // Guard: a Copilot model that the CLI no longer offers (removed from the
  // dynamic list) can't be used — tell the user instead of failing opaquely.
  if (tabProvider === 'copilot' && tab.selectedModel && !isCopilotModelAvailable(tab.selectedModel)) {
    showNotification(`Modell „${tab.selectedModel}" ist bei Copilot nicht mehr verfügbar. Bitte im 🧠-Menü ein anderes wählen.`, 'error');
    return;
  }

  // Show user message in stream
  const inputEl = document.createElement('div');
  inputEl.className = 'stream-input';
  inputEl.textContent = text;
  // Marks the start of a new "turn" for pruneOldMessages() — everything
  // inserted after this until the next .stream-input belongs to this turn's
  // age, so only turn-starts need a timestamp.
  const sentAt = Date.now();
  inputEl.dataset.ts = String(sentAt);
  // Separate from dataset.ts above: that one is reused (and rewritten to
  // "now") for restored history to drive pruning — this one is the actual
  // send time, shown to the user, and must NOT be set for history bubbles
  // where we don't know the real original time (see renderSimpleHistory).
  inputEl.dataset.time = formatMessageTime(sentAt);
  tab.streamEl.insertBefore(inputEl, tab.statusEl);

  // Build skill instructions prefix for this tab's active skills
  let skillPrefix = '';
  const activeSkillInfos = [];
  if (tab.activeSkills.size > 0) {
    for (const id of tab.activeSkills) {
      const s = skills.find(sk => sk.id === id);
      if (s) {
        activeSkillInfos.push({ name: s.name, icon: s.icon || '🧩' });
      }
    }
    if (activeSkillInfos.length > 0) {
      const skillNames = [...tab.activeSkills].map(id => {
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
  const mergedDenied = [...new Set([...getDeniedTools(tabProvider), ...sessionDenied])];
  const effort = (tabProvider === 'copilot' || isClaudeCodeProvider(tabProvider)) && tab.selectedModel
    ? getReasoningForModel(tab, tab.selectedModel)
    : null;

  const sendTabId = activeTabId;
  // Freeze the model this prompt actually runs on. The token delta measured after
  // completion must be priced at THIS model — not tab.selectedModel, which the
  // user may switch (for the next prompt) before /usage is read.
  tab._billingModel = tab.selectedModel || DEFAULT_MODEL_ID;
  desktop.chat.send(activeTabId, agentPrefix + skillPrefix + text, {
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
    effort: effort || undefined,
    provider: tabProvider,
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
 * Handle the result of desktop.chat.send. On success the backend streams events
 * and emits agent:done; on failure no events arrive, so we must unstick the
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
    desktop.window.relaunch().catch((e) => {
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
      const r = await desktop.auth.login();
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

// finalizeResponseBubble, appendStreamError, initAgentIPC → modules/agent-ipc.js
// Make functions available from HTML onclick
window.switchTab = switchTab;
window.closeTab = closeTab;
window.resumeSession = resumeSession;
window.confirmDeleteSession = confirmDeleteSession;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;

// DEFAULT_MODEL_ID, DEFAULT_MODELS, modelTierBadge, PROVIDER_LABELS,
// SETTINGS_TAB_LABELS, providerStageBadge, getProvidersWithModels,
// getDefaultProvider, getDefaultModelForProvider,
// saveDefaultModelForProvider, getDefaultReasoningForProvider,
// saveDefaultReasoningForProvider, getSavedModeForProvider,
// saveModeForProvider, renderDefaultModelSettings,
// renderProviderReasoningSelect, renderProviderModelSelect,
// applyDynamicModels, updateCopilotModels, initCopilotModels,
// refreshProviderModels, refreshAllProviderModels, isCopilotModelAvailable,
// getShowPaidModels, setShowPaidModels, getModelsForProvider,
// getTabProvider, getReasoningForModel, selectModelForTab, PROVIDER_SHORT,
// providerIconHtml, isClaudeCodeProvider, getClaudeCodeSshHost/Cwd,
// isAcpProvider, providerHasReasoning, isSubscriptionProvider,
// PROVIDER_CAPABILITIES, providerSupports, renderFeatureMatrix,
// updateSidebarForProvider, updateProviderSelectBtn, updateGeminiModeBtn,
// initGeminiModeToggle, refreshProviderStatus, getAvailableModels →
// modules/model-catalog.js

// DEFAULT_MODE_ID, SESSION_MODES, _dynamicModes, getModesForProvider,
// updateModeSelectBtn, getDefaultModelId, updateModelSelectBtn,
// updateProviderSpecificControls, updateApprovalBtn, toggleApproval,
// initTabModelSelector, initTabModeSelector → modules/model-catalog.js

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

  // /context and /clear don't call the model — they should return near-
  // instantly, so a short timeout surfaces a stuck adapter as a visible error
  // in seconds instead of leaving the button on the hourglass for 3 minutes
  // (the default slash-command timeout, sized for /compact's LLM call).
  const FAST_COMMAND_TIMEOUT_MS = 20_000;

  try {
    if (actionId === 'show') {
      const result = await window.desktop.chat.silentCommand(activeTabId, '/context', FAST_COMMAND_TIMEOUT_MS);
      if (result.success) {
        updateContextButton(result.text);
        showContextPanel(result.text);
      } else {
        showNotification('Kontext-Abfrage fehlgeschlagen: ' + (result.error || 'unbekannter Fehler'), 'error');
      }
    } else if (actionId === 'compact') {
      const result = await window.desktop.chat.silentCommand(activeTabId, '/compact');
      if (!result.success) {
        showNotification('Compact fehlgeschlagen: ' + (result.error || 'unbekannter Fehler'), 'error');
      } else {
        // /compact response may contain context info; also query explicitly
        const ctx = await window.desktop.chat.silentCommand(activeTabId, '/context', FAST_COMMAND_TIMEOUT_MS);
        if (ctx.success) updateContextButton(ctx.text);
        showNotification('Kontext komprimiert.', 'success');
      }
    } else if (actionId === 'clear') {
      const result = await window.desktop.chat.silentCommand(activeTabId, '/clear', FAST_COMMAND_TIMEOUT_MS);
      if (!result.success) {
        showNotification('Clear fehlgeschlagen: ' + (result.error || 'unbekannter Fehler'), 'error');
      } else {
        const ctx = await window.desktop.chat.silentCommand(activeTabId, '/context', FAST_COMMAND_TIMEOUT_MS);
        if (ctx.success) updateContextButton(ctx.text);
        showNotification('Kontext gelöscht.', 'success');
      }
    }
  } catch (err) {
    console.warn('[context]', err.message);
    showNotification('Aktion fehlgeschlagen: ' + err.message, 'error');
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
    const map = await window.desktop.pricing.getMap();
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
    const result = await window.desktop.chat.silentCommand(tabId, '/usage');
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
/**
 * Books the tokens consumed since this tab's last `/usage` read into the token
 * history, tagged with the limit window they fell into.
 *
 * The table in `/usage` is cumulative per Claude Code session, so only the
 * delta is new consumption. The first read of a resumed session establishes the
 * baseline WITHOUT booking it — otherwise the whole pre-existing total would
 * land in the current window as if it had just been used (the same reasoning as
 * `_usageBaselinePending` on the Copilot path).
 *
 * A drop in the TOTAL means the counter restarted (new session in the same
 * tab); that resets the baseline instead of booking a nonsensical amount. See
 * computeClaudeTokenDelta() for why a single key dipping is NOT treated as a
 * restart — that used to be the case and is why this history stayed
 * permanently empty: the K/M-suffixed values in /usage are rounded, so
 * individual counters routinely appear to dip between two readings.
 * @param {Object} tab
 * @param {string} usageText - Raw `/usage` output.
 */
function recordClaudeTokenDelta(tab, usageText) {
  const tokens = window.RendererLogic.parseClaudeSessionTokens(usageText);
  if (!tokens) return; // older adapter or changed format — nothing to book
  const prev = tab._lastClaudeTokens;
  tab._lastClaudeTokens = tokens;
  if (!prev) return; // baseline only

  const { delta, restarted } = window.RendererLogic.computeClaudeTokenDelta(tokens, prev);
  if (restarted) return;
  const sum = delta.input + delta.output + delta.cacheRead + delta.cacheWrite;
  if (sum <= 0) return;

  // The window these tokens count against: the 5-hour limit reported right now.
  const five = (tab._subUsageWindows || []).find(w => w.rateLimitType === 'five_hour');
  if (!five || typeof five.resetsAt !== 'number') return; // no window → nothing to group by
  recordTokenDelta({ resetsAt: five.resetsAt, sessionId: tab.sessionId || null, ...delta });
}

async function refreshSubscriptionUsage(tabId) {
  try {
    const result = await window.desktop.chat.silentCommand(tabId, '/usage');
    if (!result.success) {
      console.warn('[usage] /usage nicht ausführbar:', result.error || '(kein Grund gemeldet)');
      return;
    }
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab._subUsageWindows = parseUsageWindows(result.text, Date.now());
    // Text da, aber nichts erkannt → das Ausgabeformat hat sich geändert.
    // Genau so ist der Wechsel auf Markdown in Adapter 0.75.0 unbemerkt
    // geblieben: die Anzeige wurde still leer, ohne Fehler und ohne Log.
    if (!tab._subUsageWindows.length && (result.text || '').trim()) {
      console.warn('[usage] /usage lieferte Text, aber kein bekanntes Limit-Format — Parser veraltet?',
        (result.text || '').slice(0, 200));
    }
    recordClaudeTokenDelta(tab, result.text);
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
    const res = await window.desktop.chat.silentCommand(tabId, '/context');
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
    const res = await window.desktop.chat.silentCommand(tabId, '/context');
    if (!res.success) return;
    setTabContext(tabId, res.text);

    const pct = parseContextPercent(res.text);
    if (pct != null && pct >= AUTO_COMPACT_PERCENT) {
      showNotification(`Kontext bei ${pct}% — wird automatisch verdichtet…`, 'info');
      await window.desktop.chat.silentCommand(tabId, '/compact');
      const after = await window.desktop.chat.silentCommand(tabId, '/context');
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
  if (!el || !tab || !isClaudeCodeProvider(getTabProvider(tab))) return;
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
  try { desktop.chat.respondPermission(tabId, requestId, optionId || null); } catch (_) { /* ignore */ }
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

// loadSessions, renderSessions, clampMenuToViewportLeft/Right,
// openSessionCardMenu, startSessionRename, pickSessionCwd, changeTabCwd,
// clearTabStream, deleteNamedSessionEntry, resumeSession, resumeSessionById,
// displaySessionContext, insertHistoryGroups, renderSimpleHistory,
// renderApiHistory, confirmDeleteSession, executeDeleteSession,
// cancelDeleteSession, filterSessions, isSessionIdLike →
// modules/sessions-sidebar.js

// renderSkills, toggleSkill, mergeMcpByName, refreshMcpStatus,
// renderMcpServers, loadContextForTab, reloadSkills, reloadAgents,
// loadProjectMcpServers, renderAgents, toggleAgent → modules/skills-mcp.js

// loadPlugins, getPluginStatus, getInstalledVersion, renderPlugins,
// renderPluginTile, installPlugin/uninstallPlugin/updatePlugin,
// showAddPluginDialog, initPluginButtons, pluginsViewActive,
// removeMarketplace, switchToPluginsView, switchToCostsView,
// switchToChatView → modules/plugins.js

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

// filterSessions, isSessionIdLike → modules/sessions-sidebar.js

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
    // Kein "Verwalten" mehr: Skills werden dort gepflegt, wo sie liegen — in
    // den Ordnern des jeweiligen Providers. Ein app-eigenes Verstecken/
    // Deaktivieren stand dem im Weg, weil es providerübergreifend wirkte und
    // seinen Zustand in Copilots settings.json schrieb.
    buildHtml: () => `
      <div class="section-menu__item" data-action="reload">↻ Skills neu laden</div>
    `,
    wire(menu, close) {
      menu.querySelector('[data-action="reload"]').addEventListener('click', async (e) => {
        e.currentTarget.innerHTML = '<span class="btn-spinner"></span> Wird geladen…';
        await reloadSkills();
        close();
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
  clampMenuToViewportLeft(menu);

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

// formatDate → modules/utils.js

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
    const folders = await desktop.folders.read();
    userHomeDir = folders.homeDir || '';
  } catch (e) { console.warn('[app] Home-Verzeichnis nicht geladen:', e.message); }

  try {
    const cwd = await desktop.chat.getCwd();
    if (cwd && !tabs.get(activeTabId)?.cwd) {
      const tab = tabs.get(activeTabId);
      if (tab) tab.cwd = cwd;
    }
  } catch (e) { console.warn('[app] CWD nicht geladen:', e.message); }

  try {
    const ver = await desktop.chat.getVersions();
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
  // Skills/Agents werden nicht hier geladen: sie hängen an Provider und
  // Projekt des aktiven Tabs, und der existiert zu diesem Zeitpunkt noch
  // nicht. Das übernimmt loadContextForTab() beim ersten switchTab().
  const savedActiveAgents = getSettings().activeAgents || [];
  activeAgents = new Set(savedActiveAgents);

  try {
    globalMcpServers = await desktop.mcp.list() || [];
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
  desktop.images.onChanged(() => loadImages());

  loadPlugins().catch(e => console.warn('[plugins] Hintergrundladen fehlgeschlagen:', e.message));
}

/**
 * Auto-resizes the chat textarea to fit its content, growing upward. The
 * rich-text/send buttons are pinned inside the input's bottom-right corner
 * (see .chat-input-wrapper) on top of a full-width textarea — for a single
 * line this deliberately lets the text run underneath them. Once content
 * wraps past one line, an extra line's worth of height is added so the last
 * line of text clears the button row instead of sitting behind it.
 */
function resizeChatInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  const cs = getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const singleLineHeight = lineHeight + paddingV;
  const natural = el.scrollHeight;
  const extra = natural > singleLineHeight + 1 ? lineHeight : 0;
  el.style.height = Math.min(natural + extra, CHAT_INPUT_MAX_HEIGHT) + 'px';
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
      resizeChatInput(chatInput);
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
      resizeChatInput(chatInput);
    }
  });

  chatInput.addEventListener('input', () => resizeChatInput(chatInput));

  // Rich-Text contenteditable key handling
  chatInputRich.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
    }
    // Normal Enter and Shift+Enter insert line break (default behavior)

    // Tab/Shift+Tab inside a list item nests/un-nests it one level deeper —
    // outside a list, Tab keeps its default behavior (move focus away).
    if (e.key === 'Tab') {
      const inList = document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList');
      if (inList) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
      }
    }
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
      resizeChatInput(chatInput);
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
  dropdown.style.top = `${rect.bottom + 4}px`;
  // Left-align to the button by default (grows rightward, under where the
  // eye already is after clicking "+") — clamped back onto the viewport
  // below, once the dropdown is in the DOM and its real width is known, in
  // case the button sits close enough to the right edge that it'd overflow.
  dropdown.style.left = `${rect.left}px`;

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
  clampMenuToViewportRight(dropdown);
  closeHandler = (ev) => { if (!dropdown.contains(ev.target) && ev.target !== btn) close(); };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
}

/**
 * Wire up window control buttons (minimize, maximize, close), terminal
 * toggle, export, scroll-to-bottom, and window resize handling.
 */
function initWindowControls() {
  document.getElementById('btnWindowMinimize').addEventListener('click', () => desktop.window.minimize());
  document.getElementById('btnWindowMaximize').addEventListener('click', () => desktop.window.maximize());
  document.getElementById('btnWindowClose').addEventListener('click', () => desktop.window.close());
  document.getElementById('btnOpenDevTools')?.addEventListener('click', () => desktop.window.openDevTools());

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
      await desktop.todos.update(tab.cwd, todo.id, { status: 'done' });
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
  const fontSize = savedSettings.chatFontSize || 14;
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
  // Copilot's own default-model/-reasoning selects live in its static provider tab.
  renderProviderModelSelect('copilot', document.getElementById('settProviderModel-copilot'));
  renderProviderReasoningSelect('copilot', document.getElementById('settProviderReasoning-copilot'));
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
  settDevMode.addEventListener('change', () => {
    saveSetting('devMode', settDevMode.checked);
    applyDevMode(settDevMode.checked);
    // Switching dev mode on shouldn't mean waiting up to 6h for the next
    // scheduled adapter check before the banner can appear.
    if (settDevMode.checked) checkClaudeAdapterUpdate();
  });
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
    const folders = await desktop.folders.read();
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
    const result = await desktop.folders.save({ [key]: value });
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
      const folder = await desktop.folders.browse();
      if (!folder) return;
      document.getElementById(input).value = folder;
      await autoSaveFolderField(key, folder);
    });
  });

  // Instructions file browse (file dialog, not folder) — auto-saves too.
  document.getElementById('btnBrowseInstructions').addEventListener('click', async () => {
    const file = await desktop.folders.browseFile([{ name: 'Markdown', extensions: ['md'] }]);
    if (!file) return;
    document.getElementById('settFolderInstructions').value = file;
    await autoSaveFolderField('instructionsFile', file);
  });

  // Instructions editor
  document.getElementById('btnEditInstructions').addEventListener('click', async () => {
    const result = await desktop.instructions.read();
    if (!result.success) {
      showNotification(`Fehler: ${result.error}`, 'error');
      return;
    }
    openInstructionsEditor(result.content, result.path);
  });

  // Resets ALL folder config (App + Copilot tab fields) back to defaults —
  // the one action that intentionally does NOT merge, so it gets its own IPC.
  document.getElementById('btnFoldersReset').addEventListener('click', async () => {
    const result = await desktop.folders.reset();
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
    const { onboardingComplete } = await desktop.dev.getOnboardingState();
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
    const { onboardingComplete } = await desktop.dev.getOnboardingState();
    const result = await desktop.dev.setOnboardingComplete(!onboardingComplete);
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
 * @param {(content: string) => Promise<{success: boolean, error?: string}>} [opts.writeFn] - Defaults to desktop.instructions.write.
 */
function openInstructionsEditor(content, filePath, opts = {}) {
  const title = opts.title || '📝 Copilot Instructions';
  const writeFn = opts.writeFn || ((c) => desktop.instructions.write(c));

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

// initTestRunner → modules/test-runner.js

// PROVIDER_SETTINGS, getConnectedProviders/getConnectedProviderConfigs,
// buildProviderConfigPanelHtml, pickRemoteFolder, wireClaudeCodeSshPanel,
// wireProviderConfigPanel, renderProviderConfigTabs, renderProvidersSettings,
// getProviderBaseUrl, saveProviderBaseUrl, renderCopilotProviderRow →
// modules/provider-settings.js

// initDevConsole → modules/dev-console.js

// initChatSearch → modules/chat-search.js

// SHORTCUT_DEFS, FIXED_SHORTCUTS, getShortcut, saveShortcut,
// resetAllShortcuts, matchShortcut, shortcutLabel, renderShortcutsHelp,
// initShortcutsSettings, initKeyboardShortcuts → modules/keyboard-shortcuts.js

// initDragDrop → modules/drag-drop.js

// checkForUpdates, updateReasonText, showUpdateBanner, applyUpdate,
// initUpdateChecker, checkClaudeAdapterUpdate, showClaudeAdapterUpdateBanner,
// applyClaudeAdapterUpdateFromBanner, initClaudeAdapterUpdateChecker →
// modules/self-update.js

/**
 * Wires every dynamically-rendered list (skills, agents, sessions, skill
 * manager, plugins) through delegated listeners on their static containers.
 *
 * These lists used to carry inline `onclick="fn('<value>')"` handlers. That is
 * unsafe here regardless of escaping: the browser HTML-decodes an attribute
 * BEFORE the JS parser sees it, so an `&#39;` produced by escapeAttr turns
 * back into a real quote and a crafted value (skill/agent name from any
 * third-party SKILL.md, including auto-mirrored marketplace plugins) could
 * break out of the string and run arbitrary code with full access to the
 * window.copilot bridge. Reading the same values from data-* attributes at
 * click time removes that class of bug entirely — values are never parsed as
 * code. Containers are static in index.html, so one listener each is enough
 * and survives every re-render.
 */
function initListActionDelegation() {
  const on = (containerId, handler) => {
    const el = document.getElementById(containerId);
    if (el) el.addEventListener('click', handler);
  };

  on('skillList', (e) => {
    const card = e.target.closest('.skill-card');
    if (card?.dataset.skillId) toggleSkill(card.dataset.skillId);
  });

  on('agentList', (e) => {
    const card = e.target.closest('.agent-card');
    if (card?.dataset.agentId) toggleAgent(card.dataset.agentId);
  });

  on('sessionList', (e) => {
    const menuBtn = e.target.closest('[data-session-menu]');
    if (menuBtn) {
      e.stopPropagation();
      openSessionCardMenu(menuBtn.dataset.sessionMenu, menuBtn);
      return;
    }
    const byId = e.target.closest('[data-resume-by-id]');
    if (byId) { resumeSessionById(byId.dataset.resumeById); return; }
    const main = e.target.closest('[data-resume-session]');
    if (main) resumeSession(main.dataset.resumeSession);
  });

  on('pluginList', (e) => {
    const install = e.target.closest('[data-install-plugin]');
    if (install) { installPlugin(install.dataset.installPlugin); return; }
    const uninstall = e.target.closest('[data-uninstall-plugin]');
    if (uninstall) { uninstallPlugin(uninstall.dataset.uninstallPlugin); return; }
    const update = e.target.closest('[data-update-plugin]');
    if (update) { updatePlugin(update.dataset.updatePlugin); return; }
    const removeMp = e.target.closest('[data-remove-marketplace]');
    if (removeMp) { removeMarketplace(removeMp.dataset.removeMarketplace); return; }
    const clickTarget = e.target.closest('[data-click-target]');
    if (clickTarget) document.getElementById(clickTarget.dataset.clickTarget)?.click();
  });

  on('pluginSidebar', (e) => {
    const scrollTo = e.target.closest('[data-scroll-to]');
    if (scrollTo) document.getElementById(scrollTo.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth' });
  });

  // Static markup in index.html used to carry inline onclick handlers too.
  // Those weren't injectable (no interpolation), but they forced
  // script-src 'unsafe-inline' in the CSP, which in turn made any *other*
  // escaping slip directly exploitable. Routing them through one delegated
  // listener lets the CSP drop 'unsafe-inline' entirely.
  document.addEventListener('click', (e) => {
    // The ⋮ button sits INSIDE the section header, so the more specific match
    // has to win. Checking the header first would swallow every menu click —
    // closest() walks up from the button and finds the header, and a single
    // delegated listener can't stopPropagation against itself. That's exactly
    // what the old inline `event.stopPropagation()` used to handle.
    const sectionMenu = e.target.closest('[data-section-menu]');
    if (sectionMenu) {
      openSectionMenu(sectionMenu.dataset.sectionMenu, sectionMenu);
      return;
    }

    const section = e.target.closest('[data-toggle-section]');
    if (section) { toggleSection(section.dataset.toggleSection); return; }

    const action = e.target.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
      case 'open-images-folder': openImagesFolder(); break;
      case 'toggle-plugins-view': pluginsViewActive ? switchToChatView() : switchToPluginsView(); break;
      case 'close-view': switchToChatView(); break;
      case 'close-lightbox': closeLightbox(); break;
      // closeLightbox() checks the event target itself: it only closes on a
      // click on the backdrop or the close button, not on the image.
      case 'lightbox-backdrop': closeLightbox(e); break;
    }
  });
}

// initTooltips → modules/utils.js

// initOnboarding, showOnboardingStep, render*Step, handleOnboardingLogin,
// handleCreateFolders, nextOnboardingStep, showTutorialPopup,
// showTutorialRenamePopup, finishOnboarding, hideAppLoadingSplash →
// modules/onboarding.js

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Constructing an AudioContext is surprisingly expensive the first time
    // (100+ ms, blocking the main thread) — doing it here at startup means
    // that cost lands where it's invisible, instead of on whichever random
    // later interaction happens to be the first notification (profiling
    // showed this as the single biggest cause of a tab-switch feeling like
    // it hangs, when it coincided with a background tab's first "done" beep).
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* ignore */ }

    await loadPreferences();
    migrateDeniedToolsToPerProvider();
    initCopilotModels(); // seed the persisted model lists before tabs/dropdowns render
    refreshAllProviderModels(); // discover direct-API provider models in the background
    applyTheme(getCurrentTheme());
    initAgentIPC();
    initResize();

    await initStatusbar();
    await initDataLoad();

    const restored = await restoreOpenTabs();
    if (!restored) {
      await createTab('🤖 Chat');
    } else {
      // Erneut laden, sobald tab.cwd steht: createTab() ruft switchTab() auf,
      // bevor das Arbeitsverzeichnis gesetzt ist — der erste Ladelauf sieht
      // also noch cwd=null und würde die Projekt-Skills verschlucken.
      const restoredActiveTab = tabs.get(activeTabId);
      if (restoredActiveTab?.cwd) {
        loadContextForTab(getTabProvider(restoredActiveTab), restoredActiveTab.cwd);
        loadProjectMcpServers(restoredActiveTab.cwd);
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
    initListActionDelegation();
    initTabModelSelector();
    initTabModeSelector();
    initGeminiModeToggle();
    initContextInfo();
    initOnboarding();
    refreshProviderStatus();
    initUpdateChecker();
    initClaudeAdapterUpdateChecker();
    initDynamicPricing();
    initSubscriptionUsageTicker();
  } finally {
    hideAppLoadingSplash();
  }
});

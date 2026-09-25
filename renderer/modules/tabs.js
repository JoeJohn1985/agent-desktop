// ── Tabs Module ────────────────────────────────────────────────
// Extracted from app.js — tab lifecycle: create, switch, close, render,
// reorder (drag&drop), and inline rename.
//
// `tabs` (the Map) and `activeTabId` stay declared in app.js on purpose:
// they're read/written from nearly every other cluster still there (agent
// IPC, model catalog, usage display, named-session persistence, …) — moving
// a 2-line declaration wouldn't shrink app.js and would only add pointless
// cross-file indirection. `richTextMode` stays there for the same reason
// (also read/written from the Send Message cluster). This module reads/
// writes all three as the usual cross-file bare-global pattern.
//
// Relies on globals provided elsewhere: escapeHtml/showNotification
// (modules/utils.js), switchToChatView (modules/plugins.js), loadTodos
// (modules/todos.js), loadContextForTab/renderSkills/loadProjectMcpServers/
// mergeMcpByName/mcpServers/globalMcpServers/renderMcpServers (modules/
// skills-mcp.js), renderSessionTools (modules/session-tools.js),
// filterSessions/renderSessions/setSessionName (modules/sessions-sidebar.js),
// initAutoScroll/resizeChatInput/updateStatus/stopInactivityMonitor/
// saveOpenTabs (app.js), getDefaultProvider/getDefaultModelForProvider/
// providerHasReasoning/getDefaultReasoningForProvider/getSavedModeForProvider/
// DEFAULT_MODE_ID/getTabProvider/isSubscriptionProvider/
// updateSubscriptionUsageDisplay/updateUsageDisplay/refreshUsageDisplay/
// updateModeSelectBtn/updateModelSelectBtn/updateContextButtonPct/
// providerSupports/providerIconHtml/getClaudeCodeSshCwd (app.js model/
// provider catalog), saveSessionProvider/saveSessionCwd/
// saveSessionModelConfiguration (app.js named-session persistence),
// normalizeReasoningByModel (modules/model-catalog.js).
'use strict';

/**
 * Create a new chat tab, register it in the tabs map, and switch to it.
 * Also allocates a stream-output element and a status-line element.
 * @param {string} [label='🤖 Chat'] - Display label for the tab.
 * @param {string} [initialModel] - Model to select initially.
 * @param {string} [provider] - Provider owning the tab.
 * @param {Object<string, string|null>} [initialReasoningByModel] - Persisted
 *   per-model reasoning choices.
 * @returns {Promise<string>} The new tab's unique ID.
 */
async function createTab(label, initialModel, provider, initialReasoningByModel) {
  const tabLabel = label || '🤖 Chat';
  // The ProviderID is the authoritative discriminator (it determines available
  // models and provider-specific behaviour). Prefer the explicit arg; else derive
  // from the model (legacy), else the configured default provider.
  const tabProvider = provider
    || (initialModel ? window.RendererLogic.getModelProvider(initialModel) : null)
    || getDefaultProvider();
  const tabId = await desktop.chat.newTab();

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

  const startModel = initialModel || getDefaultModelForProvider(tabProvider);
  // A brand-new tab starts on the provider's configured default reasoning;
  // restored/resumed tabs keep their own map (see seedReasoningForNewTab).
  const seededReasoning = window.RendererLogic.seedReasoningForNewTab(
    initialReasoningByModel,
    startModel,
    providerHasReasoning(tabProvider) ? getDefaultReasoningForProvider(tabProvider) : null,
  );

  tabs.set(tabId, {
    streamEl,
    statusEl,
    label: tabLabel,
    sessionId: null,    // filled after first response
    // Per-tab working directory. SSH tabs start at the configured REMOTE
    // default — leaving it null would let the backend fall back to this
    // machine's local cwd, which is meaningless (and wrong) on the far side.
    cwd: tabProvider === 'claude-code-ssh' ? (getClaudeCodeSshCwd() || null) : null,
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
    reasoningByModel: normalizeReasoningByModel(seededReasoning),
    // Per-tab manual-approval toggle; new tabs inherit the global default.
    manualApproval: getSettings().manualApproval === true,
    selectedModel: startModel,
    context: { model: null, mcp: null, skills: null, instructions: null, cwd: null, files: new Set() },
    inputText: '',
    inputRichHtml: '',
    inputRichMode: false,
    // Force-activated skills for THIS tab only — toggling one must not leak
    // into other open tabs (each tab gets its own independent set).
    activeSkills: new Set(),
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
  // ── Perf instrumentation ──────────────────────────────────
  // Logs go through console.log, which is already mirrored into the in-app
  // Developer Console (🖥️ button) and the log file — no separate profiling
  // tool needed, just reproduce the freeze and copy the console output.
  const _t0 = performance.now();
  const _mark = (label) => console.log(`[perf] switchTab: ${label} +${(performance.now() - _t0).toFixed(1)}ms`);

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
  _mark(`show/hide toggle done`);

  activeTabId = tabId;
  const activeTab = tabs.get(tabId);
  console.log(`[perf] switchTab: target tab has ${activeTab?.streamEl?.childElementCount ?? '?'} DOM children, ${activeTab?._prunedNodes?.length ?? 0} staged/pruned`);

  // Load context for this tab's session; todos are project-scoped (by cwd).
  if (activeTab && activeTab.sessionId) {
    activeSessionId = activeTab.sessionId;
  }
  loadTodos(activeTab ? activeTab.cwd : null);
  _mark('loadTodos kicked off');

  renderTabs();
  _mark('renderTabs done');

  // Skills/Agents hängen an Provider UND Projekt — eine Quelle, ein Aufruf.
  // Überspringt sich selbst, wenn beides gleich geblieben ist.
  loadContextForTab(getTabProvider(activeTab), activeTab?.cwd || null);
  // Die Aktiv-Markierung ist dagegen pro Tab, muss also auch dann neu
  // gezeichnet werden, wenn die Liste selbst unverändert bleibt.
  renderSkills();
  _mark('context load kicked off + renderSkills done');

  loadProjectMcpServers(activeTab?.cwd || null);

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

    if (chatInput.value) {
      resizeChatInput(chatInput);
    } else {
      chatInput.style.height = 'auto';
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
  _mark('switchTab() sync work done (see click handler in renderTabs() for the paint-inclusive total)');
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
  try { desktop.chat.stop(tabId); } catch (_) {}
  // stop bricht nur den Prompt ab; ohne resetBackend lebt der Backend-Prozess (bei Claude Code (SSH) der ssh-Client samt Remote-Adapter) bis zum App-Ende weiter.
  try { desktop.chat.resetBackend(tabId).catch(() => {}); } catch (_) {}
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

    el.addEventListener('click', () => {
      const _clickT0 = performance.now();
      switchTab(id);
      // Double rAF = after the browser has actually painted the next frame,
      // not just "before the next paint" — this is what catches forced
      // layout/reflow cost that happens after switchTab() itself returns.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        console.log(`[perf] tab click → painted: ${(performance.now() - _clickT0).toFixed(1)}ms (this is the number that matches what you actually feel)`);
      }));
    });
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (canSaveSession) startTabRename(id, el, labelSpan);
    });

    // Drag-and-drop reordering — see reorderTabs().
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      _draggedTabId = id;
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('tab--dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('tab--dragging');
      _draggedTabId = null;
    });
    el.addEventListener('dragover', (e) => {
      if (!_draggedTabId || _draggedTabId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!_draggedTabId || _draggedTabId === id) return;
      reorderTabs(_draggedTabId, id);
    });

    bar.insertBefore(el, addBtn);
  });
  saveOpenTabs();
}

/** Tab ID currently being dragged in the tab bar, or null — see renderTabs(). */
let _draggedTabId = null;

/**
 * Moves `draggedId` to `targetId`'s position in the tabs map and re-renders.
 * Maps don't support in-place reordering, so this rebuilds it from a
 * reordered entries array — saveOpenTabs() (called by renderTabs()) then
 * persists the new order.
 * @param {string} draggedId
 * @param {string} targetId
 */
function reorderTabs(draggedId, targetId) {
  const entries = [...tabs.entries()];
  const fromIdx = entries.findIndex(([id]) => id === draggedId);
  const toIdx = entries.findIndex(([id]) => id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = entries.splice(fromIdx, 1);
  entries.splice(toIdx, 0, moved);
  tabs.clear();
  entries.forEach(([id, tab]) => tabs.set(id, tab));
  renderTabs();
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
        saveSessionModelConfiguration(tab.sessionId, tab);
      } else {
        // No session yet — create one
        try {
          const newId = await desktop.sessions.create(newName);
          if (newId) {
            tab.sessionId = newId;
            activeSessionId = newId;
            setSessionName(newId, newName);
            // Persist the tab's chosen model/provider (and cwd) against the new
            // session id. Without this, a tab saved before its first message
            // would lose its provider and fall back to Copilot on resume.
            saveSessionModelConfiguration(newId, tab);
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

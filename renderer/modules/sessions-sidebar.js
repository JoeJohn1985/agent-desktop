// ── Sessions Sidebar Module ───────────────────────────────────
// Extracted from app.js — named-session list rendering, search/filter,
// per-card menu (rename/change folder/delete), resume, and history-bubble
// rendering on resume.
// Relies on globals provided elsewhere: escapeHtml/escapeAttr/emptyStateHtml/
// showNotification/formatToolArgs (modules/utils.js), tabs/activeTabId/
// switchTab/renderTabs/createTab/scrollToBottom (app.js tab management),
// getSessionName/setSessionName/getSessionProvider/getSessionModel/
// getSessionReasoningByModel/getSessionDeniedTools/getSessionApproval/
// getSessionCwd/saveSessionCwd/touchSession/getNamedSessions/
// removeSessionName/getSettings (app.js named-session persistence),
// getClaudeCodeSshHost/getClaudeCodeSshCwd/isClaudeCodeProvider/
// getTabProvider/updateModelSelectBtn/updateGeminiModeBtn/PROVIDER_SHORT/
// providerIconHtml (app.js provider catalog), pickRemoteFolder (app.js
// provider settings), loadContextForTab/loadProjectMcpServers
// (modules/skills-mcp.js), loadTodos (modules/todos.js).
'use strict';

/** @type {Array<{id: string, name: string, lastUsed: string}>} Named sessions for the sidebar, sorted by last-used. */
let sessions = [];
/** @type {string|null} Session ID of the currently active tab. */
let activeSessionId = null;

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
            <div class="session-card__main" data-resume-by-id="${escapeAttr(query)}">
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
          <div class="session-card__main" data-resume-session="${escapeAttr(s.id)}">
            <div class="session-card__title">${provIcon}<span class="session-card__title-text">${escapeHtml(title)}</span></div>
          </div>
          <button class="session-card__menu-btn" data-session-menu="${escapeAttr(s.id)}" data-tooltip="Optionen" aria-label="Session-Optionen">⋮</button>
        </div>
      </div>
    `;
  }).join('');

  // If query looks like an ID and isn't already in the list, also offer direct resume
  if (query && isSessionIdLike(query) && !list.find(s => s.id === query)) {
    html += `
      <div class="session-card session-card--id-resume" style="border-top:1px dashed var(--border);margin-top:4px;padding-top:4px;">
        <div class="session-card__row">
          <div class="session-card__main" data-resume-by-id="${escapeAttr(query)}">
            <div class="session-card__title" style="font-size:11px;color:var(--text-muted);">⏎ Andere Session per ID öffnen:</div>
            <div class="session-card__id" style="font-size:10px;font-family:monospace;color:var(--accent);word-break:break-all;">${escapeHtml(query)}</div>
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

/**
 * Right-aligning a fixed-positioned dropdown under a sidebar button (via
 * only a `right` offset) can push its left edge past the window's left edge
 * once the box's real (content-dependent) width is known — a narrow/resized
 * sidebar plus a wide item (e.g. the Todos sync button) makes this easy to
 * hit. Call once the menu is in the DOM so getBoundingClientRect() is real.
 * @param {HTMLElement} menu
 */
function clampMenuToViewportLeft(menu) {
  if (menu.getBoundingClientRect().left < 8) {
    menu.style.right = 'auto';
    menu.style.left = '8px';
  }
}

/**
 * Mirror of clampMenuToViewportLeft() for menus that default to growing
 * rightward (anchored via `left`) — pulls them back onto the viewport if
 * they'd overflow the right edge instead.
 * @param {HTMLElement} menu
 */
function clampMenuToViewportRight(menu) {
  if (menu.getBoundingClientRect().right > window.innerWidth - 8) {
    menu.style.left = 'auto';
    menu.style.right = '8px';
  }
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
  clampMenuToViewportLeft(menu);

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
  // An SSH session's directory lives on the remote host, so the OS dialog
  // (which can only see this machine) would hand back a meaningless local
  // path. Find the owning tab first to pick the right picker.
  const owningTab = [...tabs.values()].find(t => t.sessionId === sessionId);
  const isSsh = owningTab && getTabProvider(owningTab) === 'claude-code-ssh';

  let selected;
  if (isSsh) {
    const host = getClaudeCodeSshHost();
    if (!host) {
      showNotification('Kein SSH-Ziel konfiguriert (Einstellungen → Provider → Claude Code (SSH)).', 'error');
      return;
    }
    selected = await pickRemoteFolder(host, owningTab.cwd || getClaudeCodeSshCwd());
  } else {
    selected = await desktop.folders.browse();
  }
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
  // Applies to both Claude Code variants: the session is bound to its folder
  // either way, only the machine holding it differs.
  if (isClaudeCodeProvider(getTabProvider(tab)) && tab.sessionId) {
    const oldId = tab.sessionId;
    const name = tab._sessionName || getSessionName(oldId) || null;
    // Drop our named reference to the old session — this tab now starts anew.
    deleteNamedSessionEntry(oldId);
    try { await desktop.chat.resetBackend(tabId); } catch (_) { /* ignore */ }
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
    loadContextForTab(getTabProvider(tab), newCwd);
    loadProjectMcpServers(newCwd);
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
  const sessionReasoningByModel = getSessionReasoningByModel(sessionId);
  const tabId = await createTab(label, sessionModel || undefined, provider, sessionReasoningByModel);
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
  // Must carry the earliest ts in this batch — it's the very first child
  // inserted, so pruneOldMessages() needs it stamped to even start scanning.
  headerEl.dataset.ts = String(Date.now());
  insertBefore(headerEl);

  // 2. Letzte Nachrichten als echte Chat-Bubbles. Direkt-API-Sessions haben
  // keine CLI-State-Dateien — ihren Verlauf laden wir aus dem API-Session-Store.
  // Claude Code führt ebenfalls kein solches Store, hat aber sein eigenes
  // Transkript-Format (~/.claude/projects/…), das wir separat auslesen.
  try {
    const provider = getTabProvider(tab);
    if (provider === 'copilot') {
      // The full conversation (not just the last few messages) is fetched so
      // reopening a session restores the whole history — but only the most
      // recent HISTORY_LIVE_TAIL_MESSAGES are actually put in the DOM; older
      // ones are staged in tab._prunedNodes and load in on scroll-up (see
      // insertHistoryGroups/restorePrunedHistory). A long-lived session used
      // to render its entire history into the DOM immediately on resume,
      // which was the single biggest contributor to tab-switch jank.
      renderSimpleHistory(await desktop.sessions.readAllMessages(sessionId), insertBefore, tab);
    } else if (provider === 'claude-code') {
      renderSimpleHistory(await desktop.sessions.readClaudeCodeTranscript(tab.cwd, sessionId), insertBefore, tab);
    } else if (provider === 'claude-code-ssh') {
      // No history preview yet: the transcript lives in ~/.claude/projects on
      // the REMOTE host, and readClaudeCodeTranscript reads the local disk.
      // Falling through to the API branch below would be wrong (that reads a
      // different store entirely), so render nothing — the session itself is
      // intact and the adapter over there still has its full context.
    } else {
      const { messages, geminiMode } = await window.desktop.providers.loadSessionHistory(sessionId);
      renderApiHistory(messages, insertBefore, tab);
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

/** How many of the most recent history "messages" render live on resume — older
 * ones are staged (never inserted) and load in on scroll-up. See
 * insertHistoryGroups() and restorePrunedHistory(). */
const HISTORY_LIVE_TAIL_MESSAGES = 20;

/**
 * Inserts history "groups" (one BUILDER FUNCTION per source message — a
 * message can produce 0-N elements: a bubble plus tool-call lines) into the
 * DOM, but only builds+attaches the most recent HISTORY_LIVE_TAIL_MESSAGES.
 * Older builders go UNBUILT into tab._prunedNodes, so a long resumed session
 * pays neither DOM cost nor markdown-parse cost for its backlog on open —
 * restorePrunedHistory() builds them batch-wise when scrolling to the top.
 * @param {Array<() => HTMLElement[]>} groups - Builders, oldest first.
 * @param {(el: HTMLElement) => void} insertBefore
 * @param {Object} tab
 */
function insertHistoryGroups(groups, insertBefore, tab) {
  const cut = Math.max(0, groups.length - HISTORY_LIVE_TAIL_MESSAGES);
  const older = groups.slice(0, cut);
  if (older.length) {
    tab._prunedNodes = tab._prunedNodes || [];
    tab._prunedNodes.push(...older);
  }
  for (const build of groups.slice(cut)) {
    for (const el of build()) insertBefore(el);
  }
}

/**
 * Renders a simple {role, content}[] history (Copilot's events.jsonl or
 * Claude Code's own transcript — both already reduced to plain text turns)
 * as history bubbles.
 * @param {Array<{role: string, content: string}>} messages
 * @param {(el: HTMLElement) => void} insertBefore - Inserts an element into the stream.
 * @param {Object} tab
 */
function renderSimpleHistory(messages, insertBefore, tab) {
  if (!Array.isArray(messages)) return;
  const groups = messages.map(msg => () => {
    const el = document.createElement('div');
    if (msg.role === 'user') {
      el.className = 'stream-input stream-input--history';
      el.textContent = msg.content;
    } else {
      el.className = 'stream-response markdown-body stream-response--history';
      el.innerHTML = window.markdown ? window.markdown.render(msg.content) : escapeHtml(msg.content);
    }
    // Timestamp restored history too, so a long-idle tab still prunes it
    // 30 minutes after being displayed — see pruneOldMessages().
    el.dataset.ts = String(Date.now());
    return [el];
  });
  insertHistoryGroups(groups, insertBefore, tab);
}

/**
 * Render a persisted direct-API conversation (Anthropic-native messages) as
 * history bubbles + tool-call lines. Tool-result messages (internal to the
 * agent loop) and thinking blocks are skipped.
 * @param {Array} messages - Provider-native message history.
 * @param {(el: HTMLElement) => void} insertBefore - Inserts an element into the stream.
 * @param {Object} tab
 */
function renderApiHistory(messages, insertBefore, tab) {
  if (!Array.isArray(messages)) return;

  // One builder per source message (a message can yield a bubble plus several
  // tool-call lines) — element creation incl. markdown parse happens only
  // when the builder runs (live tail now; staged backlog on scroll-up).
  const buildMessageEls = (msg) => {
    const out = [];
    const userBubble = (text) => {
      const el = document.createElement('div');
      el.className = 'stream-input stream-input--history';
      el.textContent = text;
      // Timestamp restored history too, so a long-idle tab still prunes it
      // 30 minutes after being displayed — see pruneOldMessages().
      el.dataset.ts = String(Date.now());
      out.push(el);
    };
    const assistantBubble = (text) => {
      const el = document.createElement('div');
      el.className = 'stream-response markdown-body stream-response--history';
      el.innerHTML = window.markdown ? window.markdown.render(text) : escapeHtml(text);
      el.dataset.ts = String(Date.now());
      out.push(el);
    };
    const toolLine = (name, input) => {
      const el = document.createElement('div');
      el.className = 'stream-tool--history';
      let args = '';
      try { args = typeof formatToolArgs === 'function' ? formatToolArgs(input) : ''; } catch (_) { /* ignore */ }
      if (!args && input) { try { args = JSON.stringify(input).slice(0, 120); } catch (_) { /* ignore */ } }
      el.textContent = `🔧 ${name}${args ? ' — ' + args : ''}`;
      out.push(el);
    };

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
    return out;
  };

  insertHistoryGroups(messages.map(msg => () => buildMessageEls(msg)), insertBefore, tab);
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
  await desktop.sessions.delete(pendingDeleteId);
  removeSessionName(pendingDeleteId);
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
  await loadSessions();
}

function cancelDeleteSession() {
  pendingDeleteId = null;
  document.getElementById('deleteOverlay').classList.remove('overlay--visible');
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

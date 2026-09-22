// ── Agent IPC Module ──────────────────────────────────────────
// Extracted from app.js — the central event dispatcher that turns backend
// IPC events (`desktop.chat.onEvent`/`onDone`) into UI updates: streaming
// response/reasoning bubbles, tool-call rendering, session/context/usage
// bookkeeping, and turn completion.
//
// This is the single highest fan-IN function in the renderer: it reads
// globals from nearly every other concern still in app.js — tabs/
// activeTabId/setTabStatus/renderTabs/saveOpenTabs/stopInactivityMonitor/
// pruneOldMessages (tab management/status), the model/provider catalog
// (applyDynamicModels/updateModelSelectBtn/updateModeSelectBtn/
// isSubscriptionProvider/isAcpProvider/getTabProvider/_dynamicModes), usage
// display (refresh*/update*UsageDisplay/updateContextButtonPct — see
// plans/app-js-modularization.md for why that cluster stays in app.js),
// named-session persistence (setSessionName/saveSessionCwd/
// saveSessionProvider/saveSessionModelConfiguration), and permission
// requests (enqueuePermissionRequest). Also relies on modules/skills-mcp.js
// (globalMcpServers/mcpServers/renderMcpServers/loadProjectMcpServers/
// loadContextForTab), modules/todos.js (loadTodos), and modules/utils.js
// (scrollToBottom is actually app.js; playNotificationSound/
// formatMessageTime/toolIcon/formatToolArgs/etc. are utils.js/RendererLogic).
// All of this is the same cross-file bare-global pattern used throughout the
// renderer — safe because every script loads before any of these handlers
// can fire (they're only invoked in response to real IPC events, always
// after DOMContentLoaded).
'use strict';

/** @type {Map<string, {toolName: string, arguments: Object}>} Pending tool calls awaiting completion, keyed by toolCallId. */
const pendingToolCalls = new Map();

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
function initAgentIPC() {
  desktop.chat.onEvent((tabId, event) => {
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
          // dataset.time survives the repeated innerHTML reassignments below
          // (markdown re-render on every delta) — it's an attribute, not a
          // child node, so it isn't touched by them.
          tab._responseEl.dataset.time = formatMessageTime(Date.now());
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
        // Throttled markdown render — fast/no-highlight variant (see preload.js)
        // since this reruns on the whole growing response every ~100ms; the
        // final render (assistant.message / onDone) adds real highlighting.
        if (!tab._mdTimer) {
          tab._mdTimer = setTimeout(() => {
            tab._mdTimer = null;
            if (tab._responseEl && tab._responseRaw) {
              tab._responseEl.innerHTML = window.markdown.renderFast(tab._responseRaw);
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
      case 'session.mcp_server_status_changed': {
        const { serverName, status } = event.data;
        if (status === 'connected') {
          tab.statusEl.textContent = `● ${serverName} verbunden`;
          tab.statusEl.style.display = 'block';
        }
        if (serverName && status) {
          _liveMcpStatus.set(serverName, status);
          const g = globalMcpServers.find(g => g.name === serverName);
          if (g) g.status = status;
          const t = mcpServers.find(s => s.name === serverName);
          if (t) { t.status = status; if (tabId === activeTabId) renderMcpServers(); }
        }
        break;
      }

      case 'session.mcp_servers_loaded': {
        const servers = event.data.servers || [];
        const connected = servers.filter(s => s.status === 'connected');
        tab.context.mcp = `${connected.length}/${servers.length}`;
        tab.context.mcpServers = servers;
        // The live session just told us the real status — remember it so the
        // background reachability probe (refreshMcpStatus) never overwrites
        // it with a less reliable guess, and merge it into the global list
        // too so other tabs/re-renders see the correct status.
        for (const s of servers) {
          if (!s.status) continue;
          _liveMcpStatus.set(s.name, s.status);
          const g = globalMcpServers.find(g => g.name === s.name);
          if (g) g.status = s.status;
        }
        if (tabId === activeTabId) {
          mcpServers = servers;
          renderMcpServers();
          // Re-merge project MCP entries from .github/mcp.json
          if (tab.cwd) loadProjectMcpServers(tab.cwd);
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
        // Skills des Providers für dieses Projekt neu laden
        if (tabId === activeTabId) {
          loadContextForTab(getTabProvider(tab), tab.cwd || null, { force: true });
        }
        break;
      }

      case 'agent.models_available': {
        // The ACP backend reported which models this account can use → assign them
        // to THIS tab's provider (Copilot or Claude Code) rather than assuming
        // Copilot, so each ACP provider gets its own discovered model list.
        applyDynamicModels(getTabProvider(tab), event.data.models);
        // Adopt the backend's current model when the tab hasn't chosen one yet
        // (e.g. Claude Code, where we don't force a default) so the 🧠 button
        // shows the active model instead of being blank.
        if (!tab.selectedModel && event.data.currentModelId) {
          tab.selectedModel = event.data.currentModelId;
          if (tab.sessionId) saveSessionModelConfiguration(tab.sessionId, tab);
          saveOpenTabs();
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
          // Persist the selected model and all model-specific reasoning choices.
          saveSessionModelConfiguration(event.sessionId, tab);
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

  desktop.chat.onDone((tabId, code) => {
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
    pruneOldMessages(tab);

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

// ── Terminal Panel State ──────────────────────────────────────
// Per-tab terminal state is stored in the tab object:
//   tab.terminal = { instance, fitAddon, bodyEl, alive }

// ── Skills Definition ────────────────────────────────────────
let skills = []; // dynamically loaded from main process

// ── State ────────────────────────────────────────────────────
let sessions = [];
let activeSessionId = null;
let activeSkills = new Set();
const inputHistory = [];
let historyIndex = -1;
let historySavedInput = '';

// Multi-Tab State
const tabs = new Map(); // tabId → { streamEl, label, status }
let activeTabId = null;

// ── Auto-Scroll ────────────────────────────────────────────
let autoScrollEnabled = true;

function scrollToBottom(streamEl) {
  if (!streamEl || !autoScrollEnabled) return;
  streamEl.scrollTop = streamEl.scrollHeight;
}

function initAutoScroll(streamEl) {
  streamEl.addEventListener('scroll', () => {
    const atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 60;
    autoScrollEnabled = atBottom;
    const btn = document.getElementById('btnScrollBottom');
    if (btn) btn.style.display = atBottom ? 'none' : 'flex';
  });
}

const THEMES = ['light', 'dark', 'gebit'];

function getCurrentTheme() {
  return localStorage.getItem('theme') || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

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
}

// ── Session Restore ─────────────────────────────────────────
function saveOpenTabs() {
  const openTabs = [];
  tabs.forEach((tab, id) => {
    if (tab.sessionId) {
      openTabs.push({ sessionId: tab.sessionId, label: tab.label });
    }
  });
  localStorage.setItem('openTabs', JSON.stringify(openTabs));
}

async function restoreOpenTabs() {
  const saved = localStorage.getItem('openTabs');
  if (!saved) return false;
  try {
    const openTabs = JSON.parse(saved);
    if (!openTabs.length) return false;
    for (const t of openTabs) {
      const tabId = await createTab(t.label || '🤖 Copilot');
      const tab = tabs.get(tabId);
      if (tab) {
        tab.sessionId = t.sessionId;
        activeSessionId = t.sessionId;
        loadTodos(t.sessionId);
      }
    }
    return true;
  } catch { return false; }
}

// ── Settings ────────────────────────────────────────────────
function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('settings') || '{}');
  } catch { return {}; }
}

function saveSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem('settings', JSON.stringify(s));
}

function applyChatFontSize(size) {
  document.querySelectorAll('.stream-output').forEach(el => {
    el.style.fontSize = size + 'px';
  });
}

// ── Notification Sound ──────────────────────────────────────
function playNotificationSound() {
  if (getSettings().soundEnabled === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) { /* Audio not available */ }
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

  // Show/hide terminal panel based on whether this tab has an active terminal
  if (activeTab && activeTab.terminal) {
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
  document.getElementById('chatInput')?.focus();
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  copilot.chat.stop(tabId);
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
}

function renderTabs() {
  const bar = document.getElementById('tabBar');
  const addBtn = document.getElementById('btnAddTab');

  bar.querySelectorAll('.tab').forEach(el => el.remove());

  tabs.forEach((tab, id) => {
    const el = document.createElement('div');
    el.className = `tab ${id === activeTabId ? 'tab--active' : ''}`;
    el.setAttribute('data-tooltip', 'Doppelklick zum Umbenennen');

    // Status indicator (for non-active tabs)
    if (id !== activeTabId && tab.tabStatus && tab.tabStatus !== 'idle') {
      const badge = document.createElement('span');
      badge.className = `tab__badge tab__badge--${tab.tabStatus}`;
      badge.textContent = tab.tabStatus === 'working' ? '⟳'
        : tab.tabStatus === 'question' ? '?'
        : tab.tabStatus === 'done' ? '✓'
        : tab.tabStatus === 'error' ? '!' : '';
      badge.title = tab.tabStatus === 'working' ? 'Arbeitet…'
        : tab.tabStatus === 'question' ? 'Wartet auf Eingabe'
        : tab.tabStatus === 'done' ? 'Fertig'
        : tab.tabStatus === 'error' ? 'Fehler' : '';
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
    editBtn.title = 'Umbenennen';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startTabRename(id, el, labelSpan);
    });
    el.appendChild(editBtn);

    if (tabs.size > 1) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab__close';
      closeBtn.textContent = '✕';
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

  const commit = async () => {
    const newName = input.value.trim();
    input.remove();
    labelSpan.style.display = '';

    if (newName && newName !== tab.label.replace(/^🤖\s*/, '')) {
      tab.label = '🤖 ' + newName;
      labelSpan.textContent = tab.label;

      // Persist to workspace.yaml if session exists
      if (tab.sessionId) {
        await copilot.sessions.rename(tab.sessionId, newName);
        loadSessions(); // refresh sidebar
      }
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

  // Show thinking indicator
  tab.statusEl.textContent = '● Thinking…';
  tab.statusEl.style.display = 'block';
  tab.isProcessing = true;
  setTabStatus(activeTabId, 'working');

  // Send to Copilot via JSON API
  copilot.chat.send(activeTabId, text, {
    sessionId: tab.sessionId || undefined,
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
        // Throttled markdown render (every 100ms)
        if (!tab._mdTimer) {
          tab._mdTimer = setTimeout(() => {
            tab._mdTimer = null;
            if (tab._responseEl && tab._responseRaw) {
              tab._responseEl.innerHTML = window.markdown.render(tab._responseRaw);
            }
          }, 100);
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
        if (!event.data || !event.data.result) break;
        const toolName = event.data.toolName || '';
        if (toolName === 'report_intent') break;
        const icon = toolIcon(toolName);
        if (!icon) break; // hide unknown tools

        const toolEl = document.createElement('details');
        toolEl.className = 'stream-tool-result';
        const success = event.data.success !== false;
        const statusIcon = success ? '✓' : '✗';
        const preview = (event.data.result.content || '').substring(0, 150).replace(/\n/g, ' ');

        const summary = document.createElement('summary');
        summary.innerHTML = `<span class="stream-tool-result__status ${success ? '' : 'stream-tool-result__status--error'}">${statusIcon}</span> ${icon} <strong>${escapeHtml(toolDisplayName(toolName))}</strong> <span class="stream-tool-result__preview">${escapeHtml(preview)}${preview.length >= 150 ? '…' : ''}</span>`;
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
        tab.context.model = modelName;
        tab.statusEl.textContent = `● Modell: ${modelName}`;
        tab.statusEl.style.display = 'block';
        updateStatusbar('sbModel', `🧠 ${modelName}`);
        break;
      }

      case 'user.message': {
        // Count instructions from transformedContent
        const tc = event.data.transformedContent || '';
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
          const short = cwd.replace(/C:\\Users\\MSchneider\\/gi, '~\\');
          updateStatusbar('sbCwd', `📁 ${short}`);
        }
        break;
      }

      case 'result':
        // Store sessionId for resume
        if (event.sessionId) {
          tab.sessionId = event.sessionId;
          saveOpenTabs();
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
  currentTodos = await copilot.todos.list(sessionId);
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
      <div class="todo-item ${doneClass}" data-id="${t.id}">
        <label class="todo-item__check">
          <input type="checkbox" ${checked} onchange="toggleTodo('${t.id}')" />
        </label>
        <span class="todo-item__text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
        <button class="todo-item__delete" onclick="deleteTodo('${t.id}')" title="Löschen">✕</button>
      </div>
    `;
  }).join('');
}

async function addTodo() {
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (!text || !activeSessionId) return;

  currentTodos = await copilot.todos.add(activeSessionId, { text });
  input.value = '';
  renderTodos();
}

async function toggleTodo(todoId) {
  const todo = currentTodos.find(t => t.id === todoId);
  if (!todo || !activeSessionId) return;
  const newStatus = todo.status === 'done' ? 'open' : 'done';
  currentTodos = await copilot.todos.update(activeSessionId, todoId, { status: newStatus });
  renderTodos();
}

async function deleteTodo(todoId) {
  if (!activeSessionId) return;
  currentTodos = await copilot.todos.delete(activeSessionId, todoId);
  renderTodos();
}

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

  const openSessionIds = new Set([...tabs.values()].map(t => t.sessionId).filter(Boolean));
  container.innerHTML = list.map(s => {
    const isActive = s.id === activeSessionId;
    const date = s.updatedAt ? formatDate(s.updatedAt) : '–';
    const title = s.name || s.summary || shortenPath(s.cwd) || s.id.substring(0, 8);
    const badges = [];
    if (openSessionIds.has(s.id)) badges.push('<span class="session-card__badge session-card__badge--active">● Live</span>');
    // Plan badge removed

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
  createTab(label).then(tabId => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.sessionId = sessionId;
      loadTodos(sessionId);
    }
  });
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

function updateStatusbar(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

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
  if (args.path) return args.path.replace(/C:\\Users\\MSchneider\\/g, '~\\');
  if (args.pattern) return args.pattern;
  if (args.command) return args.command.substring(0, 60) + (args.command.length > 60 ? '…' : '');
  if (args.query) return args.query.substring(0, 60) + (args.query.length > 60 ? '…' : '');
  if (args.prompt) return args.prompt.substring(0, 60) + (args.prompt.length > 60 ? '…' : '');
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

  // If this tab already has a terminal, just show it
  if (tab.terminal && tab.terminal.alive) {
    const panel = document.getElementById('terminalPanel');
    panel.classList.add('terminal-panel--open');
    tab.terminal.bodyEl.style.display = '';
    requestAnimationFrame(() => tab.terminal.fitAddon.fit());
    tab.terminal.instance.focus();
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
    scrollback: 1000,
  });

  const fitAddon = new FitAddon.FitAddon();
  instance.loadAddon(fitAddon);

  // Store terminal state on the tab
  tab.terminal = { instance, fitAddon, bodyEl, alive: true };

  // Show panel
  panel.classList.add('terminal-panel--open');

  // Mount xterm
  instance.open(bodyEl);
  requestAnimationFrame(() => {
    fitAddon.fit();
    setTimeout(() => fitAddon.fit(), 150);
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

  // Spawn PTY
  const result = await copilot.terminal.spawn(tabId, sessionId, slashCommand);
  if (!result.success) {
    instance.writeln(`\r\n\x1b[31m⚠️ ${result.error}\x1b[0m`);
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
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(getCurrentTheme());
  initCopilotIPC();
  initTerminalIPC();
  initResize();
  initTerminalResize();

  // Load skills dynamically
  skills = await copilot.skills.list();
  renderSkills();

  await loadSessions();

  // Restore previous tabs or create a new one
  const restored = await restoreOpenTabs();
  if (!restored) {
    await createTab('🤖 Copilot');
  }

  // Input handling
  const chatInput = document.getElementById('chatInput');
  const btnSend = document.getElementById('btnSend');

  btnSend.addEventListener('click', () => sendMessage());

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // History navigation with arrow keys — only when cursor is at top/bottom of text
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      const pos = chatInput.selectionStart;
      const textBefore = chatInput.value.substring(0, pos);
      const isFirstLine = !textBefore.includes('\n');
      if (!isFirstLine && historyIndex === -1) return; // let cursor move normally
      e.preventDefault();
      if (historyIndex === -1) {
        historySavedInput = chatInput.value;
        historyIndex = inputHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      chatInput.value = inputHistory[historyIndex];
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    }
    if (e.key === 'ArrowDown' && historyIndex !== -1) {
      const pos = chatInput.selectionStart;
      const textAfter = chatInput.value.substring(pos);
      const isLastLine = !textAfter.includes('\n');
      if (!isLastLine) return; // let cursor move normally
      e.preventDefault();
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++;
        chatInput.value = inputHistory[historyIndex];
      } else {
        historyIndex = -1;
        chatInput.value = historySavedInput;
      }
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  });

  // Search
  document.getElementById('sessionSearch').addEventListener('input', () => {
    renderSessions(filterSessions());
  });

  // New Session
  document.getElementById('btnNewSession').addEventListener('click', () => {
    createTab('🤖 Copilot');
  });

  // + Button
  document.getElementById('btnAddTab').addEventListener('click', () => {
    createTab('🤖 Copilot');
  });

  // Theme toggle
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    const current = getCurrentTheme();
    const nextIdx = (THEMES.indexOf(current) + 1) % THEMES.length;
    applyTheme(THEMES[nextIdx]);
  });

  // Terminal button
  document.getElementById('btnOpenTerminal').addEventListener('click', () => {
    if (activeTabId == null) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    openTerminal(activeTabId, tab.sessionId, null);
  });

  // Export chat
  document.getElementById('btnExportChat').addEventListener('click', () => exportChat());

  // Refresh
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadSessions();
  });

  // Todos
  document.getElementById('btnAddTodo').addEventListener('click', () => addTodo());
  document.getElementById('todoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
  });

  // Delete session overlay
  document.getElementById('btnDeleteConfirm').addEventListener('click', () => executeDeleteSession());
  document.getElementById('btnDeleteCancel').addEventListener('click', () => cancelDeleteSession());
  document.getElementById('deleteOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deleteOverlay') cancelDeleteSession();
  });

  // ── Settings Dialog ──────────────────────────────────
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settTheme = document.getElementById('settTheme');
  const settFontSize = document.getElementById('settFontSize');
  const settFontSizeVal = document.getElementById('settFontSizeVal');
  const settSound = document.getElementById('settSound');

  // Load saved settings
  const savedSettings = getSettings();
  settTheme.value = getCurrentTheme();
  const fontSize = savedSettings.chatFontSize || 16;
  settFontSize.value = fontSize;
  settFontSizeVal.textContent = fontSize + 'px';
  applyChatFontSize(fontSize);
  settSound.checked = savedSettings.soundEnabled !== false;

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

  settTheme.addEventListener('change', () => {
    applyTheme(settTheme.value);
  });

  settFontSize.addEventListener('input', () => {
    const size = parseInt(settFontSize.value);
    settFontSizeVal.textContent = size + 'px';
    saveSetting('chatFontSize', size);
    applyChatFontSize(size);
  });

  settSound.addEventListener('change', () => {
    saveSetting('soundEnabled', settSound.checked);
  });

  // Terminal minimize button — hides panel, keeps PTY alive
  document.getElementById('btnTerminalMinimize').addEventListener('click', () => minimizeTerminal());

  // Terminal close button — kills PTY
  document.getElementById('btnTerminalClose').addEventListener('click', () => closeTerminal());

  // Scroll-to-bottom button
  document.getElementById('btnScrollBottom').addEventListener('click', () => {
    const tab = tabs.get(activeTabId);
    if (tab) {
      autoScrollEnabled = true;
      tab.streamEl.scrollTop = tab.streamEl.scrollHeight;
      document.getElementById('btnScrollBottom').style.display = 'none';
    }
  });

  // Resize terminal on window resize
  window.addEventListener('resize', () => {
    const tab = tabs.get(activeTabId);
    if (tab && tab.terminal && tab.terminal.fitAddon) {
      setTimeout(() => tab.terminal.fitAddon.fit(), 100);
    }
  });

  // ── Chat Search ────────────────────────────────────────
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

  // ── Keyboard Shortcuts ───────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Ctrl+T — new tab
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      createTab('🤖 Copilot');
    }
    // Ctrl+W — close active tab
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (activeTabId != null) closeTab(activeTabId);
    }
    // Ctrl+1-9 — switch to tab by index
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      const tabIds = [...tabs.keys()];
      if (idx < tabIds.length) switchTab(tabIds[idx]);
    }
    // Ctrl+L — focus chat input
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      document.getElementById('chatInput')?.focus();
    }
    // Ctrl+E — export chat
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      exportChat();
    }
    // Ctrl+F — search in chat
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      openSearch();
    }
    // Escape — stop processing or close search
    if (e.key === 'Escape') {
      if (searchBar.classList.contains('chat-search--visible')) {
        closeSearch();
      } else if (activeTabId != null) {
        const tab = tabs.get(activeTabId);
        if (tab && tab.isProcessing) {
          copilot.chat.stop(activeTabId);
        }
      }
    }
  });

  // ── Drag & Drop ──────────────────────────────────────
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

  streamArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropOverlay) dropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const chatInput = document.getElementById('chatInput');
    const paths = [...files].map(f => f.path).filter(Boolean);
    if (paths.length > 0) {
      const prefix = chatInput.value ? '\n' : '';
      chatInput.value += prefix + paths.map(p => `@${p}`).join('\n');
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
      chatInput.focus();
    }
  });
});

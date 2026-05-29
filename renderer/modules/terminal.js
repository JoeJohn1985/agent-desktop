// ── Terminal Panel Module ────────────────────────────────────
// Extracted from app.js — Terminal panel with xterm.js integration
// Constants TERMINAL_SCROLLBACK, TERMINAL_FIT_DELAY_MS from utils.js
'use strict';

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
  const result = await copilot.terminal.spawn(tabId, sessionId, slashCommand, tab.cwd || null);
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

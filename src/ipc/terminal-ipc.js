// ── Terminal IPC Handlers ──────────────────────────────────────
// Extracted from main.js — all terminal/PTY related IPC handlers
'use strict';

const { ipcMain } = require('electron');
const { buildEnv, detectCopilotPrompt, isCopilotTuiReady } = require('../main-helpers');

/**
 * Wires up auto-handling for Copilot CLI startup prompts on a PTY.
 * - Auto-confirms folder-trust and resume-conflict prompts.
 * - Marks the tab as ready once the TUI prints its slash-help line.
 * - Falls back to "ready" after timeoutMs to avoid stalling forever.
 *
 * Returns a dispose() function.
 */
function attachReadyDetection(ptyProcess, tabId, terminalReady, timeoutMs, label) {
  let allData = '';
  const handled = new Set();

  const readyListener = ptyProcess.onData((data) => {
    allData += data;

    const prompt = detectCopilotPrompt(allData, handled);
    if (prompt) {
      handled.add(prompt.name);
      console.log(`[${label}] Auto-confirming ${prompt.name} prompt for tab`, tabId);
      setTimeout(() => {
        try { ptyProcess.write(prompt.input); } catch (_) {}
      }, 500);
    }

    if (!terminalReady.get(tabId) && isCopilotTuiReady(allData)) {
      console.log(`[${label}] TUI ready for tab`, tabId);
      terminalReady.set(tabId, true);
      readyListener.dispose();
    }
  });

  const readyFallback = setTimeout(() => {
    if (!terminalReady.get(tabId)) {
      console.log(`[${label}] Fallback: assuming ready for tab`, tabId);
      terminalReady.set(tabId, true);
    }
    readyListener.dispose();
  }, timeoutMs);

  return () => {
    readyListener.dispose();
    clearTimeout(readyFallback);
  };
}

function registerTerminalIPC({ pty, getShell, terminalProcesses, terminalBuffers, terminalReady, terminalBusy, sendToRenderer, waitForTerminalReady, collectPtyOutput, cleanupPty, COPILOT_CWD, PTY_BUFFER_MAX_CHUNKS, PTY_READY_TIMEOUT_MS, PTY_WRITE_DELAY_MS, PTY_SLASH_QUIET_THRESHOLD_MS, PTY_SLASH_CHECK_INTERVAL_MS, PTY_SLASH_FALLBACK_TIMEOUT_MS }) {

  ipcMain.handle('terminal:available', () => !!pty);

  ipcMain.handle('terminal:spawn-background', (_event, tabId, sessionId) => {
    console.log('[bg-terminal] spawn request tabId:', tabId, 'sessionId:', sessionId);
    if (terminalProcesses.has(tabId)) { console.log('[bg-terminal] already running'); return { success: true, alreadyRunning: true }; }
    if (!pty) return { success: false, error: 'node-pty not available' };

    const shell = getShell();
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: COPILOT_CWD,
      env: buildEnv({ TERM: 'xterm-256color' }),
    });

    terminalProcesses.set(tabId, ptyProcess);
    terminalBuffers.set(tabId, []);

    ptyProcess.onData((data) => {
      const buf = terminalBuffers.get(tabId);
      if (buf) {
        buf.push(data);
        if (buf.length > PTY_BUFFER_MAX_CHUNKS) buf.splice(0, buf.length - PTY_BUFFER_MAX_CHUNKS);
      }
      sendToRenderer('terminal:data', tabId, data);
    });

    terminalReady.set(tabId, false);
    const disposeReady = attachReadyDetection(
      ptyProcess, tabId, terminalReady, PTY_READY_TIMEOUT_MS, 'bg-terminal'
    );

    ptyProcess.onExit(({ exitCode }) => {
      cleanupPty(tabId, exitCode, disposeReady);
    });

    const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
    ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

    return { success: true };
  });

  ipcMain.handle('terminal:get-buffer', (_event, tabId) => {
    return terminalBuffers.get(tabId) || [];
  });

  ipcMain.handle('terminal:send-command', (_event, tabId, command) => {
    if (typeof command !== 'string') {
      return { success: false, error: 'Ungültige Argumente' };
    }
    const p = terminalProcesses.get(tabId);
    if (!p) return { success: false, error: 'No terminal process' };
    p.write(`\x1b[200~${command}\x1b[201~`);
    setTimeout(() => p.write('\r'), PTY_WRITE_DELAY_MS);
    return { success: true };
  });

  ipcMain.handle('terminal:fetch-context', async (_event, tabId) => {
    const { parseContextOutput } = require('../utils');
    const p = terminalProcesses.get(tabId);
    console.log('[fetch-context] tabId:', tabId, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
    if (!p) return { success: false, error: 'Kein Background-Terminal aktiv' };
    if (terminalBusy.get(tabId)) return { success: false, error: 'Ein Befehl läuft bereits' };

    terminalBusy.set(tabId, true);
    try {
      await waitForTerminalReady(tabId);
      p.write('/context\r');
      const raw = await collectPtyOutput(p);
      console.log('[fetch-context] done, stripped length:', raw.length);
      console.log('[fetch-context] OUTPUT:', raw.substring(0, 500));
      return { success: true, ...parseContextOutput(raw) };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      terminalBusy.set(tabId, false);
    }
  });

  ipcMain.handle('terminal:send-slash', async (_event, tabId, command) => {
    const { parseContextOutput } = require('../utils');
    const p = terminalProcesses.get(tabId);
    console.log('[send-slash] tabId:', tabId, 'command:', command, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
    if (!p) return { success: false, error: 'Kein Background-Terminal aktiv' };
    if (terminalBusy.get(tabId)) return { success: false, error: 'Ein Befehl läuft bereits' };

    terminalBusy.set(tabId, true);
    try {
      await waitForTerminalReady(tabId);
      p.write(`${command}\r`);
      const raw = await collectPtyOutput(p);
      console.log('[send-slash] done, command:', command, 'stripped length:', raw.length);
      const parsed = parseContextOutput(raw);
      return { success: true, output: raw, ...parsed };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      terminalBusy.set(tabId, false);
    }
  });

  ipcMain.handle('terminal:spawn', (_event, tabId, sessionId, slashCommand) => {
    if (!pty) {
      return { success: false, error: 'node-pty ist nicht installiert. Bitte "npm install" und ggf. "npx electron-rebuild" ausführen.' };
    }

    if (terminalProcesses.has(tabId)) {
      console.log('[terminal:spawn] Reusing existing PTY for tab', tabId, 'slashCommand:', slashCommand);
      if (slashCommand) {
        const p = terminalProcesses.get(tabId);
        for (const ch of slashCommand) {
          p.write(ch);
        }
        setTimeout(() => {
          console.log('[terminal:spawn] Sending Enter for slash command');
          p.write('\r');
        }, 500);
      }
      return { success: true, reused: true };
    }

    const shell = getShell();
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: COPILOT_CWD,
      env: buildEnv({ TERM: 'xterm-256color' }),
    });

    terminalProcesses.set(tabId, ptyProcess);

    ptyProcess.onData((data) => {
      sendToRenderer('terminal:data', tabId, data);
    });

    terminalReady.set(tabId, false);
    const disposeReady = attachReadyDetection(
      ptyProcess, tabId, terminalReady, PTY_READY_TIMEOUT_MS, 'terminal:spawn'
    );

    ptyProcess.onExit(({ exitCode }) => {
      cleanupPty(tabId, exitCode, disposeReady);
    });

    const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
    ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

    if (slashCommand) {
      let lastDataTime = Date.now();
      let slashSent = false;
      const onData = ptyProcess.onData(() => { lastDataTime = Date.now(); });
      const checkInterval = setInterval(() => {
        if (!slashSent && Date.now() - lastDataTime > PTY_SLASH_QUIET_THRESHOLD_MS) {
          slashSent = true;
          console.log('[terminal:slash] PTY quiet for 5s — sending:', slashCommand);
          ptyProcess.write(`\x1b[200~${slashCommand}\x1b[201~`);
          setTimeout(() => ptyProcess.write('\r'), PTY_WRITE_DELAY_MS);
          clearInterval(checkInterval);
          onData.dispose();
        }
      }, PTY_SLASH_CHECK_INTERVAL_MS);
      setTimeout(() => {
        if (!slashSent) console.log('[terminal:slash] Fallback timeout — command not sent');
        clearInterval(checkInterval);
        onData.dispose();
      }, PTY_SLASH_FALLBACK_TIMEOUT_MS);
    }

    return { success: true };
  });

  ipcMain.on('terminal:input', (_event, tabId, data) => {
    if (typeof data !== 'string') return;
    const p = terminalProcesses.get(tabId);
    if (p) p.write(data);
  });

  ipcMain.on('terminal:resize', (_event, tabId, cols, rows) => {
    const p = terminalProcesses.get(tabId);
    if (p) p.resize(cols, rows);
  });

  ipcMain.on('terminal:close', (_event, tabId) => {
    const p = terminalProcesses.get(tabId);
    if (p) p.kill();
    terminalProcesses.delete(tabId);
    terminalBuffers.delete(tabId);
    terminalReady.delete(tabId);
    terminalBusy.delete(tabId);
  });
}

module.exports = { registerTerminalIPC };

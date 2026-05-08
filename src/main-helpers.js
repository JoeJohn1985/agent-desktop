const { stripAnsi } = require('./utils');
const path = require('path');
const os = require('os');

// ── Environment Builder ──────────────────────────────────────
/**
 * Builds an env object for child processes spawned from Electron.
 * On Linux/macOS, Electron does not source ~/.bashrc or ~/.profile,
 * so ~/.local/bin and other user dirs are missing from PATH.
 * We inject them so that `copilot` and other user-installed tools
 * are always findable.
 *
 * On Windows the system PATH already contains user-installed tools
 * (e.g. %APPDATA%\npm) via the registry, so no injection is needed.
 */
function buildEnv(extraEnv = {}) {
  if (process.platform === 'win32') {
    return { ...process.env, ...extraEnv };
  }

  const base = process.env.PATH || '';
  const home = os.homedir();
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].filter(p => !base.split(path.delimiter).includes(p));

  const augmentedPath = extraPaths.length
    ? extraPaths.join(path.delimiter) + path.delimiter + base
    : base;

  return { ...process.env, ...extraEnv, PATH: augmentedPath };
}

// ── sendToRenderer Factory ───────────────────────────────────
function createSendToRenderer(getWindow) {
  return function sendToRenderer(channel, ...args) {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };
}

// ── waitForReady ─────────────────────────────────────────────
function waitForReady(readyMap, tabId, { timeoutMs = 20000, checkIntervalMs = 200 } = {}) {
  return new Promise((resolve, reject) => {
    if (readyMap.get(tabId)) return resolve();
    const check = setInterval(() => {
      if (readyMap.get(tabId)) {
        clearInterval(check);
        resolve();
      }
    }, checkIntervalMs);
    setTimeout(() => {
      clearInterval(check);
      if (!readyMap.get(tabId)) {
        reject(new Error('Terminal nicht bereit (Timeout)'));
      } else {
        resolve();
      }
    }, timeoutMs);
  });
}

// ── collectPtyOutput ─────────────────────────────────────────
function collectPtyOutput(pty, stripFn, { quietMs = 3000, timeoutMs = 15000 } = {}) {
  const strip = stripFn || stripAnsi;
  return new Promise((resolve) => {
    const chunks = [];
    let resolved = false;
    let quietTimer = null;

    const listener = pty.onData((data) => {
      chunks.push(data);
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          listener.dispose();
          resolve(strip(chunks.join('')));
        }
      }, quietMs);
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        listener.dispose();
        if (quietTimer) clearTimeout(quietTimer);
        resolve(strip(chunks.join('')));
      }
    }, timeoutMs);
  });
}

// ── cleanupPty ───────────────────────────────────────────────
function cleanupPty(maps, tabId, exitCode, { extraCleanup, sendFn } = {}) {
  for (const map of maps) {
    map.delete(tabId);
  }
  if (extraCleanup) extraCleanup();
  if (sendFn) sendFn('terminal:exit', tabId, exitCode);
}

module.exports = {
  buildEnv,
  createSendToRenderer,
  waitForReady,
  collectPtyOutput,
  cleanupPty,
};

const { stripAnsi } = require('./utils');

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
    let chunks = [];
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
  createSendToRenderer,
  waitForReady,
  collectPtyOutput,
  cleanupPty,
};

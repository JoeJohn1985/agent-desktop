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

// ── Backends beenden ─────────────────────────────────────────
/**
 * Zerstört alle Backends und leert die Map. destroy() wird sofort aufgerufen
 * (bei ACP-Backends schickt das gleich das SIGTERM an den ssh-/CLI-Kindprozess);
 * gewartet wird höchstens timeoutMs, damit ein hängender Prozess einen Neustart
 * nicht blockiert. Vor app.exit() muss awaited werden, denn exit() überspringt
 * jedes weitere Aufräumen.
 */
async function destroyAllBackends(backends, timeoutMs = 3000) {
  const pending = [...backends.values()].map(client => {
    try {
      return Promise.resolve(client.destroy()).catch(() => {});
    } catch (_) {
      return Promise.resolve();
    }
  });
  backends.clear();
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); });
  await Promise.race([Promise.all(pending), timeout]);
  clearTimeout(timer);
}

module.exports = {
  buildEnv,
  createSendToRenderer,
  destroyAllBackends,
};

const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const yaml = require('yaml');

// Force WM_CLASS on Linux (must be set before app 'ready')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'copilot-desktop');
}
const { stripAnsi, safeSessionPath: _safeSessionPath, builtinSkillIcon, userSkillIcon } = require('./src/utils');
const { readCheckpoints, readPlan, readTodos, writeTodos, readRecentMessages } = require('./src/sessions');
const { createSendToRenderer: _createSendToRenderer, waitForReady, collectPtyOutput: _collectPtyOutput, cleanupPty: _cleanupPty, buildEnv } = require('./src/main-helpers');
const { scanSkillDirectory: _scanSkillDirectory, readFolderConfig: _readFolderConfig, writeFolderConfig: _writeFolderConfig } = require('./src/scanners');
const { scanAgentsDirectory } = require('./src/agents');
const { processDroppedFile } = require('./src/file-processing');
const { initLogger, writeLog, closeLogger, getLogDir } = require('./src/logger');

app.name = 'copilot-desktop';

// ── File Logger Init ────────────────────────────────────────
initLogger();

// ── Dev Console Log Capture ─────────────────────────────────
/** @type {Function} Original console.log before interception */
const _originalConsoleLog = console.log;
/** @type {Function} Original console.warn before interception */
const _originalConsoleWarn = console.warn;
/** @type {Function} Original console.error before interception */
const _originalConsoleError = console.error;

/**
 * Forwards a console log entry to the renderer's dev console panel.
 *
 * @param {'info'|'warn'|'error'} level - Log severity
 * @param {any[]} args - Original console arguments
 */
function _sendDevLog(level, args) {
  try {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dev-console:log', { level, message, timestamp: Date.now() });
    }
  } catch (_) { /* ignore serialization errors */ }
}

console.log = (...args) => { _originalConsoleLog(...args); writeLog('info', args); _sendDevLog('info', args); };
console.warn = (...args) => { _originalConsoleWarn(...args); writeLog('warn', args); _sendDevLog('warn', args); };
console.error = (...args) => { _originalConsoleError(...args); writeLog('error', args); _sendDevLog('error', args); };

// ── PTY (optional, for interactive terminal) ─────────────────
/** @type {import('@homebridge/node-pty-prebuilt-multiarch')|import('node-pty')|undefined} node-pty module, undefined if unavailable */
let pty;
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch');
} catch (_e) {
  try {
    pty = require('node-pty');
  } catch (_e2) {
    console.warn('node-pty not available – terminal features disabled.');
  }
}

// ── Folder Configuration ─────────────────────────────────────
/** @type {string} Path to the persistent folder configuration JSON */
const FOLDERS_CONFIG_PATH = path.join(os.homedir(), '.copilot-desktop', 'folders.json');

/**
 * Reads the folder configuration from disk.
 *
 * @returns {Object} Folder paths (cwd, sessionsDir, skillsDir, etc.)
 */
function readFolderConfig() {
  return _readFolderConfig(FOLDERS_CONFIG_PATH);
}

/**
 * Persists the folder configuration to disk.
 *
 * @param {Object} config - Folder paths to save
 */
function writeFolderConfig(config) {
  _writeFolderConfig(FOLDERS_CONFIG_PATH, config);
}

const folderConfig = readFolderConfig();

// ── Globals ──────────────────────────────────────────────────
/** @type {BrowserWindow|null} Main application window */
let mainWindow = null;
/** @type {Map<number, import('child_process').ChildProcess>} tabId → Copilot CLI child process */
const copilotProcesses = new Map();
/** @type {Map<number, Object>} tabId → PTY process instance */
const terminalProcesses = new Map();
/** @type {Map<number, string[]>} tabId → buffered terminal output chunks */
const terminalBuffers = new Map();
/** @type {Map<number, boolean>} tabId → true when Copilot TUI is ready for commands */
const terminalReady = new Map();
/** @type {number} Auto-incrementing tab identifier */
let nextTabId = 1;
/** @type {string} Directory for Copilot session state files */
let SESSIONS_DIR = folderConfig.sessionsDir || path.join(os.homedir(), '.copilot', 'session-state');
/** @type {string} Name of the Copilot CLI binary */
const COPILOT_BIN = 'copilot';
/** @type {string} Current working directory for Copilot CLI processes */
let COPILOT_CWD = folderConfig.cwd || process.cwd();
/** @type {string} Directory for project images */
let IMAGES_DIR = folderConfig.imagesDir || path.join(COPILOT_CWD, 'images');
/** @type {Map<number, boolean>} tabId → true when a slash command is in progress */
const terminalBusy = new Map();

// Bundled PowerShell — fallback to system shell
/** @type {string} Path to the bundled PowerShell executable */
const BUNDLED_PWSH = path.join(__dirname, 'vendor', 'pwsh', 'pwsh.exe');

/**
 * Returns the path to the preferred shell for the current platform.
 * On Windows: bundled PowerShell if available, otherwise cmd.exe.
 * On Unix: $SHELL or /bin/bash.
 *
 * @returns {string} Shell executable path
 */
function getShell() {
  if (process.platform === 'win32') {
    if (fs.existsSync(BUNDLED_PWSH)) return BUNDLED_PWSH;
    return 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

// ── Constants (PTY & CLI timeouts) ─────────────────────────────
/** @type {number} Max wait time for PTY ready signal (ms) */
const PTY_READY_TIMEOUT_MS = 20000;
const PTY_READY_CHECK_INTERVAL_MS = 200;
const PTY_QUIET_MS = 3000;
const PTY_OUTPUT_TIMEOUT_MS = 15000;
const PTY_BUFFER_MAX_CHUNKS = 5000;
const PTY_SLASH_QUIET_THRESHOLD_MS = 5000;
const PTY_SLASH_CHECK_INTERVAL_MS = 500;
const PTY_SLASH_FALLBACK_TIMEOUT_MS = 30000;
const PTY_WRITE_DELAY_MS = 100;
const CLI_VERSION_TIMEOUT_MS = 5000;
const TEST_RUN_TIMEOUT_MS = 30000;
const TEST_COVERAGE_TIMEOUT_MS = 60000;

// ── Path Safety ──────────────────────────────────────────────
/**
 * Resolves a session ID to a safe, validated absolute path inside SESSIONS_DIR.
 * Prevents path traversal attacks.
 *
 * @param {string} sessionId - The session identifier
 * @returns {string} Absolute path to the session directory
 * @throws {Error} If the resolved path escapes SESSIONS_DIR
 */
function safeSessionPath(sessionId) {
  return _safeSessionPath(SESSIONS_DIR, sessionId);
}

// ── Helper Functions ─────────────────────────────────────────

/**
 * Safely sends an IPC message to the renderer process if the main window exists.
 *
 * @type {(channel: string, ...args: any[]) => void}
 */
const sendToRenderer = _createSendToRenderer(() => mainWindow);

/**
 * Waits until the Copilot TUI in the given PTY signals readiness.
 *
 * @param {number} tabId - Tab identifier
 * @param {number} [timeoutMs=PTY_READY_TIMEOUT_MS] - Maximum wait time in ms
 * @returns {Promise<void>} Resolves when ready, rejects on timeout
 */
function waitForTerminalReady(tabId, timeoutMs = PTY_READY_TIMEOUT_MS) {
  return waitForReady(terminalReady, tabId, { timeoutMs, checkIntervalMs: PTY_READY_CHECK_INTERVAL_MS });
}

/**
 * Collects PTY output until quiet (no new data) or timeout.
 *
 * @param {Object} ptyProc - The PTY process instance
 * @param {Object} [options]
 * @param {number} [options.quietMs=PTY_QUIET_MS] - Quiet period before resolving (ms)
 * @param {number} [options.timeoutMs=PTY_OUTPUT_TIMEOUT_MS] - Hard timeout (ms)
 * @returns {Promise<string>} Collected output with ANSI stripped
 */
function collectPtyOutput(ptyProc, { quietMs = PTY_QUIET_MS, timeoutMs = PTY_OUTPUT_TIMEOUT_MS } = {}) {
  return _collectPtyOutput(ptyProc, stripAnsi, { quietMs, timeoutMs });
}

/**
 * Cleans up all PTY-related state for a tab and notifies the renderer.
 *
 * @param {number} tabId - Tab identifier
 * @param {number|null} exitCode - PTY exit code
 * @param {Function} [extraCleanup] - Optional additional cleanup callback
 */
function cleanupPty(tabId, exitCode, extraCleanup) {
  _cleanupPty(
    [terminalProcesses, terminalBuffers, terminalReady, terminalBusy],
    tabId, exitCode,
    { extraCleanup, sendFn: sendToRenderer }
  );
}

// ── Window ───────────────────────────────────────────────────
/**
 * Creates the main BrowserWindow with frameless design, preload script,
 * and external-link interception. Registers cleanup on window close.
 */
function createWindow() {
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    title: 'Copilot Desktop',
    icon: appIcon,
    backgroundColor: '#f5f3ef',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // External links: open in system browser instead of navigating inside the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url !== 'about:blank') {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    copilotProcesses.forEach(p => p.kill());
    copilotProcesses.clear();
    terminalProcesses.forEach(p => p.kill());
    terminalProcesses.clear();
  });
}

// ── Copilot Process (JSONL) ──────────────────────────────────
/**
 * Spawns a Copilot CLI child process for a given tab and streams JSONL events
 * to the renderer. Kills any existing process for the same tab first.
 *
 * @param {number} tabId - Target tab identifier
 * @param {string} prompt - User prompt to send to the CLI
 * @param {Object} [options={}] - Additional CLI options
 * @param {string[]} [options.deniedTools] - Tools to deny via --deny-tool
 * @param {boolean} [options.allowAllPaths] - If true, adds --allow-all-paths
 * @param {string[]} [options.addDirs] - Additional directories to grant access to
 * @param {string} [options.sessionId] - Session ID for --resume
 * @param {string} [options.model] - Model override
 * @param {string} [options.effort] - Reasoning effort level
 * @param {string} [options.cwd] - Working directory override
 * @returns {number} The tab ID
 */
function spawnCopilot(tabId, prompt, options = {}) {
  // Kill existing process for this tab
  if (copilotProcesses.has(tabId)) {
    copilotProcesses.get(tabId).kill();
    copilotProcesses.delete(tabId);
  }

  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--stream', 'on',
    '-s',
  ];

  // Tool approval — always allow all, use deny-list for restrictions
  args.push('--allow-all-tools');

  // Denied tools
  if (options.deniedTools && options.deniedTools.length > 0) {
    for (const tool of options.deniedTools) {
      args.push('--deny-tool=' + tool);
    }
  }

  // Path permissions
  if (options.allowAllPaths) {
    args.push('--allow-all-paths');
  }
  if (options.addDirs && options.addDirs.length > 0) {
    for (const dir of options.addDirs) {
      args.push('--add-dir', dir);
    }
  }
  // Always include the global default CWD as an additional allowed path
  // so skills/files there remain accessible even when a session overrides CWD.
  if (options.cwd && options.cwd !== COPILOT_CWD) {
    args.push('--add-dir', COPILOT_CWD);
  }

  if (options.sessionId) {
    args.push('--resume=' + options.sessionId);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.effort) {
    args.push('--reasoning-effort', options.effort);
  }
  if (options.autopilot) {
    args.push('--autopilot');
  }

  const proc = spawn(COPILOT_BIN, args, {
    cwd: options.cwd || COPILOT_CWD,
    env: buildEnv({ NO_COLOR: '1' }),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  copilotProcesses.set(tabId, proc);

  // Buffer for incomplete JSONL lines
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        sendToRenderer('copilot:event', tabId, event);
      } catch (e) {
        console.warn('[copilot:jsonl] Fehler:', e.message || e);
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8');
    sendToRenderer('copilot:event', tabId, {
      type: 'error',
      data: { message: text },
    });
  });

  proc.on('close', (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        sendToRenderer('copilot:event', tabId, event);
      } catch (e) {
        console.warn('[copilot:flush] Fehler:', e.message || e);
      }
    }
    copilotProcesses.delete(tabId);
    sendToRenderer('copilot:done', tabId, code);
  });

  return tabId;
}

// ── IPC Handlers ─────────────────────────────────────────────

/**
 * @ipc copilot:send — Sends a prompt to Copilot CLI and starts streaming.
 * @param {Electron.IpcMainInvokeEvent} _event
 * @param {number} tabId - Tab identifier
 * @param {string} prompt - User prompt
 * @param {Object} [options] - Spawn options
 * @returns {number|{success: false, error: string}} Tab ID or error
 */
// Copilot Chat
ipcMain.handle('copilot:send', (_event, tabId, prompt, options) => {
  if (typeof tabId !== 'number' || typeof prompt !== 'string') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  spawnCopilot(tabId, prompt, options || {});
  return tabId;
});

/** @ipc copilot:newTab — Allocates and returns the next tab ID. @returns {number} */
ipcMain.handle('copilot:newTab', () => {
  return nextTabId++;
});

/** @ipc copilot:getCwd @returns {string} Current working directory */
ipcMain.handle('copilot:getCwd', () => {
  return COPILOT_CWD;
});

/** @ipc copilot:openCwd — Opens CWD in the system file explorer. */
ipcMain.handle('copilot:openCwd', () => {
  shell.openPath(COPILOT_CWD);
});

/** @ipc copilot:openLogDir — Opens the log directory in the file explorer. */
ipcMain.handle('copilot:openLogDir', () => {
  shell.openPath(getLogDir());
});

/** @ipc log:write — Renderer-to-file log bridge (fire-and-forget). */
// Renderer → file log bridge
ipcMain.on('log:write', (_event, level, message) => {
  writeLog(level || 'info', [message]);
});

/** @ipc copilot:getVersions — Returns app and CLI version strings. @returns {Promise<{app: string, cli: string}>} */
ipcMain.handle('copilot:getVersions', async () => {
  const appVersion = require('./package.json').version;
  let cliVersion = '?';
  try {
    const { execSync } = require('child_process');
    cliVersion = execSync('copilot --version', { timeout: CLI_VERSION_TIMEOUT_MS, env: buildEnv() }).toString().trim();
  } catch (e) {
    console.warn('[copilot:getVersions] Fehler:', e.message || e);
  }
  return { app: appVersion, cli: cliVersion };
});

/**
 * @ipc copilot:getInstructions — Discovers all copilot-instructions.md files
 * from configured paths, CWD, and home directory.
 * @returns {Array<{path: string, name: string}>} Found instruction files
 */
ipcMain.handle('copilot:getInstructions', () => {
  const cwd = COPILOT_CWD;
  const config = readFolderConfig();
  const configuredPath = config.instructionsFile || path.join(os.homedir(), '.copilot', 'copilot-instructions.md');
  const found = [];
  const candidates = [
    configuredPath,
    path.join(cwd, 'copilot-instructions.md'),
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(os.homedir(), '.github', 'copilot-instructions.md'),
  ].filter((p, i, arr) => arr.indexOf(p) === i); // Deduplizieren
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const rel = path.relative(cwd, p) || path.basename(p);
        found.push({ path: rel.startsWith('..') ? p : rel, name: path.basename(p) });
      }
    } catch (e) {
      console.warn('[copilot:getInstructions] Fehler:', e.message || e);
    }
  }
  return found;
});

/** @ipc copilot:stop — Kills the Copilot CLI process for a tab (fire-and-forget). */
ipcMain.on('copilot:stop', (_event, tabId) => {
  const p = copilotProcesses.get(tabId);
  if (p) p.kill();
  copilotProcesses.delete(tabId);
});

// Process dropped files — read content or copy into Dateien folder
/** @type {string} Target directory for dropped file copies */
const FILES_DROP_DIR = path.join(COPILOT_CWD, 'Dateien');
/** @type {Set<string>} File extensions treated as readable text */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1',
  '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php',
  '.sql', '.csv', '.log', '.gitignore', '.dockerfile', '.properties',
]);
/** @type {Set<string>} Image file extensions for special handling */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff']);
/** @type {Set<string>} Video file extensions */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv']);

/**
 * @ipc files:processDropped — Processes a dropped file (reads text or copies to Dateien/).
 * @param {Electron.IpcMainInvokeEvent} _event
 * @param {string} filePath - Absolute path of the dropped file
 * @returns {{type: string, content?: string, path?: string, message?: string}}
 */
ipcMain.handle('files:processDropped', (_event, filePath) => {
  try {
    return processDroppedFile(filePath, { cwd: COPILOT_CWD, filesDropDir: FILES_DROP_DIR, textExtensions: TEXT_EXTENSIONS, imageExtensions: IMAGE_EXTENSIONS });
  } catch (e) {
    return { type: 'error', message: e.message };
  }
});



/** @ipc sessions:readCheckpoints @param {string} sessionId @returns {Promise<Array>} */
// Sessions
ipcMain.handle('sessions:readCheckpoints', async (_event, sessionId) => {
  return readCheckpoints(safeSessionPath(sessionId));
});

/** @ipc sessions:readPlan @param {string} sessionId @returns {Promise<string|null>} */
ipcMain.handle('sessions:readPlan', async (_event, sessionId) => {
  return readPlan(safeSessionPath(sessionId));
});

/** @ipc sessions:readRecentMessages @param {string} sessionId @returns {Promise<Array>} Last 5 messages */
ipcMain.handle('sessions:readRecentMessages', async (_event, sessionId) => {
  return readRecentMessages(safeSessionPath(sessionId), 5);
});

/** @ipc sessions:delete — Deletes a session directory recursively. @returns {Promise<boolean>} */
ipcMain.handle('sessions:delete', async (_event, sessionId) => {
  try {
    const sessionPath = safeSessionPath(sessionId);
    if (!fs.existsSync(sessionPath)) return false;
    fs.rmSync(sessionPath, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.warn('[sessions:delete] Fehler:', e.message || e);
    return false;
  }
});

/**
 * @ipc sessions:create — Creates a new session directory with workspace.yaml.
 * @param {string} name - Display name for the session
 * @returns {Promise<string>} New session UUID
 */
ipcMain.handle('sessions:create', async (_event, name) => {
  const id = require('crypto').randomUUID();
  const sessionDir = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(sessionDir, { recursive: true });
  const now = new Date().toISOString();
  const ws = {
    id,
    name,
    cwd: COPILOT_CWD,
    created_at: now,
    updated_at: now,
    summary_count: 0,
  };
  fs.writeFileSync(path.join(sessionDir, 'workspace.yaml'), yaml.stringify(ws), 'utf-8');
  return id;
});

/** @ipc todos:list @returns {Promise<Array<Object>>} All todos for the session */
// Todos (per session)
ipcMain.handle('todos:list', async (_event, sessionId) => {
  return readTodos(safeSessionPath(sessionId));
});

/**
 * @ipc todos:add — Adds a new todo to a session.
 * @param {string} sessionId
 * @param {Object} todo - Must contain `text` string property
 * @returns {Promise<Array<Object>>} Updated todo list
 */
ipcMain.handle('todos:add', async (_event, sessionId, todo) => {
  if (!todo || typeof todo !== 'object' || typeof todo.text !== 'string') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  const todos = readTodos(safeSessionPath(sessionId));
  todo.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  todo.status = todo.status || 'open';
  todo.createdAt = new Date().toISOString();
  todos.push(todo);
  writeTodos(safeSessionPath(sessionId), todos);
  return todos;
});

/**
 * @ipc todos:update — Merges updates into an existing todo.
 * @param {string} sessionId
 * @param {string} todoId
 * @param {Object} updates - Fields to merge
 * @returns {Promise<Array<Object>>} Updated todo list
 */
ipcMain.handle('todos:update', async (_event, sessionId, todoId, updates) => {
  if (typeof todoId !== 'string' || typeof updates !== 'object') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  const todos = readTodos(safeSessionPath(sessionId));
  const idx = todos.findIndex(t => t.id === todoId);
  if (idx === -1) return todos;
  Object.assign(todos[idx], updates, { updatedAt: new Date().toISOString() });
  writeTodos(safeSessionPath(sessionId), todos);
  return todos;
});

/** @ipc todos:delete — Removes a todo by ID. @returns {Promise<Array<Object>>} */
ipcMain.handle('todos:delete', async (_event, sessionId, todoId) => {
  let todos = readTodos(safeSessionPath(sessionId));
  todos = todos.filter(t => t.id !== todoId);
  writeTodos(safeSessionPath(sessionId), todos);
  return todos;
});

/**
 * @ipc todos:reorder — Reorders todos according to the given ID sequence.
 * Todos not in the list are appended at the end (safety fallback).
 * @param {string} sessionId
 * @param {string[]} orderedIds
 * @returns {Promise<Array<Object>>} Reordered todo list
 */
ipcMain.handle('todos:reorder', async (_event, sessionId, orderedIds) => {
  const todos = readTodos(safeSessionPath(sessionId));
  const byId = new Map(todos.map(t => [t.id, t]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  // Append any todos not in the ordered list (safety)
  for (const t of todos) {
    if (!orderedIds.includes(t.id)) reordered.push(t);
  }
  writeTodos(safeSessionPath(sessionId), reordered);
  return reordered;
});

// Images → src/ipc/images-ipc.js
const { registerImagesIPC } = require('./src/ipc/images-ipc');
const { startImageWatcher, stopImageWatcher } = registerImagesIPC({ IMAGES_DIR, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, sendToRenderer });

// Preferences (persistent file-based settings)
// Production: stored in app.getPath('userData') so packaged builds
//   (read-only asar) can still write. On Linux this is
//   ~/.config/copilot-desktop/, on Windows %APPDATA%\copilot-desktop\,
//   on macOS ~/Library/Application Support/copilot-desktop/.
// Test: kept next to source for easy cleanup.
// Migration: if an old file from < v0.15.6 exists at __dirname, move it.
const { createPreferencesManager, PREFS_DEFAULTS } = require('./src/preferences');

const PREFS_PATH = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, 'preferences.test.json')
  : path.join(app.getPath('userData'), 'preferences.json');
const PREFS_BAK_PATH = PREFS_PATH + '.bak';

const _prefsManager = createPreferencesManager(PREFS_PATH);

if (process.env.NODE_ENV !== 'test') {
  const legacyPath = path.join(__dirname, 'preferences.json');
  const migrated = _prefsManager.migrateFromIfExists(legacyPath);
  if (migrated) {
    writeLog('info', [`[preferences] Migrated legacy preferences from ${legacyPath} to ${PREFS_PATH}`]);
  }
}

/**
 * Reads user preferences from disk, merged with defaults.
 *
 * @returns {Object} Merged preferences object
 */
function readPreferences() {
  return _prefsManager.read();
}

/**
 * Writes user preferences to disk with atomic backup.
 *
 * @param {Object} prefs - Preferences to persist
 * @returns {boolean} True on success
 */
function writePreferences(prefs) {
  try {
    return _prefsManager.write(prefs);
  } catch (e) {
    writeLog('error', [`[preferences:write] failed at ${e.prefsPath || PREFS_PATH}:`, e.message || String(e)]);
    return false;
  }
}

/** @ipc preferences:read @returns {Promise<Object>} */
ipcMain.handle('preferences:read', async () => {
  return readPreferences();
});

/** @ipc preferences:write @param {Object} prefs @returns {Promise<boolean>} */
ipcMain.handle('preferences:write', async (_event, prefs) => {
  return writePreferences(prefs);
});

/** @ipc skills:list — Scans builtin and user skills. @returns {Promise<Array<Object>>} */
// Skills
ipcMain.handle('skills:list', async () => {
  return scanSkills();
});

/**
 * @ipc skills:listProject — Scans .github/skills/ in a given CWD for project-specific skills.
 * @param {string} cwd - Absolute path to scan
 * @returns {Promise<Array<Object>>} Project skills with source 'project'
 */
ipcMain.handle('skills:listProject', async (_event, cwd) => {
  if (!cwd || typeof cwd !== 'string') return [];
  const projectSkillsDir = path.join(cwd, '.github', 'skills');
  if (!fs.existsSync(projectSkillsDir)) return [];
  return scanSkillDirectory(projectSkillsDir, 'project', userSkillIcon);
});

/**
 * @ipc agents:listProject — Scans .github/agents/ in a given CWD for project-specific agents.
 * @param {string} cwd - Absolute path to scan
 * @returns {Promise<Array<Object>>} Project agents with source 'project'
 */
ipcMain.handle('agents:listProject', async (_event, cwd) => {
  if (!cwd || typeof cwd !== 'string') return [];
  const projectAgentsDir = path.join(cwd, '.github', 'agents');
  if (!fs.existsSync(projectAgentsDir)) return [];
  return scanAgentsDirectory(projectAgentsDir, yaml.parse);
});

/**
 * @ipc mcp:listProject — Reads .github/mcp.json (or .github/copilot-mcp.json) from a given CWD.
 * @param {string} cwd - Absolute path to the project root
 * @returns {Promise<Array<{name: string, type: string, configured: true}>>}
 */
ipcMain.handle('mcp:listProject', async (_event, cwd) => {
  if (!cwd || typeof cwd !== 'string') return [];
  const candidates = [
    path.join(cwd, '.github', 'mcp.json'),
    path.join(cwd, '.github', 'copilot-mcp.json'),
  ];
  for (const filePath of candidates) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const config = JSON.parse(raw);
      const servers = config.mcpServers || {};
      return Object.entries(servers).map(([name, cfg]) => ({
        name,
        type: cfg.type || (cfg.command ? 'stdio' : 'sse'),
        configured: true,
      }));
    } catch {
      // file not found or invalid JSON → try next
    }
  }
  return [];
});

/** @ipc agents:list — Scans .agent.md files. @returns {Promise<Array<Object>>} */
// Agents
ipcMain.handle('agents:list', async () => {
  return scanAgents();
});

/**
 * @ipc skills:delete — Deletes a user skill directory.
 * @param {string} dirName - Skill directory name (alphanumeric, dashes, underscores only)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
// Skills: Delete
ipcMain.handle('skills:delete', async (_event, dirName) => {
  if (!dirName || typeof dirName !== 'string') return { success: false, error: 'Ungültige ID' };
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) return { success: false, error: 'Ungültige ID' };
  const config = readFolderConfig();
  const skillsDir = config.skillsDir || path.join(os.homedir(), '.copilot', 'skills');
  const skillDir = path.join(skillsDir, dirName);
  try {
    await fs.promises.rm(skillDir, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/**
 * @ipc skills:getDisabled — Liest disabledSkills aus ~/.copilot/settings.json
 * @returns {Promise<string[]>}
 */
ipcMain.handle('skills:getDisabled', async () => {
  const settingsPath = path.join(os.homedir(), '.copilot', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const obj = JSON.parse(raw);
    return Array.isArray(obj.disabledSkills) ? obj.disabledSkills : [];
  } catch (e) {
    return [];
  }
});

/**
 * @ipc skills:setDisabled — Schreibt disabledSkills in ~/.copilot/settings.json
 * @param {string[]} disabledSkills
 * @returns {Promise<{success: boolean, error?: string}>}
 */
ipcMain.handle('skills:setDisabled', async (_event, disabledSkills) => {
  if (!Array.isArray(disabledSkills)) return { success: false, error: 'Ungültige Eingabe' };
  const settingsPath = path.join(os.homedir(), '.copilot', 'settings.json');
  try {
    let obj = {};
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      obj = JSON.parse(raw);
    }
    obj.disabledSkills = disabledSkills;
    fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/**
 * @ipc agents:delete — Deletes an agent .agent.md file.
 * @param {string} fileSlug - Agent file slug (alphanumeric, dashes, underscores only)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
// Agents: Delete
ipcMain.handle('agents:delete', async (_event, fileSlug) => {
  if (!fileSlug || typeof fileSlug !== 'string') return { success: false, error: 'Ungültige ID' };
  if (!/^[a-zA-Z0-9_-]+$/.test(fileSlug)) return { success: false, error: 'Ungültige ID' };
  const config = readFolderConfig();
  const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
  const agentFile = path.join(agentsDir, fileSlug + '.agent.md');
  try {
    await fs.promises.unlink(agentFile);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Tests → src/ipc/tests-ipc.js
const { registerTestsIPC } = require('./src/ipc/tests-ipc');
registerTestsIPC({ __dirname, TEST_RUN_TIMEOUT_MS, TEST_COVERAGE_TIMEOUT_MS });

// Plugins → src/ipc/plugins-ipc.js
const { registerPluginsIPC } = require('./src/ipc/plugins-ipc');
registerPluginsIPC();

/** @ipc folders:read — Returns all configured folder paths. @returns {Object} */
// Folders
ipcMain.handle('folders:read', () => {
  const config = readFolderConfig();
  return {
    cwd: COPILOT_CWD,
    sessionsDir: SESSIONS_DIR,
    skillsDir: config.skillsDir || path.join(os.homedir(), '.copilot', 'skills'),
    agentsDir: config.agentsDir || path.join(os.homedir(), '.copilot', 'agents'),
    imagesDir: IMAGES_DIR,
    instructionsFile: config.instructionsFile || path.join(os.homedir(), '.copilot', 'copilot-instructions.md'),
    homeDir: os.homedir(),
  };
});

/**
 * @ipc folders:save — Persists new folder paths and updates runtime globals.
 * @returns {Promise<{success: boolean, requiresRestart?: boolean, error?: string}>}
 */
ipcMain.handle('folders:save', async (_event, newConfig) => {
  try {
    writeFolderConfig(newConfig);
    if (newConfig.cwd) COPILOT_CWD = newConfig.cwd;
    if (newConfig.sessionsDir) SESSIONS_DIR = newConfig.sessionsDir;
    if (newConfig.imagesDir) IMAGES_DIR = newConfig.imagesDir;
    return { success: true, requiresRestart: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/** @ipc folders:browse — Opens a native directory picker dialog. @returns {Promise<string|null>} */
ipcMain.handle('folders:browse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

/**
 * @ipc folders:browse-file — Opens a native file picker dialog.
 * @param {Array<{name: string, extensions: string[]}>} [filters] - File type filters
 * @returns {Promise<string|null>} Selected file path or null
 */
ipcMain.handle('folders:browse-file', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

/** @ipc instructions:read — Reads the copilot-instructions.md file. @returns {Promise<{success: boolean, content: string, path: string}>} */
ipcMain.handle('instructions:read', async () => {
  const config = readFolderConfig();
  const filePath = config.instructionsFile || path.join(os.homedir(), '.copilot', 'copilot-instructions.md');
  try {
    if (!fs.existsSync(filePath)) return { success: true, content: '', path: filePath };
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (e) {
    return { success: false, error: e.message, path: filePath };
  }
});

/** @ipc instructions:write — Writes content to the copilot-instructions.md file. @returns {Promise<{success: boolean, path: string}>} */
ipcMain.handle('instructions:write', async (_event, content) => {
  const config = readFolderConfig();
  const filePath = config.instructionsFile || path.join(os.homedir(), '.copilot', 'copilot-instructions.md');
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Onboarding ─────────────────────────────────────────────────
/** @ipc onboarding:isFirstRun — Checks whether onboarding has been completed. @returns {Promise<boolean>} */
ipcMain.handle('onboarding:isFirstRun', async () => {
  try {
    const config = readFolderConfig();
    return config.onboardingComplete !== true;
  } catch (_) {
    return true;
  }
});

/** @ipc onboarding:complete — Marks onboarding as done in folder config. @returns {Promise<{success: boolean}>} */
ipcMain.handle('onboarding:complete', async () => {
  try {
    const config = readFolderConfig();
    config.onboardingComplete = true;
    writeFolderConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Dev Tools ──────────────────────────────────────────────────
/** @ipc dev:getOnboardingState — Returns current onboarding state for debugging. @returns {Promise<{onboardingComplete: boolean}>} */
ipcMain.handle('dev:getOnboardingState', async () => {
  try {
    const config = readFolderConfig();
    return { onboardingComplete: config.onboardingComplete === true };
  } catch (_) {
    return { onboardingComplete: false };
  }
});

/**
 * @ipc dev:setOnboardingComplete — Overrides onboarding flag.
 * Resets tutorial flags when set to false.
 * @param {boolean} value
 * @returns {Promise<{success: boolean}>}
 */
ipcMain.handle('dev:setOnboardingComplete', async (_event, value) => {
  try {
    const config = readFolderConfig();
    config.onboardingComplete = value === true;
    if (value === false) {
      delete config.tutorialSkillsShown;
      delete config.tutorialRenameShown;
    }
    writeFolderConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/** @ipc tutorial:getFlags — Returns which tutorial hints have been shown. @returns {Promise<Object>} */
ipcMain.handle('tutorial:getFlags', async () => {
  try {
    const config = readFolderConfig();
    return {
      tutorialSkillsShown: config.tutorialSkillsShown === true,
      tutorialRenameShown: config.tutorialRenameShown === true,
    };
  } catch (_) {
    return { tutorialSkillsShown: false, tutorialRenameShown: false };
  }
});

/** @type {string[]} Allowed tutorial flag keys for validation */
const TUTORIAL_FLAG_KEYS = ['tutorialSkillsShown', 'tutorialRenameShown'];

/**
 * @ipc tutorial:setFlag — Persists a tutorial flag.
 * @param {string} key - One of TUTORIAL_FLAG_KEYS
 * @param {boolean} value
 * @returns {Promise<{success: boolean}>}
 */
ipcMain.handle('tutorial:setFlag', async (_event, key, value) => {
  try {
    if (!TUTORIAL_FLAG_KEYS.includes(key)) {
      return { success: false, error: `Invalid tutorial flag key: ${key}` };
    }
    const config = readFolderConfig();
    config[key] = value === true;
    writeFolderConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Starter Agent Templates ────────────────────────────────────
/**
 * Predefined agent/skill templates for common development roles.
 * Used by the setup wizard to create starter .agent.md files.
 *
 * @type {Object<string, {agent: {filename: string, content: string}|null, skill: {filename: string, content: string}|null}>}
 */
const STARTER_TEMPLATES = {
  'code-review': {
    agent: {
      filename: 'code-reviewer.agent.md',
      content: `---\nname: code-reviewer\ndescription: Führt Code Reviews durch und findet Bugs, Sicherheitslücken und Verbesserungspotenzial.\n---\n\nDu bist ein erfahrener Code-Reviewer. Analysiere den gegebenen Code auf:\n- Bugs und Logikfehler\n- Sicherheitslücken\n- Performance-Probleme\n- Code-Qualität und Lesbarkeit\n\nGib konkrete, umsetzbare Verbesserungsvorschläge.`
    },
    skill: null
  },
  'testing': {
    agent: {
      filename: 'tester.agent.md',
      content: `---\nname: tester\ndescription: Schreibt Unit-Tests, Integrationstests und hilft bei Test-Strategien.\n---\n\nDu bist ein Test-Experte. Schreibe vollständige, aussagekräftige Tests.\nNutze das Test-Framework das im Projekt verwendet wird.\nTeste Edge Cases, Error Paths und Happy Paths.`
    },
    skill: null
  },
  'planning': {
    agent: {
      filename: 'planner.agent.md',
      content: `---\nname: planner\ndescription: Erstellt strukturierte Pläne, Aufgabenlisten und Roadmaps.\n---\n\nDu bist ein strukturierter Planer. Zerlege Anforderungen in klare, umsetzbare Aufgaben.\nErstelle Pläne mit klaren Schritten, Abhängigkeiten und Prioritäten.`
    },
    skill: null
  },
  'documentation': {
    agent: {
      filename: 'documenter.agent.md',
      content: `---\nname: documenter\ndescription: Erstellt und verbessert Dokumentation, READMEs und API-Docs.\n---\n\nDu bist ein Dokumentations-Experte. Schreibe klare, vollständige Dokumentation.\nPasse den Stil an die Zielgruppe an (Entwickler, Endnutzer, API-Nutzer).`
    },
    skill: null
  },
  'security': {
    agent: {
      filename: 'security-auditor.agent.md',
      content: `---\nname: security-auditor\ndescription: Findet Sicherheitslücken, OWASP-Risiken und unsichere Patterns.\n---\n\nDu bist ein Security-Experte. Analysiere Code auf:\n- OWASP Top 10 Risiken\n- Injection-Angriffe (SQL, XSS, Command)\n- Authentifizierungs- und Autorisierungsprobleme\n- Unsichere Abhängigkeiten und Konfigurationen`
    },
    skill: null
  },
  'performance': {
    agent: {
      filename: 'performance-analyzer.agent.md',
      content: `---\nname: performance-analyzer\ndescription: Analysiert Performance-Probleme und schlägt Optimierungen vor.\n---\n\nDu bist ein Performance-Experte. Identifiziere:\n- N+1 Queries und ineffiziente DB-Zugriffe\n- Unnötige Re-Renders und Memory Leaks\n- Algorithmen mit schlechter Komplexität\n- Caching-Möglichkeiten`
    },
    skill: null
  }
};

// ── Setup (Folder creation) ────────────────────────────────────
/**
 * Folder definitions for the first-run setup wizard.
 * @type {Array<{key: string, rel: string}>}
 */
const SETUP_FOLDERS = [
  { key: 'skills', rel: '.copilot/skills' },
  { key: 'agents', rel: '.copilot/agents' },
  { key: 'sessions', rel: '.copilot/session-state' },
];
/** @type {{key: string, rel: string, isFile: boolean}} Instructions file setup definition */
const SETUP_INSTRUCTIONS = { key: 'instructions', rel: '.copilot/copilot-instructions.md', isFile: true };

/** @ipc setup:getFolderStatus — Checks which setup folders/files already exist. @returns {Object} */
ipcMain.handle('setup:getFolderStatus', () => {
  const home = os.homedir();
  const result = {};
  for (const item of SETUP_FOLDERS) {
    const fullPath = path.join(home, item.rel);
    result[item.key] = { path: '~/' + item.rel, exists: fs.existsSync(fullPath) };
  }
  const instrPath = path.join(home, SETUP_INSTRUCTIONS.rel);
  result.instructions = { path: '~/' + SETUP_INSTRUCTIONS.rel, exists: fs.existsSync(instrPath), isFile: true };
  return result;
});

/**
 * @ipc setup:createFolders — Creates all missing setup folders and the default instructions file.
 * @returns {Promise<{success: boolean, created: string[], errors: string[]}>}
 */
ipcMain.handle('setup:createFolders', async () => {
  const home = os.homedir();
  const created = [];
  const errors = [];

  for (const item of SETUP_FOLDERS) {
    const fullPath = path.join(home, item.rel);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
        created.push(item.rel);
      } catch (e) {
        errors.push(`${item.rel}: ${e.message}`);
      }
    }
  }

  const instrPath = path.join(home, SETUP_INSTRUCTIONS.rel);
  if (!fs.existsSync(instrPath)) {
    try {
      const dir = path.dirname(instrPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(instrPath, '# Copilot Instructions\n\nAntworte immer auf Deutsch.\n', 'utf-8');
      created.push(SETUP_INSTRUCTIONS.rel);
    } catch (e) {
      errors.push(`${SETUP_INSTRUCTIONS.rel}: ${e.message}`);
    }
  }

  return { success: errors.length === 0, created, errors };
});

/** @ipc setup:getCategories — Returns available starter template categories for the wizard. */
// ── Setup (Starter Agents & Skills) ────────────────────────────
ipcMain.handle('setup:getCategories', () => {
  return [
    { id: 'code-review', icon: '🔍', title: 'Code Review', desc: 'Analysiert Code und findet Probleme' },
    { id: 'testing', icon: '🧪', title: 'Testen', desc: 'Schreibt Unit- und Integrationstests' },
    { id: 'planning', icon: '📋', title: 'Planung', desc: 'Erstellt Pläne und Aufgabenlisten' },
    { id: 'documentation', icon: '📝', title: 'Dokumentation', desc: 'Schreibt Doku und README-Dateien' },
    { id: 'security', icon: '🔒', title: 'Security', desc: 'Findet Sicherheitslücken' },
    { id: 'performance', icon: '⚡', title: 'Performance', desc: 'Analysiert und optimiert Code' },
  ];
});

/**
 * @ipc setup:createStarterFiles — Creates agent/skill files from predefined templates.
 * @param {string[]} categories - Category IDs to create
 * @returns {Promise<{success: boolean, created: string[], skipped: string[], errors: string[]}>}
 */
ipcMain.handle('setup:createStarterFiles', async (_event, categories) => {
  const config = readFolderConfig();
  const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
  const created = [];
  const skipped = [];
  const errors = [];

  for (const catId of categories) {
    const template = STARTER_TEMPLATES[catId];
    if (!template) {
      errors.push(`Unbekannte Kategorie: ${catId}`);
      continue;
    }

    if (template.agent) {
      const filePath = path.join(agentsDir, template.agent.filename);
      if (fs.existsSync(filePath)) {
        skipped.push(template.agent.filename);
      } else {
        try {
          if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
          fs.writeFileSync(filePath, template.agent.content, 'utf-8');
          created.push(template.agent.filename);
        } catch (e) {
          errors.push(`${template.agent.filename}: ${e.message}`);
        }
      }
    }

    if (template.skill) {
      const skillsDir = config.skillsDir || path.join(os.homedir(), '.copilot', 'skills');
      const filePath = path.join(skillsDir, template.skill.filename);
      if (fs.existsSync(filePath)) {
        skipped.push(template.skill.filename);
      } else {
        try {
          if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
          fs.writeFileSync(filePath, template.skill.content, 'utf-8');
          created.push(template.skill.filename);
        } catch (e) {
          errors.push(`${template.skill.filename}: ${e.message}`);
        }
      }
    }
  }

  return { success: errors.length === 0, created, skipped, errors };
});

// ── Setup (Personalized Role → Skills & Agents) ───────────────

/**
 * Converts a display text into a URL/filename-safe kebab-case slug.
 * Handles German umlauts (ä→ae, ö→oe, ü→ue, ß→ss).
 *
 * @param {string} text - Input text to slugify
 * @returns {string} Kebab-case slug
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds a Copilot CLI prompt that instructs it to generate 3 role-specific
 * SKILL.md files in the given directory.
 *
 * @param {string} role - User's professional role description
 * @param {string} skillsDir - Absolute path where skill folders should be created
 * @returns {string} Complete prompt string for Copilot CLI
 */
function buildSkillGenerationPrompt(role, skillsDir) {
  return `Ich arbeite als ${role}. Erstelle genau 3 passende Skills für meinen Aufgabenbereich.

Jeder Skill wird als SKILL.md-Datei in einem eigenen Unterordner angelegt:
${skillsDir}/<skill-name>/SKILL.md

Das SKILL.md-Format ist exakt wie folgt aufgebaut:
\`\`\`
---
name: <kebab-case-name>
description: >
  <1-3 Sätze: Was tut dieser Skill, wann wird er aktiviert?>
---

# <Skill-Titel>

<Hauptinstruktionen: Ausführliche Anleitung wie der Skill arbeiten soll, mindestens 10 Zeilen>
\`\`\`

Anforderungen:
- Erstelle genau 3 Skills die für "${role}" besonders nützlich sind
- Jeder Skill hat einen klaren, praktischen Fokus (kein generischer Kram)
- Die Instruktionen im Body sind konkret und umsetzbar (mindestens 150 Wörter pro Skill)
- Der Name ist kebab-case, deutsch oder englisch je nach Kontext
- Lege die Dateien direkt an — kein Erklären, kein Nachfragen, einfach anlegen
- Antworte auf Deutsch`;
}

/**
 * Spawns a Copilot CLI process to generate role-specific skills.
 * Resolves with a list of created SKILL.md files after the process completes.
 * Times out after 120 seconds.
 *
 * @param {string} role - User's role description
 * @param {string} skillsDir - Target directory for generated skills
 * @returns {Promise<{created: string[], errors: string[]}>}
 */
function runCopilotForSkills(role, skillsDir) {
  return new Promise((resolve, reject) => {
    const prompt = buildSkillGenerationPrompt(role, skillsDir);

    const proc = spawn('copilot', [
      '-p', prompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-color',
      '-s',
    ], {
      cwd: COPILOT_CWD,
      env: buildEnv({ NO_COLOR: '1' }),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout: Copilot hat zu lange gebraucht (120s)'));
    }, 120000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const created = [];
        try {
          if (fs.existsSync(skillsDir)) {
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                  created.push(entry.name + '/SKILL.md');
                }
              }
            }
          }
        } catch (_) {}
        resolve({ created, errors: [] });
      } else {
        reject(new Error(`Copilot exit code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Builds a Copilot CLI prompt to generate .agent.md files for missing team roles.
 *
 * @param {string[]} missingRoles - List of missing team position names
 * @param {string} agentsDir - Absolute path where agent files should be created
 * @returns {string} Complete prompt string for Copilot CLI
 */
function buildAgentGenerationPrompt(missingRoles, agentsDir) {
  const roleList = missingRoles.map(r => `- ${r}`).join('\n');
  return `In meinem Team fehlen folgende Positionen:\n${roleList}\n\nErstelle für jede dieser Positionen einen passenden Agent als .agent.md-Datei in diesem Verzeichnis:\n${agentsDir}\n\nDas .agent.md-Format ist exakt wie folgt aufgebaut:\n\`\`\`\n---\nname: <kebab-case-name>\ndescription: <1-2 Sätze: Was tut dieser Agent, wann wird er genutzt?>\n---\n\n<Hauptinstruktionen: Ausführliche Beschreibung wie der Agent arbeitet, seine Stärken, typische Aufgaben und wie er kommuniziert. Mindestens 200 Wörter.>\n\`\`\`\n\nAnforderungen:\n- Erstelle genau ${missingRoles.length} Agent-Datei(en), eine pro fehlende Position\n- Der Dateiname ist <kebab-case-name>.agent.md\n- Jeder Agent hat eine klare Persönlichkeit und konkrete Arbeitsweise\n- Die Instruktionen beschreiben detailliert wie der Agent denkt, kommuniziert und arbeitet\n- Lege die Dateien direkt an — kein Erklären, kein Nachfragen, einfach anlegen\n- Antworte auf Deutsch`;
}

/**
 * Spawns a Copilot CLI process to generate agent files for missing team positions.
 * Resolves with a list of created .agent.md files after the process completes.
 * Times out after 120 seconds.
 *
 * @param {string[]} missingRoles - Missing team role names
 * @param {string} agentsDir - Target directory for generated agents
 * @returns {Promise<{created: string[], errors: string[]}>}
 */
function runCopilotForAgents(missingRoles, agentsDir) {
  return new Promise((resolve, reject) => {
    const prompt = buildAgentGenerationPrompt(missingRoles, agentsDir);

    const proc = spawn('copilot', [
      '-p', prompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-color',
      '-s',
    ], {
      cwd: COPILOT_CWD,
      env: buildEnv({ NO_COLOR: '1' }),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout: Copilot hat zu lange gebraucht (120s)'));
    }, 120000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const created = [];
        try {
          if (fs.existsSync(agentsDir)) {
            const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isFile() && entry.name.endsWith('.agent.md')) {
                created.push(entry.name);
              }
            }
          }
        } catch (_) {}
        resolve({ created, errors: [] });
      } else {
        reject(new Error(`Copilot exit code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * @ipc setup:generatePersonalized — Generates personalized skills and agents
 * by spawning Copilot CLI processes. Blocking; may take up to 2×120s.
 * @param {Object} data
 * @param {string} data.role - User's role
 * @param {string[]} [data.missingRoles] - Missing team positions
 * @returns {Promise<{success: boolean, created: string[], errors: string[]}>}
 */
ipcMain.handle('setup:generatePersonalized', async (_event, { role, missingRoles }) => {
  const config = readFolderConfig();
  const skillsDir = config.skillsDir || path.join(os.homedir(), '.copilot', 'skills');
  const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');

  const errors = [];
  const created = [];

  // 1. Copilot startet und erstellt Skills
  try {
    const skillResult = await runCopilotForSkills(role, skillsDir);
    created.push(...skillResult.created);
    errors.push(...skillResult.errors);
  } catch (e) {
    errors.push('Skills: ' + e.message);
  }

  // 2. Copilot generiert Agents für fehlende Team-Positionen
  if (missingRoles && missingRoles.length > 0) {
    try {
      if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
      const agentResult = await runCopilotForAgents(missingRoles, agentsDir);
      created.push(...agentResult.created);
      errors.push(...agentResult.errors);
    } catch (e) {
      errors.push('Agents: ' + e.message);
    }
  }

  return { success: errors.length === 0, created, errors };
});

/**
 * @ipc setup:startPersonalizedSessions — Non-blocking variant: returns the prompts
 * for skill/agent generation so the renderer can start them independently.
 * Also marks onboarding as complete.
 * @param {Object} data
 * @param {string} data.role
 * @param {string[]} [data.missingRoles]
 * @returns {Promise<{skillPrompt: string, agentPrompt: string|null}>}
 */
ipcMain.handle('setup:startPersonalizedSessions', async (_event, { role, missingRoles }) => {
  const config = readFolderConfig();
  const skillsDir = config.skillsDir || path.join(os.homedir(), '.copilot', 'skills');
  const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');

  // Ensure directories exist
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

  // Mark onboarding as complete
  const configPath = path.join(os.homedir(), '.copilot', 'config.json');
  let copilotConfig = {};
  try {
    if (fs.existsSync(configPath)) copilotConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {}
  copilotConfig.onboardingComplete = true;
  fs.writeFileSync(configPath, JSON.stringify(copilotConfig, null, 2), 'utf8');

  const skillPrompt = buildSkillGenerationPrompt(role, skillsDir);
  const agentPrompt = (missingRoles && missingRoles.length > 0)
    ? buildAgentGenerationPrompt(missingRoles, agentsDir)
    : null;

  return { skillPrompt, agentPrompt };
});

// ── Auth (Copilot CLI) ─────────────────────────────────────────

/**
 * Reads and parses ~/.copilot/config.json, stripping JS-style comments.
 * Returns an empty object if the file doesn't exist or parsing fails.
 *
 * @returns {Object} Parsed Copilot CLI configuration
 */
function readCopilotConfig() {
  const configPath = path.join(os.homedir(), '.copilot', 'config.json');
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf-8');
    // Strip JS-style single-line comments (config.json may contain //-comments)
    const cleaned = raw.replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('[auth] Failed to read copilot config:', e.message);
    return {};
  }
}

/**
 * @ipc auth:check — Checks if a user is authenticated via ~/.copilot/config.json.
 * @returns {Promise<{success: boolean, authenticated: boolean, user: string|null, host?: string}>}
 */
ipcMain.handle('auth:check', async () => {
  console.log('[auth:check] Reading ~/.copilot/config.json');
  const config = readCopilotConfig();
  const user = config.lastLoggedInUser;
  if (user && user.login) {
    console.log('[auth:check] Authenticated as:', user.login);
    return { success: true, authenticated: true, user: user.login, host: user.host };
  }
  console.log('[auth:check] No lastLoggedInUser found in config');
  return { success: true, authenticated: false, user: null };
});

/**
 * @ipc auth:login — Opens a detached PowerShell window running `copilot login`.
 * @returns {Promise<{success: boolean, pendingInTerminal: boolean, error: null}>}
 */
ipcMain.handle('auth:login', async () => {
  console.log('[auth:login] Starting copilot login in new terminal window');
  const psScript = [
    'Write-Host "Copilot CLI Login" -ForegroundColor Cyan;',
    'copilot login;',
    'Write-Host "";',
    'Write-Host "Dieses Fenster kann jetzt geschlossen werden." -ForegroundColor Green;',
    'Start-Sleep -Seconds 3',
  ].join(' ');
  const child = require('child_process').spawn('powershell.exe', ['-NoLogo', '-Command', psScript], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  });
  child.unref();
  return { success: true, pendingInTerminal: true, error: null };
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ── Skill Icon Mapping ─────────────────────────────────────---
// SKILL_ICON_MAP, builtinSkillIcon, userSkillIcon imported from ./src/utils

// ── Skills Scanner ────────────────────────────────────────────
/**
 * Scans a directory for SKILL.md files and parses their YAML frontmatter.
 *
 * @param {string} dir - Absolute path to the skills directory
 * @param {'builtin'|'user'} source - Whether these are builtin or user skills
 * @param {(name: string) => string} iconFn - Icon resolver function
 * @returns {Array<Object>} Parsed skill metadata
 */
function scanSkillDirectory(dir, source, iconFn) {
  return _scanSkillDirectory(dir, source, iconFn, yaml.parse);
}

/**
 * Scans and returns all skills from both the builtin Copilot CLI package
 * and the user's ~/.copilot/skills/ directory.
 *
 * @returns {Array<Object>} Combined list of builtin and user skills
 */
function scanSkills() {
  const skills = [];

  // 1) Builtin skills from the installed Copilot CLI package
  const pkgBase = path.join(process.env.LOCALAPPDATA || '', 'copilot', 'pkg', 'universal');
  if (fs.existsSync(pkgBase)) {
    // Find the latest version directory
    const versions = fs.readdirSync(pkgBase, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      });

    const latestVersion = versions[0];
    if (latestVersion) {
      const skillsDir = path.join(pkgBase, latestVersion, 'builtin-skills');
      skills.push(...scanSkillDirectory(skillsDir, 'builtin', builtinSkillIcon));
    }
  }

  // 2) User skills from ~/.copilot/skills/
  const userSkillsDir = folderConfig.skillsDir || path.join(os.homedir(), '.copilot', 'skills');
  skills.push(...scanSkillDirectory(userSkillsDir, 'user', userSkillIcon));

  // 3) Plugin skills from ~/.copilot/installed-plugins/
  const installedPluginsBase = path.join(os.homedir(), '.copilot', 'installed-plugins');
  if (fs.existsSync(installedPluginsBase)) {
    const marketplaceDirs = fs.readdirSync(installedPluginsBase, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const marketplaceDir of marketplaceDirs) {
      const marketplacePath = path.join(installedPluginsBase, marketplaceDir.name);
      const pluginDirs = fs.readdirSync(marketplacePath, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const pluginDir of pluginDirs) {
        const pluginSkillsDir = path.join(marketplacePath, pluginDir.name, 'skills');
        if (fs.existsSync(pluginSkillsDir)) {
          skills.push(...scanSkillDirectory(pluginSkillsDir, 'plugin', userSkillIcon));
        }
      }
    }
  }

  return skills;
}

// ── Agents Scanner ────────────────────────────────────────────
/**
 * Scans the agents directory for .agent.md files and parses their frontmatter.
 *
 * @returns {Array<Object>} Parsed agent metadata
 */
function scanAgents() {
  const config = readFolderConfig();
  const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
  return scanAgentsDirectory(agentsDir, yaml.parse);
}

// Terminal → src/ipc/terminal-ipc.js
const { registerTerminalIPC } = require('./src/ipc/terminal-ipc');
registerTerminalIPC({ pty, getShell, terminalProcesses, terminalBuffers, terminalReady, terminalBusy, sendToRenderer, waitForTerminalReady, collectPtyOutput, cleanupPty, COPILOT_CWD, PTY_BUFFER_MAX_CHUNKS, PTY_READY_TIMEOUT_MS, PTY_WRITE_DELAY_MS, PTY_SLASH_QUIET_THRESHOLD_MS, PTY_SLASH_CHECK_INTERVAL_MS, PTY_SLASH_FALLBACK_TIMEOUT_MS });

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  console.log(`[app] Copilot Desktop v${require('./package.json').version} started (platform: ${process.platform}, arch: ${process.arch})`);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
  createWindow();
  startImageWatcher();
});

app.on('window-all-closed', () => {
  copilotProcesses.forEach(p => p.kill());
  copilotProcesses.clear();
  terminalProcesses.forEach(p => p.kill());
  terminalProcesses.clear();
  stopImageWatcher();
  closeLogger();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

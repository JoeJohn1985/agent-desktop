const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const yaml = require('yaml');
const { stripAnsi, safeSessionPath: _safeSessionPath, builtinSkillIcon, userSkillIcon } = require('./src/utils');
const { readCheckpoints, readPlan, readTodos, writeTodos, readRecentMessages } = require('./src/sessions');
const { createSendToRenderer: _createSendToRenderer, waitForReady, collectPtyOutput: _collectPtyOutput, cleanupPty: _cleanupPty, buildEnv } = require('./src/main-helpers');
const { scanSkillDirectory: _scanSkillDirectory, readFolderConfig: _readFolderConfig, writeFolderConfig: _writeFolderConfig } = require('./src/scanners');
const { scanAgentsDirectory } = require('./src/agents');
const { processDroppedFile } = require('./src/file-processing');
const { initLogger, writeLog, closeLogger, getLogDir } = require('./src/logger');

// ── File Logger Init ────────────────────────────────────────
initLogger();

// ── Dev Console Log Capture ─────────────────────────────────
const _originalConsoleLog = console.log;
const _originalConsoleWarn = console.warn;
const _originalConsoleError = console.error;

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
const FOLDERS_CONFIG_PATH = path.join(os.homedir(), '.copilot-desktop', 'folders.json');

function readFolderConfig() {
  return _readFolderConfig(FOLDERS_CONFIG_PATH);
}

function writeFolderConfig(config) {
  _writeFolderConfig(FOLDERS_CONFIG_PATH, config);
}

const folderConfig = readFolderConfig();

// ── Globals ──────────────────────────────────────────────────
let mainWindow = null;
const copilotProcesses = new Map(); // tabId → child process
const terminalProcesses = new Map(); // tabId → pty process
const terminalBuffers = new Map(); // tabId → string[]
const terminalReady = new Map(); // tabId → boolean (Copilot TUI is ready for commands)
let nextTabId = 1;
let SESSIONS_DIR = folderConfig.sessionsDir || path.join(os.homedir(), '.copilot', 'session-state');
const COPILOT_BIN = 'copilot';
let COPILOT_CWD = folderConfig.cwd || process.cwd();
let IMAGES_DIR = folderConfig.imagesDir || path.join(COPILOT_CWD, 'images');
const terminalBusy = new Map(); // tabId → boolean (slash command in progress)

// Bundled PowerShell — fallback to system shell
const BUNDLED_PWSH = path.join(__dirname, 'vendor', 'pwsh', 'pwsh.exe');
function getShell() {
  if (process.platform === 'win32') {
    if (fs.existsSync(BUNDLED_PWSH)) return BUNDLED_PWSH;
    return 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

// ── Constants ──────────────────────────────────────────────────
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
function safeSessionPath(sessionId) {
  return _safeSessionPath(SESSIONS_DIR, sessionId);
}

// ── Helper Functions ─────────────────────────────────────────

const sendToRenderer = _createSendToRenderer(() => mainWindow);

function waitForTerminalReady(tabId, timeoutMs = PTY_READY_TIMEOUT_MS) {
  return waitForReady(terminalReady, tabId, { timeoutMs, checkIntervalMs: PTY_READY_CHECK_INTERVAL_MS });
}

function collectPtyOutput(ptyProc, { quietMs = PTY_QUIET_MS, timeoutMs = PTY_OUTPUT_TIMEOUT_MS } = {}) {
  return _collectPtyOutput(ptyProc, stripAnsi, { quietMs, timeoutMs });
}

function cleanupPty(tabId, exitCode, extraCleanup) {
  _cleanupPty(
    [terminalProcesses, terminalBuffers, terminalReady, terminalBusy],
    tabId, exitCode,
    { extraCleanup, sendFn: sendToRenderer }
  );
}

// ── Window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    title: 'Copilot Desktop',
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

  if (options.sessionId) {
    args.push('--resume=' + options.sessionId);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.effort) {
    args.push('--reasoning-effort', options.effort);
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

// Copilot Chat
ipcMain.handle('copilot:send', (_event, tabId, prompt, options) => {
  if (typeof tabId !== 'number' || typeof prompt !== 'string') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  spawnCopilot(tabId, prompt, options || {});
  return tabId;
});

ipcMain.handle('copilot:newTab', () => {
  return nextTabId++;
});

ipcMain.handle('copilot:getCwd', () => {
  return COPILOT_CWD;
});

ipcMain.handle('copilot:openCwd', () => {
  shell.openPath(COPILOT_CWD);
});

ipcMain.handle('copilot:openLogDir', () => {
  shell.openPath(getLogDir());
});

// Renderer → file log bridge
ipcMain.on('log:write', (_event, level, message) => {
  writeLog(level || 'info', [message]);
});

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

ipcMain.on('copilot:stop', (_event, tabId) => {
  const p = copilotProcesses.get(tabId);
  if (p) p.kill();
  copilotProcesses.delete(tabId);
});

// Process dropped files — read content or copy into Dateien folder
const FILES_DROP_DIR = path.join(COPILOT_CWD, 'Dateien');
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1',
  '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php',
  '.sql', '.csv', '.log', '.gitignore', '.dockerfile', '.properties',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv']);

ipcMain.handle('files:processDropped', (_event, filePath) => {
  try {
    return processDroppedFile(filePath, { cwd: COPILOT_CWD, filesDropDir: FILES_DROP_DIR, textExtensions: TEXT_EXTENSIONS, imageExtensions: IMAGE_EXTENSIONS });
  } catch (e) {
    return { type: 'error', message: e.message };
  }
});



// Sessions
ipcMain.handle('sessions:readCheckpoints', async (_event, sessionId) => {
  return readCheckpoints(safeSessionPath(sessionId));
});

ipcMain.handle('sessions:readPlan', async (_event, sessionId) => {
  return readPlan(safeSessionPath(sessionId));
});

ipcMain.handle('sessions:readRecentMessages', async (_event, sessionId) => {
  return readRecentMessages(safeSessionPath(sessionId), 5);
});

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

// Todos (per session)
ipcMain.handle('todos:list', async (_event, sessionId) => {
  return readTodos(safeSessionPath(sessionId));
});

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

ipcMain.handle('todos:delete', async (_event, sessionId, todoId) => {
  let todos = readTodos(safeSessionPath(sessionId));
  todos = todos.filter(t => t.id !== todoId);
  writeTodos(safeSessionPath(sessionId), todos);
  return todos;
});

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

function readPreferences() {
  return _prefsManager.read();
}

function writePreferences(prefs) {
  try {
    return _prefsManager.write(prefs);
  } catch (e) {
    writeLog('error', [`[preferences:write] failed at ${e.prefsPath || PREFS_PATH}:`, e.message || String(e)]);
    return false;
  }
}

ipcMain.handle('preferences:read', async () => {
  return readPreferences();
});

ipcMain.handle('preferences:write', async (_event, prefs) => {
  return writePreferences(prefs);
});

// Skills
ipcMain.handle('skills:list', async () => {
  return scanSkills();
});

// Agents
ipcMain.handle('agents:list', async () => {
  return scanAgents();
});

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

ipcMain.handle('folders:browse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('folders:browse-file', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

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
ipcMain.handle('onboarding:isFirstRun', async () => {
  try {
    const config = readFolderConfig();
    return config.onboardingComplete !== true;
  } catch (_) {
    return true;
  }
});

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
ipcMain.handle('dev:getOnboardingState', async () => {
  try {
    const config = readFolderConfig();
    return { onboardingComplete: config.onboardingComplete === true };
  } catch (_) {
    return { onboardingComplete: false };
  }
});

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

const TUTORIAL_FLAG_KEYS = ['tutorialSkillsShown', 'tutorialRenameShown'];

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
const SETUP_FOLDERS = [
  { key: 'skills', rel: '.copilot/skills' },
  { key: 'agents', rel: '.copilot/agents' },
  { key: 'sessions', rel: '.copilot/session-state' },
];
const SETUP_INSTRUCTIONS = { key: 'instructions', rel: '.copilot/copilot-instructions.md', isFile: true };

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

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function buildAgentGenerationPrompt(missingRoles, agentsDir) {
  const roleList = missingRoles.map(r => `- ${r}`).join('\n');
  return `In meinem Team fehlen folgende Positionen:\n${roleList}\n\nErstelle für jede dieser Positionen einen passenden Agent als .agent.md-Datei in diesem Verzeichnis:\n${agentsDir}\n\nDas .agent.md-Format ist exakt wie folgt aufgebaut:\n\`\`\`\n---\nname: <kebab-case-name>\ndescription: <1-2 Sätze: Was tut dieser Agent, wann wird er genutzt?>\n---\n\n<Hauptinstruktionen: Ausführliche Beschreibung wie der Agent arbeitet, seine Stärken, typische Aufgaben und wie er kommuniziert. Mindestens 200 Wörter.>\n\`\`\`\n\nAnforderungen:\n- Erstelle genau ${missingRoles.length} Agent-Datei(en), eine pro fehlende Position\n- Der Dateiname ist <kebab-case-name>.agent.md\n- Jeder Agent hat eine klare Persönlichkeit und konkrete Arbeitsweise\n- Die Instruktionen beschreiben detailliert wie der Agent denkt, kommuniziert und arbeitet\n- Lege die Dateien direkt an — kein Erklären, kein Nachfragen, einfach anlegen\n- Antworte auf Deutsch`;
}

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
function scanSkillDirectory(dir, source, iconFn) {
  return _scanSkillDirectory(dir, source, iconFn, yaml.parse);
}

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

  return skills;
}

// ── Agents Scanner ────────────────────────────────────────────
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

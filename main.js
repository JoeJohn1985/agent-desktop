const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const yaml = require('yaml');
const { stripAnsi, safeSessionPath: _safeSessionPath, builtinSkillIcon, userSkillIcon } = require('./src/utils');
const { readCheckpoints, readPlan, readTodos, writeTodos } = require('./src/sessions');
const { createSendToRenderer: _createSendToRenderer, waitForReady, collectPtyOutput: _collectPtyOutput, cleanupPty: _cleanupPty } = require('./src/main-helpers');
const { scanSkillDirectory: _scanSkillDirectory, readFolderConfig: _readFolderConfig, writeFolderConfig: _writeFolderConfig } = require('./src/scanners');
const { scanAgentsDirectory } = require('./src/agents');
const { processDroppedFile } = require('./src/file-processing');

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

console.log = (...args) => { _originalConsoleLog(...args); _sendDevLog('info', args); };
console.warn = (...args) => { _originalConsoleWarn(...args); _sendDevLog('warn', args); };
console.error = (...args) => { _originalConsoleError(...args); _sendDevLog('error', args); };

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
    env: { ...process.env, NO_COLOR: '1' },
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

ipcMain.handle('copilot:getVersions', async () => {
  const appVersion = require('./package.json').version;
  let cliVersion = '?';
  try {
    const { execSync } = require('child_process');
    cliVersion = execSync('copilot --version', { timeout: CLI_VERSION_TIMEOUT_MS }).toString().trim();
  } catch (e) {
    console.warn('[copilot:getVersions] Fehler:', e.message || e);
  }
  return { app: appVersion, cli: cliVersion };
});

ipcMain.handle('copilot:getInstructions', () => {
  const cwd = COPILOT_CWD;
  const found = [];
  const candidates = [
    path.join(cwd, 'copilot-instructions.md'),
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(os.homedir(), '.github', 'copilot-instructions.md'),
  ];
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
// In test mode, use a separate file to avoid polluting real preferences
const PREFS_PATH = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, 'preferences.test.json')
  : path.join(__dirname, 'preferences.json');
const PREFS_BAK_PATH = PREFS_PATH + '.bak';

const PREFS_DEFAULTS = {
  theme: 'dark',
  settings: { allowAllPaths: false },
  deniedTools: [],
  adminDeniedTools: [],
  namedSessions: {},
  openTabs: [],
};

function readPreferences() {
  if (!fs.existsSync(PREFS_PATH)) return { ...PREFS_DEFAULTS };
  try {
    const raw = fs.readFileSync(PREFS_PATH, 'utf-8').trim();
    if (!raw || raw === '{}') return { ...PREFS_DEFAULTS };
    const prefs = JSON.parse(raw);
    // Ensure critical defaults exist
    for (const [key, val] of Object.entries(PREFS_DEFAULTS)) {
      if (prefs[key] === undefined) prefs[key] = val;
    }
    return prefs;
  } catch (e) {
    console.warn('[preferences:read] Fehler — versuche Backup:', e.message || e);
    // Try to restore from backup
    if (fs.existsSync(PREFS_BAK_PATH)) {
      try {
        const bak = JSON.parse(fs.readFileSync(PREFS_BAK_PATH, 'utf-8'));
        console.info('[preferences:read] Backup wiederhergestellt');
        fs.writeFileSync(PREFS_PATH, JSON.stringify(bak, null, 2), 'utf-8');
        return bak;
      } catch (_) { /* backup also corrupt */ }
    }
    return { ...PREFS_DEFAULTS };
  }
}

function writePreferences(prefs) {
  try {
    // Create backup of current file before overwriting
    if (fs.existsSync(PREFS_PATH)) {
      try { fs.copyFileSync(PREFS_PATH, PREFS_BAK_PATH); } catch (_) {}
    }
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.warn('[preferences:write] Fehler:', e.message || e);
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

// Tests → src/ipc/tests-ipc.js
const { registerTestsIPC } = require('./src/ipc/tests-ipc');
registerTestsIPC({ __dirname, TEST_RUN_TIMEOUT_MS, TEST_COVERAGE_TIMEOUT_MS });

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
  createWindow();
  startImageWatcher();
});

app.on('window-all-closed', () => {
  copilotProcesses.forEach(p => p.kill());
  copilotProcesses.clear();
  terminalProcesses.forEach(p => p.kill());
  terminalProcesses.clear();
  stopImageWatcher();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

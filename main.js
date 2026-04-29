const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const yaml = require('yaml');
const { stripAnsi, safeSessionPath: _safeSessionPath, parseContextOutput, builtinSkillIcon, userSkillIcon, SKILL_ICON_MAP } = require('./src/utils');
const { readCheckpoints, readPlan, readConfig, readTodos, writeTodos } = require('./src/sessions');

// ── PTY (optional, for interactive terminal) ─────────────────
let pty;
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch');
} catch (e) {
  try {
    pty = require('node-pty');
  } catch (e2) {
    console.warn('node-pty not available – terminal features disabled.');
  }
}

// ── Folder Configuration ─────────────────────────────────────
const FOLDERS_CONFIG_PATH = path.join(os.homedir(), '.copilot-desktop', 'folders.json');

function readFolderConfig() {
  try {
    if (fs.existsSync(FOLDERS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(FOLDERS_CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('[folders:readConfig] Fehler:', e.message || e);
  }
  return {};
}

function writeFolderConfig(config) {
  const dir = path.dirname(FOLDERS_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FOLDERS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

const folderConfig = readFolderConfig();

// ── Globals ──────────────────────────────────────────────────
let mainWindow = null;
const copilotProcesses = new Map(); // tabId → child process
const terminalProcesses = new Map(); // tabId → pty process
const terminalBuffers = new Map(); // tabId → string[]
const terminalReady = new Map(); // tabId → boolean (Copilot TUI is ready for commands)
let nextTabId = 1;
let COPILOT_DIR = folderConfig.copilotDir || path.join(os.homedir(), '.copilot');
let SESSIONS_DIR = folderConfig.sessionsDir || path.join(COPILOT_DIR, 'session-state');
const COPILOT_BIN = 'copilot';
let COPILOT_CWD = folderConfig.cwd || path.join(os.homedir(), 'Copilot');
let IMAGES_DIR = folderConfig.imagesDir || path.join(COPILOT_CWD, 'images');
const terminalBusy = new Map(); // tabId → boolean (slash command in progress)
let imageWatcher = null;

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

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function waitForTerminalReady(tabId, timeoutMs = PTY_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (terminalReady.get(tabId)) return resolve();
    const check = setInterval(() => {
      if (terminalReady.get(tabId)) {
        clearInterval(check);
        resolve();
      }
    }, PTY_READY_CHECK_INTERVAL_MS);
    setTimeout(() => {
      clearInterval(check);
      if (!terminalReady.get(tabId)) {
        reject(new Error('Terminal nicht bereit (Timeout)'));
      } else {
        resolve();
      }
    }, timeoutMs);
  });
}

function collectPtyOutput(pty, { quietMs = PTY_QUIET_MS, timeoutMs = PTY_OUTPUT_TIMEOUT_MS } = {}) {
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
          resolve(stripAnsi(chunks.join('')));
        }
      }, quietMs);
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        listener.dispose();
        if (quietTimer) clearTimeout(quietTimer);
        resolve(stripAnsi(chunks.join('')));
      }
    }, timeoutMs);
  });
}

function cleanupPty(tabId, exitCode, extraCleanup) {
  terminalProcesses.delete(tabId);
  terminalBuffers.delete(tabId);
  terminalReady.delete(tabId);
  terminalBusy.delete(tabId);
  if (extraCleanup) extraCleanup();
  sendToRenderer('terminal:exit', tabId, exitCode);
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

  // Tool approval
  if (options.autoApprove) {
    args.push('--allow-all-tools');
  } else if (options.allowedTools && options.allowedTools.length > 0) {
    for (const tool of options.allowedTools) {
      args.push('--allow-tool=' + tool);
    }
  }

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

ipcMain.handle('files:processDropped', (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { type: 'error', message: 'Datei nicht gefunden' };

    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);
    const relative = path.relative(COPILOT_CWD, filePath);
    const isInCwd = !relative.startsWith('..') && !path.isAbsolute(relative);

    // File is inside CWD → just return the path
    if (isInCwd) {
      return { type: 'path', path: filePath };
    }

    // Image file outside CWD → copy to Dateien folder
    if (IMAGE_EXTENSIONS.has(ext)) {
      if (!fs.existsSync(FILES_DROP_DIR)) fs.mkdirSync(FILES_DROP_DIR, { recursive: true });
      const dest = path.join(FILES_DROP_DIR, basename);
      fs.copyFileSync(filePath, dest);
      return { type: 'image', path: dest, originalPath: filePath };
    }

    // Text file outside CWD → read content
    if (TEXT_EXTENSIONS.has(ext)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 100 * 1024) {
        return { type: 'error', message: `Datei zu groß (${Math.round(stat.size / 1024)} KB). Max 100 KB.` };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const lang = ext.replace('.', '');
      return { type: 'text', content, filename: basename, lang };
    }

    // Binary/unknown file outside CWD → copy to Dateien folder
    if (!fs.existsSync(FILES_DROP_DIR)) fs.mkdirSync(FILES_DROP_DIR, { recursive: true });
    const dest = path.join(FILES_DROP_DIR, basename);
    fs.copyFileSync(filePath, dest);
    return { type: 'copied', path: dest, originalPath: filePath };
  } catch (e) {
    return { type: 'error', message: e.message };
  }
});

// Instructions — update shell exceptions
const INSTRUCTIONS_PATH = path.join(COPILOT_CWD, 'copilot-instructions.md');

ipcMain.handle('instructions:getShellExceptions', () => {
  try {
    const content = fs.readFileSync(INSTRUCTIONS_PATH, 'utf-8');
    const match = content.match(/\*\*Ausnahmen\*\*[^\n]*\n([\s\S]*?)(?=\n(?:Bei \*\*allen|##|$))/);
    if (!match) return [];
    const items = match[1].match(/^- .+$/gm) || [];
    return items.map(line => line.replace(/^- /, '').trim());
  } catch (e) {
    console.warn('[instructions:getShellExceptions] Fehler:', e.message || e);
    return [];
  }
});

ipcMain.handle('instructions:setShellExceptions', (_event, exceptions) => {
  try {
    let content = fs.readFileSync(INSTRUCTIONS_PATH, 'utf-8');
    const exList = exceptions.map(e => `- ${e}`).join('\n');
    const newSection = `**Ausnahmen** (diese dürfen ohne Rückfrage ausgeführt werden):\n${exList}\n`;
    content = content.replace(
      /\*\*Ausnahmen\*\*[^\n]*\n[\s\S]*?(?=\nBei \*\*allen)/,
      newSection
    );
    fs.writeFileSync(INSTRUCTIONS_PATH, content, 'utf-8');
    return true;
  } catch (e) {
    console.warn('[instructions:setShellExceptions] Fehler:', e.message || e);
    return false;
  }
});

// Sessions
ipcMain.handle('sessions:list', async () => {
  return scanSessions();
});

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

ipcMain.handle('sessions:rename', async (_event, sessionId, newName) => {
  const wsPath = path.join(safeSessionPath(sessionId), 'workspace.yaml');
  if (!fs.existsSync(wsPath)) return false;
  try {
    const raw = fs.readFileSync(wsPath, 'utf-8');
    const ws = yaml.parse(raw);
    ws.name = newName;
    fs.writeFileSync(wsPath, yaml.stringify(ws), 'utf-8');
    return true;
  } catch (e) {
    console.warn('[sessions:rename] Fehler:', e.message || e);
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

// Images

ipcMain.handle('images:list', async () => {
  try {
    if (!fs.existsSync(IMAGES_DIR)) return [];
    const files = fs.readdirSync(IMAGES_DIR);
    return files
      .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(IMAGES_DIR, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    console.warn('[images:list] Fehler:', e.message || e);
    return [];
  }
});

ipcMain.handle('images:open', async (_event, filePath) => {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(IMAGES_DIR + path.sep) && resolved !== IMAGES_DIR) return;
  shell.openPath(resolved);
});

ipcMain.handle('images:delete', async (_event, filePath) => {
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved) && resolved.startsWith(IMAGES_DIR + path.sep)) {
      fs.unlinkSync(resolved);
    }
  } catch (e) {
    console.warn('[images:delete] Fehler:', e.message || e);
  }
});

ipcMain.handle('images:openFolder', async () => {
  shell.openPath(IMAGES_DIR);
});

// Watch images directory for changes
function startImageWatcher() {
  try {
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    let debounce = null;
    imageWatcher = fs.watch(IMAGES_DIR, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        sendToRenderer('images:changed');
      }, 500);
    });
  } catch (e) {
    console.warn('[images:watcher] Fehler:', e.message || e);
  }
}

// Config
ipcMain.handle('config:read', async () => {
  return readConfig(COPILOT_DIR);
});

// Skills
ipcMain.handle('skills:list', async () => {
  return scanSkills();
});

// Tests
ipcMain.handle('tests:run', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile('npx', ['jest', '--json', '--no-coverage'], {
      cwd: __dirname,
      shell: true,
      timeout: TEST_RUN_TIMEOUT_MS,
    }, (error, stdout, stderr) => {
      try {
        const jsonOutput = JSON.parse(stdout);
        resolve({
          success: jsonOutput.success,
          numPassed: jsonOutput.numPassedTests,
          numFailed: jsonOutput.numFailedTests,
          numTotal: jsonOutput.numTotalTests,
          numSuites: jsonOutput.numTotalTestSuites,
          numSuitesPassed: jsonOutput.numPassedTestSuites,
          duration: jsonOutput.startTime ? Date.now() - jsonOutput.startTime : 0,
          testResults: jsonOutput.testResults.map(suite => ({
            name: suite.name.replace(__dirname, '').replace(/\\/g, '/'),
            status: suite.status,
            duration: suite.endTime - suite.startTime,
            tests: suite.assertionResults.map(t => ({
              title: t.title,
              fullName: t.fullName,
              status: t.status,
              duration: t.duration,
              failureMessages: t.failureMessages || [],
            })),
          })),
        });
      } catch (parseErr) {
        resolve({
          success: false,
          error: stderr || stdout || parseErr.message,
          numPassed: 0,
          numFailed: 0,
          numTotal: 0,
          testResults: [],
        });
      }
    });
  });
});

ipcMain.handle('tests:coverage', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile('npx', ['jest', '--coverage', '--json', '--no-color'], {
      cwd: __dirname,
      shell: true,
      timeout: TEST_COVERAGE_TIMEOUT_MS,
    }, (error, stdout, stderr) => {
      try {
        const jsonOutput = JSON.parse(stdout);
        const coverageMap = jsonOutput.coverageMap || {};
        const files = Object.entries(coverageMap).map(([filePath, data]) => {
          const summary = data.s ? Object.values(data.s) : [];
          const totalStatements = summary.length;
          const coveredStatements = summary.filter(v => v > 0).length;
          return {
            file: filePath.replace(__dirname, '').replace(/\\/g, '/'),
            stmts: totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : 0,
          };
        });
        resolve({
          success: jsonOutput.success,
          numPassed: jsonOutput.numPassedTests,
          numTotal: jsonOutput.numTotalTests,
          files,
        });
      } catch (e) {
        resolve({ success: false, error: e.message, files: [] });
      }
    });
  });
});

// Folders
ipcMain.handle('folders:read', () => {
  const config = readFolderConfig();
  return {
    cwd: COPILOT_CWD,
    copilotDir: COPILOT_DIR,
    sessionsDir: SESSIONS_DIR,
    skillsDir: config.skillsDir || path.join(COPILOT_DIR, 'skills'),
    imagesDir: IMAGES_DIR,
    homeDir: os.homedir(),
  };
});

ipcMain.handle('folders:save', async (_event, newConfig) => {
  try {
    writeFolderConfig(newConfig);
    if (newConfig.cwd) COPILOT_CWD = newConfig.cwd;
    if (newConfig.copilotDir) COPILOT_DIR = newConfig.copilotDir;
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

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ── Session Scanner ──────────────────────────────────────────
function scanSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  const sessions = [];
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(SESSIONS_DIR, entry.name, 'workspace.yaml');
    if (!fs.existsSync(wsPath)) continue;

    try {
      const raw = fs.readFileSync(wsPath, 'utf-8');
      const ws = yaml.parse(raw);
      const sessionDir = path.join(SESSIONS_DIR, entry.name);

      // Checkpoint-Anzahl ermitteln
      const cpDir = path.join(sessionDir, 'checkpoints');
      let checkpointCount = 0;
      if (fs.existsSync(cpDir)) {
        checkpointCount = fs.readdirSync(cpDir)
          .filter(f => f.match(/^\d{3}-.*\.md$/)).length;
      }

      const hasPlan = fs.existsSync(path.join(sessionDir, 'plan.md'));
      const isActive = fs.readdirSync(sessionDir)
        .some(f => f.startsWith('inuse.'));

      sessions.push({
        id: ws.id || entry.name,
        name: ws.name || null,
        summary: ws.summary || null,
        cwd: ws.cwd || '',
        createdAt: ws.created_at || '',
        updatedAt: ws.updated_at || '',
        summaryCount: ws.summary_count || 0,
        checkpointCount,
        hasPlan,
        isActive,
      });
    } catch (e) {
      console.warn('[sessions:scan] Fehler:', e.message || e);
    }
  }

  sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return sessions;
}

// ── Skill Icon Mapping ─────────────────────────────────────---
// SKILL_ICON_MAP, builtinSkillIcon, userSkillIcon imported from ./src/utils
// ── Skills Scanner ────────────────────────────────────────────
function scanSkillDirectory(dir, source, iconFn) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    try {
      const raw = fs.readFileSync(skillMd, 'utf-8').replace(/^\uFEFF/, '');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) {
        const meta = yaml.parse(frontmatter[1]);
        results.push({
          id: meta.name || entry.name,
          name: meta.name || entry.name,
          description: meta.description || '',
          source,
          icon: meta.icon || iconFn(meta.name || entry.name),
        });
      }
    } catch (e) {
      console.warn(`[skills:scan:${source}] Fehler:`, e.message || e);
    }
  }
  return results;
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
  const userSkillsDir = folderConfig.skillsDir || path.join(COPILOT_DIR, 'skills');
  skills.push(...scanSkillDirectory(userSkillsDir, 'user', userSkillIcon));

  return skills;
}

// ── Terminal (PTY) IPC ────────────────────────────────────────

ipcMain.handle('terminal:available', () => !!pty);

ipcMain.handle('terminal:spawn-background', (_event, tabId, sessionId) => {
  // Spawn PTY in background without frontend — buffers output for later replay
  console.log('[bg-terminal] spawn request tabId:', tabId, 'sessionId:', sessionId);
  if (terminalProcesses.has(tabId)) { console.log('[bg-terminal] already running'); return { success: true, alreadyRunning: true }; }
  if (!pty) return { success: false, error: 'node-pty not available' };

  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: COPILOT_CWD,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  terminalProcesses.set(tabId, ptyProcess);
  terminalBuffers.set(tabId, []);

  // Buffer output AND forward to renderer (in case xterm is already mounted)
  ptyProcess.onData((data) => {
    const buf = terminalBuffers.get(tabId);
    if (buf) {
      buf.push(data);
      // Cap buffer to prevent memory leak
      if (buf.length > PTY_BUFFER_MAX_CHUNKS) buf.splice(0, buf.length - PTY_BUFFER_MAX_CHUNKS);
    }
    sendToRenderer('terminal:data', tabId, data);
  });

  // Auto-confirm resume prompt and track when TUI is ready
  terminalReady.set(tabId, false);
  let allData = '';
  let confirmed = false;
  const readyListener = ptyProcess.onData((data) => {
    allData += data;
    // Auto-confirm "session already in use" warning (once!)
    if (!confirmed && (allData.includes('already be in use') || allData.includes('conflict'))) {
      confirmed = true;
      console.log('[bg-terminal] Auto-confirming resume for tab', tabId);
      setTimeout(() => ptyProcess.write('1'), 500);
    }
    // Detect when Copilot TUI is fully loaded
    if (!terminalReady.get(tabId) && (allData.includes('/ commands') || allData.includes('? help'))) {
      console.log('[bg-terminal] TUI ready for tab', tabId);
      terminalReady.set(tabId, true);
      readyListener.dispose();
    }
  });
  // Fallback: assume ready after 20s
  const readyFallback = setTimeout(() => {
    if (!terminalReady.get(tabId)) {
      console.log('[bg-terminal] Fallback: assuming ready for tab', tabId);
      terminalReady.set(tabId, true);
    }
    readyListener.dispose();
  }, PTY_READY_TIMEOUT_MS);

  ptyProcess.onExit(({ exitCode }) => {
    cleanupPty(tabId, exitCode, () => { readyListener.dispose(); clearTimeout(readyFallback); });
  });

  // Start copilot
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

// Parse context data from stripped output
// parseContextOutput, builtinSkillIcon, userSkillIcon imported from ./src/utils

ipcMain.handle('terminal:fetch-context', async (_event, tabId) => {
  const p = terminalProcesses.get(tabId);
  console.log('[fetch-context] tabId:', tabId, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
  if (!p) return { success: false, error: 'Kein Background-Terminal aktiv' };
  if (terminalBusy.get(tabId)) return { success: false, error: 'Ein Befehl läuft bereits' };

  terminalBusy.set(tabId, true);
  try {
    await waitForTerminalReady(tabId);
    p.write(`\x1b[200~/context\x1b[201~`);
    // Wait for bracket paste to be processed, then send Enter
    await new Promise(resolve => setTimeout(resolve, 600));
    p.write('\r');
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

// Generic slash command handler — sends any slash command to background PTY
ipcMain.handle('terminal:send-slash', async (_event, tabId, command) => {
  const p = terminalProcesses.get(tabId);
  console.log('[send-slash] tabId:', tabId, 'command:', command, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
  if (!p) return { success: false, error: 'Kein Background-Terminal aktiv' };
  if (terminalBusy.get(tabId)) return { success: false, error: 'Ein Befehl läuft bereits' };

  terminalBusy.set(tabId, true);
  try {
    await waitForTerminalReady(tabId);
    p.write(`\x1b[200~${command}\x1b[201~`);
    // Wait for bracket paste to be processed, then send Enter
    await new Promise(resolve => setTimeout(resolve, 600));
    p.write('\r');
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

  // If a background PTY already exists, reuse it
  if (terminalProcesses.has(tabId)) {
    console.log('[terminal:spawn] Reusing existing PTY for tab', tabId, 'slashCommand:', slashCommand);
    // Send slash command if requested (PTY is already ready)
    if (slashCommand) {
      const p = terminalProcesses.get(tabId);
      // Type each character individually (more reliable than bracketed paste)
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

  // No background PTY — spawn fresh (fallback)
  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: COPILOT_CWD,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  terminalProcesses.set(tabId, ptyProcess);

  ptyProcess.onData((data) => {
    sendToRenderer('terminal:data', tabId, data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    cleanupPty(tabId, exitCode);
  });

  const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
  ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

  // Slash command with timing (fallback for non-background case)
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
  terminalBuffers.delete(tabId); terminalReady.delete(tabId);
  terminalBusy.delete(tabId);
});

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
  if (imageWatcher) { imageWatcher.close(); imageWatcher = null; }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

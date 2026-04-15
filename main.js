const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty');
const yaml = require('yaml');

// ── Globals ──────────────────────────────────────────────────
let mainWindow = null;
const ptyProcesses = new Map(); // tabId → pty process
let nextTabId = 1;
const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const SESSIONS_DIR = path.join(COPILOT_DIR, 'session-state');

// ── Window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    title: 'Copilot Desktop',
    backgroundColor: '#1e1e2e',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    ptyProcesses.forEach(p => p.kill());
    ptyProcesses.clear();
  });
}

// ── PTY (Terminal) ───────────────────────────────────────────
function spawnTerminal(tabId, command) {
  // Kill existing PTY for this tab if any
  if (ptyProcesses.has(tabId)) {
    ptyProcesses.get(tabId).kill();
    ptyProcesses.delete(tabId);
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const args = command
    ? (process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command])
    : [];

  const ptyProc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: 'C:\\Users\\MSchneider\\Copilot',
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  ptyProcesses.set(tabId, ptyProc);

  ptyProc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', tabId, data);
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    ptyProcesses.delete(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', tabId, exitCode);
    }
  });

  return tabId;
}

// ── IPC Handlers ─────────────────────────────────────────────

// Terminal
ipcMain.on('terminal:input', (_event, tabId, data) => {
  const p = ptyProcesses.get(tabId);
  if (p) p.write(data);
});

ipcMain.on('terminal:resize', (_event, tabId, cols, rows) => {
  const p = ptyProcesses.get(tabId);
  if (p) p.resize(cols, rows);
});

ipcMain.handle('terminal:create', (_event, command) => {
  const tabId = nextTabId++;
  spawnTerminal(tabId, command || null);
  return tabId;
});

ipcMain.on('terminal:close', (_event, tabId) => {
  const p = ptyProcesses.get(tabId);
  if (p) p.kill();
  ptyProcesses.delete(tabId);
});

// Sessions
ipcMain.handle('sessions:list', async () => {
  return scanSessions();
});

ipcMain.handle('sessions:readCheckpoints', async (_event, sessionId) => {
  return readCheckpoints(sessionId);
});

ipcMain.handle('sessions:readPlan', async (_event, sessionId) => {
  return readPlan(sessionId);
});

// Config
ipcMain.handle('config:read', async () => {
  return readConfig();
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
        summary: ws.summary || null,
        cwd: ws.cwd || '',
        createdAt: ws.created_at || '',
        updatedAt: ws.updated_at || '',
        summaryCount: ws.summary_count || 0,
        checkpointCount,
        hasPlan,
        isActive,
      });
    } catch { /* skip broken sessions */ }
  }

  sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return sessions;
}

function readCheckpoints(sessionId) {
  const indexPath = path.join(SESSIONS_DIR, sessionId, 'checkpoints', 'index.md');
  if (!fs.existsSync(indexPath)) return '';
  return fs.readFileSync(indexPath, 'utf-8');
}

function readPlan(sessionId) {
  const planPath = path.join(SESSIONS_DIR, sessionId, 'plan.md');
  if (!fs.existsSync(planPath)) return null;
  return fs.readFileSync(planPath, 'utf-8');
}

function readConfig() {
  const cfgPath = path.join(COPILOT_DIR, 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch { return {}; }
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  ptyProcesses.forEach(p => p.kill());
  ptyProcesses.clear();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

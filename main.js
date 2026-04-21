const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const yaml = require('yaml');

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

// ── Globals ──────────────────────────────────────────────────
let mainWindow = null;
const copilotProcesses = new Map(); // tabId → child process
const terminalProcesses = new Map(); // tabId → pty process
let nextTabId = 1;
const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const SESSIONS_DIR = path.join(COPILOT_DIR, 'session-state');
const COPILOT_BIN = 'copilot'; // assumes copilot is in PATH

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
    '--allow-all-tools',
  ];

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
    cwd: options.cwd || 'C:\\Users\\MSchneider\\Copilot',
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('copilot:event', tabId, event);
        }
      } catch (e) {
        // Skip malformed JSON lines
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('copilot:event', tabId, {
        type: 'error',
        data: { message: text },
      });
    }
  });

  proc.on('close', (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('copilot:event', tabId, event);
        }
      } catch { /* ignore */ }
    }
    copilotProcesses.delete(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('copilot:done', tabId, code);
    }
  });

  return tabId;
}

// ── IPC Handlers ─────────────────────────────────────────────

// Copilot Chat
ipcMain.handle('copilot:send', (_event, tabId, prompt, options) => {
  spawnCopilot(tabId, prompt, options || {});
  return tabId;
});

ipcMain.handle('copilot:newTab', () => {
  return nextTabId++;
});

ipcMain.on('copilot:stop', (_event, tabId) => {
  const p = copilotProcesses.get(tabId);
  if (p) p.kill();
  copilotProcesses.delete(tabId);
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

ipcMain.handle('sessions:delete', async (_event, sessionId) => {
  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(sessionPath)) return false;
  fs.rmSync(sessionPath, { recursive: true, force: true });
  return true;
});

ipcMain.handle('sessions:rename', async (_event, sessionId, newName) => {
  const wsPath = path.join(SESSIONS_DIR, sessionId, 'workspace.yaml');
  if (!fs.existsSync(wsPath)) return false;
  try {
    const raw = fs.readFileSync(wsPath, 'utf-8');
    const ws = yaml.parse(raw);
    ws.name = newName;
    fs.writeFileSync(wsPath, yaml.stringify(ws), 'utf-8');
    return true;
  } catch { return false; }
});

// Todos (per session)
ipcMain.handle('todos:list', async (_event, sessionId) => {
  return readTodos(sessionId);
});

ipcMain.handle('todos:add', async (_event, sessionId, todo) => {
  const todos = readTodos(sessionId);
  todo.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  todo.status = todo.status || 'open';
  todo.createdAt = new Date().toISOString();
  todos.push(todo);
  writeTodos(sessionId, todos);
  return todos;
});

ipcMain.handle('todos:update', async (_event, sessionId, todoId, updates) => {
  const todos = readTodos(sessionId);
  const idx = todos.findIndex(t => t.id === todoId);
  if (idx === -1) return todos;
  Object.assign(todos[idx], updates, { updatedAt: new Date().toISOString() });
  writeTodos(sessionId, todos);
  return todos;
});

ipcMain.handle('todos:delete', async (_event, sessionId, todoId) => {
  let todos = readTodos(sessionId);
  todos = todos.filter(t => t.id !== todoId);
  writeTodos(sessionId, todos);
  return todos;
});

// Config
ipcMain.handle('config:read', async () => {
  return readConfig();
});

// Skills
ipcMain.handle('skills:list', async () => {
  return scanSkills();
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
    } catch { /* skip broken sessions */ }
  }

  sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return sessions;
}

function readCheckpoints(sessionId) {
  const indexPath = path.join(SESSIONS_DIR, sessionId, 'checkpoints', 'index.md');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const checkpoints = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (match) {
        checkpoints.push({
          number: parseInt(match[1]),
          title: match[2].trim(),
          file: match[3].trim(),
        });
      }
    }
    return checkpoints;
  } catch { return []; }
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

// ── Todos (per session) ──────────────────────────────────────
function readTodos(sessionId) {
  const todosPath = path.join(SESSIONS_DIR, sessionId, 'todos.json');
  if (!fs.existsSync(todosPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(todosPath, 'utf-8'));
  } catch { return []; }
}

function writeTodos(sessionId, todos) {
  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(sessionPath)) return;
  fs.writeFileSync(path.join(sessionPath, 'todos.json'), JSON.stringify(todos, null, 2), 'utf-8');
}

// ── Skills Scanner ────────────────────────────────────────────
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
      if (fs.existsSync(skillsDir)) {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
          if (!fs.existsSync(skillMd)) continue;

          try {
            const raw = fs.readFileSync(skillMd, 'utf-8');
            const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (frontmatter) {
              const meta = yaml.parse(frontmatter[1]);
              skills.push({
                id: meta.name || entry.name,
                name: meta.name || entry.name,
                description: meta.description || '',
                source: 'builtin',
                icon: '🧩',
              });
            }
          } catch { /* skip broken skill */ }
        }
      }
    }
  }

  // 2) User skills from ~/.copilot/skills/
  const userSkillsDir = path.join(COPILOT_DIR, 'skills');
  if (fs.existsSync(userSkillsDir)) {
    for (const entry of fs.readdirSync(userSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(userSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      try {
        const raw = fs.readFileSync(skillMd, 'utf-8');
        const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter) {
          const meta = yaml.parse(frontmatter[1]);
          skills.push({
            id: meta.name || entry.name,
            name: meta.name || entry.name,
            description: meta.description || '',
            source: 'user',
            icon: '⚡',
          });
        }
      } catch { /* skip broken skill */ }
    }
  }

  return skills;
}

// ── Terminal (PTY) IPC ────────────────────────────────────────

ipcMain.handle('terminal:available', () => !!pty);

ipcMain.handle('terminal:spawn', (_event, tabId, sessionId, slashCommand) => {
  if (!pty) {
    return { success: false, error: 'node-pty ist nicht installiert. Bitte "npm install" und ggf. "npx electron-rebuild" ausführen.' };
  }

  // Kill existing terminal for this tab
  if (terminalProcesses.has(tabId)) {
    terminalProcesses.get(tabId).kill();
    terminalProcesses.delete(tabId);
  }

  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: 'C:\\Users\\MSchneider\\Copilot',
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  terminalProcesses.set(tabId, ptyProcess);

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', tabId, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminalProcesses.delete(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', tabId, exitCode);
    }
  });

  // Start copilot interactively in the PTY
  const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
  ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

  // Send slash command after copilot has started
  if (slashCommand) {
    setTimeout(() => {
      ptyProcess.write(`${slashCommand}\r`);
    }, 3000);
  }

  return { success: true };
});

ipcMain.on('terminal:input', (_event, tabId, data) => {
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
});

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  copilotProcesses.forEach(p => p.kill());
  copilotProcesses.clear();
  terminalProcesses.forEach(p => p.kill());
  terminalProcesses.clear();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

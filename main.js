const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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

// ── Folder Configuration ─────────────────────────────────────
const FOLDERS_CONFIG_PATH = path.join(os.homedir(), '.copilot-desktop', 'folders.json');

function readFolderConfig() {
  try {
    if (fs.existsSync(FOLDERS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(FOLDERS_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
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

// ── Path Safety ──────────────────────────────────────────────
function safeSessionPath(sessionId) {
  const resolved = path.resolve(SESSIONS_DIR, sessionId);
  if (!resolved.startsWith(SESSIONS_DIR + path.sep) && resolved !== SESSIONS_DIR) {
    throw new Error('Invalid session ID');
  }
  return resolved;
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
    cliVersion = execSync('copilot --version', { timeout: 5000 }).toString().trim();
  } catch {}
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
    } catch (_) {}
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
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico']);

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
  } catch { return []; }
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
  } catch (e) { return false; }
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
  try {
    const sessionPath = safeSessionPath(sessionId);
    if (!fs.existsSync(sessionPath)) return false;
    fs.rmSync(sessionPath, { recursive: true, force: true });
    return true;
  } catch { return false; }
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
  } catch { return false; }
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

ipcMain.handle('todos:reorder', async (_event, sessionId, orderedIds) => {
  const todos = readTodos(sessionId);
  const byId = new Map(todos.map(t => [t.id, t]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  // Append any todos not in the ordered list (safety)
  for (const t of todos) {
    if (!orderedIds.includes(t.id)) reordered.push(t);
  }
  writeTodos(sessionId, reordered);
  return reordered;
});

// Images
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

ipcMain.handle('images:list', async () => {
  try {
    if (!fs.existsSync(IMAGES_DIR)) return [];
    const files = fs.readdirSync(IMAGES_DIR);
    return files
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(IMAGES_DIR, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) { return []; }
});

ipcMain.handle('images:open', async (_event, filePath) => {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(IMAGES_DIR + path.sep) && resolved !== IMAGES_DIR) return;
  shell.openPath(resolved);
});

ipcMain.handle('images:delete', async (_event, filePath) => {
  try {
    if (fs.existsSync(filePath) && filePath.startsWith(IMAGES_DIR)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('images:changed');
        }
      }, 500);
    });
  } catch (_) {}
}

// Config
ipcMain.handle('config:read', async () => {
  return readConfig();
});

// Skills
ipcMain.handle('skills:list', async () => {
  return scanSkills();
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
    } catch { /* skip broken sessions */ }
  }

  sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return sessions;
}

function readCheckpoints(sessionId) {
  const indexPath = path.join(safeSessionPath(sessionId), 'checkpoints', 'index.md');
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
  const planPath = path.join(safeSessionPath(sessionId), 'plan.md');
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
  const todosPath = path.join(safeSessionPath(sessionId), 'todos.json');
  if (!fs.existsSync(todosPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(todosPath, 'utf-8'));
  } catch { return []; }
}

function writeTodos(sessionId, todos) {
  const sessionPath = safeSessionPath(sessionId);
  if (!fs.existsSync(sessionPath)) return;
  fs.writeFileSync(path.join(sessionPath, 'todos.json'), JSON.stringify(todos, null, 2), 'utf-8');
}

// ── Skill Icon Mapping ─────────────────────────────────────---
const SKILL_ICON_MAP = {
  'task-router': '🧠',
  'code-review': '🔍',
  'quality-audit': '🧪',
  'security-audit': '🛡️',
  'customize-cloud-agent': '☁️',
};
function builtinSkillIcon(name) {
  return SKILL_ICON_MAP[(name || '').toLowerCase()] || '🧩';
}
function userSkillIcon(name) {
  const mapped = SKILL_ICON_MAP[(name || '').toLowerCase()];
  if (mapped) return mapped;
  const m = (name||'').match(/([\p{Emoji}])/u);
  return m ? m[1] : '🧩';
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
            const raw = fs.readFileSync(skillMd, 'utf-8').replace(/^\uFEFF/, '');
            const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (frontmatter) {
              const meta = yaml.parse(frontmatter[1]);
              skills.push({
                id: meta.name || entry.name,
                name: meta.name || entry.name,
                description: meta.description || '',
                source: 'builtin',
                icon: meta.icon || builtinSkillIcon(meta.name || entry.name),
              });
            }
          } catch { /* skip broken skill */ }
        }
      }
    }
  }

  // 2) User skills from ~/.copilot/skills/
  const userSkillsDir = folderConfig.skillsDir || path.join(COPILOT_DIR, 'skills');
  if (fs.existsSync(userSkillsDir)) {
    for (const entry of fs.readdirSync(userSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(userSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      try {
        const raw = fs.readFileSync(skillMd, 'utf-8').replace(/^\uFEFF/, '');
        const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter) {
          const meta = yaml.parse(frontmatter[1]);
          skills.push({
            id: meta.name || entry.name,
            name: meta.name || entry.name,
            description: meta.description || '',
            source: 'user',
            icon: meta.icon || userSkillIcon(meta.name || entry.name),
          });
        }
      } catch { /* skip broken skill */ }
    }
  }

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
      // Cap buffer at 5000 chunks to prevent memory leak
      if (buf.length > 5000) buf.splice(0, buf.length - 5000);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', tabId, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminalProcesses.delete(tabId);
    terminalBuffers.delete(tabId); terminalReady.delete(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', tabId, exitCode);
    }
  });

  // Start copilot
  const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
  ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

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
  setTimeout(() => {
    if (!terminalReady.get(tabId)) {
      console.log('[bg-terminal] Fallback: assuming ready for tab', tabId);
      terminalReady.set(tabId, true);
    }
    readyListener.dispose();
  }, 20000);

  return { success: true };
});

ipcMain.handle('terminal:get-buffer', (_event, tabId) => {
  return terminalBuffers.get(tabId) || [];
});

ipcMain.handle('terminal:send-command', (_event, tabId, command) => {
  const p = terminalProcesses.get(tabId);
  if (!p) return { success: false, error: 'No terminal process' };
  p.write(`\x1b[200~${command}\x1b[201~`);
  setTimeout(() => p.write('\r'), 100);
  return { success: true };
});

// Parse context data from stripped output
function parseContextOutput(text) {
  const result = { raw: text };
  
  try {
    // Extract "Model · UsedK/TotalK tokens (Percent%)"
    // Example: "Claude Opus 4.6 · 136k/200k tokens (68%)"
    const headerMatch = text.match(/([A-Za-z\s.]+\d[\w.]*)\s*[·]\s*([\d.]+k)\/([\d.]+k)\s*tokens?\s*\((\d+)%\)/i);
    if (headerMatch) {
      result.model = headerMatch[1].trim();
      result.usedTokens = headerMatch[2];
      result.totalTokens = headerMatch[3];
      result.percent = parseInt(headerMatch[4]);
    }
    
    // Extract categories: "Category: Xk (Y%)"
    const categories = [];
    const catRegex = /(System\/Tools|Messages|Free Space|Buffer):\s*([\d.]+k)\s*\((\d+)%\)/gi;
    let match;
    while ((match = catRegex.exec(text)) !== null) {
      categories.push({ name: match[1], tokens: match[2], percent: parseInt(match[3]) });
    }
    if (categories.length) result.categories = categories;
  } catch (e) {
    console.log('[parseContextOutput] Parse error, returning raw:', e.message);
  }
  
  return result;
}

ipcMain.handle('terminal:fetch-context', (_event, tabId) => {
  return new Promise((resolve) => {
    const p = terminalProcesses.get(tabId);
    console.log('[fetch-context] tabId:', tabId, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
    if (!p) return resolve({ success: false, error: 'Kein Background-Terminal aktiv' });
    if (terminalBusy.get(tabId)) return resolve({ success: false, error: 'Ein Befehl läuft bereits' });
    terminalBusy.set(tabId, true);
    const waitForReady = () => {
      if (terminalReady.get(tabId)) {
        sendContextCommand();
      } else {
        console.log('[fetch-context] Waiting for TUI to be ready...');
        let waited = 0;
        const readyCheck = setInterval(() => {
          waited += 500;
          if (terminalReady.get(tabId)) {
            clearInterval(readyCheck);
            sendContextCommand();
          } else if (waited > 20000) {
            clearInterval(readyCheck);
            terminalBusy.set(tabId, false);
            resolve({ success: false, error: 'Terminal nicht bereit (Timeout)' });
          }
        }, 500);
      }
    };
    
    const sendContextCommand = () => {
      const chunks = [];
      let lastDataTime = Date.now();
      let resolved = false;
    
    const onData = p.onData((data) => {
      chunks.push(data);
      lastDataTime = Date.now();
    });
    
    // Send /context via bracketed paste (TUI needs this for slash commands)
    p.write(`\x1b[200~/context\x1b[201~`);
    setTimeout(() => p.write('\r'), 500);
    
    // Wait until output settles (3s quiet), then return
    const checkInterval = setInterval(() => {
      if (chunks.length > 0 && Date.now() - lastDataTime > 3000) {
        clearInterval(checkInterval);
        onData.dispose();
        if (resolved) return; resolved = true; terminalBusy.set(tabId, false);
        
        const raw = chunks.join('');
        // Strip ANSI escape sequences and control characters
        const stripped = raw
          .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
          .replace(/\x1b[()][0-9A-Z]/g, '')
          .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
          .replace(/\r/g, '');
        
        console.log('[fetch-context] done, stripped length:', stripped.length);
        console.log('[fetch-context] OUTPUT:', stripped.substring(0, 500));
        resolve({ success: true, ...parseContextOutput(stripped) });
      }
    }, 500);
    
    // Timeout after 15s
    setTimeout(() => {
      clearInterval(checkInterval);
      onData.dispose();
      if (resolved) return; resolved = true; terminalBusy.set(tabId, false);
      if (chunks.length === 0) {
        resolve({ success: false, error: 'Timeout — keine Antwort vom Terminal' });
      } else {
        const raw = chunks.join('');
        const stripped = raw
          .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
          .replace(/\x1b[()][0-9A-Z]/g, '')
          .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
          .replace(/\r/g, '');
        resolve({ success: true, ...parseContextOutput(stripped), timedOut: true });
      }
    }, 15000);
    }; // end sendContextCommand
    
    waitForReady();
  });
});

// Generic slash command handler — sends any slash command to background PTY
ipcMain.handle('terminal:send-slash', (_event, tabId, command) => {
  return new Promise((resolve) => {
    const p = terminalProcesses.get(tabId);
    console.log('[send-slash] tabId:', tabId, 'command:', command, 'has PTY:', !!p, 'ready:', terminalReady.get(tabId));
    if (!p) return resolve({ success: false, error: 'Kein Background-Terminal aktiv' });
    if (terminalBusy.get(tabId)) return resolve({ success: false, error: 'Ein Befehl läuft bereits' });
    terminalBusy.set(tabId, true);
    
    const waitForReady = () => {
      if (terminalReady.get(tabId)) {
        sendCommand();
      } else {
        let waited = 0;
        const readyCheck = setInterval(() => {
          waited += 500;
          if (terminalReady.get(tabId)) {
            clearInterval(readyCheck);
            sendCommand();
          } else if (waited > 20000) {
            clearInterval(readyCheck);
            terminalBusy.set(tabId, false);
            resolve({ success: false, error: 'Terminal nicht bereit (Timeout)' });
          }
        }, 500);
      }
    };
    
    const sendCommand = () => {
      const chunks = [];
      let lastDataTime = Date.now();
      let resolved = false;
      
      const onData = p.onData((data) => {
        chunks.push(data);
        lastDataTime = Date.now();
      });
      
      // Send command via bracketed paste
      p.write(`\x1b[200~${command}\x1b[201~`);
      setTimeout(() => p.write('\r'), 500);
      
      // Wait until output settles (3s quiet)
      const checkInterval = setInterval(() => {
        if (chunks.length > 0 && Date.now() - lastDataTime > 3000) {
          clearInterval(checkInterval);
          onData.dispose();
          if (resolved) return; resolved = true; terminalBusy.set(tabId, false);
          
          const raw = chunks.join('');
          const stripped = raw
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][0-9A-Z]/g, '')
            .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
            .replace(/\r/g, '');
          
          console.log('[send-slash] done, command:', command, 'stripped length:', stripped.length);
          // Also parse context data if present (e.g. after /compact)
          const parsed = parseContextOutput(stripped);
          resolve({ success: true, output: stripped, ...parsed });
        }
      }, 500);
      
      // Timeout after 15s
      setTimeout(() => {
        clearInterval(checkInterval);
        onData.dispose();
        if (resolved) return; resolved = true; terminalBusy.set(tabId, false);
        if (chunks.length === 0) {
          resolve({ success: false, error: 'Timeout — keine Antwort vom Terminal' });
        } else {
          const raw = chunks.join('');
          const stripped = raw
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][0-9A-Z]/g, '')
            .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
            .replace(/\r/g, '');
          const parsed = parseContextOutput(stripped);
          resolve({ success: true, output: stripped, ...parsed, timedOut: true });
        }
      }, 15000);
    };
    
    waitForReady();
  });
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', tabId, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminalProcesses.delete(tabId);
    terminalBuffers.delete(tabId); terminalReady.delete(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', tabId, exitCode);
    }
  });

  const resumeArg = sessionId ? ` --resume=${sessionId}` : '';
  ptyProcess.write(`copilot --allow-all-tools${resumeArg}\r`);

  // Slash command with timing (fallback for non-background case)
  if (slashCommand) {
    let lastDataTime = Date.now();
    let slashSent = false;
    const onData = ptyProcess.onData(() => { lastDataTime = Date.now(); });
    const checkInterval = setInterval(() => {
      if (!slashSent && Date.now() - lastDataTime > 5000) {
        slashSent = true;
        console.log('[terminal:slash] PTY quiet for 5s — sending:', slashCommand);
        ptyProcess.write(`\x1b[200~${slashCommand}\x1b[201~`);
        setTimeout(() => ptyProcess.write('\r'), 100);
        clearInterval(checkInterval);
        onData.dispose();
      }
    }, 500);
    setTimeout(() => {
      if (!slashSent) console.log('[terminal:slash] Fallback timeout — command not sent');
      clearInterval(checkInterval);
      onData.dispose();
    }, 30000);
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
  terminalBuffers.delete(tabId); terminalReady.delete(tabId);
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

const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const yaml = require('yaml');

// Force WM_CLASS on Linux (must be set before app 'ready')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'agent-desktop');
}
const { stripAnsi, safeSessionPath: _safeSessionPath, builtinSkillIcon, userSkillIcon } = require('./src/utils');
const { readCheckpoints, readPlan, readRecentMessages, readAllMessages } = require('./src/sessions');
const { readClaudeCodeTranscript } = require('./src/claude-code-transcript');
const { readTodos, writeTodos } = require('./src/todos');
const { createSendToRenderer: _createSendToRenderer, buildEnv } = require('./src/main-helpers');
const { scanSkillDirectory: _scanSkillDirectory, scanSkillsIndex: _scanSkillsIndex, readFolderConfig: _readFolderConfig, writeFolderConfig: _writeFolderConfig } = require('./src/scanners');
const { scanAgentsDirectory, scanAgentsIndex: _scanAgentsIndex } = require('./src/agents');
const { readAllInstructions } = require('./src/instructions');
const { AcpClient } = require('./src/acp-client');
const { getModelProvider, createApiBackend } = require('./src/providers');
const secureStore = require('./src/secure-store');
const { processDroppedFile } = require('./src/file-processing');
const { initLogger, writeLog, closeLogger, getLogDir } = require('./src/logger');
const { DATA_DIR, migrateLegacyData, providerSkillsDir, providerAgentsDir, providerInstructionsDir, migrateClaudeCodeSkills, migrateApiSessions } = require('./src/data-dir');
const { syncMarketplaceSkills } = require('./src/plugin-skill-mirror');

app.name = 'agent-desktop';

// One-shot migration of legacy "copilot-desktop" data (home dir + userData) into
// the new "agent-desktop" identity. Must run before the logger creates its dir
// and before preferences are read. Windows keeps encrypted keys valid (DPAPI).
if (process.env.NODE_ENV !== 'test') {
  try {
    migrateLegacyData({
      userDataDir: app.getPath('userData'),
      legacyUserDataDir: path.join(app.getPath('appData'), 'copilot-desktop'),
    });
    // One-shot: carry over any skills the user already placed in the old
    // app-managed Claude Code skills folder into Claude's own native
    // ~/.claude/skills (see providerSkillsDir('claude-code') in data-dir.js).
    migrateClaudeCodeSkills();
    // One-shot: carry over direct-API session history saved under the old
    // ~/.copilot-desktop/api-sessions path (a rename leftover) into the
    // current ~/.agent-desktop/api-sessions (see session-store.js).
    migrateApiSessions();
  } catch (_) { /* best effort — never block startup */ }
}

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

// ── Folder Configuration ─────────────────────────────────────
/** @type {string} Path to the persistent folder configuration JSON */
const FOLDERS_CONFIG_PATH = path.join(DATA_DIR, 'folders.json');

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
/** @type {Map<number, object>} tabId → ChatBackend instance (AcpClient or a direct-API backend) */
const backends = new Map();
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
/**
 * Providers that get their own ~/.agent-desktop/<provider>/{skills,agents}
 * folders with the lazy skills/agents index. Copilot keeps its native
 * ~/.copilot/{skills,agents} (the CLI reads them itself); Gemini is
 * intentionally kept context-light. Claude Code is a hybrid: its *agents*
 * folder is app-managed like the others (~/.agent-desktop/claude-code/agents),
 * but providerSkillsDir('claude-code') resolves to Claude's own native
 * ~/.claude/skills instead — see data-dir.js — since Claude Code discovers
 * skills there itself and an app-side index would just duplicate them.
 * @type {string[]}
 */
const LAZY_CONTEXT_PROVIDERS = ['claude-code', 'anthropic', 'openai', 'glm', 'ollama'];

/**
 * Providers that get their own ~/.agent-desktop/<provider>/instructions folder,
 * whose active files are inlined in full into the system prompt. Deliberately
 * narrower than LAZY_CONTEXT_PROVIDERS: Claude Code already has its own native
 * CLAUDE.md discovery (hierarchical, unconditional), so duplicating an
 * app-managed instructions mechanism for it would only add confusion.
 * @type {string[]}
 */
const INSTRUCTIONS_PROVIDERS = ['anthropic', 'openai', 'glm', 'ollama'];

/** Creates the per-provider skills/agents/instructions folders (if missing) so they show up on disk right away. */
function ensureProviderContextDirs() {
  for (const provider of LAZY_CONTEXT_PROVIDERS) {
    for (const dir of [providerSkillsDir(provider), providerAgentsDir(provider)]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.warn(`[context] Ordner ${dir} konnte nicht angelegt werden:`, e.message); }
    }
  }
  for (const provider of INSTRUCTIONS_PROVIDERS) {
    try { fs.mkdirSync(providerInstructionsDir(provider), { recursive: true }); } catch (e) { console.warn(`[context] Ordner ${providerInstructionsDir(provider)} konnte nicht angelegt werden:`, e.message); }
  }
}

// ── Constants ──────────────────────────────────────────────────
const CLI_VERSION_TIMEOUT_MS = 5000;
const MCP_PROBE_TIMEOUT_MS = 5000;
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
    title: 'Agent Desktop',
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
    backends.forEach(client => client.destroy().catch(() => {}));
    backends.clear();
  });
}

// ── Copilot Process (ACP Backend) ────────────────────────────
/**
 * Gets or creates an AcpClient for the given tab. Sends the prompt via ACP protocol.
 *
 * @param {number} tabId - Target tab identifier
 * @param {string} prompt - User prompt to send
 * @param {Object} [options={}] - Additional options
 * @param {string[]} [options.deniedTools] - Tools to deny via --deny-tool
 * @param {boolean} [options.allowAllPaths] - If true, adds --allow-all-paths
 * @param {string[]} [options.addDirs] - Additional directories to grant access to
 * @param {string} [options.sessionId] - Session ID to resume
 * @param {string} [options.model] - Model override
 * @param {string} [options.effort] - Reasoning effort level (unused in ACP currently)
 * @param {string} [options.cwd] - Working directory override
 * @returns {Promise<number>} The tab ID
 */
/**
 * Base AcpClient options for the Claude Code adapter (shared by the prompt path
 * and the session-list/resume path). Model/mode/approval are layered on top.
 * @param {string} cwd
 */
function claudeCodeClientOptions(cwd) {
  return {
    cwd,
    command: 'npx',
    // Current adapter (@zed-industries/claude-code-acp is deprecated). -y installs
    // it non-interactively on first run.
    baseArgs: ['-y', '@agentclientprotocol/claude-agent-acp'],
    // npx is a .cmd on Windows → must run through a shell (spawn ENOENT otherwise).
    shell: true,
    // The adapter returns slash-command output (/context) on stderr wrapped in
    // <local-command-stdout>, not via the ACP response.
    localCommandStdout: true,
    // Bill the Claude subscription, not the API.
    stripEnv: ['ANTHROPIC_API_KEY'],
    // model/mode are session config options, not session/set_model/set_mode.
    useConfigOptions: true,
    mcpServers: [],
  };
}

async function sendCopilotPrompt(tabId, prompt, options = {}) {
  const cwd = options.cwd || COPILOT_CWD;
  // The explicit ProviderID from the renderer is authoritative; fall back to
  // deriving it from the model only for legacy callers.
  const provider = options.provider || getModelProvider(options.model || '');

  let client = backends.get(tabId);

  // If the selected provider changed for this tab, tear down the old backend.
  if (client && client.__provider && client.__provider !== provider) {
    try { await client.destroy(); } catch (_) { /* ignore */ }
    backends.delete(tabId);
    client = null;
  }

  // ACP-based backends: Copilot CLI and Claude Code (via the ACP adapter).
  // Everything else is a direct-API backend.
  const ACP_PROVIDERS = new Set(['copilot', 'claude-code']);
  if (!ACP_PROVIDERS.has(provider)) {
    return sendApiPrompt(tabId, prompt, { ...options, cwd, provider, existing: client });
  }

  // ── ACP path (Copilot / Claude Code) ─────────────────────────
  let clientOptions;
  if (provider === 'claude-code') {
    clientOptions = {
      ...claudeCodeClientOptions(cwd),
      // No app-side auto-approve override here: Claude Code's own permission
      // mode (default/acceptEdits/plan/bypassPermissions, set via options.mode)
      // is the single source of truth for whether it asks before acting.
      autoApprovePermissions: false,
      model: options.model,
      mode: options.mode,
    };
  } else {
    clientOptions = {
      cwd,
      copilotBin: COPILOT_BIN,
      model: options.model,
      mode: options.mode,
      deniedTools: options.deniedTools,
      addDirs: options.addDirs || [],
      allowAllPaths: options.allowAllPaths,
      // Manual approval → drop --allow-all so the CLI asks via request_permission.
      allowAll: !options.manualApproval,
      autoApprovePermissions: !options.manualApproval,
      mcpServers: getAcpMcpServers(cwd),
    };
    // Always include global CWD as an additional path when using a different CWD
    if (cwd !== COPILOT_CWD && !clientOptions.addDirs.includes(COPILOT_CWD)) {
      clientOptions.addDirs.push(COPILOT_CWD);
    }
  }

  if (!client) {
    client = new AcpClient(tabId, sendToRenderer, clientOptions);
    client.__provider = provider;
    backends.set(tabId, client);
  } else {
    // Update options if they changed (e.g., model switch)
    client.updateOptions(clientOptions);
  }

  // Ensure process is running
  if (client.state === 'dead') {
    await client.start();
  }

  // Session management: load existing or create new
  let isNewlyCreatedSession = false;
  if (!client.sessionId) {
    const mcpNames = (clientOptions.mcpServers || []).map(s => s.name);
    console.log(`[acp:tab${tabId}] ${options.sessionId ? 'load' : 'new'} session with MCP servers: [${mcpNames.join(', ') || 'none'}]`);
    if (options.sessionId) {
      await client.loadSession(options.sessionId, cwd);
    } else {
      await client.newSession(cwd);
      isNewlyCreatedSession = true;
    }
  }

  // Claude Code has no native agents folder of its own here (unlike Copilot,
  // whose CLI reads ~/.copilot/agents itself) — inject a lazy agents index
  // once, invisibly, as part of the very first prompt of a brand-new session.
  // It then stays part of that session's own history for the rest of the chat.
  // Skills are NOT injected here: Claude Code discovers ~/.claude/skills on
  // its own (confirmed empirically — same SKILL.md format we use everywhere
  // else, see providerSkillsDir('claude-code') in data-dir.js), so an app-side
  // index would just load the same skills a second time. Project-level
  // `.github/skills` is still injected below, since that's our own convention,
  // not one Claude discovers by itself.
  let promptContext;
  if (provider === 'claude-code' && isNewlyCreatedSession) {
    const { buildSkillsIndex, buildAgentsIndex } = require('./src/providers/system-context');
    const agents = _scanAgentsIndex([
      providerAgentsDir('claude-code'),
      path.join(cwd, '.github', 'agents'),
    ], yaml.parse);
    const skills = _scanSkillsIndex([
      path.join(cwd, '.github', 'skills'),
    ], yaml.parse);
    promptContext = [buildAgentsIndex(agents), buildSkillsIndex(skills)].filter(Boolean).join('\n\n---\n\n') || undefined;
  }

  // Send prompt (async — events stream to renderer via AcpClient)
  client.prompt(prompt, promptContext).catch((err) => {
    // Cancellation is a normal user action, not an error.
    if (err.message === 'Cancelled') return;
    console.error(`[acp:tab${tabId}] prompt error:`, err.message);
  });

  return tabId;
}

/**
 * Resolves ALL instruction sets for a provider into {name, content} pairs
 * ready for `buildInstructionsBlock`. There is no active/inactive selection —
 * every `.instructions.md` file present in the provider's instructions
 * folder is always inlined (see src/instructions.js for the reasoning).
 * @param {string} provider
 * @returns {Array<{name: string, content: string}>}
 */
function resolveInstructions(provider) {
  if (!INSTRUCTIONS_PROVIDERS.includes(provider)) return [];
  return readAllInstructions(providerInstructionsDir(provider), yaml.parse);
}

/**
 * Sends a prompt to a direct-API backend (Anthropic/Gemini/OpenAI). Constructs
 * the backend on first use with the decrypted API key from the secure store.
 * @param {number} tabId
 * @param {string} prompt
 * @param {Object} options - includes provider, cwd, model, deniedTools, existing
 * @returns {Promise<number>}
 */
async function sendApiPrompt(tabId, prompt, options) {
  const { provider, cwd } = options;
  // Ollama runs locally and needs no API key.
  const KEYLESS_PROVIDERS = new Set(['ollama']);
  const apiKey = secureStore.getKey(provider);
  if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) {
    throw new Error(`Kein API-Key für ${provider} hinterlegt. Bitte in den Einstellungen unter „API-Provider" eintragen.`);
  }

  // Compose the system context (instructions + active agents + skills index)
  // from their .md files — for direct APIs there is no CLI to read them.
  // Gemini is intentionally kept context-light (no tool access trusted yet).
  // NOTE: the single global instructionsFile (copilot-instructions.md) is
  // deliberately NOT passed here — direct-API providers use only their own
  // provider-scoped ~/.agent-desktop/<provider>/instructions/ folder (via
  // `instructions` below), kept separate rather than additive so it's clear
  // which instructions apply to which provider (that global file remains
  // Copilot's own single native instructions file, untouched by this).
  let systemContext = '';
  try {
    const { composeSystemContext } = require('./src/providers/system-context');
    const CONTEXT_PROVIDERS = new Set(LAZY_CONTEXT_PROVIDERS.filter(p => p !== 'claude-code'));
    if (CONTEXT_PROVIDERS.has(provider)) systemContext = composeSystemContext({
      cwd,
      // Agents/Skills are provider-scoped (~/.agent-desktop/<provider>/…) plus
      // any project-level ones (cwd/.github/…) — exposed as lazy indexes, not
      // inlined. The model reloads a file itself via read_file only once it
      // judges the agent/skill relevant to the current task.
      agents: _scanAgentsIndex([
        providerAgentsDir(provider),
        path.join(cwd, '.github', 'agents'),
      ], yaml.parse),
      skills: _scanSkillsIndex([
        providerSkillsDir(provider),
        path.join(cwd, '.github', 'skills'),
      ], yaml.parse),
      // Instructions are eager, not lazy (see buildInstructionsBlock): every
      // file in the provider's instructions folder is always inlined in full.
      instructions: resolveInstructions(provider),
    });
  } catch (e) {
    console.warn('[api] composeSystemContext failed:', e?.message);
  }

  const backendOptions = {
    cwd,
    model: options.model,
    deniedTools: options.deniedTools || [],
    apiKey,
    baseURL: options.baseURL,
    systemContext,
    geminiMode: options.geminiMode,
  };

  let client = options.existing || backends.get(tabId);
  if (!client) {
    client = createApiBackend(provider, tabId, sendToRenderer, backendOptions);
    if (!client) throw new Error(`Provider „${provider}" wird noch nicht unterstützt.`);
    client.__provider = provider;
    backends.set(tabId, client);
  } else {
    client.updateOptions(backendOptions);
  }

  if (client.state === 'dead') await client.start();

  if (!client.sessionId) {
    if (options.sessionId) await client.loadSession(options.sessionId, cwd);
    else await client.newSession(cwd);
  }

  client.prompt(prompt).catch((err) => {
    if (err.message === 'Cancelled') return;
    console.error(`[api:tab${tabId}] prompt error:`, err.message);
  });

  return tabId;
}

// ── IPC Handlers ─────────────────────────────────────────────

/**
 * @ipc copilot:send — Sends a prompt to Copilot CLI via ACP protocol.
 * @param {Electron.IpcMainInvokeEvent} _event
 * @param {number} tabId - Tab identifier
 * @param {string} prompt - User prompt
 * @param {Object} [options] - Spawn options
 * @returns {Promise<number|{success: false, error: string}>} Tab ID or error
 */
// Copilot Chat
ipcMain.handle('copilot:send', async (_event, tabId, prompt, options) => {
  if (typeof tabId !== 'number' || typeof prompt !== 'string') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  try {
    await sendCopilotPrompt(tabId, prompt, options || {});
    return tabId;
  } catch (err) {
    console.error('[copilot:send] Error:', err.message);
    return { success: false, error: err.message };
  }
});

/** @ipc copilot:silentCommand — Runs a slash command silently and returns the text response. */
ipcMain.handle('copilot:silentCommand', async (_event, tabId, command) => {
  const client = backends.get(tabId);
  if (!client) return { success: false, error: `Kein aktiver Client für Tab ${tabId}` };
  try {
    const text = await client.silentCommand(command);
    return { success: true, text };
  } catch (err) {
    console.error(`[copilot:silentCommand] ${command}:`, err?.message || String(err));
    return { success: false, error: err?.message || String(err) };
  }
});

/**
 * @ipc copilot:setApproval — Switch a tab between manual approval and allow-all.
 * Copilot needs a transparent process restart (--allow-all is a spawn flag);
 * Claude Code applies live (backend reads autoApprovePermissions per request).
 */
ipcMain.handle('copilot:setApproval', async (_event, tabId, manualApproval) => {
  const client = backends.get(tabId);
  if (!client) return { success: false, error: 'Kein aktiver Client' };
  const opts = { allowAll: !manualApproval, autoApprovePermissions: !manualApproval };
  try {
    if (client.__provider === 'copilot' && client.state !== 'dead' && client.sessionId) {
      const sessionId = client.sessionId;
      await client.stop();
      client.updateOptions(opts);
      await client.start();
      await client.loadSession(sessionId);
    } else {
      client.updateOptions(opts);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
});

/** @ipc claudecode:status — Whether the Claude Code CLI is installed (via `claude --version`). */
ipcMain.handle('claudecode:status', async () => {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const proc = spawn('claude', ['--version'], { shell: true, windowsHide: true });
      let out = '';
      proc.stdout?.on('data', (d) => { out += d.toString(); });
      proc.on('error', () => finish({ installed: false }));
      proc.on('close', (code) => finish({ installed: code === 0, version: out.trim() }));
      setTimeout(() => { try { proc.kill(); } catch (_) { /* ignore */ } finish({ installed: false }); }, 6000);
    } catch (_) {
      finish({ installed: false });
    }
  });
});

/** @ipc copilot:respondPermission — Answers an agent permission request (ACP). */
ipcMain.handle('copilot:respondPermission', (_event, tabId, requestId, optionId) => {
  const client = backends.get(tabId);
  if (client && typeof client.respondPermission === 'function') {
    client.respondPermission(requestId, optionId);
  }
  return { success: true };
});

/** @ipc copilot:resetBackend — Destroys a tab's backend so the next prompt starts fresh
 *  (e.g. Claude Code changing folder → a new session in the new cwd). */
ipcMain.handle('copilot:resetBackend', async (_event, tabId) => {
  const client = backends.get(tabId);
  if (client) {
    try { await client.destroy(); } catch (_) { /* ignore */ }
    backends.delete(tabId);
  }
  return { success: true };
});

/** @ipc copilot:newTab — Allocates and returns the next tab ID. @returns {number} */
ipcMain.handle('copilot:newTab', () => {
  return nextTabId++;
});

// ── Provider API keys (secure store) ─────────────────────────
/** @ipc providers:status — Whether OS encryption is available + which providers have a stored key. */
ipcMain.handle('providers:status', () => {
  const keyed = {};
  for (const p of secureStore.KNOWN_PROVIDERS) keyed[p] = secureStore.hasKey(p);
  return { available: secureStore.isAvailable(), keyed };
});

/** @ipc providers:setKey — Stores an encrypted API key for a provider. Never returns the key. */
ipcMain.handle('providers:setKey', (_event, provider, key) => {
  if (!secureStore.KNOWN_PROVIDERS.includes(provider)) {
    return { success: false, error: 'Unbekannter Provider' };
  }
  try {
    secureStore.setKey(provider, key);
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
});

/** @ipc providers:deleteKey — Removes the stored API key for a provider. */
ipcMain.handle('providers:deleteKey', (_event, provider) => {
  secureStore.deleteKey(provider);
  return { success: true };
});

/**
 * @ipc providers:listModels — Discover a provider's currently-offered models from
 * its API. Best-effort: returns {ok:false} on missing key / network error instead
 * of throwing, so the renderer can silently fall back to the hardcoded list.
 */
ipcMain.handle('providers:listModels', async (_event, provider, baseURL) => {
  try {
    const modelDiscovery = require('./src/model-discovery');
    const KEYLESS_PROVIDERS = new Set(['ollama']);
    const apiKey = secureStore.getKey(provider);
    if (!apiKey && !KEYLESS_PROVIDERS.has(provider)) {
      return { ok: false, reason: 'no-key', models: [] };
    }
    const models = await modelDiscovery.listModels(provider, { apiKey, baseURL });
    return { ok: true, models };
  } catch (e) {
    return { ok: false, reason: 'error', error: e?.message || String(e), models: [] };
  }
});

/**
 * @ipc providers:loadSessionHistory — Persisted direct-API conversation
 * history for a session, plus any provider-specific extras (e.g. Gemini's
 * search/files mode) that need to be re-applied to the resuming tab.
 * @returns {Promise<{messages: Array, geminiMode?: string}>}
 */
ipcMain.handle('providers:loadSessionHistory', (_event, sessionId) => {
  try {
    const data = require('./src/providers/session-store').load(sessionId);
    return {
      messages: (data && Array.isArray(data.messages)) ? data.messages : [],
      geminiMode: data && data.geminiMode,
    };
  } catch (_) {
    return { messages: [] };
  }
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

// ── Preis-Fallback-Quelle (LiteLLM) ──────────────────────────
const pricingSource = require('./src/pricing-source');
/**
 * @ipc pricing:getMap — Public price fallback (USD/1M) for models without a
 * hardcoded price. Cached weekly under ~/.copilot-desktop/. Never throws.
 * @returns {Promise<Object<string,{input:number,cache:number,output:number}>>}
 */
ipcMain.handle('pricing:getMap', async () => {
  try {
    return await pricingSource.getPricingMap();
  } catch (e) {
    console.warn('[pricing:getMap]', e.message || e);
    return {};
  }
});

// ── Self-Update (git-basiert) ────────────────────────────────
const updater = require('./src/updater');
/** Repo root = directory containing this main.js. */
const REPO_DIR = __dirname;

/**
 * @ipc updates:check — Checks the remote for a newer release tag.
 * @returns {Promise<{ok:boolean, currentVersion:string, latestVersion:string|null, updateAvailable:boolean, reason?:string, error?:string}>}
 */
ipcMain.handle('updates:check', async () => {
  try {
    return await updater.checkForUpdate(REPO_DIR);
  } catch (e) {
    console.warn('[updates:check] Fehler:', e.message || e);
    return { ok: false, currentVersion: require('./package.json').version, latestVersion: null, updateAvailable: false, reason: 'exception', error: e.message || String(e) };
  }
});

/**
 * @ipc updates:apply — Pulls the latest `main`, runs npm install if deps
 * changed, then relaunches the app. Blocks on a dirty working tree.
 * @returns {Promise<{ok:boolean, reason?:string, depsInstalled?:boolean, newVersion?:string, error?:string}>}
 */
ipcMain.handle('updates:apply', async () => {
  try {
    const res = await updater.applyUpdate(REPO_DIR);
    if (res.ok) {
      // Give the renderer a tick to show its "restarting" state, then relaunch.
      setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
    }
    return res;
  } catch (e) {
    console.error('[updates:apply] Fehler:', e.message || e);
    return { ok: false, reason: 'exception', error: e.message || String(e) };
  }
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

/** @ipc copilot:restartWithDeniedTools — Restarts the ACP process with updated denied tools, then reloads the session. */
ipcMain.handle('copilot:restartWithDeniedTools', async (_event, tabId, deniedTools) => {
  const client = backends.get(tabId);
  if (!client) return { success: false, error: 'Kein aktiver Client' };
  // Direct-API backends read the deny list live per tool call — no restart needed.
  if (client.__provider && client.__provider !== 'copilot') {
    client.updateOptions({ deniedTools });
    return { success: true };
  }
  const sessionId = client.sessionId;
  if (!sessionId) return { success: false, error: 'Keine aktive Session' };
  try {
    await client.stop();
    client.updateOptions({ deniedTools });
    await client.start();
    await client.loadSession(sessionId);
    console.log(`[copilot:restartWithDeniedTools] tab ${tabId} restarted with ${deniedTools.length} denied tools`);
    return { success: true };
  } catch (err) {
    console.error('[copilot:restartWithDeniedTools]', err?.message || String(err));
    return { success: false, error: err?.message || String(err) };
  }
});

/** @ipc copilot:stop — Cancels the running Copilot ACP prompt for a tab (fire-and-forget). */
ipcMain.on('copilot:stop', (_event, tabId) => {
  const client = backends.get(tabId);
  if (client) {
    client.cancel().catch(err => {
      console.warn(`[copilot:stop] cancel error for tab ${tabId}:`, err.message);
    });
  }
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

/** @ipc sessions:readAllMessages — Full chronological message history of a session. @param {string} sessionId @returns {Promise<Array>} */
ipcMain.handle('sessions:readAllMessages', async (_event, sessionId) => {
  return readAllMessages(safeSessionPath(sessionId));
});

/**
 * @ipc sessions:readClaudeCodeTranscript — Full message history of a Claude
 * Code session, read from its own native transcript (not the app's session
 * store). @param {string} cwd @param {string} sessionId @returns {Promise<Array>}
 */
ipcMain.handle('sessions:readClaudeCodeTranscript', async (_event, cwd, sessionId) => {
  return readClaudeCodeTranscript(os.homedir(), cwd, sessionId);
});

/**
 * Backs up a session's todos.json (if present and non-empty) before deletion,
 * so a manually curated todo list is never lost permanently. Copies go to
 * ~/.copilot-desktop/deleted-todos/<sessionId>-<timestamp>.json.
 * @param {string} sessionPath - Absolute path to the session directory.
 * @param {string} sessionId
 */
function backupSessionTodos(sessionPath, sessionId) {
  try {
    const todosPath = path.join(sessionPath, 'todos.json');
    if (!fs.existsSync(todosPath)) return;
    const raw = fs.readFileSync(todosPath, 'utf-8').trim();
    if (!raw || raw === '[]') return; // nichts Sinnvolles zu sichern
    const backupDir = path.join(DATA_DIR, 'deleted-todos');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `${sessionId}-${stamp}.json`), raw, 'utf-8');
  } catch (e) {
    console.warn('[sessions:delete] Todo-Backup fehlgeschlagen:', e.message || e);
  }
}

/** @ipc sessions:delete — Moves a session directory to the OS trash (recoverable). @returns {Promise<boolean>} */
ipcMain.handle('sessions:delete', async (_event, sessionId) => {
  // Also drop any persisted direct-API history for this session.
  try { require('./src/providers/session-store').remove(sessionId); } catch (_) { /* ignore */ }
  try {
    const sessionPath = safeSessionPath(sessionId);
    if (!fs.existsSync(sessionPath)) return false;
    // Insurance: keep a copy of the curated todo list outside the session.
    backupSessionTodos(sessionPath, sessionId);
    // Prefer the OS trash so an accidental delete stays recoverable; fall back
    // to a hard delete only if trashing is unavailable.
    try {
      await shell.trashItem(sessionPath);
    } catch (trashErr) {
      console.warn('[sessions:delete] Papierkorb nicht verfügbar, lösche hart:', trashErr.message || trashErr);
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
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

/** @ipc todos:list @param {string} cwd @returns {Promise<Array<Object>>} All todos for the project (cwd) */
// Todos (per project / cwd) — stored as <cwd>/todo/todos.md so they survive
// session deletion and are shared across sessions in the same directory.
ipcMain.handle('todos:list', async (_event, cwd) => {
  return readTodos(cwd);
});

/**
 * @ipc todos:add — Adds a new todo to a project (cwd).
 * @param {string} cwd
 * @param {Object} todo - Must contain `text` string property
 * @returns {Promise<Array<Object>>} Updated todo list
 */
ipcMain.handle('todos:add', async (_event, cwd, todo) => {
  if (!cwd || !todo || typeof todo !== 'object' || typeof todo.text !== 'string') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  const todos = readTodos(cwd);
  todo.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  todo.status = todo.status || 'open';
  todos.push(todo);
  writeTodos(cwd, todos);
  return todos;
});

/**
 * @ipc todos:update — Merges updates into an existing todo.
 * @param {string} cwd
 * @param {string} todoId
 * @param {Object} updates - Fields to merge
 * @returns {Promise<Array<Object>>} Updated todo list
 */
ipcMain.handle('todos:update', async (_event, cwd, todoId, updates) => {
  if (typeof todoId !== 'string' || typeof updates !== 'object') {
    return { success: false, error: 'Ungültige Argumente' };
  }
  const todos = readTodos(cwd);
  const idx = todos.findIndex(t => t.id === todoId);
  if (idx === -1) return todos;
  Object.assign(todos[idx], updates);
  writeTodos(cwd, todos);
  return todos;
});

/** @ipc todos:delete — Removes a todo by ID. @returns {Promise<Array<Object>>} */
ipcMain.handle('todos:delete', async (_event, cwd, todoId) => {
  let todos = readTodos(cwd);
  todos = todos.filter(t => t.id !== todoId);
  writeTodos(cwd, todos);
  return todos;
});

/**
 * @ipc todos:reorder — Reorders todos according to the given ID sequence.
 * Todos not in the list are appended at the end (safety fallback).
 * @param {string} cwd
 * @param {string[]} orderedIds
 * @returns {Promise<Array<Object>>} Reordered todo list
 */
ipcMain.handle('todos:reorder', async (_event, cwd, orderedIds) => {
  const todos = readTodos(cwd);
  const byId = new Map(todos.map(t => [t.id, t]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  // Append any todos not in the ordered list (safety)
  for (const t of todos) {
    if (!orderedIds.includes(t.id)) reordered.push(t);
  }
  writeTodos(cwd, reordered);
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
 * @ipc skills:listProvider — Scans a provider's skills folder for a non-Copilot
 * provider (Claude Code, Anthropic, OpenAI, GLM, Ollama). Copilot keeps its
 * native ~/.copilot/skills and is not handled here. Claude Code is itself a
 * special case within providerSkillsDir(): it resolves to Claude's own native
 * ~/.claude/skills rather than an app-managed ~/.agent-desktop/... folder.
 * @param {string} provider
 * @returns {Promise<Array<Object>>} Skills with source 'provider'
 */
ipcMain.handle('skills:listProvider', async (_event, provider) => {
  // provider comes straight from the renderer over IPC — validate against the
  // known allow-list before it's used to build a filesystem path (providerSkillsDir
  // just path.joins it; an unchecked value could otherwise traverse outside DATA_DIR).
  if (!LAZY_CONTEXT_PROVIDERS.includes(provider)) return [];
  const dir = providerSkillsDir(provider);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best effort */ }
  return _scanSkillDirectory(dir, 'provider', userSkillIcon, yaml.parse);
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

/**
 * Reads the merged MCP server configuration from the CLI for a given CWD.
 * @param {string} [cwd] - Project directory (includes workspace .mcp.json/.github/mcp.json)
 * @returns {Object} The raw `mcpServers` map from `copilot mcp list --json`
 */
function readMcpConfig(cwd) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('copilot mcp list --json', {
      timeout: CLI_VERSION_TIMEOUT_MS,
      env: buildEnv(),
      cwd: cwd || COPILOT_CWD,
    }).toString();
    return JSON.parse(out).mcpServers || {};
  } catch (e) {
    console.warn('[mcp] readMcpConfig Fehler:', e.message || e);
    return {};
  }
}

/** Converts an object map {k: v} to the ACP [{name, value}] array format. */
function toAcpKeyValueArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * Builds the MCP server list in the format ACP `session/new` expects, so the
 * agent actually gets the user's/workspace's configured MCP tools.
 * @param {string} [cwd] - Project directory
 * @returns {Array<Object>} ACP-formatted MCP servers
 */
function getAcpMcpServers(cwd) {
  const servers = readMcpConfig(cwd);
  return Object.entries(servers).map(([name, cfg]) => {
    const type = cfg.type || (cfg.command ? 'stdio' : 'http');
    if (type === 'stdio') {
      return { name, type: 'stdio', command: cfg.command, args: cfg.args || [], env: toAcpKeyValueArray(cfg.env) };
    }
    return { name, type, url: cfg.url, headers: toAcpKeyValueArray(cfg.headers) };
  });
}

/**
 * @ipc mcp:list — Lists all configured MCP servers via `copilot mcp list --json`.
 * Returns the user/workspace/plugin servers the CLI knows about. Since the ACP
 * process does not report live connection status, servers are marked 'configured'.
 * @returns {Promise<Array<{name: string, type: string, status: string}>>}
 */
ipcMain.handle('mcp:list', async () => {
  const servers = readMcpConfig();
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    type: cfg.type || (cfg.command ? 'stdio' : 'sse'),
    source: cfg.source || 'user',
    status: 'configured',
  }));
});

/**
 * Probes a single HTTP/SSE MCP endpoint for reachability.
 * Any HTTP response (even an error status) counts as reachable; a connection
 * or DNS failure / timeout counts as offline.
 * @param {string} url
 * @returns {Promise<boolean>} true if the endpoint responded
 */
function probeHttpReachable(url) {
  return new Promise((resolve) => {
    let mod, parsed;
    try {
      parsed = new URL(url);
      mod = parsed.protocol === 'http:' ? require('http') : require('https');
    } catch {
      return resolve(false);
    }
    const req = mod.request(url, { method: 'GET', timeout: MCP_PROBE_TIMEOUT_MS }, (res) => {
      res.destroy();
      resolve(true); // responded → reachable
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * @ipc mcp:probe — Probes configured MCP servers for connectivity.
 * HTTP/SSE servers are checked for reachability; stdio servers stay 'configured'
 * (cannot be verified without spawning them). Returns per-server status.
 * @returns {Promise<Array<{name: string, type: string, status: string}>>}
 */
ipcMain.handle('mcp:probe', async () => {
  const servers = readMcpConfig();
  return Promise.all(Object.entries(servers).map(async ([name, cfg]) => {
    const type = cfg.type || (cfg.command ? 'stdio' : 'sse');
    let status = 'configured';
    if ((type === 'http' || type === 'sse') && cfg.url) {
      status = (await probeHttpReachable(cfg.url)) ? 'connected' : 'disconnected';
    }
    return { name, type, source: cfg.source || 'user', status };
  }));
});

/** @ipc agents:list — Scans .agent.md files. @returns {Promise<Array<Object>>} */
// Agents
ipcMain.handle('agents:list', async () => {
  return scanAgents();
});

/**
 * @ipc agents:listProvider — Scans ~/.agent-desktop/<provider>/agents/ for a
 * non-Copilot provider (Claude Code, Anthropic, OpenAI, GLM, Ollama).
 * Copilot keeps its native ~/.copilot/agents and is not handled here.
 * @param {string} provider
 * @returns {Promise<Array<Object>>} Agents with source 'provider'
 */
ipcMain.handle('agents:listProvider', async (_event, provider) => {
  // Same allow-list validation as skills:listProvider — see comment there.
  if (!LAZY_CONTEXT_PROVIDERS.includes(provider)) return [];
  const dir = providerAgentsDir(provider);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best effort */ }
  return scanAgentsDirectory(dir, yaml.parse).map(a => ({ ...a, source: 'provider' }));
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
 * @ipc skills:deleteProject — Deletes a project skill directory from <cwd>/.github/skills/<dirName>.
 * @param {string} cwd - Absolute project directory path
 * @param {string} dirName - Skill directory name (alphanumeric, dashes, underscores only)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
ipcMain.handle('skills:deleteProject', async (_event, cwd, dirName) => {
  if (!cwd || typeof cwd !== 'string') return { success: false, error: 'Ungültige CWD' };
  if (!dirName || typeof dirName !== 'string') return { success: false, error: 'Ungültige ID' };
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) return { success: false, error: 'Ungültige ID' };
  
  const skillDir = path.join(cwd, '.github', 'skills', dirName);
  const expectedParent = path.join(cwd, '.github', 'skills');
  
  console.log(`[deleteProject] Versuche zu löschen: ${skillDir}`);
  console.log(`[deleteProject] CWD: ${cwd}`);
  console.log(`[deleteProject] dirName: ${dirName}`);
  console.log(`[deleteProject] Existiert: ${fs.existsSync(skillDir)}`);
  
  // Security: Ensure skillDir is within expectedParent (prevent path traversal)
  const resolvedSkillDir = path.resolve(skillDir);
  const resolvedParent = path.resolve(expectedParent);
  console.log(`[deleteProject] Resolved: ${resolvedSkillDir}`);
  console.log(`[deleteProject] Parent: ${resolvedParent}`);
  
  if (!resolvedSkillDir.startsWith(resolvedParent)) {
    console.error(`[deleteProject] Path traversal check failed!`);
    return { success: false, error: 'Ungültiger Skill-Pfad' };
  }
  
  try {
    await fs.promises.rm(skillDir, { recursive: true, force: true });
    console.log(`[deleteProject] Erfolgreich gelöscht: ${skillDir}`);
    return { success: true };
  } catch (e) {
    console.error(`[deleteProject] Fehler beim Löschen: ${e.message}`);
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
 * @ipc skills:getHidden — Liest hiddenSkills aus ~/.copilot/settings.json
 * @returns {Promise<string[]>}
 */
ipcMain.handle('skills:getHidden', async () => {
  const settingsPath = path.join(os.homedir(), '.copilot', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const obj = JSON.parse(raw);
    return Array.isArray(obj.hiddenSkills) ? obj.hiddenSkills : [];
  } catch (_e) {
    return [];
  }
});

/**
 * @ipc skills:setHidden — Schreibt hiddenSkills in ~/.copilot/settings.json
 * @param {string[]} hiddenSkills
 * @returns {Promise<{success: boolean, error?: string}>}
 */
ipcMain.handle('skills:setHidden', async (_event, hiddenSkills) => {
  if (!Array.isArray(hiddenSkills)) return { success: false, error: 'Ungültige Eingabe' };
  const settingsPath = path.join(os.homedir(), '.copilot', 'settings.json');
  try {
    let obj = {};
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      obj = JSON.parse(raw);
    }
    obj.hiddenSkills = hiddenSkills;
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

/**
 * @ipc folders:openPath — Opens an arbitrary absolute path in the OS file
 * explorer, creating the directory first if it doesn't exist yet (so a
 * "browse" button next to an auto-created-but-still-empty provider folder,
 * e.g. a fresh ~/.agent-desktop/<provider>/skills, doesn't silently no-op).
 * Used by the per-provider settings tabs (Skills/Agents/Instructions folder
 * links) instead of one hardcoded IPC per fixed path.
 * @param {string} targetPath - Absolute path to open.
 */
ipcMain.handle('folders:openPath', (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return;
  try { fs.mkdirSync(targetPath, { recursive: true }); } catch (_) { /* best effort */ }
  shell.openPath(targetPath);
});

/**
 * @ipc folders:providerPaths — Absolute skills/agents/instructions folder
 * paths for a given provider, for read-only display + "open folder" buttons
 * in that provider's settings tab. Validated against the same allow-lists
 * as skills:listProvider/agents:listProvider/instructionSets — an unknown
 * provider gets {} for the fields it has no folder for (e.g. Gemini has
 * none of the three; Claude Code has no instructions folder).
 * @param {string} provider
 * @returns {Promise<{skillsDir?: string, agentsDir?: string, instructionsDir?: string}>}
 */
ipcMain.handle('folders:providerPaths', (_event, provider) => {
  const result = {};
  if (LAZY_CONTEXT_PROVIDERS.includes(provider)) {
    result.skillsDir = providerSkillsDir(provider);
    result.agentsDir = providerAgentsDir(provider);
  }
  if (INSTRUCTIONS_PROVIDERS.includes(provider)) {
    result.instructionsDir = providerInstructionsDir(provider);
  }
  return result;
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
 * @ipc copilot:status — Combined Copilot provider status for the settings UI:
 * whether the CLI is installed (+version) and whether a user is logged in.
 * @returns {Promise<{cliInstalled: boolean, version: string|null, authenticated: boolean, user: string|null}>}
 */
ipcMain.handle('copilot:status', async () => {
  let cliInstalled = false;
  let version = null;
  try {
    const { execSync } = require('child_process');
    version = execSync('copilot --version', { timeout: CLI_VERSION_TIMEOUT_MS, env: buildEnv() }).toString().trim();
    cliInstalled = true;
  } catch {
    /* CLI not installed / not on PATH */
  }
  const config = readCopilotConfig();
  const user = config.lastLoggedInUser;
  return {
    cliInstalled,
    version,
    authenticated: Boolean(user && user.login),
    user: (user && user.login) || null,
  };
});

/**
 * @ipc auth:login — Opens a VISIBLE terminal window running `copilot login`
 * so the user can complete the device-code flow.
 * @returns {Promise<{success: boolean, pendingInTerminal: boolean, error: string|null}>}
 */
ipcMain.handle('auth:login', async () => {
  console.log('[auth:login] Opening copilot login in a new terminal window');
  try {
    if (process.platform === 'win32') {
      // A bare detached spawn from a GUI app does NOT allocate a visible
      // console on Windows. Use cmd's `start` (via shell) to pop a real
      // window, and `-NoExit` so it stays open for the login flow + output.
      const cmd = 'start "Copilot Login" powershell -NoLogo -NoExit -Command "copilot login"';
      const child = require('child_process').spawn(cmd, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = require('child_process').spawn('open', ['-a', 'Terminal', COPILOT_BIN], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      // Linux: try a common terminal emulator.
      const child = require('child_process').spawn('x-terminal-emulator', ['-e', 'copilot', 'login'], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return { success: true, pendingInTerminal: true, error: null };
  } catch (err) {
    console.error('[auth:login]', err.message);
    return { success: false, pendingInTerminal: false, error: err.message };
  }
});

/**
 * @ipc app:relaunch — Restarts the app. Needed after `copilot login` because the
 * authentication state is picked up at main-process startup; a renderer reload
 * alone does not re-establish the Copilot session.
 */
ipcMain.handle('app:relaunch', async () => {
  console.log('[app:relaunch] Relaunching the app');
  app.relaunch();
  app.exit(0);
  return { success: true };
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
 * Scans and returns all skills from the builtin Copilot CLI package and the
 * user's ~/.copilot/skills/ directory — the latter also receives a fresh
 * mirror of any installed marketplace/plugin skills first (see
 * syncMarketplaceSkills), so they're included too.
 *
 * @returns {Array<Object>} Combined list of builtin and user (incl. mirrored plugin) skills
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

  // 2) User skills from ~/.copilot/skills/ — also the mirror target for
  // marketplace plugin skills (see below), so they show up as 'user' here.
  const userSkillsDir = folderConfig.skillsDir || path.join(os.homedir(), '.copilot', 'skills');

  // Mirror marketplace/plugin skills (~/.copilot/installed-plugins/…/skills/)
  // into userSkillsDir before scanning it. Necessary because `copilot --acp`
  // — the mode this app always runs Copilot in — never exposes plugin skills
  // to the model on its own, only builtin + user ones (confirmed empirically;
  // the CLI's own interactive/-p modes don't have this gap). Mirroring is
  // idempotent and only ever touches directories it created itself.
  try {
    syncMarketplaceSkills({ userSkillsDir });
  } catch (_) { /* best effort — never block the skill list on a mirror failure */ }

  skills.push(...scanSkillDirectory(userSkillsDir, 'user', userSkillIcon));

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

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  console.log(`[app] Agent Desktop v${require('./package.json').version} started (platform: ${process.platform}, arch: ${process.arch})`);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }
  ensureProviderContextDirs();
  createWindow();
  startImageWatcher();
});

app.on('window-all-closed', () => {
  backends.forEach(client => client.destroy().catch(() => {}));
  backends.clear();
  stopImageWatcher();
  closeLogger();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

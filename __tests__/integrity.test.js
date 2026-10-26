/**
 * Integritäts-Tests — Prüfen strukturelle Konsistenz der App.
 * Fangen Fehler wie fehlende Script-Tags, kaputte IPC-Ketten,
 * fehlende CSS-Variablen und ungültige Referenzen.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'renderer', 'index.html');
const CSS_PATH = path.join(ROOT, 'renderer', 'styles.css');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const PRELOAD_PATH = path.join(ROOT, 'preload.js');
const IPC_DIR = path.join(ROOT, 'src', 'ipc');

const html = fs.readFileSync(HTML_PATH, 'utf-8');
const css = fs.readFileSync(CSS_PATH, 'utf-8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf-8');
const preloadJs = fs.readFileSync(PRELOAD_PATH, 'utf-8');

// Read all IPC module files and combine with mainJs for handler scanning
let allBackendJs = mainJs;
if (fs.existsSync(IPC_DIR)) {
  const ipcFiles = fs.readdirSync(IPC_DIR).filter(f => f.endsWith('.js'));
  for (const f of ipcFiles) {
    allBackendJs += '\n' + fs.readFileSync(path.join(IPC_DIR, f), 'utf-8');
  }
}

describe('Copilot ACP MCP configuration', () => {
  const promptSource = mainJs.match(/^async function runAgentPrompt\b[\s\S]*?^\}/m)[0];

  test('MCP automatic connections start after creating the window without blocking app startup', () => {
    const startup = mainJs.match(/^app.whenReady\(\).then\(\(\) => \{[\s\S]*?^\}\);/m)[0];
    const createWindow = jest.fn();
    const connectEnabled = jest.fn().mockResolvedValue([]);
    vm.runInNewContext(startup, {
      app: { whenReady: () => ({ then: callback => callback() }), on: jest.fn() },
      process: { platform: 'win32', arch: 'x64' },
      require: name => name === './src/scheduled-tasks' ? { ScheduledTasks: class {} } : { version: 'test' }, console,
      path, DATA_DIR: 'fixture', setInterval: jest.fn(), clearInterval: jest.fn(), powerMonitor: { on: jest.fn() },
      ensureProviderContextDirs: jest.fn(), createWindow, startImageWatcher: jest.fn(), syncPlansConvention: jest.fn(),
      appMcp: { connectEnabled },
    });
    expect(connectEnabled).toHaveBeenCalledTimes(1);
    expect(createWindow.mock.invocationCallOrder[0]).toBeLessThan(connectEnabled.mock.invocationCallOrder[0]);
  });

  test.each([false, true])('app bridge revision change %s preserves the native session', async changed => {
    const bridgeConfig = 'C:\\data\\mcp-runtime-fixture.json';
    const backend = {
      state: 'ready', sessionId: 'native-session', __provider: 'copilot', __mcpRevision: changed ? 1 : 2,
      stop: jest.fn(async () => { backend.state = 'dead'; backend.sessionId = null; }),
      start: jest.fn(async () => { backend.state = 'ready'; }),
      updateOptions: jest.fn(), loadSession: jest.fn(async id => { backend.sessionId = id; }),
      newSession: jest.fn(), prompt: jest.fn().mockResolvedValue(),
    };
    const send = vm.runInNewContext(`(${promptSource})`, {
      scheduledTabs: new Map(),
      backends: new Map([['tab', backend]]),
      appMcp: { revision: 2, getCopilotMcpConfig: jest.fn().mockResolvedValue(bridgeConfig) },
      COPILOT_CWD: 'C:\\project', COPILOT_BIN: 'copilot', console,
    });

    await send('tab', 'hello', { provider: 'copilot', cwd: 'C:\\project' }, jest.fn());
    expect(backend.updateOptions).toHaveBeenCalledWith(expect.objectContaining({ mcpServers: [], additionalMcpConfig: bridgeConfig }));
    expect(backend.stop).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(backend.start).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(backend.loadSession).toHaveBeenCalledTimes(changed ? 1 : 0);
    if (changed) expect(backend.loadSession).toHaveBeenCalledWith('native-session', 'C:\\project');
    expect(backend.newSession).not.toHaveBeenCalled();
    expect(backend.__mcpRevision).toBe(2);
    expect(backend.prompt).toHaveBeenCalledWith('hello');
  });

  test.each([null, 'existing-session'])('does not resend native MCP config for session %s', async (sessionId) => {
    const backend = {
      state: 'dead',
      sessionId: null,
      start: jest.fn().mockResolvedValue(),
      newSession: jest.fn().mockResolvedValue(),
      loadSession: jest.fn().mockResolvedValue(),
      prompt: jest.fn().mockResolvedValue(),
    };
    const AcpClient = jest.fn(() => backend);
    const getAcpMcpServers = jest.fn().mockResolvedValue([{ name: 'native-server' }]);
    const backends = new Map();
    const sendAgentPrompt = vm.runInNewContext(`(${promptSource})`, {
      scheduledTabs: new Map(),
      AcpClient,
      getAcpMcpServers,
      backends,
      sendToRenderer: jest.fn(),
      COPILOT_CWD: 'C:\\workspace',
      COPILOT_BIN: 'copilot',
      appMcp: { revision: 0, getCopilotMcpConfig: jest.fn().mockResolvedValue(null) },
      console: { log: jest.fn() },
    });

    await sendAgentPrompt('tab-1', 'hello', {
      provider: 'copilot',
      cwd: 'C:\\project',
      sessionId,
    }, jest.fn());

    expect(AcpClient).toHaveBeenCalledWith('tab-1', expect.any(Function), expect.objectContaining({
      cwd: 'C:\\project',
      mcpServers: [],
      addDirs: ['C:\\workspace'],
    }));
    expect(getAcpMcpServers).not.toHaveBeenCalled();
    expect(backends.get('tab-1')).toBe(backend);
    expect(backend.start).toHaveBeenCalledTimes(1);
    if (sessionId) {
      expect(backend.loadSession).toHaveBeenCalledWith(sessionId, 'C:\\project');
      expect(backend.newSession).not.toHaveBeenCalled();
    } else {
      expect(backend.newSession).toHaveBeenCalledWith('C:\\project');
      expect(backend.loadSession).not.toHaveBeenCalled();
    }
    expect(backend.prompt).toHaveBeenCalledWith('hello');
  });
});

describe('Tabbezogene Tool-Konfiguration entfernt', () => {
  const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf-8');

  test('Toolbar und Scripts enthalten keine Session-Tool-Konfiguration', () => {
    expect(html).not.toMatch(/id="(?:btnSessionTools|sessionToolsPopup|sessionToolInput|btnAddSessionTool|sessionToolsList)"/);
    expect(html).not.toContain('modules/session-tools.js');
    expect(css).not.toMatch(/\.session-tools-popup|\.tools-popup-wrapper/);
  });

  test('kein tabbezogener Tool-Neustart, native Freigaben bleiben verfügbar', () => {
    expect(preloadJs).not.toContain('restartWithDeniedTools');
    expect(allBackendJs).not.toContain('agent:restartWithDeniedTools');
    expect(html).toContain('id="btnApprovalToggle"');
    expect(preloadJs).toContain("ipcRenderer.invoke('agent:respondPermission'");
  });

  test.each(['copilot', 'anthropic'])('sendet nur globale Sperren für %s, keine alten Tab-Sperren', (provider) => {
    const settings = {
      deniedToolsByProvider: {
        copilot: ['shell(git push)'],
        anthropic: ['shell(npm publish)'],
      },
    };
    const tab = {
      sessionId: 'existing-session',
      selectedModel: 'test-model',
      provider,
      manualApproval: true,
      sessionDeniedTools: [{ name: 'shell(legacy-command)', enabled: true }],
      activeSkills: new Set(),
      streamEl: { insertBefore: jest.fn() },
      statusEl: { style: {} },
    };
    const input = { value: 'hello', style: {} };
    const send = jest.fn().mockResolvedValue('tab-1');
    const sendSource = rendererJs.match(/^function sendMessage\b[\s\S]*?^\}/m)[0];
    const denySource = rendererJs.match(/^function getDeniedTools\b[\s\S]*?^\}/m)[0];
    const sendMessage = vm.runInNewContext(`(${sendSource})`, {
      document: {
        getElementById: () => input,
        createElement: () => ({ dataset: {} }),
      },
      desktop: { chat: { send } },
      tabs: new Map([['tab-1', tab]]),
      activeTabId: 'tab-1',
      activeAgents: new Set(),
      richTextMode: false,
      inputHistory: [],
      historyIndex: -1,
      historySavedInput: '',
      getTabProvider: currentTab => currentTab.provider,
      isCopilotModelAvailable: () => true,
      formatMessageTime: () => '12:00',
      setTabStatus: jest.fn(),
      startInactivityMonitor: jest.fn(),
      getSettings: () => settings,
      getDeniedTools: vm.runInNewContext(`(${denySource})`, { getSettings: () => settings }),
      getReasoningForModel: () => null,
      isClaudeCodeProvider: () => false,
      getEffectiveExtraDirs: () => [],
      getProviderBaseUrl: () => undefined,
      DEFAULT_MODEL_ID: 'test-model',
      DEFAULT_MODE_ID: 'agent',
      handleSendResult: jest.fn(),
      touchSession: jest.fn(),
      scrollToBottom: jest.fn(),
    });

    sendMessage();

    expect(send).toHaveBeenCalledWith('tab-1', 'hello', expect.objectContaining({
      deniedTools: settings.deniedToolsByProvider[provider],
      manualApproval: true,
      sessionId: 'existing-session',
      provider,
    }));
  });
});

// ── Script-Tag Integrität ────────────────────────────────────

describe('HTML Script-Tag Integrität', () => {
  const scriptRegex = /<script\s+src="([^"]+)"/g;
  const scripts = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1]);
  }

  test('mindestens 2 Script-Tags vorhanden', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(2);
  });

  test.each(scripts)('Script-Datei existiert: %s', (src) => {
    const resolved = path.resolve(path.join(ROOT, 'renderer'), src);
    expect(fs.existsSync(resolved)).toBe(true);
  });
});

// ── CSS Link-Tag Integrität ──────────────────────────────────

describe('HTML CSS-Link Integrität', () => {
  const linkRegex = /<link[^>]+href="([^"]+\.css)"/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1]);
  }

  test('mindestens 1 CSS-Link vorhanden', () => {
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  test.each(links)('CSS-Datei existiert: %s', (href) => {
    const resolved = path.resolve(path.join(ROOT, 'renderer'), href);
    expect(fs.existsSync(resolved)).toBe(true);
  });
});

// ── Renderer-JS Browser-Kompatibilität ───────────────────────

describe('Renderer-JS ist browser-kompatibel (kein require)', () => {
  // Der Renderer läuft mit nodeIntegration: false und ohne Bundler,
  // daher ist require() nicht verfügbar. Ein require(-Aufruf wirft zur
  // Laufzeit ReferenceError und bricht die gesamte Script-Ausführung ab.
  // Dieser Guard fängt genau diese Fehlerklasse statisch ab.
  const rendererDir = path.join(ROOT, 'renderer');
  const rendererJsFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) rendererJsFiles.push(p);
    }
  })(rendererDir);

  // Kommentare entfernen, damit erklärende Erwähnungen von require() nicht anschlagen
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  test('mindestens eine Renderer-JS-Datei gefunden', () => {
    expect(rendererJsFiles.length).toBeGreaterThan(0);
  });

  test.each(rendererJsFiles)('%s nutzt kein require()', (file) => {
    const code = stripComments(fs.readFileSync(file, 'utf-8'));
    expect(code).not.toMatch(/\brequire\s*\(/);
  });
});

// ── IPC-Konsistenz: preload → main ──────────────────────────

describe('IPC-Konsistenz (preload → main)', () => {
  // Extract all ipcRenderer.invoke('channel') calls from preload
  const invokeRegex = /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g;
  const invokeChannels = new Set();
  let match;
  while ((match = invokeRegex.exec(preloadJs)) !== null) {
    invokeChannels.add(match[1]);
  }

  // Extract all ipcMain.handle('channel') registrations from main + IPC modules
  const handleRegex = /ipcMain\.handle\(['"]([^'"]+)['"]/g;
  const handleChannels = new Set();
  while ((match = handleRegex.exec(allBackendJs)) !== null) {
    handleChannels.add(match[1]);
  }

  test('preload hat IPC-invoke-Channels', () => {
    expect(invokeChannels.size).toBeGreaterThan(0);
  });

  test('main hat IPC-handle-Channels', () => {
    expect(handleChannels.size).toBeGreaterThan(0);
  });

  test.each([...invokeChannels])('invoke("%s") hat passenden ipcMain.handle', (channel) => {
    expect(handleChannels.has(channel)).toBe(true);
  });
});

describe('IPC-Konsistenz (preload ipcRenderer.send → main ipcMain.on)', () => {
  // Extract ipcRenderer.send('channel') — fire-and-forget channels
  const sendRegex = /ipcRenderer\.send\(['"]([^'"]+)['"]/g;
  const sendChannels = new Set();
  let match;
  while ((match = sendRegex.exec(preloadJs)) !== null) {
    sendChannels.add(match[1]);
  }

  // Extract ipcMain.on('channel') from main + IPC modules
  const onRegex = /ipcMain\.on\(['"]([^'"]+)['"]/g;
  const onChannels = new Set();
  while ((match = onRegex.exec(allBackendJs)) !== null) {
    onChannels.add(match[1]);
  }

  if (sendChannels.size > 0) {
    test.each([...sendChannels])('send("%s") hat passenden ipcMain.on', (channel) => {
      expect(onChannels.has(channel)).toBe(true);
    });
  } else {
    test('keine send-only Channels (nur invoke)', () => {
      expect(true).toBe(true);
    });
  }
});

// ── HTML id-Referenzen ───────────────────────────────────────

describe('HTML-Element-IDs die im JS referenziert werden', () => {
  // Critical IDs that app.js relies on. Note: #sessionSearch is intentionally
  // absent here — it's created dynamically inside the Sessions section's ⋮
  // menu (see openSectionMenu in renderer/app.js), not present in static HTML.
  const criticalIds = [
    'chatInput',
    'sessionList',
    'sidebar',
    'resizeHandle',
    'btnSettings',
    'settingsOverlay',
    'btnSettingsClose',
  ];

  test.each(criticalIds)('Element id="%s" existiert im HTML', (id) => {
    const regex = new RegExp(`id=["']${id}["']`);
    expect(html).toMatch(regex);
  });
});

// ── CSS-Variablen Konsistenz ─────────────────────────────────

describe('CSS-Variablen Konsistenz', () => {
  // Extract var(--name) usages from CSS
  const varUsageRegex = /var\(--([a-zA-Z0-9-]+)/g;
  const usedVars = new Set();
  let match;
  while ((match = varUsageRegex.exec(css)) !== null) {
    usedVars.add(match[1]);
  }

  // Extract --name: definitions from :root and themes
  const varDefRegex = /--([a-zA-Z0-9-]+)\s*:/g;
  const definedVars = new Set();
  while ((match = varDefRegex.exec(css)) !== null) {
    definedVars.add(match[1]);
  }

  test('CSS-Variablen sind definiert', () => {
    expect(definedVars.size).toBeGreaterThan(0);
  });

  test('alle verwendeten CSS-Variablen sind definiert', () => {
    const undefinedVars = [...usedVars].filter(v => !definedVars.has(v));
    expect(undefinedVars).toEqual([]);
  });
});

// ── Theme-Vollständigkeit ────────────────────────────────────

describe('Theme-Vollständigkeit', () => {
  // Extract :root vars
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/);
  const rootVars = new Set();
  if (rootMatch) {
    const varDefRegex = /--([a-zA-Z0-9-]+)\s*:/g;
    let match;
    while ((match = varDefRegex.exec(rootMatch[1])) !== null) {
      rootVars.add(match[1]);
    }
  }

  // Extract dark theme vars
  const darkMatch = css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
  const darkVars = new Set();
  if (darkMatch) {
    const varDefRegex = /--([a-zA-Z0-9-]+)\s*:/g;
    let match;
    while ((match = varDefRegex.exec(darkMatch[1])) !== null) {
      darkVars.add(match[1]);
    }
  }

  test(':root definiert Theme-Variablen', () => {
    expect(rootVars.size).toBeGreaterThan(10);
  });

  // Layout-Konstanten brauchen kein Theme-Override
  const layoutVars = ['sidebar-width', 'titlebar-height', 'radius', 'radius-sm'];

  test('dark-Theme definiert alle Farb-Variablen aus :root', () => {
    const missingInDark = [...rootVars].filter(v => !darkVars.has(v) && !layoutVars.includes(v));
    expect(missingInDark).toEqual([]);
  });
});

// ── Dependencies: package.json vs. Verwendung ────────────────

describe('Package-Abhängigkeiten', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Libraries referenced in HTML script tags from node_modules
  const nodeModuleScripts = [];
  const nmRegex = /<script\s+src="\.\.\/node_modules\/([^/]+)/g;
  let match;
  while ((match = nmRegex.exec(html)) !== null) {
    nodeModuleScripts.push(match[1]);
  }

  test.each(nodeModuleScripts)('HTML-referenziertes Paket "%s" ist in package.json', (pkgName) => {
    expect(pkgName in allDeps).toBe(true);
  });

  // Libraries required in preload.js
  const requireRegex = /require\(['"]([^./][^'"]+)['"]\)/g;
  const requiredModules = new Set();
  while ((match = requireRegex.exec(preloadJs)) !== null) {
    // Get base package name (handle scoped and subpath imports)
    const mod = match[1].startsWith('@') 
      ? match[1].split('/').slice(0, 2).join('/')
      : match[1].split('/')[0];
    if (mod !== 'electron') requiredModules.add(mod);
  }

  if (requiredModules.size > 0) {
    test.each([...requiredModules])('preload require("%s") ist in package.json', (mod) => {
      expect(mod in allDeps).toBe(true);
    });
  }
});

// ── Preload-Datei existiert ──────────────────────────────────

describe('Projektstruktur', () => {
  const requiredFiles = [
    'main.js',
    'preload.js',
    'package.json',
    'renderer/index.html',
    'renderer/app.js',
    'renderer/styles.css',
  ];

  test.each(requiredFiles)('Datei existiert: %s', (file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });

  test('main.js referenziert preload.js', () => {
    expect(mainJs).toContain('preload.js');
  });
});

// ── Keyboard-Shortcuts: HTML/CSS-Integrität ─────────────────

describe('Keyboard-Shortcuts UI-Integrität', () => {
  const rendererShortcutsJs = fs.readFileSync(path.join(ROOT, 'renderer', 'modules', 'keyboard-shortcuts.js'), 'utf-8');

  // HTML-Elemente die der Shortcuts-Code anspricht
  // Note: btnShortcutsHelp was intentionally removed from the sidebar;
  // app.js uses optional chaining (?.) so it gracefully handles its absence.
  const shortcutIds = [
    'btnShortcutsClose',
    'shortcutsOverlay',
    'shortcutsHelpContent',
    'settShortcutsList',
    'btnResetShortcuts',
  ];

  test.each(shortcutIds)('HTML enthält Element id="%s"', (id) => {
    const regex = new RegExp(`id=["']${id}["']`);
    expect(html).toMatch(regex);
  });

  test('Settings-Overlay hat einen "shortcuts"-Tab', () => {
    expect(html).toMatch(/data-tab=["']shortcuts["']/);
    expect(html).toMatch(/data-panel=["']shortcuts["']/);
  });

  // CSS-Klassen die im JS via querySelector/innerHTML verwendet werden
  const shortcutCssClasses = [
    'overlay__dialog--shortcuts',
    'shortcuts-help',
    'shortcuts-group',
    'shortcuts-group__title',
    'shortcuts-table',
    'shortcuts-table__label',
    'shortcuts-table__binding',
    'shortcut-kbd',
    'shortcut-kbd--custom',
    'shortcut-row',
    'shortcut-row__label',
    'shortcut-row__right',
    'shortcut-record-btn',
    'shortcut-record-btn--active',
  ];

  test.each(shortcutCssClasses)('CSS definiert Klasse .%s', (cls) => {
    const regex = new RegExp(`\\.${cls.replace(/-/g, '\\-')}\\b`);
    expect(css).toMatch(regex);
  });

  test('modules/keyboard-shortcuts.js definiert Shortcuts-System', () => {
    expect(rendererShortcutsJs).toContain('initKeyboardShortcuts');
    expect(rendererShortcutsJs).toContain('renderShortcutsHelp');
    expect(rendererShortcutsJs).toContain('initShortcutsSettings');
  });

  test('modules/keyboard-shortcuts.js und src/shortcuts.js bleiben in Sync (SHORTCUT_DEFS-IDs)', () => {
    const { SHORTCUT_DEFS } = require('../src/shortcuts');
    for (const def of SHORTCUT_DEFS) {
      expect(rendererShortcutsJs).toMatch(new RegExp(`id:\\s*['"]${def.id}['"]`));
    }
  });
});

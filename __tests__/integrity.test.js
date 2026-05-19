/**
 * Integritäts-Tests — Prüfen strukturelle Konsistenz der App.
 * Fangen Fehler wie fehlende Script-Tags, kaputte IPC-Ketten,
 * fehlende CSS-Variablen und ungültige Referenzen.
 */

const fs = require('fs');
const path = require('path');

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
  // Critical IDs that app.js relies on
  const criticalIds = [
    'chatInput',
    'terminalPanel',
    'terminalBody',
    'sessionList',
    'sessionCount',
    'sessionSearch',
    'sidebar',
    'resizeHandle',
    'btnCollapseSidebar',
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
  const rendererAppJs = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf-8');

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

  test('renderer/app.js initialisiert Shortcuts-System', () => {
    expect(rendererAppJs).toContain('initKeyboardShortcuts');
    expect(rendererAppJs).toContain('renderShortcutsHelp');
    expect(rendererAppJs).toContain('initShortcutsSettings');
  });

  test('renderer/app.js und src/shortcuts.js bleiben in Sync (SHORTCUT_DEFS-IDs)', () => {
    const { SHORTCUT_DEFS } = require('../src/shortcuts');
    for (const def of SHORTCUT_DEFS) {
      expect(rendererAppJs).toMatch(new RegExp(`id:\\s*['"]${def.id}['"]`));
    }
  });
});

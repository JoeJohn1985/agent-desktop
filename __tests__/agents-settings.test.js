/**
 * Tests für Agents-Settings / Folder-Config Integration
 * 
 * Testet:
 * - folders:read IPC gibt agentsDir korrekt zurück
 * - scanAgents() verwendet agentsDir aus Config
 * - IPC-Handler existieren (agents:list, folders:read)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ══════════════════════════════════════════════════════════════
// readFolderConfig — agentsDir Feld
// ══════════════════════════════════════════════════════════════

jest.mock('fs');
jest.mock('fs/promises');

const fsp = require('fs/promises');
const { readFolderConfig } = require('../src/scanners');
const { scanAgentsDirectory } = require('../src/agents');

const CONFIG_PATH = path.join('C:', 'Users', 'test', '.copilot-desktop', 'folders.json');
const DEFAULT_AGENTS_DIR = path.join(os.homedir(), '.copilot', 'agents');

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.readdirSync.mockReset();
});

describe('readFolderConfig — agentsDir', () => {

  test('gibt agentsDir zurück wenn in Config gesetzt', () => {
    const customDir = 'D:\\my-agents';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ agentsDir: customDir }));

    const config = readFolderConfig(CONFIG_PATH);
    expect(config.agentsDir).toBe(customDir);
  });

  test('gibt leeres Objekt zurück wenn Config nicht existiert (kein agentsDir)', () => {
    fs.existsSync.mockReturnValue(false);

    const config = readFolderConfig(CONFIG_PATH);
    expect(config.agentsDir).toBeUndefined();
  });

  test('gibt leeres Objekt zurück wenn Config ungültiges JSON enthält', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not valid json{{{');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config = readFolderConfig(CONFIG_PATH);
    expect(config).toEqual({});
    expect(config.agentsDir).toBeUndefined();
    warnSpy.mockRestore();
  });

  test('Config ohne agentsDir-Feld gibt kein agentsDir zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ skillsDir: '/some/path' }));

    const config = readFolderConfig(CONFIG_PATH);
    expect(config.agentsDir).toBeUndefined();
    expect(config.skillsDir).toBe('/some/path');
  });
});

// ══════════════════════════════════════════════════════════════
// folders:read Logik — agentsDir mit Default-Fallback
// ══════════════════════════════════════════════════════════════

describe('folders:read agentsDir Logik (simuliert)', () => {
  // Simuliert die Logik aus main.js:
  // agentsDir: config.agentsDir || path.join(os.homedir(), '.copilot', 'agents')

  function simulateFoldersRead(config) {
    return {
      agentsDir: config.agentsDir || path.join(os.homedir(), '.copilot', 'agents'),
    };
  }

  test('gibt konfigurierten agentsDir zurück', () => {
    const result = simulateFoldersRead({ agentsDir: 'D:\\custom\\agents' });
    expect(result.agentsDir).toBe('D:\\custom\\agents');
  });

  test('gibt Default-Pfad zurück wenn agentsDir nicht in Config', () => {
    const result = simulateFoldersRead({});
    expect(result.agentsDir).toBe(DEFAULT_AGENTS_DIR);
  });

  test('gibt Default-Pfad zurück wenn agentsDir leer ist', () => {
    const result = simulateFoldersRead({ agentsDir: '' });
    expect(result.agentsDir).toBe(DEFAULT_AGENTS_DIR);
  });

  test('gibt Default-Pfad zurück wenn agentsDir null ist', () => {
    const result = simulateFoldersRead({ agentsDir: null });
    expect(result.agentsDir).toBe(DEFAULT_AGENTS_DIR);
  });

  test('Default-Pfad enthält .copilot/agents', () => {
    const result = simulateFoldersRead({});
    expect(result.agentsDir).toContain('.copilot');
    expect(result.agentsDir).toMatch(/agents$/);
  });

  test('Default-Pfad basiert auf homedir', () => {
    const result = simulateFoldersRead({});
    expect(result.agentsDir.startsWith(os.homedir())).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// scanAgents() — Config-Integration
// ══════════════════════════════════════════════════════════════

describe('scanAgents Config-Integration', () => {
  // scanAgentsDirectory ist asynchron (fs/promises) — siehe src/agents.js.
  const yamlParse = jest.fn();

  function mockAgentTree(tree) {
    fsp.readdir.mockImplementation(async (dir) => {
      const names = tree[dir];
      if (!Array.isArray(names)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return names;
    });
    fsp.readFile.mockImplementation(async (file) => {
      const content = tree[file];
      if (typeof content !== 'string') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return content;
    });
  }

  beforeEach(() => {
    yamlParse.mockReset();
    fsp.readdir.mockReset();
    fsp.readFile.mockReset();
  });

  test('scanAgentsDirectory wird mit konfiguriertem Pfad aufgerufen', async () => {
    const customDir = 'D:\\custom\\agents';
    mockAgentTree({
      [customDir]: ['test.agent.md'],
      [path.join(customDir, 'test.agent.md')]: '---\nname: Test\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'Test' });

    const result = await scanAgentsDirectory(customDir, yamlParse);
    expect(fsp.readdir).toHaveBeenCalledWith(customDir);
    expect(result).toHaveLength(1);
  });

  test('scanAgentsDirectory funktioniert mit Default-Pfad', async () => {
    mockAgentTree({
      [DEFAULT_AGENTS_DIR]: ['helper.agent.md'],
      [path.join(DEFAULT_AGENTS_DIR, 'helper.agent.md')]: '---\nname: Helper\ndescription: Hilft\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'Helper', description: 'Hilft' });

    const result = await scanAgentsDirectory(DEFAULT_AGENTS_DIR, yamlParse);
    expect(fsp.readdir).toHaveBeenCalledWith(DEFAULT_AGENTS_DIR);
    expect(result[0].name).toBe('Helper');
  });

  test('scanAgentsDirectory gibt [] zurück wenn konfigurierter Pfad nicht existiert', async () => {
    mockAgentTree({});
    await expect(scanAgentsDirectory('X:\\nonexistent\\agents', yamlParse)).resolves.toEqual([]);
  });

  test('Fallback-Logik: config.agentsDir || default', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    mockAgentTree({
      [DEFAULT_AGENTS_DIR]: ['found.agent.md'],
      [path.join(DEFAULT_AGENTS_DIR, 'found.agent.md')]: '---\nname: Found\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'Found' });

    const config = readFolderConfig(CONFIG_PATH);
    const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
    const result = await scanAgentsDirectory(agentsDir, yamlParse);

    expect(agentsDir).toBe(DEFAULT_AGENTS_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Found');
  });
});

// ══════════════════════════════════════════════════════════════
// IPC-Integrität — Handler existieren in main.js
// ══════════════════════════════════════════════════════════════

describe('IPC-Handler Integrität für Agents-Settings', () => {
  // Liest echte Datei — kein Mock nötig
  const mainJsPath = path.resolve(__dirname, '..', 'main.js');
  const mainJsContent = jest.requireActual('fs').readFileSync(mainJsPath, 'utf-8');

  test('folders:read IPC-Handler ist registriert', () => {
    expect(mainJsContent).toMatch(/ipcMain\.handle\(['"]folders:read['"]/);
  });

  test('context:listAgents IPC-Handler ist registriert', () => {
    // Löste agents:list/agents:listProvider/agents:listProject ab: Agents
    // hängen an Provider UND Projekt, daher ein einziger Handler mit beidem.
    expect(mainJsContent).toMatch(/ipcMain\.handle\(['"]context:listAgents['"]/);
  });

  test('folders:read Handler gibt agentsDir zurück', () => {
    expect(mainJsContent).toMatch(/agentsDir/);
    // Verify the specific pattern: agentsDir: config.agentsDir || ...
    expect(mainJsContent).toMatch(/agentsDir:\s*config\.agentsDir\s*\|\|/);
  });

  test('context:listAgents reicht den konfigurierten agentsDir durch', () => {
    // Die Pfadauflösung liegt jetzt in src/context-paths.js; main.js gibt nur
    // noch den konfigurierbaren Copilot-Ordner als Override hinein.
    const handler = mainJsContent.match(/ipcMain\.handle\('context:listAgents'[\s\S]*?^\}\);/m);
    expect(handler).not.toBeNull();
    expect(handler[0]).toContain('agentDirs(');
    expect(handler[0]).toMatch(/agentsDirOverride:\s*readFolderConfig\(\)\.agentsDir/);
  });

  test('context-paths.js kennt den Copilot-Default ~/.copilot/agents', () => {
    const contextPaths = jest.requireActual('fs')
      .readFileSync(path.resolve(__dirname, '..', 'src', 'context-paths.js'), 'utf-8');
    expect(contextPaths).toMatch(/path\.join\(os\.homedir\(\),\s*'\.copilot',\s*'agents'\)/);
  });

  test('folders:read liefert weiterhin den Default-Fallback', () => {
    expect(mainJsContent).toMatch(/path\.join\(os\.homedir\(\),\s*['"]\.copilot['"]\s*,\s*['"]agents['"]\)/);
  });
});

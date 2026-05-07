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
  // Simuliert scanAgents() Logik aus main.js:
  // const config = readFolderConfig();
  // const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
  // return scanAgentsDirectory(agentsDir, yaml.parse);

  const yamlParse = jest.fn();

  beforeEach(() => {
    yamlParse.mockReset();
  });

  test('scanAgentsDirectory wird mit konfiguriertem Pfad aufgerufen', () => {
    const customDir = 'D:\\custom\\agents';
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['test.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: Test\n---\n');
    yamlParse.mockReturnValue({ name: 'Test' });

    const result = scanAgentsDirectory(customDir, yamlParse);
    expect(fs.existsSync).toHaveBeenCalledWith(customDir);
    expect(result).toHaveLength(1);
  });

  test('scanAgentsDirectory funktioniert mit Default-Pfad', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['helper.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: Helper\ndescription: Hilft\n---\n');
    yamlParse.mockReturnValue({ name: 'Helper', description: 'Hilft' });

    const result = scanAgentsDirectory(DEFAULT_AGENTS_DIR, yamlParse);
    expect(fs.existsSync).toHaveBeenCalledWith(DEFAULT_AGENTS_DIR);
    expect(result[0].name).toBe('Helper');
  });

  test('scanAgentsDirectory gibt [] zurück wenn konfigurierter Pfad nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    const result = scanAgentsDirectory('X:\\nonexistent\\agents', yamlParse);
    expect(result).toEqual([]);
  });

  test('Fallback-Logik: config.agentsDir || default', () => {
    // Simuliere die vollständige scanAgents-Logik
    function scanAgentsSimulated(configJson) {
      fs.existsSync.mockImplementation((p) => p === CONFIG_PATH || p === DEFAULT_AGENTS_DIR);
      fs.readFileSync.mockImplementation((p) => {
        if (p === CONFIG_PATH) return JSON.stringify(configJson);
        return '---\nname: Found\n---\n';
      });
      fs.readdirSync.mockReturnValue(['found.agent.md']);
      yamlParse.mockReturnValue({ name: 'Found' });

      const config = readFolderConfig(CONFIG_PATH);
      const agentsDir = config.agentsDir || path.join(os.homedir(), '.copilot', 'agents');
      return scanAgentsDirectory(agentsDir, yamlParse);
    }

    // Ohne agentsDir in Config → Default wird genutzt
    const result = scanAgentsSimulated({});
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

  test('agents:list IPC-Handler ist registriert', () => {
    expect(mainJsContent).toMatch(/ipcMain\.handle\(['"]agents:list['"]/);
  });

  test('folders:read Handler gibt agentsDir zurück', () => {
    expect(mainJsContent).toMatch(/agentsDir/);
    // Verify the specific pattern: agentsDir: config.agentsDir || ...
    expect(mainJsContent).toMatch(/agentsDir:\s*config\.agentsDir\s*\|\|/);
  });

  test('scanAgents() liest config mit readFolderConfig()', () => {
    // Prüft dass scanAgents die Config-Funktion verwendet
    const scanAgentsBlock = mainJsContent.match(/function scanAgents\(\)[\s\S]*?^}/m);
    expect(scanAgentsBlock).not.toBeNull();
    expect(scanAgentsBlock[0]).toContain('readFolderConfig()');
  });

  test('scanAgents() verwendet config.agentsDir mit Fallback', () => {
    const scanAgentsBlock = mainJsContent.match(/function scanAgents\(\)[\s\S]*?^}/m);
    expect(scanAgentsBlock).not.toBeNull();
    expect(scanAgentsBlock[0]).toMatch(/config\.agentsDir\s*\|\|/);
  });

  test('Default-Fallback-Pfad enthält .copilot/agents', () => {
    // Prüft dass der Default-Pfad korrekt definiert ist
    expect(mainJsContent).toMatch(/path\.join\(os\.homedir\(\),\s*['"]\.copilot['"]\s*,\s*['"]agents['"]\)/);
  });
});

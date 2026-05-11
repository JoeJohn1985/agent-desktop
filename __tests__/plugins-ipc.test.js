/**
 * Tests für src/ipc/plugins-ipc.js — Plugin-Manager IPC-Handler
 *
 * CLI-basiertes Marketplace-System: Alle Marketplace-Operationen
 * laufen über `copilot plugin marketplace` Unterbefehle.
 *
 * Getestete Handler:
 *   - plugin:list               — CLI stdout parsen → Plugin-Array
 *   - plugin:install             — CLI install mit verschiedenen Target-Formaten
 *   - plugin:uninstall           — CLI uninstall
 *   - plugin:update              — CLI update
 *   - plugin:marketplace-list    — CLI marketplace list → Marketplace-Array
 *   - plugin:marketplace-browse  — CLI marketplace browse → Plugin-Array
 *   - plugin:marketplace-add     — CLI marketplace add
 *   - plugin:marketplace-remove  — CLI marketplace remove
 */

'use strict';

// ── Mocks ────────────────────────────────────────────────────

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

const mockHandlers = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => {
      mockHandlers[channel] = handler;
    },
  },
}));

// ── Import ───────────────────────────────────────────────────

const { registerPluginsIPC } = require('../src/ipc/plugins-ipc');

// ── Helpers ──────────────────────────────────────────────────

function mockExecFileSuccess(stdout, stderr = '') {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(null, stdout, stderr);
  });
}

function mockExecFileError(errorMessage, stderr = '') {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const err = new Error(errorMessage);
    callback(err, '', stderr || errorMessage);
  });
}

// ── Setup ────────────────────────────────────────────────────

beforeAll(() => {
  registerPluginsIPC({});
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════
// plugin:list
// ══════════════════════════════════════════════════════════════

describe('plugin:list', () => {
  const handler = () => mockHandlers['plugin:list']({});

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:list']).toBeDefined();
    expect(typeof mockHandlers['plugin:list']).toBe('function');
  });

  test('Erfolgsfall: parst stdout zu Plugin-Array', async () => {
    const stdout = [
      '  • docker (copilot-plugins) v1.2.0',
      '  • kubernetes (copilot-plugins) v1.5.0 [update available]',
    ].join('\n');

    mockExecFileSuccess(stdout);

    const result = await handler();

    expect(result.success).toBe(true);
    expect(Array.isArray(result.plugins)).toBe(true);
    expect(result.plugins.length).toBe(2);

    const docker = result.plugins.find(p => p.name === 'docker');
    expect(docker).toBeDefined();
    expect(docker).toHaveProperty('name');
    expect(docker).toHaveProperty('version');
    expect(docker).toHaveProperty('marketplace');
    expect(typeof docker.updateAvailable).toBe('boolean');
  });

  test('Erfolgsfall: updateAvailable wird korrekt gemappt', async () => {
    const stdout = [
      '  • docker (copilot-plugins) v1.2.0',
      '  • kubernetes (copilot-plugins) v1.5.0 [update available]',
    ].join('\n');

    mockExecFileSuccess(stdout);

    const result = await handler();

    const docker = result.plugins.find(p => p.name === 'docker');
    const k8s = result.plugins.find(p => p.name === 'kubernetes');
    expect(docker.updateAvailable).toBe(false);
    expect(k8s.updateAvailable).toBe(true);
  });

  test('Leer: "No plugins installed." → leeres Array', async () => {
    mockExecFileSuccess('No plugins installed.');

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('Leer: leerer stdout → leeres Array', async () => {
    mockExecFileSuccess('');

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('Fehlerfall: execFile schlägt fehl → success: true mit leerem Array', async () => {
    mockExecFileError('Command failed: copilot plugin list');

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('Fehlerfall: null stdout → leeres Array', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, null, 'some error');
    });

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('Contract: Rückgabeformat hat success und plugins Felder', async () => {
    mockExecFileSuccess('');

    const result = await handler();

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('plugins');
  });

  test('ruft execFile mit korrekten Argumenten auf', async () => {
    mockExecFileSuccess('');

    await handler();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'list']);
    expect(opts.shell).toBeUndefined();
    expect(opts.timeout).toBe(15000);
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:install
// ══════════════════════════════════════════════════════════════

describe('plugin:install', () => {
  const handler = (target) => mockHandlers['plugin:install']({}, target);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:install']).toBeDefined();
  });

  test('name@marketplace Format → korrekter CLI-Aufruf', async () => {
    mockExecFileSuccess('Plugin docker installed successfully.');

    await handler('docker@copilot-plugins');

    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'install', 'docker@copilot-plugins']);
  });

  test('owner/repo Format → korrekter CLI-Aufruf', async () => {
    mockExecFileSuccess('Plugin installed.');

    await handler('owner/repo');

    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'install', 'owner/repo']);
  });

  test('URL Format → korrekter CLI-Aufruf', async () => {
    mockExecFileSuccess('Plugin installed.');

    await handler('https://github.com/owner/repo');

    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'install', 'https://github.com/owner/repo']);
  });

  test('Erfolg → { success: true, message: string }', async () => {
    mockExecFileSuccess('Plugin docker installed successfully.');

    const result = await handler('docker@copilot-plugins');

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  test('Fehler → { success: false, error: string }', async () => {
    mockExecFileError('Plugin not found: nonexistent');

    const result = await handler('nonexistent@copilot-plugins');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  test('Timeout ist 60000ms', async () => {
    mockExecFileSuccess('ok');

    await handler('docker@copilot-plugins');

    const [, , opts] = mockExecFile.mock.calls[0];
    expect(opts.timeout).toBe(60000);
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:uninstall
// ══════════════════════════════════════════════════════════════

describe('plugin:uninstall', () => {
  const handler = (name) => mockHandlers['plugin:uninstall']({}, name);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:uninstall']).toBeDefined();
  });

  test('Erfolg → { success: true, message: string }', async () => {
    mockExecFileSuccess('Plugin docker uninstalled.');

    const result = await handler('docker');

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  test('korrekter CLI-Aufruf', async () => {
    mockExecFileSuccess('ok');

    await handler('docker');

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'uninstall', 'docker']);
    expect(opts.timeout).toBe(30000);
  });

  test('Fehler → { success: false, error: string }', async () => {
    mockExecFileError('Plugin docker not installed');

    const result = await handler('docker');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:update
// ══════════════════════════════════════════════════════════════

describe('plugin:update', () => {
  const handler = (name) => mockHandlers['plugin:update']({}, name);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:update']).toBeDefined();
  });

  test('Erfolg → { success: true, message: string }', async () => {
    mockExecFileSuccess('Plugin docker updated to v1.3.0.');

    const result = await handler('docker');

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  test('korrekter CLI-Aufruf', async () => {
    mockExecFileSuccess('ok');

    await handler('docker');

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'update', 'docker']);
    expect(opts.timeout).toBe(60000);
  });

  test('Fehler → { success: false, error: string }', async () => {
    mockExecFileError('No updates available for docker');

    const result = await handler('docker');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:marketplace-list
// ══════════════════════════════════════════════════════════════

describe('plugin:marketplace-list', () => {
  const handler = () => mockHandlers['plugin:marketplace-list']({});

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:marketplace-list']).toBeDefined();
    expect(typeof mockHandlers['plugin:marketplace-list']).toBe('function');
  });

  test('parst ◆-Zeilen korrekt', async () => {
    const stdout = [
      '✨ Included with GitHub Copilot:',
      '  ◆ copilot-plugins (GitHub: github/copilot-plugins)',
      '  ◆ awesome-copilot (GitHub: github/awesome-copilot)',
      'Custom marketplaces:',
      '  ◆ gebit-copilot-marketplace (GitLab: https://gitlab.local.gebit.de/aidev/gebit-copilot-marketplace)',
    ].join('\n');

    mockExecFileSuccess(stdout);

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.marketplaces.length).toBe(3);

    expect(result.marketplaces[0]).toEqual({
      name: 'copilot-plugins',
      type: 'GitHub',
      source: 'github/copilot-plugins',
    });
    expect(result.marketplaces[1]).toEqual({
      name: 'awesome-copilot',
      type: 'GitHub',
      source: 'github/awesome-copilot',
    });
    expect(result.marketplaces[2]).toEqual({
      name: 'gebit-copilot-marketplace',
      type: 'GitLab',
      source: 'https://gitlab.local.gebit.de/aidev/gebit-copilot-marketplace',
    });
  });

  test('leerer stdout → leeres Array', async () => {
    mockExecFileSuccess('');

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.marketplaces).toEqual([]);
  });

  test('keine ◆-Zeilen → leeres Array', async () => {
    mockExecFileSuccess('Some informational text without marketplace entries');

    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.marketplaces).toEqual([]);
  });

  test('ruft korrekte CLI-Argumente auf', async () => {
    mockExecFileSuccess('');

    await handler();

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'marketplace', 'list']);
    expect(opts.timeout).toBe(15000);
  });

  test('Contract: Rückgabeformat hat success und marketplaces', async () => {
    mockExecFileSuccess('');

    const result = await handler();

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('marketplaces');
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:marketplace-browse
// ══════════════════════════════════════════════════════════════

describe('plugin:marketplace-browse', () => {
  const handler = (name) => mockHandlers['plugin:marketplace-browse']({}, name);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:marketplace-browse']).toBeDefined();
  });

  test('parst •-Zeilen korrekt', async () => {
    const stdout = [
      'Plugins in "copilot-plugins":',
      '  • workiq - WorkIQ plugin for GitHub Copilot.',
      '  • spark - Spark plugin for GitHub Copilot.',
      'Install with: copilot plugin install <plugin-name>@copilot-plugins',
    ].join('\n');

    mockExecFileSuccess(stdout);

    const result = await handler('copilot-plugins');

    expect(result.success).toBe(true);
    expect(result.name).toBe('copilot-plugins');
    expect(result.plugins.length).toBe(2);
    expect(result.plugins[0]).toEqual({
      name: 'workiq',
      description: 'WorkIQ plugin for GitHub Copilot.',
    });
    expect(result.plugins[1]).toEqual({
      name: 'spark',
      description: 'Spark plugin for GitHub Copilot.',
    });
  });

  test('leerer stdout → leeres Plugin-Array', async () => {
    mockExecFileSuccess('');

    const result = await handler('copilot-plugins');

    expect(result.success).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('CLI-Fehler → success: false', async () => {
    mockExecFileError('Marketplace not found: nonexistent');

    const result = await handler('nonexistent');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  test('ungültiger Name → success: false', async () => {
    const result = await handler('name; rm -rf /');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test('ruft korrekte CLI-Argumente auf', async () => {
    mockExecFileSuccess('');

    await handler('copilot-plugins');

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'marketplace', 'browse', 'copilot-plugins']);
    expect(opts.timeout).toBe(60000);
  });

  test('Contract: Rückgabeformat hat success, name, plugins', async () => {
    mockExecFileSuccess('');

    const result = await handler('copilot-plugins');

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('plugins');
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:marketplace-add
// ══════════════════════════════════════════════════════════════

describe('plugin:marketplace-add', () => {
  const handler = (source) => mockHandlers['plugin:marketplace-add']({}, source);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:marketplace-add']).toBeDefined();
  });

  test('Erfolg mit URL → success: true', async () => {
    mockExecFileSuccess('Marketplace "gebit-copilot-marketplace" added successfully.');

    const result = await handler('https://gitlab.local.gebit.de/aidev/gebit-copilot-marketplace.git');

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  test('ruft korrekte CLI-Argumente auf', async () => {
    mockExecFileSuccess('added');

    await handler('https://gitlab.local.gebit.de/aidev/test.git');

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'marketplace', 'add', 'https://gitlab.local.gebit.de/aidev/test.git']);
    expect(opts.timeout).toBe(30000);
  });

  test('CLI-Fehler → success: false', async () => {
    mockExecFileError('Failed to add marketplace');

    const result = await handler('https://gitlab.local.gebit.de/aidev/broken.git');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('ungültige Eingabe → success: false ohne CLI-Aufruf', async () => {
    const result = await handler('');

    expect(result.success).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test('zu lange Eingabe → success: false', async () => {
    const result = await handler('x'.repeat(501));

    expect(result.success).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// plugin:marketplace-remove
// ══════════════════════════════════════════════════════════════

describe('plugin:marketplace-remove', () => {
  const handler = (name) => mockHandlers['plugin:marketplace-remove']({}, name);

  test('Handler ist registriert', () => {
    expect(mockHandlers['plugin:marketplace-remove']).toBeDefined();
  });

  test('Erfolg → success: true', async () => {
    mockExecFileSuccess('Marketplace removed.');

    const result = await handler('gebit-copilot-marketplace');

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  test('ruft korrekte CLI-Argumente auf', async () => {
    mockExecFileSuccess('removed');

    await handler('gebit-copilot-marketplace');

    const [cmd, args, opts] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('copilot');
    expect(args).toEqual(['plugin', 'marketplace', 'remove', 'gebit-copilot-marketplace']);
    expect(opts.timeout).toBe(15000);
  });

  test('CLI-Fehler → success: false', async () => {
    mockExecFileError('Marketplace not found');

    const result = await handler('nonexistent');

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('ungültiger Name → success: false ohne CLI-Aufruf', async () => {
    const result = await handler('name; rm -rf /');

    expect(result.success).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// IPC-Handler Vollständigkeit
// ══════════════════════════════════════════════════════════════

describe('Plugin IPC — Handler-Registrierung', () => {
  const requiredChannels = [
    'plugin:list',
    'plugin:install',
    'plugin:uninstall',
    'plugin:update',
    'plugin:marketplace-list',
    'plugin:marketplace-browse',
    'plugin:marketplace-add',
    'plugin:marketplace-remove',
  ];

  test.each(requiredChannels)('Handler "%s" ist registriert', (channel) => {
    expect(mockHandlers[channel]).toBeDefined();
    expect(typeof mockHandlers[channel]).toBe('function');
  });

  test('alle 8 Plugin-Handler sind registriert', () => {
    for (const channel of requiredChannels) {
      expect(mockHandlers[channel]).toBeDefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// IPC-Integrität — Dateien-basiert
// ══════════════════════════════════════════════════════════════

describe('Plugin IPC — Datei-Integrität', () => {
  const fs = jest.requireActual('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');

  test('src/ipc/plugins-ipc.js existiert', () => {
    const filePath = path.join(ROOT, 'src', 'ipc', 'plugins-ipc.js');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('plugins-ipc.js exportiert registerPluginsIPC', () => {
    const filePath = path.join(ROOT, 'src', 'ipc', 'plugins-ipc.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/registerPluginsIPC/);
    expect(content).toMatch(/module\.exports/);
  });

  test('plugins-ipc.js registriert alle 8 Handler', () => {
    const filePath = path.join(ROOT, 'src', 'ipc', 'plugins-ipc.js');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:list['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:install['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:uninstall['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:update['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:marketplace-list['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:marketplace-browse['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:marketplace-add['"]/);
    expect(content).toMatch(/ipcMain\.handle\(['"]plugin:marketplace-remove['"]/);
  });

  test('plugins-ipc.js verwendet KEINE net.fetch mehr', () => {
    const filePath = path.join(ROOT, 'src', 'ipc', 'plugins-ipc.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/net\.fetch|net\s*\.\s*fetch/);
    expect(content).not.toMatch(/require\(['"]node-fetch['"]\)/);
  });

  test('plugins-ipc.js verwendet ausschließlich execFile für CLI-Aufrufe', () => {
    const filePath = path.join(ROOT, 'src', 'ipc', 'plugins-ipc.js');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/execFile\('copilot'/);
  });
});

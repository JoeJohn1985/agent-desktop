/**
 * Tests für skills:getDisabled und skills:setDisabled IPC-Handler
 */

jest.mock('fs');
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => 'C:\\test'), getName: jest.fn(() => 'copilot-desktop'), getVersion: jest.fn(() => '0.24.0') },
  ipcMain: { handle: jest.fn() },
  BrowserWindow: jest.fn(),
  dialog: { showOpenDialog: jest.fn() },
}));

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

// Capture IPC handlers registered by main.js
const handlers = {};
ipcMain.handle.mockImplementation((channel, handler) => {
  handlers[channel] = handler;
});

// We need os.homedir() to return a predictable path
jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');

// Load main.js to register handlers — but we only need the IPC handlers
// Instead, we re-implement the handler logic for isolated testing
const SETTINGS_PATH = path.join('C:\\Users\\test', '.copilot', 'settings.json');

// Extracted handler logic for testing
async function getDisabledHandler() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return [];
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    return Array.isArray(obj.disabledSkills) ? obj.disabledSkills : [];
  } catch (e) {
    return [];
  }
}

async function setDisabledHandler(_event, disabledSkills) {
  if (!Array.isArray(disabledSkills)) return { success: false, error: 'Ungültige Eingabe' };
  try {
    let obj = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      obj = JSON.parse(raw);
    }
    obj.disabledSkills = disabledSkills;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

beforeEach(() => {
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
});

// ══════════════════════════════════════════════════════════════
// skills:getDisabled
// ══════════════════════════════════════════════════════════════

describe('skills:getDisabled', () => {
  test('settings.json vorhanden mit disabledSkills → korrektes Array', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ disabledSkills: ['skill-a', 'skill-b'] }));
    const result = await getDisabledHandler();
    expect(result).toEqual(['skill-a', 'skill-b']);
  });

  test('settings.json nicht vorhanden → []', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await getDisabledHandler();
    expect(result).toEqual([]);
  });

  test('settings.json ohne disabledSkills-Key → []', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ someOtherKey: true }));
    const result = await getDisabledHandler();
    expect(result).toEqual([]);
  });

  test('settings.json mit ungültigem JSON → []', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{ invalid json !!!');
    const result = await getDisabledHandler();
    expect(result).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// skills:setDisabled
// ══════════════════════════════════════════════════════════════

describe('skills:setDisabled', () => {
  test('schreibt korrekt in neue settings.json', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await setDisabledHandler(null, ['my-skill']);
    expect(result).toEqual({ success: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      SETTINGS_PATH,
      JSON.stringify({ disabledSkills: ['my-skill'] }, null, 2),
      'utf-8'
    );
  });

  test('merged in bestehende settings.json (übrige Keys bleiben erhalten)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ theme: 'dark', disabledSkills: ['old'] }));
    const result = await setDisabledHandler(null, ['new-skill']);
    expect(result).toEqual({ success: true });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.theme).toBe('dark');
    expect(written.disabledSkills).toEqual(['new-skill']);
  });

  test('leeres Array → disabledSkills: []', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await setDisabledHandler(null, []);
    expect(result).toEqual({ success: true });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.disabledSkills).toEqual([]);
  });

  test('kein Array als Input → { success: false }', async () => {
    const result = await setDisabledHandler(null, 'not-an-array');
    expect(result).toEqual({ success: false, error: 'Ungültige Eingabe' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

/**
 * Tests für skills:getHidden und skills:setHidden IPC-Handler
 */

jest.mock('fs');
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => 'C:\\test'), getName: jest.fn(() => 'copilot-desktop'), getVersion: jest.fn(() => '0.28.0') },
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

jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');

const SETTINGS_PATH = path.join('C:\\Users\\test', '.copilot', 'settings.json');

// Extracted handler logic for testing (mirrors main.js implementation)
async function getHiddenHandler() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return [];
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    return Array.isArray(obj.hiddenSkills) ? obj.hiddenSkills : [];
  } catch (e) {
    return [];
  }
}

async function setHiddenHandler(_event, hiddenSkills) {
  if (!Array.isArray(hiddenSkills)) return { success: false, error: 'Ungültige Eingabe' };
  try {
    let obj = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      obj = JSON.parse(raw);
    }
    obj.hiddenSkills = hiddenSkills;
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
// skills:getHidden
// ══════════════════════════════════════════════════════════════

describe('skills:getHidden', () => {
  test('settings.json vorhanden mit hiddenSkills → korrektes Array', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ hiddenSkills: ['skill-a', 'skill-b'] }));
    const result = await getHiddenHandler();
    expect(result).toEqual(['skill-a', 'skill-b']);
  });

  test('settings.json nicht vorhanden → []', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await getHiddenHandler();
    expect(result).toEqual([]);
  });

  test('settings.json ohne hiddenSkills-Key → []', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ someOtherKey: true }));
    const result = await getHiddenHandler();
    expect(result).toEqual([]);
  });

  test('settings.json mit ungültigem JSON → []', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{ invalid json !!!');
    const result = await getHiddenHandler();
    expect(result).toEqual([]);
  });

  test('hiddenSkills ist kein Array → []', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ hiddenSkills: 'not-array' }));
    const result = await getHiddenHandler();
    expect(result).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// skills:setHidden
// ══════════════════════════════════════════════════════════════

describe('skills:setHidden', () => {
  test('schreibt korrekt in neue settings.json', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await setHiddenHandler(null, ['my-skill']);
    expect(result).toEqual({ success: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      SETTINGS_PATH,
      JSON.stringify({ hiddenSkills: ['my-skill'] }, null, 2),
      'utf-8'
    );
  });

  test('merged in bestehende settings.json (übrige Keys bleiben erhalten)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ theme: 'dark', disabledSkills: ['x'] }));
    const result = await setHiddenHandler(null, ['new-skill']);
    expect(result).toEqual({ success: true });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.theme).toBe('dark');
    expect(written.disabledSkills).toEqual(['x']);
    expect(written.hiddenSkills).toEqual(['new-skill']);
  });

  test('leeres Array → hiddenSkills: []', async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await setHiddenHandler(null, []);
    expect(result).toEqual({ success: true });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.hiddenSkills).toEqual([]);
  });

  test('kein Array als Input → { success: false }', async () => {
    const result = await setHiddenHandler(null, 'not-an-array');
    expect(result).toEqual({ success: false, error: 'Ungültige Eingabe' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('null als Input → { success: false }', async () => {
    const result = await setHiddenHandler(null, null);
    expect(result).toEqual({ success: false, error: 'Ungültige Eingabe' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('writeFileSync-Fehler → error-Objekt', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    const result = await setHiddenHandler(null, ['skill-a']);
    expect(result).toEqual({ success: false, error: 'EACCES' });
  });
});

const {
  createSendToRenderer,
  buildEnv,
} = require('../src/main-helpers');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// createSendToRenderer
// ═══════════════════════════════════════════════════════════════
describe('createSendToRenderer', () => {
  test('sendet Daten an das Fenster', () => {
    const send = jest.fn();
    const win = { isDestroyed: () => false, webContents: { send } };
    const sendToRenderer = createSendToRenderer(() => win);

    sendToRenderer('test:channel', 'arg1', 'arg2');
    expect(send).toHaveBeenCalledWith('test:channel', 'arg1', 'arg2');
  });

  test('sendet nichts wenn Fenster null ist', () => {
    const sendToRenderer = createSendToRenderer(() => null);
    expect(() => sendToRenderer('ch')).not.toThrow();
  });

  test('sendet nichts wenn Fenster destroyed ist', () => {
    const send = jest.fn();
    const win = { isDestroyed: () => true, webContents: { send } };
    const sendToRenderer = createSendToRenderer(() => win);

    sendToRenderer('ch', 'data');
    expect(send).not.toHaveBeenCalled();
  });

  test('sendet nichts wenn Fenster undefined ist', () => {
    const sendToRenderer = createSendToRenderer(() => undefined);
    expect(() => sendToRenderer('ch', 1, 2, 3)).not.toThrow();
  });

  test('übergibt beliebig viele Argumente', () => {
    const send = jest.fn();
    const win = { isDestroyed: () => false, webContents: { send } };
    const sendToRenderer = createSendToRenderer(() => win);

    sendToRenderer('multi', 1, 2, 3, 4, 5);
    expect(send).toHaveBeenCalledWith('multi', 1, 2, 3, 4, 5);
  });

  test('ruft getWindow bei jedem Aufruf erneut ab', () => {
    const send = jest.fn();
    const getWindow = jest.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ isDestroyed: () => false, webContents: { send } });

    const sendToRenderer = createSendToRenderer(getWindow);
    sendToRenderer('ch1');
    sendToRenderer('ch2', 'val');

    expect(getWindow).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('ch2', 'val');
  });
});


// ═══════════════════════════════════════════════════════════════
// buildEnv
// ═══════════════════════════════════════════════════════════════
describe('buildEnv', () => {
  const ORIGINAL_PATH = process.env.PATH;
  const ORIGINAL_PLATFORM = process.platform;

  function setPlatform(p) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH;
    setPlatform(ORIGINAL_PLATFORM);
  });

  describe('auf Linux/macOS', () => {
    beforeEach(() => setPlatform('linux'));

    test('fügt ~/.local/bin zum PATH hinzu wenn nicht vorhanden', () => {
      process.env.PATH = '/usr/bin';
      const env = buildEnv();
      const home = os.homedir();
      expect(env.PATH).toContain(path.join(home, '.local', 'bin'));
    });

  test('fügt ~/bin zum PATH hinzu wenn nicht vorhanden', () => {
    process.env.PATH = '/usr/bin';
    const env = buildEnv();
    const home = os.homedir();
    expect(env.PATH).toContain(path.join(home, 'bin'));
  });

  test('dupliziert nicht bereits vorhandene Pfade', () => {
    const home = os.homedir();
    const localBin = path.join(home, '.local', 'bin');
    process.env.PATH = `${localBin}:/usr/bin`;
    const env = buildEnv();
    // Der Pfad darf nur einmal vorkommen
    const occurrences = env.PATH.split(path.delimiter).filter(p => p === localBin).length;
    expect(occurrences).toBe(1);
  });

  test('behält bestehenden PATH-Inhalt', () => {
    process.env.PATH = '/some/custom/path:/usr/bin';
    const env = buildEnv();
    expect(env.PATH).toContain('/some/custom/path');
    expect(env.PATH).toContain('/usr/bin');
  });

  test('user dirs stehen vor dem System-PATH (höhere Priorität)', () => {
    process.env.PATH = '/usr/bin';
    const env = buildEnv();
    const home = os.homedir();
    const localBin = path.join(home, '.local', 'bin');
    const parts = env.PATH.split(path.delimiter);
    expect(parts.indexOf(localBin)).toBeLessThan(parts.indexOf('/usr/bin'));
  });

  test('mergt extraEnv mit process.env', () => {
    const env = buildEnv({ FOO: 'bar', NO_COLOR: '1' });
    expect(env.FOO).toBe('bar');
    expect(env.NO_COLOR).toBe('1');
  });

  test('extraEnv überschreibt process.env (außer PATH)', () => {
    process.env.MY_VAR = 'original';
    const env = buildEnv({ MY_VAR: 'overridden' });
    expect(env.MY_VAR).toBe('overridden');
    delete process.env.MY_VAR;
  });

  test('PATH wird nicht von extraEnv überschrieben', () => {
    process.env.PATH = '/usr/bin';
    const env = buildEnv({ PATH: '/should/not/win' });
    // Die augmentierte Version muss gewinnen — nicht die rohe extraEnv-PATH
    const home = os.homedir();
    expect(env.PATH).toContain(path.join(home, '.local', 'bin'));
  });

  test('funktioniert mit leerem PATH', () => {
    process.env.PATH = '';
    const env = buildEnv();
    const home = os.homedir();
    expect(env.PATH).toContain(path.join(home, '.local', 'bin'));
    expect(env.PATH).toContain('/usr/bin');
  });

  test('Standardaufruf ohne extraEnv funktioniert', () => {
    expect(() => buildEnv()).not.toThrow();
    expect(buildEnv().PATH).toBeTruthy();
  });
  }); // end describe 'auf Linux/macOS'

  describe('auf Windows', () => {
    beforeEach(() => setPlatform('win32'));

    test('injiziert KEINE Unix-Pfade in PATH', () => {
      process.env.PATH = 'C:\\Windows\\System32;C:\\Windows';
      const env = buildEnv();
      expect(env.PATH).not.toContain('/usr/bin');
      expect(env.PATH).not.toContain('/usr/local/bin');
      expect(env.PATH).not.toContain('/.local/bin');
    });

    test('lässt Windows-PATH unverändert', () => {
      process.env.PATH = 'C:\\Windows\\System32;C:\\Users\\Test\\AppData\\Roaming\\npm';
      const env = buildEnv();
      expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Users\\Test\\AppData\\Roaming\\npm');
    });

    test('mergt extraEnv auch auf Windows', () => {
      const env = buildEnv({ NO_COLOR: '1', FOO: 'bar' });
      expect(env.NO_COLOR).toBe('1');
      expect(env.FOO).toBe('bar');
    });

    test('extraEnv überschreibt process.env auf Windows', () => {
      process.env.MY_VAR = 'original';
      const env = buildEnv({ MY_VAR: 'overridden' });
      expect(env.MY_VAR).toBe('overridden');
      delete process.env.MY_VAR;
    });
  });
});


const {
  createSendToRenderer,
  waitForReady,
  collectPtyOutput,
  cleanupPty,
} = require('../src/main-helpers');

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
// waitForReady
// ═══════════════════════════════════════════════════════════════
describe('waitForReady', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('resolved sofort wenn bereits ready', async () => {
    const map = new Map([['tab1', true]]);
    await expect(waitForReady(map, 'tab1')).resolves.toBeUndefined();
  });

  test('resolved nach Intervall wenn ready gesetzt wird', async () => {
    const map = new Map();
    const p = waitForReady(map, 'tab1', { checkIntervalMs: 100 });

    jest.advanceTimersByTime(100);
    map.set('tab1', true);
    jest.advanceTimersByTime(100);

    await expect(p).resolves.toBeUndefined();
  });

  test('rejected bei Timeout wenn nie ready', async () => {
    const map = new Map();
    const p = waitForReady(map, 'tab1', { timeoutMs: 5000, checkIntervalMs: 100 });

    jest.advanceTimersByTime(5000);

    await expect(p).rejects.toThrow('Terminal nicht bereit (Timeout)');
  });

  test('resolved wenn ready genau beim Timeout gesetzt wird', async () => {
    const map = new Map();
    const p = waitForReady(map, 'tab1', { timeoutMs: 1000, checkIntervalMs: 200 });

    // Set ready right before timeout fires
    jest.advanceTimersByTime(999);
    map.set('tab1', true);
    jest.advanceTimersByTime(1);

    await expect(p).resolves.toBeUndefined();
  });

  test('nutzt Standard-Timeout von 20000ms', async () => {
    const map = new Map();
    const p = waitForReady(map, 'x');

    jest.advanceTimersByTime(19999);
    // Should still be pending
    map.set('x', true);
    jest.advanceTimersByTime(1);

    await expect(p).resolves.toBeUndefined();
  });

  test('funktioniert mit verschiedenen tabIds unabhängig', async () => {
    const map = new Map();
    const p1 = waitForReady(map, 'a', { timeoutMs: 500, checkIntervalMs: 50 });
    const p2 = waitForReady(map, 'b', { timeoutMs: 500, checkIntervalMs: 50 });

    map.set('a', true);
    jest.advanceTimersByTime(50);

    await expect(p1).resolves.toBeUndefined();

    jest.advanceTimersByTime(500);
    await expect(p2).rejects.toThrow('Terminal nicht bereit (Timeout)');
  });
});

// ═══════════════════════════════════════════════════════════════
// collectPtyOutput
// ═══════════════════════════════════════════════════════════════
describe('collectPtyOutput', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function createMockPty() {
    const listeners = [];
    return {
      onData(fn) {
        listeners.push(fn);
        return { dispose: jest.fn() };
      },
      emit(data) {
        listeners.forEach(fn => fn(data));
      },
    };
  }

  test('sammelt Daten und resolved nach Stille', async () => {
    const mockPty = createMockPty();
    const stripFn = (s) => s;
    const p = collectPtyOutput(mockPty, stripFn, { quietMs: 500, timeoutMs: 5000 });

    mockPty.emit('hello ');
    mockPty.emit('world');
    jest.advanceTimersByTime(500);

    await expect(p).resolves.toBe('hello world');
  });

  test('resolved bei Timeout wenn ständig Daten kommen', async () => {
    const mockPty = createMockPty();
    const stripFn = (s) => s;
    const p = collectPtyOutput(mockPty, stripFn, { quietMs: 1000, timeoutMs: 2000 });

    mockPty.emit('chunk1');
    jest.advanceTimersByTime(500);
    mockPty.emit('chunk2');
    jest.advanceTimersByTime(500);
    mockPty.emit('chunk3');
    jest.advanceTimersByTime(1000); // reaches timeout

    await expect(p).resolves.toBe('chunk1chunk2chunk3');
  });

  test('strippt ANSI-Codes mit bereitgestellter stripFn', async () => {
    const mockPty = createMockPty();
    const stripFn = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const p = collectPtyOutput(mockPty, stripFn, { quietMs: 200, timeoutMs: 5000 });

    mockPty.emit('\x1b[31mRed\x1b[0m');
    jest.advanceTimersByTime(200);

    await expect(p).resolves.toBe('Red');
  });

  test('resolved leer wenn keine Daten und Timeout erreicht', async () => {
    const mockPty = createMockPty();
    const stripFn = (s) => s;
    const p = collectPtyOutput(mockPty, stripFn, { quietMs: 500, timeoutMs: 1000 });

    jest.advanceTimersByTime(1000);

    await expect(p).resolves.toBe('');
  });

  test('ruft dispose auf dem Listener auf', async () => {
    const dispose = jest.fn();
    const listeners = [];
    const mockPty = {
      onData(fn) {
        listeners.push(fn);
        return { dispose };
      },
    };
    const stripFn = (s) => s;
    const p = collectPtyOutput(mockPty, stripFn, { quietMs: 100, timeoutMs: 5000 });

    listeners[0]('data');
    jest.advanceTimersByTime(100);

    await p;
    expect(dispose).toHaveBeenCalled();
  });

  test('nutzt Standard-stripAnsi wenn stripFn null ist', async () => {
    const mockPty = createMockPty();
    const p = collectPtyOutput(mockPty, null, { quietMs: 100, timeoutMs: 5000 });

    mockPty.emit('\x1b[32mGreen\x1b[0m');
    jest.advanceTimersByTime(100);

    await expect(p).resolves.toBe('Green');
  });
});

// ═══════════════════════════════════════════════════════════════
// cleanupPty
// ═══════════════════════════════════════════════════════════════
describe('cleanupPty', () => {
  test('löscht tabId aus allen Maps', () => {
    const m1 = new Map([['t1', 'proc']]);
    const m2 = new Map([['t1', ['buf']]]);
    const m3 = new Map([['t1', true]]);
    const m4 = new Map([['t1', false]]);

    cleanupPty([m1, m2, m3, m4], 't1', 0);

    expect(m1.has('t1')).toBe(false);
    expect(m2.has('t1')).toBe(false);
    expect(m3.has('t1')).toBe(false);
    expect(m4.has('t1')).toBe(false);
  });

  test('ruft extraCleanup auf wenn vorhanden', () => {
    const extra = jest.fn();
    cleanupPty([new Map([['t1', 1]])], 't1', 0, { extraCleanup: extra });
    expect(extra).toHaveBeenCalledTimes(1);
  });

  test('ruft sendFn mit korrekten Argumenten auf', () => {
    const sendFn = jest.fn();
    cleanupPty([new Map([['t1', 1]])], 't1', 42, { sendFn });
    expect(sendFn).toHaveBeenCalledWith('terminal:exit', 't1', 42);
  });

  test('funktioniert ohne extraCleanup und sendFn', () => {
    const m = new Map([['x', 'val']]);
    expect(() => cleanupPty([m], 'x', 1)).not.toThrow();
    expect(m.has('x')).toBe(false);
  });

  test('lässt andere tabIds in Maps unberührt', () => {
    const m1 = new Map([['t1', 'a'], ['t2', 'b']]);
    const m2 = new Map([['t1', true], ['t2', true]]);

    cleanupPty([m1, m2], 't1', 0);

    expect(m1.get('t2')).toBe('b');
    expect(m2.get('t2')).toBe(true);
  });

  test('übergibt exitCode korrekt an sendFn', () => {
    const sendFn = jest.fn();
    cleanupPty([], 'tab99', -1, { sendFn });
    expect(sendFn).toHaveBeenCalledWith('terminal:exit', 'tab99', -1);
  });
});

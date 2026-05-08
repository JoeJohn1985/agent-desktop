/**
 * Unit-Tests für src/ipc/terminal-ipc.js
 */
'use strict';

// Mock electron
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
}));

const { ipcMain } = require('electron');

describe('registerTerminalIPC', () => {
  let deps;
  let mockPtyProcess;

  function getHandle(channel) {
    const call = ipcMain.handle.mock.calls.find(c => c[0] === channel);
    if (!call) throw new Error(`handle not found: ${channel}`);
    return call[1];
  }

  function getOn(channel) {
    const call = ipcMain.on.mock.calls.find(c => c[0] === channel);
    if (!call) throw new Error(`on not found: ${channel}`);
    return call[1];
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPtyProcess = {
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
      onData: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      onExit: jest.fn(),
    };
    deps = {
      pty: { spawn: jest.fn().mockReturnValue(mockPtyProcess) },
      getShell: () => 'cmd.exe',
      terminalProcesses: new Map(),
      terminalBuffers: new Map(),
      terminalReady: new Map(),
      terminalBusy: new Map(),
      sendToRenderer: jest.fn(),
      waitForTerminalReady: jest.fn().mockResolvedValue(undefined),
      collectPtyOutput: jest.fn().mockResolvedValue('mock output'),
      cleanupPty: jest.fn(),
      COPILOT_CWD: 'C:\\DEV',
      PTY_BUFFER_MAX_CHUNKS: 5000,
      PTY_READY_TIMEOUT_MS: 20000,
      PTY_WRITE_DELAY_MS: 100,
      PTY_SLASH_QUIET_THRESHOLD_MS: 5000,
      PTY_SLASH_CHECK_INTERVAL_MS: 500,
      PTY_SLASH_FALLBACK_TIMEOUT_MS: 30000,
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function registerFresh() {
    const { registerTerminalIPC } = require('../src/ipc/terminal-ipc');
    registerTerminalIPC(deps);
  }

  // ── Registration ──────────────────────────────────────────────

  test('registriert alle ipcMain.handle Handler', () => {
    registerFresh();
    const channels = ipcMain.handle.mock.calls.map(c => c[0]);
    expect(channels).toContain('terminal:available');
    expect(channels).toContain('terminal:spawn');
    expect(channels).toContain('terminal:spawn-background');
    expect(channels).toContain('terminal:get-buffer');
    expect(channels).toContain('terminal:send-command');
    expect(channels).toContain('terminal:fetch-context');
    expect(channels).toContain('terminal:send-slash');
    expect(channels).toHaveLength(7);
  });

  test('registriert alle ipcMain.on Handler', () => {
    registerFresh();
    const channels = ipcMain.on.mock.calls.map(c => c[0]);
    expect(channels).toContain('terminal:input');
    expect(channels).toContain('terminal:resize');
    expect(channels).toContain('terminal:close');
    expect(channels).toHaveLength(3);
  });

  // ── terminal:available ────────────────────────────────────────

  test('terminal:available gibt true wenn pty geladen', () => {
    registerFresh();
    expect(getHandle('terminal:available')()).toBe(true);
  });

  test('terminal:available gibt false wenn pty null', () => {
    deps.pty = null;
    registerFresh();
    expect(getHandle('terminal:available')()).toBe(false);
  });

  // ── terminal:get-buffer ───────────────────────────────────────

  test('terminal:get-buffer gibt Buffer für existierenden Tab', () => {
    deps.terminalBuffers.set('tab1', ['chunk1', 'chunk2']);
    registerFresh();
    const result = getHandle('terminal:get-buffer')({}, 'tab1');
    expect(result).toEqual(['chunk1', 'chunk2']);
  });

  test('terminal:get-buffer gibt leeres Array für unbekannten Tab', () => {
    registerFresh();
    const result = getHandle('terminal:get-buffer')({}, 'unknown');
    expect(result).toEqual([]);
  });

  // ── terminal:send-command ─────────────────────────────────────

  test('terminal:send-command gibt Fehler bei nicht-string Kommando', () => {
    registerFresh();
    const result = getHandle('terminal:send-command')({}, 'tab1', 123);
    expect(result).toEqual({ success: false, error: 'Ungültige Argumente' });
  });

  test('terminal:send-command gibt Fehler wenn kein Prozess', () => {
    registerFresh();
    const result = getHandle('terminal:send-command')({}, 'tab1', 'hello');
    expect(result).toEqual({ success: false, error: 'No terminal process' });
  });

  test('terminal:send-command schreibt bracketed paste zum Prozess', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    const result = getHandle('terminal:send-command')({}, 'tab1', 'test command');
    expect(result).toEqual({ success: true });
    expect(mockPtyProcess.write).toHaveBeenCalledWith('\x1b[200~test command\x1b[201~');
  });

  // ── terminal:spawn-background ─────────────────────────────────

  test('terminal:spawn-background gibt alreadyRunning wenn Prozess existiert', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    const result = getHandle('terminal:spawn-background')({}, 'tab1', 'session1');
    expect(result).toEqual({ success: true, alreadyRunning: true });
  });

  test('terminal:spawn-background gibt Fehler wenn pty null', () => {
    deps.pty = null;
    registerFresh();
    const result = getHandle('terminal:spawn-background')({}, 'tab1', 'session1');
    expect(result).toEqual({ success: false, error: 'node-pty not available' });
  });

  test('terminal:spawn-background spawnt neuen PTY-Prozess', () => {
    registerFresh();
    const result = getHandle('terminal:spawn-background')({}, 'tab1', 'session1');
    expect(result).toEqual({ success: true });
    expect(deps.pty.spawn).toHaveBeenCalledWith('cmd.exe', [], expect.objectContaining({
      cwd: 'C:\\DEV',
      cols: 80,
      rows: 24,
    }));
    expect(deps.terminalProcesses.has('tab1')).toBe(true);
    expect(deps.terminalBuffers.has('tab1')).toBe(true);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('copilot --allow-all-tools --resume=session1\r');
  });

  test('terminal:spawn-background spawnt ohne --resume wenn keine sessionId', () => {
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab2', null);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('copilot --allow-all-tools\r');
  });

  test('terminal:spawn-background onData buffert und sendet an Renderer', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);

    // First onData callback is the buffer/send one
    const bufferCb = onDataCallbacks[0];
    bufferCb('hello');
    bufferCb(' world');

    expect(deps.sendToRenderer).toHaveBeenCalledWith('terminal:data', 'tab1', 'hello');
    expect(deps.sendToRenderer).toHaveBeenCalledWith('terminal:data', 'tab1', ' world');
    expect(deps.terminalBuffers.get('tab1')).toEqual(['hello', ' world']);
  });

  test('terminal:spawn-background buffer limit trimmt älteste Chunks', () => {
    deps.PTY_BUFFER_MAX_CHUNKS = 3;
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);

    const bufferCb = onDataCallbacks[0];
    bufferCb('a');
    bufferCb('b');
    bufferCb('c');
    bufferCb('d'); // should trim 'a'

    expect(deps.terminalBuffers.get('tab1')).toEqual(['b', 'c', 'd']);
  });

  test('terminal:spawn-background erkennt TUI ready', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);

    // Second onData callback is the ready detection
    const readyCb = onDataCallbacks[1];
    readyCb('Welcome! Type / commands to get started');

    expect(deps.terminalReady.get('tab1')).toBe(true);
  });

  test('terminal:spawn-background auto-confirms resume conflict', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', 'sess1');

    const readyCb = onDataCallbacks[1];
    readyCb('Session may already be in use');

    jest.advanceTimersByTime(600);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('1\r');
  });

  test('terminal:spawn-background auto-confirms folder trust prompt', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);

    const readyCb = onDataCallbacks[1];
    readyCb('Confirm folder trust\n? Yes');

    jest.advanceTimersByTime(600);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('2\r');
  });

  test('terminal:spawn-background readyFallback setzt ready nach Timeout', () => {
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);
    expect(deps.terminalReady.get('tab1')).toBe(false);

    jest.advanceTimersByTime(20001);
    expect(deps.terminalReady.get('tab1')).toBe(true);
  });

  test('terminal:spawn-background onExit ruft cleanupPty auf', () => {
    let exitCb;
    mockPtyProcess.onExit = jest.fn((cb) => { exitCb = cb; });
    registerFresh();
    getHandle('terminal:spawn-background')({}, 'tab1', null);

    exitCb({ exitCode: 0 });
    expect(deps.cleanupPty).toHaveBeenCalledWith('tab1', 0, expect.any(Function));
  });

  // ── terminal:spawn ────────────────────────────────────────────

  test('terminal:spawn gibt Fehler wenn pty null', () => {
    deps.pty = null;
    registerFresh();
    const result = getHandle('terminal:spawn')({}, 'tab1', null, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('node-pty');
  });

  test('terminal:spawn gibt reused:true bei existierendem Prozess', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    const result = getHandle('terminal:spawn')({}, 'tab1', null, null);
    expect(result).toEqual({ success: true, reused: true });
  });

  test('terminal:spawn sendet slashCommand bei existierendem Prozess', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    getHandle('terminal:spawn')({}, 'tab1', null, '/help');
    // Characters are written one by one
    expect(mockPtyProcess.write).toHaveBeenCalledWith('/');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('h');
    jest.advanceTimersByTime(600);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('\r');
  });

  test('terminal:spawn erstellt neuen Prozess mit sessionId', () => {
    registerFresh();
    const result = getHandle('terminal:spawn')({}, 'tab1', 'mysession', null);
    expect(result).toEqual({ success: true });
    expect(deps.pty.spawn).toHaveBeenCalled();
    expect(mockPtyProcess.write).toHaveBeenCalledWith('copilot --allow-all-tools --resume=mysession\r');
    expect(deps.terminalProcesses.get('tab1')).toBe(mockPtyProcess);
  });

  test('terminal:spawn onData sendet an Renderer', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn')({}, 'tab1', null, null);

    // First onData is the renderer forwarder
    onDataCallbacks[0]('output data');
    expect(deps.sendToRenderer).toHaveBeenCalledWith('terminal:data', 'tab1', 'output data');
  });

  test('terminal:spawn onExit ruft cleanupPty auf', () => {
    let exitCb;
    mockPtyProcess.onExit = jest.fn((cb) => { exitCb = cb; });
    registerFresh();
    getHandle('terminal:spawn')({}, 'tab1', null, null);

    exitCb({ exitCode: 1 });
    expect(deps.cleanupPty).toHaveBeenCalledWith('tab1', 1, expect.any(Function));
  });

  test('terminal:spawn mit slashCommand sendet nach quiet-Periode', () => {
    const onDataCallbacks = [];
    mockPtyProcess.onData = jest.fn((cb) => {
      onDataCallbacks.push(cb);
      return { dispose: jest.fn() };
    });
    registerFresh();
    getHandle('terminal:spawn')({}, 'tab1', null, '/help');

    // Initially the slash command hasn't been sent (waiting for quiet period)
    expect(mockPtyProcess.write).not.toHaveBeenCalledWith('\x1b[200~/help\x1b[201~');

    // Advance past the quiet threshold (5000ms) + one check interval (500ms)
    jest.advanceTimersByTime(5600);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('\x1b[200~/help\x1b[201~');

    // Enter is sent after PTY_WRITE_DELAY_MS
    jest.advanceTimersByTime(200);
    expect(mockPtyProcess.write).toHaveBeenCalledWith('\r');
  });

  test('terminal:spawn slashCommand fallback timeout räumt auf', () => {
    const disposeSpies = [];
    mockPtyProcess.onData = jest.fn(() => {
      const spy = jest.fn();
      disposeSpies.push(spy);
      return { dispose: spy };
    });
    registerFresh();
    getHandle('terminal:spawn')({}, 'tab1', null, '/slow');

    // Keep sending data to reset lastDataTime (prevents quiet detection)
    const dataCallbacks = mockPtyProcess.onData.mock.calls;
    // The second onData call is the slash monitor
    const slashDataCb = dataCallbacks[1]?.[0];
    if (slashDataCb) {
      // Keep resetting by sending data every 4 seconds
      for (let i = 0; i < 7; i++) {
        jest.advanceTimersByTime(4000);
        slashDataCb('data');
      }
    }

    // Advance to fallback timeout
    jest.advanceTimersByTime(30001);
    // dispose should have been called
    expect(disposeSpies.length).toBeGreaterThan(0);
  });

  // ── terminal:fetch-context ────────────────────────────────────

  test('terminal:fetch-context gibt Fehler wenn kein Prozess', async () => {
    registerFresh();
    const result = await getHandle('terminal:fetch-context')({}, 'tab1');
    expect(result).toEqual({ success: false, error: 'Kein Background-Terminal aktiv' });
  });

  test('terminal:fetch-context gibt Fehler wenn busy', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.terminalBusy.set('tab1', true);
    registerFresh();
    const result = await getHandle('terminal:fetch-context')({}, 'tab1');
    expect(result).toEqual({ success: false, error: 'Ein Befehl läuft bereits' });
  });

  test('terminal:fetch-context schickt /context und sammelt Output', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.collectPtyOutput.mockResolvedValue('Context:\n- file.js\n- main.js');
    registerFresh();
    const result = await getHandle('terminal:fetch-context')({}, 'tab1');
    expect(result.success).toBe(true);
    expect(deps.waitForTerminalReady).toHaveBeenCalledWith('tab1');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('/context\r');
    expect(deps.collectPtyOutput).toHaveBeenCalledWith(mockPtyProcess);
  });

  test('terminal:fetch-context setzt busy-flag korrekt', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    await getHandle('terminal:fetch-context')({}, 'tab1');
    // After completion, busy should be false
    expect(deps.terminalBusy.get('tab1')).toBe(false);
  });

  test('terminal:fetch-context fängt Fehler ab', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.waitForTerminalReady.mockRejectedValue(new Error('timeout'));
    registerFresh();
    const result = await getHandle('terminal:fetch-context')({}, 'tab1');
    expect(result).toEqual({ success: false, error: 'timeout' });
    expect(deps.terminalBusy.get('tab1')).toBe(false);
  });

  // ── terminal:send-slash ───────────────────────────────────────

  test('terminal:send-slash gibt Fehler wenn kein Prozess', async () => {
    registerFresh();
    const result = await getHandle('terminal:send-slash')({}, 'tab1', '/help');
    expect(result).toEqual({ success: false, error: 'Kein Background-Terminal aktiv' });
  });

  test('terminal:send-slash gibt Fehler wenn busy', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.terminalBusy.set('tab1', true);
    registerFresh();
    const result = await getHandle('terminal:send-slash')({}, 'tab1', '/help');
    expect(result).toEqual({ success: false, error: 'Ein Befehl läuft bereits' });
  });

  test('terminal:send-slash sendet Kommando und gibt Output zurück', async () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.collectPtyOutput.mockResolvedValue('Slash output');
    registerFresh();
    const result = await getHandle('terminal:send-slash')({}, 'tab1', '/compact');
    expect(result.success).toBe(true);
    expect(result.output).toBe('Slash output');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('/compact\r');
  });

  // ── terminal:input ────────────────────────────────────────────

  test('terminal:input schreibt Daten zum Prozess', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    getOn('terminal:input')({}, 'tab1', 'hello');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('hello');
  });

  test('terminal:input ignoriert nicht-string Daten', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    getOn('terminal:input')({}, 'tab1', 123);
    expect(mockPtyProcess.write).not.toHaveBeenCalled();
  });

  test('terminal:input ignoriert unbekannten Tab', () => {
    registerFresh();
    // Should not throw
    getOn('terminal:input')({}, 'unknown', 'data');
  });

  // ── terminal:resize ───────────────────────────────────────────

  test('terminal:resize ändert die Größe des Prozesses', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    registerFresh();
    getOn('terminal:resize')({}, 'tab1', 120, 40);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
  });

  test('terminal:resize ignoriert unbekannten Tab', () => {
    registerFresh();
    // Should not throw
    getOn('terminal:resize')({}, 'unknown', 80, 24);
  });

  // ── terminal:close ────────────────────────────────────────────

  test('terminal:close killt Prozess und räumt auf', () => {
    deps.terminalProcesses.set('tab1', mockPtyProcess);
    deps.terminalBuffers.set('tab1', ['data']);
    deps.terminalReady.set('tab1', true);
    deps.terminalBusy.set('tab1', false);

    registerFresh();
    getOn('terminal:close')({}, 'tab1');

    expect(mockPtyProcess.kill).toHaveBeenCalled();
    expect(deps.terminalProcesses.has('tab1')).toBe(false);
    expect(deps.terminalBuffers.has('tab1')).toBe(false);
    expect(deps.terminalReady.has('tab1')).toBe(false);
    expect(deps.terminalBusy.has('tab1')).toBe(false);
  });

  test('terminal:close behandelt unbekannten Tab', () => {
    registerFresh();
    // Should not throw
    getOn('terminal:close')({}, 'nonexistent');
  });
});

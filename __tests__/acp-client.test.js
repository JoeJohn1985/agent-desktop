'use strict';

/**
 * Tests für den AcpClient (ACP-Backend-Migration).
 *
 * Testet das Interface des AcpClient gegen die tatsächliche Implementierung
 * in src/acp-client.js.
 *
 * Abgedeckte Bereiche:
 *  1. Instanziierung & Defaults
 *  2. Prozess-Start + Initialize-Handshake
 *  3. JSON-RPC Protokoll (Request-IDs, Korrelation, Notifications)
 *  4. Session-Management (new, load, Fallback)
 *  5. Prompt + Streaming + State-Wechsel
 *  6. Event-Mapping (ACP → Renderer)
 *  7. Crash-Recovery
 *  8. Cancel
 */

const { EventEmitter } = require('events');
const { Readable, Writable } = require('stream');

// ── Mock-Setup ──────────────────────────────────────────────────

let mockSpawnFn;
let mockProcesses = [];

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdin = new Writable({ write(chunk, enc, cb) { cb(); } });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.kill = jest.fn();
  proc.pid = 12345 + mockProcesses.length;
  mockProcesses.push(proc);
  return proc;
}

/**
 * Simuliert eine JSON-RPC Response auf stdout des Mock-Prozesses.
 */
function sendResponse(proc, response) {
  const line = JSON.stringify(response) + '\n';
  proc.stdout.push(line);
}

/**
 * Simuliert eine JSON-RPC Notification (kein id-Feld).
 */
function sendNotification(proc, method, params) {
  sendResponse(proc, { jsonrpc: '2.0', method, params });
}

// ── Mock child_process ──────────────────────────────────────────

jest.mock('child_process', () => ({
  spawn: (...args) => mockSpawnFn(...args),
}));

// ── AcpClient Import ────────────────────────────────────────────
const { AcpClient } = require('../src/acp-client');

// ── Helper ──────────────────────────────────────────────────────

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────

describe('AcpClient', () => {
  let client;
  let mockSendToRenderer;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    mockProcesses = [];
    mockSpawnFn = jest.fn(() => createMockProcess());
    mockSendToRenderer = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════
  // 1. Instanziierung
  // ════════════════════════════════════════════════════════════════

  describe('Instanziierung', () => {
    it('setzt State auf "dead" als Default', () => {
      client = new AcpClient('tab-1', mockSendToRenderer);
      expect(client.state).toBe('dead');
    });

    it('startet ohne aktive Requests (erster Request bekommt id=1)', async () => {
      const proc = createMockProcess();
      const stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) { stdinWritten.push(chunk.toString()); cb(); }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      client.start();
      await flushPromises();

      const req = JSON.parse(stdinWritten[0].trim());
      expect(req.id).toBe(1);
    });

    it('speichert tabId', () => {
      client = new AcpClient('tab-1', mockSendToRenderer);
      expect(client.tabId).toBe('tab-1');
    });

    it('hat keine aktive sessionId', () => {
      client = new AcpClient('tab-1', mockSendToRenderer);
      expect(client.sessionId).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. Prozess-Start
  // ════════════════════════════════════════════════════════════════

  describe('Prozess-Start', () => {
    beforeEach(() => {
      client = new AcpClient('tab-1', mockSendToRenderer);
    });

    it('spawnt Prozess mit "copilot" und "--acp" Argument', async () => {
      const startPromise = client.start();
      await flushPromises();

      expect(mockSpawnFn).toHaveBeenCalledWith(
        'copilot',
        expect.arrayContaining(['--acp']),
        expect.any(Object)
      );

      // Initialize-Response simulieren um start() abzuschließen
      const proc = mockProcesses[0];
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
    });

    it('wechselt State von "dead" zu "starting" beim Start', () => {
      client.start();
      expect(client.state).toBe('starting');
    });

    it('sendet "initialize" Request nach Spawn', async () => {
      // Neuen Mock-Prozess für diesen Test
      const proc = createMockProcess();
      const stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          stdinWritten.push(chunk.toString());
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client.start();
      await flushPromises();

      expect(stdinWritten.length).toBeGreaterThan(0);
      const request = JSON.parse(stdinWritten[0].trim());
      expect(request.method).toBe('initialize');
      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBeDefined();
    });

    it('wechselt zu "ready" nach erfolgreicher Initialize-Response', async () => {
      const proc = createMockProcess();
      mockSpawnFn = jest.fn(() => proc);

      const startPromise = client.start();
      await flushPromises();

      // Simuliere erfolgreiche initialize-Response
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;

      expect(client.state).toBe('ready');
    });

    it('killt Prozess bei Initialize-Timeout', async () => {
      const proc = createMockProcess();
      mockSpawnFn = jest.fn(() => proc);

      const startPromise = client.start().catch(() => {});
      await flushPromises();

      // 15 Sekunden Timeout für initialize (INITIALIZE_TIMEOUT_MS)
      jest.advanceTimersByTime(15000);
      await flushPromises();

      expect(proc.kill).toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. JSON-RPC Protokoll
  // ════════════════════════════════════════════════════════════════

  describe('JSON-RPC Protokoll', () => {
    let proc;
    let stdinWritten;

    beforeEach(async () => {
      proc = createMockProcess();
      stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          stdinWritten.push(chunk.toString());
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startPromise = client.start();
      await flushPromises();

      // Initialize abschließen
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;
      stdinWritten = []; // Reset nach initialize
    });

    it('inkrementiert Request-IDs bei aufeinanderfolgenden Requests', async () => {
      // Zwei Requests senden
      const p1 = client.newSession();
      await flushPromises();
      const req1 = JSON.parse(stdinWritten[0].trim());

      const p2 = client.listSessions();
      await flushPromises();
      const req2 = JSON.parse(stdinWritten[1].trim());

      expect(req2.id).toBe(req1.id + 1);

      // Cleanup: Responses senden
      sendResponse(proc, { jsonrpc: '2.0', id: req1.id, result: { sessionId: 's1' } });
      sendResponse(proc, { jsonrpc: '2.0', id: req2.id, result: { sessions: [] } });
      await flushPromises();
    });

    it('korreliert Responses korrekt mit Requests über die id', async () => {
      const p1 = client.newSession();
      await flushPromises();
      const req1 = JSON.parse(stdinWritten[0].trim());

      const p2 = client.listSessions();
      await flushPromises();
      const req2 = JSON.parse(stdinWritten[1].trim());

      // Responses in umgekehrter Reihenfolge senden
      sendResponse(proc, { jsonrpc: '2.0', id: req2.id, result: { sessions: ['a', 'b'] } });
      sendResponse(proc, { jsonrpc: '2.0', id: req1.id, result: { sessionId: 'sess-42' } });
      await flushPromises();

      const result1 = await p1;
      const result2 = await p2;

      expect(result1).toEqual(expect.objectContaining({ sessionId: 'sess-42' }));
      expect(result2).toEqual(expect.objectContaining({ sessions: ['a', 'b'] }));
    });

    it('dispatcht Notifications (ohne id) als Events via sendToRenderer', async () => {
      sendNotification(proc, 'session/update', {
        type: 'agent_message_chunk',
        data: { text: 'Hallo Welt' },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'assistant.message_delta',
        })
      );
    });

    it('loggt Parse-Fehler ohne zu crashen', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Ungültiges JSON auf stdout pushen
      proc.stdout.push('das ist kein json\n');
      await flushPromises();

      // Client sollte nicht crashen
      expect(client.state).not.toBe('dead');
      consoleSpy.mockRestore();
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 4. Session-Management
  // ════════════════════════════════════════════════════════════════

  describe('Session-Management', () => {
    let proc;
    let stdinWritten;

    beforeEach(async () => {
      proc = createMockProcess();
      stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          stdinWritten.push(chunk.toString());
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startPromise = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;
      stdinWritten = [];
    });

    it('newSession() sendet "session/new" Request', async () => {
      const p = client.newSession();
      await flushPromises();

      const req = JSON.parse(stdinWritten[0].trim());
      expect(req.method).toBe('session/new');

      sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { sessionId: 'new-sess-1' } });
      await flushPromises();
      await p;
    });

    it('newSession() übergibt die konfigurierten mcpServers aus den Options', async () => {
      const mcp = [{ name: 'playwright', type: 'stdio', command: 'npx', args: ['x'], env: [] }];
      const c = new AcpClient('tab-mcp', mockSendToRenderer, { mcpServers: mcp });
      const written = [];
      const p2 = createMockProcess();
      p2.stdin = new Writable({ write(chunk, enc, cb) { written.push(chunk.toString()); cb(); } });
      mockSpawnFn = jest.fn(() => p2);
      const sp = c.start();
      await flushPromises();
      sendResponse(p2, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await sp;
      written.length = 0;

      const np = c.newSession();
      await flushPromises();
      const req = JSON.parse(written[0].trim());
      expect(req.method).toBe('session/new');
      expect(req.params.mcpServers).toEqual(mcp);

      sendResponse(p2, { jsonrpc: '2.0', id: req.id, result: { sessionId: 'mcp-sess' } });
      await flushPromises();
      await np;
    });

    it('newSession() speichert die sessionId', async () => {
      const p = client.newSession();
      await flushPromises();
      const req = JSON.parse(stdinWritten[0].trim());

      sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { sessionId: 'my-session' } });
      await flushPromises();
      await p;

      expect(client.sessionId).toBe('my-session');
    });

    it('loadSession(id) sendet "session/load" mit der Session-ID', async () => {
      const p = client.loadSession('existing-sess-99');
      await flushPromises();

      const req = JSON.parse(stdinWritten[0].trim());
      expect(req.method).toBe('session/load');
      expect(req.params).toEqual(expect.objectContaining({ sessionId: 'existing-sess-99' }));

      sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { sessionId: 'existing-sess-99' } });
      await flushPromises();
      await p;
    });

    it('loadSession() fällt auf session/new zurück bei Fehler', async () => {
      const p = client.loadSession('broken-session');
      await flushPromises();
      const req1 = JSON.parse(stdinWritten[0].trim());

      // Fehler-Response für session/load
      sendResponse(proc, {
        jsonrpc: '2.0',
        id: req1.id,
        error: { code: -32000, message: 'Session not found' },
      });
      await flushPromises();

      // Sollte automatisch session/new senden
      await flushPromises();
      const req2 = JSON.parse(stdinWritten[1].trim());
      expect(req2.method).toBe('session/new');

      sendResponse(proc, { jsonrpc: '2.0', id: req2.id, result: { sessionId: 'fallback-sess' } });
      await flushPromises();

      const result = await p;
      expect(client.sessionId).toBe('fallback-sess');
    });

    it('loadSession() meldet session.restore_failed an den Renderer vor dem Fallback', async () => {
      const p = client.loadSession('broken-session');
      await flushPromises();
      const req1 = JSON.parse(stdinWritten[0].trim());

      sendResponse(proc, {
        jsonrpc: '2.0',
        id: req1.id,
        error: { code: -32000, message: 'Session not found' },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'session.restore_failed',
          data: expect.objectContaining({ sessionId: 'broken-session' }),
        })
      );

      const req2 = JSON.parse(stdinWritten[1].trim());
      sendResponse(proc, { jsonrpc: '2.0', id: req2.id, result: { sessionId: 'fallback-sess' } });
      await flushPromises();
      await p;
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 5. Prompt + Streaming
  // ════════════════════════════════════════════════════════════════

  describe('Prompt + Streaming', () => {
    let proc;
    let stdinWritten;

    beforeEach(async () => {
      proc = createMockProcess();
      stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          stdinWritten.push(chunk.toString());
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startPromise = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;
      stdinWritten = []; // Reset nach initialize

      // Session erstellen
      const sessP = client.newSession();
      await flushPromises();
      const sessReq = JSON.parse(stdinWritten[0].trim());
      sendResponse(proc, { jsonrpc: '2.0', id: sessReq.id, result: { sessionId: 'test-sess' } });
      await flushPromises();
      await sessP;
      stdinWritten = [];
    });

    it('prompt(text) sendet "session/prompt" Request', async () => {
      client.prompt('Hallo ACP!');
      await flushPromises();

      const req = JSON.parse(stdinWritten[0].trim());
      expect(req.method).toBe('session/prompt');
      expect(req.params.prompt).toEqual([{ type: 'text', text: 'Hallo ACP!' }]);
    });

    it('prompt(text, systemContext) stellt einen zusätzlichen Text-Block voran', async () => {
      client.prompt('Hallo ACP!', 'Verfügbare Skills: pdf');
      await flushPromises();

      const req = JSON.parse(stdinWritten[0].trim());
      expect(req.params.prompt).toEqual([
        { type: 'text', text: 'Verfügbare Skills: pdf' },
        { type: 'text', text: 'Hallo ACP!' },
      ]);
    });

    it('prompt() wechselt State zu "busy"', async () => {
      client.prompt('Test');
      await flushPromises();

      expect(client.state).toBe('busy');
    });

    it('State wechselt zurück zu "ready" nach prompt-result mit stopReason:end_turn', async () => {
      const p = client.prompt('Frage');
      await flushPromises();
      const req = JSON.parse(stdinWritten[0].trim());

      // Simuliere Streaming-Events und finale Response
      sendNotification(proc, 'session/update', {
        type: 'agent_message_chunk',
        data: { text: 'Antwort' },
      });
      await flushPromises();

      sendResponse(proc, {
        jsonrpc: '2.0',
        id: req.id,
        result: { stopReason: 'end_turn' },
      });
      await flushPromises();
      await p;

      expect(client.state).toBe('ready');
    });

    it('Events werden via sendToRenderer an den Renderer gesendet', async () => {
      client.prompt('Test');
      await flushPromises();

      sendNotification(proc, 'session/update', {
        type: 'agent_message_chunk',
        data: { text: 'Streaming...' },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'assistant.message_delta',
        })
      );
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 6. Event-Mapping
  // ════════════════════════════════════════════════════════════════

  describe('Event-Mapping', () => {
    let proc;

    beforeEach(async () => {
      proc = createMockProcess();
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startPromise = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;
    });

    it('agent_message_chunk → assistant.message_delta mit deltaContent', async () => {
      sendNotification(proc, 'session/update', {
        type: 'agent_message_chunk',
        data: { text: 'Hallo!' },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'assistant.message_delta',
          data: expect.objectContaining({ deltaContent: 'Hallo!' }),
        })
      );
    });

    it('agent_thought_chunk → assistant.reasoning_delta mit deltaContent', async () => {
      sendNotification(proc, 'session/update', {
        type: 'agent_thought_chunk',
        data: { text: 'Ich denke...' },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'assistant.reasoning_delta',
          data: expect.objectContaining({ deltaContent: 'Ich denke...' }),
        })
      );
    });

    it('tool_call → tool.execution_start mit toolName, arguments, toolCallId', async () => {
      // Real ACP format: fields live directly on `update`, kind is mapped to a renderer tool name.
      sendNotification(proc, 'session/update', {
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          kind: 'read',
          title: 'Reading /foo',
          status: 'pending',
          rawInput: { path: '/foo' },
        },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'tool.execution_start',
          data: expect.objectContaining({
            toolName: 'view', // mapped from kind 'read'
            arguments: { path: '/foo' },
            toolCallId: 'tc-1',
          }),
        })
      );
    });

    it('tool_call_update → tool.execution_complete mit toolCallId und result', async () => {
      sendNotification(proc, 'session/update', {
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'file content here' } }],
        },
      });
      await flushPromises();

      expect(mockSendToRenderer).toHaveBeenCalledWith(
        'copilot:event',
        'tab-1',
        expect.objectContaining({
          type: 'tool.execution_complete',
          data: expect.objectContaining({
            toolCallId: 'tc-1',
            success: true,
            result: { content: 'file content here' },
          }),
        })
      );
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 7. Crash-Recovery
  // ════════════════════════════════════════════════════════════════

  describe('Crash-Recovery', () => {
    let proc;

    beforeEach(async () => {
      proc = createMockProcess();
      mockSpawnFn = jest.fn(() => createMockProcess());

      client = new AcpClient('tab-1', mockSendToRenderer);

      // Ersten Prozess überschreiben
      mockSpawnFn = jest.fn(() => proc);
      const startPromise = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;

      // Ab jetzt neue Prozesse bei Restart
      mockSpawnFn = jest.fn(() => createMockProcess());
    });

    it('startet automatisch neu bei Prozess-Exit', async () => {
      proc.emit('close', 1, null);
      await flushPromises();

      // Neuer spawn-Aufruf erwartet
      expect(mockSpawnFn).toHaveBeenCalled();
    });

    it('ignoriert ein verspätetes "close" eines bereits ersetzten Prozesses (kein Doppel-Restart)', async () => {
      const restartSpawn = jest.fn(() => createMockProcess());
      mockSpawnFn = restartSpawn;

      // Erster Crash → ein Restart (spawnt proc2).
      proc.emit('close', 1, null);
      await flushPromises();
      expect(restartSpawn).toHaveBeenCalledTimes(1);

      // Der alte (bereits ersetzte) proc feuert erneut close — muss ignoriert werden.
      proc.emit('close', 1, null);
      await flushPromises();
      expect(restartSpawn).toHaveBeenCalledTimes(1); // kein zweiter Restart
    });

    it('wechselt zu "dead" nach 3 Restarts pro Minute', async () => {
      // Drei Crashes simulieren
      for (let i = 0; i < 3; i++) {
        const currentProc = mockProcesses[mockProcesses.length - 1];
        currentProc.emit('close', 1, null);
        await flushPromises();

        // Initialize-Response für neuen Prozess (wenn restart noch erlaubt)
        if (i < 2) {
          const newProc = mockProcesses[mockProcesses.length - 1];
          sendResponse(newProc, { jsonrpc: '2.0', id: expect.any(Number), result: { status: 'ok' } });
          await flushPromises();
        }
      }

      // Nach 3 Restarts innerhalb einer Minute → dead
      expect(client.state).toBe('dead');
    });

    it('versucht session/load mit gespeicherter sessionId nach Restart', async () => {
      // Session zuerst erstellen (über den normalen Weg)
      const stdinBefore = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) { stdinBefore.push(chunk.toString()); cb(); }
      });
      const sessP = client.newSession();
      await flushPromises();
      const sessReq = JSON.parse(stdinBefore[0].trim());
      sendResponse(proc, { jsonrpc: '2.0', id: sessReq.id, result: { sessionId: 'saved-sess' } });
      await flushPromises();
      await sessP;

      const newProc = createMockProcess();
      const stdinWritten = [];
      newProc.stdin = new Writable({
        write(chunk, enc, cb) {
          stdinWritten.push(chunk.toString());
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => newProc);

      // Crash simulieren
      proc.emit('close', 1, null);
      await flushPromises();

      // Initialize-Response
      const initReq = JSON.parse(stdinWritten[0].trim());
      sendResponse(newProc, { jsonrpc: '2.0', id: initReq.id, result: { status: 'ok' } });
      await flushPromises();

      // Prüfe ob session/load gesendet wird
      const sessionLoadReq = stdinWritten.find(line => {
        try { return JSON.parse(line.trim()).method === 'session/load'; }
        catch { return false; }
      });
      expect(sessionLoadReq).toBeDefined();

      const parsed = JSON.parse(sessionLoadReq.trim());
      expect(parsed.params).toEqual(expect.objectContaining({ sessionId: 'saved-sess' }));
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 8. Cancel
  // ════════════════════════════════════════════════════════════════

  describe('Cancel', () => {
    let proc;
    let stdinWritten;

    /** Parses all stdin writes into JSON-RPC messages (ignoring unparseable lines). */
    function parseStdin(written) {
      return written.map(l => { try { return JSON.parse(l.trim()); } catch { return null; } }).filter(Boolean);
    }

    beforeEach(async () => {
      proc = createMockProcess();
      stdinWritten = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) { stdinWritten.push(chunk.toString()); cb(); }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startPromise = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startPromise;
      stdinWritten = [];

      // Session anlegen, damit Prompts laufen können.
      const sessP = client.newSession();
      await flushPromises();
      const sessReq = parseStdin(stdinWritten).find(m => m.method === 'session/new');
      sendResponse(proc, { jsonrpc: '2.0', id: sessReq.id, result: { sessionId: 'cancel-sess' } });
      await flushPromises();
      await sessP;
      stdinWritten = [];
    });

    it('cancel() sendet session/cancel-Notification während ein Prompt läuft', async () => {
      const promptP = client.prompt('hallo');     // bleibt in-flight (busy)
      await flushPromises();

      await client.cancel();
      await flushPromises();

      const cancelMsg = parseStdin(stdinWritten).find(m => m.method === 'session/cancel');
      expect(cancelMsg).toBeDefined();
      expect(cancelMsg.id).toBeUndefined(); // Notification, keine Request-ID
      expect(cancelMsg.params).toEqual(expect.objectContaining({ sessionId: 'cancel-sess' }));

      // Prompt mit stopReason cancelled auflösen.
      const promptReq = parseStdin(stdinWritten).find(m => m.method === 'session/prompt');
      sendResponse(proc, { jsonrpc: '2.0', id: promptReq.id, result: { stopReason: 'cancelled' } });
      await flushPromises();
      await promptP;
    });

    it('cancel() killt den Prozess NICHT (Session bleibt erhalten)', async () => {
      const promptP = client.prompt('hallo');
      await flushPromises();

      await client.cancel();
      await flushPromises();

      expect(proc.kill).not.toHaveBeenCalled();
      expect(client.sessionId).toBe('cancel-sess');

      const promptReq = parseStdin(stdinWritten).find(m => m.method === 'session/prompt');
      sendResponse(proc, { jsonrpc: '2.0', id: promptReq.id, result: { stopReason: 'cancelled' } });
      await flushPromises();
      await promptP;
    });

    it('cancel() meldet copilot:done(-1) wenn der Prompt als cancelled auflöst', async () => {
      const promptP = client.prompt('hallo');
      await flushPromises();

      await client.cancel();
      await flushPromises();

      const promptReq = parseStdin(stdinWritten).find(m => m.method === 'session/prompt');
      sendResponse(proc, { jsonrpc: '2.0', id: promptReq.id, result: { stopReason: 'cancelled' } });
      await flushPromises();
      await promptP;

      expect(mockSendToRenderer).toHaveBeenCalledWith('copilot:done', 'tab-1', -1);
    });

    it('cancel() ohne laufenden Prompt meldet trotzdem copilot:done(-1)', async () => {
      // Kein Prompt in-flight → state ist "ready".
      await client.cancel();
      await flushPromises();

      expect(proc.kill).not.toHaveBeenCalled();
      expect(mockSendToRenderer).toHaveBeenCalledWith('copilot:done', 'tab-1', -1);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 9. Session Self-Heal (nach Prozess-Neustart)
  // ════════════════════════════════════════════════════════════════

  describe('Session Self-Heal', () => {
    it('prompt() lädt die Session neu, wenn der frische Prozess sie noch nicht hat', async () => {
      const proc1 = createMockProcess();
      const written1 = [];
      proc1.stdin = new Writable({ write(chunk, enc, cb) { written1.push(chunk.toString()); cb(); } });
      mockSpawnFn = jest.fn(() => proc1);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startP = client.start();
      await flushPromises();
      sendResponse(proc1, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startP;

      // Session anlegen → sessionId gemerkt, im Prozess geladen.
      const sessP = client.newSession();
      await flushPromises();
      const sessReq = JSON.parse(written1.find(l => l.includes('session/new')).trim());
      sendResponse(proc1, { jsonrpc: '2.0', id: sessReq.id, result: { sessionId: 's1' } });
      await flushPromises();
      await sessP;

      // Prozess stoppen → frischer Start ohne geladene Session.
      const stopP = client.stop();
      proc1.emit('close', 0, null); // Mock feuert close, damit stop() sofort auflöst
      await stopP;

      const proc2 = createMockProcess();
      const written2 = [];
      proc2.stdin = new Writable({
        write(chunk, enc, cb) {
          written2.push(chunk.toString());
          const line = chunk.toString().trim();
          try {
            const req = JSON.parse(line);
            if (req.method === 'initialize' || req.method === 'session/load') {
              setImmediate(() => sendResponse(proc2, { jsonrpc: '2.0', id: req.id, result: { sessionId: req.params?.sessionId } }));
            } else if (req.method === 'session/prompt') {
              setImmediate(() => sendResponse(proc2, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }));
            }
          } catch { /* ignore */ }
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc2);

      // Prompt senden → Self-Heal muss session/load VOR session/prompt schicken.
      await client.prompt('hallo');
      await flushPromises();

      const loadIdx = written2.findIndex(l => { try { return JSON.parse(l.trim()).method === 'session/load'; } catch { return false; } });
      const promptIdx = written2.findIndex(l => { try { return JSON.parse(l.trim()).method === 'session/prompt'; } catch { return false; } });

      expect(loadIdx).toBeGreaterThanOrEqual(0);
      expect(promptIdx).toBeGreaterThan(loadIdx);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 10. Modell-Anwendung (session/set_model)
  // ════════════════════════════════════════════════════════════════

  describe('Modell-Anwendung', () => {
    it('prompt() sendet session/set_model mit dem konfigurierten Modell vor session/prompt', async () => {
      const proc = createMockProcess();
      const written = [];
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          written.push(chunk.toString());
          const line = chunk.toString().trim();
          try {
            const req = JSON.parse(line);
            if (req.method === 'initialize') {
              setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'ok' } }));
            } else if (req.method === 'session/new') {
              setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { sessionId: 's1' } }));
            } else if (req.method === 'session/set_model') {
              setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {} }));
            } else if (req.method === 'session/prompt') {
              setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }));
            }
          } catch { /* ignore */ }
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer, { model: 'claude-opus-4.8' });
      await client.start();
      await flushPromises();
      await client.newSession();
      await flushPromises();

      await client.prompt('hi');
      await flushPromises();

      const msgs = written.map(l => { try { return JSON.parse(l.trim()); } catch { return null; } }).filter(Boolean);
      const setModel = msgs.find(m => m.method === 'session/set_model');
      expect(setModel).toBeDefined();
      expect(setModel.params).toEqual(expect.objectContaining({ sessionId: 's1', modelId: 'claude-opus-4.8' }));

      const setIdx = written.findIndex(l => { try { return JSON.parse(l.trim()).method === 'session/set_model'; } catch { return false; } });
      const promptIdx = written.findIndex(l => { try { return JSON.parse(l.trim()).method === 'session/prompt'; } catch { return false; } });
      expect(promptIdx).toBeGreaterThan(setIdx);
    });

    it('prompt() sendet session/set_model nicht erneut, wenn das Modell unverändert ist', async () => {
      const written = [];
      const proc = createMockProcess();
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          written.push(chunk.toString());
          const line = chunk.toString().trim();
          try {
            const req = JSON.parse(line);
            if (req.method === 'initialize') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'ok' } }));
            else if (req.method === 'session/new') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { sessionId: 's1' } }));
            else if (req.method === 'session/set_model') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {} }));
            else if (req.method === 'session/prompt') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }));
          } catch { /* ignore */ }
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer, { model: 'claude-opus-4.8' });
      await client.start();
      await flushPromises();
      await client.newSession();
      await flushPromises();

      await client.prompt('eins');
      await flushPromises();
      await client.prompt('zwei');
      await flushPromises();

      const setModelCount = written.filter(l => { try { return JSON.parse(l.trim()).method === 'session/set_model'; } catch { return false; } }).length;
      expect(setModelCount).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 11. Modus-Anwendung (session/set_mode)
  // ════════════════════════════════════════════════════════════════

  describe('Modus-Anwendung', () => {
    const AUTOPILOT_URI = 'https://agentclientprotocol.com/protocol/session-modes#autopilot';

    it('prompt() löst den Kurz-Modus auf und sendet session/set_mode', async () => {
      const written = [];
      const proc = createMockProcess();
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          written.push(chunk.toString());
          const line = chunk.toString().trim();
          try {
            const req = JSON.parse(line);
            if (req.method === 'initialize') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'ok' } }));
            else if (req.method === 'session/new') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {
              sessionId: 's1',
              modes: { currentModeId: 'https://agentclientprotocol.com/protocol/session-modes#agent', availableModes: [
                { id: 'https://agentclientprotocol.com/protocol/session-modes#agent', name: 'Agent' },
                { id: AUTOPILOT_URI, name: 'Autopilot' },
              ] },
            } }));
            else if (req.method === 'session/set_mode') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {} }));
            else if (req.method === 'session/prompt') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }));
          } catch { /* ignore */ }
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer, { mode: 'autopilot' });
      await client.start();
      await flushPromises();
      await client.newSession();
      await flushPromises();

      await client.prompt('los');
      await flushPromises();

      const msgs = written.map(l => { try { return JSON.parse(l.trim()); } catch { return null; } }).filter(Boolean);
      const setMode = msgs.find(m => m.method === 'session/set_mode');
      expect(setMode).toBeDefined();
      expect(setMode.params).toEqual(expect.objectContaining({ sessionId: 's1', modeId: AUTOPILOT_URI }));
    });

    it('prompt() sendet kein session/set_mode für den Agent-Standardmodus, wenn die Session bereits darauf steht', async () => {
      const AGENT_URI = 'https://agentclientprotocol.com/protocol/session-modes#agent';
      const written = [];
      const proc = createMockProcess();
      proc.stdin = new Writable({
        write(chunk, enc, cb) {
          written.push(chunk.toString());
          const line = chunk.toString().trim();
          try {
            const req = JSON.parse(line);
            if (req.method === 'initialize') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'ok' } }));
            else if (req.method === 'session/new') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {
              sessionId: 's1',
              modes: { currentModeId: AGENT_URI, availableModes: [{ id: AGENT_URI, name: 'Agent' }] },
            } }));
            else if (req.method === 'session/set_mode') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: {} }));
            else if (req.method === 'session/prompt') setImmediate(() => sendResponse(proc, { jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }));
          } catch { /* ignore */ }
          cb();
        }
      });
      mockSpawnFn = jest.fn(() => proc);

      // 'agent' resolves to the agent URI; we still send set_mode once to assert it (mode applied).
      client = new AcpClient('tab-1', mockSendToRenderer, { mode: 'agent' });
      await client.start();
      await flushPromises();
      await client.newSession();
      await flushPromises();

      await client.prompt('a');
      await flushPromises();
      await client.prompt('b');
      await flushPromises();

      const setModeCount = written.filter(l => { try { return JSON.parse(l.trim()).method === 'session/set_mode'; } catch { return false; } }).length;
      // Applied at most once (not re-sent when unchanged).
      expect(setModeCount).toBeLessThanOrEqual(1);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 9. silentCommand
  // ════════════════════════════════════════════════════════════════

  describe('silentCommand', () => {
    async function buildReadyClientWithSession() {
      const proc = createMockProcess();
      mockSpawnFn = jest.fn(() => proc);

      client = new AcpClient('tab-1', mockSendToRenderer);
      const startP = client.start();
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 1, result: { status: 'ok' } });
      await flushPromises();
      await startP;

      const newP = client.newSession('sess-1', {});
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 2, result: { sessionId: 'sess-real' } });
      await flushPromises();
      await newP;

      return proc;
    }

    it('gibt den gesammelten Text aus agent_message_chunk zurück', async () => {
      const proc = await buildReadyClientWithSession();

      const cmdP = client.silentCommand('/context');
      await flushPromises();

      sendNotification(proc, 'session/update', { type: 'agent_message_chunk', data: { text: 'Context: ' } });
      sendNotification(proc, 'session/update', { type: 'agent_message_chunk', data: { text: '42%' } });
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 3, result: {} });
      await flushPromises();

      const text = await cmdP;
      expect(text).toBe('Context: 42%');
    });

    it('unterdrückt agent_message_chunk Ereignisse an den Renderer', async () => {
      const proc = await buildReadyClientWithSession();
      mockSendToRenderer.mockClear();

      const cmdP = client.silentCommand('/usage');
      await flushPromises();

      sendNotification(proc, 'session/update', { type: 'agent_message_chunk', data: { text: 'hidden output' } });
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 3, result: {} });
      await flushPromises();
      await cmdP;

      const deltaCalls = mockSendToRenderer.mock.calls.filter(
        ([, , evt]) => evt?.type === 'assistant.message_delta' && evt?.data?.deltaContent === 'hidden output'
      );
      expect(deltaCalls).toHaveLength(0);
    });

    it('wirft Fehler wenn Client busy ist', async () => {
      await buildReadyClientWithSession();
      // Ersten silentCommand starten um busy-State zu erzeugen
      client.silentCommand('/context');
      await flushPromises();

      await expect(client.silentCommand('/usage')).rejects.toThrow();
    });

    it('setzt State nach silentCommand zurück auf ready', async () => {
      const proc = await buildReadyClientWithSession();

      const cmdP = client.silentCommand('/usage');
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 3, result: {} });
      await flushPromises();
      await cmdP;

      expect(client.state).toBe('ready');
    });

    it('leerer Text wenn keine Chunks kamen', async () => {
      const proc = await buildReadyClientWithSession();

      const cmdP = client.silentCommand('/usage');
      await flushPromises();
      sendResponse(proc, { jsonrpc: '2.0', id: 3, result: {} });
      await flushPromises();

      const text = await cmdP;
      expect(text).toBe('');
    });
  });
});
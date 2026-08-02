'use strict';

/**
 * Tests für src/providers/api-agent-client.js — die Basisklasse aller
 * Direkt-API-Backends (agentische Tool-Schleife, Token-Buchhaltung,
 * Slash-Kommandos, Session-Persistenz).
 *
 * Getestet wird über eine Test-Subklasse, die alle Provider-Hooks mit Fakes
 * überschreibt — es gibt keine Netzwerkaufrufe und kein Provider-SDK.
 */

jest.mock('../src/providers/session-store');
jest.mock('../src/providers/agent-tools', () => {
  const actual = jest.requireActual('../src/providers/agent-tools');
  return { ...actual, executeTool: jest.fn(actual.executeTool) };
});

const store = require('../src/providers/session-store');
const { executeTool } = require('../src/providers/agent-tools');
const { ApiAgentClient, MAX_TOOL_ITERATIONS } = require('../src/providers/api-agent-client');

// ── Test-Subklasse ───────────────────────────────────────────────

class FakeBackend extends ApiAgentClient {
  constructor(tabId, send, options = {}) {
    super(tabId, send, options);
    this.history = [];
    this.turns = [];                                  // Skript pro Assistant-Turn
    this.defaultStep = { toolUses: [], usage: null };  // wenn das Skript leer ist
    this.streamCalls = 0;
    this.ctxWindow = 0;
    this.compacted = 0;
    this.ensureError = null;
    this.ensureCalls = 0;
    this.extras = {};
  }

  _ensureClient() { this.ensureCalls++; if (this.ensureError) throw this.ensureError; }
  _resetHistory() { this.history = []; }
  _pushUserText(text) { this.history.push({ role: 'user', text }); }

  async _streamAssistantTurn(ctx) {
    this.streamCalls++;
    const step = this.turns.shift() || this.defaultStep;
    if (typeof step === 'function') return await step.call(this, ctx);
    if (step.text) ctx.emit.text(step.text);
    if (step.reasoning) ctx.emit.reasoning(step.reasoning);
    if (step.throw) throw step.throw;
    this.history.push({ role: 'assistant', text: step.text || '' });
    return { toolUses: step.toolUses || [], usage: step.usage || null };
  }

  _pushToolResults(results) { this.history.push({ role: 'tool', results }); }
  _contextWindow() { return this.ctxWindow; }
  async _compact() { this.compacted++; }
  _serializeHistory() { return this.history; }
  _restoreHistory(arr) { this.history = arr.slice(); }
  _persistedExtras() { return this.extras; }
}

// ── Helfer ───────────────────────────────────────────────────────

function makeSend() {
  const calls = [];
  const fn = jest.fn((channel, tabId, payload) => calls.push({ channel, tabId, payload }));
  fn.calls = calls;
  fn.events = () => calls.filter(c => c.channel === 'copilot:event').map(c => c.payload);
  fn.types = () => fn.events().map(e => e.type);
  fn.done = () => calls.filter(c => c.channel === 'copilot:done');
  return fn;
}

function makeBackend(options = {}) {
  const send = makeSend();
  const b = new FakeBackend(7, send, { cwd: 'C:/projekt', model: 'fake-1', ...options });
  return { b, send };
}

let warnSpy;

beforeEach(() => {
  jest.clearAllMocks();
  store.load.mockReturnValue(null);
  executeTool.mockImplementation(jest.requireActual('../src/providers/agent-tools').executeTool);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ══════════════════════════════════════════════════════════════
// Lebenszyklus
// ══════════════════════════════════════════════════════════════

describe('Lebenszyklus', () => {
  test('startet im Zustand dead und wird nach start() ready', async () => {
    const { b } = makeBackend();
    expect(b.state).toBe('dead');
    await b.start();
    expect(b.state).toBe('ready');
    expect(b.ensureCalls).toBe(1);
  });

  test('start() propagiert einen fehlenden API-Key und bleibt dead', async () => {
    const { b } = makeBackend();
    b.ensureError = new Error('Kein API-Key');
    await expect(b.start()).rejects.toThrow('Kein API-Key');
    expect(b.state).toBe('dead');
  });

  test('Getter spiegeln Konstruktor-Argumente', () => {
    const { b } = makeBackend({ apiKey: 'geheim' });
    expect(b.tabId).toBe(7);
    expect(b.sessionId).toBeNull();
    expect(b.options.apiKey).toBe('geheim');
  });

  test('updateOptions führt die Optionen zusammen, statt sie zu ersetzen', () => {
    const { b } = makeBackend({ apiKey: 'k' });
    b.updateOptions({ model: 'fake-2' });
    expect(b.options).toMatchObject({ cwd: 'C:/projekt', apiKey: 'k', model: 'fake-2' });
  });

  test('destroy() setzt den Zustand auf dead', async () => {
    const { b } = makeBackend();
    await b.start();
    await b.destroy();
    expect(b.state).toBe('dead');
  });

  test('stop() und cancel() ohne laufenden Turn sind harmlos', async () => {
    const { b } = makeBackend();
    await expect(b.stop()).resolves.toBeUndefined();
    await expect(b.cancel()).resolves.toBeUndefined();
  });
});

describe('newSession', () => {
  test('vergibt eine api-Session-ID und meldet sie als result-Event', async () => {
    const { b, send } = makeBackend();
    const id = await b.newSession('C:/anderes');
    expect(id).toMatch(/^api-[0-9a-f-]{36}$/);
    expect(b.sessionId).toBe(id);
    const evt = send.events().find(e => e.type === 'result');
    expect(evt).toEqual({ type: 'result', sessionId: id });
    expect(send.calls[0].channel).toBe('copilot:event');
    expect(send.calls[0].tabId).toBe(7);
  });

  test('übernimmt das übergebene Arbeitsverzeichnis', async () => {
    const { b } = makeBackend();
    await b.newSession('C:/anderes');
    expect(b.options.cwd).toBe('C:/anderes');
  });

  test('ohne cwd bleibt das bisherige Arbeitsverzeichnis erhalten', async () => {
    const { b } = makeBackend();
    await b.newSession();
    expect(b.options.cwd).toBe('C:/projekt');
  });

  test('setzt Historie und Token-Zähler zurück', async () => {
    const { b } = makeBackend();
    b.history = [{ role: 'user', text: 'alt' }];
    b._tokens = { input: 5, output: 5, cache: 5, cacheWrite: 5 };
    b._lastContextTokens = 999;
    await b.newSession();
    expect(b.history).toEqual([]);
    expect(b._tokens).toEqual({ input: 0, output: 0, cache: 0, cacheWrite: 0 });
    expect(b._lastContextTokens).toBe(0);
  });

  test('zwei Sessions bekommen unterschiedliche IDs', async () => {
    const { b } = makeBackend();
    const a = await b.newSession();
    const c = await b.newSession();
    expect(a).not.toBe(c);
  });
});

describe('loadSession', () => {
  test('stellt die persistierte Historie wieder her', async () => {
    const messages = [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hallo' }];
    store.load.mockReturnValue({ messages });
    const { b } = makeBackend();
    const id = await b.loadSession('api-123', 'C:/wieder');
    expect(id).toBe('api-123');
    expect(b.sessionId).toBe('api-123');
    expect(b.options.cwd).toBe('C:/wieder');
    expect(b.history).toEqual(messages);
    expect(store.load).toHaveBeenCalledWith('api-123');
  });

  test('startet die Token-Zähler bewusst bei 0 (Renderer rechnet mit Deltas)', async () => {
    store.load.mockReturnValue({ messages: [], tokens: { input: 100, output: 50, cache: 0, cacheWrite: 0 }, lastContextTokens: 4711 });
    const { b } = makeBackend();
    await b.loadSession('api-123');
    expect(b._tokens).toEqual({ input: 0, output: 0, cache: 0, cacheWrite: 0 });
    expect(b._lastContextTokens).toBe(0);
  });

  test('ohne gespeicherte Daten bleibt die Historie leer', async () => {
    store.load.mockReturnValue(null);
    const { b } = makeBackend();
    b.history = [{ role: 'user', text: 'alt' }];
    await b.loadSession('api-123');
    expect(b.history).toEqual([]);
  });

  test('ignoriert Daten ohne messages-Array', async () => {
    store.load.mockReturnValue({ messages: 'kaputt' });
    const { b } = makeBackend();
    await b.loadSession('api-123');
    expect(b.history).toEqual([]);
  });

  test('ein Fehler des Session-Stores wird geloggt, aber nicht geworfen', async () => {
    store.load.mockImplementation(() => { throw new Error('Datei defekt'); });
    const { b } = makeBackend();
    await expect(b.loadSession('api-123')).resolves.toBe('api-123');
    expect(warnSpy).toHaveBeenCalledWith('[api-agent] loadSession restore failed:', 'Datei defekt');
  });
});

// ══════════════════════════════════════════════════════════════
// Slash-Kommandos
// ══════════════════════════════════════════════════════════════

describe('silentCommand: /usage', () => {
  test('liefert die vom Renderer geparste Token-Zeile', async () => {
    const { b } = makeBackend();
    b._tokens = { input: 1200, output: 50, cache: 7, cacheWrite: 300 };
    expect(await b.silentCommand('/usage')).toBe('Tokens: input 1200, output 50, cached 7, cachewrite 300');
  });

  test('meldet Nullen für eine frische Session', async () => {
    const { b } = makeBackend();
    expect(await b.silentCommand('/usage')).toBe('Tokens: input 0, output 0, cached 0, cachewrite 0');
  });

  test('toleriert Leerzeichen um das Kommando', async () => {
    const { b } = makeBackend();
    expect(await b.silentCommand('  /usage  ')).toContain('Tokens: input 0');
  });
});

describe('silentCommand: /clear', () => {
  test('leert die Historie und setzt alle Zähler zurück', async () => {
    const { b } = makeBackend();
    b.history = [{ role: 'user', text: 'alt' }];
    b._tokens = { input: 10, output: 20, cache: 30, cacheWrite: 40 };
    b._lastContextTokens = 5000;
    expect(await b.silentCommand('/clear')).toBe('Kontext gelöscht.');
    expect(b.history).toEqual([]);
    expect(b._tokens).toEqual({ input: 0, output: 0, cache: 0, cacheWrite: 0 });
    expect(b._lastContextTokens).toBe(0);
  });

  test('/usage meldet nach /clear wieder Nullen', async () => {
    const { b } = makeBackend();
    b._tokens = { input: 99, output: 99, cache: 99, cacheWrite: 99 };
    await b.silentCommand('/clear');
    expect(await b.silentCommand('/usage')).toBe('Tokens: input 0, output 0, cached 0, cachewrite 0');
  });
});

describe('silentCommand: /context', () => {
  test('rechnet den Verbrauch in Prozent des Kontextfensters um', async () => {
    const { b } = makeBackend();
    b.ctxWindow = 1_000_000;
    b._lastContextTokens = 250_000;
    const text = await b.silentCommand('/context');
    expect(text).toBe(`Kontext: ${(250_000).toLocaleString('de-DE')} / ${(1_000_000).toLocaleString('de-DE')} Tokens (25%)`);
  });

  test('rundet auf ganze Prozent', async () => {
    const { b } = makeBackend();
    b.ctxWindow = 200_000;
    b._lastContextTokens = 3_000; // 1,5 % → 2 %
    expect(await b.silentCommand('/context')).toMatch(/\(2%\)/);
  });

  test('deckelt bei 100 %, auch wenn das Fenster überschritten wurde', async () => {
    const { b } = makeBackend();
    b.ctxWindow = 100_000;
    b._lastContextTokens = 250_000;
    expect(await b.silentCommand('/context')).toMatch(/\(100%\)/);
  });

  test('Kontextfenster 0 ergibt 0 % statt NaN/Infinity (keine Division durch null)', async () => {
    const { b } = makeBackend();
    b.ctxWindow = 0;
    b._lastContextTokens = 5_000;
    const text = await b.silentCommand('/context');
    expect(text).toMatch(/\(0%\)/);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  test('unbekanntes Kontextfenster (undefined) ergibt ebenfalls 0 %', async () => {
    const { b } = makeBackend();
    b.ctxWindow = undefined;
    expect(await b.silentCommand('/context')).toBe('Kontext: 0 / 0 Tokens (0%)');
  });
});

describe('silentCommand: /compact', () => {
  test('verdichtet und persistiert, wenn kein Turn läuft', async () => {
    const { b } = makeBackend();
    await b.newSession();
    store.save.mockClear();
    expect(await b.silentCommand('/compact')).toBe('Kontext verdichtet.');
    expect(b.compacted).toBe(1);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  test('überspringt die Verdichtung während eines laufenden Turns', async () => {
    const { b } = makeBackend();
    let antwort = null;
    b.turns = [async function () {
      antwort = await this.silentCommand('/compact');
      return { toolUses: [], usage: null };
    }];
    await b.prompt('los');
    expect(antwort).toBe('Verdichtung übersprungen (Antwort läuft noch).');
    expect(b.compacted).toBe(0);
  });
});

describe('silentCommand: Unbekanntes', () => {
  test('unbekannte Kommandos liefern einen leeren String', async () => {
    const { b } = makeBackend();
    expect(await b.silentCommand('/gibtsnicht')).toBe('');
    expect(await b.silentCommand('')).toBe('');
    expect(await b.silentCommand(undefined)).toBe('');
    expect(await b.silentCommand(null)).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════
// Prompt: Ereignis-Vokabular
// ══════════════════════════════════════════════════════════════

describe('prompt: Renderer-Ereignisse', () => {
  test('hält das AcpClient-Vokabular für einen Turn ohne Tools ein', async () => {
    const { b, send } = makeBackend();
    b.turns = [{ text: 'Hallo Welt' }];
    await b.prompt('hi');
    expect(send.types()).toEqual(['assistant.turn_start', 'assistant.message_delta', 'assistant.turn_end']);
    expect(send.events()[1]).toEqual({ type: 'assistant.message_delta', data: { deltaContent: 'Hallo Welt' } });
    expect(send.done()).toEqual([{ channel: 'copilot:done', tabId: 7, payload: 0 }]);
  });

  test('reicht Reasoning-Deltas als eigenes Ereignis durch', async () => {
    const { b, send } = makeBackend();
    b.turns = [{ reasoning: 'denk denk', text: 'fertig' }];
    await b.prompt('hi');
    expect(send.events()).toContainEqual({ type: 'assistant.reasoning_delta', data: { deltaContent: 'denk denk' } });
  });

  test('alle Ereignisse laufen über copilot:event mit der richtigen tabId', async () => {
    const { b, send } = makeBackend();
    b.turns = [{ text: 'x' }];
    await b.prompt('hi');
    for (const c of send.calls) {
      expect(['copilot:event', 'copilot:done']).toContain(c.channel);
      expect(c.tabId).toBe(7);
    }
  });

  test('der Nutzertext landet vor dem ersten Stream in der Historie', async () => {
    const { b } = makeBackend();
    b.turns = [{ text: 'ok' }];
    await b.prompt('meine Frage');
    expect(b.history[0]).toEqual({ role: 'user', text: 'meine Frage' });
  });

  test('nach dem Turn ist der Zustand wieder ready', async () => {
    const { b } = makeBackend();
    b.turns = [{ text: 'ok' }];
    await b.prompt('hi');
    expect(b.state).toBe('ready');
  });
});

// ══════════════════════════════════════════════════════════════
// Prompt: Tool-Schleife
// ══════════════════════════════════════════════════════════════

describe('prompt: Tool-Schleife', () => {
  test('führt Tools aus, meldet Start/Ende und reicht die Ergebnisse weiter', async () => {
    const { b, send } = makeBackend();
    executeTool.mockResolvedValue({ ok: true, content: 'Datei-Inhalt' });
    b.turns = [
      { toolUses: [{ id: 'tu1', name: 'read_file', input: { path: 'a.txt' } }] },
      { text: 'fertig' },
    ];
    await b.prompt('lies a.txt');

    expect(send.types()).toEqual([
      'assistant.turn_start', 'tool.execution_start', 'tool.execution_complete',
      'assistant.message_delta', 'assistant.turn_end',
    ]);
    const [, start, complete] = send.events();
    expect(start.data).toEqual({ toolCallId: 'tu1', toolName: 'read_file', arguments: { path: 'a.txt' } });
    expect(complete.data).toEqual({
      toolCallId: 'tu1', toolName: 'read_file', success: true,
      result: { content: 'Datei-Inhalt' }, error: undefined,
    });
    expect(b.history).toContainEqual({ role: 'tool', results: [{ id: 'tu1', name: 'read_file', content: 'Datei-Inhalt', ok: true }] });
    expect(b.streamCalls).toBe(2);
  });

  test('übergibt cwd, Sperrliste und Signal an das Tool-Runtime', async () => {
    const { b } = makeBackend({ cwd: 'C:/arbeit', deniedTools: ['shell(git push)'] });
    executeTool.mockResolvedValue({ ok: true, content: 'ok' });
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'shell', input: { command: 'ls' } }] }, {}];
    await b.prompt('los');
    const [name, args, ctx] = executeTool.mock.calls[0];
    expect(name).toBe('shell');
    expect(args).toEqual({ command: 'ls' });
    expect(ctx.cwd).toBe('C:/arbeit');
    expect(ctx.deniedTools).toEqual(['shell(git push)']);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  test('ohne konfigurierte Sperrliste wird eine leere übergeben', async () => {
    const { b } = makeBackend();
    executeTool.mockResolvedValue({ ok: true, content: 'ok' });
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'shell', input: {} }] }, {}];
    await b.prompt('los');
    expect(executeTool.mock.calls[0][2].deniedTools).toEqual([]);
  });

  test('fehlendes input wird zu einem leeren Objekt', async () => {
    const { b, send } = makeBackend();
    executeTool.mockResolvedValue({ ok: true, content: 'ok' });
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'list_dir' }] }, {}];
    await b.prompt('los');
    expect(executeTool.mock.calls[0][1]).toEqual({});
    expect(send.events()[1].data.arguments).toEqual({});
  });

  test('gesperrte Shell-Befehle werden vom echten Tool-Runtime blockiert', async () => {
    const { b, send } = makeBackend({ deniedTools: ['shell(git push)'] });
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'shell', input: { command: 'git push --force' } }] }, {}];
    await b.prompt('push mal');
    const complete = send.events().find(e => e.type === 'tool.execution_complete');
    expect(complete.data.success).toBe(false);
    expect(complete.data.error).toBe('Befehl durch Tool-Sperrliste blockiert: git push --force');
  });

  test('fehlgeschlagene Tools melden success=false und den Fehlertext', async () => {
    const { b, send } = makeBackend();
    executeTool.mockResolvedValue({ ok: false, content: 'Datei fehlt.' });
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'read_file', input: {} }] }, {}];
    await b.prompt('los');
    const complete = send.events().find(e => e.type === 'tool.execution_complete');
    expect(complete.data.success).toBe(false);
    expect(complete.data.error).toBe('Datei fehlt.');
    expect(complete.data.result).toEqual({ content: 'Datei fehlt.' });
  });

  test('führt mehrere Tools eines Turns nacheinander aus und bündelt die Ergebnisse', async () => {
    const { b, send } = makeBackend();
    executeTool.mockImplementation(async (name) => ({ ok: true, content: `ergebnis:${name}` }));
    b.turns = [
      { toolUses: [
        { id: 'a', name: 'read_file', input: {} },
        { id: 'b', name: 'list_dir', input: {} },
      ] },
      {},
    ];
    await b.prompt('los');
    expect(send.types().filter(t => t === 'tool.execution_start')).toHaveLength(2);
    expect(send.types().filter(t => t === 'tool.execution_complete')).toHaveLength(2);
    const pushed = b.history.find(h => h.role === 'tool');
    expect(pushed.results.map(r => r.id)).toEqual(['a', 'b']);
    expect(b._pushToolResults.length).toBeDefined();
  });

  test('bricht nach MAX_TOOL_ITERATIONS ab und beendet den Turn regulär', async () => {
    const { b, send } = makeBackend();
    executeTool.mockResolvedValue({ ok: true, content: 'weiter' });
    b.defaultStep = { toolUses: [{ id: 'x', name: 'read_file', input: {} }] };
    await b.prompt('endlos');
    expect(b.streamCalls).toBe(MAX_TOOL_ITERATIONS);
    expect(executeTool).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
    expect(send.types()).toContain('assistant.turn_end');
    expect(send.done()[0].payload).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Prompt: Abbruch
// ══════════════════════════════════════════════════════════════

describe('prompt: Abbruch', () => {
  test('Abbruch vor dem ersten Stream beendet den Turn mit Code -1', async () => {
    const { b, send } = makeBackend();
    b._pushUserText = function (text) { this.history.push({ role: 'user', text }); this.cancel(); };
    await b.prompt('hi');
    expect(b.streamCalls).toBe(0);
    expect(send.done()[0].payload).toBe(-1);
    expect(send.types()).not.toContain('error');
    expect(send.types()).not.toContain('assistant.turn_end');
  });

  test('Abbruch während des Streams liefert dennoch für jedes Tool ein Ergebnis', async () => {
    const { b, send } = makeBackend();
    b.turns = [async function () {
      await this.cancel();
      return { toolUses: [{ id: 'tu1', name: 'read_file', input: {} }], usage: null };
    }];
    await b.prompt('los');

    const complete = send.events().find(e => e.type === 'tool.execution_complete');
    expect(complete.data.success).toBe(false);
    expect(complete.data.error).toBe('Abgebrochen.');
    expect(executeTool).not.toHaveBeenCalled();       // nach Abbruch wird nichts mehr ausgeführt
    expect(b.history).toContainEqual({ role: 'tool', results: [{ id: 'tu1', name: 'read_file', content: 'Abgebrochen.', ok: false }] });
    expect(send.done()[0].payload).toBe(-1);
    expect(send.types()).not.toContain('error');
  });

  test('jedes execution_start bekommt ein execution_complete, auch beim Abbruch', async () => {
    const { b, send } = makeBackend();
    b.turns = [async function () {
      await this.cancel();
      return { toolUses: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }], usage: null };
    }];
    await b.prompt('los');
    const starts = send.events().filter(e => e.type === 'tool.execution_start').map(e => e.data.toolCallId);
    const completes = send.events().filter(e => e.type === 'tool.execution_complete').map(e => e.data.toolCallId);
    expect(completes).toEqual(starts);
  });

  test('ein AbortError wird als Abbruch gewertet, nicht als Fehler', async () => {
    const { b, send } = makeBackend();
    const err = new Error('aborted');
    err.name = 'AbortError';
    b.turns = [{ throw: err }];
    await b.prompt('hi');
    expect(send.done()[0].payload).toBe(-1);
    expect(send.types()).not.toContain('error');
  });

  test('nach einem Abbruch ist der Zustand wieder ready', async () => {
    const { b } = makeBackend();
    b.turns = [{ throw: new Error('Cancelled') }];
    await b.prompt('hi');
    expect(b.state).toBe('ready');
  });
});

// ══════════════════════════════════════════════════════════════
// Prompt: Fehler
// ══════════════════════════════════════════════════════════════

describe('prompt: Fehlerbehandlung', () => {
  test('ein Streaming-Fehler wird als error-Ereignis und Code 1 gemeldet', async () => {
    const { b, send } = makeBackend();
    b.turns = [{ throw: new Error('429 rate limit') }];
    await b.prompt('hi');
    expect(send.events()).toContainEqual({ type: 'error', data: { message: '429 rate limit' } });
    expect(send.done()[0].payload).toBe(1);
    expect(send.types()).not.toContain('assistant.turn_end');
    expect(b.state).toBe('ready');
  });

  test('geworfene Nicht-Fehler-Werte werden in Text gewandelt', async () => {
    const { b, send } = makeBackend();
    b.turns = [async function () { throw 'kaputt'; }];
    await b.prompt('hi');
    const err = send.events().find(e => e.type === 'error');
    expect(err.data.message).toBe('kaputt');
  });

  test('ein Fehler im Tool-Runtime beendet den Turn mit Code 1', async () => {
    const { b, send } = makeBackend();
    executeTool.mockRejectedValue(new Error('Tool kaputt'));
    b.turns = [{ toolUses: [{ id: 'tu1', name: 'read_file', input: {} }] }];
    await b.prompt('hi');
    expect(send.done()[0].payload).toBe(1);
    expect(send.events().find(e => e.type === 'error').data.message).toBe('Tool kaputt');
  });
});

// ══════════════════════════════════════════════════════════════
// Token-Buchhaltung
// ══════════════════════════════════════════════════════════════

describe('Token-Buchhaltung', () => {
  test('summiert die Nutzung über mehrere Turns', async () => {
    const { b } = makeBackend();
    executeTool.mockResolvedValue({ ok: true, content: 'x' });
    b.turns = [
      { toolUses: [{ id: 'a', name: 'read_file', input: {} }], usage: { input: 100, output: 10, cache: 5, cacheWrite: 2 } },
      { usage: { input: 50, output: 20, cache: 1, cacheWrite: 0 } },
    ];
    await b.prompt('hi');
    expect(b._tokens).toEqual({ input: 150, output: 30, cache: 6, cacheWrite: 2 });
  });

  test('fehlende Teilwerte zählen als 0', async () => {
    const { b } = makeBackend();
    b.turns = [{ usage: { input: 7 } }];
    await b.prompt('hi');
    expect(b._tokens).toEqual({ input: 7, output: 0, cache: 0, cacheWrite: 0 });
  });

  test('fehlende Nutzungsdaten ändern die Zähler nicht', async () => {
    const { b } = makeBackend();
    b._tokens = { input: 3, output: 3, cache: 3, cacheWrite: 3 };
    b.turns = [{ usage: null }];
    await b.prompt('hi');
    expect(b._tokens).toEqual({ input: 3, output: 3, cache: 3, cacheWrite: 3 });
  });

  test('contextTokens setzt den Kontextverbrauch für /context', async () => {
    const { b } = makeBackend();
    b.ctxWindow = 200_000;
    b.turns = [{ usage: { input: 1, contextTokens: 20_000 } }];
    await b.prompt('hi');
    expect(b._lastContextTokens).toBe(20_000);
    expect(await b.silentCommand('/context')).toMatch(/\(10%\)/);
  });

  test('ohne contextTokens bleibt der letzte Wert bestehen', async () => {
    const { b } = makeBackend();
    b._lastContextTokens = 1234;
    b.turns = [{ usage: { input: 1 } }];
    await b.prompt('hi');
    expect(b._lastContextTokens).toBe(1234);
  });
});

// ══════════════════════════════════════════════════════════════
// Persistenz
// ══════════════════════════════════════════════════════════════

describe('Persistenz nach einem Turn', () => {
  test('speichert Modell, Tokens, Kontextgröße, Historie und Provider-Extras', async () => {
    const { b } = makeBackend({ model: 'fake-9' });
    await b.newSession();
    store.save.mockClear();
    b.extras = { geminiMode: 'files' };
    b.turns = [{ text: 'ok', usage: { input: 10, output: 2, contextTokens: 42 } }];
    await b.prompt('hi');

    expect(store.save).toHaveBeenCalledTimes(1);
    const [sessionId, payload] = store.save.mock.calls[0];
    expect(sessionId).toBe(b.sessionId);
    expect(payload).toEqual({
      model: 'fake-9',
      tokens: { input: 10, output: 2, cache: 0, cacheWrite: 0 },
      lastContextTokens: 42,
      messages: b.history,
      geminiMode: 'files',
    });
  });

  test('ohne Session-ID wird nichts gespeichert', async () => {
    const { b } = makeBackend();
    b.turns = [{ text: 'ok' }];
    await b.prompt('hi');
    expect(store.save).not.toHaveBeenCalled();
  });

  test('ein abgebrochener Turn wird nicht persistiert', async () => {
    const { b } = makeBackend();
    await b.newSession();
    store.save.mockClear();
    b.turns = [{ throw: new Error('Cancelled') }];
    await b.prompt('hi');
    expect(store.save).not.toHaveBeenCalled();
  });

  test('ein Fehler beim Speichern bricht den Turn nicht ab', async () => {
    const { b, send } = makeBackend();
    await b.newSession();
    store.save.mockImplementation(() => { throw new Error('Platte voll'); });
    b.turns = [{ text: 'ok' }];
    await b.prompt('hi');
    expect(send.done()[0].payload).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('[api-agent] persist failed:', 'Platte voll');
  });
});

// ══════════════════════════════════════════════════════════════
// Basisklassen-Hooks
// ══════════════════════════════════════════════════════════════

describe('Basisklassen-Hooks', () => {
  function bare() { return new ApiAgentClient(1, jest.fn()); }

  test('Pflicht-Hooks werfen, solange sie nicht überschrieben sind', async () => {
    const c = bare();
    expect(() => c._ensureClient()).toThrow('not implemented');
    expect(() => c._resetHistory()).toThrow('not implemented');
    expect(() => c._pushUserText('x')).toThrow('not implemented');
    expect(() => c._pushToolResults([])).toThrow('not implemented');
    await expect(c._streamAssistantTurn({})).rejects.toThrow('not implemented');
  });

  test('optionale Hooks haben harmlose Standardwerte', async () => {
    const c = bare();
    expect(c._contextWindow()).toBe(0);
    expect(c._serializeHistory()).toEqual([]);
    expect(c._persistedExtras()).toEqual({});
    expect(c._restoreHistory([{ role: 'user' }])).toBeUndefined();
    await expect(c._compact()).resolves.toBeUndefined();
  });

  test('MAX_TOOL_ITERATIONS ist exportiert und plausibel', () => {
    expect(MAX_TOOL_ITERATIONS).toBe(50);
  });

  test('Standardoptionen sind ein leeres Objekt', () => {
    expect(bare().options).toEqual({});
  });
});

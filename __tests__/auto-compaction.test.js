'use strict';

const { createAutoCompaction, getPolicy, validatePolicies, parseContextPercent, parseContextTokens, PROVIDERS } = require('../src/auto-compaction');
const { compactionCostWarning } = require('../src/auto-compaction-policy');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function harness(provider = 'copilot', settings = {}, priceThreshold = null) {
  const events = [];
  const log = jest.fn();
  const client = {
    __provider: provider,
    state: 'ready',
    silentCommand: jest.fn(async command => command === '/context' ? 'Kontext (50%)' : 'Kontext verdichtet.'),
  };
  let manager;
  const send = (channel, id, event) => {
    events.push({ channel, id, event });
    manager.observe(channel, id, event);
  };
  manager = createAutoCompaction({ getClient: () => client, getSettings: () => settings, send, log,
    getPriceThreshold: async () => priceThreshold });
  const event = (type, data) => send('agent:event', 7, { type, data });
  const done = (code = 0) => send('agent:done', 7, code);
  const prompt = (operation = async () => { done(); }) => manager.startPrompt(7, async started => {
    client.state = 'busy';
    started();
    const result = await operation();
    client.state = 'ready';
    return result;
  });
  const drain = () => manager.command(7, '/usage');
  const commands = () => client.silentCommand.mock.calls.map(([command]) => command).filter(c => c !== '/usage');
  return { manager, client, prompt, drain, commands, events, event, done, log };
}

describe('Provider-Policy', () => {
  test('Main-Koordinator verwendet denselben dynamischen Metadaten-Default wie die UI', async () => {
    const h = harness('copilot', {}, { known: true, threshold: 400000 });
    h.client.silentCommand.mockImplementation(async command => command === '/context'
      ? 'Context: 350000 / 1000000 tokens (35%)' : 'Kontext verdichtet.');
    await h.prompt();
    await h.drain();
    expect(h.commands()).toEqual(['/context', '/compact', '/context']);
  });
  test('preisbezogener Default, Modellregeln und Legacy-Migration ohne Überschreiben', () => {
    expect(getPolicy({}, 'copilot', 'gpt-6.1-sol', 272000)).toEqual({ enabled: true, mode: 'tokens', thresholdTokens: 240000 });
    expect(getPolicy({}, 'copilot', 'small', 100000).thresholdTokens).toBe(90000);
    const saved = { autoCompaction: { copilot: { enabled: false, thresholdPercent: 67,
      models: { sol: { mode: 'tokens', thresholdTokens: 400000 } } } } };
    expect(getPolicy(saved, 'copilot', 'sol', 272000)).toEqual({ enabled: false, mode: 'tokens', thresholdTokens: 400000 });
    expect(getPolicy(saved, 'copilot', 'other', 272000)).toEqual({ enabled: false, mode: 'tokens', thresholdTokens: 240000 });
    saved.autoCompaction.copilot.modelDefaults = true;
    expect(getPolicy(saved, 'copilot', 'other', 272000)).toEqual({ enabled: false, mode: 'tokens', thresholdTokens: 240000 });
  });
  test.each([
    ['Kontext: 240.000 / 922.000 Tokens (26%)', 240000, 922000],
    ['Context: 240,000 / 922,000 tokens', 240000, 922000],
    ['Context: 240k / 922k tokens', 240000, 922000],
    ['13.8k / 922k tokens', 13800, 922000],
    ['Kontext: 0 / 200000 Tokens', 0, 200000],
  ])('liest aktuelle Tokens %s', (text, used, size) => {
    expect(parseContextTokens(text)).toEqual({ used, size });
  });
  test('keine Summen oder unbekannte Fenster als aktuelle Tokens interpretieren', () => {
    expect(parseContextTokens('Total input: 9000000 tokens')).toBeNull();
    expect(parseContextTokens('0 / 0 tokens')).toBeNull();
  });
  test('Preiswarnung ist Hinweis, keine Cap; Prozent benötigt reales Fenster', () => {
    expect(compactionCostWarning({ enabled: true, mode: 'tokens', thresholdTokens: 272001 }, 272000)).toContain('Kosten können steigen');
    expect(compactionCostWarning({ enabled: true, mode: 'tokens', thresholdTokens: 272000 }, 272000)).toBe('');
    expect(compactionCostWarning({ enabled: true, thresholdPercent: 50 }, 272000, 922000)).toContain('Kosten können steigen');
    expect(compactionCostWarning({ enabled: true, thresholdPercent: 50 }, 272000, 272000)).toBe('');
  });
  test.each([
    { mode: 'tokens', thresholdTokens: 0 }, { mode: 'tokens', thresholdTokens: 1.5 },
    { mode: 'percent', thresholdPercent: 96 }, { mode: 'secret-cap', thresholdTokens: 240000 },
  ])('validiert Modellregel %j', rule => {
    expect(() => validatePolicies({ copilot: { enabled: true, thresholdPercent: 50, models: { sol: rule } } })).toThrow();
  });
  test.each(PROVIDERS)('%s ist standardmäßig aktiviert ab 50 Prozent', provider => {
    expect(getPolicy({}, provider)).toEqual({ enabled: true, thresholdPercent: 50 });
  });

  describe('sichtbare Tokenregeln', () => {
    test.each([239999, 240000, 300000])('Default löst bei %s aktuellen Tokens aus', async used => {
      const h = harness('copilot', {}, 272000);
      h.client.__model = 'sol';
      h.client.silentCommand.mockImplementation(async cmd => cmd === '/context' ? `Context: ${used} / 922000 tokens` : 'Verdichtet.');
      await h.prompt();
      await h.drain();
      expect(h.commands().includes('/compact')).toBe(used >= 240000);
    });
    test('oberhalb Preisgrenze bleibt der Userwert wirksam, keine interne Preis-Cap', async () => {
      const h = harness('copilot', { autoCompaction: { copilot: { enabled: true, thresholdPercent: 50,
        models: { sol: { mode: 'tokens', thresholdTokens: 500000 } } } } }, 272000);
      h.client.__model = 'sol';
      h.client.silentCommand.mockResolvedValue('Context: 400000 / 922000 tokens');
      await h.prompt();
      await h.drain();
      expect(h.commands()).toEqual(['/context']);
      expect(h.events.some(e => e.event?.data?.status === 'warning')).toBe(true);
    });
    test('fehlende Tokenmessung überspringt Tokenregel auch bei bekannten Prozenten', async () => {
      const h = harness('copilot', {}, 272000);
      h.client.silentCommand.mockResolvedValue('Context (80%)');
      await h.prompt();
      await h.drain();
      expect(h.commands()).toEqual(['/context']);
    });
  });
  test('bewahrt gespeicherte Werte', () => {
    expect(getPolicy({ autoCompaction: { copilot: { enabled: false, thresholdPercent: 65 } } }, 'copilot'))
      .toEqual({ enabled: false, thresholdPercent: 65 });
  });
  test.each([0, 96, -1, 50.1, '50', NaN, null])('weist ungültigen Wert %s ab', thresholdPercent => {
    expect(() => validatePolicies({ copilot: { enabled: true, thresholdPercent } })).toThrow(/1 bis 95/);
  });
  test.each([1, 50, 95])('akzeptiert %s', thresholdPercent => {
    expect(() => validatePolicies({ copilot: { enabled: false, thresholdPercent } })).not.toThrow();
  });
  test('weist ungültige Aktivierung und Provider ab', () => {
    expect(() => validatePolicies({ copilot: { enabled: 'true', thresholdPercent: 50 } })).toThrow();
    expect(() => validatePolicies({ unknown: { enabled: true, thresholdPercent: 50 } })).toThrow();
    expect(() => validatePolicies([])).toThrow();
  });
  test('liest Backend-Prozente, nicht Token-/Modellannahmen', () => {
    expect(parseContextPercent('Tokens: 272000')).toBeNull();
    expect(parseContextPercent('Auslastung unbekannt')).toBeNull();
    expect(parseContextPercent('Kontext (49.99%)')).toBe(49.99);
    expect(parseContextPercent('Kontext (50,5%)')).toBe(50.5);
    expect(parseContextPercent('(101%)')).toBeNull();
    expect(parseContextPercent('Context usage: 42%')).toBe(42);
  });
});

describe('Abschlusskoordination', () => {
  test.each(PROVIDERS)('%s verdichtet genau einmal nach vollem Antwortlauf', async provider => {
    const h = harness(provider);
    await h.prompt(async () => {
      h.event('tool.execution_start', { toolCallId: 't' });
      h.event('assistant.turn_end', {});
      h.done();
      h.done();
      expect(h.commands()).toEqual([]);
      h.event('tool.execution_complete', { toolCallId: 't', success: true });
    });
    await h.drain();
    expect(h.commands()).toEqual(['/context', '/compact', '/context']);
  });
  test('prüft erst nach Prompt-Promise, nicht bei frühem ACP done', async () => {
    const h = harness();
    const gate = deferred();
    await h.prompt(async () => { h.done(); await gate.promise; });
    await Promise.resolve();
    expect(h.commands()).toEqual([]);
    gate.resolve();
    await h.drain();
    expect(h.commands()).toContain('/compact');
  });
  test.each([49.99, 50, 95])('Schwelle >= 50 bei %s', async percent => {
    const h = harness();
    h.client.silentCommand.mockImplementation(async cmd => cmd === '/context' ? `Kontext (${percent}%)` : 'Verdichtet.');
    await h.prompt();
    await h.drain();
    expect(h.commands().includes('/compact')).toBe(percent >= 50);
  });
  test('deaktiviert bedeutet keine automatische Abfrage', async () => {
    const h = harness('copilot', { autoCompaction: { copilot: { enabled: false, thresholdPercent: 50 } } });
    await h.prompt();
    await h.drain();
    expect(h.commands()).toEqual([]);
  });
  test.each([-1, 1])('kein Compact bei done %s', async code => {
    const h = harness();
    await h.prompt(async () => h.done(code));
    await h.drain();
    expect(h.commands()).toEqual([]);
  });
  test.each([
    ['error', { message: 'kaputt' }],
    ['session.permission_request', {}],
    ['session.question', {}],
    ['tool.execution_start', { toolCallId: 'pending' }],
    ['tool.execution_complete', { success: false }],
    ['tool.execution_start', { toolName: 'ask_user', toolCallId: 'ask' }],
    ['assistant.message_delta', { deltaContent: 'Möchtest du fortfahren?' }],
  ])('kein Compact bei %s / Aufmerksamkeit', async (type, data) => {
    const h = harness();
    await h.prompt(async () => { h.event(type, data); h.done(); });
    await h.drain();
    expect(h.commands()).toEqual([]);
  });
  test('fehlende Auslastung ist expliziter Skip, keine feste Copilot-Fenstergröße', async () => {
    const h = harness();
    h.client.silentCommand.mockResolvedValue('Tokens: 500000, Modell gpt-5');
    await h.prompt();
    await h.drain();
    expect(h.commands()).toEqual(['/context']);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('Auslastung unbekannt'));
    expect(h.events.some(e => e.event?.data?.status === 'skipped')).toBe(true);
  });
  test('frische native usage_update Werte dienen als Backend-Auslastung', async () => {
    const h = harness('claude-code');
    h.client.silentCommand.mockImplementation(async cmd => cmd === '/context' ? 'Keine Prozentangabe' : 'Verdichtet.');
    await h.prompt(async () => { h.event('session.usage_update', { used: 100, size: 200 }); h.done(); });
    await h.drain();
    expect(h.commands()).toContain('/compact');
  });
  test('alte Usage oder kostenbezogene Fenster lösen keine Verdichtung aus', async () => {
    const h = harness();
    h.client.silentCommand.mockResolvedValue('');
    h.event('session.usage_update', { used: 200, size: 200 });
    await h.prompt(async () => { h.event('session.usage_update', { used: 200, size: 200, cost: { amount: 1 } }); h.done(); });
    await h.drain();
    expect(h.commands()).toEqual(['/context']);
  });
  test.each(['cancelled', 'max_tokens', 'refusal'])('unvollständige stopReason %s wird übersprungen', async stopReason => {
    const h = harness();
    await h.prompt(async () => { h.done(); return { stopReason }; });
    await h.drain();
    expect(h.commands()).toEqual([]);
  });
  test.each(['/context', '/compact', 'after'])('Fehler in %s sichtbar und ohne Retry', async stage => {
    const h = harness();
    let contexts = 0;
    h.client.silentCommand.mockImplementation(async command => {
      if (command === '/context') contexts++;
      if (command === stage || (stage === 'after' && command === '/context' && contexts === 2)) throw new Error('Backend kaputt');
      return command === '/context' ? '(80%)' : 'Verdichtet.';
    });
    await h.prompt();
    await h.drain();
    h.done();
    await h.drain();
    expect(h.events.filter(e => e.event?.data?.status === 'error')).toHaveLength(1);
    expect(h.commands().filter(c => c === '/compact').length).toBeLessThanOrEqual(1);
  });
  test.each(['', 'Verdichtung übersprungen', 'Unknown command /compact'])('keine Erfolgsaussage bei "%s"', async response => {
    const h = harness();
    h.client.silentCommand.mockImplementation(async command => command === '/context' ? '(70%)' : response);
    await h.prompt();
    await h.drain();
    expect(h.events.some(e => e.event?.data?.status === 'completed')).toBe(false);
    expect(h.events.some(e => e.event?.data?.status === 'error')).toBe(true);
  });
  test('neuer Prompt und stille Befehle warten auf Compact, keine Compact-Schleife', async () => {
    const h = harness();
    const gate = deferred();
    const compactStarted = deferred();
    h.client.silentCommand.mockImplementation(async command => {
      if (command === '/compact') {
        compactStarted.resolve();
        h.done(); // slash completion must not retrigger
        await gate.promise;
        return 'Verdichtet.';
      }
      return '(70%)';
    });
    await h.prompt();
    await compactStarted.promise;
    const next = jest.fn(async () => h.done(-1));
    const command = h.manager.command(7, '/clear');
    const prompt = h.prompt(next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    expect(h.commands()).toEqual(['/context', '/compact']);
    gate.resolve();
    await command;
    await prompt;
    await h.drain();
    expect(h.commands()).toEqual(['/context', '/compact', '/context', '/clear']);
    expect(next).toHaveBeenCalledTimes(1);
  });
  test('arbeitet ohne Renderer/Tab/Vordergrund und isoliert andere Sitzungen', async () => {
    const h = harness();
    const gate = deferred();
    await h.prompt(async () => { await gate.promise; h.done(); });
    await h.manager.command(8, '/context'); // independent session is not blocked
    expect(h.commands()).toEqual(['/context']);
    gate.resolve();
    await h.drain();
    expect(h.commands()).toEqual(['/context', '/context', '/compact', '/context']);
  });
  test('Setupfehler werden an IPC zurückgegeben und blockieren nächste Prompts nicht', async () => {
    const h = harness();
    await expect(h.manager.startPrompt(7, async () => { throw new Error('Setup kaputt'); })).rejects.toThrow('Setup kaputt');
    await h.prompt();
    await h.drain();
    expect(h.commands()).toContain('/compact');
  });
  test('Promptfehler nach dem Streaming-ACK sind sichtbar, kein Erfolg-fallback', async () => {
    const h = harness();
    await h.prompt(async () => { throw new Error('Prompt kaputt'); });
    await h.drain();
    expect(h.events.some(e => e.event?.type === 'error' && e.event.data.message === 'Prompt kaputt')).toBe(true);
    expect(h.events.some(e => e.channel === 'agent:done' && e.event === 1)).toBe(true);
    expect(h.commands()).toEqual([]);
  });
  test('Stop während Kontextprüfung verhindert Compact und storniert wartenden Prompt', async () => {
    const h = harness();
    const gate = deferred();
    const query = deferred();
    h.client.silentCommand.mockImplementation(async cmd => {
      if (cmd === '/context') { query.resolve(); await gate.promise; }
      return '(80%)';
    });
    await h.prompt();
    await query.promise;
    const next = jest.fn();
    const pending = h.prompt(next);
    const rejection = expect(pending).rejects.toThrow('Cancelled');
    h.manager.cancel(7);
    gate.resolve();
    await rejection;
    await h.drain();
    expect(next).not.toHaveBeenCalled();
    expect(h.commands()).toEqual(['/context']);
  });
  test('Stop während Setup verhindert Zulassung und Versand des Prompts', async () => {
    const h = harness();
    const gate = deferred();
    const setup = deferred();
    const actualPrompt = jest.fn();
    const pending = h.manager.startPrompt(7, async started => {
      setup.resolve();
      await gate.promise;
      started();
      actualPrompt();
    });
    const rejection = expect(pending).rejects.toThrow('Cancelled');
    await setup.promise;
    h.manager.cancel(7);
    gate.resolve();
    await rejection;
    expect(actualPrompt).not.toHaveBeenCalled();
  });
});

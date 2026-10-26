const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readCopilotUsage } = require('../src/copilot-usage');
const { visibleCostLog, reconcileCopilotCostLog, aggregateCostBySession, sessionTodayCost, localCostDay } = require('../src/renderer-logic');

const checkpoint = (totalNanoAiu, timestamp = '2026-10-09T20:29:57.492Z') =>
  JSON.stringify({ type: 'session.usage_checkpoint', timestamp, data: { totalNanoAiu } });

describe('Copilot CLI session usage', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(__dirname, 'copilot-usage-fixture-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  function write(lines) { fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n')); }

  test('uses the latest cumulative checkpoint, not a sum or token pricing', async () => {
    write([
      checkpoint(41_943_155_500, '2026-10-09T20:24:19.848Z'),
      JSON.stringify({ type: 'session.usage_record', data: { usage: { inputTokens: 5_312_271 } } }),
      checkpoint(56_927_473_000),
    ]);
    const usage = await readCopilotUsage(dir);
    expect(usage.aic).toBeCloseTo(56.927473, 8);
    expect(usage.usd).toBeCloseTo(0.56927473, 10);
    expect(usage.entries[1].usd).toBeCloseTo(0.149843175, 10);
    expect(usage.entries.reduce((s, e) => s + e.usd, 0)).toBeCloseTo(usage.usd, 10);
    expect(usage.asOf).toBe('2026-10-09T20:29:57.492Z');
  });

  test('duplicate checkpoints do not duplicate consumption', async () => {
    write([checkpoint(100_000_000_000), checkpoint(100_000_000_000)]);
    expect(await readCopilotUsage(dir)).toMatchObject({ aic: 100, usd: 1, entries: [{ usd: 1 }] });
  });

  test('zero is valid confirmed usage', async () => {
    write([checkpoint(0)]);
    expect(await readCopilotUsage(dir)).toMatchObject({ aic: 0, usd: 0, entries: [] });
  });

  test('a partially written final line retains the last confirmed checkpoint', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      write([checkpoint(1000), '{"type":"session.usage_checkpoint"']);
      expect(await readCopilotUsage(dir)).toMatchObject({ totalNanoAiu: 1000, incompleteTail: true });
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  test.each([-1, '123', 1.5, Number.MAX_SAFE_INTEGER + 1, null])('rejects invalid checkpoint amount %s', async total => {
    write([checkpoint(total)]);
    await expect(readCopilotUsage(dir)).rejects.toThrow('Ungültiger');
  });

  test('rejects decreasing totals instead of recharging historical usage', async () => {
    write([checkpoint(1000), checkpoint(500)]);
    await expect(readCopilotUsage(dir)).rejects.toThrow('rückläufig');
  });

  test('does not turn missing or malformed data into zero cost', async () => {
    await expect(readCopilotUsage(dir)).rejects.toThrow();
    write(['{"type":"session.start"}']);
    await expect(readCopilotUsage(dir)).rejects.toThrow('Kein CLI');
    write(['bad JSON', checkpoint(1000)]);
    await expect(readCopilotUsage(dir)).rejects.toThrow();
  });

  test('rejects an invalid timestamp', async () => {
    write([checkpoint(1000, 'bad date')]);
    await expect(readCopilotUsage(dir)).rejects.toThrow('Ungültiger');
  });

  const record = (amount, timestamp, id) => JSON.stringify({
    type: 'session.usage_record', timestamp,
    data: { usage: { copilotUsage: { totalNanoAiu: amount }, accounting: { usageId: id } } },
  });

  test('reconciled reported amounts preserve the first consumption after midnight', async () => {
    const now = new Date(2026, 9, 13, 12).getTime();
    const { startMs } = localCostDay(now);
    write([
      checkpoint(100_000_000_000, new Date(startMs - 3600000).toISOString()),
      record(20_000_000_000, new Date(startMs - 1000).toISOString(), 'before'),
      record(30_000_000_000, new Date(startMs + 1000).toISOString(), 'after'),
      checkpoint(150_000_000_000, new Date(startMs + 2000).toISOString()),
    ]);
    const usage = await readCopilotUsage(dir);
    expect(sessionTodayCost(usage.entries, null, 'copilot', now)).toMatchObject({ usd: 0.3, complete: true });
    expect(usage.usd).toBe(1.5);
    expect(usage.entries.reduce((sum, e) => sum + e.usd, 0)).toBe(1.5);
  });

  test('duplicates are deduplicated by CLI accounting identity', async () => {
    const event = record(100_000_000_000, '2026-10-09T20:29:56Z', 'one');
    write([event, event, checkpoint(100_000_000_000)]);
    expect((await readCopilotUsage(dir)).entries).toEqual([
      { ts: Date.parse('2026-10-09T20:29:56Z'), usd: 1, timing: 'reported' },
    ]);
  });

  test('missing or mismatching per-call amounts do not invent day attribution', async () => {
    const now = new Date(2026, 9, 13, 12).getTime();
    const { startMs } = localCostDay(now);
    write([
      checkpoint(100_000_000_000, new Date(startMs - 1000).toISOString()),
      record(1, new Date(startMs + 1000).toISOString(), 'incomplete'),
      checkpoint(150_000_000_000, new Date(startMs + 2000).toISOString()),
      checkpoint(160_000_000_000, new Date(startMs + 3000).toISOString()),
    ]);
    expect(sessionTodayCost((await readCopilotUsage(dir)).entries, null, 'copilot', now))
      .toMatchObject({ usd: 0.1, complete: false });
  });

  test('session start on the same day establishes a zero baseline without losing first usage', async () => {
    const now = new Date(2026, 9, 13, 12).getTime();
    const { startMs } = localCostDay(now);
    write([
      JSON.stringify({ type: 'session.start', timestamp: new Date(startMs).toISOString() }),
      checkpoint(100_000_000_000, new Date(startMs + 1000).toISOString()),
    ]);
    expect(sessionTodayCost((await readCopilotUsage(dir)).entries, null, 'copilot', now))
      .toMatchObject({ usd: 1, complete: true });
  });

  test('rejects reversed checkpoint timestamps', async () => {
    write([checkpoint(1, '2026-10-13T12:00:00Z'), checkpoint(2, '2026-10-13T11:00:00Z')]);
    await expect(readCopilotUsage(dir)).rejects.toThrow('Zeit ist rückläufig');
  });

  test('usage records not yet covered by a checkpoint are not silently confirmed', async () => {
    write([checkpoint(100_000_000_000),
      record(20_000_000_000, '2026-10-09T20:30:00Z', 'pending')]);
    const usage = await readCopilotUsage(dir);
    expect(usage.usd).toBe(1);
    expect(usage.pendingUsage).toEqual([{ ts: Date.parse('2026-10-09T20:30:00Z') }]);
  });
});

describe('confirmed Copilot cost history', () => {
  const old = { ts: 1, sessionId: 'session', usd: 23.78742, provider: 'copilot' };
  const api = { ts: 2, sessionId: 'session', usd: 0.2, provider: 'openai' };
  const other = { ts: 3, sessionId: 'other', usd: 1, provider: 'copilot' };
  const usage = { entries: [{ ts: 4, usd: 0.419431555 }, { ts: 5, usd: 0.149843175 }] };

  test('retains estimates in storage but excludes superseded values from the chart', () => {
    const log = reconcileCopilotCostLog([old, api, other], 'session', 'App', usage);
    expect(log).toContain(old);
    const visible = visibleCostLog(log);
    expect(visible).not.toContain(old);
    expect(visible).toContain(api);
    expect(visible).toContain(other);
    expect(aggregateCostBySession(visible).grand).toBeCloseTo(1.76927473, 10);
  });

  test('reading again, including after restart, is idempotent', () => {
    const first = reconcileCopilotCostLog([old], 'session', 'App', usage);
    expect(reconcileCopilotCostLog(first, 'session', 'App', usage)).toEqual(first);
  });

  test('reconciliation persists timing provenance across a preference roundtrip', () => {
    const history = { entries: [
      { ts: 4, usd: 1, fromTs: 1, timing: 'interval' },
      { ts: 5, usd: 0.2, timing: 'reported' },
    ] };
    const stored = JSON.parse(JSON.stringify(reconcileCopilotCostLog([], 'session', 'App', history)));
    expect(stored[0]).toMatchObject({ fromTs: 1, timing: 'interval' });
    expect(stored[1]).toMatchObject({ timing: 'reported' });
    expect(reconcileCopilotCostLog(stored, 'session', 'App', history)).toEqual(stored);
  });

  test('a confirmed zero total also supersedes estimates', () => {
    const log = reconcileCopilotCostLog([old], 'session', 'App', { entries: [] });
    expect(aggregateCostBySession(visibleCostLog(log)).grand).toBe(0);
  });
});

describe('session costs for the local calendar day', () => {
  const now = new Date(2026, 9, 13, 12).getTime();
  const { startMs, endMs } = localCostDay(now);

  test('includes midnight, excludes next midnight, and filters session/provider', () => {
    const entries = [
      { sessionId: 's', provider: 'openai', ts: startMs - 1, usd: 10 },
      { sessionId: 's', provider: 'openai', ts: startMs, usd: 1 },
      { sessionId: 's', provider: 'openai', ts: endMs - 1, usd: 2 },
      { sessionId: 's', provider: 'openai', ts: endMs, usd: 10 },
      { sessionId: 'other', provider: 'openai', ts: startMs, usd: 10 },
      { sessionId: 's', provider: 'anthropic', ts: startMs, usd: 10 },
    ];
    expect(sessionTodayCost(entries, 's', 'openai', now)).toMatchObject({ usd: 3, complete: true });
    expect(sessionTodayCost(entries, 's', 'openai', endMs)).toMatchObject({ usd: 10, complete: true });
  });

  test('historical Copilot totals rebooked today are not daily costs', () => {
    expect(sessionTodayCost([{ ts: startMs + 1, usd: 20 }], null, 'copilot', now))
      .toMatchObject({ usd: 0, complete: false });
  });

  test('an exact midnight checkpoint supplies a safe baseline', () => {
    expect(sessionTodayCost([{ ts: startMs + 1, fromTs: startMs, usd: 1, timing: 'interval' }], null, 'copilot', now))
      .toMatchObject({ usd: 1, complete: true });
  });

  test('unknown invalid entries cannot silently turn into zero', () => {
    expect(sessionTodayCost([{ ts: NaN, usd: 1 }], 's', 'openai', now).complete).toBe(true);
    expect(sessionTodayCost([{ sessionId: 's', provider: 'openai', ts: NaN, usd: 1 }], 's', 'openai', now).complete).toBe(false);
  });

  test('local calendar boundaries respect 23/25-hour DST days', () => {
    const { execFileSync } = require('child_process');
    const script = `
      const { localCostDay } = require('./src/renderer-logic');
      const dates = [new Date(2026, 2, 29, 12), new Date(2026, 9, 25, 12)];
      console.log(JSON.stringify(dates.map(d => {
        const p = localCostDay(d.getTime()); return (p.endMs - p.startMs) / 3600000;
      })));
    `;
    const result = execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: 'Europe/Berlin' }, encoding: 'utf8',
    });
    expect(JSON.parse(result)).toEqual([23, 25]);
  });
});

describe('Copilot renderer usage integration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const refresh = source.match(/^async function refreshUsageDisplay\b[\s\S]*?^\}/m)[0];
  const display = source.match(/^function updateUsageDisplay\b[\s\S]*?^\}/m)[0];

  function setup(usage) {
    const tab = { sessionId: 'session', _costUsd: 23.78742 };
    const element = {};
    const ctx = {
      tabs: new Map([[1, tab]]), activeTabId: 1, getTabProvider: () => 'copilot',
      window: { desktop: { chat: {
        copilotUsage: jest.fn().mockResolvedValue(usage), silentCommand: jest.fn(),
      } }, RendererLogic: { sessionTodayCost, localCostDay } },
      recordCopilotSessionCost: jest.fn(), updateUsageDisplay: jest.fn(),
      console: { warn: jest.fn() },
      document: { getElementById: () => element },
      formatUsd: v => '$' + v.toFixed(2),
    };
    return { tab, element, ctx, run: vm.runInNewContext(`(${refresh})`, ctx) };
  }

  test('replaces the old estimate with the session total without issuing /usage', async () => {
    const usage = { success: true, aic: 56.927473, usd: 0.56927473, asOf: '2026-10-09T20:29:57Z', entries: [] };
    const { tab, element, ctx, run } = setup(usage);
    await run(1);
    expect(tab._costUsd).toBe(usage.usd);
    expect(ctx.window.desktop.chat.silentCommand).not.toHaveBeenCalled();
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Heute: 0.00 AIC · $0.00');
    expect(element.title).toContain('Gesamt: 56.93 AIC · $0.57');
    expect(ctx.recordCopilotSessionCost).toHaveBeenCalledWith('session', null, usage);
  });

  test('failed reads show unavailable, not old estimates or zero', async () => {
    const { element, ctx, run } = setup({ success: false, error: 'Kein Checkpoint' });
    await run(1);
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Verbrauch nicht verfügbar');
    expect(element.title).toBe('Kein Checkpoint');
    expect(ctx.recordCopilotSessionCost).not.toHaveBeenCalled();
  });

  test('a late response does not affect a different session in the same tab', async () => {
    const { tab, ctx, run } = setup({ success: true, aic: 1, usd: 0.01, entries: [] });
    const pending = run(1);
    tab.sessionId = 'different-session';
    await pending;
    expect(ctx.recordCopilotSessionCost).not.toHaveBeenCalled();
  });

  test('a slower older read cannot overwrite a newer confirmed total', async () => {
    const { tab, ctx, run } = setup({ success: true, aic: 2, usd: 0.02, entries: [] });
    let finish;
    ctx.window.desktop.chat.copilotUsage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = run(1);
    await run(1);
    finish({ success: true, aic: 1, usd: 0.01, entries: [] });
    await first;
    expect(tab._costUsd).toBe(0.02);
    expect(ctx.recordCopilotSessionCost).toHaveBeenCalledTimes(1);
  });

  test('the previous session total is not displayed after a session change', async () => {
    const { tab, element, ctx, run } = setup({ success: true, aic: 2, usd: 0.02, entries: [] });
    await run(1);
    tab.sessionId = 'new-session';
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Verbrauch wird geladen …');
  });

  test('direct-API providers retain their existing token-delta accounting', async () => {
    const { tab, ctx, run } = setup({});
    Object.assign(ctx, {
      getTabProvider: () => 'openai',
      parseUsageRequests: () => null,
      parseUsageTokens: () => ({ input: 10, output: 2, cache: 0 }),
      estimateCostUsdDelta: jest.fn(() => 0.01),
      isSubscriptionProvider: () => false,
      recordCostEntry: jest.fn(),
    });
    ctx.window.desktop.chat.silentCommand.mockResolvedValue({ success: true, text: 'tokens' });
    await run(1);
    expect(ctx.window.desktop.chat.copilotUsage).not.toHaveBeenCalled();
    expect(ctx.window.desktop.chat.silentCommand).toHaveBeenCalledWith(1, '/usage');
    expect(ctx.recordCostEntry).toHaveBeenCalledWith('session', null, 0.01, 'openai');
    expect(tab._costUsd).toBeCloseTo(23.79742);
  });

  test('restore reads all checkpoints without charging historical costs as today', async () => {
    const { startMs } = localCostDay();
    const usage = { success: true, aic: 200, usd: 2, asOf: new Date(startMs + 1000).toISOString(),
      entries: [{ ts: startMs - 1, usd: 1 }, { ts: startMs + 1000, usd: 1, fromTs: startMs - 1, timing: 'interval' }] };
    const { element, ctx, run } = setup(usage);
    await run(1);
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Heute: Kosten nicht vollständig zuordenbar');
    expect(element.title).toContain('Gesamt: 200.00 AIC · $2.00');
  });

  test('pending current-day records prevent an incorrect confirmed zero', async () => {
    const { startMs } = localCostDay();
    const { element, ctx, run } = setup({ success: true, aic: 100, usd: 1,
      asOf: new Date(startMs - 1).toISOString(), entries: [],
      pendingUsage: [{ ts: startMs + 1 }] });
    await run(1);
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Heute: Kosten nicht vollständig zuordenbar');
  });

  test('API display uses persistent entries, not the tab total or currently selected model', () => {
    const { tab, element, ctx } = setup({});
    const { startMs } = localCostDay();
    tab.selectedModel = 'new-model';
    Object.assign(ctx, {
      getTabProvider: () => 'openai', getModelPricing: () => null,
      getCostLog: () => [
        { ts: startMs - 1, usd: 23, sessionId: 'session', provider: 'openai' },
        { ts: startMs, usd: 0.25, sessionId: 'session', provider: 'openai' },
      ],
    });
    vm.runInNewContext(`(${display})`, ctx)(null, null, null);
    expect(element.textContent).toBe('Heute: ~$0.25');
    expect(element.title).toContain('kein Preis verfügbar');
  });

  test('API usage delayed across a session change is not booked into the new session', async () => {
    const { tab, ctx, run } = setup({});
    ctx.getTabProvider = () => 'openai';
    ctx.parseUsageRequests = () => null;
    ctx.parseUsageTokens = () => null;
    ctx.recordCostEntry = jest.fn();
    ctx.window.desktop.chat.silentCommand.mockResolvedValue({ success: true, text: '' });
    const pending = run(1);
    tab.sessionId = 'new';
    await pending;
    expect(ctx.recordCostEntry).not.toHaveBeenCalled();
  });

  test('daily ticker schedules calendar midnight and refreshes on waking', () => {
    const ticker = source.match(/^function initSubscriptionUsageTicker\b[\s\S]*?^\}/m)[0];
    const { ctx } = setup({});
    ctx.isSubscriptionProvider = () => false;
    ctx.updateSubscriptionUsageDisplay = jest.fn();
    ctx.refreshUsageDisplay = jest.fn();
    ctx.SUBSCRIPTION_USAGE_TICK_MS = 30000;
    ctx.setInterval = jest.fn();
    ctx.setTimeout = jest.fn();
    ctx.clearTimeout = jest.fn();
    ctx.window.addEventListener = jest.fn();
    vm.runInNewContext(`(${ticker})`, ctx)();
    const delay = ctx.setTimeout.mock.calls[0][1];
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(localCostDay().endMs - Date.now() + 100);
    ctx.window.addEventListener.mock.calls[0][1]();
    expect(ctx.refreshUsageDisplay).toHaveBeenCalledWith(1);
    expect(ctx.updateUsageDisplay).toHaveBeenCalled();
  });
});

describe('Copilot usage IPC', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const registration = source.match(/ipcMain.handle\('sessions:copilotUsage',[\s\S]*?^\}\);/m)[0];

  function handler() {
    let call;
    const ctx = {
      ipcMain: { handle: (_name, fn) => { call = fn; } },
      safeSessionPath: jest.fn(id => path.join('sessions', id)),
      readCopilotUsage: jest.fn().mockResolvedValue({ aic: 100, usd: 1, entries: [] }),
      console: { warn: jest.fn() },
    };
    vm.runInNewContext(registration, ctx);
    return { call, ctx };
  }

  test('reads only the validated configured session path', async () => {
    const { call, ctx } = handler();
    expect(await call(null, 'session-id')).toMatchObject({ success: true, aic: 100, usd: 1 });
    expect(ctx.readCopilotUsage).toHaveBeenCalledWith(path.join('sessions', 'session-id'));
  });

  test.each(['..', '../private', 'C:\\private', '', null])('rejects invalid session ID %s', async id => {
    const { call, ctx } = handler();
    expect(await call(null, id)).toMatchObject({ success: false });
    expect(ctx.readCopilotUsage).not.toHaveBeenCalled();
    expect(ctx.console.warn).toHaveBeenCalled();
  });

  test('returns explicit reader errors instead of success-shaped defaults', async () => {
    const { call, ctx } = handler();
    ctx.readCopilotUsage.mockRejectedValue(new Error('Unsupported checkpoint'));
    expect(await call(null, 'session-id')).toEqual({ success: false, error: 'Unsupported checkpoint' });
  });
});

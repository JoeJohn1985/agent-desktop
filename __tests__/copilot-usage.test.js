const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { readCopilotUsage } = require('../src/copilot-usage');
const { visibleCostLog, reconcileCopilotCostLog, aggregateCostBySession } = require('../src/renderer-logic');

const checkpoint = (totalNanoAiu, timestamp = '2026-10-09T20:29:57.492Z') =>
  JSON.stringify({ type: 'session.usage_checkpoint', timestamp, data: { totalNanoAiu } });

describe('Copilot CLI session usage', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-usage-test-')); });
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
      expect((await readCopilotUsage(dir)).totalNanoAiu).toBe(1000);
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

  test('a confirmed zero total also supersedes estimates', () => {
    const log = reconcileCopilotCostLog([old], 'session', 'App', { entries: [] });
    expect(aggregateCostBySession(visibleCostLog(log)).grand).toBe(0);
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
      } } },
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
    expect(element.textContent).toBe('56.93 AIC · $0.57');
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

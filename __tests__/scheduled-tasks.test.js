const fs = require('fs');
const path = require('path');
const { ScheduledTasks, localEpoch, occurrence } = require('../src/scheduled-tasks');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false), readFileSync: jest.fn(), mkdirSync: jest.fn(),
  writeFileSync: jest.fn(), renameSync: jest.fn(), statSync: jest.fn(() => ({ isDirectory: () => true })),
}));

let clock;
let execute;
let scheduler;
const input = () => ({
  name: 'Aufgabe', prompt: 'Arbeite', cwd: path.resolve(__dirname), model: 'gpt-5',
  localTime: '2026-10-13T10:00', zone: 'Europe/Berlin', weeks: 3,
});
beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  clock = localEpoch('2026-10-12T10:00', 'Europe/Berlin');
  execute = jest.fn(async () => {});
  scheduler = new ScheduledTasks({ file: 'tasks.json', execute, now: () => clock });
});

test('maintains local time across DST and the original three-week grid', () => {
  const task = input();
  expect(new Date(occurrence(task, 0)).toISOString()).toBe('2026-10-13T08:00:00.000Z');
  expect(new Date(occurrence(task, 1)).toISOString()).toBe('2026-11-03T09:00:00.000Z');
  expect(() => localEpoch('2026-03-29T02:30', 'Europe/Berlin')).toThrow('existiert nicht');
  expect(() => localEpoch('2026-02-30T10:00', 'Europe/Berlin')).toThrow();
});

test('due task starts exactly once and tasks are serialized', async () => {
  const first = scheduler.upsert(input());
  scheduler.upsert({ ...input(), name: 'Zweite' });
  clock = first.nextAt;
  scheduler.lastTick = clock - 1000;
  scheduler.tick();
  scheduler.tick();
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(1);
  scheduler.finish(scheduler.state.runs[0].id, 'completed');
  scheduler.tick();
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(2);
});

test('wake bundles missed occurrences without running and catch-up requires confirmation', async () => {
  const task = scheduler.upsert(input());
  clock = localEpoch('2026-12-01T10:00', 'Europe/Berlin');
  scheduler.tick(true);
  expect(execute).not.toHaveBeenCalled();
  expect(task.missed).toBe(3);
  const next = task.nextAt;
  expect(() => scheduler.action(task.id, 'catchUp')).toThrow('bestätigt');
  scheduler.action(task.id, 'catchUp', true);
  expect(() => scheduler.action(task.id, 'catchUp', true)).toThrow();
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(task.nextAt).toBe(next);
  expect(task.missed).toBe(0);
});

test('one-off missed, paused and deleted tasks never auto-execute', () => {
  const task = scheduler.upsert({ ...input(), weeks: 0 });
  scheduler.action(task.id, 'pause');
  clock = task.nextAt;
  scheduler.tick(true);
  expect(task.nextAt).toBeNull();
  expect(task.missed).toBe(1);
  scheduler.action(task.id, 'delete');
  scheduler.tick();
  expect(execute).not.toHaveBeenCalled();
});

test('startup marks active runs interrupted and preserves history without restart', () => {
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify({ tasks: [], runs: [{ id: 'run', status: 'attention', tabId: 1, events: [] }] }));
  scheduler = new ScheduledTasks({ file: 'tasks.json', execute, now: () => clock });
  expect(scheduler.state.runs[0].status).toBe('interrupted');
  expect(scheduler.state.runs[0].tabId).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});

test('failure, permission attention, transcript and cancellation persist', async () => {
  const task = scheduler.upsert(input());
  clock = task.nextAt;
  scheduler.lastTick = clock;
  scheduler.tick();
  const run = scheduler.state.runs[0];
  await Promise.resolve();
  scheduler.event(run.id, { type: 'result', sessionId: 'session' });
  scheduler.attention(run.id);
  expect(run.status).toBe('attention');
  expect(run.sessionId).toBe('session');
  scheduler.finish(run.id, 'cancelled');
  expect(scheduler.busy).toBe(false);
  expect(fs.renameSync).toHaveBeenCalled();
  execute.mockRejectedValueOnce(new Error('Anmeldung fehlt'));
  clock = task.nextAt;
  scheduler.lastTick = clock;
  scheduler.tick();
  await new Promise(resolve => setImmediate(resolve));
  expect(scheduler.state.runs[1].status).toBe('error');
});

test('validates inputs and preserves existing cadence when editing content', () => {
  expect(() => scheduler.upsert({ ...input(), prompt: '' })).toThrow('Pflichtfeld');
  expect(() => scheduler.upsert({ ...input(), weeks: 1.5 })).toThrow('Wochen');
  expect(() => scheduler.upsert({ ...input(), zone: 'invalid' })).toThrow();
  const task = scheduler.upsert(input());
  const next = task.nextAt;
  scheduler.upsert({ ...task, prompt: 'Neuer Prompt' });
  expect(task.nextAt).toBe(next);
  expect(task.prompt).toBe('Neuer Prompt');
});

test('storage failure prevents launching external work', async () => {
  const task = scheduler.upsert(input());
  clock = task.nextAt;
  scheduler.lastTick = clock;
  fs.renameSync.mockImplementationOnce(() => { throw new Error('disk'); });
  expect(() => scheduler.tick()).toThrow('disk');
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
});

test('normal app shutdown persists interruption before backend teardown', async () => {
  const task = scheduler.upsert(input());
  clock = task.nextAt;
  scheduler.lastTick = clock;
  scheduler.tick();
  const run = scheduler.state.runs[0];
  scheduler.shutdown();
  scheduler.finish(run.id, 'error', 'Client destroyed');
  expect(run.status).toBe('interrupted');
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
});

test('startup never launches persisted overdue tasks and retains future weekly anchor', () => {
  const task = scheduler.upsert(input());
  const persisted = scheduler.snapshot();
  clock = localEpoch('2026-11-04T10:00', 'Europe/Berlin');
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(persisted));
  const restarted = new ScheduledTasks({ file: 'tasks.json', execute, now: () => clock });
  expect(restarted.state.tasks[0].missed).toBe(2);
  expect(restarted.state.tasks[0].nextAt).toBe(occurrence(task, 2));
  expect(execute).not.toHaveBeenCalled();
});

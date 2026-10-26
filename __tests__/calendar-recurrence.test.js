const fs = require('fs');
const path = require('path');
const { ScheduledTasks, nextOccurrence, localEpoch, localParts, validateRecurrence, occurrence } = require('../src/scheduled-tasks');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false), readFileSync: jest.fn(), mkdirSync: jest.fn(),
  writeFileSync: jest.fn(), renameSync: jest.fn(), statSync: jest.fn(() => ({ isDirectory: () => true })),
}));

const zone = 'Europe/Berlin';
const task = (localTime, recurrence) => ({ localTime, recurrence, zone });
const next = (item, after) => localParts(nextOccurrence(item, after && localEpoch(after, zone)), zone);
const monthly = { type: 'monthly', interval: 1, days: [31] };
let clock;
let scheduler;
const input = recurrence => ({
  name: 'Kalender', prompt: 'Test', cwd: path.resolve(__dirname), model: 'copilot',
  localTime: '2026-10-20T10:00', zone, recurrence,
});
beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  clock = localEpoch('2026-10-16T10:00', zone);
  scheduler = new ScheduledTasks({ file: 'calendar.json', now: () => clock, execute: jest.fn() });
});

test('daily weekdays respect the start lower bound and exclusive advancement', () => {
  const item = task('2026-10-17T10:00', { type: 'daily', weekdays: [1, 3, 5] });
  expect(next(item)).toBe('2026-10-19T10:00');
  expect(next(item, '2026-10-19T10:00')).toBe('2026-10-21T10:00');
  expect(next(item, '2026-10-21T09:59')).toBe('2026-10-21T10:00');
});

test('weekly multiple weekdays stay on the start Monday grid across year boundaries', () => {
  const item = task('2026-12-30T10:00', { type: 'weekly', interval: 3, weekdays: [1, 5] });
  expect(next(item)).toBe('2027-01-01T10:00');
  expect(next(item, '2027-01-01T10:00')).toBe('2027-01-18T10:00');
});

test('month days skip invalid dates without moving the anchor; last day is deduplicated', () => {
  const item = task('2026-01-31T10:00', monthly);
  expect(next(item, '2026-01-31T10:00')).toBe('2026-03-31T10:00');
  expect(next(task('2026-01-31T10:00', { ...monthly, interval: 2 }), '2026-03-31T10:00')).toBe('2026-05-31T10:00');
  const last = task('2028-01-01T10:00', { ...monthly, days: [31, 'last'] });
  expect(next(last, '2028-01-31T10:00')).toBe('2028-02-29T10:00');
  expect(next(last, '2028-02-29T10:00')).toBe('2028-03-31T10:00');
  expect(next(last, '2028-03-31T10:00')).toBe('2028-04-30T10:00');
});

test('yearly leap days obey interval and Gregorian century rules', () => {
  const rule = { type: 'yearly', interval: 1, months: [2], days: [29] };
  expect(next(task('2096-02-29T10:00', rule), '2096-02-29T10:00')).toBe('2104-02-29T10:00');
  expect(next(task('2028-01-01T10:00', { ...rule, interval: 3 }), '2028-02-29T10:00')).toBe('2040-02-29T10:00');
  expect(next(task('2026-05-20T10:00', { ...rule, months: [1, 6, 12], days: [1, 15] }))).toBe('2026-06-01T10:00');
});

test.each(['monthly', 'yearly'])('saving a date-derived %s replacement persists it and recalculates the next occurrence', type => {
  const old = scheduler.upsert(input({ type, interval: 1, days: [15, 'last'],
    ...(type === 'yearly' ? { months: [2, 5] } : {}) }));
  const recurrence = { type, interval: 1, days: [29], ...(type === 'yearly' ? { months: [2] } : {}) };
  const saved = scheduler.upsert({ ...old, localTime: '2028-02-29T10:00', recurrence });
  expect(saved.recurrence).toEqual(recurrence);
  expect(localParts(saved.nextAt, zone)).toBe('2028-02-29T10:00');
  expect(next(saved, '2028-02-29T10:00')).toBe(type === 'yearly' ? '2032-02-29T10:00' : '2028-03-29T10:00');
  const persisted = JSON.parse(fs.writeFileSync.mock.calls.at(-1)[1]);
  expect(persisted.tasks[0].recurrence).toEqual(recurrence);
});

test('DST gaps shift only the occurrence and autumn folds never duplicate runs', () => {
  const item = task('2026-03-28T02:30', { type: 'daily', weekdays: [1, 2, 3, 4, 5, 6, 7] });
  expect(next(item, '2026-03-28T02:30')).toBe('2026-03-29T03:30');
  expect(next(item, '2026-03-29T03:30')).toBe('2026-03-30T02:30');
  const fold = task('2026-10-24T02:30', item.recurrence);
  const at = nextOccurrence(fold, localEpoch('2026-10-24T02:30', zone));
  expect(localParts(at, zone)).toBe('2026-10-25T02:30');
  expect(localParts(nextOccurrence(fold, at), zone)).toBe('2026-10-26T02:30');
});

test.each([
  { type: 'weekly', interval: 0, weekdays: [1] },
  { type: 'monthly', interval: 1.5, days: [1] },
  { type: 'daily', weekdays: [] },
  { type: 'daily', weekdays: [8] },
  { type: 'yearly', interval: 1, months: [13], days: [1] },
  { type: 'monthly', interval: 1, days: [0] },
  { type: 'monthly', interval: 1, days: ['31'] },
])('rejects malformed calendar rules: %j', rule => {
  expect(() => validateRecurrence(rule)).toThrow();
});

test('impossible annual dates fail before persistence', () => {
  expect(() => scheduler.upsert(input({ type: 'yearly', interval: 1, months: [2], days: [30] }))).toThrow('Folgetermin');
  expect(scheduler.state.tasks).toHaveLength(0);
});

test('legacy weekly tasks retain cursor, exact future dates, pause and missed counters on editing and restart', () => {
  const old = scheduler.upsert({ ...input(undefined), weeks: 3 });
  scheduler.action(old.id, 'pause');
  clock = localEpoch('2026-11-15T10:00', zone);
  scheduler.tick(true);
  const before = scheduler.snapshot().tasks[0];
  const edited = scheduler.upsert({ ...old, recurrence: { type: 'weekly', interval: 3, weekdays: [2] }, prompt: 'Bearbeitet' });
  expect(edited).toMatchObject({ nextAt: before.nextAt, index: before.index, missed: before.missed, paused: true, weeks: 3 });
  expect(edited.recurrence).toBeUndefined();
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(scheduler.snapshot()));
  const restored = new ScheduledTasks({ file: 'calendar.json', now: () => clock, execute: jest.fn() });
  expect(restored.state.tasks[0]).toEqual(edited);
  expect(edited.nextAt).toBe(occurrence(edited, edited.index));
});

test('calendar persistence, overdue counting and explicit catch-up keep regular schedule', async () => {
  const saved = scheduler.upsert(input({ type: 'daily', weekdays: [1, 2, 3, 4, 5] }));
  const state = scheduler.snapshot();
  clock = localEpoch('2026-10-26T11:00', zone);
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(state));
  const execute = jest.fn();
  scheduler = new ScheduledTasks({ file: 'calendar.json', now: () => clock, execute });
  const restored = scheduler.state.tasks[0];
  expect(restored.recurrence).toEqual(saved.recurrence);
  expect(restored.missed).toBe(5);
  expect(localParts(restored.nextAt, zone)).toBe('2026-10-27T10:00');
  expect(execute).not.toHaveBeenCalled();
  const at = restored.nextAt;
  expect(() => scheduler.action(restored.id, 'catchUp')).toThrow('bestätigt');
  scheduler.action(restored.id, 'catchUp', true);
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(restored.nextAt).toBe(at);
  expect(restored.missed).toBe(0);
});

test('changing recurrence resets the cursor; content-only changes preserve it', () => {
  const saved = scheduler.upsert(input({ type: 'monthly', interval: 1, days: [31] }));
  expect(localParts(saved.nextAt, zone)).toBe('2026-10-31T10:00');
  clock = saved.nextAt;
  scheduler.tick(true);
  const at = saved.nextAt;
  scheduler.upsert({ ...saved, name: 'Neuer Name' });
  expect(saved.nextAt).toBe(at);
  expect(() => scheduler.upsert({ ...saved, recurrence: { ...monthly, days: [1] } })).toThrow('Zukunft');
});

test('legacy one-off cursor is preserved even after the start date has passed', () => {
  const saved = scheduler.upsert({ ...input(undefined), weeks: 0 });
  clock = saved.nextAt;
  scheduler.tick(true);
  scheduler.upsert({ ...saved, recurrence: { type: 'once' }, prompt: 'Edit' });
  expect(saved.nextAt).toBeNull();
  expect(saved.missed).toBe(1);
  expect(saved.recurrence).toBeUndefined();
});

test('paused calendar tasks count missed dates without launching; one-off terminates', () => {
  const saved = scheduler.upsert(input({ type: 'daily', weekdays: [2, 4] }));
  scheduler.action(saved.id, 'pause');
  clock = localEpoch('2026-10-23T10:00', zone);
  scheduler.lastTick = clock;
  scheduler.tick();
  expect(saved.missed).toBe(2);
  expect(localParts(saved.nextAt, zone)).toBe('2026-10-27T10:00');
  expect(scheduler.state.runs).toHaveLength(0);
  const once = scheduler.upsert({ ...input({ type: 'once' }), localTime: '2026-10-24T10:00' });
  clock = once.nextAt;
  scheduler.tick(true);
  expect(once.nextAt).toBeNull();
});

test('legacy API edits cannot leave a stale structured rule behind', () => {
  const saved = scheduler.upsert(input(monthly));
  scheduler.upsert({ ...saved, recurrence: undefined, weeks: 2 });
  expect(saved.recurrence).toEqual({ type: 'weekly', interval: 2, weekdays: [2] });
  expect(localParts(saved.nextAt, zone)).toBe('2026-10-20T10:00');
});

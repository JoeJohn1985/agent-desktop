const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const nodes = new Map();
  const node = () => ({
    children: [], value: '', textContent: '', appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }, setAttribute() {},
  });
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const fields = Object.fromEntries(['id', 'name', 'prompt', 'cwd', 'model', 'localTime', 'zone', 'repeat'].map(key => [key, node()]));
  const form = get('scheduledForm');
  form.elements = { namedItem: key => fields[key] };
  form.reset = () => { Object.values(fields).forEach(field => { field.value = ''; }); fields.repeat.value = 'once'; };
  const inputs = () => {
    const walk = item => [item, ...item.children.flatMap(walk)];
    return walk(get('scheduledRecurrence')).filter(item => item.name);
  };
  class FormDataMock {
    constructor() {
      this.entries = Object.entries(fields).map(([key, field]) => [key, field.value]);
      for (const input of inputs()) if (input.type !== 'checkbox' || input.checked) this.entries.push([input.name, String(input.value)]);
    }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    has(key) { return this.entries.some(([name]) => name === key); }
    getAll(key) { return this.entries.filter(([name]) => name === key).map(([, value]) => value); }
  }
  const scheduled = {
    list: jest.fn(async () => ({ tasks: [], runs: [] })),
    save: jest.fn(async () => {}), on: jest.fn(), action: jest.fn(async () => {}),
  };
  const context = vm.createContext({
    document: { getElementById: get, createElement: node, createTextNode: text => ({ ...node(), textContent: text }) },
    window: { scheduled }, Intl, Date, FormData: FormDataMock, tabs: new Map(),
    getModelsForProvider: () => [], confirm: () => true,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'scheduled-tasks.js'), 'utf8'), context);
  return { context, fields, get, form, inputs, scheduled };
}

test('all recurrence modes replace irrelevant fields; defaults and fieldset legends are accessible', () => {
  const { fields, inputs, get } = setup();
  expect(inputs()).toHaveLength(0);
  for (const [type, expected] of [
    ['daily', ['weekdays']], ['weekly', ['interval', 'weekdays']],
    ['monthly', ['interval']], ['yearly', ['interval']], ['once', []],
  ]) {
    fields.repeat.value = type;
    fields.repeat.onchange();
    expect([...new Set(inputs().map(input => input.name))]).toEqual(expected);
    if (type === 'daily') expect(inputs().filter(input => input.checked)).toHaveLength(7);
    for (const fieldset of get('scheduledRecurrence').children.filter(child => !child.name && child.children[0]?.textContent === 'Wochentage')) {
      expect(fieldset.children[0].textContent).toBe('Wochentage');
      expect(fieldset.children[1].children[0].type).toBe('checkbox');
    }
  }
});

test.each(['monthly', 'yearly'])('submit derives %s rule from the latest local date and preserves hidden zone', async type => {
  const { fields, form, inputs, scheduled } = setup();
  fields.zone.value = 'America/New_York';
  fields.localTime.value = '2028-01-31T23:30';
  fields.repeat.value = type;
  fields.repeat.onchange();
  for (const input of inputs()) {
    if (input.name === 'interval') input.value = '3';
  }
  fields.localTime.value = '2028-02-29T23:30';
  await form.onsubmit({ preventDefault() {} });
  expect(scheduled.save).toHaveBeenCalledWith(expect.objectContaining({
    zone: 'America/New_York', recurrence: { type, interval: 3, days: [29], ...(type === 'yearly' ? { months: [2] } : {}) },
  }));
  expect(scheduled.save.mock.calls[0][0].days).toBeUndefined();
  expect(fields.repeat.value).toBe('once');
  expect(inputs()).toHaveLength(0);
});

test.each(['monthly', 'yearly'])('opening complex %s rules preserves stored data until explicit save', async type => {
  const { context, scheduled, get, form, fields } = setup();
  const recurrence = { type, interval: 2, days: [15, 'last'], ...(type === 'yearly' ? { months: [2, 5] } : {}) };
  const task = { id: 'complex', name: 'Alt', prompt: 'Test', model: 'copilot', cwd: 'C:\\Projekt',
    localTime: '2028-01-31T10:00', zone: 'Europe/Berlin', recurrence, nextAt: 1800000000000, missed: 0 };
  const before = JSON.stringify(task);
  scheduled.list.mockResolvedValue({ tasks: [task], runs: [] });
  await context.renderScheduledTasks();
  await get('scheduledList').children[0].children[2].children[0].onclick();
  expect(scheduled.save).not.toHaveBeenCalled();
  expect(JSON.stringify(task)).toBe(before);
  expect(get('scheduledRecurrence').children[1].textContent).toContain('erst beim Speichern ersetzt');
  fields.localTime.value = '2028-04-30T10:00';
  await form.onsubmit({ preventDefault() {} });
  expect(scheduled.save).toHaveBeenCalledWith(expect.objectContaining({
    recurrence: { type, interval: 2, days: [30], ...(type === 'yearly' ? { months: [4] } : {}) },
  }));
  expect(JSON.stringify(task)).toBe(before);
});

test('legacy weekly editing supplies original weekday and interval; new rule descriptions omit timezone', async () => {
  const { context, scheduled, get, fields, inputs } = setup();
  const task = {
    id: 'old', name: 'Alt', prompt: 'Test', model: 'copilot', cwd: 'C:\\Projekt',
    localTime: '2026-10-20T10:00', zone: 'America/New_York', weeks: 3, nextAt: 1800000000000, missed: 0,
  };
  scheduled.list.mockResolvedValue({ tasks: [task], runs: [] });
  await context.renderScheduledTasks();
  const card = get('scheduledList').children[0];
  expect(card.children[1].textContent).toContain('alle 3 Wochen · Di');
  expect(card.children[1].textContent).not.toContain(task.zone);
  await card.children[2].children[0].onclick();
  expect(fields.repeat.value).toBe('weekly');
  expect(fields.zone.value).toBe(task.zone);
  expect(inputs().find(input => input.name === 'interval').value).toBe(3);
  expect(inputs().filter(input => input.checked).map(input => input.value)).toEqual(['2']);
  expect(context.describeScheduledRule({ recurrence: { type: 'monthly', interval: 2, days: [31, 'last'] } })).toContain('alle 2 Monate · 31., letzter Tag');
});

test('HTML retains only a hidden timezone field and exposes recurrence selector', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  expect(html).toContain('<input name="zone" type="hidden">');
  expect(html).toMatch(/name="repeat" aria-controls="scheduledRecurrence"/);
  expect(html).not.toContain('name="weeks"');
});

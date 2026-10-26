const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function localParts(epoch, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(epoch);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function localEpoch(local, zone) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) throw new Error('Ungültiges Datum/Uhrzeit.');
  const target = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(target)) throw new Error('Ungültiges Datum.');
  let epoch = target;
  for (let i = 0; i < 5; i++) {
    const formatted = localParts(epoch, zone);
    if (formatted === local) return epoch;
    epoch += target - Date.parse(`${formatted}:00Z`);
  }
  throw new Error('Diese lokale Uhrzeit existiert nicht (Sommerzeit).');
}

function occurrence(task, index) {
  const day = new Date(Date.parse(`${task.localTime}:00Z`));
  day.setUTCDate(day.getUTCDate() + index * task.weeks * 7);
  const local = day.toISOString().slice(0, 16);
  // A missing DST hour uses the next existing hour for this occurrence only.
  try { return localEpoch(local, task.zone); } catch (error) {
    if (!task.weeks) throw error;
    day.setUTCHours(day.getUTCHours() + 1);
    return localEpoch(day.toISOString().slice(0, 16), task.zone);
  }
}

function recurrenceRule(task) {
  if (task.recurrence) return validateRecurrence(task.recurrence);
  if (!Number.isInteger(task.weeks) || task.weeks < 0 || task.weeks > 520) throw new Error('Wiederholung: 0 oder 1–520 Wochen.');
  return task.weeks ? { type: 'weekly', interval: task.weeks,
    weekdays: [new Date(`${task.localTime}:00Z`).getUTCDay() || 7] } : { type: 'once' };
}

function validateRecurrence(rule) {
  if (!rule || !['once', 'daily', 'weekly', 'monthly', 'yearly'].includes(rule.type)) throw new Error('Ungültige Wiederholung.');
  const result = { type: rule.type };
  if (rule.type === 'once') return result;
  if (rule.type !== 'daily') {
    if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 520) throw new Error('Intervall: 1–520.');
    result.interval = rule.interval;
  }
  const selection = (key, max, last = false) => {
    const values = rule[key];
    if (!Array.isArray(values) || !values.length || values.some(v => !(Number.isInteger(v) && v >= 1 && v <= max) && !(last && v === 'last'))) throw new Error(`Ungültige Auswahl: ${key}`);
    result[key] = [...new Set(values)].sort((a, b) => a === 'last' ? 1 : b === 'last' ? -1 : a - b);
  };
  if (['daily', 'weekly'].includes(rule.type)) selection('weekdays', 7);
  else {
    if (rule.type === 'yearly') selection('months', 12);
    selection('days', 31, true);
  }
  return result;
}

// Calendar periods are anchored to the start, never to the last executed run.
function nextOccurrence(task, after = -Infinity) {
  const rule = recurrenceRule(task);
  const start = new Date(`${task.localTime}:00Z`);
  const lower = localEpoch(task.localTime, task.zone);
  if (rule.type === 'once') return lower > after ? lower : null;
  const threshold = Number.isFinite(after) ? new Date(`${localParts(after, task.zone)}:00Z`) : start;
  const base = new Date(start);
  base.setUTCHours(0, 0, 0, 0);
  if (rule.type === 'weekly') base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const interval = rule.interval || 1;
  let period = 0;
  if (rule.type === 'daily' || rule.type === 'weekly') period = Math.max(0, Math.floor((threshold - base) / (86400000 * (rule.type === 'weekly' ? 7 * interval : 1))) - 1);
  if (rule.type === 'monthly') period = Math.max(0, Math.floor(((threshold.getUTCFullYear() - start.getUTCFullYear()) * 12 + threshold.getUTCMonth() - start.getUTCMonth()) / interval) - 1);
  if (rule.type === 'yearly') period = Math.max(0, Math.floor((threshold.getUTCFullYear() - start.getUTCFullYear()) / interval) - 1);
  // Gregorian calendars repeat after 400 years, including leap-day validity.
  const limit = { daily: 9, weekly: 4, monthly: 4802, yearly: 402 }[rule.type];
  for (let attempts = 0; attempts < limit; attempts++, period++) {
    const candidates = [];
    if (['daily', 'weekly'].includes(rule.type)) {
      const days = rule.type === 'weekly' ? rule.weekdays.map(d => period * interval * 7 + d - 1) : [period];
      for (const offset of days) {
        const date = new Date(base);
        date.setUTCDate(date.getUTCDate() + offset);
        if (rule.weekdays.includes(date.getUTCDay() || 7)) candidates.push(date);
      }
    } else {
      const year = start.getUTCFullYear() + (rule.type === 'yearly' ? period * interval : 0);
      const months = rule.type === 'yearly' ? rule.months.map(m => m - 1) : [start.getUTCMonth() + period * interval];
      for (const month of months) {
        const first = new Date(Date.UTC(year, month, 1));
        const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        for (const day of rule.days) {
          if (day !== 'last' && day > last) continue;
          candidates.push(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day === 'last' ? last : day)));
        }
      }
    }
    const epochs = candidates.map(date => {
      date.setUTCHours(start.getUTCHours(), start.getUTCMinutes());
      const local = date.toISOString().slice(0, 16);
      try { return localEpoch(local, task.zone); } catch {
        date.setUTCHours(date.getUTCHours() + 1);
        return localEpoch(date.toISOString().slice(0, 16), task.zone);
      }
    }).filter(epoch => epoch >= lower && epoch > after);
    if (epochs.length) return Math.min(...epochs);
  }
  throw new Error('Kein gültiger Folgetermin gefunden.');
}

class ScheduledTasks {
  constructor({ file, execute, notify = () => {}, now = Date.now }) {
    Object.assign(this, { file, execute, notify, now });
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { tasks: [], runs: [] };
    this.busy = false;
    this.lastTick = now();
    for (const run of this.state.runs) {
      delete run.tabId;
      if (['running', 'attention'].includes(run.status)) {
        run.status = 'interrupted';
        run.endedAt = now();
      }
    }
    this.save();
    this.tick(true);
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.new`, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(`${this.file}.new`, this.file);
    this.notify(this.snapshot());
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  upsert(input) {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Aufgabe.');
    for (const key of ['name', 'prompt', 'cwd', 'model', 'localTime', 'zone']) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`Pflichtfeld: ${key}`);
    }
    if (!path.isAbsolute(input.cwd) || !fs.statSync(input.cwd).isDirectory()) throw new Error('Ungültiger Projektordner.');
    const recurrence = recurrenceRule(input);
    const epoch = localEpoch(input.localTime, input.zone);
    const previous = this.state.tasks.find(t => t.id === input.id);
    if (input.id && !previous) throw new Error('Aufgabe nicht gefunden.');
    if (!previous && epoch <= this.now()) throw new Error('Der erste Termin muss in der Zukunft liegen.');
    const changed = !previous || ['localTime', 'zone'].some(k => previous[k] !== input[k]) ||
      JSON.stringify(recurrenceRule(previous)) !== JSON.stringify(recurrence);
    if (changed && epoch <= this.now()) throw new Error('Der neue Termin muss in der Zukunft liegen.');
    const task = {
      id: previous?.id || randomUUID(), name: input.name.trim(), prompt: input.prompt,
      cwd: input.cwd, model: input.model, localTime: input.localTime, zone: input.zone,
      weeks: recurrence.type === 'weekly' ? recurrence.interval : 0, paused: previous?.paused || false,
      index: changed ? 0 : previous.index, missed: changed ? 0 : previous.missed,
      nextAt: changed ? epoch : previous.nextAt,
    };
    if (previous?.recurrence || (input.recurrence && changed)) task.recurrence = recurrence;
    if (changed && task.recurrence) task.nextAt = nextOccurrence(task);
    if (previous) Object.assign(previous, task); else this.state.tasks.push(task);
    this.save();
    return task;
  }

  action(id, action, confirmed = false) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw new Error('Aufgabe nicht gefunden.');
    if (action === 'delete') this.state.tasks = this.state.tasks.filter(t => t.id !== id);
    else if (action === 'pause') task.paused = !task.paused;
    else if (action === 'catchUp') {
      if (confirmed !== true) throw new Error('Nachholen muss ausdrücklich bestätigt werden.');
      if (!task.missed || this.busy || this.state.runs.some(r => r.taskId === id && ['running', 'attention'].includes(r.status))) throw new Error('Kein Nachholen möglich; ggf. läuft bereits eine Aufgabe.');
      this.launch(task, true);
      return;
    } else throw new Error('Unbekannte Aktion.');
    this.save();
  }

  advance(task) {
    if (task.recurrence) { task.nextAt = nextOccurrence(task, task.nextAt); task.index++; }
    else if (!task.weeks) task.nextAt = null;
    else task.nextAt = occurrence(task, ++task.index);
  }

  tick(missedOnly = false) {
    if (this.stopped) return;
    const now = this.now();
    missedOnly ||= now - this.lastTick > 60000;
    this.lastTick = now;
    let changed = false;
    for (const task of [...this.state.tasks].sort((a, b) => a.nextAt - b.nextAt)) {
      if (task.nextAt === null || task.nextAt > now) continue;
      if (!missedOnly && !task.paused && !this.busy) {
        this.launch(task, false);
        changed = true;
      } else if (!missedOnly && !task.paused && this.busy) {
        continue; // Due tasks stay queued while another task runs.
      } else {
        do { task.missed++; this.advance(task); } while (task.nextAt !== null && task.nextAt <= now);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  launch(task, catchUp) {
    this.busy = true;
    const run = { id: randomUUID(), taskId: task.id, name: task.name, cwd: task.cwd,
      model: task.model, prompt: task.prompt, scheduledAt: task.nextAt,
      startedAt: this.now(), status: 'running', catchUp, events: [] };
    if (catchUp) task.missed = 0; else this.advance(task);
    this.state.runs.push(run);
    try { this.save(); } catch (error) { this.busy = false; throw error; }
    Promise.resolve().then(() => {
      if (!this.stopped) return this.execute(run);
    }).catch(error => this.finish(run.id, 'error', error.message));
  }

  event(runId, event) {
    const run = this.state.runs.find(r => r.id === runId);
    if (!run) return;
    run.events.push(event);
    if (event.type === 'session.auto_compaction' && event.data?.status === 'error') {
      run.needsAttention = true;
      run.autoCompactionError = event.data.message;
    }
    if (event.type === 'result') run.sessionId = event.sessionId;
    this.save();
  }

  attention(runId) {
    const run = this.state.runs.find(r => r.id === runId);
    if (run && run.status === 'running') { run.status = 'attention'; run.needsAttention = true; this.save(); }
  }

  shutdown() {
    this.stopped = true;
    for (const run of this.state.runs) {
      if (['running', 'attention'].includes(run.status)) {
        run.status = 'interrupted';
        run.endedAt = this.now();
      }
    }
    this.save();
  }

  finish(runId, status, error) {
    const run = this.state.runs.find(r => r.id === runId);
    if (!run || !['running', 'attention'].includes(run.status)) return;
    Object.assign(run, { status, error, endedAt: this.now() });
    this.busy = false;
    this.save();
  }
}

module.exports = { ScheduledTasks, localEpoch, occurrence, localParts, nextOccurrence, recurrenceRule, validateRecurrence };

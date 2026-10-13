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
    if (!Number.isInteger(input.weeks) || input.weeks < 0 || input.weeks > 520) throw new Error('Wiederholung: 0 oder 1–520 Wochen.');
    const epoch = localEpoch(input.localTime, input.zone);
    const previous = this.state.tasks.find(t => t.id === input.id);
    if (input.id && !previous) throw new Error('Aufgabe nicht gefunden.');
    if (!previous && epoch <= this.now()) throw new Error('Der erste Termin muss in der Zukunft liegen.');
    const changed = !previous || ['localTime', 'zone', 'weeks'].some(k => previous[k] !== input[k]);
    if (changed && epoch <= this.now()) throw new Error('Der neue Termin muss in der Zukunft liegen.');
    const task = {
      id: previous?.id || randomUUID(), name: input.name.trim(), prompt: input.prompt,
      cwd: input.cwd, model: input.model, localTime: input.localTime, zone: input.zone,
      weeks: input.weeks, paused: previous?.paused || false,
      index: changed ? 0 : previous.index, missed: changed ? 0 : previous.missed,
      nextAt: changed ? epoch : previous.nextAt,
    };
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
    if (!task.weeks) task.nextAt = null;
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

module.exports = { ScheduledTasks, localEpoch, occurrence, localParts };

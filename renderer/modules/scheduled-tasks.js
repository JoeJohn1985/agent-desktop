'use strict';

let scheduledState = { tasks: [], runs: [] };
const scheduledForm = document.getElementById('scheduledForm');
const scheduledFields = scheduledForm.elements;
const scheduledLabels = { running: 'Läuft', attention: 'Eingriff erforderlich',
  completed: 'Beendet (fachlich ungeprüft)', error: 'Fehler', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
const scheduledWeekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const scheduledMonths = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function scheduledRule(task) {
  return task.recurrence || (task.weeks ? { type: 'weekly', interval: task.weeks,
    weekdays: [new Date(`${task.localTime}:00Z`).getUTCDay() || 7] } : { type: 'once' });
}

function describeScheduledRule(task) {
  const rule = scheduledRule(task);
  const days = rule.days?.map(d => d === 'last' ? 'letzter Tag' : `${d}.`).join(', ');
  switch (rule.type) {
    case 'daily': return `täglich · ${rule.weekdays.map(d => scheduledWeekdays[d - 1]).join(', ')}`;
    case 'weekly': return `alle ${rule.interval} Wochen · ${rule.weekdays.map(d => scheduledWeekdays[d - 1]).join(', ')}`;
    case 'monthly': return `alle ${rule.interval} Monate · ${days}`;
    case 'yearly': return `alle ${rule.interval} Jahre · ${rule.months.map(m => scheduledMonths[m - 1]).join(', ')} · ${days}`;
    default: return 'einmalig';
  }
}

function drawScheduledRecurrence(rule = { type: scheduledFields.namedItem('repeat').value }) {
  const container = document.getElementById('scheduledRecurrence');
  container.replaceChildren();
  if (rule.type === 'once') return;
  if (rule.type !== 'daily') {
    const label = document.createElement('label');
    label.className = 'settings__label';
    label.textContent = `Alle N ${ { weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre' }[rule.type]}`;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', name: 'interval', min: '1', max: '520', value: rule.interval || 1, required: true, className: 'settings__input' });
    label.appendChild(input);
    container.appendChild(label);
  }
  const choices = (name, legend, labels, selected) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'scheduled-recurrence__choices';
    const title = document.createElement('legend');
    title.textContent = legend;
    fieldset.appendChild(title);
    labels.forEach((text, index) => {
      const value = text === 'Letzter Tag' ? 'last' : index + 1;
      const label = document.createElement('label');
      const input = document.createElement('input');
      Object.assign(input, { type: 'checkbox', name, value: String(value), checked: selected.includes(value) });
      label.appendChild(input);
      label.appendChild(document.createTextNode(text));
      fieldset.appendChild(label);
    });
    container.appendChild(fieldset);
  };
  if (['daily', 'weekly'].includes(rule.type)) choices('weekdays', 'Wochentage', scheduledWeekdays, rule.weekdays || (rule.type === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [new Date(`${scheduledFields.namedItem('localTime').value || '2026-01-05T10:00'}:00Z`).getUTCDay() || 7]));
  else {
    const hint = document.createElement('p');
    hint.className = 'settings__hint';
    hint.textContent = rule.type === 'yearly'
      ? 'Monat und Tag werden beim Speichern aus Datum/Uhrzeit übernommen. Fehlende Kalendertage werden übersprungen.'
      : 'Der Tag wird beim Speichern aus Datum/Uhrzeit übernommen. Fehlende Kalendertage werden übersprungen.';
    if (rule.days) hint.textContent += ' Eine bisher abweichende Regel (mehrere Tage/Monate oder letzter Tag) wird erst beim Speichern ersetzt.';
    container.appendChild(hint);
  }
}
scheduledFields.namedItem('repeat').onchange = () => drawScheduledRecurrence();

function scheduledError(error) {
  document.getElementById('scheduledError').textContent = error?.message || String(error);
}

function resetScheduledForm() {
  scheduledForm.reset();
  scheduledFields.namedItem('id').value = '';
  scheduledFields.namedItem('zone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  drawScheduledRecurrence();
}

async function renderScheduledTasks() {
  try {
    scheduledState = await window.scheduled.list();
    const modelSelect = scheduledFields.namedItem('model');
    const selected = modelSelect.value;
    modelSelect.replaceChildren();
    for (const model of getModelsForProvider('copilot')) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      modelSelect.appendChild(option);
    }
    if (selected) modelSelect.value = selected;
    drawScheduledTasks();
  } catch (error) { scheduledError(error); }
}

function drawScheduledTasks() {
  const list = document.getElementById('scheduledList');
  list.replaceChildren();
  if (!scheduledState.tasks.length) {
    const empty = document.createElement('p');
    empty.className = 'settings__hint scheduled-view__empty';
    empty.textContent = 'Noch keine geplanten Aufgaben. Lege mit dem Formular eine neue Aufgabe an.';
    list.appendChild(empty);
  }
  const missed = scheduledState.tasks.reduce((sum, task) => sum + task.missed, 0);
  document.getElementById('scheduledBadge').textContent = missed ? `⚠ ${missed} verpasst` : '';
  document.getElementById('scheduledReminder').textContent = missed ? `⚠ ${missed} verpasst` : '';
  document.getElementById('btnScheduled').setAttribute('data-tooltip', missed ? `${missed} verpasste Aufgabentermine — ausdrücklich nachholen` : 'Geplante Aufgaben öffnen');
  for (const task of scheduledState.tasks) {
    const card = document.createElement('section');
    const title = document.createElement('h3');
    title.className = 'scheduled-view__task-title';
    title.textContent = task.name;
    card.appendChild(title);
    const detail = document.createElement('p');
    detail.className = 'settings__hint';
    detail.textContent = `${task.paused ? 'Pausiert · ' : ''}${task.model} · ${task.cwd} · ${describeScheduledRule(task)} · Nächster Termin: ${task.nextAt === null ? 'keiner' : new Date(task.nextAt).toLocaleString(undefined, { timeZone: task.zone })} · ${task.missed} verpasst`;
    card.appendChild(detail);
    const actions = document.createElement('div');
    actions.className = 'scheduled-form__actions';
    for (const [label, action] of [['Bearbeiten', 'edit'], [task.paused ? 'Fortsetzen' : 'Pausieren', 'pause'], ['Löschen', 'delete'], ['Verpasste Termine nachholen (ein Lauf)', 'catchUp']]) {
      const button = document.createElement('button');
      button.className = 'action-btn';
      button.type = 'button';
      button.textContent = label;
      button.disabled = action === 'catchUp' && !task.missed;
      button.onclick = async () => {
        try {
          if (action === 'edit') {
            for (const key of ['id', 'name', 'prompt', 'cwd', 'model', 'localTime', 'zone']) scheduledFields.namedItem(key).value = task[key];
            const rule = scheduledRule(task);
            scheduledFields.namedItem('repeat').value = rule.type;
            drawScheduledRecurrence(rule);
            return;
          }
          if (action === 'delete' && !confirm('Aufgabe löschen? Der Verlauf und bereits laufende Sitzungen bleiben erhalten.')) return;
          if (action === 'catchUp' && !confirm(`${task.missed} verpasste Termine jetzt ausdrücklich in EINEM Lauf nachholen? Der reguläre Wiederholungsplan bleibt unverändert.`)) return;
          await window.scheduled.action(task.id, action, action === 'catchUp');
          await renderScheduledTasks();
        } catch (error) { scheduledError(error); }
      };
      actions.appendChild(button);
    }
    card.appendChild(actions);
    list.appendChild(card);
  }
  const history = document.getElementById('scheduledRuns');
  history.replaceChildren();
  if (!scheduledState.runs.length) {
    const empty = document.createElement('p');
    empty.className = 'settings__hint scheduled-view__empty';
    empty.textContent = 'Noch keine Ausführungen. Nach dem ersten Lauf erscheinen hier Status und Ergebnis.';
    history.appendChild(empty);
  }
  for (const run of [...scheduledState.runs].reverse()) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'scheduled-view__run-summary';
    summary.textContent = `${run.name} · ${new Date(run.startedAt).toLocaleString()} · ${scheduledLabels[run.status] || run.status}${run.catchUp ? ' · Nachgeholt' : ''}${run.needsAttention ? ' · Aufmerksamkeit angefordert' : ''}`;
    details.appendChild(summary);
    const result = document.createElement('pre');
    result.className = 'scheduled-view__result';
    const messages = run.events.filter(e => /assistant.message/.test(e.type));
    result.textContent = `Prompt: ${run.prompt}\nProjekt: ${run.cwd}\nModell: ${run.model}\nSitzung: ${run.sessionId || 'noch nicht erstellt'}\n${run.error || ''}${run.autoCompactionError ? `\nAutomatische Komprimierung: ${run.autoCompactionError}` : ''}\n\n` +
      messages.map(e => e.data?.deltaContent || e.data?.content || e.data?.text || '').join('');
    details.appendChild(result);
    if (tabs.has(run.tabId)) {
      const open = document.createElement('button');
      open.className = 'action-btn';
      open.type = 'button';
      open.textContent = 'Sitzung öffnen';
      open.onclick = () => { closeFunctionsView(); switchTab(run.tabId); };
      details.appendChild(open);
    } else if (run.sessionId) {
      const open = document.createElement('button');
      open.className = 'action-btn';
      open.type = 'button';
      open.textContent = 'Gespeicherte Sitzung öffnen';
      open.onclick = async () => {
        saveSessionCwd(run.sessionId, run.cwd);
        saveSessionProvider(run.sessionId, 'copilot');
        saveSessionApproval(run.sessionId, true);
        closeFunctionsView();
        await resumeSession(run.sessionId);
        const tab = tabs.get(activeTabId);
        if (tab) { tab.cwd = run.cwd; tab.selectedModel = run.model; tab.manualApproval = true; }
      };
      details.appendChild(open);
    }
    history.appendChild(details);
  }
}

function attachScheduledRun(run) {
  if (tabs.has(run.tabId)) return;
  // Supplied IDs avoid the normal activating new-tab path; tab setup is synchronous.
  createTab(`🗓️ ${run.name}`, run.model, 'copilot', undefined, run.tabId);
  const tab = tabs.get(run.tabId);
  tab.cwd = run.cwd;
  tab.manualApproval = true;
  tab.sessionId = run.sessionId || null;
  tab.isProcessing = ['running', 'attention'].includes(run.status);
}

window.scheduled.on('attach', attachScheduledRun);
window.scheduled.on('attention', run => {
  attachScheduledRun(run);
  closeFunctionsView();
  switchTab(run.tabId);
  showNotification(`Geplante Aufgabe „${run.name}“ benötigt deine Aufmerksamkeit.`);
});
window.scheduled.on('changed', state => {
  scheduledState = state;
  drawScheduledTasks();
});
scheduledForm.onsubmit = async event => {
  event.preventDefault();
  document.getElementById('scheduledError').textContent = '';
  const data = new FormData(scheduledForm);
  const task = Object.fromEntries(data);
  task.recurrence = { type: task.repeat };
  if (task.repeat !== 'once' && task.repeat !== 'daily') task.recurrence.interval = Number(task.interval);
  for (const key of ['weekdays']) {
    if (data.has(key)) task.recurrence[key] = data.getAll(key).map(v => v === 'last' ? v : Number(v));
    delete task[key];
  }
  if (['monthly', 'yearly'].includes(task.repeat)) {
    task.recurrence.days = [Number(task.localTime.slice(8, 10))];
    if (task.repeat === 'yearly') task.recurrence.months = [Number(task.localTime.slice(5, 7))];
  }
  delete task.repeat;
  delete task.interval;
  if (!task.id) delete task.id;
  try {
    await window.scheduled.save(task);
    resetScheduledForm();
    await renderScheduledTasks();
  } catch (error) { scheduledError(error); }
};
document.getElementById('scheduledNew').onclick = resetScheduledForm;
document.getElementById('scheduledBrowse').onclick = async () => {
  try {
    const folder = await desktop.folders.browse();
    if (folder) scheduledFields.namedItem('cwd').value = folder;
  } catch (error) { scheduledError(error); }
};
resetScheduledForm();
window.scheduled.list().then(state => {
  scheduledState = state;
  for (const run of state.runs.filter(r => ['running', 'attention'].includes(r.status))) attachScheduledRun(run);
  drawScheduledTasks();
}).catch(scheduledError);

'use strict';

let scheduledState = { tasks: [], runs: [] };
const scheduledForm = document.getElementById('scheduledForm');
const scheduledFields = scheduledForm.elements;
const scheduledLabels = { running: 'Läuft', attention: 'Eingriff erforderlich',
  completed: 'Beendet (fachlich ungeprüft)', error: 'Fehler', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };

function scheduledError(error) {
  document.getElementById('scheduledError').textContent = error?.message || String(error);
}

function resetScheduledForm() {
  scheduledForm.reset();
  scheduledFields.namedItem('id').value = '';
  scheduledFields.namedItem('zone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  const missed = scheduledState.tasks.reduce((sum, task) => sum + task.missed, 0);
  document.getElementById('scheduledBadge').textContent = missed ? `⚠ ${missed} verpasst` : '';
  document.getElementById('scheduledReminder').textContent = missed ? `⚠ ${missed} verpasst` : '';
  document.getElementById('btnScheduled').setAttribute('data-tooltip', missed ? `${missed} verpasste Aufgabentermine — ausdrücklich nachholen` : 'Geplante Aufgaben öffnen');
  for (const task of scheduledState.tasks) {
    const card = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = task.name;
    card.appendChild(title);
    const detail = document.createElement('p');
    detail.textContent = `${task.paused ? 'Pausiert · ' : ''}${task.model} · ${task.cwd} · ${task.zone} · ${task.weeks ? `alle ${task.weeks} Wochen` : 'einmalig'} · Nächster Termin: ${task.nextAt === null ? 'keiner' : new Date(task.nextAt).toLocaleString(undefined, { timeZone: task.zone })} · ${task.missed} verpasst`;
    card.appendChild(detail);
    for (const [label, action] of [['Bearbeiten', 'edit'], [task.paused ? 'Fortsetzen' : 'Pausieren', 'pause'], ['Löschen', 'delete'], ['Verpasste Termine nachholen (ein Lauf)', 'catchUp']]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.disabled = action === 'catchUp' && !task.missed;
      button.onclick = async () => {
        try {
          if (action === 'edit') {
            for (const key of ['id', 'name', 'prompt', 'cwd', 'model', 'localTime', 'zone', 'weeks']) scheduledFields.namedItem(key).value = task[key];
            return;
          }
          if (action === 'delete' && !confirm('Aufgabe löschen? Der Verlauf und bereits laufende Sitzungen bleiben erhalten.')) return;
          if (action === 'catchUp' && !confirm(`${task.missed} verpasste Termine jetzt ausdrücklich in EINEM Lauf nachholen? Der reguläre Wiederholungsplan bleibt unverändert.`)) return;
          await window.scheduled.action(task.id, action, action === 'catchUp');
          await renderScheduledTasks();
        } catch (error) { scheduledError(error); }
      };
      card.appendChild(button);
    }
    list.appendChild(card);
  }
  const history = document.getElementById('scheduledRuns');
  history.replaceChildren();
  for (const run of [...scheduledState.runs].reverse()) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${run.name} · ${new Date(run.startedAt).toLocaleString()} · ${scheduledLabels[run.status] || run.status}${run.catchUp ? ' · Nachgeholt' : ''}${run.needsAttention ? ' · Aufmerksamkeit angefordert' : ''}`;
    details.appendChild(summary);
    const result = document.createElement('pre');
    result.style.whiteSpace = 'pre-wrap';
    const messages = run.events.filter(e => /assistant.message/.test(e.type));
    result.textContent = `Prompt: ${run.prompt}\nProjekt: ${run.cwd}\nModell: ${run.model}\nSitzung: ${run.sessionId || 'noch nicht erstellt'}\n${run.error || ''}\n\n` +
      messages.map(e => e.data?.deltaContent || e.data?.content || e.data?.text || '').join('');
    details.appendChild(result);
    if (tabs.has(run.tabId)) {
      const open = document.createElement('button');
      open.textContent = 'Sitzung öffnen';
      open.onclick = () => { closeFunctionsView(); switchTab(run.tabId); };
      details.appendChild(open);
    } else if (run.sessionId) {
      const open = document.createElement('button');
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
  const task = Object.fromEntries(new FormData(scheduledForm));
  task.weeks = Number(task.weeks);
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

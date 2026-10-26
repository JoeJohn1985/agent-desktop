'use strict';

let _functionsPage = 'skills';
window.functionsViewActive = false;

function openFunctionsView(page = _functionsPage) {
  const pages = { skills: 'skillsView', connections: 'connectionsView', plugins: 'pluginsView', costs: 'costsView', scheduled: 'scheduledView' };
  if (!Object.hasOwn(pages, page)) throw new Error('Unbekannter Funktionsbereich: ' + page);
  if (page !== 'scheduled') _functionsPage = page;
  window.functionsViewActive = true;
  window.pluginsViewActive = page === 'plugins';
  window.costsViewActive = page === 'costs';
  document.getElementById('functionsView').classList.toggle('functions-view--compact', true);
  document.getElementById('functionsView').style.display = 'flex';
  document.getElementById('btnFunctions').setAttribute('aria-expanded', String(page !== 'scheduled'));
  document.getElementById('btnScheduled').setAttribute('aria-expanded', String(page === 'scheduled'));
  document.querySelector('.functions-view__nav').style.display = page === 'scheduled' ? 'none' : '';
  document.querySelector('.functions-view__header h2').textContent = page === 'scheduled' ? 'Geplante Aufgaben' : 'Funktionen';
  for (const [name, id] of Object.entries(pages)) {
    document.getElementById(id).style.display = name === page ? 'flex' : 'none';
    const button = document.querySelector(`[data-function-page="${name}"]`);
    if (name === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const selector of ['#sessionActions', '#streamArea', '.chat-input-bar']) {
    document.querySelector(selector).style.display = 'none';
  }
  if (page === 'skills') renderSkills();
  if (page === 'connections') renderMcpServers();
  if (page === 'plugins') renderPlugins();
  if (page === 'costs') requestAnimationFrame(renderCostsPanel);
  if (page === 'scheduled') renderScheduledTasks();
}

function closeFunctionsView() {
  if (!window.functionsViewActive) return;
  window.functionsViewActive = false;
  window.pluginsViewActive = false;
  window.costsViewActive = false;
  document.getElementById('functionsView').style.display = 'none';
  document.getElementById('btnFunctions').setAttribute('aria-expanded', 'false');
  document.getElementById('btnScheduled').setAttribute('aria-expanded', 'false');
  for (const selector of ['#sessionActions', '#streamArea', '.chat-input-bar']) {
    document.querySelector(selector).style.display = '';
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-function-page]');
  if (button) openFunctionsView(button.dataset.functionPage);
});

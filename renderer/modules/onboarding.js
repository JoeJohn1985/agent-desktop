// ── Onboarding Module ─────────────────────────────────────────
// Extracted from app.js — first-run wizard (cwd/provider/folders/role) and
// the post-onboarding tutorial popups.
// Relies on globals provided elsewhere: escapeHtml/showNotification
// (modules/utils.js), getDefaultProvider/saveSetting/PROVIDER_LABELS/
// _providerStatus/refreshProviderStatus (app.js provider catalog),
// createTab/tabs/activeTabId/setTabStatus/getTabProvider/providerSupports/
// formatMessageTime (app.js tab management — via window.RendererLogic for
// formatMessageTime).
'use strict';

/** @type {number} Current onboarding wizard step (1-based). */
let _onboardingStep = 1;
/** @type {number} Current intro-slide index within the final onboarding step. */
let _onboardingSlide = 0;
/** @type {number} Total number of onboarding wizard steps. */
const ONBOARDING_TOTAL_STEPS = 4;

/**
 * Check if this is the user's first run and launch the onboarding wizard if so.
 * @returns {Promise<void>}
 */
async function initOnboarding() {
  let isFirstRun;
  try {
    isFirstRun = await desktop.onboarding.isFirstRun();
  } catch (e) {
    console.warn('[onboarding] Check fehlgeschlagen:', e.message);
    return;
  }
  if (!isFirstRun) return;

  const overlay = document.getElementById('onboarding-overlay');
  overlay.style.display = 'flex';

  document.getElementById('btnOnboardingNext').addEventListener('click', nextOnboardingStep);

  showOnboardingStep(1);
}

function updateStepIndicators(step) {
  const steps = document.querySelectorAll('.onboarding-step');
  steps.forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle('onboarding-step--active', s === step);
    el.classList.toggle('onboarding-step--done', s < step);
  });
}

/**
 * Render a specific onboarding wizard step (CWD, Login, Folders, or Categories).
 * @param {number} step - Step number (1–4).
 */
function showOnboardingStep(step) {
  _onboardingStep = step;
  updateStepIndicators(step);

  const body = document.getElementById('onboarding-body');
  const btnNext = document.getElementById('btnOnboardingNext');
  btnNext.disabled = true;
  btnNext.onclick = null;
  btnNext.textContent = step < ONBOARDING_TOTAL_STEPS ? 'Weiter →' : 'Fertig ✓';

  if (step === 1) {
    renderCwdStep(body, btnNext);
  } else if (step === 2) {
    renderProviderStep(body, btnNext);
  } else if (step === 3) {
    renderFolderStep(body, btnNext);
  } else if (step === 4) {
    renderCategoryStep(body, btnNext);
  }
}

/**
 * Render the CWD (working directory) selection step of the onboarding wizard.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable when valid.
 * @returns {Promise<void>}
 */
async function renderCwdStep(body, btnNext) {
  body.innerHTML = `
    <div class="onboarding-cwd">
      <h2 class="onboarding-cwd__title">📂 Arbeitsverzeichnis</h2>
      <p class="onboarding-cwd__desc">Wähle das Verzeichnis, in dem Agent Desktop arbeiten soll. Dort werden deine Sessions und Dateien gespeichert.</p>
      <div id="onboarding-cwd-status" class="onboarding-cwd__status">
        <span class="onboarding-login__spinner"></span> Lade aktuelles Verzeichnis…
      </div>
    </div>`;

  try {
    const currentCwd = await desktop.chat.getCwd();
    const statusEl = document.getElementById('onboarding-cwd-status');
    if (!statusEl) return;

    statusEl.className = 'onboarding-cwd__path-row';
    statusEl.innerHTML = `
      <input type="text" id="onboarding-cwd-input" class="onboarding-role__input" value="${escapeHtml(currentCwd || '')}" readonly />
      <button class="action-btn action-btn--primary" id="btnOnboardingBrowseCwd">📁 Ändern</button>`;

    if (currentCwd) {
      btnNext.disabled = false;
    }

    document.getElementById('btnOnboardingBrowseCwd').addEventListener('click', async () => {
      const selectedPath = await desktop.folders.browse();
      if (selectedPath) {
        document.getElementById('onboarding-cwd-input').value = selectedPath;
        await desktop.folders.save({ cwd: selectedPath });
        btnNext.disabled = false;
      }
    });
  } catch (e) {
    const statusEl = document.getElementById('onboarding-cwd-status');
    if (statusEl) {
      statusEl.className = 'onboarding-login__status onboarding-login__status--error';
      statusEl.innerHTML = `❌ Fehler: ${escapeHtml(e.message)}`;
    }
  }
}

/**
 * Render the provider-choice step: the user picks which provider to start with
 * (Copilot OR an API provider OR Ollama). Copilot is no longer mandatory — any
 * choice lets the user continue. The choice sets settings.defaultProvider.
 * @param {HTMLElement} body
 * @param {HTMLButtonElement} btnNext
 */
function renderProviderStep(body, btnNext) {
  const choices = [
    { id: 'copilot', label: '🔌 GitHub Copilot', sub: 'CLI-Login, MCP-Unterstützung' },
    { id: 'claude-code', label: '🟣 Claude Code', sub: 'CLI-Login, über dein Claude-Abo' },
    { id: 'anthropic', label: '🟣 Anthropic', sub: 'API-Key (Claude)' },
    { id: 'gemini', label: '🔷 Google Gemini', sub: 'API-Key, Live-Suche' },
    { id: 'openai', label: '🟢 OpenAI', sub: 'API-Key (GPT)' },
    { id: 'glm', label: '🟡 GLM (Zhipu)', sub: 'API-Key' },
    { id: 'ollama', label: '💻 Ollama', sub: 'lokal, kein Key' },
  ];
  const current = getDefaultProvider();
  body.innerHTML = `
    <div class="onboarding-login">
      <h2 class="onboarding-login__title">🧩 Provider wählen</h2>
      <p class="onboarding-login__desc">Womit möchtest du starten? Du kannst das später jederzeit in den Einstellungen ändern und weitere Provider hinzufügen.</p>
      <div class="onboarding-provider-grid">
        ${choices.map(c => `
          <button class="onboarding-provider-card${c.id === current ? ' onboarding-provider-card--active' : ''}" data-provider="${c.id}">
            <span class="onboarding-provider-card__label">${escapeHtml(c.label)}</span>
            <span class="onboarding-provider-card__sub">${escapeHtml(c.sub)}</span>
          </button>`).join('')}
      </div>
      <div class="onboarding-provider-detail" id="onboarding-provider-detail"></div>
    </div>`;

  const detail = document.getElementById('onboarding-provider-detail');
  const select = (provider) => {
    saveSetting('defaultProvider', provider);
    body.querySelectorAll('.onboarding-provider-card').forEach(el =>
      el.classList.toggle('onboarding-provider-card--active', el.dataset.provider === provider));
    // A provider is chosen → the user may continue (login/key are optional and
    // can be completed here or later in settings).
    btnNext.disabled = false;
    renderProviderDetail(detail, provider);
  };

  body.querySelectorAll('.onboarding-provider-card').forEach(card => {
    card.addEventListener('click', () => select(card.dataset.provider));
  });

  // Pre-select the current default so "Weiter" is reachable immediately.
  select(current);
}

/** Render the provider-specific sub-area (Copilot login / API key / Ollama info). */
async function renderProviderDetail(container, provider) {
  if (provider === 'claude-code') {
    container.innerHTML = '<div class="onboarding-login__status">🟣 Claude Code läuft über deine <strong>Claude Code CLI</strong> und dein <strong>Abo</strong> — kein API-Key nötig. Installiere die „claude"-CLI und melde dich einmalig an (<code>claude</code> → Login). Danach kannst du fortfahren.</div>';
    return;
  }
  if (provider === 'copilot') {
    container.innerHTML = '<div class="onboarding-login__status"><span class="onboarding-login__spinner"></span> Prüfe Copilot-Status…</div>';
    let status = { cliInstalled: false, authenticated: false, user: null };
    try { status = await window.desktop.auth.status(); } catch (_) { /* ignore */ }
    if (!status.cliInstalled) {
      container.innerHTML = '<div class="onboarding-login__status onboarding-login__status--warn">⚠️ Copilot-CLI nicht gefunden. Installiere die „copilot"-CLI oder wähle einen API-Provider. Du kannst trotzdem fortfahren.</div>';
    } else if (status.authenticated) {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--ok">✅ Eingeloggt${status.user ? ' als <strong>' + escapeHtml(status.user) + '</strong>' : ''}</div>`;
    } else {
      container.innerHTML = '<div class="onboarding-login__status onboarding-login__status--warn">⚠️ Nicht eingeloggt. <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Jetzt einloggen</button> <button class="action-btn onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button></div>';
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderProviderDetail(container, 'copilot'));
    }
  } else if (provider === 'ollama') {
    container.innerHTML = '<div class="onboarding-login__status">💻 Ollama läuft lokal — kein API-Key nötig. Stelle sicher, dass der Ollama-Server läuft (Standard: localhost:11434).</div>';
  } else {
    // API providers: inline key entry (reuses the secure store).
    const label = PROVIDER_LABELS[provider] || provider;
    const stored = Boolean(_providerStatus.keyed && _providerStatus.keyed[provider]);
    container.innerHTML = `
      <div class="onboarding-login__status">
        🔑 ${escapeHtml(label)}: ${stored ? 'Key bereits hinterlegt.' : 'API-Key eingeben (optional — auch später in den Einstellungen möglich).'}
      </div>
      <div class="onboarding-provider-key">
        <input type="password" id="onboardingProviderKey" class="onboarding-role__input" placeholder="API-Key" autocomplete="off" />
        <button class="action-btn action-btn--primary" id="btnOnboardingSaveKey">Speichern</button>
      </div>`;
    document.getElementById('btnOnboardingSaveKey').addEventListener('click', async () => {
      const key = document.getElementById('onboardingProviderKey').value.trim();
      if (!key) { showNotification('Bitte einen API-Key eingeben.', 'warning'); return; }
      const res = await window.desktop.providers.setKey(provider, key);
      if (res.success) {
        await refreshProviderStatus();
        showNotification(`${label}-Key gespeichert.`, 'success');
        renderProviderDetail(container, provider);
      } else {
        showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
      }
    });
  }
}

/**
 * Handle the login flow within the onboarding wizard. Opens the auth
 * window and provides re-check buttons.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable on success.
 * @returns {Promise<void>}
 */
async function handleOnboardingLogin() {
  const container = document.getElementById('onboarding-provider-detail');
  if (!container) return;
  container.innerHTML = '<div class="onboarding-login__status"><span class="onboarding-login__spinner"></span> Login-Fenster wird geöffnet… Bitte im neuen Fenster einloggen.</div>';

  try {
    const result = await desktop.auth.login();
    if (result.success) {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--warn">ℹ️ Login-Fenster geöffnet. Melde dich dort an und klicke dann <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingRecheck">Erneut prüfen</button></div>`;
      document.getElementById('btnOnboardingRecheck').addEventListener('click', () => renderProviderDetail(container, 'copilot'));
    } else {
      container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--error">❌ Login fehlgeschlagen: ${escapeHtml(result.error || 'Unbekannter Fehler')} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button></div>`;
      document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
    }
  } catch (e) {
    container.innerHTML = `<div class="onboarding-login__status onboarding-login__status--error">❌ Fehler: ${escapeHtml(e.message)} <button class="action-btn action-btn--primary onboarding-login__btn" id="btnOnboardingLogin">Erneut versuchen</button></div>`;
    document.getElementById('btnOnboardingLogin').addEventListener('click', () => handleOnboardingLogin());
  }
}

/**
 * Render the folder setup step: check which required directories exist
 * and offer to create missing ones.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next" button to enable when all folders exist.
 * @returns {Promise<void>}
 */
async function renderFolderStep(body, btnNext) {
  body.innerHTML = `
    <div class="onboarding-folders">
      <h2 class="onboarding-folders__title">📁 Ordner einrichten</h2>
      <p class="onboarding-folders__desc">Agent Desktop benötigt einige Ordner für Skills, Agents, Sessions und Instructions. Diese werden in deinem Home-Verzeichnis angelegt.</p>
      <ul class="onboarding-folder-list" id="onboarding-folder-list">
        <li class="onboarding-folder-item"><span class="onboarding-login__spinner"></span> Prüfe…</li>
      </ul>
    </div>`;

  try {
    const status = await desktop.setup.getFolderStatus();
    renderFolderList(status, btnNext);
  } catch (e) {
    const list = document.getElementById('onboarding-folder-list');
    if (list) list.innerHTML = `<li class="onboarding-folder-item onboarding-folder-item--missing">❌ Fehler: ${escapeHtml(e.message)}</li>`;
  }
}

/**
 * Render the folder status checklist and a "Create folders" button if needed.
 * @param {Object<string, {exists: boolean, path: string}>} status - Folder existence status.
 * @param {HTMLButtonElement} btnNext
 */
function renderFolderList(status, btnNext) {
  const list = document.getElementById('onboarding-folder-list');
  if (!list) return;

  const keys = ['skills', 'agents', 'sessions', 'instructions'];
  const allExist = keys.every(k => status[k] && status[k].exists);

  let html = '';
  for (const key of keys) {
    const item = status[key];
    if (!item) continue;
    const cls = item.exists ? 'onboarding-folder-item--ok' : 'onboarding-folder-item--missing';
    const icon = item.exists ? '✅' : '⬜';
    html += `<li class="onboarding-folder-item ${cls}"><span class="onboarding-folder-item__icon">${icon}</span><code class="onboarding-folder-item__path">${escapeHtml(item.path)}</code></li>`;
  }
  list.innerHTML = html;

  const container = list.parentElement;
  const existingBtn = container.querySelector('.onboarding-create-btn');
  if (existingBtn) existingBtn.remove();

  if (allExist) {
    btnNext.disabled = false;
  } else {
    const btn = document.createElement('button');
    btn.className = 'action-btn action-btn--primary onboarding-create-btn';
    btn.textContent = '📁 Ordner anlegen';
    btn.addEventListener('click', () => handleCreateFolders(btn, btnNext));
    container.appendChild(btn);
  }
}

async function handleCreateFolders(createBtn, btnNext) {
  createBtn.disabled = true;
  createBtn.innerHTML = '<span class="onboarding-login__spinner"></span> Erstelle…';

  try {
    await desktop.setup.createFolders();
    const status = await desktop.setup.getFolderStatus();
    renderFolderList(status, btnNext);
  } catch (e) {
    createBtn.disabled = false;
    createBtn.textContent = '📁 Ordner anlegen';
    const list = document.getElementById('onboarding-folder-list');
    if (list) {
      const errLi = document.createElement('li');
      errLi.className = 'onboarding-folder-item onboarding-folder-item--missing';
      errLi.textContent = `❌ ${e.message}`;
      list.appendChild(errLi);
    }
  }
}

/**
 * Render the role/category personalization step where users enter their
 * job role and missing team positions to generate skills and agents.
 * @param {HTMLElement} body - Container element for step content.
 * @param {HTMLButtonElement} btnNext - The "Next/Finish" button.
 * @returns {Promise<void>}
 */
async function renderCategoryStep(body, btnNext) {
  const missingRoles = [];

  body.innerHTML = `
    <div class="onboarding-role">
      <h2 class="onboarding-categories__title">🎯 Dein Aufgabenbereich</h2>
      <p class="onboarding-categories__desc">Was machst du in deinem Job? Wir legen passende Skills für dich an.</p>

      <div class="onboarding-role__field">
        <label for="onboarding-role-input">Deine Rolle</label>
        <input type="text" id="onboarding-role-input"
               placeholder="z.B. Marketing Manager, Backend-Entwickler, Projektleiter…"
               class="onboarding-role__input" />
      </div>

      <div class="onboarding-role__team-section" id="onboarding-team-section" style="display:none">
        <h3 class="onboarding-role__section-title">👥 Fehlende Team-Positionen</h3>
        <p class="onboarding-categories__desc">Welche Rollen vermisst du in deinem Team? Wir legen für jede Position einen Agent an.</p>
        <div class="onboarding-role__chips" id="onboarding-role-chips"></div>
        <div class="onboarding-role__chip-input-row">
          <input type="text" id="onboarding-team-input"
                 placeholder="z.B. Event Manager, Webdesigner… (Enter zum Hinzufügen)"
                 class="onboarding-role__input onboarding-role__chip-input" />
          <button class="action-btn" id="onboarding-add-chip">Hinzufügen</button>
        </div>
      </div>

      <div id="onboarding-role-action"></div>
      <div id="onboarding-role-status"></div>
    </div>`;

  const roleInput = document.getElementById('onboarding-role-input');
  const teamSection = document.getElementById('onboarding-team-section');
  const teamInput = document.getElementById('onboarding-team-input');
  const addChipBtn = document.getElementById('onboarding-add-chip');
  const chipsContainer = document.getElementById('onboarding-role-chips');
  const actionContainer = document.getElementById('onboarding-role-action');
  const statusContainer = document.getElementById('onboarding-role-status');

  btnNext.disabled = true;

  function showTeamSection() {
    if (roleInput.value.trim() && teamSection.style.display === 'none') {
      teamSection.style.display = '';
      updateSetupButton();
    }
  }

  function addChip() {
    const val = teamInput.value.trim();
    if (!val) return;
    if (missingRoles.includes(val)) { teamInput.value = ''; return; }
    missingRoles.push(val);
    teamInput.value = '';
    renderChips();
  }

  function renderChips() {
    chipsContainer.innerHTML = '';
    missingRoles.forEach((role, idx) => {
      const chip = document.createElement('span');
      chip.className = 'onboarding-role__chip';
      chip.innerHTML = `${escapeHtml(role)} <button class="onboarding-role__chip-remove" data-idx="${idx}">&times;</button>`;
      chipsContainer.appendChild(chip);
    });
    chipsContainer.querySelectorAll('.onboarding-role__chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        missingRoles.splice(parseInt(btn.dataset.idx), 1);
        renderChips();
      });
    });
  }

  function updateSetupButton() {
    const role = roleInput.value.trim();
    const existing = actionContainer.querySelector('.onboarding-role__setup-btn');
    if (role && !existing) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-btn--primary onboarding-role__setup-btn';
      btn.textContent = '✨ Einrichten';
      btn.style.marginTop = '12px';
      btn.style.width = '100%';
      btn.addEventListener('click', () => handleGeneratePersonalized(btn));
      actionContainer.appendChild(btn);
    } else if (!role && existing) {
      existing.remove();
    }
  }

  async function handleGeneratePersonalized(setupBtn) {
    const role = roleInput.value.trim();
    if (!role) return;

    setupBtn.disabled = true;
    setupBtn.innerHTML = '<span class="onboarding-login__spinner"></span> Wird vorbereitet…';
    statusContainer.innerHTML = '';

    try {
      const { skillPrompt, agentPrompt } = await desktop.setup.startPersonalizedSessions({ role, missingRoles });

      // Close onboarding immediately
      await finishOnboarding();

      // Open tab for skill generation
      const skillTabId = await createTab('⚡ Skills generieren');
      _pendingOnboardingTabs.add(skillTabId);
      const skillTab = tabs.get(skillTabId);
      if (skillTab) {
        skillTab.isProcessing = true;
        setTabStatus(skillTabId, 'working');
        const skillInputEl = document.createElement('div');
        skillInputEl.className = 'stream-input';
        skillInputEl.textContent = 'Skills für "' + role + '" generieren…';
        skillInputEl.dataset.time = formatMessageTime(Date.now());
        skillTab.streamEl.insertBefore(skillInputEl, skillTab.statusEl);
        skillTab.statusEl.textContent = '● Thinking…';
        skillTab.statusEl.style.display = 'block';
        desktop.chat.send(skillTabId, skillPrompt, {
          autoApprove: true,
          allowedTools: [],
          deniedTools: [],
          allowAllPaths: true,
        });
      }

      // Open tab for agent generation (if roles specified)
      if (agentPrompt) {
        const agentTabId = await createTab('👥 Agents generieren');
        _pendingOnboardingTabs.add(agentTabId);
        const agentTab = tabs.get(agentTabId);
        if (agentTab) {
          agentTab.isProcessing = true;
          setTabStatus(agentTabId, 'working');
          const agentInputEl = document.createElement('div');
          agentInputEl.className = 'stream-input';
          agentInputEl.textContent = 'Agents für fehlende Team-Positionen generieren…';
          agentInputEl.dataset.time = formatMessageTime(Date.now());
          agentTab.streamEl.insertBefore(agentInputEl, agentTab.statusEl);
          agentTab.statusEl.textContent = '● Thinking…';
          agentTab.statusEl.style.display = 'block';
          desktop.chat.send(agentTabId, agentPrompt, {
            autoApprove: true,
            allowedTools: [],
            deniedTools: [],
            allowAllPaths: true,
          });
        }
      }
    } catch (e) {
      setupBtn.disabled = false;
      setupBtn.textContent = '✨ Einrichten';
      statusContainer.innerHTML = `<p class="onboarding-categories__error">❌ ${escapeHtml(e.message)}</p>`;
    }
  }

  roleInput.addEventListener('blur', showTeamSection);
  roleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); showTeamSection(); roleInput.blur(); }
  });
  roleInput.addEventListener('input', updateSetupButton);

  teamInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChip(); }
  });
  addChipBtn.addEventListener('click', addChip);
}

const _introSlides = [
  { icon: '💬', title: 'Chat-Tabs', text: 'Jede Aufgabe bekommt ihren eigenen Tab. Starte neue Chats mit dem + Button und wechsle zwischen ihnen.' },
  { icon: '🤖', title: 'Skills & Agents', text: 'Aktiviere Skills über das Plugin-Menü. Deine eingerichteten Agents findest du als Befehle direkt im Chat.' },
  { icon: '🚀', title: 'Alles bereit!', text: 'Du kannst jederzeit zurückkehren und weitere Agents und Skills in den Einstellungen hinzufügen.' }
];

function renderIntroStep(body, btnNext) {
  _onboardingSlide = 0;
  renderIntroSlide(body);
  updateIntroNextButton(btnNext);
}

function renderIntroSlide(body) {
  const slide = _introSlides[_onboardingSlide];
  const dots = _introSlides.map((_, i) =>
    `<span class="onboarding-intro__dot${i === _onboardingSlide ? ' onboarding-intro__dot--active' : ''}"></span>`
  ).join('');

  body.innerHTML = `
    <div class="onboarding-intro">
      <span class="onboarding-intro__icon">${slide.icon}</span>
      <h2 class="onboarding-intro__title">${escapeHtml(slide.title)}</h2>
      <p class="onboarding-intro__text">${escapeHtml(slide.text)}</p>
      <div class="onboarding-intro__dots">${dots}</div>
      <div class="onboarding-intro__nav">
        <button class="action-btn onboarding-intro__btn-prev" ${_onboardingSlide === 0 ? 'style="visibility:hidden"' : ''}>← Zurück</button>
        <button class="action-btn onboarding-intro__btn-next" ${_onboardingSlide >= _introSlides.length - 1 ? 'style="visibility:hidden"' : ''}>Weiter →</button>
      </div>
    </div>`;

  const prevBtn = body.querySelector('.onboarding-intro__btn-prev');
  const nextBtn = body.querySelector('.onboarding-intro__btn-next');

  prevBtn.addEventListener('click', () => {
    if (_onboardingSlide > 0) {
      _onboardingSlide--;
      renderIntroSlide(body);
      updateIntroNextButton(document.getElementById('btnOnboardingNext'));
    }
  });

  nextBtn.addEventListener('click', () => {
    if (_onboardingSlide < _introSlides.length - 1) {
      _onboardingSlide++;
      renderIntroSlide(body);
      updateIntroNextButton(document.getElementById('btnOnboardingNext'));
    }
  });
}

function updateIntroNextButton(btnNext) {
  if (_onboardingSlide >= _introSlides.length - 1) {
    btnNext.disabled = false;
    btnNext.textContent = 'Fertig 🎉';
    btnNext.onclick = null; // nextOnboardingStep handles finish
  } else {
    btnNext.disabled = true;
    btnNext.textContent = 'Weiter →';
    btnNext.onclick = null;
  }
}

/**
 * Advance the onboarding wizard to the next step, or finish if on the last step.
 */
function nextOnboardingStep() {
  if (_onboardingStep >= ONBOARDING_TOTAL_STEPS) {
    finishOnboarding();
    return;
  }
  showOnboardingStep(_onboardingStep + 1);
}

// ── Tutorial Popup ─────────────────────────────────────────
/**
 * Show a tutorial popup next to the Skills section header, teaching
 * the user about hovering for tooltips and reloading. Auto-dismisses
 * after 30s or when the user clicks the reload button.
 * @returns {Promise<void>}
 */
async function showTutorialPopup() {
  const flags = await desktop.tutorial.getFlags();
  if (flags.tutorialSkillsShown) return;

  const skillsHeader = document.querySelector('.sidebar__section[data-icon="🛠️"] .sidebar__header');
  if (!skillsHeader) return;

  const existing = document.getElementById('tutorialSkillsPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'tutorial-popup';
  popup.id = 'tutorialSkillsPopup';
  popup.innerHTML =
    '<div class="tutorial-popup__arrow"></div>' +
    '<div class="tutorial-popup__header">' +
      '<span class="tutorial-popup__title">💡 Tipp</span>' +
      '<button class="tutorial-popup__close" id="tutorialSkillsClose">×</button>' +
    '</div>' +
    '<div class="tutorial-popup__body">' +
      'Über <strong>Skills &amp; Agents</strong> hovern — Beschreibung erscheint als Tooltip.<br>' +
      'Über den Header hovern um neu zu laden <strong>↻</strong>' +
    '</div>';
  document.body.appendChild(popup);

  const rect = skillsHeader.getBoundingClientRect();
  popup.style.top = (rect.top + rect.height / 2 - popup.offsetHeight / 2) + 'px';
  popup.style.left = (rect.right + 12) + 'px';

  await desktop.tutorial.setFlag('tutorialSkillsShown', true);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popup.remove();
    document.removeEventListener('click', onReloadClick);
    setTimeout(() => showTutorialRenamePopup(), 1000);
  };

  // Close when user clicks the reload button
  const onReloadClick = (e) => {
    if (e.target.closest('[aria-label="Skills neu laden"], [aria-label="Agents neu laden"]')) close();
  };

  popup.querySelector('.tutorial-popup__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  setTimeout(() => document.addEventListener('click', onReloadClick), 200);

  // Safety: auto-close after 30s to prevent listener leak if user ignores popup
  setTimeout(() => close(), 30000);
}

/**
 * Show a tutorial popup below the first tab, teaching the user to rename
 * tabs for session persistence. Auto-dismisses after 30s or on rename.
 * @returns {Promise<void>}
 */
async function showTutorialRenamePopup() {
  const flags = await desktop.tutorial.getFlags();
  if (flags.tutorialRenameShown) return;

  // Don't advertise renaming-to-save on providers that can't persist sessions.
  const activeTab = tabs.get(activeTabId);
  if (activeTab && !providerSupports(getTabProvider(activeTab), 'sessions')) return;

  const tabBar = document.getElementById('tabBar');
  const firstTab = tabBar && tabBar.querySelector('.tab');
  if (!firstTab) return;

  const existing = document.getElementById('tutorialRenamePopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'tutorial-popup tutorial-popup--below';
  popup.id = 'tutorialRenamePopup';
  popup.innerHTML =
    '<div class="tutorial-popup__arrow tutorial-popup__arrow--up"></div>' +
    '<div class="tutorial-popup__header">' +
      '<span class="tutorial-popup__title">💡 Tipp</span>' +
      '<button class="tutorial-popup__close" id="tutorialRenameClose">×</button>' +
    '</div>' +
    '<div class="tutorial-popup__body">' +
      'Tab <strong>✎ umbenennen</strong> um den Gesprächsverlauf zu speichern' +
    '</div>';
  document.body.appendChild(popup);

  const rect = firstTab.getBoundingClientRect();
  popup.style.left = (rect.left + rect.width / 2 - popup.offsetWidth / 2) + 'px';
  popup.style.top = (rect.bottom + 10) + 'px';

  await desktop.tutorial.setFlag('tutorialRenameShown', true);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    popup.remove();
    document.removeEventListener('tab:renamed', onTabRenamed);
  };

  // Close when user successfully renames a tab
  const onTabRenamed = () => close();

  popup.querySelector('.tutorial-popup__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  setTimeout(() => document.addEventListener('tab:renamed', onTabRenamed), 200);

  // Safety: auto-close after 30s to prevent listener leak if user ignores popup
  setTimeout(() => close(), 30000);
}

/**
 * Mark onboarding as complete and hide the overlay.
 * @returns {Promise<void>}
 */
async function finishOnboarding() {
  try {
    await desktop.onboarding.complete();
  } catch (e) {
    console.warn('[onboarding] Complete fehlgeschlagen:', e.message);
  }
  const overlay = document.getElementById('onboarding-overlay');
  overlay.style.display = 'none';
}

/**
 * Fades out and removes the app-loading splash shown from first paint until
 * startup finishes. Called from a `finally` so it always runs, even if some
 * startup step throws — otherwise the app could get stuck behind the splash.
 */
function hideAppLoadingSplash() {
  const el = document.getElementById('appLoading');
  if (!el) return;
  el.classList.add('app-loading--hidden');
  setTimeout(() => el.remove(), 300); // match the CSS opacity transition
}

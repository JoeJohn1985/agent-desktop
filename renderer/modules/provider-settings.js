// ── Provider Settings Module ──────────────────────────────────
// Extracted from app.js — the API-provider key/base-URL settings panel,
// dynamically-generated per-provider config tabs, and the Claude Code (SSH)
// remote-folder picker.
// Relies on globals provided elsewhere: escapeHtml/escapeAttr/showNotification/
// withButtonBusy/initTagInput (modules/utils.js), getSettings/saveSetting/
// setPref (app.js preferences), PROVIDER_LABELS/SETTINGS_TAB_LABELS/
// getClaudeCodeSshHost/getClaudeCodeSshCwd/refreshProviderStatus/
// _providerStatus/providerSupports/renderProviderModelSelect/
// refreshProviderModelSelectOptions/renderProviderReasoningSelect/
// setShowPaidModels/getShowPaidModels/
// providerIconHtml/providerStageBadge/refreshProviderModels/
// providerHasReasoning/getTabProvider (app.js provider catalog),
// renderDeniedTools/addDeniedTool (app.js denylist), openInstructionsEditor
// (app.js instructions modal).
'use strict';

/** Providers shown in the settings panel. `active` ones have a working backend. */
const PROVIDER_SETTINGS = [
  {
    id: 'copilot', active: true, cli: true,
    info: [
      'GitHub Copilot – voll agentisch über die Copilot CLI.',
      '',
      'Als einziger Provider mit MCP-Server-Unterstützung.',
      'Anmeldung über die CLI (Terminal), kein API-Key.',
      'Benötigt die installierte „copilot"-CLI.',
    ].join('\n'),
  },
  {
    id: 'claude-code', active: true, cli: true,
    info: [
      'Claude Code – voll agentisch über das Abo (kein API-Key).',
      '',
      'ACP-Adapter, SDK und native CLI werden mit der App ausgeliefert.',
      'Abrechnung über dein Claude-Abo (Pro/Max) statt pro Token —',
      'sofern kein ANTHROPIC_API_KEY gesetzt ist (wird bewusst entfernt).',
      '',
      'Einmalig über „Anmelden" mit der mitgelieferten CLI ins Abo einloggen.',
    ].join('\n'),
  },
  {
    id: 'claude-code-ssh', active: true, cli: true,
    info: [
      'Claude Code auf einem anderen Rechner – über SSH, gleiches Abo.',
      '',
      'Derselbe ACP-Adapter, nur gestartet auf dem Zielrechner statt lokal.',
      'Dadurch liegt die Session dort — du kannst sie auf dem Zielrechner',
      'jederzeit im Terminal mit „claude --resume <id>" weiterführen.',
      '',
      'Voraussetzungen auf dem Zielrechner: Node.js ≥22/npm, ggf. Runtime-Download',
      'und Claude-Abo-Anmeldung dort. SSH-Anmeldung per Key oder im eigenen Tab',
      'hinterlegtem Passwort — eine interaktive Abfrage kann die App nicht',
      'anzeigen.',
      '',
      'Skills, Agents und Instructions liegen auf dem Zielrechner und',
      'werden hier (noch) nicht angezeigt — Claude Code nutzt sie dort',
      'trotzdem.',
    ].join('\n'),
  },
  {
    id: 'anthropic', active: true, placeholder: 'sk-ant-…',
    info: [
      'Claude – voll agentisch (direkte API).',
      '',
      'Tools:',
      '• Shell (Befehle ausführen)',
      '• Datei lesen / schreiben / bearbeiten',
      '• Verzeichnis auflisten, glob, grep',
      '',
      'Besonderheiten:',
      '• Skills, Agents & Instructions werden mitgegeben',
      '• Prompt-Caching + adaptives Thinking',
      '• Exakte Token-/Kostenabrechnung',
    ].join('\n'),
  },
  {
    id: 'gemini', active: true, placeholder: 'AIza…',
    info: [
      'Gemini – recherche-orientiert (direkte API).',
      '',
      'Zwei Modi pro Tab umschaltbar (nicht gleichzeitig):',
      '🔍 Recherche: Live-Google-Suche mit Quellenangaben',
      '📁 Dateien: lesen / schreiben / bearbeiten, Verzeichnis, glob, grep',
      '',
      'Besonderheiten:',
      '• Kein Shell-Zugriff',
      '• Keine Skills/Agents/Instructions',
      '• Suche & Datei-Tools schließen sich pro Anfrage aus',
    ].join('\n'),
  },
  {
    id: 'openai', active: true, placeholder: 'sk-…', baseUrl: true, defaultBaseUrl: 'https://api.openai.com/v1',
    info: [
      'OpenAI – voll agentisch (Chat Completions + Function Calling).',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
      'Base-URL überschreibbar (z.B. für OpenRouter).',
    ].join('\n'),
  },
  {
    id: 'glm', active: true, placeholder: 'xxxx.xxxx (Zhipu API-Key)', baseUrl: true, defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    info: [
      'GLM (Zhipu) – voll agentisch über OpenAI-kompatible API.',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
    ].join('\n'),
  },
  {
    id: 'ollama', active: true, placeholder: '(kein Key nötig)', keyless: true, baseUrl: true, defaultBaseUrl: 'http://localhost:11434/v1',
    info: [
      'Ollama – lokale Modelle, kein API-Key, kostenlos.',
      '',
      'Tools: Shell, Datei lesen/schreiben/bearbeiten, list/glob/grep.',
      'Base-URL = Adresse deines Ollama-Servers (Standard localhost:11434).',
    ].join('\n'),
  },
];

/**
 * Providers with an actual working connection right now: Copilot (always
 * available), Claude Code (once its CLI is installed), and the direct-API
 * providers (once a key is stored). Ollama is keyless, so a saved base URL is
 * its equivalent "connected" signal instead — otherwise it'd always show up
 * regardless of whether Ollama is even installed. Shared by the new-tab
 * provider menu and the Settings dialog's dynamic provider tabs.
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getConnectedProviders() {
  const result = [{ id: 'copilot', label: PROVIDER_LABELS.copilot || 'Copilot' }];
  let cc = { installed: false };
  try { cc = await window.desktop.chat.claudeCodeStatus(); } catch (_) { /* old build */ }
  if (cc.installed) result.push({ id: 'claude-code', label: SETTINGS_TAB_LABELS['claude-code'] || PROVIDER_LABELS['claude-code'] || 'Claude Code' });
  // The SSH variant needs no local CLI — a configured host is what makes it
  // usable, so that's its "connected" signal (same idea as Ollama's base URL).
  if (getClaudeCodeSshHost()) {
    result.push({ id: 'claude-code-ssh', label: SETTINGS_TAB_LABELS['claude-code-ssh'] || PROVIDER_LABELS['claude-code-ssh'] });
  }

  await refreshProviderStatus();
  for (const p of PROVIDER_SETTINGS) {
    if (p.cli) continue; // Copilot/Claude Code handled separately (native, not key-based)
    const connected = p.keyless
      ? (p.baseUrl ? Boolean(getProviderBaseUrl(p.id)) : true)
      : Boolean(_providerStatus.keyed && _providerStatus.keyed[p.id]);
    if (connected) result.push({ id: p.id, label: SETTINGS_TAB_LABELS[p.id] || PROVIDER_LABELS[p.id] || p.id });
  }
  return result;
}

/**
 * Providers that get their own dynamically-generated settings tab. Copilot is
 * static HTML (always present, handled separately by the Settings dialog), so
 * it's excluded here.
 *
 * Claude Code (SSH) only gets a tab once a host is saved (getConnectedProviders()'s
 * existing gate) — its host field lives in the "Provider" row instead (see
 * renderCopilotProviderRow()), the same place every other provider's first-time
 * setup (API key, base URL) happens. The tab itself only holds what needs a
 * host to make sense: working directory, password, connection test.
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getConnectedProviderConfigs() {
  const providers = await getConnectedProviders();
  if (_globalSkillsLoaded) void loadGlobalSkills();
  return providers.filter(p => p.id !== 'copilot');
}

/**
 * Builds the inner HTML for one dynamically-generated provider settings tab:
 * a default-model select (every provider), plus a read-only Skills/Agents/
 * Instructions folder row (with an "open in explorer" button) for whichever
 * of those features that provider actually supports — see providerSupports();
 * e.g. Gemini has none of the three, Claude Code has no instructions folder.
 * @param {string} providerId
 * @returns {string}
 */
function buildProviderConfigPanelHtml(providerId) {
  const label = PROVIDER_LABELS[providerId] || providerId;
  const parts = [];

  // SSH target itself is entered on the "Provider" tab's row (like every
  // other provider's key/base-URL) — this tab only exists once that's set,
  // so it only needs what actually depends on having a host already.
  if (providerId === 'claude-code-ssh') {
    parts.push(`
      <div class="settings__group">
        <label class="settings__label">📂 Arbeitsverzeichnis (Standard)</label>
        <div class="settings__hint">Pfad <strong>auf dem Zielrechner</strong>, in dem neue Tabs starten — z.B. <code>/home/pi/projekt</code>. Claude Code bindet Sessions an ihr Verzeichnis: derselbe Pfad = dieselbe Session-Liste beim späteren <code>claude --resume</code> dort.</div>
        <div class="settings__folder-row">
          <input type="text" class="settings__folder-input" id="settClaudeCodeSshCwd" placeholder="/home/pi/projekt" value="${escapeAttr(getClaudeCodeSshCwd())}" />
          <button class="action-btn" id="btnBrowseClaudeCodeSshCwd" data-tooltip="Auf dem Zielrechner durchsuchen">📁</button>
        </div>
      </div>
      <div class="settings__group">
        <label class="settings__label">🔑 Passwort (Alternative zum SSH-Key)</label>
        <div class="settings__hint">Wird verschlüsselt über dein Windows-Benutzerkonto gespeichert (wie die API-Keys der anderen Anbieter) und nur beim Verbindungsaufbau kurz entschlüsselt — landet nie unverschlüsselt auf der Platte. Leer lassen, wenn bereits ein SSH-Key eingerichtet ist.</div>
        <div class="settings__folder-row">
          <input type="password" class="settings__input" id="settClaudeCodeSshPassword" placeholder="Passwort" autocomplete="off" />
          <button class="action-btn" id="btnSaveClaudeCodeSshPassword">Speichern</button>
          <button class="action-btn" id="btnDeleteClaudeCodeSshPassword">Löschen</button>
        </div>
        <span class="providers-row__hint" id="claudeCodeSshPasswordStatus"></span>
      </div>
      <div class="settings__group">
        <button class="action-btn" id="btnTestClaudeCodeSsh">Verbindung testen</button>
        <span class="providers-row__hint" id="claudeCodeSshTestStatus"></span>
      </div>
      <div class="settings__separator"></div>
    `);
  }

  parts.push(`
    <div class="settings__group">
      <label class="settings__label">Standard-Modell</label>
      <div class="settings__hint">Modell, mit dem ein neuer ${escapeHtml(label)}-Tab startet. Pro Tab über das 🧠-Menü überschreibbar.</div>
      <select class="settings__select" data-provider-model-select="${escapeAttr(providerId)}"></select>
    </div>
  `);

  if (providerHasReasoning(providerId)) {
    parts.push(`
      <div class="settings__group">
        <label class="settings__label">Standard-Reasoning</label>
        <div class="settings__hint">Stufe, mit der ein neuer ${escapeHtml(label)}-Tab startet. „Standard" überlässt die Wahl dem Anbieter. Pro Tab und Modell über das 🧠-Menü überschreibbar.</div>
        <select class="settings__select" data-provider-reasoning-select="${escapeAttr(providerId)}"></select>
      </div>
    `);
  }

  parts.push(buildAutoCompactionHtml(providerId));

  // Gemini-only: the one provider where the discovered list mixes free and
  // paid models, and iterates fast enough (a new Flash point release every
  // few weeks) that several near-identical versions pile up at once.
  if (providerId === 'gemini') {
    parts.push(`
      <div class="settings__group">
        <div class="settings__row">
          <label class="settings__label">💲 Kostenpflichtige Modelle anzeigen</label>
          <label class="settings__toggle">
            <input type="checkbox" id="settGeminiShowPaid" ${getShowPaidModels('gemini') ? 'checked' : ''} />
            <span class="settings__toggle-slider"></span>
          </label>
        </div>
        <div class="settings__hint">Aus: nur kostenlose Modelle. Unabhängig davon zeigt jede Modell-Familie (z.B. „Flash") immer nur die neueste Version — Google bringt alle paar Wochen eine neue Flash-Version heraus, ohne die alte zu entfernen.</div>
      </div>
    `);
  }

  const folderRows = [];
  if (providerSupports(providerId, 'skills')) folderRows.push({ key: 'skillsDir', icon: '🧩', title: 'Skills' });
  if (providerSupports(providerId, 'agents')) folderRows.push({ key: 'agentsDir', icon: '🤖', title: 'Agents' });
  // Claude Code's `instructions: true` means its own single native CLAUDE.md
  // editor (added separately below) — NOT the direct-API providers' multi-file
  // instructionsDir folder, so it's excluded here despite the shared flag.
  if (providerSupports(providerId, 'instructions') && providerId !== 'claude-code') {
    folderRows.push({ key: 'instructionsDir', icon: '📝', title: 'Instructions' });
  }

  if (folderRows.length) {
    parts.push('<div class="settings__separator"></div>');
    for (const row of folderRows) {
      parts.push(`
        <div class="settings__group">
          <label class="settings__label">${row.icon} ${row.title}</label>
          <div class="settings__hint">Wird automatisch angelegt — hier abgelegte Dateien werden bei ${escapeHtml(label)} eingebunden.</div>
          <div class="settings__folder-row">
            <input type="text" class="settings__folder-input" data-provider-folder-input="${escapeAttr(providerId)}:${row.key}" readonly />
            <button class="action-btn" data-provider-folder-open="${escapeAttr(providerId)}:${row.key}" data-tooltip="Ordner öffnen">📁</button>
          </div>
        </div>
      `);
    }
  }

  if (providerSupports(providerId, 'denylist')) {
    parts.push(`
      <div class="settings__separator"></div>
      <div class="settings__group">
        <label class="settings__label">🚫 Verbotene Shell-Tools</label>
        <div class="settings__hint">Nur für ${escapeHtml(label)} — jeder Provider hat seine eigene, unabhängige Liste (z.B. <code>git push</code>, <code>rm -rf</code>).</div>
        <div class="settings__tool-list" id="settDeniedToolsList-${escapeAttr(providerId)}"></div>
        <div class="settings__tool-add">
          <input type="text" class="settings__tool-input" id="settDeniedToolInput-${escapeAttr(providerId)}" placeholder="z.B. git push" />
          <button class="action-btn" id="btnAddDeniedTool-${escapeAttr(providerId)}" data-tooltip="Tool blockieren">+</button>
        </div>
      </div>
    `);
  }

  if (providerId === 'claude-code') {
    parts.push(`
      <div class="settings__separator"></div>
      <div class="settings__group">
        <label class="settings__label">📝 Instructions</label>
        <div class="settings__hint">Claude Codes eigene, native globale Instructions-Datei — analog zu Copilots copilot-instructions.md.</div>
        <div class="settings__folder-row">
          <input type="text" class="settings__folder-input" value="~/.claude/CLAUDE.md" readonly />
          <button class="action-btn" id="btnEditInstructionsClaudeCode" data-tooltip="Instructions bearbeiten">✏️</button>
        </div>
      </div>
      <div class="settings__hint" style="margin-top:8px;">
        Claude Code entdeckt Skills selbst nativ unter <code>~/.claude/skills/</code> — eine dort abgelegte Datei wird automatisch erkannt, ohne dass hier etwas konfiguriert werden muss.
      </div>
    `);
  }

  return parts.join('');
}

/**
 * Opens a folder picker for a directory on the REMOTE host, since the OS
 * dialog can only browse this machine. Navigation is one SSH round trip per
 * level (see claudecode:sshListDir) — deliberately not pre-fetched, because
 * each call is a full SSH handshake and most picks only descend a few levels.
 *
 * Resolves to the chosen absolute remote path, or null if cancelled.
 * @param {string} host - SSH target
 * @param {string} [startPath] - Where to open; defaults to the remote home
 * @returns {Promise<string|null>}
 */
function pickRemoteFolder(host, startPath) {
  return new Promise((resolve) => {
    document.querySelectorAll('.remote-picker').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-confirm remote-picker';
    overlay.innerHTML = `
      <div class="sidebar-confirm__box remote-picker__box">
        <p class="sidebar-confirm__text">📂 Ordner auf <strong>${escapeHtml(host)}</strong> wählen</p>
        <div class="remote-picker__path" id="remotePickerPath">…</div>
        <div class="remote-picker__list" id="remotePickerList"></div>
        <div class="sidebar-confirm__actions">
          <button class="action-btn action-btn--primary" id="remotePickerChoose">Diesen Ordner wählen</button>
          <button class="action-btn" id="remotePickerCancel">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const pathEl = overlay.querySelector('#remotePickerPath');
    const listEl = overlay.querySelector('#remotePickerList');
    const chooseBtn = overlay.querySelector('#remotePickerChoose');
    let currentPath = null;

    const close = (result) => { overlay.remove(); resolve(result); };

    const navigate = async (target) => {
      listEl.innerHTML = '<div class="remote-picker__hint">Lade…</div>';
      chooseBtn.disabled = true;
      let res;
      try {
        res = await window.desktop.chat.sshListDir(host, target);
      } catch (e) {
        res = { ok: false, error: e?.message || String(e) };
      }
      if (!res.ok) {
        listEl.innerHTML = `<div class="remote-picker__hint remote-picker__hint--error">❌ ${escapeHtml(res.error || 'Fehler')}</div>`;
        // Keep the previous path selectable so one bad subfolder doesn't
        // strand the user in a dead dialog.
        chooseBtn.disabled = !currentPath;
        return;
      }
      currentPath = res.path;
      pathEl.textContent = currentPath;
      chooseBtn.disabled = false;

      const rows = [];
      // Root has no parent — offering ".." there would just reload root.
      if (currentPath && currentPath !== '/') {
        rows.push('<button class="remote-picker__row" data-remote-up="1">📁 ..</button>');
      }
      for (const d of res.dirs || []) {
        rows.push(`<button class="remote-picker__row" data-remote-dir="${escapeAttr(d)}">📁 ${escapeHtml(d)}</button>`);
      }
      listEl.innerHTML = rows.length ? rows.join('') : '<div class="remote-picker__hint">Keine Unterordner</div>';
    };

    listEl.addEventListener('click', (e) => {
      const up = e.target.closest('[data-remote-up]');
      if (up) { navigate(`${currentPath}/..`); return; }
      const dir = e.target.closest('[data-remote-dir]');
      // Join manually rather than with path helpers: this is a POSIX path on
      // the remote host, and the renderer runs on Windows.
      if (dir) navigate(`${currentPath.replace(/\/$/, '')}/${dir.dataset.remoteDir}`);
    });

    chooseBtn.addEventListener('click', () => close(currentPath));
    overlay.querySelector('#remotePickerCancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

    navigate(startPath || '');
  });
}

/**
 * Wires the Claude Code (SSH) settings: working directory (saved on change),
 * password and the connection test. The host itself is entered on the
 * "Provider" tab's row (renderCopilotProviderRow) — this tab only exists
 * once one is saved (see getConnectedProviderConfigs), so it's read here via
 * getClaudeCodeSshHost() rather than having its own input.
 * @param {HTMLElement} panel
 */
function wireClaudeCodeSshPanel(panel) {
  const cwdInput = panel.querySelector('#settClaudeCodeSshCwd');
  const testBtn = panel.querySelector('#btnTestClaudeCodeSsh');
  const statusEl = panel.querySelector('#claudeCodeSshTestStatus');
  const pwInput = panel.querySelector('#settClaudeCodeSshPassword');
  const pwSaveBtn = panel.querySelector('#btnSaveClaudeCodeSshPassword');
  const pwDeleteBtn = panel.querySelector('#btnDeleteClaudeCodeSshPassword');
  const pwStatusEl = panel.querySelector('#claudeCodeSshPasswordStatus');

  const refreshPasswordStatus = async () => {
    if (!pwStatusEl) return;
    try {
      const { hasPassword } = await window.desktop.chat.sshHasPassword();
      pwStatusEl.textContent = hasPassword ? '● Passwort hinterlegt' : '○ kein Passwort hinterlegt (SSH-Key wird genutzt)';
      pwStatusEl.classList.toggle('is-set', hasPassword);
    } catch (_) { /* old build */ }
  };
  refreshPasswordStatus();

  pwSaveBtn?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
    const pw = pwInput?.value || '';
    if (!pw) { showNotification('Bitte ein Passwort eingeben.', 'warning'); return; }
    const res = await window.desktop.chat.sshSetPassword(pw);
    if (res.success) {
      if (pwInput) pwInput.value = '';
      showNotification('SSH-Passwort gespeichert.', 'success');
      refreshPasswordStatus();
    } else {
      showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
    }
  }));

  pwDeleteBtn?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
    await window.desktop.chat.sshDeletePassword();
    if (pwInput) pwInput.value = '';
    showNotification('SSH-Passwort entfernt.', 'info');
    refreshPasswordStatus();
  }));

  cwdInput?.addEventListener('change', () => setPref('claudeCodeSshCwd', cwdInput.value.trim()));

  panel.querySelector('#btnBrowseClaudeCodeSshCwd')?.addEventListener('click', async () => {
    const host = getClaudeCodeSshHost();
    if (!host) {
      statusEl.textContent = 'Kein SSH-Ziel gespeichert (Tab „Provider").';
      return;
    }
    const picked = await pickRemoteFolder(host, (cwdInput?.value || '').trim());
    if (picked && cwdInput) {
      cwdInput.value = picked;
      setPref('claudeCodeSshCwd', picked);
    }
  });

  testBtn?.addEventListener('click', async () => {
    const host = getClaudeCodeSshHost();
    if (!host) {
      statusEl.textContent = 'Kein SSH-Ziel gespeichert (Tab „Provider").';
      return;
    }
    if (cwdInput) setPref('claudeCodeSshCwd', cwdInput.value.trim());

    testBtn.disabled = true;
    const prevLabel = testBtn.textContent;
    testBtn.textContent = 'Teste…';
    statusEl.textContent = '';
    try {
      const res = await window.desktop.chat.testClaudeCodeSsh(host, (cwdInput?.value || '').trim());
      statusEl.textContent = res.ok
        ? `✅ Verbunden${res.nodeVersion ? ` · Node ${res.nodeVersion}` : ''}${res.claudeVersion ? ` · claude ${res.claudeVersion}` : ' · „claude"-CLI nicht gefunden'}${res.cwdOk === false ? ' · Arbeitsverzeichnis existiert nicht' : ''}`
        : `❌ ${res.error || 'Verbindung fehlgeschlagen'}`;
    } catch (e) {
      statusEl.textContent = `❌ ${e?.message || e}`;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = prevLabel;
    }
  });
}

/**
 * Wires one dynamically-generated provider tab's controls after it's been
 * inserted into the DOM: fills the default-model select, loads and displays
 * the Skills/Agents/Instructions folder paths, and wires the "open" buttons.
 * @param {string} providerId
 * @param {HTMLElement} panel
 */
async function wireProviderConfigPanel(providerId, panel) {
  wireAutoCompaction(providerId, panel);
  renderProviderModelSelect(providerId, panel.querySelector(`[data-provider-model-select="${providerId}"]`));

  renderProviderReasoningSelect(providerId, panel.querySelector(`[data-provider-reasoning-select="${providerId}"]`));

  if (providerSupports(providerId, 'denylist')) {
    renderDeniedTools(providerId);
    initTagInput(`btnAddDeniedTool-${providerId}`, `settDeniedToolInput-${providerId}`, (val) => addDeniedTool(providerId, val));
  }

  if (providerId === 'claude-code-ssh') {
    wireClaudeCodeSshPanel(panel);
  }

  if (providerId === 'gemini') {
    panel.querySelector('#settGeminiShowPaid')?.addEventListener('change', (e) => {
      setShowPaidModels('gemini', e.target.checked);
      // Re-render just the select's contents via the shared helper — NOT
      // renderProviderModelSelect(), which would attach a second 'change'
      // listener onto the same, still-live <select> element.
      refreshProviderModelSelectOptions(providerId, panel.querySelector(`[data-provider-model-select="${providerId}"]`));
    });
  }

  if (providerId === 'claude-code') {
    panel.querySelector('#btnEditInstructionsClaudeCode')?.addEventListener('click', async () => {
      const result = await desktop.instructions.readClaudeCode();
      if (!result.success) {
        showNotification(`Fehler: ${result.error}`, 'error');
        return;
      }
      openInstructionsEditor(result.content, result.path, {
        title: '📝 Claude Code Instructions',
        writeFn: (content) => desktop.instructions.writeClaudeCode(content),
      });
    });
  }

  const folderInputs = panel.querySelectorAll('[data-provider-folder-input]');
  if (!folderInputs.length) return;
  let paths = {};
  try { paths = await window.desktop.folders.providerPaths(providerId) || {}; } catch (_) { /* old build */ }
  folderInputs.forEach((input) => {
    const key = input.dataset.providerFolderInput.split(':')[1];
    input.value = paths[key] || '';
  });
  panel.querySelectorAll('[data-provider-folder-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.providerFolderOpen.split(':')[1];
      if (paths[key]) window.desktop.folders.openPath(paths[key]);
    });
  });
}

/**
 * (Re)builds the dynamic per-provider settings tabs (Claude Code + whichever
 * direct-API providers currently have a key stored). Removes any previously
 * generated tabs/panels first, so this is safe to call repeatedly — e.g.
 * whenever a key is added/removed on the "Provider" tab — without
 * accumulating duplicates. Inserted right before the Features tab.
 */
let _autoCompactionPrices = {};

function autoCompactionPriceThreshold(model) {
  return autoCompactionPricingInfo(model).threshold;
}

function autoCompactionPricingInfo(model) {
  return window.AutoCompactionPolicy.resolvePricingInfo(_autoCompactionPrices, model);
}

async function renderProviderConfigTabs() {
  try { _autoCompactionPrices = await window.desktop.pricing.getMap() || {}; }
  catch (_) { _autoCompactionPrices = {}; }
  const tabsBar = document.querySelector('.settings__tabs');
  const panelsHost = document.querySelector('.settings');
  const featuresTab = document.querySelector('.settings__tab[data-tab="features"]');
  const featuresPanel = document.querySelector('.settings__panel[data-panel="features"]');
  if (!tabsBar || !panelsHost || !featuresTab || !featuresPanel) return;
  const copilotPanel = document.querySelector('[data-panel="provider-copilot"]');
  if (copilotPanel) {
    copilotPanel.querySelector('[data-auto-compaction-group]')?.remove();
    const reasoning = copilotPanel.querySelector('#settProviderReasoning-copilot')?.closest('.settings__group');
    if (reasoning) reasoning.insertAdjacentHTML('afterend', buildAutoCompactionHtml('copilot'));
    else copilotPanel.insertAdjacentHTML('afterbegin', buildAutoCompactionHtml('copilot'));
    wireAutoCompaction('copilot', copilotPanel);
  }

  document.querySelectorAll('.settings__tab[data-provider-tab]').forEach(el => el.remove());
  document.querySelectorAll('.settings__panel[data-provider-panel]').forEach(el => el.remove());

  const configs = await getConnectedProviderConfigs();
  for (const cfg of configs) {
    const btn = document.createElement('button');
    btn.className = 'settings__tab';
    btn.dataset.tab = `provider-${cfg.id}`;
    btn.dataset.providerTab = '1';
    btn.textContent = cfg.label;
    tabsBar.insertBefore(btn, featuresTab);

    const panel = document.createElement('div');
    panel.className = 'settings__panel';
    panel.dataset.panel = `provider-${cfg.id}`;
    panel.dataset.providerPanel = '1';
    panel.innerHTML = buildProviderConfigPanelHtml(cfg.id);
    panelsHost.insertBefore(panel, featuresPanel);

    wireProviderConfigPanel(cfg.id, panel);
  }
}

function buildAutoCompactionHtml(providerId) {
    const model = providerId === 'copilot' && typeof getDefaultModelForProvider === 'function' ? getDefaultModelForProvider(providerId) : '';
    const priceThreshold = providerId === 'copilot' ? autoCompactionPriceThreshold(model) : null;
    const policy = window.AutoCompactionPolicy.resolveCompactionPolicy(getSettings(), providerId, model, priceThreshold);
    const tokens = policy.mode === 'tokens';
    const models = providerId === 'copilot' && typeof getModelsForProvider === 'function' ? getModelsForProvider(providerId) : [];
    const controlId = `settAutoCompaction-${providerId}`;
    return `<div class="settings__group settings__auto-compaction" data-auto-compaction-group>
      <div class="settings__row">
        <label class="settings__label" for="${controlId}-enabled">📦 Automatische Komprimierung</label>
        <label class="settings__toggle"><input id="${controlId}-enabled" type="checkbox" data-auto-compaction-enabled ${policy.enabled ? 'checked' : ''} />
          <span class="settings__toggle-slider"></span></label>
      </div>
      ${providerId === 'copilot' ? `<div class="settings__auto-compaction-field">
        <label class="settings__label" for="${controlId}-model">Regel für Modell</label>
        <select id="${controlId}-model" class="settings__select" data-auto-compaction-model aria-label="Komprimierungsmodell" aria-describedby="${controlId}-scope">${models.map(m =>
    `<option value="${escapeAttr(m.id)}" ${m.id === model ? 'selected' : ''}>${escapeHtml(m.name || m.label || m.id)}</option>`).join('')}</select>
        <div class="settings__hint" id="${controlId}-scope">Die angezeigte Regel gilt für das ausgewählte Modell – auch in Tabs und geplanten Aufgaben. Aktivierung gilt für den gesamten Provider.</div>
      </div>` : ''}
      <div class="settings__auto-compaction-field">
      <label class="settings__label" for="${controlId}-threshold" data-auto-compaction-threshold-label>Komprimieren ab (${tokens ? 'Tokens' : '% Kontextauslastung'})</label>
      <input id="${controlId}-threshold" class="settings__input" type="number" min="1" ${tokens ? '' : 'max="95"'} step="1" value="${escapeAttr(String(tokens ? policy.thresholdTokens : policy.thresholdPercent))}"
        data-auto-compaction-percent aria-label="Komprimierungsschwellwert" />
      </div>
      <div class="settings__hint" data-auto-compaction-price></div>
      <div class="settings__hint" data-auto-compaction-warning role="status"></div>
      ${providerId === 'copilot' ? '<button type="button" class="action-btn" data-auto-compaction-reset>Zurück zur Automatik</button>' : ''}
      <div class="settings__hint"><strong>Automatik:</strong> Standard ist aktiviert ab 50 %. Die Einheit folgt dem Preismodell; nur der Schwellwert ist editierbar.
        ${providerId === 'copilot' ? 'Modelle mit Preisstufe nutzen ohne gespeicherte Regel Tokens mit Sicherheitsabstand (240000 bei Preisgrenze 272000).' : ''}</div>
      <div class="settings__hint"><strong>Kostengrenzen:</strong> Keine versteckte Preis-Cap und keine Kostengarantie:
        Eine Aufgabe kann die Preisgrenze schon vor der Verdichtung überschreiten. Ohne gemeldete Auslastung wird übersprungen.</div>
      <div class="settings__hint"><strong>Zeitpunkt:</strong> Erst nach vollständiger Antwort inklusive Tools, nicht bei Abbruch, Fehler oder Rückfrage.
        Native CLI-Komprimierung bleibt unverändert.</div>
      ${providerId === 'copilot' ? '<div class="settings__hint"><strong>Kontextfenster:</strong> Copilot-Sitzungen fordern immer das größte verfügbare Fenster an. Die tatsächliche Größe meldet /context; Modelle ohne größeres Fenster nutzen ihr Standardfenster.</div>' : ''}
      <div class="settings__hint" data-auto-compaction-error role="alert"></div>
    </div>`;
  }

function wireAutoCompaction(providerId, panel) {
    const enabled = panel.querySelector('[data-auto-compaction-enabled]');
    const percent = panel.querySelector('[data-auto-compaction-percent]');
    const error = panel.querySelector('[data-auto-compaction-error]');
    const model = panel.querySelector('[data-auto-compaction-model]');
    const price = panel.querySelector('[data-auto-compaction-price]');
    const warning = panel.querySelector('[data-auto-compaction-warning]');
    const thresholdLabel = panel.querySelector('[data-auto-compaction-threshold-label]');
    if (!enabled || !percent || !error) return;
    const priceThreshold = () => providerId === 'copilot' ? autoCompactionPriceThreshold(model?.value) : null;
    const ruleMode = () => priceThreshold() ? 'tokens' : 'percent';
    const refreshWarning = () => {
      const threshold = priceThreshold();
      const info = autoCompactionPricingInfo(model?.value);
      const saved = getSettings().autoCompaction?.[providerId];
      const specific = saved?.models?.[model?.value];
      const individual = specific ? specific.mode === ruleMode() : (saved && !saved.modelDefaults && ruleMode() === 'percent');
      const incompatible = specific ? specific.mode !== 'auto' && specific.mode !== ruleMode()
        : saved && !saved.modelDefaults && ruleMode() === 'tokens';
      if (price) price.textContent = providerId !== 'copilot' ? 'Prozentregel aus dem tatsächlich gemeldeten Kontextfenster.'
        : `${individual ? 'Individuelle Regel' : 'Automatischer Vorschlag'}. ${threshold
          ? `Preisgrenze: ${threshold} Eingabe-Tokens pro Modellaufruf. Nicht aufsummierte Sitzungstokens.`
          : info.known ? 'Offizieller einheitlicher Tarif: keine erhöhte Preisstufe. Prozentregel aus /context.'
            : 'Preis unbekannt: kein offizieller Modelleintrag zuordenbar. Prozentregel aus /context möglich.'}
          Quelle: ${info.source || 'keine offizielle Zuordnung'}${info.updatedAt ? `; Preisstand: ${new Date(info.updatedAt).toLocaleString()}` : ''}.
          ${incompatible ? 'Die ältere Regel hat eine andere Einheit und wird nicht umgerechnet; wirksam ist der angezeigte Automatikvorschlag.' : ''}`;
      if (warning) warning.textContent = window.AutoCompactionPolicy.compactionCostWarning({
        enabled: enabled.checked, mode: ruleMode(), thresholdTokens: Number(percent.value), thresholdPercent: Number(percent.value),
      }, threshold, null);
    };
    const selectModel = () => {
      const rule = window.AutoCompactionPolicy.resolveCompactionPolicy(getSettings(), providerId, model?.value || '', priceThreshold());
      if (thresholdLabel) thresholdLabel.textContent = `Komprimieren ab (${rule.mode === 'tokens' ? 'Tokens' : '% Kontextauslastung'})`;
      percent.value = String(rule.mode === 'tokens' ? rule.thresholdTokens : rule.thresholdPercent);
      if (rule.mode === 'tokens') percent.removeAttribute('max'); else percent.setAttribute('max', '95');
      error.textContent = '';
      refreshWarning();
    };
    const save = async (event) => {
      const value = Number(percent.value);
      const tokens = ruleMode() === 'tokens';
      if (!percent.value.trim() || !Number.isSafeInteger(value) || value < 1 || (!tokens && value > 95)) {
        error.textContent = tokens ? 'Bitte eine positive ganze Tokenzahl eingeben.' : 'Bitte eine ganze Zahl von 1 bis 95 eingeben.';
        percent.setAttribute('aria-invalid', 'true');
        return;
      }
      percent.removeAttribute('aria-invalid');
      error.textContent = '';
      const previous = getSettings().autoCompaction;
      const old = previous?.[providerId] || { enabled: true, thresholdPercent: 50, modelDefaults: true };
      const rule = tokens ? { mode: 'tokens', thresholdTokens: value } : { mode: 'percent', thresholdPercent: value };
      const reset = event?.currentTarget?.hasAttribute('data-auto-compaction-reset');
      const activationOnly = event?.currentTarget === enabled;
      const models = { ...old.models };
      if (reset) {
        if (!old.modelDefaults) models[model.value] = { mode: 'auto' };
        else delete models[model.value];
      }
      else if (!activationOnly && model?.value) models[model.value] = rule;
      const policies = { ...previous, [providerId]: model?.value
        ? { ...old, enabled: enabled.checked, models }
        : { enabled: enabled.checked, thresholdPercent: value } };
      saveSetting('autoCompaction', policies);
      try {
        // Unlike ordinary debounced settings, confirm durable storage here.
        const saved = await desktop.preferences.write(_prefs);
        if (!saved) throw new Error('Einstellungen konnten nicht gespeichert werden.');
        if (reset) selectModel();
        refreshWarning();
        if (warning?.textContent) showNotification(warning.textContent, 'warning');
      } catch (e) {
        if (getSettings().autoCompaction === policies) saveSetting('autoCompaction', previous);
        error.textContent = e.message || 'Speichern fehlgeschlagen.';
        showNotification(error.textContent, 'error');
      }
    };
    enabled.addEventListener('change', save);
    panel.querySelector('[data-auto-compaction-reset]')?.addEventListener('click', save);
    percent.addEventListener('change', save);
    percent.addEventListener('input', refreshWarning);
    model?.addEventListener('change', selectModel);
    if (model) selectModel();
    else refreshWarning();
  }

async function renderProvidersSettings() {
  const list = document.getElementById('providersKeyList');
  if (!list) return;
  await refreshProviderStatus();

  document.getElementById('providersUnavailable').style.display =
    _providerStatus.available ? 'none' : 'block';

  list.innerHTML = '';
  for (const p of PROVIDER_SETTINGS) {
    if (p.cli) { renderCopilotProviderRow(list, p); continue; }
    const hasKey = Boolean(_providerStatus.keyed && _providerStatus.keyed[p.id]);
    const status = p.keyless ? 'kein Key nötig' : (hasKey ? '● hinterlegt' : '○ leer');
    const row = document.createElement('div');
    row.className = 'providers-row';
    const keyControls = p.keyless ? '' : `
      <div class="providers-row__controls">
        <input type="password" class="providers-row__input" placeholder="${escapeAttr(p.placeholder)}" autocomplete="off" />
        <button class="action-btn providers-row__save">Speichern</button>
        <button class="action-btn providers-row__delete" ${hasKey ? '' : 'disabled'}>Löschen</button>
      </div>`;
    const baseUrlControls = p.baseUrl ? `
      <div class="providers-row__controls">
        <input type="text" class="providers-row__baseurl" placeholder="${escapeAttr(p.defaultBaseUrl || '')}" autocomplete="off" value="${escapeAttr(getProviderBaseUrl(p.id))}" />
        <button class="action-btn providers-row__save-url">Base-URL speichern</button>
      </div>` : '';
    row.innerHTML = `
      <div class="providers-row__head">
        <span class="providers-row__name"><span class="providers-row__icon">${providerIconHtml(p.id)}</span>${escapeHtml(PROVIDER_LABELS[p.id] || p.id)}</span>
        ${p.info ? `<span class="providers-row__info" data-tooltip="${escapeAttr(p.info)}" aria-label="Tools & Besonderheiten">ⓘ</span>` : ''}
        ${providerStageBadge(p.id).trim()}
        <span class="providers-row__status ${hasKey || p.keyless ? 'is-set' : ''}">${status}</span>
        ${p.active ? '' : '<span class="providers-row__soon">in Vorbereitung</span>'}
      </div>
      ${keyControls}
      ${baseUrlControls}`;

    if (!p.keyless) {
      const input = row.querySelector('.providers-row__input');
      row.querySelector('.providers-row__save').addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        const key = input.value.trim();
        if (!key) { showNotification('Bitte einen API-Key eingeben.', 'warning'); return; }
        const res = await window.desktop.providers.setKey(p.id, key);
        if (res.success) {
          input.value = '';
          showNotification(`${PROVIDER_LABELS[p.id]}-Key gespeichert.`, 'success');
          renderProvidersSettings();
          if (_globalSkillsLoaded) void loadGlobalSkills();
          refreshProviderModels(p.id); // discover this provider's models now that it has a key
        } else {
          showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
        }
      }));
      row.querySelector('.providers-row__delete').addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        await window.desktop.providers.deleteKey(p.id);
        showNotification(`${PROVIDER_LABELS[p.id]}-Key entfernt.`, 'info');
        renderProvidersSettings();
        if (_globalSkillsLoaded) void loadGlobalSkills();
      }));
    }

    if (p.baseUrl) {
      const urlInput = row.querySelector('.providers-row__baseurl');
      row.querySelector('.providers-row__save-url').addEventListener('click', () => {
        saveProviderBaseUrl(p.id, urlInput.value.trim());
        showNotification(`${PROVIDER_LABELS[p.id]} Base-URL gespeichert.`, 'success');
      });
    }

    list.appendChild(row);
  }
}

/** Per-provider base URL override (empty → provider default). */
function getProviderBaseUrl(provider) {
  return (getSettings().providerBaseUrls || {})[provider] || '';
}
function saveProviderBaseUrl(provider, url) {
  const map = { ...(getSettings().providerBaseUrls || {}) };
  if (url) map[provider] = url; else delete map[provider];
  saveSetting('providerBaseUrls', map);
  if (_globalSkillsLoaded) void loadGlobalSkills();
}

/**
 * Render the Copilot row in the provider settings — presented like the other
 * providers, but driven by the CLI status (installed? logged in?) instead of an
 * API key. Shows an install hint, "Anmelden" (terminal login) and re-check.
 */
async function renderCopilotProviderRow(list, p) {
  const row = document.createElement('div');
  row.className = 'providers-row';
  row.innerHTML = `
    <div class="providers-row__head">
      <span class="providers-row__name"><span class="providers-row__icon">${providerIconHtml(p.id)}</span>${escapeHtml(PROVIDER_LABELS[p.id] || p.id)}</span>
      ${p.info ? `<span class="providers-row__info" data-tooltip="${escapeAttr(p.info)}" aria-label="Tools & Besonderheiten">ⓘ</span>` : ''}
      ${providerStageBadge(p.id).trim()}
      <span class="providers-row__status">… wird geprüft</span>
    </div>
    <div class="providers-row__controls"></div>`;
  list.appendChild(row);

  const statusEl = row.querySelector('.providers-row__status');
  const controls = row.querySelector('.providers-row__controls');

  // Claude Code: release-bundled runtime; billed through the subscription.
  // `claude auth status` reports the actual login state non-interactively
  // (clean JSON) — claudeCodeStatus() above only checks CLI presence.
  if (p.id === 'claude-code') {
    let cc = { installed: false };
    try { cc = await window.desktop.chat.claudeCodeStatus(); } catch (_) { /* old build */ }
    let authStatus = { loggedIn: false };
    if (cc.installed) {
      try { authStatus = await window.desktop.chat.claudeCodeAuthStatus(); } catch (_) { /* old build */ }
    }
    if (authStatus.loggedIn) {
      statusEl.textContent = '● angemeldet' + (authStatus.email ? ` als ${authStatus.email}` : '') + (authStatus.subscriptionType ? ` (${authStatus.subscriptionType})` : '');
      statusEl.classList.add('is-set');
    } else if (cc.installed) {
      statusEl.textContent = '○ Runtime vorhanden, nicht angemeldet';
    } else {
      statusEl.textContent = '⚠ Claude-Release-Runtime fehlt';
    }
    const hint = document.createElement('span');
    hint.className = 'providers-row__hint';
    hint.textContent = !cc.installed
      ? 'App neu installieren. ' + (cc.error || '')
      : 'Kein API-Key nötig — ANTHROPIC_API_KEY wird für Claude Code entfernt.'
        + ` Release-Adapter ${cc.releaseVersion}, SDK ${cc.sdkVersion}.`
        + (cc.developerOverride ? ` ⚠ Entwickler-Override ${cc.version} (nur neue Prozesse, Download möglich).` : '')
        + (authStatus.loggedIn ? '' : ' Einmalig über „Anmelden" mit dem Abo anmelden.');
    controls.appendChild(hint);
    if (getSettings().devMode === true && cc.installed) {
      const version = document.createElement('input');
      version.className = 'providers-row__input';
      version.placeholder = `Entwicklerversion (Release: ${cc.releaseVersion})`;
      version.value = cc.version || cc.releaseVersion;
      version.setAttribute('aria-label', 'Exakte Claude-ACP-Entwicklerversion');
      const apply = document.createElement('button');
      apply.className = 'action-btn';
      apply.textContent = 'Entwicklerversion testen';
      apply.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        const result = await window.desktop.chat.applyAdapterUpdate(version.value.trim());
        if (result.ok) {
          _prefs.claudeCodeAdapterDeveloperVersion = result.newVersion === cc.releaseVersion ? undefined : result.newVersion;
          showNotification('Version gilt für neue Prozesse; laufende Sessions bleiben unverändert. Release-Version eingeben zum Zurücksetzen.', 'info');
          await renderProvidersSettings();
        } else showNotification(result.error, 'error');
      }));
      controls.append(version, apply);
    }
    if (cc.installed && !authStatus.loggedIn) {
      const login = document.createElement('button');
      login.className = 'action-btn';
      login.textContent = 'Anmelden';
      login.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        const result = await window.desktop.chat.claudeCodeLogin();
        showNotification(result.success ? 'Anmeldung im geöffneten Terminal abschließen, danach Status prüfen.' : result.error, result.success ? 'info' : 'error');
      }));
      controls.appendChild(login);
    }
    if (authStatus.loggedIn) {
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'action-btn';
      logoutBtn.textContent = 'Trennen';
      logoutBtn.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        const res = await window.desktop.chat.claudeCodeLogout();
        if (res.success) {
          showNotification('Abmeldung im geöffneten Terminal-Fenster abschließen, danach „Status prüfen".', 'info');
        } else {
          showNotification(res.error || 'Trennen fehlgeschlagen.', 'error');
        }
      }));
      controls.appendChild(logoutBtn);
    }
    const recheck = document.createElement('button');
    recheck.className = 'action-btn';
    recheck.textContent = 'Status prüfen';
    recheck.addEventListener('click', () => renderProvidersSettings());
    controls.appendChild(recheck);
    return;
  }

  // Claude Code (SSH): no local CLI/login to check — the host is entered
  // right here (like every other provider's key/base-URL), since this row is
  // the only place a first-time setup can happen. Once saved, its own "CC
  // (SSH)" tab appears (getConnectedProviders()'s existing host check) for
  // the working directory, password and connection test.
  if (p.id === 'claude-code-ssh') {
    const host = getClaudeCodeSshHost();
    statusEl.textContent = host ? '● eingerichtet' : '○ nicht eingerichtet';
    statusEl.classList.toggle('is-set', Boolean(host));
    const runtimeHint = document.createElement('span');
    runtimeHint.className = 'providers-row__hint';
    try {
      const runtime = await window.desktop.chat.claudeCodeStatus();
      runtimeHint.textContent = `Remote: ACP ${runtime.version || runtime.releaseVersion || 'Release-Version'}. `
        + (runtime.developerOverride ? '⚠ Entwickler-Override. ' : '')
        + 'Ausführung auf dem SSH-Host (Node ≥22); erstmaliger npm-Download möglich, nicht offline gebündelt. Remote-Anmeldung erforderlich.';
    } catch (_) {
      runtimeHint.textContent = 'Remote-Ausführung benötigt Node ≥22 und ggf. npm-Download sowie Remote-Anmeldung.';
    }
    controls.appendChild(runtimeHint);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'providers-row__input';
    input.placeholder = 'pi@raspberrypi.local';
    input.autocomplete = 'off';
    input.value = host;
    controls.appendChild(input);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'action-btn';
    saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
      const val = input.value.trim();
      if (!val) { showNotification('Bitte ein SSH-Ziel eingeben.', 'warning'); return; }
      setPref('claudeCodeSshHost', val);
      showNotification('SSH-Ziel gespeichert.', 'success');
      renderProvidersSettings();
      renderProviderConfigTabs();
    }));
    controls.appendChild(saveBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn';
    deleteBtn.textContent = 'Löschen';
    deleteBtn.disabled = !host;
    deleteBtn.addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
      setPref('claudeCodeSshHost', '');
      showNotification('SSH-Ziel entfernt.', 'info');
      renderProvidersSettings();
      renderProviderConfigTabs();
    }));
    controls.appendChild(deleteBtn);
    return;
  }

  let status = { cliInstalled: false, authenticated: false, user: null };
  try { status = await window.desktop.auth.status(); } catch (_) { /* old build / offline */ }

  const addBtn = (label, primary, onClick) => {
    const b = document.createElement('button');
    b.className = 'action-btn' + (primary ? ' action-btn--primary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    controls.appendChild(b);
  };

  if (!status.cliInstalled) {
    statusEl.textContent = '⚠ CLI nicht gefunden';
    const hint = document.createElement('span');
    hint.className = 'providers-row__hint';
    hint.textContent = 'Bitte die „copilot"-CLI installieren und die App neu starten.';
    controls.appendChild(hint);
  } else if (status.authenticated) {
    statusEl.textContent = '● eingeloggt' + (status.user ? ' als ' + status.user : '');
    statusEl.classList.add('is-set');
    addBtn('Neu anmelden', false, () => window.desktop.auth.login());
  } else {
    statusEl.textContent = '○ CLI installiert, nicht eingeloggt';
    addBtn('Anmelden', true, async () => {
      await window.desktop.auth.login();
      showNotification('Login im Terminal abschließen, danach „Status prüfen".', 'info');
    });
    addBtn('Status prüfen', false, () => renderProvidersSettings());
  }
}

// ── Provider Settings Module ──────────────────────────────────
// Extracted from app.js — the API-provider key/base-URL settings panel,
// dynamically-generated per-provider config tabs, and the Claude Code (SSH)
// remote-folder picker.
// Relies on globals provided elsewhere: escapeHtml/escapeAttr/showNotification/
// withButtonBusy/initTagInput (modules/utils.js), getSettings/saveSetting/
// setPref (app.js preferences), PROVIDER_LABELS/SETTINGS_TAB_LABELS/
// getClaudeCodeSshHost/getClaudeCodeSshCwd/refreshProviderStatus/
// _providerStatus/providerSupports/renderProviderModelSelect/
// renderProviderReasoningSelect/getModelsForProvider/MODEL_TIER_TEXT/
// getDefaultModelForProvider/setShowPaidModels/getShowPaidModels/
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
      'Läuft über den ACP-Adapter (npx @agentclientprotocol/claude-agent-acp).',
      'Abrechnung über dein Claude-Abo (Pro/Max) statt pro Token —',
      'sofern kein ANTHROPIC_API_KEY gesetzt ist (wird bewusst entfernt).',
      '',
      'Voraussetzung: einmalig „claude" (Claude Code CLI) mit dem Abo einloggen.',
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
      'Voraussetzungen auf dem Zielrechner: Node.js/npx, die „claude"-CLI',
      'mit Abo eingeloggt, und ein SSH-Zugang ohne Passwortabfrage',
      '(SSH-Key), da die App keine Passworteingabe anzeigen kann.',
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
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getConnectedProviderConfigs() {
  const providers = await getConnectedProviders();
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

  // SSH target first: without it this provider can't start at all, so it
  // belongs above the model picker rather than buried under it.
  if (providerId === 'claude-code-ssh') {
    parts.push(`
      <div class="settings__group">
        <label class="settings__label">🖧 SSH-Ziel</label>
        <div class="settings__hint">Wie hinter <code>ssh</code> eingegeben — z.B. <code>pi@192.168.1.50</code> oder ein Alias aus deiner <code>~/.ssh/config</code>. Der Zugang muss ohne Passwortabfrage funktionieren (SSH-Key).</div>
        <input type="text" class="settings__input" id="settClaudeCodeSshHost" placeholder="pi@raspberrypi.local" value="${escapeAttr(getClaudeCodeSshHost())}" />
      </div>
      <div class="settings__group">
        <label class="settings__label">📂 Arbeitsverzeichnis (Standard)</label>
        <div class="settings__hint">Pfad <strong>auf dem Zielrechner</strong>, in dem neue Tabs starten — z.B. <code>/home/pi/projekt</code>. Claude Code bindet Sessions an ihr Verzeichnis: derselbe Pfad = dieselbe Session-Liste beim späteren <code>claude --resume</code> dort.</div>
        <div class="settings__folder-row">
          <input type="text" class="settings__folder-input" id="settClaudeCodeSshCwd" placeholder="/home/pi/projekt" value="${escapeAttr(getClaudeCodeSshCwd())}" />
          <button class="action-btn" id="btnBrowseClaudeCodeSshCwd" data-tooltip="Auf dem Zielrechner durchsuchen">📁</button>
        </div>
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
 * Wires the Claude Code (SSH) settings: host/cwd inputs (saved on change) and
 * the connection test. Both fields are saved as typed rather than validated —
 * an SSH target can be a config alias, a user@host, or an IP, and guessing
 * which is "valid" would reject legitimate setups. The test button is the
 * validation instead: it reports what actually happened when connecting.
 * @param {HTMLElement} panel
 */
function wireClaudeCodeSshPanel(panel) {
  const hostInput = panel.querySelector('#settClaudeCodeSshHost');
  const cwdInput = panel.querySelector('#settClaudeCodeSshCwd');
  const testBtn = panel.querySelector('#btnTestClaudeCodeSsh');
  const statusEl = panel.querySelector('#claudeCodeSshTestStatus');

  hostInput?.addEventListener('change', () => setPref('claudeCodeSshHost', hostInput.value.trim()));
  cwdInput?.addEventListener('change', () => setPref('claudeCodeSshCwd', cwdInput.value.trim()));

  panel.querySelector('#btnBrowseClaudeCodeSshCwd')?.addEventListener('click', async () => {
    const host = (hostInput?.value || '').trim();
    if (!host) {
      statusEl.textContent = 'Bitte zuerst ein SSH-Ziel eintragen.';
      return;
    }
    setPref('claudeCodeSshHost', host); // browsing implies this host is the one we want
    const picked = await pickRemoteFolder(host, (cwdInput?.value || '').trim());
    if (picked && cwdInput) {
      cwdInput.value = picked;
      setPref('claudeCodeSshCwd', picked);
    }
  });

  testBtn?.addEventListener('click', async () => {
    const host = (hostInput?.value || '').trim();
    if (!host) {
      statusEl.textContent = 'Bitte zuerst ein SSH-Ziel eintragen.';
      return;
    }
    // Persist before testing, so a user who types and immediately clicks
    // doesn't test one value while a different one stays configured.
    setPref('claudeCodeSshHost', host);
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
      // Re-render just the select's contents — NOT via renderProviderModelSelect(),
      // which would attach a second 'change' listener onto the same, still-live
      // <select> element.
      const sel = panel.querySelector(`[data-provider-model-select="${providerId}"]`);
      if (sel) {
        sel.innerHTML = getModelsForProvider(providerId)
          .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${MODEL_TIER_TEXT[m.tier] || ''}</option>`)
          .join('');
        sel.value = getDefaultModelForProvider(providerId);
      }
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
async function renderProviderConfigTabs() {
  const tabsBar = document.querySelector('.settings__tabs');
  const panelsHost = document.querySelector('.settings');
  const featuresTab = document.querySelector('.settings__tab[data-tab="features"]');
  const featuresPanel = document.querySelector('.settings__panel[data-panel="features"]');
  if (!tabsBar || !panelsHost || !featuresTab || !featuresPanel) return;

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
          refreshProviderModels(p.id); // discover this provider's models now that it has a key
        } else {
          showNotification(res.error || 'Speichern fehlgeschlagen.', 'error');
        }
      }));
      row.querySelector('.providers-row__delete').addEventListener('click', (e) => withButtonBusy(e.currentTarget, async () => {
        await window.desktop.providers.deleteKey(p.id);
        showNotification(`${PROVIDER_LABELS[p.id]}-Key entfernt.`, 'info');
        renderProvidersSettings();
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

  // Claude Code: launched on demand via npx; billed through the subscription.
  // Live-detect the CLI; the subscription login itself can't be checked
  // non-interactively, so we point the user to `claude` for it.
  if (p.id === 'claude-code') {
    let cc = { installed: false };
    try { cc = await window.desktop.chat.claudeCodeStatus(); } catch (_) { /* old build */ }
    if (cc.installed) {
      statusEl.textContent = '● „claude"-CLI installiert' + (cc.version ? ` (v${cc.version})` : '');
      statusEl.classList.add('is-set');
    } else {
      statusEl.textContent = '⚠ „claude"-CLI nicht gefunden';
    }
    const hint = document.createElement('span');
    hint.className = 'providers-row__hint';
    hint.textContent = cc.installed
      ? 'Melde dich einmalig mit dem Abo an (Terminal: „claude" → Login). Kein API-Key nötig — ANTHROPIC_API_KEY wird für Claude Code entfernt.'
      : 'Installiere die „claude"-CLI (npm i -g @anthropic-ai/claude-code) und melde dich mit dem Abo an.';
    controls.appendChild(hint);
    const recheck = document.createElement('button');
    recheck.className = 'action-btn';
    recheck.textContent = 'Status prüfen';
    recheck.addEventListener('click', () => renderProvidersSettings());
    controls.appendChild(recheck);
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

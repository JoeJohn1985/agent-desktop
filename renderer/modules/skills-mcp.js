// ── Skills, Agents & MCP Module ───────────────────────────────
// Extracted from app.js — sidebar rendering for skills/agents/MCP servers,
// per-tab context loading, and MCP status probing.
// NOTE: unlike plugins.js, this module's state (skills, agents,
// mcpServers, globalMcpServers, activeAgents, _liveMcpStatus) is also read
// or written from app.js itself (Tab Management, Send Message, Agent IPC,
// startup data load) — the same cross-file bare-global pattern already used
// for `tabs`/`activeTabId` throughout this codebase, not a new risk.
// Relies on globals provided elsewhere: escapeHtml/escapeAttr (modules/
// utils.js), tabs/activeTabId/getTabProvider (app.js tab management/model
// switcher), saveSetting (app.js).
'use strict';

/** @type {Array<{id: string, name: string, icon: string, description: string, source: string, dirName?: string}>} Skill definitions loaded from main process. */
let skills = [];
let _skillsLoading = false;
let _skillsLoadError = '';
let _globalSkillGroups = [];
let _globalSkillProviders = [];
let _globalSkillsLoading = false;
let _globalSkillsError = '';
let _globalSkillsLoaded = false;
let _globalSkillsGeneration = 0;
let _globalSkillMutation = false;

async function setGlobalSkillEnabled(identity, enabled) {
  if (_globalSkillMutation) return;
  _globalSkillMutation = true;
  renderSkills();
  try {
    await desktop.context.setGlobalSkillEnabled('copilot', identity, enabled);
    await loadGlobalSkills();
    const tab = tabs.get(activeTabId);
    if (tab) await loadContextForTab(getTabProvider(tab), tab.cwd || null, { force: true });
  } catch (error) {
    showNotification(`Skill-Änderung fehlgeschlagen: ${error.message}`, 'error');
    await loadGlobalSkills();
  } finally {
    _globalSkillMutation = false;
    renderSkills();
  }
}

async function loadGlobalSkills() {
  const generation = ++_globalSkillsGeneration;
  _globalSkillsLoading = true;
  _globalSkillsLoaded = true;
  _globalSkillsError = '';
  renderSkills();
  try {
    const [groups, providers] = await Promise.all([
      desktop.context.listGlobalSkills(),
      getConnectedProviders(),
    ]);
    if (generation === _globalSkillsGeneration) {
      _globalSkillGroups = groups || [];
      _globalSkillProviders = providers;
    }
  } catch (error) {
    if (generation === _globalSkillsGeneration) _globalSkillsError = `Skills konnten nicht geladen werden: ${error.message}`;
  } finally {
    if (generation === _globalSkillsGeneration) {
      _globalSkillsLoading = false;
      renderSkills();
    }
  }
}
/** @type {Array<{id: string, name: string, icon: string, description: string, fileSlug?: string}>} Agent definitions loaded from main process. */
let agents = [];
/** @type {Set<string>} IDs of currently enabled agents (persisted to preferences). */
let activeAgents = new Set(); // eslint-disable-line prefer-const -- reassigned in app.js initDataLoad
/** @type {Array<{name: string, status: string}>} MCP server list for the active tab. */
let mcpServers = [];
/** @type {Array<{name: string, type: string, status: string}>} User/workspace MCP servers from `copilot mcp list`. */
let globalMcpServers = []; // eslint-disable-line prefer-const -- reassigned in app.js initDataLoad
/**
 * @type {Map<string, string>} Server name → status, as reported live by an
 * actual ACP session (session.mcp_servers_loaded) once it has really
 * connected. This is authoritative — a real session succeeding is stronger
 * evidence than our own unauthenticated reachability probe (refreshMcpStatus),
 * which can false-negative on servers that need auth/a proxy the raw probe
 * doesn't use. Names in here are never downgraded by the probe.
 */
const _liveMcpStatus = new Map();

/**
 * Render user-wide provider groups independently of the session skill context.
 */
function renderSkills() {
  renderSessionSkills();
  const container = document.getElementById('skillList');
  if (!container) return;
  if (!_globalSkillsLoaded) { void loadGlobalSkills(); return; }
  const context = document.getElementById('skillsContext');
  if (context) context.textContent = 'Benutzerweite Skills · Copilot: nativer CLI-Status, namensgleich über alle Quellen. Bestehende Gesprächsinhalte bleiben erhalten. ACP-Wirkung ist nicht bestätigt, auch nicht durch Neustart oder neue Session.';
  if (_globalSkillsLoading || _globalSkillsError) {
    container.innerHTML = emptyStateHtml('🛠️', _globalSkillsError || 'Skills werden geladen…');
    return;
  }
  const providers = [..._globalSkillProviders].sort((a, b) => {
    const rank = id => id === 'copilot' ? 0 : id === 'claude-code' ? 1 : 2;
    return rank(a.id) - rank(b.id);
  });
  container.innerHTML = providers.map(provider => {
    const groups = _globalSkillGroups.filter(group => group.providers.includes(provider.id));
    if (!groups.length) return '';
    return `<section class="functions-view__skill-provider" data-skill-provider="${escapeAttr(provider.id)}">
      <h3>${escapeHtml(provider.label)}</h3>
      ${groups.map(group => `
    <section class="functions-view__skill-group">
      ${group.providers.length > 1 ? '<p class="functions-view__skill-source">Geteilte Quelle</p>' : ''}
      <p class="functions-view__skill-source">${escapeHtml(group.directory)}</p>
      ${group.error ? emptyStateHtml('⚠️', `Skills konnten nicht geladen werden: ${group.error}`)
        : !group.skills.length ? emptyStateHtml('🛠️', 'Keine benutzerweiten Skills in diesem Verzeichnis.')
          : `<div class="functions-view__skill-grid">${group.skills.map(s => `
      <div class="skill-card" data-tooltip="${escapeAttr(s.description || '')}">
        <span class="skill-card__icon">${escapeHtml(s.icon || '🧩')}</span>
        <span class="skill-card__info">
          <span class="skill-card__name">${escapeHtml(s.name)}</span>
          <span class="functions-view__skill-description">${escapeHtml(s.description || '')}</span>
        </span>
        ${group.native ? `<label class="settings__toggle">
          <input type="checkbox" data-native-skill="${escapeAttr(s.id)}" ${s.enabled ? 'checked' : ''} ${_globalSkillMutation ? 'disabled' : ''} aria-label="${escapeAttr(s.name)}: ${s.enabled ? 'Aktiv · Deaktivieren' : 'Deaktiviert · Aktivieren'}" />
          <span class="settings__toggle-slider" aria-hidden="true"></span>
        </label>` : `<label class="settings__toggle" title="Status unbekannt">
          <input type="checkbox" data-unsupported-skill disabled aria-label="${escapeAttr(s.name)}: Status unbekannt" />
          <span class="settings__toggle-slider" aria-hidden="true"></span>
        </label>`}
      </div>`).join('')}</div>`}
    </section>`).join('')}</section>`;
  }).join('') || emptyStateHtml('🛠️', 'Keine lokalen benutzerweiten Skill-Quellen für verbundene Provider verfügbar.');
  container.querySelectorAll('[data-unsupported-skill]').forEach(input => {
    input.indeterminate = true;
  });
  container.querySelectorAll('[data-native-skill]').forEach(input => {
    input.addEventListener('change', () => void setGlobalSkillEnabled(input.dataset.nativeSkill, input.checked));
  });
}

window.addEventListener('focus', () => {
  if (_globalSkillsLoaded) void loadGlobalSkills();
});

/**
 * Toggle a skill's active state for the current tab only.
 * @param {string} skillId
 */
function toggleSkill(skillId) {
  const tab = tabs.get(activeTabId);
  if (!tab || _skillsLoading || _skillsLoadError || !skills.some(s => s.id === skillId)) return;
  if (tab.activeSkills.has(skillId)) tab.activeSkills.delete(skillId);
  else tab.activeSkills.add(skillId);
  renderSkills();
}

/** Only resolved skills for the current context may enrich a prompt. */
function getActiveSkillDefinitions(tab) {
  if (!tab || _skillsLoading || _skillsLoadError || _globalSkillMutation) return [];
  if (_lastContextKey !== null && _lastContextKey !== `${getTabProvider(tab)} ${tab.cwd || ''}`) return [];
  return skills.filter(skill => tab.activeSkills.has(skill.id));
}

function renderSessionSkills() {
  const button = document.getElementById('btnSessionSkills');
  if (!button) return;
  const tab = tabs.get(activeTabId);
  button.disabled = !tab;
  button.textContent = `🛠️ Skills (${getActiveSkillDefinitions(tab).length})`;
  const menu = document.getElementById('sessionSkillsDropdown');
  if (!menu) return;
  if (!tab) { closeSessionSkills(); return; }
  const focusedId = document.activeElement?.dataset?.sessionSkillId;
  const message = _skillsLoading ? 'Skills werden geladen…' : _skillsLoadError
    || (!skills.length ? 'Keine Skills für diesen Provider und dieses Projekt verfügbar.' : '');
  menu.innerHTML = message
    ? `<div role="status" class="session-skills__status">${escapeHtml(message)}</div>`
    : skills.map(skill => `<button type="button" class="session-skills__toggle" role="switch"
        aria-checked="${tab.activeSkills.has(skill.id)}" data-session-skill-id="${escapeAttr(skill.id)}">
        <span>${escapeHtml(skill.icon || '🧩')} ${escapeHtml(skill.name)}</span><span class="skill-card__toggle" aria-hidden="true"></span>
      </button>`).join('');
  if (focusedId) [...menu.querySelectorAll('[data-session-skill-id]')]
    .find(el => el.dataset.sessionSkillId === focusedId)?.focus();
  positionSessionMenu(menu, button, true);
}

function closeSessionSkills(restoreFocus = false) {
  document.getElementById('sessionSkillsDropdown')?.remove();
  const button = document.getElementById('btnSessionSkills');
  button?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button?.focus();
}

function initSessionSkills() {
  const button = document.getElementById('btnSessionSkills');
  if (!button) return;
  button.addEventListener('click', () => {
    if (document.getElementById('sessionSkillsDropdown')) { closeSessionSkills(); return; }
    const menu = document.createElement('div');
    menu.id = 'sessionSkillsDropdown';
    menu.className = 'model-dropdown session-skills';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Skills für diese Session');
    button.parentElement.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    menu.addEventListener('click', event => {
      const toggle = event.target.closest('[data-session-skill-id]');
      if (toggle) toggleSkill(toggle.dataset.sessionSkillId);
    });
    menu.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const controls = [...menu.querySelectorAll('[role="switch"]')];
      if (!controls.length) return;
      event.preventDefault();
      const index = controls.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
      controls[next].focus();
    });
    renderSessionSkills();
    menu.querySelector('[role="switch"]')?.focus();
  });
  document.addEventListener('click', event => {
    if (!event.composedPath().includes(button.parentElement)) closeSessionSkills();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('sessionSkillsDropdown')) {
      event.preventDefault();
      closeSessionSkills(true);
    }
  });
  document.addEventListener('focusin', event => {
    if (!button.parentElement.contains(event.target)) closeSessionSkills();
  });
  window.addEventListener('resize', renderSessionSkills);
}

/**
 * Merges MCP server lists, deduplicating by name. Earlier lists win, so the
 * global (probed) entries take precedence over tab-context copies.
 * @param {...Array<{name: string}>} lists
 * @returns {Array<Object>}
 */
function mergeMcpByName(...lists) {
  const byName = new Map();
  for (const list of lists) {
    for (const s of (list || [])) {
      if (!byName.has(s.name)) byName.set(s.name, { ...s });
    }
  }
  return [...byName.values()];
}

/**
 * Probes MCP server connectivity in the background and updates the status
 * badges. HTTP/SSE servers get a real reachable/offline status; stdio servers
 * stay 'configured'. Merges results by name into the current server lists.
 */
async function refreshMcpStatus() {
  let probed;
  try {
    probed = await desktop.mcp.probe();
  } catch (e) {
    console.warn('[mcp] Status-Probe fehlgeschlagen:', e.message);
    return;
  }
  if (!Array.isArray(probed)) return;
  const statusByName = new Map(probed.map(s => [s.name, s.status]));
  const applyStatus = (list) => list.forEach(s => {
    // A live session already confirmed this server's real status (by actually
    // using it) — that's stronger evidence than our own unauthenticated probe,
    // which can false-negative on servers that need auth the probe doesn't send.
    if (!s.managed && _liveMcpStatus.has(s.name)) return;
    if (statusByName.has(s.name)) s.status = statusByName.get(s.name);
  });
  applyStatus(globalMcpServers);
  applyStatus(mcpServers);
  renderMcpServers();
}

function renderMcpServers() {
  const container = document.getElementById('mcpList');
  if (!container) return;
  const activeTab = tabs.get(activeTabId);
  const context = document.getElementById('connectionsContext');
  if (context) context.textContent = activeTab
    ? `Chat-Provider: ${getTabProvider(activeTab)} · Projekt: ${activeTab.cwd || 'Kein Projekt gewählt'}`
    : 'Zentrale Serververwaltung · Kein Chat-Tab ausgewählt.';
  const servers = mergeMcpByName(mcpServers, globalMcpServers);

  if (servers.length === 0) {
    container.innerHTML = emptyStateHtml('🔌', 'Server über die MCP-Verwaltung hinzufügen.');
    return;
  }

  container.innerHTML = servers.map(s => {
    const isConnected = s.status === 'connected';
    const isConfigured = s.status === 'configured';
    const statusIcon = isConnected ? '🟢' : isConfigured ? '⚪' : '🔴';
    const statusLabel = MCP_STATUS_LABELS[s.status] || s.status;
    const cardClass = isConnected ? 'mcp-card--connected' : 'mcp-card--disconnected';
    const projectBadge = s.fromProject ? ' (Projekt / CLI)' : ' (CLI)';
    return `
      <div class="mcp-card ${cardClass}"
           data-tooltip="${escapeAttr(s.error || s.name)}">
        <span class="mcp-card__status">${statusIcon}</span>
        <div class="mcp-card__info">
          <div class="mcp-card__name">${escapeHtml(s.name)}${s.managed ? ' (App)' : projectBadge}</div>
          ${s.error ? `<div class="mcp-manager__error">${escapeHtml(s.error)}</div>` : ''}
        </div>
        <span class="mcp-card__label" title="${escapeAttr(statusLabel)}">${escapeHtml(statusLabel)}</span>
        ${s.managed ? mcpMenuButtonHtml(s) : ''}
      </div>
    `;
  }).join('');
}

// ── Skills & Agents pro Tab ──────────────────────────────────
// Welche Skills/Agents existieren, hängt von BEIDEM ab: Provider und Projekt.
// Jeder Provider liest andere Ordner (siehe src/context-paths.js), deshalb gibt
// es keine providerneutrale Liste — und deshalb wird hier auch nichts mehr aus
// mehreren Quellen zusammengemischt. Der Main-Prozess liefert für (provider,
// cwd) genau eine fertige Liste; die Sidebar zeigt sie unverändert an.

/** Letzter geladener Kontext, als Schlüssel — verhindert unnötige Rescans. */
let _lastContextKey = null;
/** Zählt jeden Ladeversuch hoch — verhindert, dass eine langsame, überholte
 *  Antwort eine schnellere, neuere überschreibt (siehe unten). */
let _contextRequestGen = 0;

/**
 * Lädt Skills und Agents für einen Tab und rendert die Sidebar neu.
 * Beim Wechsel zwischen zwei Tabs mit gleichem Provider UND gleichem Projekt
 * passiert nichts (gleiche Liste) — das ist der häufigste Fall.
 *
 * Wird unawaited aufgerufen (Tab-Wechsel soll nicht auf das Netzwerk warten),
 * daher der Generation-Counter: Wechselt der Nutzer schnell zurück zu Tab A,
 * während Tab B's Anfrage noch läuft, darf B's später eintreffende, aber für
 * den jetzt wieder aktiven Tab A überholte Antwort nicht mehr die globalen
 * skills/agents überschreiben.
 * @param {string} provider
 * @param {string|null} cwd
 * @param {{force?: boolean}} [opts] - force: Guard übergehen (Reload-Button).
 * @returns {Promise<void>}
 */
async function loadContextForTab(provider, cwd, opts = {}) {
  const key = `${provider} ${cwd || ''}`;
  if (!opts.force && key === _lastContextKey) return;
  _lastContextKey = key;
  const requestGen = ++_contextRequestGen;
  _skillsLoading = true;
  _skillsLoadError = '';
  skills = [];
  renderSkills();

  let newSkills = [];
  let newAgents = [];
  let loadError = '';
  try {
    [newSkills, newAgents] = await Promise.all([
      desktop.context.listSkills(provider, cwd || null).then(r => r || []),
      desktop.context.listAgents(provider, cwd || null).then(r => r || []),
    ]);
  } catch (e) {
    console.warn('[context] Skills/Agents konnten nicht geladen werden:', e.message);
    loadError = 'Skills konnten nicht geladen werden: ' + e.message;
  }

  if (requestGen !== _contextRequestGen) return; // von einer neueren Anfrage überholt — verwerfen

  _skillsLoading = false;
  _skillsLoadError = loadError;
  skills = newSkills;
  agents = newAgents;
  renderSkills();
  renderAgents();
}

/** Erzwingt einen Neuaufbau der Skill-/Agent-Liste (Reload-Button im ⋮-Menü). */
async function reloadSkills() {
  const tab = tabs.get(activeTabId);
  await Promise.all([
    loadGlobalSkills(),
    tab ? loadContextForTab(getTabProvider(tab), tab.cwd || null, { force: true }) : Promise.resolve(),
  ]);
}

/** Gleiche Quelle wie reloadSkills — Skills und Agents kommen zusammen. */
async function reloadAgents() {
  return reloadSkills();
}

/**
 * Lädt die projektbezogenen MCP-Server für ein Arbeitsverzeichnis und mischt
 * sie über die globalen. Rein MCP — Skills/Agents laufen über
 * loadContextForTab().
 * @param {string|null} cwd
 * @returns {Promise<void>}
 */
async function loadProjectMcpServers(cwd) {
  mcpServers = globalMcpServers.map(s => ({ ...s }));

  if (cwd) {
    try {
      const projectMcpList = await desktop.mcp.listProject(cwd) || [];
      for (const pm of projectMcpList) {
        const existing = mcpServers.find(s => s.name === pm.name);
        if (existing) {
          existing.fromProject = true;
        } else {
          mcpServers.push({ ...pm, status: 'configured', fromProject: true });
        }
      }
    } catch (e) {
      console.warn('[mcp] Projekt-MCP-Config konnte nicht geladen werden:', e.message);
    }
  }

  const tab = tabs.get(activeTabId);
  if (tab) tab.context.mcpServers = mcpServers;
  renderMcpServers();
}

/**
 * Render the agents list in the sidebar. Each agent card shows an icon,
 * name, active toggle, and an optional delete button.
 */
function renderAgents() {
  const container = document.getElementById('agentList');
  if (!container) return;
  const section = container.closest('.sidebar__section');

  if (agents.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = agents.map(a => {
    const isActive = activeAgents.has(a.id);
    const isProject = a.source === 'project';
    return `
      <div class="agent-card ${isActive ? 'agent-card--active' : ''} ${isProject ? 'agent-card--project' : ''}"
           data-agent-id="${escapeAttr(a.id)}" data-tooltip="${escapeAttr(a.description)}">
        <span class="agent-card__icon">${escapeHtml(a.icon || '🤖')}</span>
        <div class="agent-card__info">
          <div class="agent-card__name">${escapeHtml(a.name)}</div>
        </div>
        <div class="agent-card__toggle"></div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle an agent's active state and persist the change.
 * @param {string} agentId
 */
function toggleAgent(agentId) {
  if (activeAgents.has(agentId)) activeAgents.delete(agentId);
  else activeAgents.add(agentId);
  saveSetting('activeAgents', [...activeAgents]);
  renderAgents();
}

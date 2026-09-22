// ── Skills, Agents & MCP Module ───────────────────────────────
// Extracted from app.js — sidebar rendering for skills/agents/MCP servers,
// per-tab context loading, and MCP status probing.
// NOTE: unlike onboarding.js/plugins.js, this module's state (skills, agents,
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
 * Render the skills list in the sidebar. Each skill card shows an icon,
 * name, active toggle, and an optional delete button for user-created skills.
 */
function renderSkills() {
  const container = document.getElementById('skillList');
  const section = container.closest('.sidebar__section');

  // Kein Filtern mehr: die Liste enthält per Konstruktion genau die Skills,
  // die der Provider dieses Tabs in diesem Projekt tatsächlich liest (siehe
  // loadContextForTab / src/context-paths.js). Alles, was hier ankommt, ist
  // verfügbar — und alles Verfügbare kommt hier an.
  if (skills.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  // Der Aktiv-Zustand ist dagegen pro Tab: ein in einem Tab erzwungener Skill
  // darf in anderen Tabs nicht als aktiv erscheinen.
  const activeTabSkills = tabs.get(activeTabId)?.activeSkills || new Set();

  if (section) section.style.display = 'block';
  // No inline onclick with interpolated values: skill names/dirs come from
  // third-party SKILL.md frontmatter (incl. marketplace plugins) — HTML-entity
  // decoding would let a crafted name break out of the JS string inside an
  // onclick attribute. Actions run via delegated listeners reading data-*
  // attributes instead (see initListActionDelegation).
  container.innerHTML = skills.map(s => {
    const isActive = activeTabSkills.has(s.id);
    const isProject = s.source === 'project';
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isProject ? 'skill-card--project' : ''}"
           data-skill-id="${escapeAttr(s.id)}" data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${escapeHtml(s.icon || '🧩')}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
        <div class="skill-card__toggle"></div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle a skill's active state for the current tab only.
 * @param {string} skillId
 */
function toggleSkill(skillId) {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  if (tab.activeSkills.has(skillId)) tab.activeSkills.delete(skillId);
  else tab.activeSkills.add(skillId);
  renderSkills();
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
    if (_liveMcpStatus.has(s.name)) return;
    if (statusByName.has(s.name)) s.status = statusByName.get(s.name);
  });
  applyStatus(globalMcpServers);
  applyStatus(mcpServers);
  renderMcpServers();
}

function renderMcpServers() {
  const container = document.getElementById('mcpList');
  if (!container) return;
  const section = container.closest('.sidebar__section');

  // MCP servers are only wired to the Copilot CLI. Direct-API providers
  // (Anthropic/Gemini/OpenAI/Ollama/GLM) have no MCP connection by design
  // (internal/sensitive servers must not reach external APIs) — hide the
  // section entirely for those tabs.
  const activeTab = tabs.get(activeTabId);
  if (activeTab && getTabProvider(activeTab) !== 'copilot') {
    if (section) section.style.display = 'none';
    return;
  }

  if (mcpServers.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = mcpServers.map(s => {
    const isConnected = s.status === 'connected';
    const isConfigured = s.status === 'configured';
    const statusIcon = isConnected ? '🟢' : isConfigured ? '⚪' : '🔴';
    const statusLabel = isConnected ? 'verbunden' : isConfigured ? 'konfiguriert' : 'getrennt';
    const cardClass = isConnected ? 'mcp-card--connected' : 'mcp-card--disconnected';
    const projectBadge = '';
    return `
      <div class="mcp-card ${cardClass}"
           data-tooltip="${escapeAttr(s.name)}">
        <span class="mcp-card__status">${statusIcon}</span>
        <div class="mcp-card__info">
          <div class="mcp-card__name">${escapeHtml(s.name)}${projectBadge}</div>
        </div>
        <span class="mcp-card__label">${statusLabel}</span>
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

  let newSkills = [];
  let newAgents = [];
  try {
    [newSkills, newAgents] = await Promise.all([
      desktop.context.listSkills(provider, cwd || null).then(r => r || []),
      desktop.context.listAgents(provider, cwd || null).then(r => r || []),
    ]);
  } catch (e) {
    console.warn('[context] Skills/Agents konnten nicht geladen werden:', e.message);
  }

  if (requestGen !== _contextRequestGen) return; // von einer neueren Anfrage überholt — verwerfen

  skills = newSkills;
  agents = newAgents;
  renderSkills();
  renderAgents();
}

/** Erzwingt einen Neuaufbau der Skill-/Agent-Liste (Reload-Button im ⋮-Menü). */
async function reloadSkills() {
  const tab = tabs.get(activeTabId);
  await loadContextForTab(getTabProvider(tab), tab?.cwd || null, { force: true });
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

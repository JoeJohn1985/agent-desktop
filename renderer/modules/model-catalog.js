// ── Model Catalog Module ──────────────────────────────────────
// Extracted from app.js — reasoning-effort helpers, the model/provider
// catalog (hardcoded fallback list, dynamic discovery, default-model/
// -reasoning settings), the provider-capability matrix, and session-mode
// selection (Agent/Plan/Autopilot + provider-discovered modes).
//
// Relies on globals provided elsewhere: escapeHtml/escapeAttr/showNotification
// (modules/utils.js), getPref/setPref/getSettings/saveSetting (app.js
// preferences), tabs/activeTabId/saveOpenTabs (app.js tab management —
// tabs.js owns the functions, app.js still owns the tabs/activeTabId
// declarations themselves, see modules/tabs.js's own header comment),
// saveSessionModelConfiguration/saveSessionApproval/pickSavedMode
// (app.js named-session persistence — pickSavedMode is actually from
// RendererLogic via modules/utils.js), window.ProviderIcons
// (renderer/provider-icons.js, loads before all modules).
//
// This module in turn is depended on heavily by app.js's remaining
// clusters (agent IPC, tab management already extracted to modules/tabs.js
// and modules/agent-ipc.js, initSettings, usage display) and by several
// already-extracted modules (onboarding.js, plugins.js, provider-settings.js,
// sessions-sidebar.js, skills-mcp.js) — all via the same cross-file
// bare-global pattern used throughout the renderer.
'use strict';

/**
 * Reasoning-effort levels. Fixed and provider-agnostic: Anthropic's effort
 * parameter isn't gated per model in practice (confirmed — Haiku offers the
 * same levels as Sonnet), so Copilot and Claude Code share this one list
 * rather than Claude Code discovering its own per model/session. A missing
 * entry and null both mean "use the backend's own default".
 */
const REASONING_EFFORTS = [
  { value: null, label: 'Standard', short: 'Standard' },
  { value: 'low', label: 'low', short: 'low' },
  { value: 'medium', label: 'medium', short: 'medium' },
  { value: 'high', label: 'high', short: 'high' },
  { value: 'xhigh', label: 'xhigh', short: 'xhigh' },
  { value: 'max', label: 'max', short: 'max' },
];
const VALID_REASONING_EFFORTS = new Set(REASONING_EFFORTS.filter((x) => x.value).map((x) => x.value));

/**
 * Generic type/shape guard for a stored reasoning-effort value — used at the
 * shared persistence layer (reasoningByModel is the same data structure for
 * Copilot and Claude Code tabs, see docs/ARCHITECTURE.md). It only folds the
 * "no override" sentinels to null; it does not check legality against
 * REASONING_EFFORTS — that's normalizeKnownReasoningEffort()'s job.
 */
function normalizeReasoningEffort(value) {
  if (value == null || value === '' || value === 'standard' || value === 'default') return null;
  return typeof value === 'string' ? value : null;
}

/** Only the fixed low/medium/high/xhigh/max set is legal — same for every provider. */
function normalizeKnownReasoningEffort(value) {
  const normalized = normalizeReasoningEffort(value);
  return normalized != null && VALID_REASONING_EFFORTS.has(normalized) ? normalized : null;
}

function normalizeReasoningByModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([modelId]) => typeof modelId === 'string' && modelId.length > 0)
      .map(([modelId, effort]) => [modelId, normalizeReasoningEffort(effort)]),
  );
}

function reasoningEffortMeta(value) {
  const normalized = normalizeKnownReasoningEffort(value);
  return REASONING_EFFORTS.find((x) => x.value === normalized) || REASONING_EFFORTS[0];
}

function reasoningEffortLabel(value) {
  return reasoningEffortMeta(value).label;
}

// ── Model Switcher ────────────────────────────────────────────
// NOTE: `/model` without argument opens an interactive TUI picker that crashes
// the background terminal. We use a preferences-stored model list instead.
const DEFAULT_MODEL_ID = 'claude-sonnet-4.6';
// `tier`: 'aic' = über Copilot-Abo/AI Credits abgerechnet, 'free' = im
// kostenlosen Kontingent des Providers nutzbar, 'paid' = direkt kostenpflichtig.
const DEFAULT_MODELS = [
  // Copilot CLI (provider: 'copilot')
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5', provider: 'copilot', tier: 'aic' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', provider: 'copilot', tier: 'aic' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', short: 'Opus 4.6', provider: 'copilot', tier: 'aic' },
  { id: 'claude-opus-4.8', label: 'Claude Opus 4.8', short: 'Opus 4.8', provider: 'copilot', tier: 'aic' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', short: 'GPT-5.3', provider: 'copilot', tier: 'aic' },
  // Claude Code (provider: 'claude-code') — billed via the Claude subscription
  // (CLI login, no API key). The adapter uses ALIASES (default/sonnet/opus/haiku),
  // not full model ids; the real list is discovered via ACP and replaces these.
  // These alias labels are only a pre-discovery fallback and go stale as soon as
  // an alias starts pointing at a newer model — the ACP-discovered list (which
  // takes precedence everywhere) carries the authoritative names.
  { id: 'default', label: 'Default (Sonnet 5)', short: 'Sonnet 5', provider: 'claude-code', tier: 'sub' },
  { id: 'sonnet', label: 'Sonnet 5', short: 'Sonnet 5', provider: 'claude-code', tier: 'sub' },
  { id: 'opus', label: 'Opus 5', short: 'Opus 5', provider: 'claude-code', tier: 'sub' },
  { id: 'haiku', label: 'Haiku 4.5', short: 'Haiku 4.5', provider: 'claude-code', tier: 'sub' },
  // Claude Code over SSH (provider: 'claude-code-ssh') — same adapter and the
  // same aliases, but spawned on a remote host so the session lives there and
  // can be resumed from any terminal on that machine. Same pre-discovery
  // fallback caveat as above.
  { id: 'default', label: 'Default (Sonnet 5)', short: 'Sonnet 5', provider: 'claude-code-ssh', tier: 'sub' },
  { id: 'sonnet', label: 'Sonnet 5', short: 'Sonnet 5', provider: 'claude-code-ssh', tier: 'sub' },
  { id: 'opus', label: 'Opus 5', short: 'Opus 5', provider: 'claude-code-ssh', tier: 'sub' },
  { id: 'haiku', label: 'Haiku 4.5', short: 'Haiku 4.5', provider: 'claude-code-ssh', tier: 'sub' },
  // Anthropic API (provider: 'anthropic') — benötigt API-Key in den Einstellungen
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', short: 'Haiku 4.5', provider: 'anthropic', tier: 'paid' },
  // TODO: Claude 5 (claude-sonnet-5 / claude-opus-5) hier ergänzen, sobald
  // Preise + Kontextfenster in renderer-logic.js MODEL_PRICES/MODEL_PROVIDER
  // und anthropic-provider.js gepflegt sind — sonst greift für sie keine
  // Kostenschätzung. Die API-Modell-Discovery liefert sie ohnehin bereits.
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', provider: 'anthropic', tier: 'paid' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', short: 'Opus 4.8', provider: 'anthropic', tier: 'paid' },
  // Google Gemini API (provider: 'gemini') — benötigt API-Key in den Einstellungen.
  // Nur der Fallback vor der ersten echten Discovery (siehe refreshAllProviderModels/
  // applyDynamicModels) — sobald ein Key gesetzt ist, ersetzt die Liste des Accounts
  // diese drei Einträge. Aktualisiert 2026-09-14 gegen die offizielle Modell-/
  // Preisliste (vorher: 2.5-pro, 2.5-flash, 3.5-flash — 3.5-flash war bereits von
  // 3.8-flash abgelöst).
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', short: 'Gemini Pro', provider: 'gemini', tier: 'paid' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', short: 'Gemini Flash', provider: 'gemini', tier: 'free' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', short: 'Gemini Flash-Lite', provider: 'gemini', tier: 'free' },
  // OpenAI API (provider: 'openai') — benötigt API-Key
  { id: 'gpt-5.1', label: 'GPT-5.1', short: 'GPT-5.1', provider: 'openai', tier: 'paid' },
  { id: 'gpt-5.1-mini', label: 'GPT-5.1 mini', short: 'GPT-5.1 mini', provider: 'openai', tier: 'paid' },
  { id: 'gpt-4.1', label: 'GPT-4.1', short: 'GPT-4.1', provider: 'openai', tier: 'paid' },
  // GLM / Zhipu (provider: 'glm') — benötigt API-Key
  { id: 'glm-4.6', label: 'GLM-4.6', short: 'GLM-4.6', provider: 'glm', tier: 'paid' },
  { id: 'glm-4.5', label: 'GLM-4.5', short: 'GLM-4.5', provider: 'glm', tier: 'paid' },
  { id: 'glm-4.5-air', label: 'GLM-4.5 Air', short: 'GLM-4.5 Air', provider: 'glm', tier: 'paid' },
  // Ollama (provider: 'ollama') — lokal, kein Key, kostenlos
  { id: 'llama3.1', label: 'Llama 3.1 (Ollama)', short: 'Llama 3.1', provider: 'ollama', tier: 'free' },
  { id: 'qwen2.5-coder', label: 'Qwen2.5 Coder (Ollama)', short: 'Qwen2.5 Coder', provider: 'ollama', tier: 'free' },
  { id: 'gpt-oss:20b', label: 'gpt-oss 20B (Ollama)', short: 'gpt-oss 20B', provider: 'ollama', tier: 'free' },
];

// Badge-Markup für die Modell-Kennzeichnung (kostenpflichtig / kostenlos / AIC).
const MODEL_TIER_BADGE = {
  paid: '<span class="model-tier model-tier--paid" data-tooltip="Direkt kostenpflichtig (Abrechnung pro Token beim Provider)">💲 kostenpflichtig</span>',
  free: '<span class="model-tier model-tier--free" data-tooltip="Im kostenlosen Kontingent des Providers nutzbar">🆓 kostenlos</span>',
  aic: '<span class="model-tier model-tier--aic" data-tooltip="Abrechnung über dein GitHub-Copilot-Abo / AI Credits">AIC</span>',
  sub: '<span class="model-tier model-tier--aic" data-tooltip="Über dein Claude-Abo abgerechnet (kein Token-Preis)">Abo</span>',
};
function modelTierBadge(model) {
  return model && model.tier ? (MODEL_TIER_BADGE[model.tier] || '') : '';
}

const PROVIDER_LABELS = {
  copilot: 'GitHub Copilot',
  'claude-code': 'Claude Code',
  'claude-code-ssh': 'Claude Code (SSH)',
  anthropic: 'Anthropic API',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama (lokal)',
  glm: 'GLM (Zhipu)',
};

// Shorter labels for the settings dialog's tab bar specifically — up to one
// per connected provider, so keeping these tight matters more there than in
// the model dropdown/provider list (which use the full PROVIDER_LABELS).
const SETTINGS_TAB_LABELS = {
  'claude-code-ssh': 'CC (SSH)',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  glm: 'GLM',
};

const PROVIDER_ICON = '🔌';

// Maturity markers per provider. Beta = tested but not final; Alpha = untested.
// Copilot is the primary, fully-tested provider and carries no badge.
const BETA_PROVIDERS = new Set(['gemini']);
const ALPHA_PROVIDERS = new Set(['anthropic', 'openai', 'glm', 'ollama', 'claude-code-ssh']);

/** Maturity badge (Alpha/Beta) HTML for a provider, or '' for none. */
function providerStageBadge(provider) {
  if (BETA_PROVIDERS.has(provider)) {
    return ' <span class="beta-badge" title="Getestet nicht final">Beta</span>';
  }
  if (ALPHA_PROVIDERS.has(provider)) {
    return ' <span class="alpha-badge" title="Nicht getestet">Alpha</span>';
  }
  return '';
}

/** Providers that have selectable models (in display order). */
function getProvidersWithModels() {
  const seen = [];
  for (const m of DEFAULT_MODELS) {
    const p = m.provider || 'copilot';
    if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

/** The configured default provider for new tabs (falls back to copilot). */
function getDefaultProvider() {
  const p = getSettings().defaultProvider;
  return getProvidersWithModels().includes(p) ? p : 'copilot';
}

// Sensible out-of-box default model per provider (used when the user hasn't
// chosen one in settings). Copilot intentionally defaults to Sonnet, NOT the
// first list entry (Haiku) — see DEFAULT_MODEL_ID.
const PROVIDER_DEFAULT_MODEL = {
  copilot: DEFAULT_MODEL_ID,        // claude-sonnet-4.6
  'claude-code': 'claude-sonnet-5', // refined once ACP reports the real models
  'claude-code-ssh': 'claude-sonnet-5',
  anthropic: 'claude-opus-4-8',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5.1',
  glm: 'glm-4.6',
  ollama: 'llama3.1',
};

/**
 * Default model for a provider: the user-configured choice if valid, else a
 * sensible per-provider default, else the first model of that provider. Used by
 * the "+" menu and new-tab creation.
 */
function getDefaultModelForProvider(provider) {
  // Validate against the provider's ACTUAL model list (incl. dynamically
  // discovered Copilot/API models), not just the hardcoded DEFAULT_MODELS —
  // otherwise a configured default that is a discovered model is wrongly rejected.
  const valid = (id) => id && getModelsForProvider(provider).some(m => m.id === id);
  const configured = (getSettings().defaultModels || {})[provider];
  if (valid(configured)) return configured;
  // Claude Code: don't force a model — let the ACP adapter use its own default
  // (the subscription default) unless the user explicitly configured one. Forcing
  // an id we're unsure about would make the adapter reject the prompt.
  if (isClaudeCodeProvider(provider)) return '';
  if (valid(PROVIDER_DEFAULT_MODEL[provider])) return PROVIDER_DEFAULT_MODEL[provider];
  const m = DEFAULT_MODELS.find(x => (x.provider || 'copilot') === provider);
  if (m) return m.id;
  // No known model for this provider yet (e.g. Claude Code before ACP discovery).
  // Return '' so the backend uses its own default instead of a foreign model id
  // (forcing a Copilot id like claude-sonnet-4.6 makes Claude Code reject it).
  return '';
}

/** Persist the default model for one provider. */
function saveDefaultModelForProvider(provider, modelId) {
  const map = { ...(getSettings().defaultModels || {}) };
  map[provider] = modelId;
  saveSetting('defaultModels', map);
}

/**
 * Reasoning effort a new tab of this provider starts on. One value per
 * provider rather than per model: there is only ever one default model per
 * provider, and the effort set is the same fixed list for every model — so a
 * per-model map would store the same answer under many keys.
 * @param {string} provider
 * @returns {string|null} null = "Standard" (backend's own default)
 */
function getDefaultReasoningForProvider(provider) {
  const map = getSettings().defaultReasoning || {};
  return normalizeKnownReasoningEffort(map[provider]);
}

function saveDefaultReasoningForProvider(provider, effort) {
  const map = { ...(getSettings().defaultReasoning || {}) };
  map[provider] = normalizeKnownReasoningEffort(effort);
  saveSetting('defaultReasoning', map);
}

/**
 * The mode a provider was last set to, remembered across restarts. Validated
 * against the provider's known modes (an ACP provider whose modes aren't
 * discovered yet trusts the saved id — modes_available corrects an invalid one).
 * @param {string} provider
 * @returns {string|null}
 */
function getSavedModeForProvider(provider) {
  const saved = (getPref('lastModes', {}) || {})[provider];
  return pickSavedMode(saved, getModesForProvider(provider));
}

/** Remember the mode a provider was last set to (persisted to preferences). */
function saveModeForProvider(provider, modeId) {
  const map = { ...(getPref('lastModes', {}) || {}) };
  map[provider] = modeId;
  setPref('lastModes', map);
}

const MODEL_TIER_TEXT = { paid: ' (kostenpflichtig)', free: ' (kostenlos)', aic: ' (AIC)', sub: ' (Abo)' };

/** Render the global "default provider" (which provider new tabs/"+" start with) select. */
function renderDefaultModelSettings() {
  const provSel = document.getElementById('settDefaultProvider');
  if (!provSel) return;
  const providers = getProvidersWithModels();
  provSel.innerHTML = providers
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(PROVIDER_SHORT[p] || p)}</option>`)
    .join('');
  provSel.value = getDefaultProvider();
}

/**
 * Fills one provider's "default model" <select> (used both by Copilot's static
 * settings tab and by each dynamically-generated provider-config tab, so the
 * per-provider default model setting lives in that provider's own tab instead
 * of one long combined list).
 * @param {string} provider
 * @param {HTMLSelectElement} sel
 */
/**
 * Fills one provider's "default reasoning" <select>. Shared by Copilot's static
 * settings tab and the dynamically generated provider tabs, so both offer the
 * same options and persist them the same way.
 * @param {string} provider
 * @param {HTMLSelectElement|null} sel
 */
function renderProviderReasoningSelect(provider, sel) {
  if (!sel) return;
  sel.innerHTML = REASONING_EFFORTS
    .map(o => `<option value="${escapeAttr(o.value || '')}">${escapeHtml(o.label)}</option>`)
    .join('');
  sel.value = getDefaultReasoningForProvider(provider) || '';
  sel.addEventListener('change', () => saveDefaultReasoningForProvider(provider, sel.value || null));
}

function renderProviderModelSelect(provider, sel) {
  if (!sel) return;
  sel.innerHTML = getModelsForProvider(provider)
    .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${MODEL_TIER_TEXT[m.tier] || ''}</option>`)
    .join('');
  sel.value = getDefaultModelForProvider(provider);
  sel.addEventListener('change', () => saveDefaultModelForProvider(provider, sel.value));
}

/**
 * Dynamically discovered models per provider. Copilot models arrive via ACP; the
 * direct-API providers are polled via providers:listModels. When a provider has
 * an entry here it replaces that provider's hardcoded list, so the dropdown
 * reflects the account's actually-available models.
 * @type {Object<string, Array<{id:string,label:string,short:string,provider:string,tier:string}>>}
 */
const _dynamicModels = {};

/** Default cost tier for freshly-discovered models, by provider. */
const PROVIDER_DEFAULT_TIER = {
  copilot: 'aic', 'claude-code': 'sub', 'claude-code-ssh': 'sub', ollama: 'free', anthropic: 'paid', openai: 'paid', gemini: 'paid', glm: 'paid',
};
// tierForDiscoveredModel() itself lives in renderer-logic.js (pure, unit-tested;
// destructured from window.RendererLogic near the other usage-display helpers below).

/**
 * Merge a freshly discovered model list for a provider: normalize to the internal
 * shape, announce models we've never seen before, persist, and refresh the UI.
 * @param {string} provider
 * @param {Array<{id:string,name?:string}>} models - raw {id,name} pairs
 */
function applyDynamicModels(provider, models) {
  if (!Array.isArray(models) || !models.length) return;
  const mapped = models
    .filter(m => m && m.id)
    .map(m => ({ id: m.id, label: m.name || m.id, short: m.name || m.id, provider, tier: window.RendererLogic.tierForDiscoveredModel(provider, m.id, PROVIDER_DEFAULT_TIER) }));
  if (!mapped.length) return;

  // "New" = neither in the hardcoded list nor in the previously-known dynamic
  // list. The very first discovery for a provider is treated as initial
  // population (no notification); only genuinely new arrivals later are announced.
  const hadPrevious = Array.isArray(_dynamicModels[provider]) && _dynamicModels[provider].length > 0;
  const known = new Set([
    ...DEFAULT_MODELS.filter(m => (m.provider || 'copilot') === provider).map(m => m.id),
    ...((_dynamicModels[provider] || []).map(m => m.id)),
  ]);
  const fresh = mapped.filter(m => !known.has(m.id));

  _dynamicModels[provider] = mapped;
  setPref('dynamicModels', _dynamicModels);

  if (hadPrevious && fresh.length) {
    const names = fresh.map(m => m.short).slice(0, 4).join(', ');
    const more = fresh.length > 4 ? ` +${fresh.length - 4}` : '';
    showNotification(`🆕 Neues Modell bei ${PROVIDER_SHORT[provider] || provider}: ${names}${more}`, 'info');
  }

  updateModelSelectBtn(activeTabId);
  if (document.getElementById('settDefaultProvider')) renderDefaultModelSettings();
}

/** Merge the CLI-reported Copilot models into the selectable list (via ACP). */
function updateCopilotModels(models) {
  applyDynamicModels('copilot', models);
}

/** Load persisted dynamic models (incl. the legacy Copilot-only list) at startup. */
function initCopilotModels() {
  const stored = getPref('dynamicModels', null);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [prov, list] of Object.entries(stored)) {
      if (Array.isArray(list) && list.length) _dynamicModels[prov] = list;
    }
  }
  // Back-compat: older builds stored only the Copilot list under 'copilotModels'.
  if (!_dynamicModels.copilot) {
    const legacy = getPref('copilotModels', null);
    if (Array.isArray(legacy) && legacy.length) _dynamicModels.copilot = legacy;
  }
  // Restore discovered session modes per provider so the mode dropdown has content
  // before the first prompt (e.g. Claude Code's modes after a restart).
  const storedModes = getPref('dynamicModes', null);
  if (storedModes && typeof storedModes === 'object' && !Array.isArray(storedModes)) {
    for (const [prov, list] of Object.entries(storedModes)) {
      if (Array.isArray(list) && list.length) _dynamicModes[prov] = list;
    }
  }
}

/**
 * Fetch a direct-API provider's current models and merge them in. Best-effort:
 * failures (no key, offline, unsupported endpoint) leave the hardcoded list intact.
 * @param {string} provider
 */
async function refreshProviderModels(provider) {
  if (provider === 'copilot') return; // Copilot models arrive via ACP, not here.
  try {
    const res = await desktop.providers.listModels(provider);
    if (res && res.ok && Array.isArray(res.models) && res.models.length) {
      applyDynamicModels(provider, res.models);
    }
  } catch (_) { /* discovery is best-effort */ }
}

/** Discover models for every direct-API provider that has a key (or is keyless). */
async function refreshAllProviderModels() {
  const KEYLESS = new Set(['ollama']);
  let status = null;
  try { status = await desktop.providers.status(); } catch (_) { /* ignore */ }
  const keyed = (status && status.keyed) || {};
  for (const p of ['anthropic', 'gemini', 'openai', 'glm', 'ollama']) {
    if (KEYLESS.has(p) || keyed[p]) refreshProviderModels(p);
  }
}

/**
 * Whether a Copilot model is currently offered by the CLI. Permissive when we
 * have no dynamic list yet (the static fallback list is in use).
 * @param {string} modelId
 */
function isCopilotModelAvailable(modelId) {
  const list = _dynamicModels.copilot;
  if (!list || !list.length) return true;
  return list.some(m => m.id === modelId);
}

/**
 * Whether paid models should be offered for a provider. Persisted per provider
 * (object, not a flat bool) so this generalizes if another provider ever gets
 * a real free/paid split — today only Gemini's config panel exposes the
 * toggle. Defaults to true (show everything) so this ships without changing
 * anyone's dropdown until they actively turn it off.
 */
function getShowPaidModels(provider) {
  const all = getPref('showPaidModels', {});
  return (all && typeof all === 'object' && all[provider]) !== false;
}

function setShowPaidModels(provider, value) {
  const all = getPref('showPaidModels', {});
  const next = (all && typeof all === 'object' && !Array.isArray(all)) ? { ...all } : {};
  next[provider] = value;
  setPref('showPaidModels', next);
}

/** Models belonging to a given provider (the dynamic list wins when known). */
function getModelsForProvider(provider) {
  const dyn = _dynamicModels[provider];
  const list = (dyn && dyn.length) ? dyn : DEFAULT_MODELS.filter(m => (m.provider || 'copilot') === provider);
  // Gemini-only for now: it's the one provider whose discovered list mixes
  // free and paid models AND iterates fast enough (new Flash point release
  // every few weeks) that near-duplicate versions pile up. filterGeminiModels()
  // always collapses same-family point releases to the newest AND additionally
  // hides paid ones when the toggle is off — two independent rules, not one.
  if (provider === 'gemini') return window.RendererLogic.filterGeminiModels(list, getShowPaidModels('gemini'));
  return list;
}

/**
 * The provider of a tab, always derived from its selected model (the model is
 * the single source of truth; the provider is implied by it).
 */
function getTabProvider(tab) {
  // The tab's explicit ProviderID is authoritative; fall back to deriving it from
  // the model only for legacy tabs that predate the provider field.
  return tab?.provider
    || window.RendererLogic.getModelProvider(tab?.selectedModel || '')
    || 'copilot';
}

/**
 * The reasoning-effort value stored for a model on this tab, validated
 * against the fixed low/medium/high/xhigh/max set — the same set for every
 * provider that supports reasoning (Copilot, Claude Code).
 */
function getReasoningForModel(tab, modelId) {
  if (!tab || !modelId) return null;
  return normalizeKnownReasoningEffort(tab.reasoningByModel?.[modelId]);
}

/**
 * Select a model and, for Copilot and Claude Code tabs, its remembered
 * reasoning level. A model click without an explicit effort restores the
 * model's existing mapping and records Standard when the model has no
 * mapping yet.
 */
function selectModelForTab(tabId, modelId, effort) {
  const tab = tabs.get(tabId);
  if (!tab || !modelId) return;

  tab.selectedModel = modelId;
  tab.reasoningByModel = normalizeReasoningByModel(tab.reasoningByModel);
  const provider = getTabProvider(tab);
  if (providerHasReasoning(provider)) {
    const selectedEffort = effort === undefined
      ? getReasoningForModel(tab, modelId)
      : normalizeKnownReasoningEffort(effort);
    tab.reasoningByModel[modelId] = selectedEffort;
  }

  if (tab.sessionId) saveSessionModelConfiguration(tab.sessionId, tab);
  saveOpenTabs();
  updateModelSelectBtn(tabId);
}

const PROVIDER_SHORT = { copilot: 'Copilot', 'claude-code': 'Claude Code', 'claude-code-ssh': 'CC (SSH)', anthropic: 'Anthropic', gemini: 'Gemini', openai: 'OpenAI', ollama: 'Ollama', glm: 'GLM' };

/** Inline brand-icon HTML for a provider (via provider-icons.js). */
function providerIconHtml(provider, cls) {
  return window.ProviderIcons ? window.ProviderIcons.iconSvg(provider, cls) : '';
}

/**
 * Both Claude Code variants: the local one and the SSH one, which run the same
 * adapter against the same subscription and differ only in WHERE the process
 * lives. Use this for behaviour that follows from "this is Claude Code"
 * (billing, session semantics, UI affordances) — not for anything that touches
 * the local filesystem or the local CLI, since for the SSH variant those live
 * on the remote host (see the history/instructions/status branches, which stay
 * deliberately local-only).
 */
function isClaudeCodeProvider(provider) {
  return provider === 'claude-code' || provider === 'claude-code-ssh';
}

/**
 * Configured SSH target for the remote Claude Code provider ('' if unset).
 * Stored top-level in preferences (not under `settings`) so it matches how
 * main.js reads it — see getClaudeCodeSshHost() there.
 * @returns {string}
 */
function getClaudeCodeSshHost() {
  return String(getPref('claudeCodeSshHost', '') || '').trim();
}

/** Default working directory ON THE REMOTE HOST for new SSH tabs ('' if unset). */
function getClaudeCodeSshCwd() {
  return String(getPref('claudeCodeSshCwd', '') || '').trim();
}

/** ACP-based backends (CLI/adapter over stdio), as opposed to direct-API providers. */
function isAcpProvider(provider) {
  return provider === 'copilot' || isClaudeCodeProvider(provider);
}

/**
 * Whether a provider offers a reasoning-effort choice. Currently the same set
 * as isAcpProvider(), but deliberately its own predicate: that one is about
 * *how* a backend is driven, this one about a model capability — the direct-API
 * providers could gain reasoning without becoming ACP backends.
 */
function providerHasReasoning(provider) {
  return provider === 'copilot' || isClaudeCodeProvider(provider);
}

/** Whether a provider is billed via a subscription (no per-token USD cost). */
function isSubscriptionProvider(provider) {
  return isClaudeCodeProvider(provider);
}

// Which app features each provider actually supports. This is the single source
// of truth: the sidebar hides unsupported skills/agents/MCP sections and the tab
// rename button while a tab of that provider is active, and the settings
// "Features" panel renders the same data as a comparison matrix.
// (Claude Code and the direct-API providers use the app's own lazy-loaded
// per-provider Skills/Agents (see LAZY_CONTEXT_PROVIDERS in main.js) — Gemini
// is deliberately excluded to keep it context-light. MCP and Marketplace stay
// Copilot-only; the Copilot CLI supports the full feature set. Instructions
// covers two different underlying mechanisms, both editable in-app: Copilot
// and Claude Code each get a single native global file (copilot-instructions.md
// / CLAUDE.md, an editor convenience in their own settings tab — the CLI
// itself discovers these, we don't inject anything); the direct-API providers
// instead get multiple toggle-free `*.instructions.md` files under their own
// ~/.agent-desktop/<provider>/instructions/ (see INSTRUCTIONS_PROVIDERS in
// main.js), always fully inlined, no sidebar section. Only Gemini has neither.
// denylist marks which providers get a per-provider "Verbotene Shell-Tools"
// list in their own settings tab — only providers with an own shell tool we
// enforce this against: Gemini has no shell tool at all (file tools only),
// Claude Code has its own approval mechanism and is unaffected by our deny
// lists.)
const PROVIDER_CAPABILITIES = {
  copilot:       { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: true,  sessions: true,  marketplace: true,  denylist: true },
  'claude-code': { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: true,  marketplace: false, denylist: false },
  // Same as claude-code, minus everything that reads the LOCAL filesystem:
  // skills/agents/instructions all live on the remote host, so the app can't
  // list or edit them from here (Claude Code itself still discovers them over
  // there — they're just not surfaced in this UI yet).
  'claude-code-ssh': { models: true, modes: true, tools: true, context: true, costs: true, skills: false, agents: false, instructions: false, mcp: false, sessions: true, marketplace: false, denylist: false },
  anthropic:     { models: true, modes: true,  tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  openai:        { models: true, modes: false, tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  gemini:        { models: true, modes: false, tools: true, context: true, costs: true,  skills: false, agents: false, instructions: false, mcp: false, sessions: true,  marketplace: false, denylist: false },
  glm:           { models: true, modes: false, tools: true, context: true, costs: true,  skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
  ollama:        { models: true, modes: false, tools: true, context: true, costs: false, skills: true,  agents: true,  instructions: true,  mcp: false, sessions: false, marketplace: false, denylist: true },
};

// Feature metadata for the settings comparison matrix (label + icon + hint).
const PROVIDER_FEATURE_META = [
  { key: 'models',       icon: '🧠', label: 'Modellauswahl', hint: 'Zwischen mehreren Modellen des Providers wählen.' },
  { key: 'modes',        icon: '⚙️', label: 'Modi',          hint: 'Betriebs-/Denkmodi (z.B. Reasoning, Agent-Modi).' },
  { key: 'tools',        icon: '🔧', label: 'Toolverwendung', hint: 'Ausführung von Tools/Funktionen (Dateien, Shell …).' },
  { key: 'context',      icon: '📏', label: 'Kontext',        hint: 'Kontextauslastung wird angezeigt/verwaltet.' },
  { key: 'costs',        icon: '💰', label: 'Kosten',         hint: 'Kosten-/Token-Tracking verfügbar.' },
  { key: 'skills',       icon: '🧩', label: 'Skills',         hint: 'SKILL.md-basierte KI-Skills.' },
  { key: 'agents',       icon: '🤖', label: 'Agents',         hint: 'Wiederverwendbare Agent-Definitionen.' },
  { key: 'instructions', icon: '📋', label: 'Instructions',  hint: 'Bearbeitbare Instructions-Datei(en) für das Modell (nativ bei Copilot/Claude Code, mehrere togglebare Sets bei Direkt-API-Providern).' },
  { key: 'mcp',          icon: '🔌', label: 'MCP',            hint: 'Model-Context-Protocol-Server.' },
  { key: 'sessions',     icon: '💾', label: 'Sessions speichern', hint: 'Gesprächsverlauf persistent speichern/fortsetzen.' },
  { key: 'marketplace',  icon: '🛒', label: 'Marketplace',    hint: 'Erweiterungen/Extensions aus dem Marketplace.' },
  { key: 'denylist',     icon: '🚫', label: 'Tool-Verbote',   hint: 'Eigene Liste blockierter Shell-Befehle pro Provider.' },
];

// Providers shown as columns in the feature matrix (order matters).
const PROVIDER_MATRIX_ORDER = ['copilot', 'claude-code', 'claude-code-ssh', 'anthropic', 'openai', 'gemini', 'glm', 'ollama'];

/** Whether a provider supports a given app feature (default true if unknown). */
function providerSupports(provider, feature) {
  const caps = PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.copilot;
  return caps[feature] !== false;
}

/** Render the provider feature comparison matrix into the settings panel. */
function renderFeatureMatrix() {
  const container = document.getElementById('featuresMatrix');
  if (!container) return;
  const providers = PROVIDER_MATRIX_ORDER.filter((p) => PROVIDER_CAPABILITIES[p]);
  const head = providers.map((p) =>
    `<th class="feature-matrix__provider" data-tooltip="${escapeAttr(PROVIDER_SHORT[p] || p)}">` +
      `<span class="feature-matrix__provider-icon">${providerIconHtml(p)}</span>` +
      `<span class="feature-matrix__provider-name">${escapeHtml(PROVIDER_SHORT[p] || p)}</span>` +
    '</th>').join('');
  const rows = PROVIDER_FEATURE_META.map((f) => {
    const cells = providers.map((p) => {
      const ok = providerSupports(p, f.key);
      return `<td class="feature-matrix__cell feature-matrix__cell--${ok ? 'yes' : 'no'}" data-tooltip="${escapeAttr((PROVIDER_SHORT[p] || p) + ': ' + f.label + (ok ? ' ✓' : ' — noch nicht'))}">${ok ? '✓' : '—'}</td>`;
    }).join('');
    return `<tr><th class="feature-matrix__feature" data-tooltip="${escapeAttr(f.hint)}"><span class="feature-matrix__feature-icon">${f.icon}</span>${escapeHtml(f.label)}</th>${cells}</tr>`;
  }).join('');
  container.innerHTML =
    '<table class="feature-matrix">' +
      `<thead><tr><th class="feature-matrix__corner">Feature</th>${head}</tr></thead>` +
      `<tbody>${rows}</tbody>` +
    '</table>';
}

/** Show/hide sidebar sections based on the active provider's capabilities. */
function updateSidebarForProvider(provider) {
  // Sessions stay visible for every provider (needed to resume other providers'
  // sessions); session *saving* is gated separately on the tab rename button.
  const sections = { skills: 'skillsSection', agents: 'agentsSection', mcp: 'mcpSection' };
  for (const [feature, id] of Object.entries(sections)) {
    const el = document.getElementById(id);
    if (el) el.style.display = providerSupports(provider, feature) ? '' : 'none';
  }
}

/** Update the read-only provider label (shown next to the cost) for a tab. */
function updateProviderSelectBtn(tabId) {
  const el = document.getElementById('sessionProvider');
  if (!el) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const provider = getTabProvider(tab);
  el.innerHTML = `${providerIconHtml(provider)} ${escapeHtml(PROVIDER_SHORT[provider] || provider)}${providerStageBadge(provider)}`;
  // Subtle accent for non-default (direct-API) providers.
  el.classList.toggle('session-actions__provider--api', provider !== 'copilot');
  updateGeminiModeBtn(tabId);
}

const GEMINI_MODE_LABELS = {
  search: '🔍 Recherche',
  files: '📁 Dateien',
};

/**
 * Show/refresh the Gemini tool-mode toggle. Only visible for Gemini tabs on a
 * model that actually needs the choice — Gemini 3.x combines live search and
 * file tools in one request (see isGemini3Model()/gemini-provider.js), so
 * there's nothing left to toggle there; only 2.5-era models still need it.
 */
function updateGeminiModeBtn(tabId) {
  const wrapper = document.getElementById('geminiModeWrapper');
  const btn = document.getElementById('btnGeminiMode');
  if (!wrapper || !btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const isGemini = tab && getTabProvider(tab) === 'gemini';
  const needsToggle = isGemini && !window.RendererLogic.isGemini3Model(tab.selectedModel);
  wrapper.style.display = needsToggle ? '' : 'none';
  if (!needsToggle) return;
  const mode = tab.geminiMode || 'search';
  btn.textContent = GEMINI_MODE_LABELS[mode] || GEMINI_MODE_LABELS.search;
}

/** Wire the Gemini mode toggle (switches the active tab between search/files). */
function initGeminiModeToggle() {
  const btn = document.getElementById('btnGeminiMode');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const tab = tabs.get(activeTabId);
    if (!tab || getTabProvider(tab) !== 'gemini') return;
    tab.geminiMode = (tab.geminiMode || 'search') === 'search' ? 'files' : 'search';
    updateGeminiModeBtn(activeTabId);
    const label = tab.geminiMode === 'search'
      ? 'Gemini: Live-Suche aktiv (Datei-Tools aus).'
      : 'Gemini: Datei-Tools aktiv (Live-Suche aus).';
    showNotification(label, 'info');
  });
}

/** @type {{available: boolean, keyed: Object<string,boolean>}} Cached provider key status. */
let _providerStatus = { available: false, keyed: {} };

async function refreshProviderStatus() {
  try {
    _providerStatus = await window.desktop.providers.status();
  } catch (e) {
    console.warn('[providers] status fehlgeschlagen:', e?.message);
  }
}

function getAvailableModels() {
  return DEFAULT_MODELS;
}

// ── Session Modes (Agent / Plan / Autopilot) ──────────────────
const DEFAULT_MODE_ID = 'agent';
const SESSION_MODES = [
  { id: 'agent', label: 'Agent', short: '🤖 Agent', desc: 'Standard — dialogorientiert' },
  { id: 'plan', label: 'Plan', short: '📋 Plan', desc: 'Plant mehrstufige Aufgaben' },
  { id: 'autopilot', label: 'Autopilot', short: '🚀 Autopilot', desc: 'Autonom bis Task-Abschluss (experimentell)' },
];

// Session modes discovered per provider via ACP (Claude Code reports its own
// permission modes: default/acceptEdits/plan/bypassPermissions/…).
const _dynamicModes = {};

/** Modes selectable for a provider (discovered list wins; Copilot has a static one). */
function getModesForProvider(provider) {
  const dyn = _dynamicModes[provider];
  if (dyn && dyn.length) return dyn;
  return provider === 'copilot' ? SESSION_MODES : [];
}

/**
 * Update the tab-header mode select button to reflect the active tab's mode.
 * @param {string} [tabId]
 */
function updateModeSelectBtn(tabId) {
  const btn = document.getElementById('btnModeSelect');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const modes = getModesForProvider(tab ? getTabProvider(tab) : 'copilot');
  const modeId = tab?.mode || DEFAULT_MODE_ID;
  const found = modes.find(m => m.id === modeId);
  btn.textContent = found ? found.short : '🤖 Agent';
  // Highlight when not on the provider's first/default mode.
  btn.classList.toggle('session-actions__btn--active', !!found && modes[0] && found.id !== modes[0].id);
}

/**
 * The default model new tabs start with: the default model of the configured
 * default provider. Falls back to legacy `defaultModel` / DEFAULT_MODEL_ID.
 * @returns {string}
 */
function getDefaultModelId() {
  // Per-provider default of the configured default provider (#2 + #3).
  const byProvider = getDefaultModelForProvider(getDefaultProvider());
  if (byProvider) return byProvider;
  // Legacy single-default fallback.
  const configured = getSettings().defaultModel;
  return DEFAULT_MODELS.some(m => m.id === configured) ? configured : DEFAULT_MODEL_ID;
}

/**
 * Update the tab-header model select button to reflect the active tab's
 * selected model state. Called on tab switch and after model selection.
 */
function updateModelSelectBtn(tabId) {
  const btn = document.getElementById('btnModelSelect');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  const provider = getTabProvider(tab);
  // Explicit selection takes priority, fallback to actual model from session,
  // then DEFAULT_MODEL_ID — so modelId is always a non-empty string.
  const modelId = tab?.selectedModel || tab?.context?.model || DEFAULT_MODEL_ID;
  // Discovered models win over the hardcoded fallback list — same precedence as
  // getModelsForProvider(). The other way round, a stale hardcoded label shadows
  // the live one for ids that exist in both: Claude Code's aliases ('opus',
  // 'sonnet', …) never change, but what they point at does, so the button kept
  // showing e.g. "Opus 4.8" long after the adapter reported Opus 5.
  const found = getModelsForProvider(provider).find(m => m.id === modelId)
    || Object.values(_dynamicModels).flat().find(m => m.id === modelId)
    || DEFAULT_MODELS.find(m => m.id === modelId);
  const modelLabel = found ? found.short : modelId;
  // Claude Code shows the same 🧠-badge as Copilot — same fixed reasoning set
  // for both, no per-model discovery needed.
  const hasEffortUi = providerHasReasoning(provider);
  const effort = hasEffortUi ? getReasoningForModel(tab, tab?.selectedModel || modelId) : null;
  const effortLabel = reasoningEffortLabel(effort);
  btn.innerHTML = `🧠 ${escapeHtml(modelLabel)}${hasEffortUi ? ` <span class="model-select__reasoning">${escapeHtml(effortLabel)}</span>` : ''}`;
  btn.setAttribute('data-tooltip', hasEffortUi
    ? `Model und Reasoning für diesen Tab auswählen (aktuell: ${effortLabel})`
    : 'Model für diesen Tab auswählen');
  btn.classList.remove('session-actions__btn--active');
  updateProviderSelectBtn(tabId);
  updateApprovalBtn(tabId);
  updateProviderSpecificControls(tabId);
}

/**
 * Hide the session tools deny-list for Claude Code (it governs permissions via
 * its mode/permission prompts, not --deny-tool). The mode dropdown IS shown for
 * Claude Code — it carries the provider's own discovered modes.
 * @param {string} [tabId]
 */
function updateProviderSpecificControls(tabId) {
  const tab = tabs.get(tabId ?? activeTabId);
  const provider = tab ? getTabProvider(tab) : 'copilot';
  const isClaudeCode = isClaudeCodeProvider(provider);
  const toolsWrap = document.getElementById('btnSessionTools')?.closest('.tools-popup-wrapper');
  if (toolsWrap) toolsWrap.style.display = isClaudeCode ? 'none' : '';
  // Hide sidebar sections the active provider doesn't support (skills/agents/MCP/sessions).
  updateSidebarForProvider(provider);
}

/**
 * Reflect the active tab's manual-approval state on the toggle button.
 * @param {string} [tabId]
 */
function updateApprovalBtn(tabId) {
  const btn = document.getElementById('btnApprovalToggle');
  if (!btn) return;
  const tab = tabs.get(tabId ?? activeTabId);
  // Only Copilot uses this app-side toggle. Claude Code has its own native
  // permission modes (default/acceptEdits/plan/bypassPermissions, selectable via
  // the mode button) which would otherwise fight with this blanket override.
  const wrapper = btn.closest('.model-select-wrapper') || btn;
  if (!tab || getTabProvider(tab) !== 'copilot') { wrapper.style.display = 'none'; return; }
  wrapper.style.display = '';
  const manual = tab?.manualApproval === true;
  btn.textContent = manual ? '🔒 Bestätigen' : '🔓 Auto';
  btn.classList.toggle('session-actions__btn--active', manual);
  btn.setAttribute('data-tooltip', manual
    ? 'Aktionen werden einzeln bestätigt (Dropup). Klick: alles erlauben'
    : 'Alles erlauben — keine Rückfragen. Klick: Bestätigen aktivieren');
}

/** Flip the active tab's manual-approval mode and apply it to the backend. */
async function toggleApproval(tabId) {
  const id = tabId ?? activeTabId;
  const tab = tabs.get(id);
  if (!tab) return;
  tab.manualApproval = !tab.manualApproval;
  if (tab.sessionId) saveSessionApproval(tab.sessionId, tab.manualApproval);
  updateApprovalBtn(id);
  if (tab.sessionId) {
    // Copilot restarts transparently (spawn flag); Claude Code applies live.
    try { await desktop.chat.setApproval(id, tab.manualApproval); } catch (_) { /* ignore */ }
  }
}

/**
 * Initialize the tab-specific model selector button in the session-actions bar.
 * Copilot model entries additionally expose a nested reasoning menu. Selecting
 * a reasoning level activates the model and stores the pair for this tab.
 */
function initTabModelSelector() {
  const btn = document.getElementById('btnModelSelect');
  if (!btn) return;

  let activeCloseHandler = null;
  let activeDropdown = null;

  const closeDropdown = () => {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    if (activeCloseHandler) {
      document.removeEventListener('click', activeCloseHandler, true);
      activeCloseHandler = null;
    }
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.model-dropdown--below');
    if (activeDropdown || existing) {
      closeDropdown();
      if (existing && existing !== activeDropdown) existing.remove();
      return;
    }

    const openedForTabId = activeTabId;
    const tab = tabs.get(openedForTabId);
    const currentModel = tab?.selectedModel || '';
    const provider = getTabProvider(tab);
    const hasReasoning = providerHasReasoning(provider);
    const models = getModelsForProvider(provider);

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below';
    activeDropdown = dropdown;

    models.forEach(m => {
      const isActive = currentModel === m.id;
      // Reasoning is the same fixed set for every model of a reasoning-capable
      // provider (Copilot, Claude Code) — no per-model/per-session discovery,
      // so every row gets the submenu, not just the currently active one.
      const showReasoning = hasReasoning;
      const item = document.createElement('div');
      item.className = 'model-dropdown__item'
        + (isActive ? ' model-dropdown__item--active' : '')
        + (showReasoning ? ' model-dropdown__item--has-submenu' : '');
      item.tabIndex = 0;

      const label = document.createElement('span');
      label.className = 'model-dropdown__label';
      label.textContent = m.label;
      item.appendChild(label);
      if (modelTierBadge(m)) item.insertAdjacentHTML('beforeend', modelTierBadge(m));

      if (showReasoning) {
        const effort = getReasoningForModel(tab, m.id);
        const effortEl = document.createElement('span');
        effortEl.className = 'model-dropdown__reasoning';
        effortEl.textContent = reasoningEffortLabel(effort);
        item.appendChild(effortEl);

        const arrow = document.createElement('span');
        arrow.className = 'model-dropdown__submenu-arrow';
        arrow.textContent = '›';
        item.appendChild(arrow);

        const submenu = document.createElement('div');
        submenu.className = 'model-dropdown__submenu';
        // Same fixed list for every reasoning-capable provider.
        REASONING_EFFORTS.forEach((option) => {
          const optionBtn = document.createElement('button');
          optionBtn.type = 'button';
          optionBtn.className = 'model-dropdown__submenu-item'
            + (effort === option.value ? ' model-dropdown__submenu-item--active' : '');
          optionBtn.innerHTML = `<span>${escapeHtml(option.label)}</span>${effort === option.value ? '<span class="model-dropdown__submenu-check">✓</span>' : ''}`;
          optionBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeDropdown();
            selectModelForTab(openedForTabId, m.id, option.value);
          });
          submenu.appendChild(optionBtn);
        });
        item.appendChild(submenu);
      }

      item.addEventListener('click', () => {
        closeDropdown();
        selectModelForTab(openedForTabId, m.id);
      });
      item.addEventListener('keydown', (event) => {
        if (event.target !== item || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        item.click();
      });
      dropdown.appendChild(item);
    });

    btn.closest('.model-select-wrapper').appendChild(dropdown);

    activeCloseHandler = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== btn) {
        closeDropdown();
      }
    };
    setTimeout(() => document.addEventListener('click', activeCloseHandler, true), 0);
  });
}

/**
 * Initialize the tab-specific mode selector (Agent / Plan / Autopilot).
 * Sets tab.mode, which is sent to the ACP process via session/set_mode on the
 * next sendMessage() call.
 */
function initTabModeSelector() {
  document.getElementById('btnApprovalToggle')?.addEventListener('click', () => toggleApproval(activeTabId));

  const btn = document.getElementById('btnModeSelect');
  if (!btn) return;

  let activeCloseHandler = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.mode-dropdown');
    if (existing) {
      existing.remove();
      if (activeCloseHandler) {
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
      return;
    }

    const openedForTabId = activeTabId;
    const tab = tabs.get(openedForTabId);
    const currentMode = tab?.mode || DEFAULT_MODE_ID;
    const modes = getModesForProvider(getTabProvider(tab));

    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown model-dropdown--below mode-dropdown';

    modes.forEach(m => {
      const isActive = currentMode === m.id;
      const item = document.createElement('div');
      item.className = 'model-dropdown__item' + (isActive ? ' model-dropdown__item--active' : '');
      item.innerHTML = `<span class="model-dropdown__label">${escapeHtml(m.short)}</span><span class="model-dropdown__desc">${escapeHtml(m.desc)}</span>`;
      item.addEventListener('click', () => {
        dropdown.remove();
        if (activeCloseHandler) {
          document.removeEventListener('click', activeCloseHandler, true);
          activeCloseHandler = null;
        }
        const t = tabs.get(openedForTabId);
        if (!t) return;
        t.mode = m.id;
        saveModeForProvider(getTabProvider(t), m.id); // remember per provider across restarts
        updateModeSelectBtn(openedForTabId);
      });
      dropdown.appendChild(item);
    });

    btn.closest('.model-select-wrapper').appendChild(dropdown);

    activeCloseHandler = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== btn) {
        dropdown.remove();
        document.removeEventListener('click', activeCloseHandler, true);
        activeCloseHandler = null;
      }
    };
    setTimeout(() => document.addEventListener('click', activeCloseHandler, true), 0);
  });
}

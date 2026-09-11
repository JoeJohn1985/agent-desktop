'use strict';

/**
 * Tests für das tab-spezifische Model-Auswahl-Feature.
 *
 * Da renderer/app.js ein Browser-Script ist, wird die Model-Selektions-Logik
 * als State-Machine-Klasse isoliert getestet — identische Konvention wie
 * autopilot.test.js, ui-state-machine.test.js und plugin-view-toggle.test.js.
 *
 * Abgedeckte Bereiche:
 *  1. Tab-State: `selectedModel: null` Default bei createTab()
 *  2. updateModelSelectBtn(): Button-Text & CSS-Klasse per Tab-State
 *  3. initTabModelSelector(): Dropdown-Klick setzt tab.selectedModel + Button-Update
 *  4. Tab-Wechsel: selectedModel-State ist unabhängig pro Tab
 *  5. sendMessage-Integration: model-Option korrekt übergeben (gesetzt / null)
 *  6. Modellbezogene Reasoning-Zuordnung und Provider-Isolation
 *  7. main.js: --model / --reasoning-effort CLI-Argumente
 *  8. Claude-Code-Reasoning-Effort (feste Werteliste wie Copilot, ACP)
 */

// ── Konstanten (aus renderer/app.js) ──────────────────────────

const ACTIVE_CLASS = 'session-actions__btn--active';

const DEFAULT_MODELS = [
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'gpt-5.3-codex',   label: 'GPT-5.3-Codex' },
];
const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function normalizeReasoningEffort(value) {
  if (value == null || value === '' || value === 'standard') return null;
  return VALID_REASONING_EFFORTS.has(value) ? value : null;
}

/**
 * Claude Code (`claude-code` / `claude-code-ssh`) teilt sich den ACP-Adapter —
 * beide behandeln Reasoning-Effort identisch (nur der Prozessort unterscheidet
 * sich). Spiegelt `isClaudeCodeProvider()` aus renderer/app.js.
 * @param {string} provider
 */
function isClaudeCodeProvider(provider) {
  return provider === 'claude-code' || provider === 'claude-code-ssh';
}

/** True für Provider, die überhaupt eine Reasoning-Zuordnung führen (Copilot,
 * Claude Code — beide über dieselbe feste Werteliste, siehe unten). */
function reasoningApplicable(tab) {
  return tab?.provider === 'copilot' || isClaudeCodeProvider(tab?.provider);
}

/**
 * Normalisiert einen Reasoning-Wert gegen die feste Werteliste
 * (`VALID_REASONING_EFFORTS`) — dieselbe Liste für jeden Provider.
 * Anthropics Effort-Parameter ist nicht pro Modell gegated (bestätigt: Haiku
 * bietet dieselben Stufen wie Sonnet); es gibt daher keine pro Modell/Session
 * entdeckte Werteliste wie bei `mode`.
 * @param {{provider: string}} tab
 * @param {string|null|undefined} value
 */
function normalizeEffortForTab(tab, value) {
  if (value == null || value === '' || value === 'standard') return null;
  return VALID_REASONING_EFFORTS.has(value) ? value : null;
}

// ── ModelSelectionStateMachine (extrahiert aus renderer/app.js) ──

/**
 * Simuliert das relevante Verhalten von createTab(), switchTab(),
 * updateModelSelectBtn(), initTabModelSelector()-Handler und sendMessage()
 * bzgl. des tab-spezifischen Model-Auswahl-Features.
 *
 * Spiegelt exakt die Logik aus renderer/app.js wider.
 */
class ModelSelectionStateMachine {
  constructor() {
    /** @type {Map<string, {selectedModel: string|null, provider: string, reasoningByModel: Object<string, string|null>, autopilot: boolean, sessionId: string|null, isProcessing: boolean}>} */
    this.tabs = new Map();
    /** @type {string|null} */
    this.activeTabId = null;

    /** Simuliert den Text-Inhalt des #btnModelSelect-Buttons */
    this._btnText = '🧠 Model';
    /** Simuliert das Vorhandensein der ACTIVE_CLASS am Button */
    this._btnActive = false;
    /** Simuliert die kompakte Reasoning-Anzeige des Buttons */
    this._btnReasoning = null;

    /** @type {Array<{tabId: string, text: string, options: Object}>} Aufgezeichnete send-Aufrufe */
    this.sentMessages = [];

    /** Verfügbare Modelle (entspricht DEFAULT_MODELS / getAvailableModels()) */
    this.availableModels = DEFAULT_MODELS;
  }

  // ── createTab (Zeile 567-582 in app.js) ────────────────────

  /**
   * Erstellt einen neuen Tab mit selectedModel: null als Default.
   * @param {string} tabId
   * @param {string} [label]
   * @param {string} [provider]
   * @param {Object<string, string|null>} [reasoningByModel]
   */
  createTab(tabId, label = '🤖 Copilot', provider = 'copilot', reasoningByModel = {}) {
    this.tabs.set(tabId, {
      label,
      sessionId: null,
      isProcessing: false,
      autopilot: false,
      selectedModel: null,           // ← SUT: Default muss null sein
      provider,
      reasoningByModel: Object.fromEntries(
        Object.entries(reasoningByModel).map(([modelId, effort]) => [
          modelId,
          normalizeReasoningEffort(effort),
        ]),
      ),
    });
    this.activeTabId = tabId;
    this._syncButtonState();
    return tabId;
  }

  // ── switchTab (Zeile 648-654 in app.js) ────────────────────

  /**
   * Aktiviert einen Tab und aktualisiert den Model-Button-Zustand.
   * Spiegelt: updateModelSelectBtn() am Ende von switchTab()
   * @param {string} tabId
   */
  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);
    this.activeTabId = tabId;
    this._syncButtonState();
  }

  // ── updateModelSelectBtn (Zeile 1411-1424 in app.js) ───────

  /**
   * Aktualisiert Text und CSS-Klasse des Model-Buttons basierend auf
   * dem selectedModel des aktiven Tabs.
   * Spiegelt exakt: updateModelSelectBtn() aus app.js.
   */
  updateModelSelectBtn() {
    const tab = this.tabs.get(this.activeTabId);
    const modelId = tab?.selectedModel;
    this._btnReasoning = tab && reasoningApplicable(tab) && modelId
      ? normalizeEffortForTab(tab, tab.reasoningByModel?.[modelId])
      : null;
    if (modelId) {
      const found = this.availableModels.find(m => m.id === modelId);
      this._btnText = `🧠 ${found ? found.label : modelId}`;
      this._btnActive = true;
    } else {
      this._btnText = '🧠 Model';
      this._btnActive = false;
    }
  }

  // ── initTabModelSelector – Dropdown-Item-Klick (Zeile 1461-1472 in app.js) ──

  /**
   * Simuliert einen Klick auf ein Dropdown-Item (Model-Auswahl).
   * Spiegelt: item.addEventListener('click', ...) in initTabModelSelector()
   * @param {string} modelId  — ID des gewählten Modells (z.B. 'claude-sonnet-4.6')
   * @param {string|null} [effort] — optionale Copilot-Reasoning-Stufe
   */
  selectModel(modelId, effort) {
    if (!this.activeTabId) return;
    const t = this.tabs.get(this.activeTabId);
    if (!t) return;
    t.selectedModel = modelId;          // ← SUT: tab.selectedModel wird gesetzt
    if (reasoningApplicable(t)) {
      t.reasoningByModel[modelId] = arguments.length >= 2
        ? normalizeEffortForTab(t, effort)
        : normalizeEffortForTab(t, t.reasoningByModel[modelId]);
    }
    this.updateModelSelectBtn();        // ← SUT: wird direkt danach aufgerufen
  }

  selectReasoning(modelId, effort) {
    this.selectModel(modelId, effort);
  }

  // ── initTabModelSelector – Submenü-Sichtbarkeit (Zeile ~3097 in app.js) ──

  /**
   * Spiegelt die Bedingung, unter der initTabModelSelector() für ein
   * Model-Dropdown-Item ein Reasoning-Untermenü baut: für jedes Modell eines
   * reasoning-fähigen Providers (Copilot, Claude Code) — nicht nur das
   * gerade aktive. Die Werteliste ist fest und modellunabhängig, es gibt
   * also nichts erst zu entdecken (siehe normalizeEffortForTab).
   * @param {string} modelId — die Model-ID des jeweils gerenderten Dropdown-Items
   */
  hasEffortSubmenu(modelId) { // eslint-disable-line no-unused-vars
    return reasoningApplicable(this.activeTab);
  }

  // ── sendMessage (Zeile 1059-1068 in app.js) ────────────────

  /**
   * Simuliert sendMessage(): Baut die Options für desktop.chat.send() auf.
   * Spiegelt: model: tab.selectedModel || undefined
   * @param {string} text
   */
  sendMessage(text) {
    if (!text || this.activeTabId == null) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.isProcessing) return null;

    const options = {
      sessionId:  tab.sessionId || undefined,
      autoApprove: true,
      autopilot:  tab.autopilot || undefined,
      model:      tab.selectedModel || undefined,   // ← SUT
      effort:      reasoningApplicable(tab) && tab.selectedModel
        ? normalizeEffortForTab(tab, tab.reasoningByModel?.[tab.selectedModel]) || undefined
        : undefined,
    };

    this.sentMessages.push({ tabId: this.activeTabId, text, options });
    return options;
  }

  // ── Private Helpers ─────────────────────────────────────────

  _syncButtonState() {
    this.updateModelSelectBtn();
  }

  get activeTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
  }
}

// ── buildCopilotArgs (extrahiert aus main.js spawnCopilot, Zeile 273-311) ──

/**
 * Baut die CLI-Argumente für den Copilot-Prozess auf.
 * Extrahiert die exakt gleiche Logik wie spawnCopilot() in main.js,
 * um sie isoliert zu testen (ohne process.spawn, Electron, etc.).
 *
 * @param {string} prompt
 * @param {Object} options
 * @returns {string[]}
 */
function buildCopilotArgs(prompt, options = {}) {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--stream', 'on',
    '-s',
  ];

  args.push('--allow-all-tools');

  if (options.deniedTools && options.deniedTools.length > 0) {
    for (const tool of options.deniedTools) {
      args.push('--deny-tool=' + tool);
    }
  }

  if (options.allowAllPaths) {
    args.push('--allow-all-paths');
  }

  if (options.addDirs && options.addDirs.length > 0) {
    for (const dir of options.addDirs) {
      args.push('--add-dir', dir);
    }
  }

  if (options.sessionId) {
    args.push('--resume=' + options.sessionId);
  }

  if (options.model) {
    args.push('--model', options.model);   // ← SUT: Zeile 303-305 in main.js
  }

  if (VALID_REASONING_EFFORTS.has(options.effort)) {
    args.push('--reasoning-effort', options.effort);
  }

  if (options.autopilot) {
    args.push('--autopilot');
  }

  return args;
}

// ══════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════

// ── 1. Tab-Default-State ──────────────────────────────────────

describe('ModelSelection — Tab-Default-State (createTab)', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
  });

  test('neuer Tab hat selectedModel: null als Default', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').selectedModel).toBeNull();
  });

  test('selectedModel-Default ist null (nicht undefined oder false)', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').selectedModel).toStrictEqual(null);
  });

  test('reasoningByModel ist pro Tab leer und Standard ist implizit', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').reasoningByModel).toEqual({});
    expect(sm._btnReasoning).toBeNull();
  });

  test('alte Persistenz ohne Reasoning-Map wird als Standard geladen', () => {
    sm.createTab('tab1', '🤖 Copilot', 'copilot');
    expect(sm.activeTab.reasoningByModel).toEqual({});
    expect(sm._btnReasoning).toBeNull();
  });

  test('Persistenzwerte werden beim Laden validiert und pro Model übernommen', () => {
    sm.createTab('tab1', '🤖 Copilot', 'copilot', {
      'claude-sonnet-4.6': 'high',
      'claude-opus-4.8': 'standard',
      'unknown-model': 'invalid',
    });
    expect(sm.activeTab.reasoningByModel).toEqual({
      'claude-sonnet-4.6': 'high',
      'claude-opus-4.8': null,
      'unknown-model': null,
    });
  });

  test('zweiter Tab hat ebenfalls selectedModel: null', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    expect(sm.tabs.get('tab1').selectedModel).toBeNull();
    expect(sm.tabs.get('tab2').selectedModel).toBeNull();
  });

  test('Button-Text ist initial "🧠 Model" (kein Model gewählt)', () => {
    sm.createTab('tab1');
    expect(sm._btnText).toBe('🧠 Model');
  });

  test('Button-Klasse ist initial inaktiv', () => {
    sm.createTab('tab1');
    expect(sm._btnActive).toBe(false);
  });

  test('autopilot-State von createTab ist weiterhin false (keine Regression)', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').autopilot).toBe(false);
  });
});

// ── 2. updateModelSelectBtn() ─────────────────────────────────

describe('ModelSelection — updateModelSelectBtn()', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab1');
  });

  test('Button zeigt "🧠 Model" wenn kein Model gewählt (null)', () => {
    sm.updateModelSelectBtn();
    expect(sm._btnText).toBe('🧠 Model');
  });

  test('Button zeigt Label wenn bekanntes Model gewählt ist', () => {
    sm.activeTab.selectedModel = 'claude-sonnet-4.6';
    sm.updateModelSelectBtn();
    expect(sm._btnText).toBe('🧠 Claude Sonnet 4.6');
  });

  test('Button zeigt für ein Copilot-Model die gespeicherte Reasoning-Stufe', () => {
    sm.activeTab.selectedModel = 'claude-sonnet-4.6';
    sm.activeTab.reasoningByModel['claude-sonnet-4.6'] = 'high';
    sm.updateModelSelectBtn();
    expect(sm._btnReasoning).toBe('high');
  });

  test('Button zeigt die Model-ID wenn unbekanntes Model gesetzt ist', () => {
    sm.activeTab.selectedModel = 'custom-unknown-model';
    sm.updateModelSelectBtn();
    expect(sm._btnText).toBe('🧠 custom-unknown-model');
  });

  test('Button ist aktiv (CSS-Klasse) wenn ein Model gesetzt ist', () => {
    sm.activeTab.selectedModel = 'claude-haiku-4.5';
    sm.updateModelSelectBtn();
    expect(sm._btnActive).toBe(true);
  });

  test('Button ist inaktiv wenn selectedModel null ist', () => {
    sm.activeTab.selectedModel = null;
    sm.updateModelSelectBtn();
    expect(sm._btnActive).toBe(false);
  });

  test('Button-State wird korrekt aktualisiert nach Model-Deselect (null)', () => {
    // Erst Model setzen
    sm.activeTab.selectedModel = 'gpt-5.3-codex';
    sm.updateModelSelectBtn();
    expect(sm._btnActive).toBe(true);

    // Dann zurücksetzen
    sm.activeTab.selectedModel = null;
    sm.updateModelSelectBtn();
    expect(sm._btnActive).toBe(false);
    expect(sm._btnText).toBe('🧠 Model');
  });

  test('alle DEFAULT_MODELS bekommen korrekte Button-Labels', () => {
    DEFAULT_MODELS.forEach(({ id, label }) => {
      sm.activeTab.selectedModel = id;
      sm.updateModelSelectBtn();
      expect(sm._btnText).toBe(`🧠 ${label}`);
    });
  });

  test('kein aktiver Tab: kein Fehler beim Button-Update', () => {
    sm.activeTabId = null;
    expect(() => sm.updateModelSelectBtn()).not.toThrow();
  });
});

// ── 3. initTabModelSelector (Dropdown-Item-Klick) ─────────────

describe('ModelSelection — initTabModelSelector (Dropdown-Item-Klick)', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab1');
  });

  test('Model-Klick setzt tab.selectedModel auf die gewählte Model-ID', () => {
    sm.selectModel('claude-sonnet-4.6');
    expect(sm.activeTab.selectedModel).toBe('claude-sonnet-4.6');
  });

  test('Model-Klick aktualisiert den Button-Text sofort', () => {
    sm.selectModel('claude-opus-4.8');
    expect(sm._btnText).toBe('🧠 Claude Opus 4.8');
  });

  test('Model-Klick setzt Button-Klasse auf aktiv', () => {
    sm.selectModel('gpt-5.3-codex');
    expect(sm._btnActive).toBe(true);
  });

  test('zweiter Klick auf anderes Model überschreibt selectedModel', () => {
    sm.selectModel('claude-sonnet-4.6');
    sm.selectModel('claude-haiku-4.5');
    expect(sm.activeTab.selectedModel).toBe('claude-haiku-4.5');
    expect(sm._btnText).toBe('🧠 Claude Haiku 4.5');
  });

  test('Model-Wechsel ohne aktiven Tab tut nichts (kein Fehler)', () => {
    sm.activeTabId = null;
    expect(() => sm.selectModel('claude-sonnet-4.6')).not.toThrow();
  });

  test('Model-Wechsel auf nicht-existentem Tab tut nichts', () => {
    sm.activeTabId = 'ghost';
    expect(() => sm.selectModel('claude-sonnet-4.6')).not.toThrow();
  });

  test('alle DEFAULT_MODELS können gewählt werden', () => {
    DEFAULT_MODELS.forEach(({ id }) => {
      sm.selectModel(id);
      expect(sm.activeTab.selectedModel).toBe(id);
    });
  });

  test('Button-State und selectedModel sind nach Klick synchron', () => {
    sm.selectModel('gpt-5.3-codex');
    expect(sm._btnActive).toBe(true);
    expect(sm._btnText).toBe('🧠 GPT-5.3-Codex');
    expect(sm.activeTab.selectedModel).toBe('gpt-5.3-codex');
  });

  test('Reasoning-Klick speichert die Stufe unter dem ausgewählten Model', () => {
    sm.selectModel('claude-sonnet-4.6');
    sm.selectReasoning('claude-sonnet-4.6', 'high');
    expect(sm.activeTab.reasoningByModel).toEqual({
      'claude-sonnet-4.6': 'high',
    });
    expect(sm._btnReasoning).toBe('high');
  });

  test('ungültige oder Standard-Reasoning-Werte werden als Standard gespeichert', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'invalid');
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBeNull();

    sm.selectReasoning('claude-sonnet-4.6', 'standard');
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBeNull();
    expect(sm._btnReasoning).toBeNull();
  });
});

// ── 4. Tab-Wechsel: unabhängiger selectedModel-State ──────────

describe('ModelSelection — Tab-Wechsel (switchTab)', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab1');
    sm.createTab('tab2');
  });

  test('Button zeigt "🧠 Model" nach Wechsel zu Tab ohne Model', () => {
    sm.switchTab('tab1');
    expect(sm._btnText).toBe('🧠 Model');
    expect(sm._btnActive).toBe(false);
  });

  test('Button zeigt korrektes Model nach Wechsel zu Tab mit gesetztem Model', () => {
    // tab1: Model setzen
    sm.switchTab('tab1');
    sm.selectModel('claude-opus-4.6');

    // zu tab2 wechseln (kein Model)
    sm.switchTab('tab2');
    expect(sm._btnText).toBe('🧠 Model');
    expect(sm._btnActive).toBe(false);

    // zurück zu tab1 (Model gesetzt)
    sm.switchTab('tab1');
    expect(sm._btnText).toBe('🧠 Claude Opus 4.6');
    expect(sm._btnActive).toBe(true);
  });

  test('selectedModel-State ist unabhängig pro Tab', () => {
    sm.switchTab('tab1');
    sm.selectModel('claude-sonnet-4.6'); // tab1: Model gesetzt

    sm.switchTab('tab2');
    expect(sm.activeTab.selectedModel).toBeNull();            // tab2 unberührt
    expect(sm.tabs.get('tab1').selectedModel).toBe('claude-sonnet-4.6'); // tab1 bleibt
  });

  test('Tab-Wechsel ändert tab.selectedModel nicht', () => {
    sm.switchTab('tab1');
    sm.selectModel('gpt-5.3-codex');

    sm.switchTab('tab2');
    sm.switchTab('tab1'); // zurück

    expect(sm.activeTab.selectedModel).toBe('gpt-5.3-codex'); // State erhalten
  });

  test('3 Tabs: jeder Tab hat eigenen selectedModel-State', () => {
    sm.createTab('tab3');

    sm.switchTab('tab1');
    sm.selectModel('claude-sonnet-4.6');

    sm.switchTab('tab3');
    sm.selectModel('gpt-5.3-codex');

    // tab2 bleibt null
    expect(sm.tabs.get('tab1').selectedModel).toBe('claude-sonnet-4.6');
    expect(sm.tabs.get('tab2').selectedModel).toBeNull();
    expect(sm.tabs.get('tab3').selectedModel).toBe('gpt-5.3-codex');
  });

  test('switchTab auf nicht-existenten Tab wirft Fehler', () => {
    expect(() => sm.switchTab('ghost')).toThrow('existiert nicht');
  });

  test('Button-Sync: nach switchTab immer den richtigen Model-State zeigen', () => {
    sm.switchTab('tab1');
    sm.selectModel('claude-haiku-4.5');

    sm.switchTab('tab2');         // tab2: kein Model → inaktiv
    expect(sm._btnActive).toBe(false);
    expect(sm._btnText).toBe('🧠 Model');

    sm.switchTab('tab1');         // tab1: Model gesetzt → aktiv
    expect(sm._btnActive).toBe(true);
    expect(sm._btnText).toBe('🧠 Claude Haiku 4.5');
  });

  test('zwei Tabs mit unterschiedlichen Models: Button wechselt korrekt', () => {
    sm.switchTab('tab1');
    sm.selectModel('claude-sonnet-4.6');

    sm.switchTab('tab2');
    sm.selectModel('gpt-5.3-codex');

    sm.switchTab('tab1');
    expect(sm._btnText).toBe('🧠 Claude Sonnet 4.6');

    sm.switchTab('tab2');
    expect(sm._btnText).toBe('🧠 GPT-5.3-Codex');
  });

  test('Model-Wechsel stellt die jeweils gespeicherte Reasoning-Stufe wieder her', () => {
    sm.switchTab('tab1');
    sm.selectReasoning('claude-sonnet-4.6', 'high');
    sm.selectReasoning('claude-opus-4.8', 'max');

    sm.selectModel('claude-sonnet-4.6');
    expect(sm._btnReasoning).toBe('high');

    sm.selectModel('claude-opus-4.8');
    expect(sm._btnReasoning).toBe('max');
  });

  test('Reasoning-Zuordnungen bleiben zwischen Tabs isoliert', () => {
    sm.switchTab('tab1');
    sm.selectReasoning('claude-sonnet-4.6', 'high');

    sm.switchTab('tab2');
    sm.selectReasoning('claude-sonnet-4.6', 'low');

    expect(sm.tabs.get('tab1').reasoningByModel['claude-sonnet-4.6']).toBe('high');
    expect(sm.tabs.get('tab2').reasoningByModel['claude-sonnet-4.6']).toBe('low');
  });
});

// ── 5. sendMessage-Integration ────────────────────────────────

describe('ModelSelection — sendMessage-Integration', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab1');
  });

  test('model ist undefined in Options wenn kein Model gewählt (null)', () => {
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBeUndefined();
  });

  test('model ist die Model-ID wenn ein Model ausgewählt wurde', () => {
    sm.selectModel('claude-sonnet-4.6');
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
  });

  test('effort wird nur für Copilot zusammen mit dem Model übergeben', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'xhigh');
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
    expect(options.effort).toBe('xhigh');
  });

  test('Standard-Reasoning wird nicht als effort übergeben', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'standard');
    expect(sm.sendMessage('Hallo').effort).toBeUndefined();
  });

  test('model ist undefined nach Rücksetzen auf null', () => {
    sm.selectModel('gpt-5.3-codex');
    sm.activeTab.selectedModel = null; // Rücksetzen
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBeUndefined();
  });

  test('null wird als undefined weitergegeben (falsy guard: || undefined)', () => {
    // app.js: model: tab.selectedModel || undefined
    // null || undefined === undefined
    const options = sm.sendMessage('Test');
    expect(options).not.toBeNull();
    expect(options.model).toBeUndefined();
  });

  test('model-ID bleibt als String erhalten (kein Typ-Casting)', () => {
    sm.selectModel('claude-opus-4.7');
    const options = sm.sendMessage('Test');
    expect(typeof options.model).toBe('string');
    expect(options.model).toBe('claude-opus-4.7');
  });

  test('sendMessage gibt null zurück bei leerem Text', () => {
    expect(sm.sendMessage('')).toBeNull();
    expect(sm.sendMessage('  '.trim())).toBeNull();
  });

  test('sendMessage gibt null zurück wenn kein activeTabId', () => {
    sm.activeTabId = null;
    expect(sm.sendMessage('Hallo')).toBeNull();
  });

  test('selectedModel bleibt nach sendMessage erhalten (kein Auto-Reset)', () => {
    sm.selectModel('claude-haiku-4.5');
    sm.sendMessage('Erster');
    sm.sendMessage('Zweiter');
    expect(sm.activeTab.selectedModel).toBe('claude-haiku-4.5');
  });

  test('mehrere Nachrichten haben konsistenten model-State', () => {
    sm.selectModel('gpt-5.3-codex');
    sm.sendMessage('Msg 1');
    sm.sendMessage('Msg 2');
    sm.sendMessage('Msg 3');

    expect(sm.sentMessages).toHaveLength(3);
    expect(sm.sentMessages.every(m => m.options.model === 'gpt-5.3-codex')).toBe(true);
  });

  test('Options-Objekt enthält weitere Felder (keine Regression)', () => {
    const options = sm.sendMessage('Test');
    expect(options).toHaveProperty('autoApprove', true);
    expect(options).toHaveProperty('sessionId');
    expect(options).toHaveProperty('autopilot');
  });

  test('model-Option in Tab1 beeinflusst Tab2 nicht', () => {
    sm.createTab('tab2');

    sm.switchTab('tab1');
    sm.selectModel('claude-sonnet-4.6');
    const opt1 = sm.sendMessage('Von Tab 1');
    expect(opt1.model).toBe('claude-sonnet-4.6');

    sm.switchTab('tab2');
    const opt2 = sm.sendMessage('Von Tab 2');
    expect(opt2.model).toBeUndefined();
  });

  test('Claude Code erhält die Reasoning-Option wie Copilot (kein Sonderfall mehr)', () => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code');
    sm.selectModel('claude-sonnet-4.6', 'max');

    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
    expect(options.effort).toBe('max');
    expect(sm._btnReasoning).toBe('max');
  });

  test('Direkte API-Provider (z.B. Anthropic) erhalten keine Reasoning-Option', () => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab-anthropic', 'Anthropic', 'anthropic');
    sm.selectModel('claude-sonnet-4.6', 'max');

    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
    expect(options.effort).toBeUndefined();
    expect(sm._btnReasoning).toBeNull();
  });
});

// ── 7. main.js: --model / --reasoning-effort CLI-Argumente ───

describe('ModelSelection — main.js CLI-Argument (spawnCopilot)', () => {

  test('--model wird hinzugefügt wenn options.model gesetzt ist', () => {
    const args = buildCopilotArgs('Teste', { model: 'claude-sonnet-4.6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4.6');
  });

  test('--reasoning-effort wird als Paar hinzugefügt wenn effort gültig ist', () => {
    const args = buildCopilotArgs('Teste', { effort: 'high' });
    const idx = args.indexOf('--reasoning-effort');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('high');
  });

  test('Standard und ungültige effort-Werte werden nicht als CLI-Argument hinzugefügt', () => {
    for (const effort of [undefined, null, '', 'standard', 'invalid']) {
      const args = buildCopilotArgs('Teste', { effort });
      expect(args).not.toContain('--reasoning-effort');
    }
  });

  test('alle gültigen effort-Werte können als CLI-Argument übergeben werden', () => {
    for (const effort of VALID_REASONING_EFFORTS) {
      const args = buildCopilotArgs('Teste', { effort });
      expect(args).toEqual(expect.arrayContaining(['--reasoning-effort', effort]));
    }
  });

  test('Model und effort werden gemeinsam und jeweils einmal übergeben', () => {
    const args = buildCopilotArgs('Teste', {
      model: 'claude-sonnet-4.6',
      effort: 'medium',
    });
    expect(args.filter(a => a === '--model')).toHaveLength(1);
    expect(args.filter(a => a === '--reasoning-effort')).toHaveLength(1);
    expect(args).toEqual(expect.arrayContaining([
      '--model', 'claude-sonnet-4.6',
      '--reasoning-effort', 'medium',
    ]));
  });

  test('--model und Model-ID stehen als Paar hintereinander in args', () => {
    const args = buildCopilotArgs('Teste', { model: 'claude-haiku-4.5' });
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-haiku-4.5');
  });

  test('--model wird NICHT hinzugefügt wenn options.model undefined ist', () => {
    const args = buildCopilotArgs('Teste', { model: undefined });
    expect(args).not.toContain('--model');
  });

  test('--model wird NICHT hinzugefügt wenn options.model null ist (falsy)', () => {
    const args = buildCopilotArgs('Teste', { model: null });
    expect(args).not.toContain('--model');
  });

  test('--model wird NICHT hinzugefügt wenn options.model leer ist', () => {
    const args = buildCopilotArgs('Teste', { model: '' });
    expect(args).not.toContain('--model');
  });

  test('--model wird NICHT hinzugefügt bei leeren Options', () => {
    const args = buildCopilotArgs('Teste', {});
    expect(args).not.toContain('--model');
  });

  test('--model wird NICHT hinzugefügt ohne Options-Parameter', () => {
    const args = buildCopilotArgs('Teste');
    expect(args).not.toContain('--model');
  });

  test('--model ist genau einmal in args vorhanden', () => {
    const args = buildCopilotArgs('Teste', { model: 'gpt-5.3-codex' });
    const count = args.filter(a => a === '--model').length;
    expect(count).toBe(1);
  });

  test('alle DEFAULT_MODELS können als --model-Argument übergeben werden', () => {
    DEFAULT_MODELS.forEach(({ id }) => {
      const args = buildCopilotArgs('Teste', { model: id });
      expect(args).toContain('--model');
      expect(args).toContain(id);
    });
  });

  test('--model koexistiert korrekt mit --autopilot', () => {
    const args = buildCopilotArgs('Teste', {
      model: 'claude-opus-4.7',
      autopilot: true,
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4.7');
    expect(args).toContain('--autopilot');
  });

  test('--model koexistiert korrekt mit --resume', () => {
    const args = buildCopilotArgs('Teste', {
      model: 'gpt-5.3-codex',
      sessionId: 'abc-123',
    });
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.3-codex');
    expect(args).toContain('--resume=abc-123');
  });

  test('ohne --model werden keine unerwarteten Argumente hinzugefügt', () => {
    const argsWithout = buildCopilotArgs('Test', {});
    const argsWith    = buildCopilotArgs('Test', { model: 'gpt-5.3-codex' });
    // Der einzige Unterschied muss ['--model', 'gpt-5.3-codex'] sein
    expect(argsWith.length - argsWithout.length).toBe(2);
    expect(argsWith.filter(a => !argsWithout.includes(a))).toEqual(['--model', 'gpt-5.3-codex']);
  });

  test('Basis-Argumente sind immer vorhanden (Regressions-Check)', () => {
    const args = buildCopilotArgs('Mein Prompt', { model: 'claude-sonnet-4.6' });
    expect(args).toContain('-p');
    expect(args).toContain('Mein Prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--stream');
    expect(args).toContain('on');
    expect(args).toContain('-s');
    expect(args).toContain('--allow-all-tools');
  });

  test('--model und --deny-tool koexistieren', () => {
    const args = buildCopilotArgs('Test', {
      model: 'claude-haiku-4.5',
      deniedTools: ['powershell', 'bash'],
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-haiku-4.5');
    expect(args).toContain('--deny-tool=powershell');
    expect(args).toContain('--deny-tool=bash');
  });

  test('--model und --allow-all-paths koexistieren', () => {
    const args = buildCopilotArgs('Test', {
      model: 'gpt-5.3-codex',
      allowAllPaths: true,
    });
    expect(args).toContain('--model');
    expect(args).toContain('--allow-all-paths');
  });
});

// ── 7. End-to-End-Szenarien ───────────────────────────────────

describe('ModelSelection — End-to-End-Szenarien', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
  });

  test('Vollständiger Flow: Tab erstellen, Model wählen, Nachricht senden', () => {
    sm.createTab('tab1');

    // Initial: kein Model
    expect(sm.activeTab.selectedModel).toBeNull();
    let opts = sm.sendMessage('Erste Nachricht');
    expect(opts.model).toBeUndefined();
    expect(sm._btnText).toBe('🧠 Model');

    // Model auswählen
    sm.selectModel('claude-sonnet-4.6');
    expect(sm.activeTab.selectedModel).toBe('claude-sonnet-4.6');
    expect(sm._btnActive).toBe(true);
    expect(sm._btnText).toBe('🧠 Claude Sonnet 4.6');

    // Nachricht mit Model
    opts = sm.sendMessage('Zweite Nachricht');
    expect(opts.model).toBe('claude-sonnet-4.6');

    // Tab-Wechsel zu neuem Tab
    sm.createTab('tab2');
    expect(sm._btnText).toBe('🧠 Model');           // neuer Tab hat kein Model
    expect(sm.tabs.get('tab1').selectedModel).toBe('claude-sonnet-4.6'); // tab1 bleibt

    // Zurück zu tab1
    sm.switchTab('tab1');
    expect(sm._btnActive).toBe(true);
    expect(sm._btnText).toBe('🧠 Claude Sonnet 4.6');

    // Model wechseln
    sm.selectModel('gpt-5.3-codex');
    opts = sm.sendMessage('Dritte Nachricht');
    expect(opts.model).toBe('gpt-5.3-codex');
  });

  test('Szenario: Zwei Tabs mit unterschiedlichen Models', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');

    sm.switchTab('tab1');
    sm.selectModel('claude-opus-4.7');
    const opt1 = sm.sendMessage('Von Tab 1');
    expect(opt1.model).toBe('claude-opus-4.7');

    sm.switchTab('tab2');
    sm.selectModel('gpt-5.3-codex');
    const opt2 = sm.sendMessage('Von Tab 2');
    expect(opt2.model).toBe('gpt-5.3-codex');

    // Zurück zu tab1: State wiederhergestellt
    sm.switchTab('tab1');
    const opt3 = sm.sendMessage('Wieder Tab 1');
    expect(opt3.model).toBe('claude-opus-4.7');
  });

  test('Szenario: CLI-Argument korrekt wenn sendMessage-Options zu spawnCopilot fließen', () => {
    sm.createTab('tab1');
    sm.selectModel('claude-haiku-4.5');

    const opts = sm.sendMessage('Starte Aufgabe');

    // opts.model fließt in buildCopilotArgs → --model im CLI
    const args = buildCopilotArgs('Starte Aufgabe', opts);
    expect(args).toContain('--model');
    expect(args).toContain('claude-haiku-4.5');
  });

  test('Szenario: Ohne Model kein --model CLI-Argument', () => {
    sm.createTab('tab1');
    // kein selectModel()

    const opts = sm.sendMessage('Normale Aufgabe');

    const args = buildCopilotArgs('Normale Aufgabe', opts);
    expect(args).not.toContain('--model');
  });

  test('Szenario: Model + Autopilot gemeinsam in CLI-Argumenten', () => {
    sm.createTab('tab1');
    sm.selectModel('claude-opus-4.7');
    sm.activeTab.autopilot = true;

    const opts = sm.sendMessage('Komplexe Aufgabe');
    expect(opts.model).toBe('claude-opus-4.7');
    expect(opts.autopilot).toBe(true);

    const args = buildCopilotArgs('Komplexe Aufgabe', opts);
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4.7');
    expect(args).toContain('--autopilot');
  });

  test('Szenario: 3 Tabs, jeder mit eigenem Model oder ohne', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    sm.createTab('tab3');

    sm.switchTab('tab1');
    sm.selectModel('claude-sonnet-4.6');

    // tab2: kein Model

    sm.switchTab('tab3');
    sm.selectModel('gpt-5.3-codex');

    // Assertions
    expect(sm.tabs.get('tab1').selectedModel).toBe('claude-sonnet-4.6');
    expect(sm.tabs.get('tab2').selectedModel).toBeNull();
    expect(sm.tabs.get('tab3').selectedModel).toBe('gpt-5.3-codex');

    // sendMessage-Aufrufe pro Tab
    sm.switchTab('tab1');
    expect(sm.sendMessage('T1').model).toBe('claude-sonnet-4.6');

    sm.switchTab('tab2');
    expect(sm.sendMessage('T2').model).toBeUndefined();

    sm.switchTab('tab3');
    expect(sm.sendMessage('T3').model).toBe('gpt-5.3-codex');
  });
});

// ── 8. Claude-Code-Reasoning-Effort (feste Werteliste, wie Copilot) ──
//
// Korrektur nach Nutzer-Feedback: Anthropics Effort-Parameter ist NICHT pro
// Modell gegated (Haiku bietet in der Praxis dieselben Stufen wie Sonnet,
// ebenso online durchgängig dieselbe feste Liste für alle Modelle, die
// Reasoning unterstützen). Die ursprünglich geplante dynamische Discovery
// über `session.effort_available` wurde deshalb wieder entfernt — Claude
// Code verhält sich hier jetzt identisch zu Copilot: ein Untermenü pro
// Modell-Zeile, sofort sichtbar, keine Session/Nachricht nötig, um es zu
// "entdecken".

describe('ModelSelection — Claude-Code-Effort: Untermenü wie bei Copilot', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code');
  });

  test('Untermenü erscheint sofort, ohne dass zuvor eine Nachricht gesendet wurde', () => {
    expect(sm.hasEffortSubmenu('claude-sonnet-4.6')).toBe(true);
  });

  test('Untermenü erscheint für JEDES Modell in der Liste, nicht nur das aktive', () => {
    sm.selectModel('claude-sonnet-4.6');
    expect(sm.hasEffortSubmenu('claude-sonnet-4.6')).toBe(true);
    expect(sm.hasEffortSubmenu('claude-opus-4.8')).toBe(true);
    expect(sm.hasEffortSubmenu('claude-haiku-4.5')).toBe(true);
  });

  test('Copilot-Tabs zeigen identisch immer ein Untermenü (Regressionscheck)', () => {
    const copilotSm = new ModelSelectionStateMachine();
    copilotSm.createTab('tab-copilot');
    expect(copilotSm.hasEffortSubmenu('claude-sonnet-4.6')).toBe(true);
  });

  test('Nicht-reasoning-fähige Provider zeigen kein Untermenü', () => {
    const otherSm = new ModelSelectionStateMachine();
    otherSm.createTab('tab-anthropic', 'Anthropic', 'anthropic');
    expect(otherSm.hasEffortSubmenu('claude-sonnet-4.6')).toBe(false);
  });
});

describe('ModelSelection — Claude-Code-Effort: Auswahl & Badge', () => {
  let sm;

  beforeEach(() => {
    sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code');
    sm.selectModel('claude-sonnet-4.6');
  });

  test('Reasoning-Klick mit gültiger Stufe wird übernommen', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'high');
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBe('high');
    expect(sm._btnReasoning).toBe('high');
  });

  test('Reasoning-Klick mit ungültigem Wert wird auf Standard (null) normalisiert', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'megathink');
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBeNull();
    expect(sm._btnReasoning).toBeNull();
  });

  test('sendMessage() übergibt effort für Claude-Code-Tabs bei gültiger Stufe', () => {
    sm.selectReasoning('claude-sonnet-4.6', 'high');
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
    expect(options.effort).toBe('high');
  });

  test('sendMessage() lässt effort weg, wenn kein Wert gewählt wurde (Standard)', () => {
    const options = sm.sendMessage('Hallo');
    expect(options.model).toBe('claude-sonnet-4.6');
    expect(options.effort).toBeUndefined();
  });
});

describe('ModelSelection — Claude-Code-Effort: Tab-Isolation', () => {
  test('zwei Claude-Code-Tabs mit unterschiedlichen Modellen/Effort-Stufen beeinflussen sich nicht gegenseitig', () => {
    const sm = new ModelSelectionStateMachine();
    sm.createTab('tab-a', 'Claude Code A', 'claude-code');
    sm.createTab('tab-b', 'Claude Code B', 'claude-code');

    sm.switchTab('tab-a');
    sm.selectModel('claude-sonnet-4.6');
    sm.selectReasoning('claude-sonnet-4.6', 'high');

    sm.switchTab('tab-b');
    sm.selectModel('claude-opus-4.8');
    sm.selectReasoning('claude-opus-4.8', 'low');

    expect(sm.tabs.get('tab-a').reasoningByModel['claude-sonnet-4.6']).toBe('high');
    expect(sm.tabs.get('tab-b').reasoningByModel['claude-opus-4.8']).toBe('low');

    // tab-a bleibt von tab-bs Änderungen unberührt.
    sm.switchTab('tab-b');
    sm.selectReasoning('claude-opus-4.8', 'max');
    expect(sm.tabs.get('tab-a').reasoningByModel['claude-sonnet-4.6']).toBe('high');
  });
});

describe('ModelSelection — Claude-Code-Effort: Persistenz-Restore', () => {
  test('Claude-Code-Persistenzwert wird beim Tab-Laden gegen die feste Liste validiert', () => {
    const sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code', { 'claude-sonnet-4.6': 'high' });
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBe('high');
  });

  test('ein persistierter, nicht mehr gültiger Wert (z.B. alter CLI-Wortlaut) wird beim Laden auf Standard normalisiert', () => {
    const sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code', { 'claude-sonnet-4.6': 'ultrathink' });
    expect(sm.activeTab.reasoningByModel['claude-sonnet-4.6']).toBeNull();
  });

  test('alte Persistenz ohne Reasoning-Map wird für Claude-Code-Tabs ebenfalls als Standard geladen', () => {
    const sm = new ModelSelectionStateMachine();
    sm.createTab('tab-claude', 'Claude Code', 'claude-code');
    expect(sm.activeTab.reasoningByModel).toEqual({});
    expect(sm._btnReasoning).toBeNull();
  });
});

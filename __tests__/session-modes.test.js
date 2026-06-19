'use strict';

/**
 * Tests für die Session-Modi (Agent / Plan / Autopilot).
 *
 * Ersetzt den früheren Autopilot-Toggle. Der Modus wird pro Tab gewählt und
 * via session/set_mode an den ACP-Prozess übergeben. Da renderer/app.js ein
 * Browser-Script ist, wird die Mode-Logik als State-Machine isoliert getestet
 * (gleiche Konvention wie ui-state-machine.test.js).
 *
 * Abgedeckte Bereiche:
 *  1. Tab-Default: mode = 'agent' bei createTab()
 *  2. Auswahl: Dropdown-Klick setzt tab.mode
 *  3. Button-Highlight: aktiv wenn mode !== 'agent'
 *  4. Tab-Wechsel: mode pro Tab erhalten
 *  5. sendMessage-Integration: mode wird in den Options übergeben
 */

const ACTIVE_CLASS = 'session-actions__btn--active';
const DEFAULT_MODE_ID = 'agent';
const SESSION_MODES = ['agent', 'plan', 'autopilot'];

/**
 * Spiegelt die Mode-relevante Logik aus renderer/app.js wider:
 * createTab(), initTabModeSelector()-Auswahl, updateModeSelectBtn(),
 * switchTab() und sendMessage().
 */
class ModeStateMachine {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this._btnActive = false;
    this.sentMessages = [];
  }

  createTab(tabId, label = '🤖 Copilot') {
    this.tabs.set(tabId, { label, sessionId: null, isProcessing: false, mode: DEFAULT_MODE_ID });
    this.activeTabId = tabId;
    this._syncButtonState();
    return tabId;
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);
    this.activeTabId = tabId;
    this._syncButtonState();
  }

  /** Mirrors the dropdown item click: sets tab.mode + updates button. */
  selectMode(modeId) {
    if (this.activeTabId == null) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    if (!SESSION_MODES.includes(modeId)) throw new Error(`Unbekannter Modus: ${modeId}`);
    tab.mode = modeId;
    this._syncButtonState();
  }

  /** Mirrors sendMessage(): mode: tab.mode || DEFAULT_MODE_ID */
  sendMessage(text) {
    if (!text || this.activeTabId == null) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.isProcessing) return null;
    const options = { sessionId: tab.sessionId || undefined, mode: tab.mode || DEFAULT_MODE_ID };
    this.sentMessages.push({ tabId: this.activeTabId, text, options });
    return options;
  }

  // updateModeSelectBtn: active when mode !== default
  _syncButtonState() {
    const tab = this.tabs.get(this.activeTabId);
    this._btnActive = !!tab && tab.mode !== DEFAULT_MODE_ID;
  }

  get activeTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
  }
}

describe('Session-Modi — Tab-Default (createTab)', () => {
  let sm;
  beforeEach(() => { sm = new ModeStateMachine(); });

  test('neuer Tab hat mode "agent" als Default', () => {
    sm.createTab('t1');
    expect(sm.tabs.get('t1').mode).toBe('agent');
  });

  test('Button ist initial nicht aktiv (Agent = Default)', () => {
    sm.createTab('t1');
    expect(sm._btnActive).toBe(false);
  });
});

describe('Session-Modi — Auswahl', () => {
  let sm;
  beforeEach(() => { sm = new ModeStateMachine(); sm.createTab('t1'); });

  test('Auswahl von "autopilot" setzt tab.mode', () => {
    sm.selectMode('autopilot');
    expect(sm.activeTab.mode).toBe('autopilot');
  });

  test('Auswahl von "plan" setzt tab.mode', () => {
    sm.selectMode('plan');
    expect(sm.activeTab.mode).toBe('plan');
  });

  test('Button aktiv bei Plan/Autopilot, inaktiv bei Agent', () => {
    sm.selectMode('plan');
    expect(sm._btnActive).toBe(true);
    sm.selectMode('autopilot');
    expect(sm._btnActive).toBe(true);
    sm.selectMode('agent');
    expect(sm._btnActive).toBe(false);
  });

  test('unbekannter Modus wirft Fehler', () => {
    expect(() => sm.selectMode('turbo')).toThrow('Unbekannter Modus');
  });

  test('Auswahl ohne aktiven Tab tut nichts', () => {
    sm.activeTabId = null;
    expect(() => sm.selectMode('plan')).not.toThrow();
  });
});

describe('Session-Modi — Tab-Wechsel', () => {
  let sm;
  beforeEach(() => { sm = new ModeStateMachine(); sm.createTab('t1'); sm.createTab('t2'); });

  test('Modus ist unabhängig pro Tab', () => {
    sm.switchTab('t1');
    sm.selectMode('autopilot');
    sm.switchTab('t2');
    expect(sm.activeTab.mode).toBe('agent');
    expect(sm.tabs.get('t1').mode).toBe('autopilot');
  });

  test('Button-State folgt dem aktiven Tab', () => {
    sm.switchTab('t1');
    sm.selectMode('plan');
    sm.switchTab('t2');
    expect(sm._btnActive).toBe(false);
    sm.switchTab('t1');
    expect(sm._btnActive).toBe(true);
  });

  test('Tab-Wechsel ändert den Modus nicht', () => {
    sm.switchTab('t1');
    sm.selectMode('autopilot');
    sm.switchTab('t2');
    sm.switchTab('t1');
    expect(sm.activeTab.mode).toBe('autopilot');
  });
});

describe('Session-Modi — sendMessage-Integration', () => {
  let sm;
  beforeEach(() => { sm = new ModeStateMachine(); sm.createTab('t1'); });

  test('mode "agent" wird standardmäßig übergeben', () => {
    const opts = sm.sendMessage('Hi');
    expect(opts.mode).toBe('agent');
  });

  test('gewählter Modus wird übergeben', () => {
    sm.selectMode('autopilot');
    const opts = sm.sendMessage('Hi');
    expect(opts.mode).toBe('autopilot');
  });

  test('Modus bleibt über mehrere Nachrichten erhalten', () => {
    sm.selectMode('plan');
    sm.sendMessage('1');
    sm.sendMessage('2');
    expect(sm.sentMessages.every(m => m.options.mode === 'plan')).toBe(true);
  });

  test('sendMessage gibt null bei leerem Text', () => {
    expect(sm.sendMessage('')).toBeNull();
  });
});

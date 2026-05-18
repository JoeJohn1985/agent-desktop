'use strict';

/**
 * Tests für das Autopilot-Toggle Feature.
 *
 * Da renderer/app.js ein Browser-Script ist, wird die Autopilot-Logik als
 * State-Machine-Klasse isoliert getestet (gleiche Konvention wie
 * ui-state-machine.test.js und plugin-view-toggle.test.js).
 *
 * Abgedeckte Bereiche:
 *  1. Tab-State: `autopilot: false` Default bei createTab()
 *  2. Toggle-Logik: Click auf btnAutopilot toggled tab.autopilot + CSS-Klasse
 *  3. Tab-Wechsel: Button-State korrekt pro Tab in switchTab()
 *  4. sendMessage-Integration: autopilot-Option wird korrekt übergeben
 *  5. main.js: --autopilot-Argument wird zu args hinzugefügt
 */

// ── Autopilot-State-Machine (extrahiert aus renderer/app.js) ──

const ACTIVE_CLASS = 'session-actions__btn--active';

/**
 * Simuliert das relevante Verhalten von createTab(), switchTab(),
 * initSlashButtons()-Handler und sendMessage() bzgl. Autopilot.
 *
 * Spiegelt exakt die Logik aus renderer/app.js wider.
 */
class AutopilotStateMachine {
  constructor() {
    /** @type {Map<string, {autopilot: boolean}>} */
    this.tabs = new Map();
    /** @type {string|null} */
    this.activeTabId = null;
    /** Simuliert den Zustand der CSS-Klasse des Buttons */
    this._btnActive = false;
    /** @type {Array<{tabId: string, text: string, options: Object}>} Aufgezeichnete send-Aufrufe */
    this.sentMessages = [];
  }

  // ── createTab (Zeile 567-581 in app.js) ───────────────────

  /**
   * Erstellt einen neuen Tab mit autopilot: false als Default.
   * @param {string} tabId
   * @param {string} [label]
   */
  createTab(tabId, label = '🤖 Copilot') {
    this.tabs.set(tabId, {
      label,
      sessionId: null,
      isProcessing: false,
      autopilot: false,          // ← Sut: Default muss false sein
    });
    this.activeTabId = tabId;
    this._syncButtonState();
    return tabId;
  }

  // ── switchTab (Zeile 648-650 in app.js) ───────────────────

  /**
   * Aktiviert einen Tab und aktualisiert den Button-Zustand.
   * Spiegelt: autopilotBtn.classList.toggle(ACTIVE_CLASS, !!activeTab?.autopilot)
   * @param {string} tabId
   */
  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);
    this.activeTabId = tabId;
    this._syncButtonState();
  }

  // ── initSlashButtons-Handler (Zeile 2842-2848 in app.js) ──

  /**
   * Click-Handler für btnAutopilot.
   * Spiegelt: tab.autopilot = !tab.autopilot; + classList.toggle(…)
   */
  clickAutopilotButton() {
    if (this.activeTabId == null) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    tab.autopilot = !tab.autopilot;
    this._btnActive = tab.autopilot;
  }

  // ── sendMessage (Zeile 1055-1062 in app.js) ───────────────

  /**
   * Simuliert sendMessage(): Baut die Options für copilot.chat.send() auf.
   * Spiegelt: autopilot: tab.autopilot || undefined
   * @param {string} text
   */
  sendMessage(text) {
    if (!text || this.activeTabId == null) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.isProcessing) return null;

    const options = {
      sessionId: tab.sessionId || undefined,
      autoApprove: true,
      autopilot: tab.autopilot || undefined,   // ← Sut
    };

    this.sentMessages.push({ tabId: this.activeTabId, text, options });
    return options;
  }

  // ── Private Helpers ────────────────────────────────────────

  _syncButtonState() {
    const activeTab = this.tabs.get(this.activeTabId);
    this._btnActive = !!(activeTab?.autopilot);
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
    args.push('--model', options.model);
  }

  if (options.effort) {
    args.push('--reasoning-effort', options.effort);
  }

  // ← Sut: Zeile 309-311 in main.js
  if (options.autopilot) {
    args.push('--autopilot');
  }

  return args;
}

// ══════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════

// ── 1. Tab-Default-State ──────────────────────────────────────

describe('Autopilot — Tab-Default-State (createTab)', () => {
  let sm;

  beforeEach(() => {
    sm = new AutopilotStateMachine();
  });

  test('neuer Tab hat autopilot: false als Default', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').autopilot).toBe(false);
  });

  test('zweiter Tab hat ebenfalls autopilot: false', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    expect(sm.tabs.get('tab1').autopilot).toBe(false);
    expect(sm.tabs.get('tab2').autopilot).toBe(false);
  });

  test('Button ist initial nicht aktiv', () => {
    sm.createTab('tab1');
    expect(sm._btnActive).toBe(false);
  });

  test('autopilot-Default ist boolean false (nicht falsy null/undefined)', () => {
    sm.createTab('tab1');
    expect(sm.tabs.get('tab1').autopilot).toStrictEqual(false);
  });
});

// ── 2. Toggle-Logik ────────────────────────────────────────────

describe('Autopilot — Toggle-Logik (initSlashButtons-Handler)', () => {
  let sm;

  beforeEach(() => {
    sm = new AutopilotStateMachine();
    sm.createTab('tab1');
  });

  test('erster Klick aktiviert Autopilot (false → true)', () => {
    sm.clickAutopilotButton();
    expect(sm.activeTab.autopilot).toBe(true);
  });

  test('zweiter Klick deaktiviert Autopilot (true → false)', () => {
    sm.clickAutopilotButton();
    sm.clickAutopilotButton();
    expect(sm.activeTab.autopilot).toBe(false);
  });

  test('dritter Klick aktiviert wieder (false → true)', () => {
    sm.clickAutopilotButton();
    sm.clickAutopilotButton();
    sm.clickAutopilotButton();
    expect(sm.activeTab.autopilot).toBe(true);
  });

  test('Klick fügt CSS-Klasse hinzu wenn aktiviert', () => {
    sm.clickAutopilotButton();
    expect(sm._btnActive).toBe(true);
  });

  test('Klick entfernt CSS-Klasse wenn deaktiviert', () => {
    sm.clickAutopilotButton(); // aktiv
    sm.clickAutopilotButton(); // inaktiv
    expect(sm._btnActive).toBe(false);
  });

  test('Button-Klasse spiegelt tab.autopilot-Wert 1:1 wider', () => {
    expect(sm._btnActive).toBe(sm.activeTab.autopilot);
    sm.clickAutopilotButton();
    expect(sm._btnActive).toBe(sm.activeTab.autopilot);
    sm.clickAutopilotButton();
    expect(sm._btnActive).toBe(sm.activeTab.autopilot);
  });

  test('Klick ohne aktiven Tab tut nichts', () => {
    sm.activeTabId = null;
    expect(() => sm.clickAutopilotButton()).not.toThrow();
  });

  test('Klick auf nicht-existenten Tab tut nichts', () => {
    sm.activeTabId = 'nonexistent';
    expect(() => sm.clickAutopilotButton()).not.toThrow();
  });
});

// ── 3. Tab-Wechsel: Button-State pro Tab ──────────────────────

describe('Autopilot — Tab-Wechsel (switchTab)', () => {
  let sm;

  beforeEach(() => {
    sm = new AutopilotStateMachine();
    sm.createTab('tab1');
    sm.createTab('tab2');
  });

  test('Button ist inaktiv nach Wechsel zu Tab ohne Autopilot', () => {
    sm.switchTab('tab1');
    expect(sm._btnActive).toBe(false);
  });

  test('Button ist aktiv nach Wechsel zu Tab mit aktivem Autopilot', () => {
    // tab1: Autopilot aktivieren
    sm.switchTab('tab1');
    sm.clickAutopilotButton();

    // zu tab2 wechseln (ohne Autopilot)
    sm.switchTab('tab2');
    expect(sm._btnActive).toBe(false);

    // zurück zu tab1 (mit Autopilot)
    sm.switchTab('tab1');
    expect(sm._btnActive).toBe(true);
  });

  test('Autopilot-State ist unabhängig pro Tab', () => {
    sm.switchTab('tab1');
    sm.clickAutopilotButton(); // tab1: autopilot = true

    sm.switchTab('tab2');
    expect(sm.activeTab.autopilot).toBe(false); // tab2 unberührt
    expect(sm.tabs.get('tab1').autopilot).toBe(true); // tab1 bleibt aktiv
  });

  test('Tab-Wechsel ändert tab.autopilot nicht', () => {
    sm.switchTab('tab1');
    sm.clickAutopilotButton(); // tab1: true

    sm.switchTab('tab2');
    sm.switchTab('tab1'); // zurück

    expect(sm.activeTab.autopilot).toBe(true); // State erhalten
  });

  test('3 Tabs: jeder Tab hat eigenen Autopilot-State', () => {
    sm.createTab('tab3');

    sm.switchTab('tab1');
    sm.clickAutopilotButton(); // tab1: true

    sm.switchTab('tab3');
    sm.clickAutopilotButton(); // tab3: true

    // tab2 bleibt false
    expect(sm.tabs.get('tab1').autopilot).toBe(true);
    expect(sm.tabs.get('tab2').autopilot).toBe(false);
    expect(sm.tabs.get('tab3').autopilot).toBe(true);
  });

  test('switchTab auf nicht-existenten Tab wirft Fehler', () => {
    expect(() => sm.switchTab('ghost')).toThrow('existiert nicht');
  });

  test('Button-Sync: nach switchTab immer korrekt', () => {
    sm.switchTab('tab1');
    sm.clickAutopilotButton(); // tab1: true
    sm.switchTab('tab2');      // tab2: false → Button inaktiv

    expect(sm._btnActive).toBe(false);

    sm.switchTab('tab1');      // tab1: true → Button aktiv
    expect(sm._btnActive).toBe(true);
  });
});

// ── 4. sendMessage-Integration ────────────────────────────────

describe('Autopilot — sendMessage-Integration', () => {
  let sm;

  beforeEach(() => {
    sm = new AutopilotStateMachine();
    sm.createTab('tab1');
  });

  test('autopilot ist undefined in Options wenn nicht aktiviert', () => {
    const options = sm.sendMessage('Hallo');
    expect(options.autopilot).toBeUndefined();
  });

  test('autopilot ist true in Options wenn aktiviert', () => {
    sm.clickAutopilotButton(); // aktivieren
    const options = sm.sendMessage('Hallo');
    expect(options.autopilot).toBe(true);
  });

  test('autopilot ist undefined nach Deaktivierung', () => {
    sm.clickAutopilotButton(); // true
    sm.clickAutopilotButton(); // false → undefined
    const options = sm.sendMessage('Hallo');
    expect(options.autopilot).toBeUndefined();
  });

  test('autopilot: false wird als undefined weitergegeben (falsy guard)', () => {
    // app.js: autopilot: tab.autopilot || undefined
    // false || undefined === undefined
    const options = sm.sendMessage('Test');
    expect(options).not.toBeNull();
    // Kein autopilot-Key mit false — undefined bedeutet Key nicht gesetzt
    expect(options.autopilot).toBeUndefined();
  });

  test('autopilot: true bleibt als true erhalten', () => {
    // true || undefined === true
    sm.clickAutopilotButton();
    const options = sm.sendMessage('Test');
    expect(options.autopilot).toBe(true);
  });

  test('sendMessage gibt null zurück bei leerem Text', () => {
    expect(sm.sendMessage('')).toBeNull();
    expect(sm.sendMessage('  '.trim())).toBeNull();
  });

  test('sendMessage gibt null zurück wenn kein activeTabId', () => {
    sm.activeTabId = null;
    expect(sm.sendMessage('Hallo')).toBeNull();
  });

  test('Autopilot-State bleibt nach sendMessage erhalten', () => {
    sm.clickAutopilotButton(); // true
    sm.sendMessage('Erster');
    sm.sendMessage('Zweiter');
    expect(sm.activeTab.autopilot).toBe(true); // kein Reset durch sendMessage
  });

  test('mehrere Nachrichten haben konsistenten Autopilot-State', () => {
    sm.clickAutopilotButton();
    sm.sendMessage('Msg 1');
    sm.sendMessage('Msg 2');
    sm.sendMessage('Msg 3');

    expect(sm.sentMessages).toHaveLength(3);
    expect(sm.sentMessages.every(m => m.options.autopilot === true)).toBe(true);
  });

  test('Options-Objekt enthält weitere Felder (keine Regression)', () => {
    const options = sm.sendMessage('Test');
    expect(options).toHaveProperty('autoApprove', true);
    expect(options).toHaveProperty('sessionId');
  });
});

// ── 5. main.js: --autopilot CLI-Argument ─────────────────────

describe('Autopilot — main.js CLI-Argument (spawnCopilot)', () => {

  test('--autopilot wird hinzugefügt wenn options.autopilot truthy ist', () => {
    const args = buildCopilotArgs('Teste', { autopilot: true });
    expect(args).toContain('--autopilot');
  });

  test('--autopilot wird NICHT hinzugefügt wenn options.autopilot false ist', () => {
    const args = buildCopilotArgs('Teste', { autopilot: false });
    expect(args).not.toContain('--autopilot');
  });

  test('--autopilot wird NICHT hinzugefügt wenn options.autopilot undefined ist', () => {
    const args = buildCopilotArgs('Teste', { autopilot: undefined });
    expect(args).not.toContain('--autopilot');
  });

  test('--autopilot wird NICHT hinzugefügt bei leeren Options', () => {
    const args = buildCopilotArgs('Teste', {});
    expect(args).not.toContain('--autopilot');
  });

  test('--autopilot wird NICHT hinzugefügt ohne Options-Parameter', () => {
    const args = buildCopilotArgs('Teste');
    expect(args).not.toContain('--autopilot');
  });

  test('--autopilot ist genau einmal in args vorhanden', () => {
    const args = buildCopilotArgs('Teste', { autopilot: true });
    const count = args.filter(a => a === '--autopilot').length;
    expect(count).toBe(1);
  });

  test('--autopilot wird am Ende der args-Liste hinzugefügt', () => {
    const args = buildCopilotArgs('Teste', { autopilot: true });
    const lastArg = args[args.length - 1];
    expect(lastArg).toBe('--autopilot');
  });

  test('andere Optionen koexistieren korrekt mit --autopilot', () => {
    const args = buildCopilotArgs('Teste', {
      autopilot: true,
      sessionId: 'abc-123',
      model: 'claude-opus',
    });
    expect(args).toContain('--autopilot');
    expect(args).toContain('--resume=abc-123');
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus');
  });

  test('Basis-Argumente sind immer vorhanden (Regressions-Check)', () => {
    const args = buildCopilotArgs('Mein Prompt', { autopilot: true });
    expect(args).toContain('-p');
    expect(args).toContain('Mein Prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--stream');
    expect(args).toContain('on');
    expect(args).toContain('-s');
    expect(args).toContain('--allow-all-tools');
  });

  test('--deny-tool und --autopilot koexistieren', () => {
    const args = buildCopilotArgs('Test', {
      autopilot: true,
      deniedTools: ['powershell', 'bash'],
    });
    expect(args).toContain('--autopilot');
    expect(args).toContain('--deny-tool=powershell');
    expect(args).toContain('--deny-tool=bash');
  });

  test('--allow-all-paths und --autopilot koexistieren', () => {
    const args = buildCopilotArgs('Test', {
      autopilot: true,
      allowAllPaths: true,
    });
    expect(args).toContain('--autopilot');
    expect(args).toContain('--allow-all-paths');
  });

  test('Ohne autopilot werden keine unerwarteten Argumente hinzugefügt', () => {
    const argsWithout = buildCopilotArgs('Test', {});
    const argsWith    = buildCopilotArgs('Test', { autopilot: true });
    // Der einzige Unterschied muss --autopilot sein
    expect(argsWith.length - argsWithout.length).toBe(1);
    expect(argsWith.filter(a => !argsWithout.includes(a))).toEqual(['--autopilot']);
  });
});

// ── 6. Integrations-Szenario ──────────────────────────────────

describe('Autopilot — End-to-End-Szenario', () => {
  let sm;

  beforeEach(() => {
    sm = new AutopilotStateMachine();
  });

  test('Vollständiger Flow: Tab erstellen, Autopilot aktivieren, Nachricht senden', () => {
    sm.createTab('tab1');

    // Initial: kein Autopilot
    expect(sm.activeTab.autopilot).toBe(false);
    let opts = sm.sendMessage('Erste Nachricht');
    expect(opts.autopilot).toBeUndefined();

    // Autopilot aktivieren
    sm.clickAutopilotButton();
    expect(sm.activeTab.autopilot).toBe(true);
    expect(sm._btnActive).toBe(true);

    // Nachricht mit Autopilot
    opts = sm.sendMessage('Zweite Nachricht');
    expect(opts.autopilot).toBe(true);

    // Tab-Wechsel
    sm.createTab('tab2');
    expect(sm._btnActive).toBe(false); // neuer Tab hat keinen Autopilot
    expect(sm.tabs.get('tab1').autopilot).toBe(true); // tab1 bleibt aktiv

    // Zurück zu tab1
    sm.switchTab('tab1');
    expect(sm._btnActive).toBe(true);

    // Autopilot deaktivieren
    sm.clickAutopilotButton();
    expect(sm.activeTab.autopilot).toBe(false);
    opts = sm.sendMessage('Dritte Nachricht');
    expect(opts.autopilot).toBeUndefined();
  });

  test('Szenario: Zwei Tabs mit unterschiedlichen Autopilot-States', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');

    sm.switchTab('tab1');
    sm.clickAutopilotButton(); // tab1: aktiv

    // Nachrichten aus tab1: Autopilot true
    const opt1 = sm.sendMessage('Von Tab 1');
    expect(opt1.autopilot).toBe(true);

    // Zu tab2 wechseln: kein Autopilot
    sm.switchTab('tab2');
    const opt2 = sm.sendMessage('Von Tab 2');
    expect(opt2.autopilot).toBeUndefined();

    // Zurück zu tab1: State wiederhergestellt
    sm.switchTab('tab1');
    const opt3 = sm.sendMessage('Wieder Tab 1');
    expect(opt3.autopilot).toBe(true);
  });

  test('Szenario: CLI-Argument korrekt wenn sendMessage-Options zu spawnCopilot fließen', () => {
    sm.createTab('tab1');
    sm.clickAutopilotButton();

    const opts = sm.sendMessage('Starte Aufgabe');

    // opts.autopilot === true fließt in buildCopilotArgs → --autopilot im CLI
    const args = buildCopilotArgs('Starte Aufgabe', opts);
    expect(args).toContain('--autopilot');
  });

  test('Szenario: Ohne Autopilot kein CLI-Argument', () => {
    sm.createTab('tab1');
    // kein clickAutopilotButton()

    const opts = sm.sendMessage('Normale Aufgabe');

    const args = buildCopilotArgs('Normale Aufgabe', opts);
    expect(args).not.toContain('--autopilot');
  });
});

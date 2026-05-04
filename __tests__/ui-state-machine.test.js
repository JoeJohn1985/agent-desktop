/**
 * UI State Machine Tests — Prüfen Zustandsübergänge der App-Logik.
 * Simuliert Tab-Wechsel, Terminal-Visibility, Theme-Management und
 * Preferences ohne DOM/Electron (reine Logik-Tests).
 */

// ── Tab State Machine (extracted logic) ─────────────────────

class TabStateMachine {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
  }

  createTab(tabId, label = '🤖 Copilot') {
    this.tabs.set(tabId, {
      label,
      sessionId: null,
      isProcessing: false,
      terminalVisible: undefined, // not yet opened
      terminal: null,
    });
    this.activeTabId = tabId;
    return tabId;
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);
    this.activeTabId = tabId;
    const tab = this.tabs.get(tabId);
    // Terminal visibility logic (mirrors app.js switchTab)
    if (tab.terminal && tab.terminalVisible !== false) {
      return { terminalOpen: true };
    }
    return { terminalOpen: false };
  }

  openTerminal(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} existiert nicht`);
    tab.terminal = { alive: true };
    tab.terminalVisible = true;
    return tab;
  }

  minimizeTerminal(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} existiert nicht`);
    tab.terminalVisible = false;
    return tab;
  }

  closeTerminal(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} existiert nicht`);
    tab.terminal = null;
    tab.terminalVisible = undefined;
    return tab;
  }

  closeTab(tabId) {
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) {
      // Switch to last remaining tab or null
      const remaining = [...this.tabs.keys()];
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }

  getActiveTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
  }
}

// ── Theme State Machine ─────────────────────────────────────

class ThemeStateMachine {
  constructor(themes = ['light', 'dark', 'gebit'], defaultTheme = 'dark') {
    this.themes = themes;
    this.current = defaultTheme;
  }

  apply(theme) {
    if (!this.themes.includes(theme)) throw new Error(`Unbekanntes Theme: ${theme}`);
    this.current = theme;
    return this.current;
  }

  cycle() {
    const idx = this.themes.indexOf(this.current);
    this.current = this.themes[(idx + 1) % this.themes.length];
    return this.current;
  }
}

// ── Preferences State Machine ───────────────────────────────

class PreferencesStateMachine {
  constructor(initial = {}) {
    this._prefs = { ...initial };
  }

  get(key, defaultValue) {
    return this._prefs[key] !== undefined ? this._prefs[key] : defaultValue;
  }

  set(key, value) {
    this._prefs[key] = value;
    return this._prefs;
  }

  getAll() {
    return { ...this._prefs };
  }
}

// ══════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════

describe('Tab State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new TabStateMachine();
  });

  test('neuer Tab wird aktiv', () => {
    sm.createTab('tab1', 'Test');
    expect(sm.activeTabId).toBe('tab1');
    expect(sm.tabs.size).toBe(1);
  });

  test('zweiter Tab wird aktiv, erster bleibt erhalten', () => {
    sm.createTab('tab1', 'Eins');
    sm.createTab('tab2', 'Zwei');
    expect(sm.activeTabId).toBe('tab2');
    expect(sm.tabs.size).toBe(2);
    expect(sm.tabs.get('tab1').label).toBe('Eins');
  });

  test('switchTab wechselt aktiven Tab', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    sm.switchTab('tab1');
    expect(sm.activeTabId).toBe('tab1');
  });

  test('switchTab auf nicht-existenten Tab wirft Fehler', () => {
    sm.createTab('tab1');
    expect(() => sm.switchTab('tab99')).toThrow('existiert nicht');
  });

  test('closeTab entfernt Tab und wechselt zum letzten', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    sm.createTab('tab3');
    sm.closeTab('tab3');
    expect(sm.activeTabId).toBe('tab2');
    expect(sm.tabs.size).toBe(2);
  });

  test('closeTab des aktiven wechselt zum verbleibenden', () => {
    sm.createTab('tab1');
    sm.createTab('tab2');
    sm.switchTab('tab2');
    sm.closeTab('tab2');
    expect(sm.activeTabId).toBe('tab1');
  });

  test('alle Tabs schließen → activeTabId ist null', () => {
    sm.createTab('tab1');
    sm.closeTab('tab1');
    expect(sm.activeTabId).toBe(null);
    expect(sm.tabs.size).toBe(0);
  });
});

describe('Terminal Visibility State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new TabStateMachine();
    sm.createTab('tab1');
    sm.createTab('tab2');
  });

  test('Terminal öffnen setzt terminalVisible = true', () => {
    sm.openTerminal('tab1');
    const tab = sm.tabs.get('tab1');
    expect(tab.terminal).not.toBeNull();
    expect(tab.terminalVisible).toBe(true);
  });

  test('Terminal minimieren setzt terminalVisible = false', () => {
    sm.openTerminal('tab1');
    sm.minimizeTerminal('tab1');
    expect(sm.tabs.get('tab1').terminalVisible).toBe(false);
  });

  test('switchTab zu Tab mit minimiertem Terminal → Panel bleibt zu', () => {
    sm.openTerminal('tab1');
    sm.minimizeTerminal('tab1');
    sm.switchTab('tab2');
    const result = sm.switchTab('tab1');
    expect(result.terminalOpen).toBe(false);
  });

  test('switchTab zu Tab mit offenem Terminal → Panel öffnet', () => {
    sm.openTerminal('tab1');
    sm.switchTab('tab2');
    const result = sm.switchTab('tab1');
    expect(result.terminalOpen).toBe(true);
  });

  test('switchTab zu Tab ohne Terminal → Panel geschlossen', () => {
    const result = sm.switchTab('tab2');
    expect(result.terminalOpen).toBe(false);
  });

  test('Terminal schließen → terminal ist null', () => {
    sm.openTerminal('tab1');
    sm.closeTerminal('tab1');
    const tab = sm.tabs.get('tab1');
    expect(tab.terminal).toBeNull();
    expect(tab.terminalVisible).toBeUndefined();
  });

  test('nach closeTerminal: switchTab zeigt kein Panel', () => {
    sm.openTerminal('tab1');
    sm.closeTerminal('tab1');
    sm.switchTab('tab2');
    const result = sm.switchTab('tab1');
    expect(result.terminalOpen).toBe(false);
  });

  test('Terminal in Tab2 offen, Tab1 minimiert: korrektes Wechselverhalten', () => {
    sm.openTerminal('tab1');
    sm.openTerminal('tab2');
    sm.minimizeTerminal('tab1');

    // Wechsel zu tab1 → zu (minimiert)
    const r1 = sm.switchTab('tab1');
    expect(r1.terminalOpen).toBe(false);

    // Wechsel zu tab2 → offen
    const r2 = sm.switchTab('tab2');
    expect(r2.terminalOpen).toBe(true);
  });
});

describe('Theme State Machine', () => {
  let theme;

  beforeEach(() => {
    theme = new ThemeStateMachine();
  });

  test('Standard-Theme ist dark', () => {
    expect(theme.current).toBe('dark');
  });

  test('apply wechselt Theme', () => {
    theme.apply('light');
    expect(theme.current).toBe('light');
  });

  test('apply mit ungültigem Theme wirft Fehler', () => {
    expect(() => theme.apply('neon')).toThrow('Unbekanntes Theme');
  });

  test('cycle rotiert durch Themes', () => {
    // dark → gebit → light → dark
    expect(theme.cycle()).toBe('gebit');
    expect(theme.cycle()).toBe('light');
    expect(theme.cycle()).toBe('dark');
  });

  test('cycle nach apply startet von aktueller Position', () => {
    theme.apply('light');
    expect(theme.cycle()).toBe('dark');
  });
});

describe('Preferences State Machine', () => {
  let prefs;

  beforeEach(() => {
    prefs = new PreferencesStateMachine({ theme: 'dark' });
  });

  test('get gibt gespeicherten Wert zurück', () => {
    expect(prefs.get('theme')).toBe('dark');
  });

  test('get gibt Default zurück wenn Key fehlt', () => {
    expect(prefs.get('sidebarWidth', 280)).toBe(280);
  });

  test('set speichert Wert', () => {
    prefs.set('sidebarWidth', 300);
    expect(prefs.get('sidebarWidth')).toBe(300);
  });

  test('set überschreibt existierenden Wert', () => {
    prefs.set('theme', 'light');
    expect(prefs.get('theme')).toBe('light');
  });

  test('getAll gibt Kopie zurück (keine Referenz)', () => {
    const all = prefs.getAll();
    all.theme = 'gebit';
    expect(prefs.get('theme')).toBe('dark'); // Original unverändert
  });

  test('openTabs Persistenz-Szenario', () => {
    const tabData = [
      { sessionId: 'abc-123', label: 'Tab 1' },
      { sessionId: 'def-456', label: 'Tab 2' },
    ];
    prefs.set('openTabs', tabData);
    const restored = prefs.get('openTabs', []);
    expect(restored).toHaveLength(2);
    expect(restored[0].sessionId).toBe('abc-123');
    expect(restored[1].label).toBe('Tab 2');
  });

  test('settings nested object', () => {
    prefs.set('settings', { allowedTools: ['read', 'write'], chatFontSize: 14 });
    const settings = prefs.get('settings', {});
    expect(settings.allowedTools).toContain('read');
    expect(settings.chatFontSize).toBe(14);
  });
});

describe('Tab + Terminal Interaktions-Szenarien', () => {
  let sm;

  beforeEach(() => {
    sm = new TabStateMachine();
  });

  test('Szenario: 3 Tabs, Terminal in mittlerem, hin-und-her-wechseln', () => {
    sm.createTab('t1', 'Tab 1');
    sm.createTab('t2', 'Tab 2');
    sm.createTab('t3', 'Tab 3');

    // Terminal nur in t2 öffnen
    sm.openTerminal('t2');

    // Von t3 → t1: kein Terminal
    sm.switchTab('t1');
    expect(sm.switchTab('t1').terminalOpen).toBe(false);

    // → t2: Terminal offen
    expect(sm.switchTab('t2').terminalOpen).toBe(true);

    // → t3: kein Terminal
    expect(sm.switchTab('t3').terminalOpen).toBe(false);

    // Zurück zu t2: immer noch offen
    expect(sm.switchTab('t2').terminalOpen).toBe(true);
  });

  test('Szenario: Terminal öffnen, minimieren, neu öffnen', () => {
    sm.createTab('t1');
    sm.openTerminal('t1');
    expect(sm.switchTab('t1').terminalOpen).toBe(true);

    sm.minimizeTerminal('t1');
    expect(sm.switchTab('t1').terminalOpen).toBe(false);

    // "Neu öffnen" = terminalVisible wieder auf true setzen
    sm.tabs.get('t1').terminalVisible = true;
    expect(sm.switchTab('t1').terminalOpen).toBe(true);
  });

  test('Szenario: Tab mit Terminal schließen hat keinen Seiteneffekt auf andere', () => {
    sm.createTab('t1');
    sm.createTab('t2');
    sm.openTerminal('t1');
    sm.openTerminal('t2');

    sm.closeTab('t1');
    expect(sm.tabs.has('t1')).toBe(false);
    expect(sm.tabs.get('t2').terminal).not.toBeNull();
    expect(sm.switchTab('t2').terminalOpen).toBe(true);
  });

  test('Szenario: Den Bug reproduzieren der gefixt wurde', () => {
    // Bug: Terminal war einmal offen → Tab-Wechsel zeigt es immer wieder
    sm.createTab('t1');
    sm.createTab('t2');

    // Terminal in t1 öffnen und minimieren
    sm.openTerminal('t1');
    sm.minimizeTerminal('t1');

    // Wechsel zu t2 und zurück zu t1 → MUSS geschlossen bleiben
    sm.switchTab('t2');
    const result = sm.switchTab('t1');
    expect(result.terminalOpen).toBe(false); // Bug-Fix verifiziert!
  });
});

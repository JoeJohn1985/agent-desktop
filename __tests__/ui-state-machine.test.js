/**
 * UI State Machine Tests — Prüfen Zustandsübergänge der App-Logik.
 * Simuliert Tab-Wechsel, Theme-Management und Preferences
 * ohne DOM/Electron (reine Logik-Tests).
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
    });
    this.activeTabId = tabId;
    return tabId;
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);
    this.activeTabId = tabId;
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
  constructor(themes = ['light', 'dark'], defaultTheme = 'dark') {
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
    // dark → light → dark
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
    all.theme = 'light';
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

// ══════════════════════════════════════════════════════════════
// Tab-Input State Machine (mirrors per-tab input state in app.js)
// ══════════════════════════════════════════════════════════════

class TabInputStateMachine {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.richTextMode = false;
    // Simulated DOM state
    this.inputText = '';
    this.richHtml = '';
  }

  createTab(tabId, label = '🤖 Copilot') {
    this.tabs.set(tabId, {
      label,
      sessionId: null,
      isProcessing: false,
      inputText: '',
      inputRichHtml: '',
      inputRichMode: false,
    });
    this.switchTab(tabId);
    return tabId;
  }

  /**
   * Switch tab: save current input state, then restore target tab state.
   * Mirrors app.js switchTab() input save/restore logic.
   * @param {string} tabId - Target tab ID.
   */
  switchTab(tabId) {
    if (!this.tabs.has(tabId)) throw new Error(`Tab ${tabId} existiert nicht`);

    // Save current input state to previous active tab
    if (this.activeTabId) {
      const prevTab = this.tabs.get(this.activeTabId);
      if (prevTab) {
        prevTab.inputText = this.inputText;
        prevTab.inputRichHtml = this.richHtml;
        prevTab.inputRichMode = this.richTextMode;
      }
    }

    this.activeTabId = tabId;
    const activeTab = this.tabs.get(tabId);

    // Restore input state from new active tab
    this.inputText = activeTab.inputText || '';
    this.richHtml = activeTab.inputRichHtml || '';
    this.richTextMode = activeTab.inputRichMode || false;
  }

  /**
   * Simulate sending a message — clears input state on the active tab.
   * Mirrors app.js sendMessage() clear logic.
   * @returns {string|null} The sent text, or null if empty/no tab.
   */
  sendMessage() {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return null;

    const text = this.richTextMode ? this.richHtml.trim() : this.inputText.trim();
    if (!text) return null;

    if (tab.isProcessing) return null;

    // Clear input (mirrors app.js)
    if (this.richTextMode) {
      this.richHtml = '';
    } else {
      this.inputText = '';
    }

    // Clear tab input state
    tab.inputText = '';
    tab.inputRichHtml = '';

    return text;
  }
}

describe('Tab-Input State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new TabInputStateMachine();
  });

  test('neuer Tab hat leeren Input-State', () => {
    sm.createTab('t1');
    const tab = sm.tabs.get('t1');
    expect(tab.inputText).toBe('');
    expect(tab.inputRichHtml).toBe('');
    expect(tab.inputRichMode).toBe(false);
  });

  test('switchTab speichert Input-State des vorherigen Tabs', () => {
    sm.createTab('t1');
    sm.createTab('t2');

    // Wechsel zu t1, dort Text eingeben
    sm.switchTab('t1');
    sm.inputText = 'Hallo aus Tab 1';

    // Wechsel zu t2 → t1-State wird gespeichert
    sm.switchTab('t2');
    const t1 = sm.tabs.get('t1');
    expect(t1.inputText).toBe('Hallo aus Tab 1');
  });

  test('switchTab stellt Input-State des neuen Tabs wieder her', () => {
    sm.createTab('t1');
    sm.createTab('t2');

    // Text in t2 eingeben
    sm.inputText = 'Text in Tab 2';
    // Wechsel zu t1
    sm.switchTab('t1');
    expect(sm.inputText).toBe('');

    // Wechsel zurück zu t2 → Text wiederhergestellt
    sm.switchTab('t2');
    expect(sm.inputText).toBe('Text in Tab 2');
  });

  test('switchTab stellt richTextMode korrekt pro Tab her', () => {
    sm.createTab('t1');
    sm.createTab('t2');

    // In t2: Rich-Mode aktivieren und HTML eingeben
    sm.richTextMode = true;
    sm.richHtml = '<b>Bold text</b>';

    // Wechsel zu t1 → Plain-Mode
    sm.switchTab('t1');
    expect(sm.richTextMode).toBe(false);
    expect(sm.richHtml).toBe('');

    // Zurück zu t2 → Rich-Mode wiederhergestellt
    sm.switchTab('t2');
    expect(sm.richTextMode).toBe(true);
    expect(sm.richHtml).toBe('<b>Bold text</b>');
  });

  test('sendMessage leert Tab-Input-State', () => {
    sm.createTab('t1');
    sm.inputText = 'Nachricht zum Senden';

    const sent = sm.sendMessage();
    expect(sent).toBe('Nachricht zum Senden');

    const tab = sm.tabs.get('t1');
    expect(tab.inputText).toBe('');
    expect(tab.inputRichHtml).toBe('');
    expect(sm.inputText).toBe('');
  });

  test('sendMessage im Rich-Mode leert richHtml', () => {
    sm.createTab('t1');
    sm.richTextMode = true;
    sm.richHtml = '<b>Rich Nachricht</b>';

    const sent = sm.sendMessage();
    expect(sent).toBe('<b>Rich Nachricht</b>');

    const tab = sm.tabs.get('t1');
    expect(tab.inputText).toBe('');
    expect(tab.inputRichHtml).toBe('');
    expect(sm.richHtml).toBe('');
  });

  test('sendMessage gibt null zurück bei leerem Input', () => {
    sm.createTab('t1');
    sm.inputText = '';
    expect(sm.sendMessage()).toBeNull();
  });

  test('sendMessage gibt null zurück wenn Tab processing', () => {
    sm.createTab('t1');
    sm.inputText = 'Test';
    sm.tabs.get('t1').isProcessing = true;
    expect(sm.sendMessage()).toBeNull();
  });

  test('erster Tab (kein vorheriger): switchTab ohne Fehler', () => {
    // activeTabId ist null → kein prevTab zu speichern
    expect(() => sm.createTab('t1')).not.toThrow();
    expect(sm.activeTabId).toBe('t1');
  });

  test('Input-State bleibt isoliert zwischen Tabs', () => {
    sm.createTab('t1');
    sm.createTab('t2');
    sm.createTab('t3');

    sm.switchTab('t1');
    sm.inputText = 'Tab 1 text';

    sm.switchTab('t2');
    sm.inputText = 'Tab 2 text';

    sm.switchTab('t3');
    sm.inputText = 'Tab 3 text';

    // Verifiziere: Jeder Tab hat seinen eigenen Text
    sm.switchTab('t1');
    expect(sm.inputText).toBe('Tab 1 text');
    sm.switchTab('t2');
    expect(sm.inputText).toBe('Tab 2 text');
    sm.switchTab('t3');
    expect(sm.inputText).toBe('Tab 3 text');
  });
});

/**
 * Tests für Inactivity-Monitor Logik (v0.16.1).
 *
 * Getestet wird die aus renderer/app.js extrahierte State-Logik:
 * - startInactivityMonitor / stopInactivityMonitor
 * - forceUnlockTab (automatisch vs. manuell)
 * - showUnlockButton / hideUnlockButton
 * - Activity-Tracking (lastActivityAt)
 * - Timer-Cleanup
 * - Button nach 30s, Auto-Unlock nach 180s
 */

'use strict';

// ── Konstanten (aus renderer/app.js) ─────────────────────────
const INACTIVITY_TIMEOUT_MS = 180_000;
const INACTIVITY_CHECK_INTERVAL_MS = 10_000;
const UNLOCK_BTN_DELAY_MS = 30_000;

// ── Minimales DOM-Mock ───────────────────────────────────────

function createMockElement(tag = 'div') {
  return {
    tag,
    className: '',
    textContent: '',
    style: { display: '' },
    children: [],
    _listeners: {},
    _removed: false,
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    insertBefore(child, ref) {
      this.children.push(child);
    },
    remove() {
      this._removed = true;
    },
  };
}

// ── Tab-Map + Funktionen (extrahiert aus renderer/app.js) ────

class InactivityMonitor {
  constructor() {
    this.tabs = new Map();
    this._setTabStatusCalls = [];
    this._scrollCalls = [];
    this._stopCalls = [];
  }

  createTab(tabId, opts = {}) {
    const tab = {
      isProcessing: opts.isProcessing ?? false,
      lastActivityAt: null,
      _inactivityTimer: null,
      _unlockBtnTimer: null,
      _unlockBtnEl: null,
      _responseEl: null,
      _thinkingEl: null,
      _thinkingDetails: null,
      statusEl: createMockElement('div'),
      streamEl: createMockElement('div'),
    };
    this.tabs.set(tabId, tab);
    return tab;
  }

  startInactivityMonitor(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    tab.lastActivityAt = Date.now();
    this.stopInactivityMonitor(tabId);

    tab._inactivityTimer = setInterval(() => {
      if (!tab.isProcessing) { this.stopInactivityMonitor(tabId); return; }
      const elapsed = Date.now() - (tab.lastActivityAt || 0);
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        this.forceUnlockTab(tabId, true);
      } else if (elapsed >= UNLOCK_BTN_DELAY_MS && !tab._unlockBtnEl) {
        this.showUnlockButton(tabId);
      } else if (elapsed < UNLOCK_BTN_DELAY_MS && tab._unlockBtnEl) {
        this.hideUnlockButton(tabId);
      }
    }, INACTIVITY_CHECK_INTERVAL_MS);

    tab._unlockBtnTimer = setTimeout(() => {
      if (tab.isProcessing && !tab._unlockBtnEl) {
        const elapsed = Date.now() - (tab.lastActivityAt || 0);
        if (elapsed >= UNLOCK_BTN_DELAY_MS) this.showUnlockButton(tabId);
      }
    }, UNLOCK_BTN_DELAY_MS);
  }

  stopInactivityMonitor(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab._inactivityTimer) { clearInterval(tab._inactivityTimer); tab._inactivityTimer = null; }
    if (tab._unlockBtnTimer) { clearTimeout(tab._unlockBtnTimer); tab._unlockBtnTimer = null; }
    this.hideUnlockButton(tabId);
  }

  forceUnlockTab(tabId, isAutomatic) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.isProcessing) return;

    this._stopCalls.push(tabId);
    tab.isProcessing = false;
    tab._responseEl = null;
    tab._thinkingEl = null;
    tab._thinkingDetails = null;
    tab.statusEl.style.display = 'none';
    this._setTabStatusCalls.push({ tabId, status: 'done' });
    this.stopInactivityMonitor(tabId);

    const infoEl = createMockElement('div');
    infoEl.className = 'stream-unlock-info';
    infoEl.textContent = isAutomatic
      ? '⏱ Keine Aktivität — Tab automatisch entsperrt'
      : '⏱ Tab manuell entsperrt';
    tab.streamEl.insertBefore(infoEl, tab.statusEl);
    this._scrollCalls.push(tabId);
  }

  showUnlockButton(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab._unlockBtnEl) return;

    const btn = createMockElement('button');
    btn.className = 'stream-unlock-btn';
    btn.textContent = '⏱ Hängt? Entsperren';
    btn.addEventListener('click', () => this.forceUnlockTab(tabId, false));
    tab.streamEl.insertBefore(btn, tab.statusEl);
    tab._unlockBtnEl = btn;
    this._scrollCalls.push(tabId);
  }

  hideUnlockButton(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab._unlockBtnEl) return;
    tab._unlockBtnEl.remove();
    tab._unlockBtnEl = null;
  }
}

// ── Tests ────────────────────────────────────────────────────

describe('Inactivity Monitor — Konstanten', () => {
  test('INACTIVITY_TIMEOUT_MS ist 180 Sekunden', () => {
    expect(INACTIVITY_TIMEOUT_MS).toBe(180_000);
  });

  test('INACTIVITY_CHECK_INTERVAL_MS ist 10 Sekunden', () => {
    expect(INACTIVITY_CHECK_INTERVAL_MS).toBe(10_000);
  });

  test('UNLOCK_BTN_DELAY_MS ist 30 Sekunden', () => {
    expect(UNLOCK_BTN_DELAY_MS).toBe(30_000);
  });
});

describe('Inactivity Monitor — startInactivityMonitor', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('setzt lastActivityAt auf Date.now()', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    expect(tab.lastActivityAt).toBeNull();

    jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    monitor.startInactivityMonitor('t1');
    expect(tab.lastActivityAt).toBe(Date.now());
  });

  test('setzt _inactivityTimer (setInterval)', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    expect(tab._inactivityTimer).not.toBeNull();
  });

  test('setzt _unlockBtnTimer (setTimeout)', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    expect(tab._unlockBtnTimer).not.toBeNull();
  });

  test('tut nichts für unbekannte tabId', () => {
    expect(() => monitor.startInactivityMonitor('nonexistent')).not.toThrow();
  });

  test('räumt vorherigen Monitor auf bevor neuer gestartet wird', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    const firstTimer = tab._inactivityTimer;
    const firstBtnTimer = tab._unlockBtnTimer;

    monitor.startInactivityMonitor('t1');
    // Neue Timer sollten gesetzt sein, alte aufgeräumt
    expect(tab._inactivityTimer).not.toBeNull();
    expect(tab._unlockBtnTimer).not.toBeNull();
    expect(tab._inactivityTimer).not.toBe(firstTimer);
  });
});

describe('Inactivity Monitor — stopInactivityMonitor', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('löscht _inactivityTimer', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    expect(tab._inactivityTimer).not.toBeNull();

    monitor.stopInactivityMonitor('t1');
    expect(tab._inactivityTimer).toBeNull();
  });

  test('löscht _unlockBtnTimer', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    expect(tab._unlockBtnTimer).not.toBeNull();

    monitor.stopInactivityMonitor('t1');
    expect(tab._unlockBtnTimer).toBeNull();
  });

  test('entfernt Unlock-Button (hideUnlockButton)', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');
    expect(tab._unlockBtnEl).not.toBeNull();

    monitor.stopInactivityMonitor('t1');
    expect(tab._unlockBtnEl).toBeNull();
  });

  test('tut nichts für unbekannte tabId', () => {
    expect(() => monitor.stopInactivityMonitor('nonexistent')).not.toThrow();
  });

  test('kann mehrfach aufgerufen werden ohne Fehler', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    monitor.stopInactivityMonitor('t1');
    monitor.stopInactivityMonitor('t1');
    monitor.stopInactivityMonitor('t1');
    expect(tab._inactivityTimer).toBeNull();
    expect(tab._unlockBtnTimer).toBeNull();
  });
});

describe('Inactivity Monitor — forceUnlockTab', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('setzt isProcessing auf false', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    expect(tab.isProcessing).toBe(false);
  });

  test('setzt _responseEl, _thinkingEl, _thinkingDetails auf null', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    tab._responseEl = 'something';
    tab._thinkingEl = 'something';
    tab._thinkingDetails = 'something';

    monitor.forceUnlockTab('t1', true);
    expect(tab._responseEl).toBeNull();
    expect(tab._thinkingEl).toBeNull();
    expect(tab._thinkingDetails).toBeNull();
  });

  test('versteckt statusEl', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    expect(tab.statusEl.style.display).toBe('none');
  });

  test('setzt Tab-Status auf "done"', () => {
    monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    expect(monitor._setTabStatusCalls).toEqual([{ tabId: 't1', status: 'done' }]);
  });

  test('ruft stopInactivityMonitor auf', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    expect(tab._inactivityTimer).not.toBeNull();

    monitor.forceUnlockTab('t1', true);
    expect(tab._inactivityTimer).toBeNull();
    expect(tab._unlockBtnTimer).toBeNull();
  });

  test('automatisch: zeigt "automatisch entsperrt" Nachricht', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);

    const infoEl = tab.streamEl.children[0];
    expect(infoEl.className).toBe('stream-unlock-info');
    expect(infoEl.textContent).toContain('automatisch entsperrt');
    expect(infoEl.textContent).toContain('Keine Aktivität');
  });

  test('manuell: zeigt "manuell entsperrt" Nachricht', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', false);

    const infoEl = tab.streamEl.children[0];
    expect(infoEl.className).toBe('stream-unlock-info');
    expect(infoEl.textContent).toContain('manuell entsperrt');
    expect(infoEl.textContent).not.toContain('Keine Aktivität');
  });

  test('tut nichts wenn Tab nicht processing ist', () => {
    const tab = monitor.createTab('t1', { isProcessing: false });
    monitor.forceUnlockTab('t1', true);
    expect(tab.streamEl.children).toHaveLength(0);
    expect(monitor._setTabStatusCalls).toHaveLength(0);
  });

  test('tut nichts für unbekannte tabId', () => {
    expect(() => monitor.forceUnlockTab('nonexistent', true)).not.toThrow();
    expect(monitor._setTabStatusCalls).toHaveLength(0);
  });

  test('verhindert doppeltes Unlock', () => {
    monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    monitor.forceUnlockTab('t1', true); // zweites Mal → isProcessing bereits false
    expect(monitor._setTabStatusCalls).toHaveLength(1);
  });

  test('stoppt Backend-Prozess (desktop.chat.stop)', () => {
    monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    expect(monitor._stopCalls).toEqual(['t1']);
  });

  test('stoppt Backend-Prozess nicht bei doppeltem Unlock', () => {
    monitor.createTab('t1', { isProcessing: true });
    monitor.forceUnlockTab('t1', true);
    monitor.forceUnlockTab('t1', true);
    expect(monitor._stopCalls).toHaveLength(1);
  });
});

describe('Inactivity Monitor — showUnlockButton / hideUnlockButton', () => {
  let monitor;

  beforeEach(() => {
    monitor = new InactivityMonitor();
  });

  test('showUnlockButton erstellt Button-Element', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');

    expect(tab._unlockBtnEl).not.toBeNull();
    expect(tab._unlockBtnEl.className).toBe('stream-unlock-btn');
    expect(tab._unlockBtnEl.textContent).toContain('Entsperren');
  });

  test('showUnlockButton fügt Button in streamEl ein', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');
    expect(tab.streamEl.children).toHaveLength(1);
    expect(tab.streamEl.children[0]).toBe(tab._unlockBtnEl);
  });

  test('showUnlockButton registriert Click-Handler für manuelles Unlock', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');

    expect(tab._unlockBtnEl._listeners.click).toHaveLength(1);
    // Klick simulieren → manuelles forceUnlockTab
    tab._unlockBtnEl._listeners.click[0]();
    expect(tab.isProcessing).toBe(false);
    expect(monitor._setTabStatusCalls[0]).toEqual({ tabId: 't1', status: 'done' });
  });

  test('showUnlockButton zeigt Button nicht doppelt', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');
    const firstBtn = tab._unlockBtnEl;
    monitor.showUnlockButton('t1'); // erneut → guard
    expect(tab._unlockBtnEl).toBe(firstBtn);
    expect(tab.streamEl.children).toHaveLength(1);
  });

  test('showUnlockButton tut nichts für unbekannte tabId', () => {
    expect(() => monitor.showUnlockButton('nonexistent')).not.toThrow();
  });

  test('hideUnlockButton entfernt Button und setzt null', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.showUnlockButton('t1');
    const btn = tab._unlockBtnEl;

    monitor.hideUnlockButton('t1');
    expect(tab._unlockBtnEl).toBeNull();
    expect(btn._removed).toBe(true);
  });

  test('hideUnlockButton tut nichts wenn kein Button existiert', () => {
    monitor.createTab('t1');
    expect(() => monitor.hideUnlockButton('t1')).not.toThrow();
  });

  test('hideUnlockButton tut nichts für unbekannte tabId', () => {
    expect(() => monitor.hideUnlockButton('nonexistent')).not.toThrow();
  });
});

describe('Inactivity Monitor — Activity-Tracking', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('lastActivityAt wird bei Start initialisiert', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    jest.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    monitor.startInactivityMonitor('t1');
    expect(tab.lastActivityAt).toBe(new Date('2025-06-01T10:00:00Z').getTime());
  });

  test('lastActivityAt kann extern aktualisiert werden (Stream-Events)', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    jest.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    monitor.startInactivityMonitor('t1');

    jest.setSystemTime(new Date('2025-06-01T10:01:00Z'));
    tab.lastActivityAt = Date.now(); // Simuliert Stream-Event

    expect(tab.lastActivityAt).toBe(new Date('2025-06-01T10:01:00Z').getTime());
  });

  test('Activity-Update verzögert Unlock-Button', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    jest.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    monitor.startInactivityMonitor('t1');

    // Nach 20s: Activity-Update
    jest.advanceTimersByTime(20_000);
    tab.lastActivityAt = Date.now(); // Reset durch Stream-Event

    // Nach weiteren 15s (35s total, aber nur 15s seit Activity)
    jest.advanceTimersByTime(15_000);
    // Button sollte NICHT angezeigt werden (nur 15s seit letzter Activity)
    expect(tab._unlockBtnEl).toBeNull();
  });

  test('Activity-Update verzögert Auto-Unlock', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    jest.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    monitor.startInactivityMonitor('t1');

    // Nach 170s: Activity-Update (kurz vor Timeout)
    jest.advanceTimersByTime(170_000);
    tab.lastActivityAt = Date.now();

    // Nach weiteren 20s (190s total, aber nur 20s seit Activity)
    jest.advanceTimersByTime(20_000);
    // Tab sollte NICHT auto-unlocked sein
    expect(tab.isProcessing).toBe(true);
  });
});

describe('Inactivity Monitor — Timer-basiertes Verhalten (Fake Timers)', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Unlock-Button erscheint nach 30s via setTimeout', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    // Vor 30s: kein Button
    jest.advanceTimersByTime(29_999);
    expect(tab._unlockBtnEl).toBeNull();

    // Nach 30s: Button erscheint (via setTimeout UNLOCK_BTN_DELAY_MS)
    jest.advanceTimersByTime(1);
    expect(tab._unlockBtnEl).not.toBeNull();
    expect(tab._unlockBtnEl.className).toBe('stream-unlock-btn');
  });

  test('Unlock-Button erscheint auch via setInterval-Check', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    // Springe auf genau 30s (mit Interval-Tick bei 30s)
    jest.advanceTimersByTime(30_000);
    expect(tab._unlockBtnEl).not.toBeNull();
  });

  test('Auto-Unlock nach 180s Inaktivität', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    // Vor 180s: Tab noch aktiv
    jest.advanceTimersByTime(179_999);
    expect(tab.isProcessing).toBe(true);

    // Nach 180s: nächster Interval-Check löst Unlock aus
    jest.advanceTimersByTime(10_001); // bis zum nächsten 10s-Interval
    expect(tab.isProcessing).toBe(false);
  });

  test('Auto-Unlock zeigt automatische Nachricht', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    jest.advanceTimersByTime(190_000); // weit über 180s
    expect(tab.isProcessing).toBe(false);

    const infoEls = tab.streamEl.children.filter(c => c.className === 'stream-unlock-info');
    expect(infoEls.length).toBeGreaterThanOrEqual(1);
    expect(infoEls[0].textContent).toContain('automatisch entsperrt');
  });

  test('Timer stoppen nach Auto-Unlock', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    jest.advanceTimersByTime(190_000);
    expect(tab._inactivityTimer).toBeNull();
    expect(tab._unlockBtnTimer).toBeNull();
  });

  test('Interval stoppt wenn isProcessing extern auf false gesetzt wird', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    tab.isProcessing = false; // extern (z.B. normaler onDone)
    jest.advanceTimersByTime(10_000); // nächster Interval-Check
    expect(tab._inactivityTimer).toBeNull();
  });

  test('hideUnlockButton wird aufgerufen wenn Activity wieder kommt', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    jest.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    monitor.startInactivityMonitor('t1');

    // Button erscheint nach 30s
    jest.advanceTimersByTime(30_000);
    expect(tab._unlockBtnEl).not.toBeNull();

    // Activity kommt zurück
    tab.lastActivityAt = Date.now();

    // Nächster Interval-Check: elapsed < 30s → Button wird entfernt
    jest.advanceTimersByTime(10_000);
    expect(tab._unlockBtnEl).toBeNull();
  });
});

describe('Inactivity Monitor — Tab-Initialisierung', () => {
  test('neue Tabs haben korrekte Initialwerte für Monitor-Properties', () => {
    const monitor = new InactivityMonitor();
    const tab = monitor.createTab('t1');

    expect(tab.lastActivityAt).toBeNull();
    expect(tab._inactivityTimer).toBeNull();
    expect(tab._unlockBtnTimer).toBeNull();
    expect(tab._unlockBtnEl).toBeNull();
  });

  test('isProcessing ist standardmäßig false', () => {
    const monitor = new InactivityMonitor();
    const tab = monitor.createTab('t1');
    expect(tab.isProcessing).toBe(false);
  });
});

describe('Inactivity Monitor — Edge Cases', () => {
  let monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new InactivityMonitor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startInactivityMonitor auf Tab das nicht processing ist: Timer laufen, aber Interval stoppt sofort', () => {
    const tab = monitor.createTab('t1', { isProcessing: false });
    monitor.startInactivityMonitor('t1');

    // Timer ist gesetzt
    expect(tab._inactivityTimer).not.toBeNull();

    // Erster Interval-Check → isProcessing false → stoppt sich selbst
    jest.advanceTimersByTime(10_000);
    expect(tab._inactivityTimer).toBeNull();
  });

  test('mehrere Tabs funktionieren unabhängig', () => {
    const tab1 = monitor.createTab('t1', { isProcessing: true });
    const tab2 = monitor.createTab('t2', { isProcessing: true });

    monitor.startInactivityMonitor('t1');
    monitor.startInactivityMonitor('t2');

    // Stoppe nur t1
    monitor.stopInactivityMonitor('t1');
    expect(tab1._inactivityTimer).toBeNull();
    expect(tab2._inactivityTimer).not.toBeNull();

    // t2 läuft weiter und auto-unlocked
    jest.advanceTimersByTime(190_000);
    expect(tab2.isProcessing).toBe(false);
  });

  test('forceUnlockTab nach stopInactivityMonitor tut nichts (nicht mehr processing)', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    // Normal beenden
    tab.isProcessing = false;
    monitor.stopInactivityMonitor('t1');

    // Versuch force unlock → guard: !tab.isProcessing
    monitor.forceUnlockTab('t1', true);
    expect(monitor._setTabStatusCalls).toHaveLength(0);
  });

  test('lastActivityAt null wird als 0 behandelt', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');
    tab.lastActivityAt = null; // extern auf null gesetzt

    // Nächster Check: elapsed = Date.now() - 0 → riesig → auto-unlock
    jest.advanceTimersByTime(10_000);
    expect(tab.isProcessing).toBe(false);
  });

  test('setTimeout Button-Check respektiert wenn Tab nicht mehr processing', () => {
    const tab = monitor.createTab('t1', { isProcessing: true });
    monitor.startInactivityMonitor('t1');

    // Beende Tab bevor setTimeout feuert
    tab.isProcessing = false;

    // setTimeout nach 30s feuert → guard: isProcessing false → kein Button
    jest.advanceTimersByTime(30_000);
    // Der setTimeout-Guard verhindert Button-Anzeige
    // (Aber Interval hat bei 10s schon gestoppt, was unlockBtnTimer killt)
    expect(tab._unlockBtnEl).toBeNull();
  });
});

'use strict';

const {
  SHORTCUT_DEFS,
  FIXED_SHORTCUTS,
  resolveShortcut,
  matchShortcut,
  shortcutLabel,
} = require('../src/shortcuts');

// ── SHORTCUT_DEFS ────────────────────────────────────────────

describe('SHORTCUT_DEFS', () => {
  test('enthält alle erwarteten konfigurierbaren Shortcuts', () => {
    const ids = SHORTCUT_DEFS.map(d => d.id).sort();
    expect(ids).toEqual([
      'closeTab', 'exportChat', 'focusInput', 'newTab', 'nextTab',
      'prevTab', 'search', 'showShortcuts', 'toggleSidebar',
    ]);
  });

  test('jede Definition hat id, label, category und default-Binding', () => {
    for (const def of SHORTCUT_DEFS) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(['Tabs', 'Chat', 'UI']).toContain(def.category);
      expect(def.default).toMatchObject({
        ctrl: expect.any(Boolean),
        shift: expect.any(Boolean),
        alt: expect.any(Boolean),
        key: expect.any(String),
      });
    }
  });

  test('alle Shortcut-IDs sind eindeutig', () => {
    const ids = SHORTCUT_DEFS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('keine zwei konfigurierbaren Shortcuts haben dieselbe Default-Bindung', () => {
    const seen = new Map();
    for (const def of SHORTCUT_DEFS) {
      const key = shortcutLabel(def.default);
      expect(seen.has(key)).toBe(false);
      seen.set(key, def.id);
    }
  });
});

// ── FIXED_SHORTCUTS ──────────────────────────────────────────

describe('FIXED_SHORTCUTS', () => {
  test('enthält Tab-Direktwahl, letzter Tab und Escape', () => {
    expect(FIXED_SHORTCUTS).toHaveLength(3);
    const labels = FIXED_SHORTCUTS.map(s => s.label);
    expect(labels).toContain('Tab 1–8 direkt');
    expect(labels).toContain('Letzter Tab');
    expect(labels).toContain('Aktion abbrechen');
  });

  test('jede Fixed-Definition hat label, binding und category', () => {
    for (const sc of FIXED_SHORTCUTS) {
      expect(typeof sc.label).toBe('string');
      expect(typeof sc.category).toBe('string');
      expect(sc.binding).toMatchObject({
        ctrl: expect.any(Boolean),
        shift: expect.any(Boolean),
        alt: expect.any(Boolean),
        key: expect.any(String),
      });
    }
  });

  test('Escape-Shortcut hat keinerlei Modifier', () => {
    const esc = FIXED_SHORTCUTS.find(s => s.binding.key === 'Escape');
    expect(esc).toBeDefined();
    expect(esc.binding.ctrl).toBe(false);
    expect(esc.binding.shift).toBe(false);
    expect(esc.binding.alt).toBe(false);
  });
});

// ── resolveShortcut ──────────────────────────────────────────

describe('resolveShortcut', () => {
  test('gibt Default zurück wenn keine Prefs vorhanden', () => {
    const r = resolveShortcut({}, 'newTab');
    expect(r).toEqual({ ctrl: true, shift: false, alt: false, key: 't' });
  });

  test('gibt Default zurück wenn Prefs null/undefined', () => {
    expect(resolveShortcut(null, 'newTab').key).toBe('t');
    expect(resolveShortcut(undefined, 'newTab').key).toBe('t');
  });

  test('User-Override hat Vorrang vor Default', () => {
    const prefs = { newTab: { ctrl: true, shift: true, alt: false, key: 'n' } };
    const r = resolveShortcut(prefs, 'newTab');
    expect(r).toEqual({ ctrl: true, shift: true, alt: false, key: 'n' });
  });

  test('liefert null für unbekannte ID', () => {
    expect(resolveShortcut({}, 'doesNotExist')).toBeNull();
  });

  test('Override für eine ID beeinflusst andere IDs nicht', () => {
    const prefs = { newTab: { ctrl: false, shift: false, alt: false, key: 'q' } };
    expect(resolveShortcut(prefs, 'newTab').key).toBe('q');
    expect(resolveShortcut(prefs, 'closeTab').key).toBe('w');
  });
});

// ── matchShortcut ────────────────────────────────────────────

describe('matchShortcut', () => {
  const binding = { ctrl: true, shift: false, alt: false, key: 't' };

  test('matched Event mit identischer Tastenkombination', () => {
    const e = { key: 't', ctrlKey: true, shiftKey: false, altKey: false };
    expect(matchShortcut(e, binding)).toBe(true);
  });

  test('matched nicht bei abweichender Taste', () => {
    const e = { key: 'n', ctrlKey: true, shiftKey: false, altKey: false };
    expect(matchShortcut(e, binding)).toBe(false);
  });

  test('matched nicht bei zusätzlichem Modifier', () => {
    const e = { key: 't', ctrlKey: true, shiftKey: true, altKey: false };
    expect(matchShortcut(e, binding)).toBe(false);
  });

  test('matched nicht bei fehlendem Modifier', () => {
    const e = { key: 't', ctrlKey: false, shiftKey: false, altKey: false };
    expect(matchShortcut(e, binding)).toBe(false);
  });

  test('Shift+Modifier muss exakt übereinstimmen', () => {
    const b = { ctrl: true, shift: true, alt: false, key: 'Tab' };
    expect(matchShortcut({ key: 'Tab', ctrlKey: true, shiftKey: true, altKey: false }, b)).toBe(true);
    expect(matchShortcut({ key: 'Tab', ctrlKey: true, shiftKey: false, altKey: false }, b)).toBe(false);
  });

  test('Key-Vergleich ist case-sensitive', () => {
    expect(matchShortcut({ key: 'T', ctrlKey: true, shiftKey: false, altKey: false }, binding)).toBe(false);
  });

  test('gibt false zurück bei null/undefined Event oder Binding', () => {
    expect(matchShortcut(null, binding)).toBe(false);
    expect(matchShortcut({ key: 't', ctrlKey: true }, null)).toBe(false);
    expect(matchShortcut(undefined, binding)).toBe(false);
  });

  test('behandelt fehlende ctrlKey/shiftKey/altKey als false', () => {
    const noModBinding = { ctrl: false, shift: false, alt: false, key: 'Escape' };
    expect(matchShortcut({ key: 'Escape' }, noModBinding)).toBe(true);
  });
});

// ── shortcutLabel ────────────────────────────────────────────

describe('shortcutLabel', () => {
  test('zeigt Ctrl+Key', () => {
    expect(shortcutLabel({ ctrl: true, shift: false, alt: false, key: 't' })).toBe('Ctrl+t');
  });

  test('zeigt Modifier in Reihenfolge Ctrl, Shift, Alt', () => {
    expect(shortcutLabel({ ctrl: true, shift: true, alt: true, key: 'x' })).toBe('Ctrl+Shift+Alt+x');
  });

  test('zeigt nur Key wenn keine Modifier gesetzt', () => {
    expect(shortcutLabel({ ctrl: false, shift: false, alt: false, key: 'Escape' })).toBe('Escape');
  });

  test('rendert Leerzeichen als "Space"', () => {
    expect(shortcutLabel({ ctrl: true, shift: false, alt: false, key: ' ' })).toBe('Ctrl+Space');
  });

  test('zeigt Shift+Tab korrekt', () => {
    expect(shortcutLabel({ ctrl: true, shift: true, alt: false, key: 'Tab' })).toBe('Ctrl+Shift+Tab');
  });

  test('zeigt Alt-only-Kombination korrekt', () => {
    expect(shortcutLabel({ ctrl: false, shift: false, alt: true, key: 'F4' })).toBe('Alt+F4');
  });

  test('gibt leeren String für null/undefined Binding zurück', () => {
    expect(shortcutLabel(null)).toBe('');
    expect(shortcutLabel(undefined)).toBe('');
  });

  test('rendert die Default-Bindings aller SHORTCUT_DEFS ohne Fehler', () => {
    for (const def of SHORTCUT_DEFS) {
      const label = shortcutLabel(def.default);
      expect(label).toMatch(/Ctrl/);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ── Integration: SHORTCUT_DEFS x matchShortcut ──────────────

describe('Integration: SHORTCUT_DEFS via matchShortcut', () => {
  test('Default-Binding für newTab matched ein Ctrl+T-Event', () => {
    const def = SHORTCUT_DEFS.find(d => d.id === 'newTab');
    const e = { key: 't', ctrlKey: true, shiftKey: false, altKey: false };
    expect(matchShortcut(e, def.default)).toBe(true);
  });

  test('Default-Binding für prevTab matched ein Ctrl+Shift+Tab-Event', () => {
    const def = SHORTCUT_DEFS.find(d => d.id === 'prevTab');
    const e = { key: 'Tab', ctrlKey: true, shiftKey: true, altKey: false };
    expect(matchShortcut(e, def.default)).toBe(true);
  });

  test('Default-Binding für showShortcuts matched ein Ctrl+/-Event', () => {
    const def = SHORTCUT_DEFS.find(d => d.id === 'showShortcuts');
    const e = { key: '/', ctrlKey: true, shiftKey: false, altKey: false };
    expect(matchShortcut(e, def.default)).toBe(true);
  });
});

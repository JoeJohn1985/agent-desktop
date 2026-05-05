'use strict';

const {
  isSessionIdLike,
  stripShellWrapper,
  wrapShell,
  createNamedSessionsManager,
} = require('../src/named-sessions');

// ── isSessionIdLike ──────────────────────────────────────────

describe('isSessionIdLike', () => {
  test('erkennt gültige UUID', () => {
    expect(isSessionIdLike('8c205927-6dbd-42aa-9a42-e7e8551a3ee0')).toBe(true);
  });

  test('erkennt kurze alphanumerische IDs (>= 8 Zeichen)', () => {
    expect(isSessionIdLike('abcd1234')).toBe(true);
    expect(isSessionIdLike('session_test-123')).toBe(true);
  });

  test('lehnt zu kurze Strings ab (< 8 Zeichen)', () => {
    expect(isSessionIdLike('abc1234')).toBe(false);
    expect(isSessionIdLike('short')).toBe(false);
  });

  test('lehnt Strings mit Sonderzeichen ab', () => {
    expect(isSessionIdLike('session id with spaces')).toBe(false);
    expect(isSessionIdLike('path/to/file')).toBe(false);
    expect(isSessionIdLike('name@host')).toBe(false);
    expect(isSessionIdLike('git push --force')).toBe(false);
  });

  test('lehnt null/undefined/leere Strings ab', () => {
    expect(isSessionIdLike(null)).toBe(false);
    expect(isSessionIdLike(undefined)).toBe(false);
    expect(isSessionIdLike('')).toBe(false);
  });

  test('akzeptiert Unterstriche und Bindestriche', () => {
    expect(isSessionIdLike('my_session-id-12345')).toBe(true);
  });
});

// ── stripShellWrapper ────────────────────────────────────────

describe('stripShellWrapper', () => {
  test('entfernt shell() Wrapper', () => {
    expect(stripShellWrapper('shell(git push)')).toBe('git push');
    expect(stripShellWrapper('shell(rm -rf /)')).toBe('rm -rf /');
  });

  test('lässt Strings ohne Wrapper unverändert', () => {
    expect(stripShellWrapper('git push')).toBe('git push');
    expect(stripShellWrapper('npm install')).toBe('npm install');
  });

  test('behandelt leere/null-Werte', () => {
    expect(stripShellWrapper('')).toBe('');
    expect(stripShellWrapper(null)).toBe('');
    expect(stripShellWrapper(undefined)).toBe('');
  });

  test('entfernt nur äußeren Wrapper, nicht verschachtelten', () => {
    expect(stripShellWrapper('shell(echo shell(hello))')).toBe('echo shell(hello)');
  });
});

// ── wrapShell ────────────────────────────────────────────────

describe('wrapShell', () => {
  test('wraps plain command in shell()', () => {
    expect(wrapShell('git push')).toBe('shell(git push)');
    expect(wrapShell('rm -rf /')).toBe('shell(rm -rf /)');
  });

  test('lässt bereits gewrappte Commands unverändert', () => {
    expect(wrapShell('shell(git push)')).toBe('shell(git push)');
  });

  test('trimmt Whitespace', () => {
    expect(wrapShell('  git push  ')).toBe('shell(git push)');
  });

  test('gibt leeren String für null/undefined/leer zurück', () => {
    expect(wrapShell(null)).toBe('');
    expect(wrapShell(undefined)).toBe('');
    expect(wrapShell('')).toBe('');
    expect(wrapShell('   ')).toBe('');
  });
});

// ── createNamedSessionsManager ───────────────────────────────

describe('createNamedSessionsManager', () => {
  let store;
  let mgr;

  beforeEach(() => {
    store = { namedSessions: {} };
    mgr = createNamedSessionsManager(store);
  });

  // ── setName / getName ──────────────────────────────────────

  describe('setName / getName', () => {
    test('speichert und liest Session-Namen', () => {
      mgr.setName('abc-123', 'Mein Projekt');
      expect(mgr.getName('abc-123')).toBe('Mein Projekt');
    });

    test('erzeugt neuen Eintrag mit deniedTools und lastUsed', () => {
      mgr.setName('new-session', 'Test');
      const entry = mgr.getEntry('new-session');
      expect(entry.name).toBe('Test');
      expect(entry.deniedTools).toEqual([]);
      expect(entry.lastUsed).toBeTruthy();
    });

    test('überschreibt nur den Namen bei existierendem Eintrag', () => {
      store.namedSessions['existing'] = {
        name: 'Alt',
        deniedTools: [{ name: 'shell(git push)', enabled: true }],
        lastUsed: '2026-01-01T00:00:00.000Z',
      };
      mgr.setName('existing', 'Neu');
      const entry = mgr.getEntry('existing');
      expect(entry.name).toBe('Neu');
      expect(entry.deniedTools).toHaveLength(1); // nicht gelöscht
      expect(entry.lastUsed).toBe('2026-01-01T00:00:00.000Z'); // nicht geändert
    });

    test('gibt null zurück für unbekannte SessionId', () => {
      expect(mgr.getName('unknown')).toBeNull();
    });
  });

  // ── remove ─────────────────────────────────────────────────

  describe('remove', () => {
    test('entfernt Session komplett', () => {
      mgr.setName('to-delete', 'Temp');
      expect(mgr.getName('to-delete')).toBe('Temp');
      mgr.remove('to-delete');
      expect(mgr.getName('to-delete')).toBeNull();
    });

    test('wirft keinen Fehler bei unbekannter Session', () => {
      expect(() => mgr.remove('nonexistent')).not.toThrow();
    });
  });

  // ── touch ──────────────────────────────────────────────────

  describe('touch', () => {
    test('aktualisiert lastUsed Timestamp', () => {
      store.namedSessions['sess-1'] = {
        name: 'Test',
        deniedTools: [],
        lastUsed: '2020-01-01T00:00:00.000Z',
      };
      const before = store.namedSessions['sess-1'].lastUsed;
      mgr.touch('sess-1');
      expect(store.namedSessions['sess-1'].lastUsed).not.toBe(before);
      expect(new Date(store.namedSessions['sess-1'].lastUsed).getFullYear()).toBeGreaterThanOrEqual(2026);
    });

    test('tut nichts bei unbekannter Session', () => {
      expect(() => mgr.touch('unknown')).not.toThrow();
    });
  });

  // ── deniedTools ────────────────────────────────────────────

  describe('getDeniedTools / saveDeniedTools', () => {
    test('gibt leeres Array für neue Session zurück', () => {
      mgr.setName('s1', 'Fresh');
      expect(mgr.getDeniedTools('s1')).toEqual([]);
    });

    test('speichert und lädt denied tools', () => {
      mgr.setName('s1', 'Tooled');
      const tools = [
        { name: 'shell(git push)', enabled: true, pinned: true },
        { name: 'shell(rm -rf)', enabled: false, pinned: false },
      ];
      mgr.saveDeniedTools('s1', tools);
      expect(mgr.getDeniedTools('s1')).toEqual(tools);
    });

    test('gibt leeres Array für unbekannte Session zurück', () => {
      expect(mgr.getDeniedTools('nope')).toEqual([]);
    });

    test('tut nichts bei saveDeniedTools für unbekannte Session', () => {
      expect(() => mgr.saveDeniedTools('nope', [{ name: 'x' }])).not.toThrow();
      expect(store.namedSessions['nope']).toBeUndefined();
    });
  });

  // ── getSortedList ──────────────────────────────────────────

  describe('getSortedList', () => {
    test('sortiert nach lastUsed absteigend (neueste zuerst)', () => {
      store.namedSessions = {
        'old': { name: 'Alte Session', deniedTools: [], lastUsed: '2026-01-01T00:00:00.000Z' },
        'new': { name: 'Neue Session', deniedTools: [], lastUsed: '2026-05-05T20:00:00.000Z' },
        'mid': { name: 'Mittlere Session', deniedTools: [], lastUsed: '2026-03-15T12:00:00.000Z' },
      };
      const list = mgr.getSortedList();
      expect(list[0].id).toBe('new');
      expect(list[1].id).toBe('mid');
      expect(list[2].id).toBe('old');
    });

    test('gibt leere Liste zurück wenn keine Sessions vorhanden', () => {
      store.namedSessions = {};
      expect(mgr.getSortedList()).toEqual([]);
    });

    test('Sessions ohne lastUsed kommen nach hinten', () => {
      store.namedSessions = {
        'with-date': { name: 'A', deniedTools: [], lastUsed: '2026-05-01T00:00:00.000Z' },
        'no-date': { name: 'B', deniedTools: [] },
      };
      const list = mgr.getSortedList();
      expect(list[0].id).toBe('with-date');
      expect(list[1].id).toBe('no-date');
    });

    test('enthält id, name und lastUsed Felder', () => {
      mgr.setName('test-session', 'Mein Test');
      const list = mgr.getSortedList();
      expect(list[0]).toHaveProperty('id', 'test-session');
      expect(list[0]).toHaveProperty('name', 'Mein Test');
      expect(list[0]).toHaveProperty('lastUsed');
    });
  });

  // ── Pin-Logik (max 5) ─────────────────────────────────────

  describe('Pinned Tools (max 5)', () => {
    test('kann bis zu 5 Tools pinnen', () => {
      mgr.setName('s1', 'Test');
      const tools = [];
      for (let i = 0; i < 5; i++) {
        tools.push({ name: `shell(cmd${i})`, enabled: true, pinned: true });
      }
      mgr.saveDeniedTools('s1', tools);
      const pinned = mgr.getDeniedTools('s1').filter(t => t.pinned);
      expect(pinned).toHaveLength(5);
    });

    test('Tools behalten ihre enabled/pinned-Flags', () => {
      mgr.setName('s1', 'Test');
      mgr.saveDeniedTools('s1', [
        { name: 'shell(git push)', enabled: true, pinned: true },
        { name: 'shell(rm)', enabled: false, pinned: false },
      ]);
      const tools = mgr.getDeniedTools('s1');
      expect(tools[0].pinned).toBe(true);
      expect(tools[0].enabled).toBe(true);
      expect(tools[1].pinned).toBe(false);
      expect(tools[1].enabled).toBe(false);
    });
  });
});

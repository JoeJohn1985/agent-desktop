'use strict';

const {
  isSessionIdLike,
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

    test('erzeugt neuen Eintrag ohne tabbezogene Tool-Konfiguration', () => {
      mgr.setName('new-session', 'Test');
      const entry = mgr.getEntry('new-session');
      expect(entry.name).toBe('Test');
      expect(entry).not.toHaveProperty('deniedTools');
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

});

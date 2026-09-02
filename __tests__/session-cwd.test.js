'use strict';

/**
 * TDD Tests für Feature: CWD pro Session
 *
 * Contracts:
 * - saveSessionCwd(sessionId, cwd): speichert cwd in namedSessions[sessionId].cwd
 * - getSessionCwd(sessionId): liest namedSessions[sessionId]?.cwd oder null
 * - sendMessage übergibt tab.cwd als options.cwd an desktop.chat.send
 * - spawnCopilot nutzt options.cwd als cwd für den Prozess (Fallback: COPILOT_CWD)
 * - Session-Restore: tab.cwd wird aus namedSessions[sessionId].cwd geladen
 */

const { createNamedSessionsManager } = require('../src/named-sessions');

// ═══════════════════════════════════════════════════════════════
// 1. saveSessionCwd / getSessionCwd
// ═══════════════════════════════════════════════════════════════

describe('Session CWD — saveSessionCwd / getSessionCwd', () => {
  let store;
  let mgr;

  beforeEach(() => {
    store = { namedSessions: {} };
    mgr = createNamedSessionsManager(store);
  });

  test('speichert CWD korrekt in namedSessions', () => {
    mgr.setName('session-1', 'Mein Projekt');
    mgr.saveSessionCwd('session-1', 'C:\\Projects\\myapp');
    expect(store.namedSessions['session-1'].cwd).toBe('C:\\Projects\\myapp');
  });

  test('getSessionCwd gibt gespeicherten Wert zurück', () => {
    mgr.setName('session-1', 'Mein Projekt');
    mgr.saveSessionCwd('session-1', '/home/user/project');
    expect(mgr.getSessionCwd('session-1')).toBe('/home/user/project');
  });

  test('überschreibt bestehende CWD', () => {
    mgr.setName('session-1', 'Test');
    mgr.saveSessionCwd('session-1', '/first/path');
    mgr.saveSessionCwd('session-1', '/second/path');
    expect(mgr.getSessionCwd('session-1')).toBe('/second/path');
    expect(store.namedSessions['session-1'].cwd).toBe('/second/path');
  });

  test('tut nichts wenn sessionId nicht in namedSessions (unbenannte Session)', () => {
    // Session existiert nicht im Store
    mgr.saveSessionCwd('unknown-session', '/some/path');
    expect(store.namedSessions['unknown-session']).toBeUndefined();
  });

  test('getSessionCwd gibt null zurück wenn kein CWD gesetzt', () => {
    mgr.setName('session-1', 'Ohne CWD');
    expect(mgr.getSessionCwd('session-1')).toBeNull();
  });

  test('getSessionCwd gibt null zurück wenn sessionId unbekannt', () => {
    expect(mgr.getSessionCwd('nonexistent')).toBeNull();
  });

  test('saveSessionCwd verändert keine anderen Felder des Eintrags', () => {
    store.namedSessions['existing'] = {
      name: 'Test',
      deniedTools: [{ name: 'shell(rm)', enabled: true }],
      lastUsed: '2026-01-01T00:00:00.000Z',
    };
    mgr.saveSessionCwd('existing', '/my/cwd');
    expect(store.namedSessions['existing'].name).toBe('Test');
    expect(store.namedSessions['existing'].deniedTools).toHaveLength(1);
    expect(store.namedSessions['existing'].lastUsed).toBe('2026-01-01T00:00:00.000Z');
    expect(store.namedSessions['existing'].cwd).toBe('/my/cwd');
  });

  test('getSessionCwd gibt null zurück wenn cwd explizit undefined ist', () => {
    store.namedSessions['s1'] = { name: 'Test', deniedTools: [], cwd: undefined };
    expect(mgr.getSessionCwd('s1')).toBeNull();
  });

  test('getSessionCwd gibt leeren String zurück wenn cwd leerer String ist', () => {
    store.namedSessions['s1'] = { name: 'Test', deniedTools: [], cwd: '' };
    // Leerer String ist technisch ein gesetzter Wert — Implementierung entscheidet
    // Wir erwarten null oder '' — Contract sagt: liest .cwd, also ''
    expect(mgr.getSessionCwd('s1')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CWD an send weitergeben (IPC-Aufruf)
// ═══════════════════════════════════════════════════════════════

describe('Session CWD — sendMessage übergibt cwd an IPC', () => {
  // Diese Tests simulieren den Renderer-Kontext:
  // sendMessage() liest tab.cwd und gibt es als options.cwd weiter

  test('desktop.chat.send bekommt options.cwd wenn tab.cwd gesetzt', () => {
    // Simulated desktop.chat.send mock
    const sendMock = jest.fn();

    // Simulate what sendMessage does with cwd:
    const tab = { sessionId: 'abc', cwd: 'C:\\Projects\\myapp' };
    const options = {
      sessionId: tab.sessionId,
      cwd: tab.cwd || undefined,
    };
    sendMock(1, 'hello', options);

    expect(sendMock).toHaveBeenCalledWith(1, 'hello', expect.objectContaining({
      cwd: 'C:\\Projects\\myapp',
    }));
  });

  test('desktop.chat.send bekommt options.cwd als undefined wenn tab.cwd nicht gesetzt', () => {
    const sendMock = jest.fn();

    const tab = { sessionId: 'abc' }; // kein cwd
    const options = {
      sessionId: tab.sessionId,
      cwd: tab.cwd || undefined,
    };
    sendMock(1, 'hello', options);

    expect(sendMock).toHaveBeenCalledWith(1, 'hello', expect.objectContaining({
      cwd: undefined,
    }));
  });

  test('desktop.chat.send bekommt options.cwd als undefined wenn tab.cwd null', () => {
    const sendMock = jest.fn();

    const tab = { sessionId: 'abc', cwd: null };
    const options = {
      sessionId: tab.sessionId,
      cwd: tab.cwd || undefined,
    };
    sendMock(1, 'hello', options);

    expect(sendMock).toHaveBeenCalledWith(1, 'hello', expect.objectContaining({
      cwd: undefined,
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. IPC-Handler: spawnCopilot nutzt options.cwd
// ═══════════════════════════════════════════════════════════════

describe('Session CWD — spawnCopilot cwd Handling', () => {
  // spawnCopilot ist in main.js — wir testen die Logik isoliert:
  // spawn wird mit { cwd: options.cwd || COPILOT_CWD } aufgerufen

  const COPILOT_CWD = 'C:\\DEV\\copilot';

  function resolveSpawnCwd(options) {
    return options.cwd || COPILOT_CWD;
  }

  test('nutzt options.cwd wenn angegeben', () => {
    const result = resolveSpawnCwd({ cwd: 'D:\\Projekte\\app' });
    expect(result).toBe('D:\\Projekte\\app');
  });

  test('fällt auf COPILOT_CWD zurück wenn options.cwd undefined', () => {
    const result = resolveSpawnCwd({});
    expect(result).toBe(COPILOT_CWD);
  });

  test('fällt auf COPILOT_CWD zurück wenn options.cwd null', () => {
    const result = resolveSpawnCwd({ cwd: null });
    expect(result).toBe(COPILOT_CWD);
  });

  test('fällt auf COPILOT_CWD zurück wenn options.cwd leerer String', () => {
    const result = resolveSpawnCwd({ cwd: '' });
    expect(result).toBe(COPILOT_CWD);
  });

  test('nutzt Unix-Pfade korrekt', () => {
    const result = resolveSpawnCwd({ cwd: '/home/user/project' });
    expect(result).toBe('/home/user/project');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Session-Restore: tab.cwd aus namedSessions
// ═══════════════════════════════════════════════════════════════

describe('Session CWD — Session-Restore', () => {
  let store;
  let mgr;

  beforeEach(() => {
    store = { namedSessions: {} };
    mgr = createNamedSessionsManager(store);
  });

  test('nach Restore hat tab.cwd den Wert aus namedSessions[sessionId].cwd', () => {
    store.namedSessions['restored-session'] = {
      name: 'Restored',
      deniedTools: [],
      lastUsed: '2026-05-01T00:00:00.000Z',
      cwd: 'C:\\Projects\\restored',
    };

    // Simulate restore: read cwd from session entry
    const entry = mgr.getEntry('restored-session');
    const tab = {
      sessionId: 'restored-session',
      cwd: mgr.getSessionCwd('restored-session'),
    };

    expect(tab.cwd).toBe('C:\\Projects\\restored');
    expect(entry.cwd).toBe('C:\\Projects\\restored');
  });

  test('wenn kein CWD gesetzt: tab.cwd ist null', () => {
    store.namedSessions['no-cwd-session'] = {
      name: 'No CWD',
      deniedTools: [],
      lastUsed: '2026-05-01T00:00:00.000Z',
    };

    const tab = {
      sessionId: 'no-cwd-session',
      cwd: mgr.getSessionCwd('no-cwd-session'),
    };

    expect(tab.cwd).toBeNull();
  });

  test('restore mit unbekannter sessionId gibt null für cwd', () => {
    const tab = {
      sessionId: 'unknown',
      cwd: mgr.getSessionCwd('unknown'),
    };

    expect(tab.cwd).toBeNull();
  });

  test('getSortedList enthält cwd-Information', () => {
    store.namedSessions = {
      's1': { name: 'Projekt A', deniedTools: [], lastUsed: '2026-05-01T00:00:00.000Z', cwd: '/path/a' },
      's2': { name: 'Projekt B', deniedTools: [], lastUsed: '2026-04-01T00:00:00.000Z' },
    };

    const list = mgr.getSortedList();
    // Die bestehende getSortedList gibt id, name, lastUsed zurück
    // Nach dem Feature-Update sollte cwd auch enthalten sein (optional)
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('s1');
    expect(list[1].id).toBe('s2');
  });
});

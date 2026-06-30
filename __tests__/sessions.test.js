/**
 * Tests für src/sessions.js — Session-bezogene Dateisystemfunktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { readCheckpoints, readPlan, readAllMessages } = require('../src/sessions');

const SESSION_DIR = path.join('C:', 'test', 'sessions', 'abc-123');

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
});

// ── readCheckpoints ──────────────────────────────────────────

describe('readCheckpoints', () => {
  const indexPath = path.join(SESSION_DIR, 'checkpoints', 'index.md');

  test('gibt leeres Array zurück wenn index.md nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readCheckpoints(SESSION_DIR)).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith(indexPath);
  });

  test('parst gültige Checkpoint-Tabellenzeilen korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      '| Nr | Titel | Datei |\n' +
      '|----|-------|-------|\n' +
      '| 1 | Erster Checkpoint | cp-001.md |\n' +
      '| 2 | Zweiter Checkpoint | cp-002.md |\n'
    );
    const result = readCheckpoints(SESSION_DIR);
    expect(result).toEqual([
      { number: 1, title: 'Erster Checkpoint', file: 'cp-001.md' },
      { number: 2, title: 'Zweiter Checkpoint', file: 'cp-002.md' },
    ]);
  });

  test('ignoriert Header- und Trennzeilen', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      '| Nr | Titel | Datei |\n' +
      '|----|-------|-------|\n' +
      '| 1 | Test | file.md |\n'
    );
    const result = readCheckpoints(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  test('gibt leeres Array bei Lesefehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readCheckpoints(SESSION_DIR);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('verarbeitet gemischte gültige und ungültige Zeilen', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'Irgendein Text am Anfang\n' +
      '| 1 | Gültig | file1.md |\n' +
      'Ungültige Zeile ohne Pipe\n' +
      '| abc | Keine Nummer | file2.md |\n' +
      '| 3 | Auch gültig | file3.md |\n' +
      '\n'
    );
    const result = readCheckpoints(SESSION_DIR);
    expect(result).toEqual([
      { number: 1, title: 'Gültig', file: 'file1.md' },
      { number: 3, title: 'Auch gültig', file: 'file3.md' },
    ]);
  });

  test('gibt leeres Array bei leerer Datei zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('');
    expect(readCheckpoints(SESSION_DIR)).toEqual([]);
  });
});

// ── readPlan ─────────────────────────────────────────────────

describe('readPlan', () => {
  const planPath = path.join(SESSION_DIR, 'plan.md');

  test('gibt null zurück wenn plan.md nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readPlan(SESSION_DIR)).toBeNull();
    expect(fs.existsSync).toHaveBeenCalledWith(planPath);
  });

  test('gibt Dateiinhalt zurück wenn plan.md existiert', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('# Mein Plan\n\n- Schritt 1\n- Schritt 2');
    expect(readPlan(SESSION_DIR)).toBe('# Mein Plan\n\n- Schritt 1\n- Schritt 2');
  });

  test('gibt Inhalt als String zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Einfacher Text');
    const result = readPlan(SESSION_DIR);
    expect(typeof result).toBe('string');
  });
});

// Todos sind nicht mehr Teil von sessions.js (projekt-/cwd-gebunden in src/todos.js).

// ── readAllMessages ──────────────────────────────────────────
describe('readAllMessages', () => {
  const eventsPath = path.join(SESSION_DIR, 'events.jsonl');

  test('gibt leeres Array zurück wenn events.jsonl fehlt', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readAllMessages(SESSION_DIR)).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith(eventsPath);
  });

  test('liest ALLE user/assistant-Nachrichten chronologisch', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue([
      JSON.stringify({ type: 'session.start', data: {} }),
      JSON.stringify({ type: 'user.message', data: { content: 'Hallo' }, timestamp: 't1' }),
      JSON.stringify({ type: 'assistant.message', data: { content: [{ type: 'text', text: 'Hi!' }] }, timestamp: 't2' }),
      JSON.stringify({ type: 'tool.execution_start', data: {} }),
      JSON.stringify({ type: 'user.message', data: { content: 'Wie gehts?' }, timestamp: 't3' }),
      '',
    ].join('\n'));
    expect(readAllMessages(SESSION_DIR)).toEqual([
      { role: 'user', content: 'Hallo', timestamp: 't1' },
      { role: 'assistant', content: 'Hi!', timestamp: 't2' },
      { role: 'user', content: 'Wie gehts?', timestamp: 't3' },
    ]);
  });

  test('begrenzt auf die jüngsten `limit` Nachrichten', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue([
      JSON.stringify({ type: 'user.message', data: { content: 'a' } }),
      JSON.stringify({ type: 'user.message', data: { content: 'b' } }),
      JSON.stringify({ type: 'user.message', data: { content: 'c' } }),
    ].join('\n'));
    const out = readAllMessages(SESSION_DIR, 2);
    expect(out.map(m => m.content)).toEqual(['b', 'c']);
  });

  test('überspringt fehlerhafte Zeilen', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('kein json\n' + JSON.stringify({ type: 'user.message', data: { content: 'ok' } }));
    expect(readAllMessages(SESSION_DIR)).toEqual([{ role: 'user', content: 'ok', timestamp: '' }]);
  });
});

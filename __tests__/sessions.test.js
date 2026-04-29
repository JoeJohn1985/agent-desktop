/**
 * Tests für src/sessions.js — Session-bezogene Dateisystemfunktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { readCheckpoints, readPlan, readConfig, readTodos, writeTodos } = require('../src/sessions');

const SESSION_DIR = path.join('C:', 'test', 'sessions', 'abc-123');
const COPILOT_DIR = path.join('C:', 'test', '.copilot');

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

// ── readConfig ───────────────────────────────────────────────

describe('readConfig', () => {
  const cfgPath = path.join(COPILOT_DIR, 'config.json');

  test('gibt leeres Objekt zurück wenn config.json nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readConfig(COPILOT_DIR)).toEqual({});
    expect(fs.existsSync).toHaveBeenCalledWith(cfgPath);
  });

  test('parst gültiges JSON korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"theme":"dark","lang":"de"}');
    expect(readConfig(COPILOT_DIR)).toEqual({ theme: 'dark', lang: 'de' });
  });

  test('gibt leeres Objekt bei JSON-Parse-Fehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{ ungültiges json !!!');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readConfig(COPILOT_DIR)).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('gibt leeres Objekt bei Lesefehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readConfig(COPILOT_DIR)).toEqual({});
    warnSpy.mockRestore();
  });
});

// ── readTodos ────────────────────────────────────────────────

describe('readTodos', () => {
  const todosPath = path.join(SESSION_DIR, 'todos.json');

  test('gibt leeres Array zurück wenn todos.json nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readTodos(SESSION_DIR)).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith(todosPath);
  });

  test('parst gültiges JSON-Array korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    const todos = [
      { id: '1', text: 'Aufgabe A', status: 'open' },
      { id: '2', text: 'Aufgabe B', status: 'done' },
    ];
    fs.readFileSync.mockReturnValue(JSON.stringify(todos));
    expect(readTodos(SESSION_DIR)).toEqual(todos);
  });

  test('gibt leeres Array bei JSON-Parse-Fehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('nicht json');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readTodos(SESSION_DIR)).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('behandelt leeres Array korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('[]');
    expect(readTodos(SESSION_DIR)).toEqual([]);
  });

  test('gibt leeres Array bei Lesefehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('EPERM'); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readTodos(SESSION_DIR)).toEqual([]);
    warnSpy.mockRestore();
  });
});

// ── writeTodos ───────────────────────────────────────────────

describe('writeTodos', () => {
  test('schreibt JSON-Datei mit korrekter Formatierung', () => {
    fs.existsSync.mockReturnValue(true);
    const todos = [{ id: '1', text: 'Test', status: 'open' }];
    writeTodos(SESSION_DIR, todos);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(SESSION_DIR, 'todos.json'),
      JSON.stringify(todos, null, 2),
      'utf-8'
    );
  });

  test('tut nichts wenn Session-Verzeichnis nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    writeTodos(SESSION_DIR, [{ id: '1' }]);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('schreibt mit 2-Leerzeichen-Einrückung', () => {
    fs.existsSync.mockReturnValue(true);
    const todos = [{ a: 1 }];
    writeTodos(SESSION_DIR, todos);
    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).toBe('[\n  {\n    "a": 1\n  }\n]');
  });

  test('schreibt leeres Array korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    writeTodos(SESSION_DIR, []);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(SESSION_DIR, 'todos.json'),
      '[]',
      'utf-8'
    );
  });
});

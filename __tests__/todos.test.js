'use strict';

// Tests for project-scoped (cwd-based) todos stored as Markdown.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseTodosMarkdown,
  serializeTodosMarkdown,
  todoFilePath,
  readTodos,
  writeTodos,
} = require('../src/todos');

describe('todos: parseTodosMarkdown', () => {
  it('parst offene und erledigte Einträge mit IDs', () => {
    const md = [
      '# Todos',
      '',
      '- [ ] Erste Aufgabe <!-- id:abc -->',
      '- [x] Zweite Aufgabe <!-- id:def -->',
    ].join('\n');
    expect(parseTodosMarkdown(md)).toEqual([
      { id: 'abc', text: 'Erste Aufgabe', status: 'open' },
      { id: 'def', text: 'Zweite Aufgabe', status: 'done' },
    ]);
  });

  it('akzeptiert großes [X] als erledigt', () => {
    expect(parseTodosMarkdown('- [X] Fertig <!-- id:1 -->')[0].status).toBe('done');
  });

  it('generiert IDs für Einträge ohne id-Kommentar', () => {
    const todos = parseTodosMarkdown('- [ ] Ohne ID');
    expect(todos).toHaveLength(1);
    expect(todos[0].text).toBe('Ohne ID');
    expect(typeof todos[0].id).toBe('string');
    expect(todos[0].id.length).toBeGreaterThan(0);
  });

  it('ignoriert Nicht-Checklisten-Zeilen und leeren Text', () => {
    const md = '# Todos\n\nNur Prosa\n- [ ]   \n- [ ] Echte Aufgabe';
    const todos = parseTodosMarkdown(md);
    expect(todos.map(t => t.text)).toEqual(['Echte Aufgabe']);
  });

  it('leer bei leerer Eingabe', () => {
    expect(parseTodosMarkdown('')).toEqual([]);
  });
});

describe('todos: serializeTodosMarkdown', () => {
  it('schreibt eine gültige Checkliste mit ID-Kommentaren', () => {
    const out = serializeTodosMarkdown([
      { id: 'abc', text: 'A', status: 'open' },
      { id: 'def', text: 'B', status: 'done' },
    ]);
    expect(out).toContain('# Todos');
    expect(out).toContain('- [ ] A <!-- id:abc -->');
    expect(out).toContain('- [x] B <!-- id:def -->');
  });

  it('ist ein verlustfreier Round-Trip', () => {
    const todos = [
      { id: 'x1', text: 'Erste', status: 'open' },
      { id: 'x2', text: 'Zweite mit Leerzeichen', status: 'done' },
    ];
    expect(parseTodosMarkdown(serializeTodosMarkdown(todos))).toEqual(todos);
  });
});

describe('todos: todoFilePath', () => {
  it('liegt unter <cwd>/todo/todos.md', () => {
    expect(todoFilePath('/projekt')).toBe(path.join('/projekt', 'todo', 'todos.md'));
  });
});

describe('todos: read/write (echtes tmp-Verzeichnis)', () => {
  let cwd;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'todos-')); });

  it('readTodos gibt [] zurück ohne Datei', () => {
    expect(readTodos(cwd)).toEqual([]);
  });

  it('writeTodos legt todo/ an und readTodos liest zurück', () => {
    const todos = [{ id: 'a', text: 'Aufgabe', status: 'open' }];
    writeTodos(cwd, todos);
    expect(fs.existsSync(path.join(cwd, 'todo', 'todos.md'))).toBe(true);
    expect(readTodos(cwd)).toEqual(todos);
  });

  it('readTodos/writeTodos ohne cwd sind no-ops', () => {
    expect(readTodos(null)).toEqual([]);
    expect(() => writeTodos(null, [{ id: 'a', text: 'x', status: 'open' }])).not.toThrow();
  });
});

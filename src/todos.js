'use strict';

// Project-scoped todos. Todos belong to a *project* (the working directory),
// not to a single chat session — so they survive when a session is deleted and
// are shared across all tabs/sessions pointing at the same cwd.
//
// They are persisted as a human-readable Markdown checklist under
//   <cwd>/todo/todos.md
// A stable id is embedded per line as an HTML comment (`<!-- id:… -->`) so the
// list round-trips losslessly (toggle/reorder/delete by id) while still
// rendering as a normal GitHub-style checklist.

const fs = require('fs');
const path = require('path');

const TODO_DIRNAME = 'todo';
const TODO_FILENAME = 'todos.md';
const TODO_HEADING = '# Todos';

/** Absolute path to a cwd's todo markdown file. */
function todoFilePath(cwd) {
  return path.join(cwd, TODO_DIRNAME, TODO_FILENAME);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Parse a todos.md checklist into structured todos.
 * @param {string} md
 * @returns {Array<{id:string, text:string, status:'open'|'done'}>}
 */
function parseTodosMarkdown(md) {
  if (!md) return [];
  const todos = [];
  const seen = new Set();
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s*(.*?)\s*(?:<!--\s*id:(\S+)\s*-->)?\s*$/);
    if (!m) continue;
    const status = m[1].toLowerCase() === 'x' ? 'done' : 'open';
    const text = m[2].trim();
    if (!text) continue;
    let id = m[3];
    if (!id || seen.has(id)) id = generateId();
    seen.add(id);
    todos.push({ id, text, status });
  }
  return todos;
}

/**
 * Serialize todos to a Markdown checklist (with embedded ids).
 * @param {Array<{id:string, text:string, status:string}>} todos
 * @returns {string}
 */
function serializeTodosMarkdown(todos) {
  const lines = [TODO_HEADING, ''];
  for (const t of todos || []) {
    const box = t.status === 'done' ? '[x]' : '[ ]';
    const id = t.id || generateId();
    lines.push(`- ${box} ${t.text} <!-- id:${id} -->`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Read the project's todos for a cwd. Returns [] if cwd is falsy or no file.
 * @param {string} cwd
 * @returns {Array<{id:string, text:string, status:'open'|'done'}>}
 */
function readTodos(cwd) {
  if (!cwd) return [];
  const file = todoFilePath(cwd);
  if (!fs.existsSync(file)) return [];
  try {
    return parseTodosMarkdown(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.warn('[todos:read] Fehler:', e.message || e);
    return [];
  }
}

/**
 * Write the project's todos for a cwd, creating the todo/ folder as needed.
 * @param {string} cwd
 * @param {Array} todos
 */
function writeTodos(cwd, todos) {
  if (!cwd) return;
  try {
    fs.mkdirSync(path.join(cwd, TODO_DIRNAME), { recursive: true });
    fs.writeFileSync(todoFilePath(cwd), serializeTodosMarkdown(todos), 'utf-8');
  } catch (e) {
    console.warn('[todos:write] Fehler:', e.message || e);
  }
}

module.exports = {
  todoFilePath,
  parseTodosMarkdown,
  serializeTodosMarkdown,
  readTodos,
  writeTodos,
  generateId,
  TODO_DIRNAME,
  TODO_FILENAME,
};

'use strict';

/**
 * Named Sessions logic — pure functions extracted from renderer/app.js for testability.
 * These operate on a plain object store (simulating getPref/setPref).
 */

/**
 * Check if a string looks like a valid session ID (UUID or long alphanum).
 */
function isSessionIdLike(str) {
  if (!str || typeof str !== 'string') return false;
  return str.length >= 8 && /^[a-z0-9_-]+$/i.test(str);
}

/**
 * Strip shell() wrapper for display: "shell(git push)" → "git push"
 */
function stripShellWrapper(name) {
  if (!name || typeof name !== 'string') return name || '';
  const m = name.match(/^shell\((.+)\)$/);
  return m ? m[1] : name;
}

/**
 * Wrap a command in shell() if not already wrapped.
 */
function wrapShell(cmd) {
  if (!cmd || typeof cmd !== 'string') return '';
  const trimmed = cmd.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('shell(') && trimmed.endsWith(')')) return trimmed;
  return `shell(${trimmed})`;
}

/**
 * Named sessions CRUD operations on a plain object store.
 */
function createNamedSessionsManager(store) {
  function getAll() {
    return store.namedSessions || {};
  }

  function getName(sessionId) {
    const entry = getAll()[sessionId];
    return entry?.name || null;
  }

  function getEntry(sessionId) {
    return getAll()[sessionId] || null;
  }

  function setName(sessionId, name) {
    if (!store.namedSessions) store.namedSessions = {};
    if (!store.namedSessions[sessionId]) {
      store.namedSessions[sessionId] = { name, deniedTools: [], lastUsed: new Date().toISOString() };
    } else {
      store.namedSessions[sessionId].name = name;
    }
  }

  function remove(sessionId) {
    if (!store.namedSessions) return;
    delete store.namedSessions[sessionId];
  }

  function touch(sessionId) {
    if (!store.namedSessions || !store.namedSessions[sessionId]) return;
    store.namedSessions[sessionId].lastUsed = new Date().toISOString();
  }

  function getDeniedTools(sessionId) {
    const entry = getAll()[sessionId];
    return entry?.deniedTools || [];
  }

  function saveDeniedTools(sessionId, tools) {
    if (!store.namedSessions || !store.namedSessions[sessionId]) return;
    store.namedSessions[sessionId].deniedTools = tools;
  }

  function getSortedList() {
    const all = getAll();
    return Object.entries(all)
      .map(([id, entry]) => ({ id, name: entry.name, lastUsed: entry.lastUsed || '' }))
      .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }

  return { getAll, getName, getEntry, setName, remove, touch, getDeniedTools, saveDeniedTools, getSortedList };
}

module.exports = {
  isSessionIdLike,
  stripShellWrapper,
  wrapShell,
  createNamedSessionsManager,
};

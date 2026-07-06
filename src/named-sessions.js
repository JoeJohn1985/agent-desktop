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

  /**
   * Save the working directory for a named session.
   * Does nothing if the session does not exist (unbenannte Session).
   * @param {string} sessionId - Session identifier.
   * @param {string} cwd - Working directory path.
   */
  function saveSessionCwd(sessionId, cwd) {
    if (!store.namedSessions || !store.namedSessions[sessionId]) return;
    store.namedSessions[sessionId].cwd = cwd;
  }

  /**
   * Get the persisted CWD for a session.
   * @param {string} sessionId - Session identifier.
   * @returns {string|null} The stored cwd or null if not set/unknown.
   */
  function getSessionCwd(sessionId) {
    const entry = (store.namedSessions || {})[sessionId];
    if (!entry) return null;
    return entry.cwd ?? null;
  }

  /**
   * Save the provider (ProviderID) for a named session so it can be resumed with
   * the right backend (Copilot vs Claude Code — they share model ids).
   * @param {string} sessionId
   * @param {string} provider
   */
  function saveSessionProvider(sessionId, provider) {
    if (!store.namedSessions || !store.namedSessions[sessionId]) return;
    store.namedSessions[sessionId].provider = provider;
  }

  /** Get the persisted provider for a session (null if unknown → treat as copilot). */
  function getSessionProvider(sessionId) {
    const entry = (store.namedSessions || {})[sessionId];
    return (entry && entry.provider) || null;
  }

  function getSortedList() {
    const all = getAll();
    return Object.entries(all)
      .map(([id, entry]) => ({ id, name: entry.name, lastUsed: entry.lastUsed || '', provider: entry.provider || 'copilot' }))
      .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }

  return { getAll, getName, getEntry, setName, remove, touch, getDeniedTools, saveDeniedTools, saveSessionCwd, getSessionCwd, saveSessionProvider, getSessionProvider, getSortedList };
}

module.exports = {
  isSessionIdLike,
  stripShellWrapper,
  wrapShell,
  createNamedSessionsManager,
};

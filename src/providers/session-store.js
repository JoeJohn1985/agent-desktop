'use strict';

// Persists direct-API conversation history per session so a tab can resume
// with full context after a restart. One JSON file per session, stored
// alongside the app's other config under ~/.agent-desktop/api-sessions/
// (see apiSessionsDir/migrateApiSessions in ../data-dir.js for the one-shot
// migration from the pre-rename ~/.copilot-desktop/api-sessions/ location).

const fs = require('fs');
const path = require('path');
const { apiSessionsDir } = require('../data-dir');

let _dir = null;

function dir() {
  if (_dir) return _dir;
  _dir = apiSessionsDir();
  try { fs.mkdirSync(_dir, { recursive: true }); } catch (_) { /* ignore */ }
  return _dir;
}

function fileFor(sessionId) {
  // sessionIds are 'api-<uuid>' — safe as a filename, but sanitize defensively.
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir(), `${safe}.json`);
}

/**
 * @param {string} sessionId
 * @param {Object} data - { messages, tokens, lastContextTokens, model }
 */
function save(sessionId, data) {
  try {
    fs.writeFileSync(fileFor(sessionId), JSON.stringify(data), { mode: 0o600 });
  } catch (e) {
    console.warn('[session-store] save failed:', e?.message);
  }
}

/**
 * @param {string} sessionId
 * @returns {Object|null}
 */
function load(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(sessionId), 'utf-8'));
  } catch (_) {
    return null;
  }
}

function remove(sessionId) {
  try { fs.unlinkSync(fileFor(sessionId)); } catch (_) { /* ignore */ }
}

module.exports = { save, load, remove };

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Preferences module — handles reading/writing with backup and defaults.
 * Extracted from main.js for testability.
 */

const PREFS_DEFAULTS = {
  theme: 'dark',
  settings: { allowAllPaths: false },
  deniedTools: [],
  adminDeniedTools: [],
  namedSessions: {},
  openTabs: [],
};

function createPreferencesManager(prefsPath) {
  const bakPath = prefsPath + '.bak';

  function ensureDir() {
    try {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    } catch (_e) { /* best effort */ }
  }

  function read() {
    if (!fs.existsSync(prefsPath)) return { ...PREFS_DEFAULTS };
    try {
      const raw = fs.readFileSync(prefsPath, 'utf-8').trim();
      if (!raw || raw === '{}') return { ...PREFS_DEFAULTS };
      const prefs = JSON.parse(raw);
      // Ensure critical defaults exist
      for (const [key, val] of Object.entries(PREFS_DEFAULTS)) {
        if (prefs[key] === undefined) prefs[key] = val;
      }
      return prefs;
    } catch (_e) {
      // Try to restore from backup
      if (fs.existsSync(bakPath)) {
        try {
          const bak = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
          ensureDir();
          fs.writeFileSync(prefsPath, JSON.stringify(bak, null, 2), 'utf-8');
          return bak;
        } catch (_e2) { /* backup also corrupt */ }
      }
      return { ...PREFS_DEFAULTS };
    }
  }

  function write(prefs) {
    try {
      ensureDir();
      // Create backup of current file before overwriting
      if (fs.existsSync(prefsPath)) {
        try { fs.copyFileSync(prefsPath, bakPath); } catch (_e) {}
      }
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
      return true;
    } catch (e) {
      // Surface the error so callers (main.js) can log it instead of
      // silently losing user state.
      const err = new Error(`preferences write failed: ${e.message || e}`);
      err.cause = e;
      err.prefsPath = prefsPath;
      throw err;
    }
  }

  /**
   * One-shot migration: if an old preferences file exists at `oldPath`
   * and no file exists at `prefsPath`, copy it over (and its .bak if
   * present). Used when moving from `__dirname/preferences.json`
   * (broken in packaged builds) to `app.getPath('userData')`.
   *
   * Returns true if a migration happened.
   */
  function migrateFromIfExists(oldPath) {
    if (!oldPath || oldPath === prefsPath) return false;
    if (fs.existsSync(prefsPath)) return false;
    if (!fs.existsSync(oldPath)) return false;
    try {
      ensureDir();
      fs.copyFileSync(oldPath, prefsPath);
      const oldBak = oldPath + '.bak';
      if (fs.existsSync(oldBak)) {
        try { fs.copyFileSync(oldBak, bakPath); } catch (_e) {}
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  return { read, write, migrateFromIfExists, prefsPath };
}

module.exports = { createPreferencesManager, PREFS_DEFAULTS };

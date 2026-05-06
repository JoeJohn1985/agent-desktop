'use strict';

const fs = require('fs');

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
          fs.writeFileSync(prefsPath, JSON.stringify(bak, null, 2), 'utf-8');
          return bak;
        } catch (_e2) { /* backup also corrupt */ }
      }
      return { ...PREFS_DEFAULTS };
    }
  }

  function write(prefs) {
    try {
      // Create backup of current file before overwriting
      if (fs.existsSync(prefsPath)) {
        try { fs.copyFileSync(prefsPath, bakPath); } catch (_e) {}
      }
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
      return true;
    } catch (_e) {
      return false;
    }
  }

  return { read, write };
}

module.exports = { createPreferencesManager, PREFS_DEFAULTS };

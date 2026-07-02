'use strict';

// Application data directory + one-shot migration from the old "copilot-desktop"
// identity to "agent-desktop". Two roots move:
//   1. Home data dir:  ~/.copilot-desktop  →  ~/.agent-desktop
//      (folders.json, logs/, deleted-todos/, pricing-cache.json)
//   2. Electron userData: <appData>/copilot-desktop → <appData>/agent-desktop
//      (preferences.json, provider-keys.enc, session state)
//
// Windows-focused: on Windows `safeStorage` uses DPAPI bound to the OS user (not
// the app name), so the copied provider-keys.enc stays decryptable across the
// rename. (macOS/Linux keychain semantics differ and are out of scope.)

const os = require('os');
const path = require('path');
const fs = require('fs');

const APP_DIR = '.agent-desktop';
const LEGACY_APP_DIR = '.copilot-desktop';
const DATA_DIR = path.join(os.homedir(), APP_DIR);
const LEGACY_DATA_DIR = path.join(os.homedir(), LEGACY_APP_DIR);

/** Recursively copy src→dest without overwriting existing files. Never throws. */
function copyMerge(src, dest, fsImpl) {
  try {
    if (!fsImpl.existsSync(src)) return false;
    fsImpl.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * One-shot, idempotent migration of legacy app data into the new location.
 * Gated on representative files (folders.json / preferences.json) so repeat runs
 * are cheap no-ops. Never throws.
 *
 * @param {Object} [opts]
 * @param {string} [opts.dataDir=DATA_DIR] - Target home data dir.
 * @param {string} [opts.legacyDataDir=LEGACY_DATA_DIR] - Source home data dir.
 * @param {string} [opts.userDataDir] - Target Electron userData dir.
 * @param {string} [opts.legacyUserDataDir] - Source (old-name) userData dir.
 * @param {typeof fs} [fsImpl=fs]
 * @returns {boolean} Whether anything was copied.
 */
function migrateLegacyData(opts = {}, fsImpl = fs) {
  const dataDir = opts.dataDir || DATA_DIR;
  const legacyDataDir = opts.legacyDataDir || LEGACY_DATA_DIR;
  const { userDataDir, legacyUserDataDir } = opts;
  let moved = false;

  // 1. Home data dir — only if the new one isn't already populated.
  if (dataDir !== legacyDataDir
      && !fsImpl.existsSync(path.join(dataDir, 'folders.json'))
      && fsImpl.existsSync(path.join(legacyDataDir, 'folders.json'))) {
    if (copyMerge(legacyDataDir, dataDir, fsImpl)) moved = true;
  }

  // 2. Electron userData — only if the new one has no preferences yet.
  if (userDataDir && legacyUserDataDir && userDataDir !== legacyUserDataDir
      && !fsImpl.existsSync(path.join(userDataDir, 'preferences.json'))
      && fsImpl.existsSync(path.join(legacyUserDataDir, 'preferences.json'))) {
    if (copyMerge(legacyUserDataDir, userDataDir, fsImpl)) moved = true;
  }

  return moved;
}

module.exports = { DATA_DIR, LEGACY_DATA_DIR, APP_DIR, migrateLegacyData, copyMerge };

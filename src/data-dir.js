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

/**
 * Absolute path to Claude Code's own native, user-level skills folder. Claude
 * Code discovers SKILL.md files here itself (confirmed empirically: a skill
 * placed here is recognized from any cwd, no app-side injection needed) — the
 * same file format (SKILL.md, `name`/`description` frontmatter) our own
 * scanner reads for every other provider. Injecting our own index here too
 * would just load the same skills twice.
 * @returns {string}
 */
function claudeCodeNativeSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

// Provider-scoped config (skills, …) lives under the same home-dir data
// folder as everything else, one subfolder per provider — analogous to
// Copilot's own ~/.copilot/skills: ~/.agent-desktop/<provider>/skills/<name>/SKILL.md
/**
 * Absolute path to a provider's skills directory. Claude Code is special-cased
 * to its own native ~/.claude/skills (see claudeCodeNativeSkillsDir) instead of
 * an app-managed folder — everyone else gets ~/.agent-desktop/<provider>/skills.
 * @param {string} provider - Provider id, e.g. 'claude-code', 'anthropic'.
 * @returns {string}
 */
function providerSkillsDir(provider) {
  if (provider === 'claude-code') return claudeCodeNativeSkillsDir();
  return path.join(DATA_DIR, provider, 'skills');
}

/**
 * Absolute path to a provider's agents directory, under ~/.agent-desktop.
 * @param {string} provider - Provider id, e.g. 'claude-code', 'anthropic'.
 * @returns {string}
 */
function providerAgentsDir(provider) {
  return path.join(DATA_DIR, provider, 'agents');
}

/**
 * Absolute path to a provider's instructions directory, under ~/.agent-desktop.
 * Only used for direct-API providers (Claude Code/Copilot have their own
 * native CLAUDE.md/copilot-instructions.md discovery).
 * @param {string} provider - Provider id, e.g. 'anthropic', 'openai'.
 * @returns {string}
 */
function providerInstructionsDir(provider) {
  return path.join(DATA_DIR, provider, 'instructions');
}

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

/**
 * One-shot, idempotent migration of any skills the user already placed in the
 * old app-managed Claude Code skills folder (~/.agent-desktop/claude-code/skills)
 * into Claude Code's own native ~/.claude/skills, so nothing already set up
 * silently stops working once we stop injecting our own index for Claude Code.
 * Merge-only (copyMerge never overwrites), so it's safe to call on every startup.
 * @param {typeof fs} [fsImpl=fs]
 * @returns {boolean} Whether anything was copied.
 */
function migrateClaudeCodeSkills(fsImpl = fs) {
  const legacyClaudeCodeSkillsDir = path.join(DATA_DIR, 'claude-code', 'skills');
  return copyMerge(legacyClaudeCodeSkillsDir, claudeCodeNativeSkillsDir(), fsImpl);
}

/**
 * Absolute path to the persisted direct-API session history store
 * (one JSON file per session — see `providers/session-store.js`).
 * @returns {string}
 */
function apiSessionsDir() {
  return path.join(DATA_DIR, 'api-sessions');
}

/**
 * One-shot, idempotent migration of direct-API session history saved before
 * the app-identity rename — session-store.js used to hardcode the old
 * ~/.copilot-desktop/api-sessions path instead of ~/.agent-desktop/api-sessions
 * (a leftover the rest of the rename missed). Merge-only, safe on every startup.
 * @param {typeof fs} [fsImpl=fs]
 * @returns {boolean} Whether anything was copied.
 */
function migrateApiSessions(fsImpl = fs) {
  const legacyApiSessionsDir = path.join(LEGACY_DATA_DIR, 'api-sessions');
  return copyMerge(legacyApiSessionsDir, apiSessionsDir(), fsImpl);
}

module.exports = {
  DATA_DIR, LEGACY_DATA_DIR, APP_DIR, migrateLegacyData, copyMerge,
  providerSkillsDir, providerAgentsDir, providerInstructionsDir,
  claudeCodeNativeSkillsDir, migrateClaudeCodeSkills,
  apiSessionsDir, migrateApiSessions,
};

'use strict';

// Turns a validated (provider, cwd) target into skill/agent lists and
// resolved paths. This used to live entirely inline inside three
// ipcMain.handle() bodies in main.js, which meant the only test coverage was
// a regex checking that certain strings appeared in main.js's source — not a
// real check that the logic behaves correctly. Pulling it out here makes it
// directly unit-testable via dependency injection, the same pattern already
// used in scanners.js/agents.js (yamlParse passed in rather than required).

const path = require('path');

/** Every provider id the renderer may ask about. Anything else is rejected
 *  before it reaches a path join — see the validation note below. */
const ALL_PROVIDERS = ['copilot', 'claude-code', 'anthropic', 'openai', 'gemini', 'glm', 'ollama'];

/**
 * Validates an IPC-supplied (provider, cwd) pair. `provider` ends up in a
 * filesystem path, so it must come from the fixed allow-list rather than be
 * trusted; `cwd` is only ever used as a base for path.join and is required to
 * be absolute so a relative value can't resolve against the process cwd.
 * @param {string} provider
 * @param {*} cwd
 * @returns {{provider: string, cwd: string|null}|null} null if invalid.
 */
function validateContextTarget(provider, cwd) {
  if (!ALL_PROVIDERS.includes(provider)) return null;
  const safeCwd = (typeof cwd === 'string' && cwd && path.isAbsolute(cwd)) ? cwd : null;
  return { provider, cwd: safeCwd };
}

/**
 * Merges several already-scanned lists into one, keeping the first
 * occurrence of each key. Scan order therefore doubles as priority order —
 * callers list higher-priority sources (e.g. project-level) first if a later
 * source should never silently shadow an earlier one, or vice versa.
 * @param {Array[]} lists
 * @param {(item: any) => string} keyFn
 * @returns {Array}
 */
function dedupeFirstWins(lists, keyFn) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Builds the full skill list for a validated (provider, cwd) target:
 * Copilot's builtin skills (plus a fresh marketplace mirror) for Copilot,
 * then every global and project directory the provider reads from —
 * deduplicated so a project skill never silently shadows a global one of the
 * same name and vice versa (global scanned first, first-occurrence wins).
 * @param {{provider: string, cwd: string|null}} target
 * @param {Object} deps
 * @param {Function} deps.skillDirs - context-paths.js#skillDirs
 * @param {string} [deps.skillsDirOverride]
 * @param {() => Promise<Array>} deps.scanBuiltinCopilotSkills
 * @param {(opts: {userSkillsDir: string}) => void} deps.syncMarketplaceSkills
 * @param {(dir: string, source: string, iconFn: Function, yamlParse: Function) => Promise<Array>} deps.scanSkillDirectory
 * @param {(name: string) => string} deps.userSkillIcon
 * @param {Function} deps.yamlParse
 * @returns {Promise<Array<Object>>}
 */
async function buildSkillsList(target, deps) {
  const { skillDirs, skillsDirOverride, scanBuiltinCopilotSkills, syncMarketplaceSkills, scanSkillDirectory, userSkillIcon, yamlParse } = deps;
  const dirs = skillDirs(target.provider, target.cwd, { skillsDirOverride });
  const lists = [];

  // Copilot additionally ships builtin skills inside its CLI package, and
  // needs marketplace plugin skills mirrored into its user folder first (see
  // scanBuiltinCopilotSkills / syncMarketplaceSkills for why).
  if (target.provider === 'copilot') {
    lists.push(await scanBuiltinCopilotSkills());
    try { syncMarketplaceSkills({ userSkillsDir: dirs.global[0] }); } catch (_) { /* best effort */ }
  }

  for (const dir of dirs.global) lists.push(await scanSkillDirectory(dir, 'global', userSkillIcon, yamlParse));
  for (const dir of dirs.project) lists.push(await scanSkillDirectory(dir, 'project', userSkillIcon, yamlParse));

  return dedupeFirstWins(lists, s => s.dirName);
}

/**
 * Builds the full agent list for a validated (provider, cwd) target: every
 * global directory, then every project directory, deduplicated by file slug.
 * @param {{provider: string, cwd: string|null}} target
 * @param {Object} deps
 * @param {Function} deps.agentDirs - context-paths.js#agentDirs
 * @param {string} [deps.agentsDirOverride]
 * @param {(dir: string, yamlParse: Function) => Promise<Array>} deps.scanAgentsDirectory
 * @param {Function} deps.yamlParse
 * @returns {Promise<Array<Object>>}
 */
async function buildAgentsList(target, deps) {
  const { agentDirs, agentsDirOverride, scanAgentsDirectory, yamlParse } = deps;
  const dirs = agentDirs(target.provider, target.cwd, { agentsDirOverride });
  const lists = [];

  for (const dir of dirs.global) lists.push((await scanAgentsDirectory(dir, yamlParse)).map(a => ({ ...a, source: 'global' })));
  for (const dir of dirs.project) lists.push((await scanAgentsDirectory(dir, yamlParse)).map(a => ({ ...a, source: 'project' })));

  return dedupeFirstWins(lists, a => a.fileSlug);
}

/**
 * Resolves the skill/agent folders for a validated (provider, cwd) target,
 * without scanning them — used to tell the user where to put a file.
 * @param {{provider: string, cwd: string|null}} target
 * @param {Object} deps
 * @param {Function} deps.skillDirs
 * @param {Function} deps.agentDirs
 * @param {string} [deps.skillsDirOverride]
 * @param {string} [deps.agentsDirOverride]
 * @returns {{skills: {global: string[], project: string[]}, agents: {global: string[], project: string[]}}}
 */
function buildContextPaths(target, deps) {
  const { skillDirs, agentDirs, skillsDirOverride, agentsDirOverride } = deps;
  return {
    skills: skillDirs(target.provider, target.cwd, { skillsDirOverride }),
    agents: agentDirs(target.provider, target.cwd, { agentsDirOverride }),
  };
}

module.exports = {
  ALL_PROVIDERS,
  validateContextTarget,
  dedupeFirstWins,
  buildSkillsList,
  buildAgentsList,
  buildContextPaths,
};

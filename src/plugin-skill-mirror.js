'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Mirrors every skill from installed Copilot marketplace plugins
 * (~/.copilot/installed-plugins/<marketplace>/<plugin>/skills/<name>) into
 * Copilot's own user skills folder (~/.copilot/skills/<name>).
 *
 * Necessary because `copilot --acp` — the mode this app always runs Copilot
 * in — does not expose plugin/marketplace skills to the model, only builtin
 * and user skills, even though the CLI's own interactive/-p modes do
 * (confirmed empirically). Mirroring into ~/.copilot/skills closes that gap
 * using the exact folder the CLI already reads correctly in ACP mode.
 *
 * Tracks which directory names it created in a small manifest file so
 * re-runs can refresh mirrors when a plugin updates and remove mirrors whose
 * source plugin/skill was since uninstalled — without ever touching a
 * same-named skill the user created themselves (only manifest-owned
 * directories are ever overwritten or deleted).
 *
 * @param {Object} [opts]
 * @param {string} [opts.installedPluginsDir] - Defaults to ~/.copilot/installed-plugins
 * @param {string} [opts.userSkillsDir] - Defaults to ~/.copilot/skills
 * @param {string} [opts.manifestPath] - Defaults to ~/.agent-desktop/copilot-plugin-skills-mirror.json
 * @param {typeof fs} [fsImpl=fs]
 * @returns {string[]} Directory names currently mirrored.
 */
function syncMarketplaceSkills(opts = {}, fsImpl = fs) {
  const installedPluginsDir = opts.installedPluginsDir
    || path.join(os.homedir(), '.copilot', 'installed-plugins');
  const userSkillsDir = opts.userSkillsDir
    || path.join(os.homedir(), '.copilot', 'skills');
  const manifestPath = opts.manifestPath
    || path.join(require('./data-dir').DATA_DIR, 'copilot-plugin-skills-mirror.json');

  let previouslyMirrored = [];
  try {
    if (fsImpl.existsSync(manifestPath)) {
      const parsed = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf-8'));
      if (Array.isArray(parsed)) previouslyMirrored = parsed;
    }
  } catch (_) { /* corrupt manifest — treat as empty, will be rewritten below */ }

  const currentPluginSkills = new Map(); // dirName -> absolute source dir
  if (fsImpl.existsSync(installedPluginsDir)) {
    for (const marketplaceDir of fsImpl.readdirSync(installedPluginsDir, { withFileTypes: true })) {
      if (!marketplaceDir.isDirectory()) continue;
      const marketplacePath = path.join(installedPluginsDir, marketplaceDir.name);
      for (const pluginDir of fsImpl.readdirSync(marketplacePath, { withFileTypes: true })) {
        if (!pluginDir.isDirectory()) continue;
        const pluginSkillsDir = path.join(marketplacePath, pluginDir.name, 'skills');
        if (!fsImpl.existsSync(pluginSkillsDir)) continue;
        for (const skillDir of fsImpl.readdirSync(pluginSkillsDir, { withFileTypes: true })) {
          if (!skillDir.isDirectory()) continue;
          currentPluginSkills.set(skillDir.name, path.join(pluginSkillsDir, skillDir.name));
        }
      }
    }
  }

  // Remove mirrors whose source plugin/skill was since uninstalled or renamed.
  for (const dirName of previouslyMirrored) {
    if (!currentPluginSkills.has(dirName)) {
      try {
        fsImpl.rmSync(path.join(userSkillsDir, dirName), { recursive: true, force: true });
      } catch (_) { /* best effort */ }
    }
  }

  // Copy/refresh current plugin skills — only ever touching dirs we own.
  const nowMirrored = [];
  for (const [dirName, sourceDir] of currentPluginSkills) {
    const targetDir = path.join(userSkillsDir, dirName);
    const weOwnIt = previouslyMirrored.includes(dirName);
    if (fsImpl.existsSync(targetDir) && !weOwnIt) {
      console.warn(`[plugin-skill-mirror] "${dirName}" existiert bereits in ~/.copilot/skills (nicht von uns angelegt) — überspringe Marketplace-Spiegelung.`);
      continue;
    }
    try {
      fsImpl.rmSync(targetDir, { recursive: true, force: true });
      fsImpl.cpSync(sourceDir, targetDir, { recursive: true });
      nowMirrored.push(dirName);
    } catch (e) {
      console.warn(`[plugin-skill-mirror] Kopieren von "${dirName}" fehlgeschlagen:`, e.message || e);
    }
  }

  try {
    fsImpl.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fsImpl.writeFileSync(manifestPath, JSON.stringify(nowMirrored, null, 2), 'utf-8');
  } catch (_) { /* best effort */ }

  return nowMirrored;
}

module.exports = { syncMarketplaceSkills };

/**
 * Scanner- und Config-Funktionen (aus main.js extrahiert)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fs = require('fs');
const path = require('path');

// ── scanSkillDirectory ───────────────────────────────────────

function scanSkillDirectory(dir, source, iconFn, yamlParse) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    try {
      const raw = fs.readFileSync(skillMd, 'utf-8').replace(/^\uFEFF/, '');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) {
        const meta = yamlParse(frontmatter[1]);
        results.push({
          id: meta.name || entry.name,
          name: meta.name || entry.name,
          description: meta.description || '',
          source,
          icon: meta.icon || iconFn(meta.name || entry.name),
        });
      }
    } catch (e) {
      console.warn(`[skills:scan:${source}] Fehler:`, e.message || e);
    }
  }
  return results;
}

// ── Folder Config ────────────────────────────────────────────

function readFolderConfig(configPath) {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[folders:readConfig] Fehler:', e.message || e);
  }
  return {};
}

function writeFolderConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

module.exports = {
  scanSkillDirectory,
  readFolderConfig,
  writeFolderConfig,
};

/**
 * Scanner- und Config-Funktionen (aus main.js extrahiert)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fs = require('fs');
const path = require('path');

// ── scanSkillDirectory ───────────────────────────────────────

/**
 * Scannt ein Verzeichnis nach Skill-Ordnern mit SKILL.md und parst deren YAML-Frontmatter.
 *
 * @param {string} dir - Pfad zum Skill-Verzeichnis
 * @param {string} source - Herkunftsbezeichnung (z.B. 'user', 'builtin')
 * @param {(name: string) => string} iconFn - Fallback-Funktion für Icon-Ermittlung
 * @param {(yamlString: string) => Object} yamlParse - YAML-Parser-Funktion
 * @returns {Array<{id: string, dirName: string, name: string, description: string, source: string, icon: string}>}
 */
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
          dirName: entry.name,
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

/**
 * Liest eine JSON-Konfigurationsdatei für Ordner-Einstellungen.
 * Gibt ein leeres Objekt zurück wenn die Datei nicht existiert oder fehlerhaft ist.
 *
 * @param {string} configPath - Absoluter Pfad zur JSON-Konfigurationsdatei
 * @returns {Object} Die geparste Konfiguration oder ein leeres Objekt
 */
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

/**
 * Schreibt eine Konfiguration als JSON-Datei. Erstellt fehlende Verzeichnisse automatisch.
 *
 * @param {string} configPath - Absoluter Pfad zur Zieldatei
 * @param {Object} config - Das zu schreibende Konfigurationsobjekt
 */
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

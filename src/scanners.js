/**
 * Scanner- und Config-Funktionen (aus main.js extrahiert)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// ── scanSkillDirectory ───────────────────────────────────────

/**
 * Scannt ein Verzeichnis nach Skill-Ordnern mit SKILL.md und parst deren YAML-Frontmatter.
 *
 * @param {string} dir - Pfad zum Skill-Verzeichnis
 * @param {string} source - Herkunftsbezeichnung (z.B. 'user', 'builtin')
 * @param {(name: string) => string} iconFn - Fallback-Funktion für Icon-Ermittlung
 * @param {(yamlString: string) => Object} yamlParse - YAML-Parser-Funktion
 * @returns {Promise<Array<{id: string, dirName: string, name: string, description: string, source: string, icon: string}>>}
 */
async function scanSkillDirectory(dir, source, iconFn, yamlParse) {
  let dirEntries;
  try {
    dirEntries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return []; // Verzeichnis fehlt oder ist nicht lesbar — beides kein Fehlerfall.
  }

  // Parallel statt sequentiell: auf einem Netzlaufwerk dominiert die Latenz pro
  // Datei, nicht der Durchsatz.
  const results = await Promise.all(dirEntries.filter(e => e.isDirectory()).map(async (entry) => {
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    try {
      const raw = (await fsp.readFile(skillMd, 'utf-8')).replace(/^\uFEFF/, '');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter) return null;
      const meta = yamlParse(frontmatter[1]);
      return {
        id: meta.name || entry.name,
        dirName: entry.name,
        name: meta.name || entry.name,
        description: meta.description || '',
        source,
        icon: meta.icon || iconFn(meta.name || entry.name),
      };
    } catch (e) {
      // Ordner ohne SKILL.md ist der Normalfall, kein Fehler \u2014 nur echte
      // Lese-/Parse-Probleme melden.
      if (e.code !== 'ENOENT') console.warn(`[skills:scan:${source}] Fehler:`, e.message || e);
      return null;
    }
  }));

  return results.filter(Boolean);
}

/**
 * Scans one or more skill directories and returns a lazy-loadable index
 * (name + description + absolute SKILL.md path), used to expose skills to a
 * model without inlining their full content — the model reads a SKILL.md
 * itself via its file tool only once it judges that skill relevant.
 * Directories are deduplicated by skill dir name, first match wins.
 *
 * @param {string[]} dirs - Skill directories to scan, in priority order.
 * @param {(yamlString: string) => Object} yamlParse - YAML-Parser-Funktion
 * @returns {Promise<Array<{name: string, description: string, file: string}>>}
 */
async function scanSkillsIndex(dirs, yamlParse) {
  const entries = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    for (const s of await scanSkillDirectory(dir, 'user', () => '', yamlParse)) {
      if (seen.has(s.dirName)) continue;
      seen.add(s.dirName);
      entries.push({ name: s.name, description: s.description, file: path.join(dir, s.dirName, 'SKILL.md') });
    }
  }
  return entries;
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
  scanSkillsIndex,
  readFolderConfig,
  writeFolderConfig,
};

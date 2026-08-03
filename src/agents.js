/**
 * Agents Scanner (aus main.js extrahiert für Testbarkeit)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fsp = require('fs/promises');
const path = require('path');

/** Entfernt ein führendes Byte-Order-Mark (U+FEFF), das Editoren gern setzen. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Scannt ein Verzeichnis nach *.agent.md Dateien und parst YAML-Frontmatter.
 * Asynchron aus demselben Grund wie scanSkillDirectory — siehe scanners.js.
 * @param {string} agentsDir - Pfad zum Agents-Verzeichnis
 * @param {function} yamlParse - YAML-Parser-Funktion
 * @returns {Promise<Array<{id: string, name: string, description: string, icon: string}>>}
 */
async function scanAgentsDirectory(agentsDir, yamlParse) {
  let files;
  try {
    files = await fsp.readdir(agentsDir);
  } catch (_) {
    return []; // Verzeichnis fehlt oder ist nicht lesbar — beides kein Fehlerfall.
  }

  const results = await Promise.all(files.filter(f => f.endsWith('.agent.md')).map(async (file) => {
    try {
      const fileSlug = file.replace('.agent.md', '');
      const raw = stripBom(await fsp.readFile(path.join(agentsDir, file), 'utf-8'));
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter) return null;
      const meta = yamlParse(frontmatter[1]);
      return {
        id: meta.name || fileSlug,
        fileSlug,
        name: meta.name || fileSlug,
        description: meta.description || '',
        icon: '\u{1F916}',
      };
    } catch (e) {
      console.warn('[agents:scan] Fehler:', e.message || e);
      return null;
    }
  }));

  return results.filter(Boolean);
}

/**
 * Scans one or more agent directories and returns a lazy-loadable index
 * (name + description + absolute .agent.md path), used to expose agents to a
 * model without inlining their full instructions — the model reads an
 * agent's file itself via its file tool once it judges the persona/approach
 * relevant to the current task, and adopts it from there. Directories are
 * deduplicated by file slug, first match wins.
 *
 * @param {string[]} dirs - Agent directories to scan, in priority order.
 * @param {(yamlString: string) => Object} yamlParse - YAML-Parser-Funktion
 * @returns {Promise<Array<{name: string, description: string, file: string}>>}
 */
async function scanAgentsIndex(dirs, yamlParse) {
  const entries = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    for (const a of await scanAgentsDirectory(dir, yamlParse)) {
      if (seen.has(a.fileSlug)) continue;
      seen.add(a.fileSlug);
      entries.push({ name: a.name, description: a.description, file: path.join(dir, `${a.fileSlug}.agent.md`) });
    }
  }
  return entries;
}

module.exports = { scanAgentsDirectory, scanAgentsIndex };

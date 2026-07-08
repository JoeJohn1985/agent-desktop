/**
 * Agents Scanner (aus main.js extrahiert für Testbarkeit)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fs = require('fs');
const path = require('path');

/**
 * Scannt ein Verzeichnis nach *.agent.md Dateien und parst YAML-Frontmatter.
 * @param {string} agentsDir - Pfad zum Agents-Verzeichnis
 * @param {function} yamlParse - YAML-Parser-Funktion
 * @returns {Array<{id: string, name: string, description: string, icon: string}>}
 */
function scanAgentsDirectory(agentsDir, yamlParse) {
  const agents = [];
  if (!fs.existsSync(agentsDir)) return agents;

  for (const file of fs.readdirSync(agentsDir)) {
    if (!file.endsWith('.agent.md')) continue;
    try {
      const fileSlug = file.replace('.agent.md', '');
      const raw = fs.readFileSync(path.join(agentsDir, file), 'utf-8').replace(/^\uFEFF/, '');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) {
        const meta = yamlParse(frontmatter[1]);
        agents.push({
          id: meta.name || fileSlug,
          fileSlug,
          name: meta.name || fileSlug,
          description: meta.description || '',
          icon: '🤖',
        });
      }
    } catch (e) {
      console.warn('[agents:scan] Fehler:', e.message || e);
    }
  }
  return agents;
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
 * @returns {Array<{name: string, description: string, file: string}>}
 */
function scanAgentsIndex(dirs, yamlParse) {
  const entries = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    for (const a of scanAgentsDirectory(dir, yamlParse)) {
      if (seen.has(a.fileSlug)) continue;
      seen.add(a.fileSlug);
      entries.push({ name: a.name, description: a.description, file: path.join(dir, `${a.fileSlug}.agent.md`) });
    }
  }
  return entries;
}

module.exports = { scanAgentsDirectory, scanAgentsIndex };

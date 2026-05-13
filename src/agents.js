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

module.exports = { scanAgentsDirectory };

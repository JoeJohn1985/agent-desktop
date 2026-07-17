/**
 * Instructions Scanner (analog zu src/agents.js).
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 *
 * Unlike skills/agents (lazy index — the model reads the file itself only
 * when it judges it relevant), instructions are meant to apply
 * unconditionally. There is also no on/off toggle: every `.instructions.md`
 * file present in a provider's instructions folder is always inlined — the
 * "activation" step is simply putting the file there (or removing it).
 */

const fs = require('fs');
const path = require('path');

const MAX_INSTRUCTIONS_BYTES = 64 * 1024; // cap any single instructions file
function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

/**
 * Scannt ein Verzeichnis nach *.instructions.md Dateien und parst YAML-Frontmatter.
 * @param {string} instructionsDir - Pfad zum Instructions-Verzeichnis
 * @param {function} yamlParse - YAML-Parser-Funktion
 * @returns {Array<{id: string, fileSlug: string, name: string, description: string}>}
 */
function scanInstructionsDirectory(instructionsDir, yamlParse) {
  const items = [];
  if (!fs.existsSync(instructionsDir)) return items;

  for (const file of fs.readdirSync(instructionsDir)) {
    if (!file.endsWith('.instructions.md')) continue;
    try {
      const fileSlug = file.replace('.instructions.md', '');
      const raw = stripBom(fs.readFileSync(path.join(instructionsDir, file), 'utf-8'));
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) {
        const meta = yamlParse(frontmatter[1]) || {};
        items.push({
          id: meta.name || fileSlug,
          fileSlug,
          name: meta.name || fileSlug,
          description: meta.description || '',
        });
      }
    } catch (e) {
      console.warn('[instructions:scan] Fehler:', e.message || e);
    }
  }
  return items;
}

/**
 * Reads the body (everything after the YAML frontmatter) of an
 * `.instructions.md` file — the text that gets inlined into the system
 * prompt for an active instructions file. Returns '' on any error, a missing
 * file, or a file exceeding the size cap (mirrors system-context.js's
 * MAX_FILE_BYTES guard for the existing single-file instructions).
 * @param {string} filePath - Absolute path to the .instructions.md file.
 * @returns {string}
 */
function readInstructionsContent(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_INSTRUCTIONS_BYTES) return '';
    const raw = stripBom(fs.readFileSync(filePath, 'utf-8'));
    const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return withoutFrontmatter.trim();
  } catch (_) {
    return '';
  }
}

/**
 * Reads every `.instructions.md` file in a provider's instructions directory
 * and returns {name, content} pairs ready for `buildInstructionsBlock` —
 * there is no active/inactive selection: whatever files exist there are
 * inlined, all of them, every time. Entries with empty content (missing,
 * unreadable, or over the size cap) are dropped.
 * @param {string} instructionsDir - Pfad zum Instructions-Verzeichnis
 * @param {function} yamlParse - YAML-Parser-Funktion
 * @returns {Array<{name: string, content: string}>}
 */
function readAllInstructions(instructionsDir, yamlParse) {
  return scanInstructionsDirectory(instructionsDir, yamlParse)
    .map((it) => ({
      name: it.name,
      content: readInstructionsContent(path.join(instructionsDir, `${it.fileSlug}.instructions.md`)),
    }))
    .filter((it) => it.content);
}

module.exports = { scanInstructionsDirectory, readInstructionsContent, readAllInstructions };

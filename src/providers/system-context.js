'use strict';

// Composes the extra system-prompt context for direct-API backends from the
// project's instructions, the active agents, and the active skills — the same
// .md files the Copilot CLI reads itself. For direct APIs there is no CLI, so
// we inline their content into the (cached) system prompt.
//
// Pure-ish: only fs/path, no Electron — unit-testable with temp files.

const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 64 * 1024; // cap any single context file

function readFirst(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      const stat = fs.statSync(p);
      if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
        const txt = fs.readFileSync(p, 'utf-8');
        return (txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt).trim();
      }
    } catch (_) { /* not found — try next */ }
  }
  return null;
}

/**
 * Builds a lazy-loadable skills index: name + description + absolute file
 * path per skill. Nothing is inlined eagerly — the model reads a SKILL.md
 * itself via its file tool only once it judges that skill relevant.
 * @param {Array<{name: string, description?: string, file: string}>} [skills]
 * @returns {string} Empty string if there are no skills.
 */
function buildSkillsIndex(skills) {
  if (!skills || !skills.length) return '';
  const lines = skills.map(s => `- **${s.name}**: ${s.description || '(keine Beschreibung)'}\n  Datei: ${s.file}`);
  return `# Verfügbare Skills\n\nFolgende Skills stehen zur Verfügung. Lies bei Bedarf die angegebene Datei mit deinem Datei-Werkzeug, um die vollständige Anleitung zu erhalten — nur wenn sie für die aktuelle Aufgabe relevant ist.\n\n${lines.join('\n')}`;
}

/**
 * Builds a lazy-loadable agents index: name + description + absolute file
 * path per agent. Nothing is inlined eagerly — the model reads an agent's
 * .agent.md itself via its file tool once it judges the persona/approach
 * relevant, and adopts it for the rest of the task (a persona switch within
 * the same conversation — not a delegated sub-agent run).
 * @param {Array<{name: string, description?: string, file: string}>} [agents]
 * @returns {string} Empty string if there are no agents.
 */
function buildAgentsIndex(agents) {
  if (!agents || !agents.length) return '';
  const lines = agents.map(a => `- **${a.name}**: ${a.description || '(keine Beschreibung)'}\n  Datei: ${a.file}`);
  return `# Verfügbare Agenten\n\nFolgende Agenten (Rollen/Herangehensweisen für bestimmte Aufgabenarten) stehen zur Verfügung. Passt eine Aufgabe zu einem Agenten, lies bei Bedarf dessen Datei mit deinem Datei-Werkzeug und übernimm die darin beschriebene Herangehensweise für den weiteren Verlauf der Aufgabe.\n\n${lines.join('\n')}`;
}

/**
 * Builds the eagerly-inlined block for the provider's instruction sets.
 * Unlike skills/agents (lazy index — the model decides whether to read a
 * file), instructions apply unconditionally, so their full content is
 * embedded directly — no model judgment call, and no on/off selection either:
 * every entry passed in gets inlined (the caller decides what to pass, e.g.
 * "every file present in the provider's instructions folder").
 * @param {Array<{name: string, content: string}>} [instructions] - Already-resolved {name, content} pairs.
 * @returns {string} Empty string if there are none.
 */
function buildInstructionsBlock(instructions) {
  if (!instructions || !instructions.length) return '';
  return instructions
    .filter(it => it && it.content)
    .map(it => `## ${it.name}\n\n${it.content}`)
    .join('\n\n');
}

/**
 * Builds the composed system-context string (may be empty).
 * @param {Object} opts
 * @param {string} opts.cwd - Working directory (for project-level files).
 * @param {string} [opts.instructionsFile] - Configured instructions file path.
 * @param {Array<{name: string, content: string}>} [opts.instructions] - Provider-scoped instruction sets (see buildInstructionsBlock) — inlined in full, in addition to the base instructions file below.
 * @param {Array<{name: string, description?: string, file: string}>} [opts.agents] - Pre-scanned agents (provider-global + project) to expose as a lazy index.
 * @param {Array<{name: string, description?: string, file: string}>} [opts.skills] - Pre-scanned skills (provider-global + project) to expose as a lazy index.
 * @returns {string}
 */
function composeSystemContext(opts = {}) {
  const { cwd = process.cwd(), instructionsFile } = opts;
  const parts = [];

  // 1. Instructions (base configuration, e.g. "always answer in German").
  const instr = readFirst([
    instructionsFile,
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(cwd, 'AGENTS.md'),
  ]);
  if (instr) parts.push(`# Projekt-Instructions\n\n${instr}`);

  // 2. Provider-scoped instruction sets — eager, full content, no toggle (see
  // buildInstructionsBlock). Additive to the base instructions above.
  const instructionsBlock = buildInstructionsBlock(opts.instructions);
  if (instructionsBlock) parts.push(`# Provider-Instructions\n\n${instructionsBlock}`);

  // 3. Agents — lazy index (see buildAgentsIndex).
  const agentsBlock = buildAgentsIndex(opts.agents);
  if (agentsBlock) parts.push(agentsBlock);

  // 4. Skills — lazy index (see buildSkillsIndex).
  const skillsBlock = buildSkillsIndex(opts.skills);
  if (skillsBlock) parts.push(skillsBlock);

  return parts.join('\n\n---\n\n');
}

module.exports = { composeSystemContext, buildSkillsIndex, buildAgentsIndex, buildInstructionsBlock };

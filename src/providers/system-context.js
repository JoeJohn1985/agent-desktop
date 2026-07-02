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
 * Builds the composed system-context string (may be empty).
 * @param {Object} opts
 * @param {string} opts.cwd - Working directory (for project-level files).
 * @param {string} [opts.skillsDir] - User skills directory.
 * @param {string} [opts.agentsDir] - User agents directory.
 * @param {string} [opts.instructionsFile] - Configured instructions file path.
 * @param {string[]} [opts.activeSkills] - Active skill dir names.
 * @param {string[]} [opts.activeAgents] - Active agent file slugs.
 * @returns {string}
 */
function composeSystemContext(opts = {}) {
  const { cwd = process.cwd(), skillsDir, agentsDir, instructionsFile } = opts;
  const activeSkills = opts.activeSkills || [];
  const activeAgents = opts.activeAgents || [];
  const parts = [];

  // 1. Instructions (base configuration, e.g. "always answer in German").
  const instr = readFirst([
    instructionsFile,
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(cwd, 'AGENTS.md'),
  ]);
  if (instr) parts.push(`# Projekt-Instructions\n\n${instr}`);

  // 2. Active agents (how the task should be approached).
  for (const slug of activeAgents) {
    const content = readFirst([
      agentsDir && path.join(agentsDir, `${slug}.agent.md`),
      path.join(cwd, '.github', 'agents', `${slug}.agent.md`),
    ]);
    if (content) parts.push(`# Agent: ${slug}\n\n${content}`);
  }

  // 3. Active skills (reference knowledge the model may draw on).
  for (const dirName of activeSkills) {
    const content = readFirst([
      skillsDir && path.join(skillsDir, dirName, 'SKILL.md'),
      path.join(cwd, '.github', 'skills', dirName, 'SKILL.md'),
    ]);
    if (content) parts.push(`# Skill: ${dirName}\n\n${content}`);
  }

  return parts.join('\n\n---\n\n');
}

module.exports = { composeSystemContext };

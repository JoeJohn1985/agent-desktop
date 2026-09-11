'use strict';

// Keeps the cross-provider "plans" convention in sync into the ACP providers'
// own global instruction files.
//
// The idea: plans live as markdown under `plans/` in a project, and every
// provider can already read and write files there — so nothing needs to be
// transported between sessions. What's missing is that the model *knows* the
// convention without the user explaining it in every chat. So the text lives
// once in ~/.agent-desktop/plans.md and is mirrored into the instruction files
// the CLIs read by themselves (~/.claude/CLAUDE.md, ~/.copilot/copilot-instructions.md).
//
// Those files belong to the user, not to this app: everything here is scoped
// to a marked block, leaves surrounding content untouched, and never writes
// when nothing changed.

const fs = require('fs');
const path = require('path');

const MARKER_START = '<!-- agent-desktop:plans:start -->';
const MARKER_END = '<!-- agent-desktop:plans:end -->';

/** Shipped default for the source file — the actual convention text. */
const DEFAULT_PLANS_MD = `${MARKER_START}
## Pläne

Pläne liegen als Markdown-Dateien unter \`plans/\` im jeweiligen
Projektverzeichnis und sind providerübergreifend nutzbar.

- Plan erstellen: neue Datei \`plans/<kurzer-slug>.md\` anlegen
- Plan umsetzen/fortsetzen: in \`plans/\` nachsehen und die passende
  Datei lesen, bevor du mit der Arbeit beginnst
- Den Plan aktualisieren, während du ihn abarbeitest, damit eine
  andere Session daran anknüpfen kann
${MARKER_END}
`;

/**
 * Wraps content in the markers unless it already carries a well-formed pair.
 *
 * The markers live in the source file, so the user can edit the text freely —
 * but if they strip the markers, the block would be unfindable on the next run
 * and get appended a second time. Re-adding them here keeps that from happening.
 * @param {string} content
 * @returns {string}
 */
function ensureMarkers(content) {
  const body = String(content ?? '');
  if (!body.trim()) return '';
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  if (start !== -1 && end !== -1 && end > start) return body.trim();
  return `${MARKER_START}\n${body.trim()}\n${MARKER_END}`;
}

/**
 * Inserts, replaces or removes the marked block inside a target file's content.
 *
 * Pure string logic — no fs — because this is the part that can silently eat a
 * user's instruction file if it gets the boundaries wrong.
 *
 * With a broken/half-present marker pair we deliberately APPEND rather than
 * guess where the block ends: a duplicated block is recoverable (the next run
 * finds a well-formed pair again), swallowing someone's instructions is not.
 *
 * @param {string} targetContent - Current content of the instruction file ('' if new).
 * @param {string} blockContent - The block to apply, markers included. Empty → remove.
 * @returns {string} The new content.
 */
function applyBlock(targetContent, blockContent) {
  const target = String(targetContent ?? '');
  const block = ensureMarkers(blockContent);

  const start = target.indexOf(MARKER_START);
  const end = target.indexOf(MARKER_END);
  const hasBlock = start !== -1 && end !== -1 && end > start;

  if (!block) {
    // Empty source = "convention off": drop the block, keep everything else.
    if (!hasBlock) return target;
    const before = target.slice(0, start);
    const after = target.slice(end + MARKER_END.length);
    return `${before.replace(/\n{2,}$/, '\n')}${after.replace(/^\n+/, '')}`.trimEnd() + '\n';
  }

  if (hasBlock) {
    const before = target.slice(0, start);
    const after = target.slice(end + MARKER_END.length);
    return `${before}${block}${after}`;
  }

  if (!target.trim()) return `${block}\n`;
  return `${target.trimEnd()}\n\n${block}\n`;
}

/**
 * Reads the source file, creating it with the default text when missing.
 * Never overwrites an existing one — the user's edits are the point.
 * @param {string} sourcePath
 * @param {Object} [fsImpl=fs]
 * @returns {string} The source content ('' if it couldn't be read).
 */
function ensureSourceFile(sourcePath, fsImpl = fs) {
  try {
    if (fsImpl.existsSync(sourcePath)) {
      return fsImpl.readFileSync(sourcePath, 'utf-8');
    }
    fsImpl.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fsImpl.writeFileSync(sourcePath, DEFAULT_PLANS_MD, 'utf-8');
    return DEFAULT_PLANS_MD;
  } catch (e) {
    console.warn('[plans-convention] source file unavailable:', e?.message || e);
    return '';
  }
}

/**
 * Applies the block to one target instruction file.
 * Writes only when the content actually changes, so a normal app start doesn't
 * keep touching files the user (and their editors/git) are watching.
 * @param {string} sourceContent
 * @param {string} targetPath
 * @param {Object} [fsImpl=fs]
 * @returns {boolean} true if the file was written.
 */
function syncToTarget(sourceContent, targetPath, fsImpl = fs) {
  try {
    const exists = fsImpl.existsSync(targetPath);
    const current = exists ? fsImpl.readFileSync(targetPath, 'utf-8') : '';
    const next = applyBlock(current, sourceContent);
    if (exists && next === current) return false;
    if (!exists && !next.trim()) return false; // nothing to say, don't create a file
    fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
    fsImpl.writeFileSync(targetPath, next, 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[plans-convention] sync to ${targetPath} failed:`, e?.message || e);
    return false;
  }
}

module.exports = {
  MARKER_START,
  MARKER_END,
  DEFAULT_PLANS_MD,
  ensureMarkers,
  applyBlock,
  ensureSourceFile,
  syncToTarget,
};

'use strict';

// Reads Claude Code's own conversation transcripts — an undocumented, internal
// storage format of the Claude Agent SDK/CLI (not part of the ACP protocol),
// used here only to restore history when reopening a tab. If the file or
// format is ever missing/different (e.g. a future Claude Code version), every
// function here fails soft to [] — never throws, never blocks the tab.
//
// Location: ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl
// where <sanitized-cwd> replaces every ':', '\', '/', ' ' in the session's
// cwd with '-' (e.g. "C:\DEV\My App" → "C--DEV-My-App").

const fs = require('fs');
const path = require('path');
const { extractMessageContent } = require('./sessions');

/** Encodes a cwd the way Claude Code names its ~/.claude/projects/<...> folder. */
function sanitizeCwdForClaudeProjects(cwd) {
  return String(cwd || '').replace(/[:\\/ ]/g, '-');
}

/** Absolute path to a Claude Code session's own JSONL transcript file. */
function claudeCodeTranscriptPath(homeDir, cwd, sessionId) {
  return path.join(homeDir, '.claude', 'projects', sanitizeCwdForClaudeProjects(cwd), `${sessionId}.jsonl`);
}

/**
 * Reads the full user/assistant message history from a Claude Code session's
 * own transcript (its native JSONL format, one full API turn per line).
 * Skips non-message lines (queue-operation, attachment, summary, …), subagent
 * side-chains (isSidechain), and turns with no plain-text content (pure
 * tool_use/tool_result turns) — mirroring the same simplified "text-only
 * history preview" readAllMessages() already provides for Copilot sessions.
 *
 * @param {string} homeDir - os.homedir()
 * @param {string} cwd - The session's original working directory
 * @param {string} sessionId
 * @param {number} [limit=1000] - Upper bound (keeps most recent), 0 = unbounded
 * @returns {Array<{role: string, content: string, timestamp: string}>}
 */
function readClaudeCodeTranscript(homeDir, cwd, sessionId, limit = 1000) {
  if (!homeDir || !cwd || !sessionId) return [];
  const filePath = claudeCodeTranscriptPath(homeDir, cwd, sessionId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const messages = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try { event = JSON.parse(trimmed); } catch (_) { continue; }
      if (event.isSidechain) continue;
      if (event.type !== 'user' && event.type !== 'assistant') continue;
      const text = extractMessageContent(event.message && event.message.content);
      if (!text) continue;
      messages.push({ role: event.type, content: text, timestamp: event.timestamp || '' });
    }
    return limit > 0 && messages.length > limit ? messages.slice(-limit) : messages;
  } catch (e) {
    console.warn('[claude-code-transcript] Fehler:', e.message || e);
    return [];
  }
}

module.exports = { sanitizeCwdForClaudeProjects, claudeCodeTranscriptPath, readClaudeCodeTranscript };

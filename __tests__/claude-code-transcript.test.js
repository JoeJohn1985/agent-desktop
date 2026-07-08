'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeCwdForClaudeProjects,
  claudeCodeTranscriptPath,
  readClaudeCodeTranscript,
} = require('../src/claude-code-transcript');

describe('sanitizeCwdForClaudeProjects', () => {
  it('replaces each ":", "\\\\", "/" and space with a single "-"', () => {
    expect(sanitizeCwdForClaudeProjects('C:\\DEV\\copilot\\Copilot Desktop App'))
      .toBe('C--DEV-copilot-Copilot-Desktop-App');
  });

  it('handles forward slashes', () => {
    expect(sanitizeCwdForClaudeProjects('C:/DEV/app')).toBe('C--DEV-app');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeCwdForClaudeProjects(null)).toBe('');
    expect(sanitizeCwdForClaudeProjects(undefined)).toBe('');
  });
});

describe('claudeCodeTranscriptPath', () => {
  it('joins home/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl', () => {
    const home = path.join('C:', 'Users', 'test');
    const result = claudeCodeTranscriptPath(home, 'C:\\DEV\\app', 'abc-123');
    expect(result).toBe(path.join(home, '.claude', 'projects', 'C--DEV-app', 'abc-123.jsonl'));
  });

  it('rejects a sessionId that would escape the projects directory (path traversal)', () => {
    const home = path.join('C:', 'Users', 'test');
    expect(claudeCodeTranscriptPath(home, 'C:\\DEV\\app', '..\\..\\..\\Windows\\System32\\config\\SAM')).toBeNull();
    expect(claudeCodeTranscriptPath(home, 'C:\\DEV\\app', '../../etc/passwd')).toBeNull();
  });

  it('rejects an empty sessionId', () => {
    const home = path.join('C:', 'Users', 'test');
    expect(claudeCodeTranscriptPath(home, 'C:\\DEV\\app', '')).toBeNull();
  });
});

describe('readClaudeCodeTranscript', () => {
  let home;
  const cwd = 'C:\\DEV\\testproject';
  const sessionId = 'sess-1';

  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-transcript-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const dir = path.join(home, '.claude', 'projects', sanitizeCwdForClaudeProjects(cwd));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  }

  it('returns [] when homeDir/cwd/sessionId is missing', () => {
    expect(readClaudeCodeTranscript(null, cwd, sessionId)).toEqual([]);
    expect(readClaudeCodeTranscript(home, null, sessionId)).toEqual([]);
    expect(readClaudeCodeTranscript(home, cwd, null)).toEqual([]);
  });

  it('returns [] when the transcript file does not exist', () => {
    expect(readClaudeCodeTranscript(home, cwd, sessionId)).toEqual([]);
  });

  it('returns [] for a path-traversal sessionId instead of escaping the projects dir', () => {
    expect(readClaudeCodeTranscript(home, cwd, '../../../etc/passwd')).toEqual([]);
  });

  it('extracts user/assistant text turns in order', () => {
    writeTranscript([
      { type: 'queue-operation', operation: 'enqueue' },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hey' }] }, timestamp: 't1' },
      { type: 'attachment', attachment: { type: 'agent_listing_delta' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] }, timestamp: 't2' },
    ]);
    expect(readClaudeCodeTranscript(home, cwd, sessionId)).toEqual([
      { role: 'user', content: 'hey', timestamp: 't1' },
      { role: 'assistant', content: 'hi there', timestamp: 't2' },
    ]);
  });

  it('skips subagent side-chains (isSidechain)', () => {
    writeTranscript([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'main' }] }, timestamp: 't1' },
      { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'sub-agent chatter' }] }, timestamp: 't2' },
    ]);
    const result = readClaudeCodeTranscript(home, cwd, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('main');
  });

  it('skips turns with no plain-text content (pure tool_use/tool_result)', () => {
    writeTranscript([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] }, timestamp: 't1' },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file contents' }] }, timestamp: 't2' },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'real message' }] }, timestamp: 't3' },
    ]);
    const result = readClaudeCodeTranscript(home, cwd, sessionId);
    expect(result).toEqual([{ role: 'user', content: 'real message', timestamp: 't3' }]);
  });

  it('extracts text alongside tool_use blocks in the same turn', () => {
    writeTranscript([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Ich lese die Datei.' }, { type: 'tool_use', name: 'Read', input: {} }] }, timestamp: 't1' },
    ]);
    expect(readClaudeCodeTranscript(home, cwd, sessionId)).toEqual([
      { role: 'assistant', content: 'Ich lese die Datei.', timestamp: 't1' },
    ]);
  });

  it('ignores malformed JSON lines', () => {
    const dir = path.join(home, '.claude', 'projects', sanitizeCwdForClaudeProjects(cwd));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${sessionId}.jsonl`),
      '{not valid json\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'ok' }] }, timestamp: 't1' }) + '\n',
      'utf-8'
    );
    expect(readClaudeCodeTranscript(home, cwd, sessionId)).toEqual([{ role: 'user', content: 'ok', timestamp: 't1' }]);
  });

  it('respects the limit, keeping the most recent entries', () => {
    writeTranscript([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'one' }] }, timestamp: 't1' },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'two' }] }, timestamp: 't2' },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'three' }] }, timestamp: 't3' },
    ]);
    const result = readClaudeCodeTranscript(home, cwd, sessionId, 2);
    expect(result).toEqual([
      { role: 'user', content: 'two', timestamp: 't2' },
      { role: 'user', content: 'three', timestamp: 't3' },
    ]);
  });
});

'use strict';

const {
  shortenPath,
  truncatePath,
  formatDate,
  escapeHtml,
  escapeAttr,
  contextColor,
  categoryColor,
  toolIcon,
  toolDisplayName,
  formatToolArgs,
  filterSessions,
  TOOL_ARGS_MAX_LENGTH,
} = require('../src/renderer-logic');

// ── shortenPath ──────────────────────────────────────────────
describe('shortenPath', () => {
  it('returns empty string for null/undefined input', () => {
    expect(shortenPath(null, 'C:\\Users\\Test')).toBe('');
    expect(shortenPath(undefined, 'C:\\Users\\Test')).toBe('');
  });

  it('returns unchanged path when homeDir is empty', () => {
    expect(shortenPath('C:\\Users\\Test\\Projects', '')).toBe('C:\\Users\\Test\\Projects');
  });

  it('replaces home directory with ~\\', () => {
    const result = shortenPath('C:\\Users\\Test\\Projects\\app', 'C:\\Users\\Test');
    expect(result).toBe('~\\\\Projects\\app');
  });

  it('is case-insensitive', () => {
    const result = shortenPath('c:\\users\\test\\Projects', 'C:\\Users\\Test');
    expect(result).toBe('~\\\\Projects');
  });
});

// ── truncatePath ─────────────────────────────────────────────
describe('truncatePath', () => {
  it('returns empty string for empty/null input', () => {
    expect(truncatePath('')).toBe('');
    expect(truncatePath(null)).toBe('');
    expect(truncatePath(undefined)).toBe('');
  });

  it('returns short path unchanged', () => {
    expect(truncatePath('src/app.js')).toBe('src/app.js');
  });

  it('truncates long path to last 2 segments', () => {
    expect(truncatePath('C:/Users/Test/Projects/app/src/main.js')).toBe('…/src/main.js');
  });

  it('handles backslashes', () => {
    expect(truncatePath('C:\\Users\\Test\\src\\file.js')).toBe('…/src/file.js');
  });
});

// ── formatDate ───────────────────────────────────────────────
describe('formatDate', () => {
  const ref = new Date('2026-05-04T20:00:00Z');

  it('returns "–" for empty input', () => {
    expect(formatDate(null, ref)).toBe('–');
    expect(formatDate('', ref)).toBe('–');
  });

  it('returns "gerade eben" for dates < 1 minute ago', () => {
    const iso = new Date(ref - 30000).toISOString(); // 30s ago
    expect(formatDate(iso, ref)).toBe('gerade eben');
  });

  it('returns minutes for < 1 hour', () => {
    const iso = new Date(ref - 5 * 60000).toISOString(); // 5min ago
    expect(formatDate(iso, ref)).toBe('vor 5 Min.');
  });

  it('returns hours for < 24 hours', () => {
    const iso = new Date(ref - 3 * 3600000).toISOString(); // 3h ago
    expect(formatDate(iso, ref)).toBe('vor 3 Std.');
  });

  it('returns days for < 7 days', () => {
    const iso = new Date(ref - 2 * 86400000).toISOString(); // 2 days ago
    expect(formatDate(iso, ref)).toBe('vor 2 Tagen');
  });

  it('returns "vor 1 Tag" (singular)', () => {
    const iso = new Date(ref - 1 * 86400000).toISOString();
    expect(formatDate(iso, ref)).toBe('vor 1 Tag');
  });

  it('returns formatted date for > 7 days', () => {
    const iso = new Date(ref - 10 * 86400000).toISOString();
    const result = formatDate(iso, ref);
    // Should be in dd.mm.yy format
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{2}/);
  });
});

// ── escapeHtml ───────────────────────────────────────────────
describe('escapeHtml', () => {
  it('escapes < and >', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes quotes', () => {
    expect(escapeHtml("it's \"quoted\"")).toBe("it&#39;s &quot;quoted&quot;");
  });

  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

// ── escapeAttr ───────────────────────────────────────────────
describe('escapeAttr', () => {
  it('escapes all special chars', () => {
    expect(escapeAttr('<"test">')).toBe('&lt;&quot;test&quot;&gt;');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("it's")).toBe("it&#39;s");
  });
});

// ── contextColor ─────────────────────────────────────────────
describe('contextColor', () => {
  it('returns red for > 80%', () => {
    expect(contextColor(85)).toBe('#f38ba8');
    expect(contextColor(100)).toBe('#f38ba8');
  });

  it('returns orange for 61-80%', () => {
    expect(contextColor(61)).toBe('#fab387');
    expect(contextColor(80)).toBe('#fab387');
  });

  it('returns green for <= 60%', () => {
    expect(contextColor(60)).toBe('#a6e3a1');
    expect(contextColor(0)).toBe('#a6e3a1');
    expect(contextColor(30)).toBe('#a6e3a1');
  });
});

// ── categoryColor ────────────────────────────────────────────
describe('categoryColor', () => {
  it('maps known categories', () => {
    expect(categoryColor('Free Space')).toBe('#a6e3a1');
    expect(categoryColor('Messages')).toBe('#89b4fa');
    expect(categoryColor('Buffer')).toBe('#a6adc8');
  });

  it('returns pink for unknown categories', () => {
    expect(categoryColor('Other')).toBe('#f5c2e7');
    expect(categoryColor('Tools')).toBe('#f5c2e7');
  });
});

// ── toolIcon ─────────────────────────────────────────────────
describe('toolIcon', () => {
  it('returns emoji for known tools', () => {
    expect(toolIcon('view')).toBe('📄');
    expect(toolIcon('edit')).toBe('✏️');
    expect(toolIcon('grep')).toBe('🔍');
    expect(toolIcon('powershell')).toBe('⚡');
  });

  it('returns null for unknown tools', () => {
    expect(toolIcon('unknown_tool')).toBeNull();
    expect(toolIcon('')).toBeNull();
  });
});

// ── toolDisplayName ──────────────────────────────────────────
describe('toolDisplayName', () => {
  it('maps known tools to display names', () => {
    expect(toolDisplayName('grep')).toBe('search');
    expect(toolDisplayName('view')).toBe('read');
    expect(toolDisplayName('glob')).toBe('find');
    expect(toolDisplayName('powershell')).toBe('run');
  });

  it('returns original name for unknown tools', () => {
    expect(toolDisplayName('custom_tool')).toBe('custom_tool');
  });
});

// ── formatToolArgs ───────────────────────────────────────────
describe('formatToolArgs', () => {
  it('returns empty string for null/undefined args', () => {
    expect(formatToolArgs('view', null)).toBe('');
    expect(formatToolArgs('view', undefined)).toBe('');
  });

  it('uses truncatePath for path args', () => {
    expect(formatToolArgs('view', { path: 'C:/Users/Test/src/file.js' })).toBe('…/src/file.js');
  });

  it('returns pattern directly', () => {
    expect(formatToolArgs('grep', { pattern: 'TODO' })).toBe('TODO');
  });

  it('truncates long commands', () => {
    const longCmd = 'a'.repeat(100);
    const result = formatToolArgs('powershell', { command: longCmd });
    expect(result.length).toBe(TOOL_ARGS_MAX_LENGTH + 1); // 60 chars + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('does not truncate short commands', () => {
    expect(formatToolArgs('powershell', { command: 'npm test' })).toBe('npm test');
  });

  it('handles query args', () => {
    expect(formatToolArgs('sql', { query: 'SELECT * FROM todos' })).toBe('SELECT * FROM todos');
  });

  it('handles prompt args', () => {
    expect(formatToolArgs('task', { prompt: 'Fix the bug' })).toBe('Fix the bug');
  });

  it('returns empty for args without recognized keys', () => {
    expect(formatToolArgs('custom', { foo: 'bar' })).toBe('');
  });

  it('respects custom maxLen', () => {
    const cmd = 'a'.repeat(20);
    const result = formatToolArgs('powershell', { command: cmd }, 10);
    expect(result).toBe('a'.repeat(10) + '…');
  });
});

// ── filterSessions ───────────────────────────────────────────
describe('filterSessions', () => {
  const mockSessions = [
    { id: 'abc-123', name: 'Fix sidebar bug' },
    { id: 'def-456', name: 'Add video feature' },
    { id: 'ghi-789', name: null },
  ];

  it('returns all sessions when query is empty', () => {
    expect(filterSessions(mockSessions, '')).toEqual(mockSessions);
    expect(filterSessions(mockSessions, null)).toEqual(mockSessions);
    expect(filterSessions(mockSessions, undefined)).toEqual(mockSessions);
  });

  it('filters by name', () => {
    const result = filterSessions(mockSessions, 'sidebar');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc-123');
  });

  it('filters by id', () => {
    const result = filterSessions(mockSessions, 'def');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('def-456');
  });

  it('is case-insensitive', () => {
    const result = filterSessions(mockSessions, 'VIDEO');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('def-456');
  });

  it('handles sessions with null name', () => {
    const result = filterSessions(mockSessions, 'xyz');
    expect(result).toHaveLength(0);
  });

  it('returns multiple matches', () => {
    const result = filterSessions(mockSessions, 'fix');
    // Only 'Fix sidebar bug' matches
    expect(result).toHaveLength(1);
  });

  it('matches session ID for resume-by-id use case', () => {
    const result = filterSessions(mockSessions, '8c205927-6dbd-42aa');
    expect(result).toHaveLength(0); // not in the list
    const result2 = filterSessions(mockSessions, 'ghi-789');
    expect(result2).toHaveLength(1);
    expect(result2[0].id).toBe('ghi-789');
  });
});

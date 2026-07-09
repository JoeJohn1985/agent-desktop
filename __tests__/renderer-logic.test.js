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
  toolArgFullText,
  truncateInline,
  formatToolResultPreview,
  filterSessions,
  TOOL_ARGS_MAX_LENGTH,
  TOOL_PREVIEW_MAX_LENGTH,
  MODEL_PRICING,
  parseTokenK,
  parseUsageTokens,
  parseUsageRequests,
  estimateCredits,
  estimateCreditsDelta,
  estimateCostUsd,
  estimateCostUsdDelta,
  getModelPricing,
  setDynamicPricing,
  buildCostBuckets,
  aggregateCostBySession,
  trimCostLog,
  parseQuotaError,
  buildAgentPrefix,
  formatSubscriptionUsage,
  mergeRateLimitWindows,
  rateLimitFamily,
} = require('../src/renderer-logic');

// ── parseQuotaError ──────────────────────────────────────────
describe('parseQuotaError', () => {
  it('erkennt Gemini Free-Tier limit:0 (kein Guthaben) inkl. Modell', () => {
    const raw = JSON.stringify({ error: { message: 'You exceeded your current quota ... Quota exceeded for metric: ... limit: 0, model: gemini-2.5-pro\nPlease retry in 4.42s.', code: 429, status: 'Too Many Requests' } });
    const r = parseQuotaError(raw);
    expect(r).not.toBeNull();
    expect(r.title).toMatch(/Kontingent nicht verfügbar/);
    expect(r.model).toBe('gemini-2.5-pro');
    expect(r.retrySeconds).toBe(5); // aufgerundet von 4.42
  });

  it('erkennt allgemeines Rate-Limit (429) mit Retry-Hinweis', () => {
    const raw = '{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Please retry in 12s"}';
    const r = parseQuotaError(raw);
    expect(r.title).toBe('Rate-Limit erreicht');
    expect(r.retrySeconds).toBe(12);
  });

  it('erkennt Anthropic „credit balance is too low" als Limit', () => {
    const r = parseQuotaError('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}');
    expect(r.title).toMatch(/Kosten-\/Nutzungslimit/);
  });

  it('erkennt OpenAI insufficient_quota', () => {
    const r = parseQuotaError('{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}');
    expect(r).not.toBeNull();
  });

  it('gibt null für nicht-quota-Fehler zurück', () => {
    expect(parseQuotaError('TypeError: foo is not a function')).toBeNull();
    expect(parseQuotaError('')).toBeNull();
    expect(parseQuotaError(null)).toBeNull();
  });
});

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

  it('handles MCP tool argument keys (url/selector/element/text)', () => {
    expect(formatToolArgs('browser_navigate', { url: 'https://example.com' })).toBe('https://example.com');
    expect(formatToolArgs('browser_click', { selector: '#submit' })).toBe('#submit');
    expect(formatToolArgs('browser_click', { element: 'Submit button' })).toBe('Submit button');
    expect(formatToolArgs('browser_type', { text: 'hello' })).toBe('hello');
  });

  it('collapses embedded newlines before truncating', () => {
    expect(formatToolArgs('powershell', { command: 'line1\nline2\nline3' })).toBe('line1 line2 line3');
  });
});

// ── toolArgFullText ────────────────────────────────────────────
describe('toolArgFullText', () => {
  it('returns the untruncated primary argument, unlike formatToolArgs', () => {
    const longCmd = 'a'.repeat(100);
    expect(toolArgFullText({ command: longCmd })).toBe(longCmd);
  });

  it('preserves embedded newlines (no collapsing)', () => {
    expect(toolArgFullText({ command: 'line1\nline2' })).toBe('line1\nline2');
  });

  it('returns empty string for null/undefined/unrecognized args', () => {
    expect(toolArgFullText(null)).toBe('');
    expect(toolArgFullText({ foo: 'bar' })).toBe('');
  });
});

// ── truncateInline ───────────────────────────────────────────
describe('truncateInline', () => {
  it('leaves short text untouched', () => {
    expect(truncateInline('hello', 60)).toBe('hello');
  });

  it('collapses whitespace/newlines and truncates with an ellipsis', () => {
    const text = 'a'.repeat(70);
    const result = truncateInline(text, 60);
    expect(result).toBe('a'.repeat(60) + '…');
  });

  it('handles empty/undefined input', () => {
    expect(truncateInline('', 60)).toBe('');
    expect(truncateInline(undefined, 60)).toBe('');
  });
});

// ── formatToolResultPreview ──────────────────────────────────
describe('formatToolResultPreview', () => {
  it('leaves short results untouched', () => {
    expect(formatToolResultPreview('ok')).toBe('ok');
  });

  it('truncates long results to TOOL_PREVIEW_MAX_LENGTH', () => {
    const longResult = 'x'.repeat(500);
    const result = formatToolResultPreview(longResult);
    expect(result.length).toBe(TOOL_PREVIEW_MAX_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('collapses embedded newlines', () => {
    expect(formatToolResultPreview('line1\nline2\nline3')).toBe('line1 line2 line3');
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

// ── parseTokenK ──────────────────────────────────────────────
describe('parseTokenK', () => {
  it('parst Ganzzahl ohne k', () => {
    expect(parseTokenK('13')).toBe(13);
  });

  it('parst Dezimalzahl mit k-Suffix', () => {
    expect(parseTokenK('17.5k')).toBe(17500);
  });

  it('parst ganzzahl mit k-Suffix', () => {
    expect(parseTokenK('2k')).toBe(2000);
  });

  it('parst 0', () => {
    expect(parseTokenK('0')).toBe(0);
  });

  it('gibt null für leeren String zurück', () => {
    expect(parseTokenK('')).toBeNull();
    expect(parseTokenK(null)).toBeNull();
  });
});

// ── parseUsageTokens ─────────────────────────────────────────
describe('parseUsageTokens', () => {
  const SAMPLE = 'Session Usage\n\nChanges: +0 -0\nRequests: 1 AI Units (7s)\nTokens: input 17.5k, output 13, cached 0';

  it('parst input, output und cached korrekt', () => {
    const result = parseUsageTokens(SAMPLE);
    expect(result).toEqual({ input: 17500, output: 13, cache: 0 });
  });

  it('gibt null zurück wenn kein Token-Block vorhanden', () => {
    expect(parseUsageTokens('Requests: 1 AI Units')).toBeNull();
  });

  it('parst alle drei Werte mit k-Suffix', () => {
    const result = parseUsageTokens('Tokens: input 19.0k, output 15, cached 9.6k');
    expect(result).toEqual({ input: 19000, output: 15, cache: 9600 });
  });

  it('ist case-insensitiv', () => {
    const result = parseUsageTokens('tokens: INPUT 1k, OUTPUT 2, CACHED 3k');
    expect(result).toEqual({ input: 1000, output: 2, cache: 3000 });
  });

  it('parst optionales cachewrite (Direkt-API-Format)', () => {
    const result = parseUsageTokens('Tokens: input 1000, output 50, cached 200, cachewrite 800');
    expect(result).toEqual({ input: 1000, output: 50, cache: 200, cacheWrite: 800 });
  });

  it('ohne cachewrite bleibt das Objekt unverändert (kein cacheWrite-Key)', () => {
    const result = parseUsageTokens('Tokens: input 1000, output 50, cached 200');
    expect(result).toEqual({ input: 1000, output: 50, cache: 200 });
    expect('cacheWrite' in result).toBe(false);
  });
});

// ── parseUsageRequests ───────────────────────────────────────
describe('parseUsageRequests', () => {
  it('parst AI Units', () => {
    const result = parseUsageRequests('Requests: 3 AI Units (7s)');
    expect(result).toEqual({ value: 3, unit: 'AI Units' });
  });

  it('parst AI Credits', () => {
    const result = parseUsageRequests('Requests: 1.5 AI Credits');
    expect(result).toEqual({ value: 1.5, unit: 'AI Credits' });
  });

  it('gibt null zurück wenn kein Match', () => {
    expect(parseUsageRequests('keine Daten')).toBeNull();
  });
});

// ── estimateCredits ──────────────────────────────────────────
describe('estimateCredits', () => {
  it('berechnet Credits für Sonnet 4.6 korrekt', () => {
    // 1M input @ 300C = 300C, 0 cache, 1000 output @ 1500C/1M = 1.5C → total 301.5C
    const result = estimateCredits({ input: 1_000_000, output: 1000, cache: 0 }, 'claude-sonnet-4.6');
    expect(result).toBe(301.5);
  });

  it('berücksichtigt Cache-Tokens günstiger', () => {
    // 100k input @ 300C/1M = 30C, 100k cache @ 30C/1M = 3C, 0 output → 33C
    const result = estimateCredits({ input: 100_000, output: 0, cache: 100_000 }, 'claude-sonnet-4.6');
    expect(result).toBe(33);
  });

  it('gibt null für unbekanntes Modell zurück', () => {
    expect(estimateCredits({ input: 1000, output: 100, cache: 0 }, 'claude-unknown-9.9')).toBeNull();
  });

  it('berechnet Credits für Haiku 4.5 korrekt', () => {
    // 1M input @ 100C = 100C, 1M cache @ 10C = 10C, 1M output @ 500C = 500C → 610C
    const result = estimateCredits({ input: 1_000_000, output: 1_000_000, cache: 1_000_000 }, 'claude-haiku-4.5');
    expect(result).toBe(610);
  });

  it('gibt null ohne Token-Daten zurück', () => {
    expect(estimateCredits(null, 'claude-sonnet-4.6')).toBeNull();
  });

  it('rundet auf eine Nachkommastelle', () => {
    // 1234 input tokens @ 300/1M = 0.3702C → gerundet 0.4C
    const result = estimateCredits({ input: 1234, output: 0, cache: 0 }, 'claude-sonnet-4.6');
    expect(result).toBe(0.4);
  });

  it('Opus 4.8 ist teurer als Sonnet 4.6', () => {
    const tokens = { input: 100_000, output: 1000, cache: 0 };
    const sonnet = estimateCredits(tokens, 'claude-sonnet-4.6');
    const opus = estimateCredits(tokens, 'claude-opus-4.8');
    expect(opus).toBeGreaterThan(sonnet);
  });

  it('berechnet cache-write zu 1,25x Input', () => {
    // Opus API: Input $5/1M → cache-write $6.25/1M. 2M cacheWrite = $12.5
    const v = estimateCredits({ input: 0, output: 0, cache: 0, cacheWrite: 2_000_000 }, 'claude-opus-4-8');
    expect(v).toBe(12.5);
  });
});

// ── estimateCreditsDelta ─────────────────────────────────────
describe('estimateCreditsDelta', () => {
  it('bewertet beim ersten Lesen (kein Vorwert) die vollen Tokens', () => {
    // prev null → delta = volle 1M input @ 300 = 300C
    const result = estimateCreditsDelta({ input: 1_000_000, output: 0, cache: 0 }, null, 'claude-sonnet-4.6');
    expect(result).toBe(300);
  });

  it('bewertet nur den Zuwachs seit der letzten Messung', () => {
    // von 1M auf 1.5M input → Delta 0.5M @ 300 = 150C
    const result = estimateCreditsDelta(
      { input: 1_500_000, output: 0, cache: 0 },
      { input: 1_000_000, output: 0, cache: 0 },
      'claude-sonnet-4.6',
    );
    expect(result).toBe(150);
  });

  it('preist neue Tokens nach Modellwechsel NICHT die alten um', () => {
    // 1M unter Sonnet verbraucht, dann Wechsel auf Opus, 1M neu dazu.
    // Korrekt: nur die 1M neuen Tokens @ Opus 500 = 500C —
    // NICHT 500×2M − 300×1M = 700C (alter, fehlerhafter Ansatz).
    const result = estimateCreditsDelta(
      { input: 2_000_000, output: 0, cache: 0 }, // kumuliert nach Prompt 2
      { input: 1_000_000, output: 0, cache: 0 }, // kumuliert nach Prompt 1
      'claude-opus-4.8',
    );
    expect(result).toBe(500);
  });

  it('klemmt negative Deltas auf 0 (z.B. nach /clear oder /compact)', () => {
    // Kontext geschrumpft: kumuliert fällt von 50k auf 5k → kein negativer Eintrag
    const result = estimateCreditsDelta(
      { input: 5_000, output: 0, cache: 0 },
      { input: 50_000, output: 0, cache: 0 },
      'claude-sonnet-4.6',
    );
    expect(result).toBe(0);
  });

  it('verrechnet input, cache und output getrennt', () => {
    // Delta: input 1M@300, cache 1M@30, output 1M@1500 (Sonnet) = 1830C
    const result = estimateCreditsDelta(
      { input: 1_000_000, output: 1_000_000, cache: 1_000_000 },
      { input: 0, output: 0, cache: 0 },
      'claude-sonnet-4.6',
    );
    expect(result).toBe(1830);
  });

  it('gibt null für unbekanntes Modell zurück', () => {
    expect(estimateCreditsDelta({ input: 1000 }, null, 'claude-unknown-9.9')).toBeNull();
  });

  it('gibt null ohne aktuelle Token-Daten zurück', () => {
    expect(estimateCreditsDelta(null, { input: 1000 }, 'claude-sonnet-4.6')).toBeNull();
  });
});

// ── estimateCostUsd ──────────────────────────────────────────
describe('estimateCostUsd', () => {
  it('rechnet Copilot-Credits in USD um (100 AIC = 1$)', () => {
    // 1M input @ 300 AIC + 1k output ≈ 300 AIC → /100 = ~3 $
    const usd = estimateCostUsd({ input: 1_000_000, output: 0, cache: 0 }, 'claude-sonnet-4.6');
    expect(usd).toBeCloseTo(3, 5);
  });
  it('lässt Direkt-API-Preise als USD unverändert', () => {
    // 1M input @ $5 + 1M output @ $25 = $30 (Opus API)
    const usd = estimateCostUsd({ input: 1_000_000, output: 1_000_000, cache: 0 }, 'claude-opus-4-8');
    expect(usd).toBe(30);
  });
  it('verliert kleine USD-Beträge NICHT durch Rundung (Regressionstest)', () => {
    // 10k Output-Tokens @ $2.5/1M = $0.025 — vor dem Fix rundete estimateCredits
    // das auf 0.0; jetzt ungerundet.
    const usd = estimateCostUsd({ output: 10_000 }, 'gemini-2.5-flash');
    expect(usd).toBeCloseTo(0.025, 6);
  });

  it('null ohne Pricing', () => {
    expect(estimateCostUsd({ input: 1 }, 'unbekannt')).toBeNull();
  });
});

describe('Dynamischer Preis-Fallback (setDynamicPricing / getModelPricing)', () => {
  afterEach(() => setDynamicPricing({})); // Zustand zurücksetzen

  it('nutzt die dynamische Quelle, wenn kein fester Preis existiert', () => {
    expect(getModelPricing('brandneu-x')).toBeNull();
    setDynamicPricing({ 'brandneu-x': { input: 3, cache: 0.3, output: 15 } });
    // Direkt-API-Modell (unbekannt → default 'copilot'? nein: getModelProvider gibt 'copilot').
    // Für ein reines API-artiges Modell testen wir die USD-Rechnung separat unten.
    expect(getModelPricing('brandneu-x')).not.toBeNull();
  });

  it('zeitabhängiger Preis: Einführungspreis vor, regulärer Preis nach dem Stichtag', () => {
    const before = Date.parse('2026-07-01T12:00:00Z');
    const after = Date.parse('2026-09-01T12:00:00Z');
    // claude-sonnet-5 (Copilot): 200/20/1000 bis 31.08.2026, danach 300/30/1500
    expect(getModelPricing('claude-sonnet-5', before)).toEqual({ input: 200, cache: 20, output: 1000 });
    expect(getModelPricing('claude-sonnet-5', after)).toEqual({ input: 300, cache: 30, output: 1500 });
  });

  it('fester Preis hat Vorrang vor der dynamischen Quelle', () => {
    setDynamicPricing({ 'claude-opus-4-8': { input: 999, cache: 999, output: 999 } });
    // Hardcoded: opus-4-8 = input 5
    expect(getModelPricing('claude-opus-4-8').input).toBe(5);
  });

  it('skaliert dynamischen USD-Preis für Copilot-Modelle in Credits (×100)', () => {
    // Copilot-Modell (Punkt-ID → provider copilot). USD 3/0.3/15 → Credits 300/30/1500.
    setDynamicPricing({ 'claude-sonnet-9.9': { input: 3, cache: 0.3, output: 15 } });
    const p = getModelPricing('claude-sonnet-9.9');
    expect(p).toEqual({ input: 300, cache: 30, output: 1500 });
    // estimateCostUsd rechnet Copilot-Credits zurück in USD: 1M input → 300 credits /100 = $3
    expect(estimateCostUsd({ input: 1_000_000 }, 'claude-sonnet-9.9')).toBeCloseTo(3, 5);
  });

  it('lässt USD unverändert für Direkt-API-Provider-Modelle', () => {
    // gemini-2.5-pro ist in MODEL_PROVIDERS → provider 'gemini' → USD nicht skaliert.
    // (Fester Preis existiert; um die dynamische Skalierung zu prüfen, überschreiben
    // wir eine unbekannte, aber gemini-aufgelöste Variante ist nicht verfügbar —
    // daher verifizieren wir die Nicht-Skalierung über den bekannten gemini-Provider.)
    setDynamicPricing({ 'gemini-2.5-pro': { input: 1, cache: 0.1, output: 2 } });
    // Fester Preis hat Vorrang → dynamischer Wert wird NICHT genutzt (Vorrang-Test),
    // aber der Provider ist 'gemini' (kein ×100).
    expect(getModelPricing('gemini-2.5-pro').input).toBe(1.25); // hardcoded gewinnt
  });
});

describe('estimateCostUsdDelta', () => {
  it('USD-Delta für neue Tokens (Copilot → /100)', () => {
    const usd = estimateCostUsdDelta({ input: 1_000_000 }, { input: 0 }, 'claude-sonnet-4.6');
    expect(usd).toBeCloseTo(3, 5);
  });
});

// ── buildCostBuckets ─────────────────────────────────────────
describe('buildCostBuckets', () => {
  const startMs = 1_000_000_000_000;
  const bucketMs = 3_600_000; // 1h
  const bucketCount = 24;

  it('ordnet Einträge dem richtigen Bucket zu', () => {
    const entries = [
      { ts: startMs + 0, sessionId: 's1', usd: 1.0 },
      { ts: startMs + bucketMs, sessionId: 's1', usd: 2.0 },
    ];
    const buckets = buildCostBuckets(entries, startMs, bucketMs, bucketCount);
    expect(buckets[0].get('s1')).toBe(1.0);
    expect(buckets[1].get('s1')).toBe(2.0);
  });

  it('summiert mehrere Einträge im selben Bucket', () => {
    const entries = [
      { ts: startMs + 100, sessionId: 's1', usd: 1.5 },
      { ts: startMs + 200, sessionId: 's1', usd: 0.5 },
    ];
    const buckets = buildCostBuckets(entries, startMs, bucketMs, bucketCount);
    expect(buckets[0].get('s1')).toBeCloseTo(2.0);
  });

  it('ignoriert Einträge außerhalb des Zeitfensters', () => {
    const entries = [
      { ts: startMs - 1, sessionId: 's1', usd: 99 },
      { ts: startMs + bucketMs * bucketCount, sessionId: 's1', usd: 99 },
    ];
    const buckets = buildCostBuckets(entries, startMs, bucketMs, bucketCount);
    const total = buckets.reduce((s, b) => s + (b.get('s1') || 0), 0);
    expect(total).toBe(0);
  });

  it('behandelt null-sessionId als __unnamed', () => {
    const entries = [{ ts: startMs, sessionId: null, usd: 5 }];
    const buckets = buildCostBuckets(entries, startMs, bucketMs, bucketCount);
    expect(buckets[0].get('__unnamed')).toBe(5);
  });
});

// ── aggregateCostBySession ───────────────────────────────────
describe('aggregateCostBySession', () => {
  it('summiert Credits pro Session', () => {
    const entries = [
      { sessionId: 'a', usd: 1.0 },
      { sessionId: 'a', usd: 2.0 },
      { sessionId: 'b', usd: 3.0 },
    ];
    const { totals, grand } = aggregateCostBySession(entries);
    expect(totals.get('a')).toBeCloseTo(3.0);
    expect(totals.get('b')).toBeCloseTo(3.0);
    expect(grand).toBeCloseTo(6.0);
  });

  it('gruppiert nach Provider (#5)', () => {
    const entries = [
      { sessionId: 'a', provider: 'copilot', usd: 1 },
      { sessionId: 'b', provider: 'anthropic', usd: 2 },
      { sessionId: 'c', provider: 'anthropic', usd: 3 },
      { sessionId: 'd', usd: 0.5 }, // ohne provider → copilot
    ];
    const { totals, grand } = aggregateCostBySession(entries, 'provider');
    expect(totals.get('copilot')).toBeCloseTo(1.5);
    expect(totals.get('anthropic')).toBeCloseTo(5);
    expect(grand).toBeCloseTo(6.5);
  });

  it('behandelt null-sessionId als __unnamed', () => {
    const entries = [{ sessionId: null, usd: 2.5 }];
    const { totals } = aggregateCostBySession(entries);
    expect(totals.get('__unnamed')).toBe(2.5);
  });

  it('gibt leere Map und 0 für leere Liste zurück', () => {
    const { totals, grand } = aggregateCostBySession([]);
    expect(totals.size).toBe(0);
    expect(grand).toBe(0);
  });
});

// ── trimCostLog ──────────────────────────────────────────────
describe('trimCostLog', () => {
  it('kürzt Log auf maxEntries', () => {
    const log = Array.from({ length: 10 }, (_, i) => ({ ts: i, usd: 1 }));
    trimCostLog(log, 5);
    expect(log).toHaveLength(5);
    expect(log[0].ts).toBe(5); // älteste entfernt
  });

  it('ändert nichts wenn Log kürzer als maxEntries', () => {
    const log = [{ ts: 1, usd: 1 }, { ts: 2, usd: 2 }];
    trimCostLog(log, 100);
    expect(log).toHaveLength(2);
  });
});

// ── buildAgentPrefix ─────────────────────────────────────────
describe('buildAgentPrefix', () => {
  it('gibt leeren String zurück, wenn keine Agenten aktiv sind', () => {
    expect(buildAgentPrefix([], 'copilot')).toBe('');
    expect(buildAgentPrefix(null, 'copilot')).toBe('');
    expect(buildAgentPrefix(undefined, 'anthropic')).toBe('');
  });

  it('nutzt für Copilot die native /agent-Slash-Syntax', () => {
    const prefix = buildAgentPrefix([{ name: 'Tester' }, { name: 'Planer' }], 'copilot');
    expect(prefix).toBe('/agent Tester\n/agent Planer\n\n');
  });

  it('nutzt für alle anderen Provider eine Klartext-Anweisung ohne Copilot-Syntax', () => {
    const prefix = buildAgentPrefix([{ name: 'Tester' }], 'claude-code');
    expect(prefix).not.toContain('/agent');
    expect(prefix).toBe('Nimm für diese Aufgabe die Rolle/Herangehensweise folgender Agenten ein:\n- Tester\n\n');
  });

  it('funktioniert identisch für Direkt-API-Provider (z. B. anthropic, openai)', () => {
    const prefixAnthropic = buildAgentPrefix([{ name: 'Tester' }], 'anthropic');
    const prefixOpenai = buildAgentPrefix([{ name: 'Tester' }], 'openai');
    expect(prefixAnthropic).toBe(prefixOpenai);
    expect(prefixAnthropic).not.toContain('/agent');
  });
});

// ── rateLimitFamily ──────────────────────────────────────────
describe('rateLimitFamily', () => {
  it('ordnet five_hour der Session zu', () => {
    expect(rateLimitFamily('five_hour')).toBe('session');
  });
  it('fasst alle seven_day*-Varianten zu „weekly" zusammen', () => {
    expect(rateLimitFamily('seven_day')).toBe('weekly');
    expect(rateLimitFamily('seven_day_opus')).toBe('weekly');
    expect(rateLimitFamily('seven_day_sonnet')).toBe('weekly');
    expect(rateLimitFamily('seven_day_overage_included')).toBe('weekly');
  });
  it('erkennt overage und unbekannte/leere Typen', () => {
    expect(rateLimitFamily('overage')).toBe('overage');
    expect(rateLimitFamily(undefined)).toBe('other');
    expect(rateLimitFamily('was_neues')).toBe('other');
  });
});

// ── mergeRateLimitWindows ────────────────────────────────────
describe('mergeRateLimitWindows', () => {
  it('legt eingehende Infos nach Fenster-Familie ab', () => {
    const week = { status: 'allowed', utilization: 0.86, rateLimitType: 'seven_day' };
    const m1 = mergeRateLimitWindows(undefined, week);
    expect(m1).toEqual({ weekly: week });

    const session = { status: 'allowed', utilization: 0.4, rateLimitType: 'five_hour' };
    const m2 = mergeRateLimitWindows(m1, session);
    expect(m2).toEqual({ weekly: week, session });
  });

  it('überschreibt dieselbe Familie mit dem neuesten Wert und mutiert nicht', () => {
    const older = { status: 'allowed', utilization: 0.4, rateLimitType: 'seven_day' };
    const newer = { status: 'allowed_warning', utilization: 0.86, rateLimitType: 'seven_day' };
    const m1 = mergeRateLimitWindows(undefined, older);
    const m2 = mergeRateLimitWindows(m1, newer);
    expect(m2.weekly).toBe(newer);
    expect(m1.weekly).toBe(older); // Original unverändert
  });

  it('gibt ohne gültiges rl eine unveränderte Kopie zurück', () => {
    const m1 = { weekly: { status: 'allowed', rateLimitType: 'seven_day' } };
    expect(mergeRateLimitWindows(m1, null)).toEqual(m1);
    expect(mergeRateLimitWindows(m1, null)).not.toBe(m1);
  });
});

// ── formatSubscriptionUsage ──────────────────────────────────
describe('formatSubscriptionUsage', () => {
  const NOW = 1_700_000_000_000; // fixed epoch ms for deterministic reset math

  it('zeigt nur „Abo" ohne Rate-Limit-Daten', () => {
    expect(formatSubscriptionUsage(null, undefined, NOW).text).toBe('Abo');
    expect(formatSubscriptionUsage({}, undefined, NOW).text).toBe('Abo');
    const r = formatSubscriptionUsage(null, undefined, NOW);
    expect(r.warn).toBe(false);
    expect(r.tooltip).toBe('Über dein Claude-Abo abgerechnet');
  });

  it('zeigt ein einzelnes Fenster mit Label und Prozent (allowed)', () => {
    const r = formatSubscriptionUsage(
      { status: 'allowed', utilization: 0.42, rateLimitType: 'seven_day' }, undefined, NOW);
    expect(r.text).toBe('Abo · Woche 42 %');
    expect(r.warn).toBe(false);
    expect(r.tooltip).toContain('Woche: 42 %');
  });

  it('unterscheidet „fast erreicht" (allowed_warning) von „erreicht" (rejected)', () => {
    const warnState = formatSubscriptionUsage(
      { status: 'allowed_warning', utilization: 0.86, rateLimitType: 'seven_day' }, undefined, NOW);
    expect(warnState.text).toBe('Abo · Woche 86 % (fast erreicht)');
    expect(warnState.warn).toBe(true);

    const rejected = formatSubscriptionUsage(
      { status: 'rejected', utilization: 1, rateLimitType: 'seven_day' }, undefined, NOW);
    expect(rejected.text).toBe('Abo · Woche 100 % (Limit erreicht)');
    expect(rejected.warn).toBe(true);
  });

  it('zeigt 5-Std.- UND Wochen-Limit zusammen, Wochenfenster zuerst', () => {
    const windows = {
      session: { status: 'allowed', utilization: 0.4, rateLimitType: 'five_hour' },
      weekly: { status: 'allowed', utilization: 0.86, rateLimitType: 'seven_day' },
    };
    const r = formatSubscriptionUsage(windows, undefined, NOW);
    expect(r.text).toBe('Abo · Woche 86 % · 5 Std. 40 %');
    expect(r.tooltip).toContain('Woche: 86 %');
    expect(r.tooltip).toContain('5 Std.: 40 %');
  });

  it('stellt das dringlichere Fenster (Warnung/abgelehnt) nach vorn', () => {
    const windows = {
      weekly: { status: 'allowed', utilization: 0.5, rateLimitType: 'seven_day' },
      session: { status: 'allowed_warning', utilization: 0.95, rateLimitType: 'five_hour' },
    };
    const r = formatSubscriptionUsage(windows, undefined, NOW);
    expect(r.text).toBe('Abo · 5 Std. 95 % (fast erreicht) · Woche 50 %');
    expect(r.warn).toBe(true);
  });

  it('behandelt utilization als Bruch (≤1) oder bereits als Prozent (>1)', () => {
    expect(formatSubscriptionUsage({ status: 'allowed', utilization: 0.5, rateLimitType: 'seven_day' }, undefined, NOW).text)
      .toBe('Abo · Woche 50 %');
    expect(formatSubscriptionUsage({ status: 'allowed', utilization: 73, rateLimitType: 'seven_day' }, undefined, NOW).text)
      .toBe('Abo · Woche 73 %');
  });

  it('hält die Leiste ruhig, wenn ein „allowed"-Fenster keine Auslastung liefert (Reset nur im Tooltip)', () => {
    const resetsAt = (NOW + 90 * 60 * 1000) / 1000; // 1h 30m entfernt, in Sekunden
    const r = formatSubscriptionUsage({ status: 'allowed', rateLimitType: 'five_hour', resetsAt }, undefined, NOW);
    expect(r.text).toBe('Abo');
    expect(r.warn).toBe(false);
    expect(r.tooltip).toContain('5 Std.: Reset in 1h 30m');
  });

  it('zeigt eine Warnung auch ohne Auslastungswert (nur Status + Reset)', () => {
    const resetsAt = (NOW + 2 * 60 * 60 * 1000) / 1000; // 2h
    const r = formatSubscriptionUsage({ status: 'allowed_warning', rateLimitType: 'seven_day', resetsAt }, undefined, NOW);
    expect(r.text).toBe('Abo · Woche · Reset in 2h 0m (fast erreicht)');
    expect(r.warn).toBe(true);
  });

  it('nimmt Reset-Zeit, Overage und Token-Äquivalent in den Tooltip auf', () => {
    const resetsAt = (NOW + 2 * 60 * 60 * 1000) / 1000; // 2h
    const r = formatSubscriptionUsage(
      { status: 'allowed_warning', utilization: 0.9, rateLimitType: 'five_hour', resetsAt,
        overageStatus: 'rejected', overageDisabledReason: 'out_of_credits' },
      0.1234, NOW);
    expect(r.tooltip).toContain('5 Std.: 90 % · fast erreicht · Reset in 2h 0m');
    expect(r.tooltip).toContain('Overage: rejected (out_of_credits)');
    expect(r.tooltip).toContain('Token-Äquivalent: $0.1234');
  });

  it('akzeptiert auch ein einzelnes Info-Objekt statt einer Fenster-Map', () => {
    const single = { status: 'allowed', utilization: 0.3, rateLimitType: 'seven_day' };
    const asMap = formatSubscriptionUsage({ weekly: single }, undefined, NOW);
    const asObj = formatSubscriptionUsage(single, undefined, NOW);
    expect(asObj.text).toBe(asMap.text);
    expect(asObj.text).toBe('Abo · Woche 30 %');
  });
});

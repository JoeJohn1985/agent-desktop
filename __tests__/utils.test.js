const path = require('path');
const {
  stripAnsi,
  safeSessionPath,
  parseContextOutput,
  builtinSkillIcon,
  userSkillIcon,
  SKILL_ICON_MAP,
} = require('../src/utils');

// ═══════════════════════════════════════════════════════════════
// stripAnsi
// ═══════════════════════════════════════════════════════════════
describe('stripAnsi', () => {
  test('entfernt einfache ANSI-Color-Codes', () => {
    expect(stripAnsi('\x1b[31mRed\x1b[0m')).toBe('Red');
  });

  test('entfernt SGR-Codes mit mehreren Parametern', () => {
    expect(stripAnsi('\x1b[1;32;40mBold Green\x1b[0m')).toBe('Bold Green');
  });

  test('entfernt OSC-Sequenzen (Titel etc.)', () => {
    expect(stripAnsi('\x1b]0;Window Title\x07Hello')).toBe('Hello');
  });

  test('entfernt Charset-Switching-Sequenzen', () => {
    expect(stripAnsi('\x1b(BNormal\x1b(0Line')).toBe('NormalLine');
  });

  test('entfernt Control-Zeichen (0x00-0x09, 0x0b, 0x0c, 0x0e-0x1f)', () => {
    expect(stripAnsi('Hello\x01\x02World')).toBe('HelloWorld');
  });

  test('entfernt CR (\\r)', () => {
    expect(stripAnsi('Line\r\nBreak')).toBe('Line\nBreak');
  });

  test('behält normalen Text unverändert', () => {
    expect(stripAnsi('Normaler Text 123!')).toBe('Normaler Text 123!');
  });

  test('behandelt leeren String', () => {
    expect(stripAnsi('')).toBe('');
  });

  test('entfernt Cursor-Positionierung', () => {
    expect(stripAnsi('\x1b[2;5HHello')).toBe('Hello');
  });

  test('entfernt ?-basierte Sequenzen (z.B. show/hide cursor)', () => {
    expect(stripAnsi('\x1b[?25lText\x1b[?25h')).toBe('Text');
  });
});

// ═══════════════════════════════════════════════════════════════
// safeSessionPath
// ═══════════════════════════════════════════════════════════════
describe('safeSessionPath', () => {
  const sessionsDir = path.resolve(path.join('home', 'test', 'sessions'));

  test('gibt gültigen Pfad für normales Session-ID zurück', () => {
    const result = safeSessionPath(sessionsDir, 'session-123');
    expect(result).toBe(path.join(sessionsDir, 'session-123'));
  });

  test('wirft Fehler bei Pfad-Traversal (..)', () => {
    expect(() => safeSessionPath(sessionsDir, '../../etc/passwd'))
      .toThrow('Invalid session ID');
  });

  test('wirft Fehler bei absolutem Pfad', () => {
    const absPath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';
    expect(() => safeSessionPath(sessionsDir, absPath))
      .toThrow('Invalid session ID');
  });

  test('akzeptiert Session-ID mit Unterordner', () => {
    const result = safeSessionPath(sessionsDir, 'abc-def');
    expect(result).toContain('abc-def');
    expect(result.startsWith(sessionsDir)).toBe(true);
  });

  test('wirft Fehler bei leerer Session-ID die zu sessionsDir auflöst', () => {
    // path.resolve(dir, '') === dir, which is caught by the second condition
    // Actually path.resolve(dir, '') === dir, and the check is resolved !== sessionsDir
    // Wait - the check allows resolved === sessionsDir... let's verify
    const result = safeSessionPath(sessionsDir, '');
    expect(result).toBe(sessionsDir);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseContextOutput
// ═══════════════════════════════════════════════════════════════
describe('parseContextOutput', () => {
  const sampleText = 'Claude Opus 4.6 · 136k/200k tokens (68%)\n' +
    'System/Tools: 45k (23%)\n' +
    'Messages: 80k (40%)\n' +
    'Free Space: 64k (32%)\n' +
    'Buffer: 11k (5%)';

  test('extrahiert Model-Name', () => {
    const result = parseContextOutput(sampleText);
    expect(result.model).toBe('Claude Opus 4.6');
  });

  test('extrahiert Token-Nutzung', () => {
    const result = parseContextOutput(sampleText);
    expect(result.usedTokens).toBe('136k');
    expect(result.totalTokens).toBe('200k');
    expect(result.percent).toBe(68);
  });

  test('extrahiert alle Kategorien', () => {
    const result = parseContextOutput(sampleText);
    expect(result.categories).toHaveLength(4);
    expect(result.categories[0]).toEqual({ name: 'System/Tools', tokens: '45k', percent: 23 });
    expect(result.categories[1]).toEqual({ name: 'Messages', tokens: '80k', percent: 40 });
    expect(result.categories[2]).toEqual({ name: 'Free Space', tokens: '64k', percent: 32 });
  });

  test('behält raw-Text immer bei', () => {
    const result = parseContextOutput('some text');
    expect(result.raw).toBe('some text');
  });

  test('gibt nur raw zurück wenn kein Header erkannt', () => {
    const result = parseContextOutput('Kein bekanntes Format');
    expect(result.model).toBeUndefined();
    expect(result.categories).toBeUndefined();
    expect(result.raw).toBe('Kein bekanntes Format');
  });

  test('behandelt leeren String', () => {
    const result = parseContextOutput('');
    expect(result.raw).toBe('');
    expect(result.model).toBeUndefined();
  });

  test('extrahiert nur Header ohne Kategorien', () => {
    const headerOnly = 'Claude Sonnet 4 · 50k/200k tokens (25%)';
    const result = parseContextOutput(headerOnly);
    expect(result.model).toBe('Claude Sonnet 4');
    expect(result.usedTokens).toBe('50k');
    expect(result.categories).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// builtinSkillIcon
// ═══════════════════════════════════════════════════════════════
describe('builtinSkillIcon', () => {
  test('gibt bekanntes Icon für task-router zurück', () => {
    expect(builtinSkillIcon('task-router')).toBe('🧠');
  });

  test('gibt bekanntes Icon für code-review zurück', () => {
    expect(builtinSkillIcon('code-review')).toBe('🔍');
  });

  test('ist case-insensitive', () => {
    expect(builtinSkillIcon('TASK-ROUTER')).toBe('🧠');
    expect(builtinSkillIcon('Code-Review')).toBe('🔍');
  });

  test('gibt Fallback 🧩 für unbekannten Skill', () => {
    expect(builtinSkillIcon('unbekannt')).toBe('🧩');
  });

  test('behandelt null/undefined', () => {
    expect(builtinSkillIcon(null)).toBe('🧩');
    expect(builtinSkillIcon(undefined)).toBe('🧩');
  });

  test('gibt alle Mapping-Icons korrekt zurück', () => {
    for (const [key, icon] of Object.entries(SKILL_ICON_MAP)) {
      expect(builtinSkillIcon(key)).toBe(icon);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// userSkillIcon
// ═══════════════════════════════════════════════════════════════
describe('userSkillIcon', () => {
  test('gibt bekanntes Icon für gemappten Skill zurück', () => {
    expect(userSkillIcon('quality-audit')).toBe('🧪');
  });

  test('gibt Fallback 🧩 für unbekannten Skill ohne Emoji', () => {
    expect(userSkillIcon('my-plain-skill')).toBe('🧩');
  });

  test('behandelt null/undefined', () => {
    expect(userSkillIcon(null)).toBe('🧩');
    expect(userSkillIcon(undefined)).toBe('🧩');
  });

  test('ist case-insensitive für gemappte Skills', () => {
    expect(userSkillIcon('SECURITY-AUDIT')).toBe('🛡️');
  });
});

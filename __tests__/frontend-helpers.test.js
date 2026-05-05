const {
  shortenPath,
  contextColor,
  buildContextCategoryHtml,
} = require('../src/frontend-helpers');

// ── shortenPath ──────────────────────────────────────────────

describe('shortenPath', () => {
  test('gibt leeren String für null zurück', () => {
    expect(shortenPath(null, 'C:\\Users\\Max')).toBe('');
  });

  test('gibt leeren String für undefined zurück', () => {
    expect(shortenPath(undefined, 'C:\\Users\\Max')).toBe('');
  });

  test('gibt leeren String für leeren Input zurück', () => {
    expect(shortenPath('', 'C:\\Users\\Max')).toBe('');
  });

  test('gibt Pfad unverändert zurück wenn kein userHomeDir angegeben', () => {
    expect(shortenPath('C:\\Users\\Max\\Projekte', null)).toBe('C:\\Users\\Max\\Projekte');
    expect(shortenPath('C:\\Users\\Max\\Projekte', undefined)).toBe('C:\\Users\\Max\\Projekte');
    expect(shortenPath('C:\\Users\\Max\\Projekte', '')).toBe('C:\\Users\\Max\\Projekte');
  });

  test('ersetzt Home-Verzeichnis durch ~\\', () => {
    // ~\ replacement + remaining \Projekte\app → ~\\Projekte\app
    expect(shortenPath('C:\\Users\\Max\\Projekte\\app', 'C:\\Users\\Max'))
      .toBe('~\\\\Projekte\\app');
  });

  test('ist Groß-/Kleinschreibung-unabhängig', () => {
    expect(shortenPath('c:\\users\\max\\Projekte', 'C:\\Users\\Max'))
      .toBe('~\\\\Projekte');
  });

  test('behandelt Forward-Slashes im Home-Verzeichnis', () => {
    // Home with / gets regex-escaped to \\, matches backslash path
    expect(shortenPath('C:\\Users\\Max\\Projekte', 'C:/Users/Max'))
      .toBe('~\\\\Projekte');
  });

  test('gibt Pfad ohne Ersetzung zurück wenn Home nicht enthalten', () => {
    expect(shortenPath('D:\\Other\\Path', 'C:\\Users\\Max'))
      .toBe('D:\\Other\\Path');
  });

  test('behandelt gemischte Back- und Forward-Slashes im Home-Verzeichnis', () => {
    // Home with mixed slashes: all get regex-escaped to \\, matching backslash path
    expect(shortenPath('C:\\Users\\Max\\docs', 'C:\\Users/Max'))
      .toBe('~\\\\docs');
  });
});

// ── contextColor ─────────────────────────────────────────────

describe('contextColor', () => {
  test('gibt Rot (#f38ba8) für Prozent > 80 zurück', () => {
    expect(contextColor(81)).toBe('#f38ba8');
    expect(contextColor(95)).toBe('#f38ba8');
  });

  test('gibt Orange (#fab387) für Prozent 61-80 zurück', () => {
    expect(contextColor(61)).toBe('#fab387');
    expect(contextColor(75)).toBe('#fab387');
  });

  test('gibt Grün (#a6e3a1) für Prozent <= 60 zurück', () => {
    expect(contextColor(50)).toBe('#a6e3a1');
    expect(contextColor(30)).toBe('#a6e3a1');
  });

  test('Grenzwert: genau 80 gibt Orange zurück', () => {
    expect(contextColor(80)).toBe('#fab387');
  });

  test('Grenzwert: genau 60 gibt Grün zurück', () => {
    expect(contextColor(60)).toBe('#a6e3a1');
  });

  test('gibt Grün für 0% zurück', () => {
    expect(contextColor(0)).toBe('#a6e3a1');
  });

  test('gibt Rot für 100% zurück', () => {
    expect(contextColor(100)).toBe('#f38ba8');
  });
});

// ── buildContextCategoryHtml ─────────────────────────────────

describe('buildContextCategoryHtml', () => {
  test('gibt leeren String für null zurück', () => {
    expect(buildContextCategoryHtml(null)).toBe('');
  });

  test('gibt leeren String für undefined zurück', () => {
    expect(buildContextCategoryHtml(undefined)).toBe('');
  });

  test('gibt leeren String für leeres Array zurück', () => {
    expect(buildContextCategoryHtml([])).toBe('');
  });

  test('erzeugt korrekte Farbe für Free Space (Grün)', () => {
    const html = buildContextCategoryHtml([{ name: 'Free Space', tokens: 1000, percent: 50 }]);
    expect(html).toContain('#a6e3a1');
  });

  test('erzeugt korrekte Farbe für Messages (Blau)', () => {
    const html = buildContextCategoryHtml([{ name: 'Messages', tokens: 2000, percent: 30 }]);
    expect(html).toContain('#89b4fa');
  });

  test('erzeugt korrekte Farbe für Buffer (Grau)', () => {
    const html = buildContextCategoryHtml([{ name: 'Buffer', tokens: 500, percent: 10 }]);
    expect(html).toContain('#a6adc8');
  });

  test('erzeugt korrekte Farbe für sonstige Kategorien (Pink)', () => {
    const html = buildContextCategoryHtml([{ name: 'System', tokens: 800, percent: 20 }]);
    expect(html).toContain('#f5c2e7');
  });

  test('enthält Prozentwerte in der Ausgabe', () => {
    const html = buildContextCategoryHtml([{ name: 'Test', tokens: 100, percent: 42 }]);
    expect(html).toContain('42%');
  });

  test('enthält Tokenwerte in der Ausgabe', () => {
    const html = buildContextCategoryHtml([{ name: 'Test', tokens: 1234, percent: 25 }]);
    expect(html).toContain('1234');
  });

  test('escaped HTML in Kategorienamen mit injizierter Funktion', () => {
    const spy = jest.fn((s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    buildContextCategoryHtml([{ name: '<script>alert("xss")</script>', tokens: 1, percent: 1 }], spy);
    expect(spy).toHaveBeenCalledWith('<script>alert("xss")</script>');
  });

  test('verwendet Default-Escape wenn keine Funktion übergeben', () => {
    const html = buildContextCategoryHtml([{ name: '<b>Bold</b>', tokens: 10, percent: 5 }]);
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
    expect(html).not.toContain('<b>Bold</b>');
  });

  test('behandelt einzelne Kategorie korrekt', () => {
    const html = buildContextCategoryHtml([{ name: 'Free Space', tokens: 500, percent: 40 }]);
    expect(html).toContain('border-top');
    expect(html).toContain('Free Space');
    expect(html).toContain('500');
    expect(html).toContain('40%');
  });

  test('behandelt mehrere Kategorien korrekt', () => {
    const cats = [
      { name: 'Messages', tokens: 2000, percent: 50 },
      { name: 'Buffer', tokens: 500, percent: 10 },
      { name: 'Free Space', tokens: 1500, percent: 40 },
    ];
    const html = buildContextCategoryHtml(cats);
    expect(html).toContain('Messages');
    expect(html).toContain('Buffer');
    expect(html).toContain('Free Space');
    expect(html).toContain('2000');
    expect(html).toContain('500');
    expect(html).toContain('1500');
  });
});

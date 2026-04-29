const path = require('path');
const fs = require('fs');

jest.mock('fs');

const { processDroppedFile, getShellExceptions, setShellExceptions } = require('../src/file-processing');

// ═══════════════════════════════════════════════════════════════
// processDroppedFile
// ═══════════════════════════════════════════════════════════════
describe('processDroppedFile', () => {
  const cwd = 'C:\\Projects\\myapp';
  const filesDropDir = 'C:\\Projects\\myapp\\Dateien';
  const textExtensions = new Set([
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.xml',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1',
    '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php',
    '.sql', '.csv', '.log', '.gitignore', '.dockerfile', '.properties',
  ]);
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff']);
  const opts = { cwd, filesDropDir, textExtensions, imageExtensions };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('gibt error wenn Datei nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    const result = processDroppedFile('C:\\nope\\file.txt', opts);
    expect(result).toEqual({ type: 'error', message: 'Datei nicht gefunden' });
  });

  test('gibt type:path wenn Datei in CWD liegt', () => {
    fs.existsSync.mockReturnValue(true);
    const filePath = path.join(cwd, 'src', 'index.js');
    const result = processDroppedFile(filePath, opts);
    expect(result).toEqual({ type: 'path', path: filePath });
  });

  test('gibt type:path für Datei in Unterordner von CWD', () => {
    fs.existsSync.mockReturnValue(true);
    const filePath = path.join(cwd, 'deep', 'nested', 'file.py');
    const result = processDroppedFile(filePath, opts);
    expect(result).toEqual({ type: 'path', path: filePath });
  });

  test('kopiert Bild-Datei außerhalb CWD in filesDropDir, gibt type:image', () => {
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    const filePath = 'D:\\Photos\\screenshot.png';
    const result = processDroppedFile(filePath, opts);

    expect(result.type).toBe('image');
    expect(result.path).toBe(path.join(filesDropDir, 'screenshot.png'));
    expect(result.originalPath).toBe(filePath);
    expect(fs.copyFileSync).toHaveBeenCalledWith(filePath, path.join(filesDropDir, 'screenshot.png'));
  });

  test('erstellt filesDropDir wenn nicht vorhanden (für Bilder)', () => {
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    processDroppedFile('D:\\img\\photo.jpg', opts);
    expect(fs.mkdirSync).toHaveBeenCalledWith(filesDropDir, { recursive: true });
  });

  test('erstellt filesDropDir NICHT wenn bereits vorhanden (für Bilder)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.copyFileSync.mockReturnValue(undefined);

    // File is outside CWD but filesDropDir exists
    const filePath = 'D:\\img\\photo.jpg';
    // existsSync: true for filePath, true for filesDropDir
    processDroppedFile(filePath, opts);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  test('liest Text-Datei außerhalb CWD, gibt type:text mit content und lang', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 500 });
    fs.readFileSync.mockReturnValue('console.log("hello");');

    const filePath = 'D:\\code\\app.js';
    const result = processDroppedFile(filePath, opts);

    expect(result).toEqual({
      type: 'text',
      content: 'console.log("hello");',
      filename: 'app.js',
      lang: 'js',
    });
  });

  test('gibt error bei Text-Datei > 100KB', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 150 * 1024 });

    const filePath = 'D:\\code\\huge.py';
    const result = processDroppedFile(filePath, opts);

    expect(result.type).toBe('error');
    expect(result.message).toContain('150 KB');
    expect(result.message).toContain('Max 100 KB');
  });

  test('kopiert unbekannten Dateityp, gibt type:copied', () => {
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    const filePath = 'D:\\data\\archive.zip';
    const result = processDroppedFile(filePath, opts);

    expect(result.type).toBe('copied');
    expect(result.path).toBe(path.join(filesDropDir, 'archive.zip'));
    expect(result.originalPath).toBe(filePath);
  });

  test('erstellt filesDropDir wenn nicht vorhanden (für binäre Dateien)', () => {
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    processDroppedFile('D:\\bin\\app.exe', opts);
    expect(fs.mkdirSync).toHaveBeenCalledWith(filesDropDir, { recursive: true });
  });

  test('erkennt .png, .jpg, .svg als Bilder', () => {
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    for (const ext of ['.png', '.jpg', '.svg']) {
      const result = processDroppedFile(`D:\\img\\file${ext}`, opts);
      expect(result.type).toBe('image');
    }
  });

  test('erkennt .js, .py, .md als Text', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 100 });
    fs.readFileSync.mockReturnValue('content');

    for (const ext of ['.js', '.py', '.md']) {
      const result = processDroppedFile(`D:\\code\\file${ext}`, opts);
      expect(result.type).toBe('text');
      expect(result.lang).toBe(ext.replace('.', ''));
    }
  });

  test('behandelt Extensions case-insensitive (.PNG wird als Bild erkannt)', () => {
    // Extension wird via .toLowerCase() normalisiert
    fs.existsSync.mockImplementation(p => p !== filesDropDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.copyFileSync.mockReturnValue(undefined);

    const result = processDroppedFile('D:\\img\\photo.PNG', opts);
    expect(result.type).toBe('image');
  });

  test('gibt korrekten basename zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 50 });
    fs.readFileSync.mockReturnValue('data');

    const result = processDroppedFile('D:\\deep\\nested\\path\\report.md', opts);
    expect(result.filename).toBe('report.md');
  });

  test('Text-Datei genau 100KB ist noch erlaubt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    fs.readFileSync.mockReturnValue('x'.repeat(100 * 1024));

    const result = processDroppedFile('D:\\code\\exact.txt', opts);
    // 100*1024 is NOT > 100*1024, so it should succeed
    expect(result.type).toBe('text');
  });
});

// ═══════════════════════════════════════════════════════════════
// getShellExceptions
// ═══════════════════════════════════════════════════════════════
describe('getShellExceptions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const instructionsPath = 'C:\\Projects\\copilot-instructions.md';

  test('gibt [] wenn Datei nicht existiert', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(getShellExceptions(instructionsPath)).toEqual([]);
  });

  test('parst Ausnahmen aus Markdown korrekt', () => {
    fs.readFileSync.mockReturnValue(
      '# Heading\n\n' +
      '**Ausnahmen** (diese dürfen ohne Rückfrage ausgeführt werden):\n' +
      '- git status\n' +
      '- npm list\n' +
      '\n' +
      'Bei **allen** anderen Befehlen ist Bestätigung nötig.\n'
    );
    const result = getShellExceptions(instructionsPath);
    expect(result).toEqual(['git status', 'npm list']);
  });

  test('gibt [] wenn kein Ausnahmen-Block vorhanden', () => {
    fs.readFileSync.mockReturnValue('# Heading\n\nKein Ausnahmen-Block hier.\n');
    expect(getShellExceptions(instructionsPath)).toEqual([]);
  });

  test('gibt [] bei leerer Ausnahmen-Liste', () => {
    fs.readFileSync.mockReturnValue(
      '**Ausnahmen** (diese dürfen ohne Rückfrage ausgeführt werden):\n' +
      '\n' +
      'Bei **allen** anderen Befehlen ist Bestätigung nötig.\n'
    );
    expect(getShellExceptions(instructionsPath)).toEqual([]);
  });

  test('gibt mehrere Ausnahmen zurück', () => {
    fs.readFileSync.mockReturnValue(
      '**Ausnahmen** (diese dürfen ohne Rückfrage ausgeführt werden):\n' +
      '- Reine **Lese-Befehle** wie `Get-ChildItem`\n' +
      '- **Git-Status-Abfragen** wie `git status`\n' +
      '- Befehle die ausschließlich **Informationen anzeigen**\n' +
      '\n' +
      'Bei **allen** anderen Befehlen ist Bestätigung nötig.\n'
    );
    const result = getShellExceptions(instructionsPath);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('Lese-Befehle');
    expect(result[1]).toContain('Git-Status-Abfragen');
    expect(result[2]).toContain('Informationen anzeigen');
  });

  test('trimmt Whitespace', () => {
    fs.readFileSync.mockReturnValue(
      '**Ausnahmen** (x):\n' +
      '-   spaced item   \n' +
      '\n' +
      'Bei **allen** anderen.\n'
    );
    const result = getShellExceptions(instructionsPath);
    expect(result[0]).toBe('spaced item');
  });

  test('stoppt beim nächsten ## Heading', () => {
    fs.readFileSync.mockReturnValue(
      '**Ausnahmen** (x):\n' +
      '- item one\n' +
      '\n' +
      '## Nächster Abschnitt\n' +
      '- not an exception\n'
    );
    const result = getShellExceptions(instructionsPath);
    expect(result).toEqual(['item one']);
  });

  test('gibt [] bei readFileSync Fehler zurück', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('Permission denied'); });
    expect(getShellExceptions(instructionsPath)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// setShellExceptions
// ═══════════════════════════════════════════════════════════════
describe('setShellExceptions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const instructionsPath = 'C:\\Projects\\copilot-instructions.md';

  const sampleMarkdown =
    '# Heading\n\n' +
    '**Ausnahmen** (diese dürfen ohne Rückfrage ausgeführt werden):\n' +
    '- git status\n' +
    '- npm list\n' +
    '\n' +
    'Bei **allen** anderen Befehlen ist Bestätigung nötig.\n';

  test('ersetzt bestehende Ausnahmen im Markdown', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockReturnValue(undefined);

    setShellExceptions(instructionsPath, ['new command', 'another one']);

    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).toContain('- new command');
    expect(written).toContain('- another one');
    expect(written).not.toContain('- git status');
    expect(written).not.toContain('- npm list');
  });

  test('schreibt Datei zurück mit writeFileSync', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockReturnValue(undefined);

    setShellExceptions(instructionsPath, ['test']);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      instructionsPath,
      expect.any(String),
      'utf-8'
    );
  });

  test('gibt true bei Erfolg', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockReturnValue(undefined);

    const result = setShellExceptions(instructionsPath, ['test']);
    expect(result).toBe(true);
  });

  test('gibt false bei readFileSync Fehler', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = setShellExceptions(instructionsPath, ['test']);
    expect(result).toBe(false);
  });

  test('gibt false bei writeFileSync Fehler', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    const result = setShellExceptions(instructionsPath, ['test']);
    expect(result).toBe(false);
  });

  test('formatiert Ausnahmen als Markdown-Liste', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockReturnValue(undefined);

    setShellExceptions(instructionsPath, ['alpha', 'beta', 'gamma']);

    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).toContain('- alpha\n- beta\n- gamma');
  });

  test('behält restlichen Markdown-Inhalt bei', () => {
    fs.readFileSync.mockReturnValue(sampleMarkdown);
    fs.writeFileSync.mockReturnValue(undefined);

    setShellExceptions(instructionsPath, ['new']);

    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).toContain('# Heading');
    expect(written).toContain('Bei **allen** anderen Befehlen ist Bestätigung nötig.');
  });
});

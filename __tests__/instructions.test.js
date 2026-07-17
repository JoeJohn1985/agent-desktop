/**
 * Tests für src/instructions.js — Instructions-Scanner-Funktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { scanInstructionsDirectory, readInstructionsContent, readAllInstructions } = require('../src/instructions');

const INSTRUCTIONS_DIR = path.join('C:', 'test', 'userData', '.agent-desktop', 'anthropic', 'instructions');

// Einfacher yamlParse-Mock
const yamlParse = jest.fn();

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.readdirSync.mockReset();
  fs.statSync.mockReset();
  yamlParse.mockReset();
});

// ══════════════════════════════════════════════════════════════
// scanInstructionsDirectory
// ══════════════════════════════════════════════════════════════

describe('scanInstructionsDirectory', () => {

  test('gibt [] zurück wenn Verzeichnis nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse)).toEqual([]);
  });

  test('gibt [] zurück wenn Verzeichnis leer ist', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    expect(scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse)).toEqual([]);
  });

  test('ignoriert Dateien ohne .instructions.md Endung', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['readme.md', 'notes.txt', 'foo.agent.md']);
    expect(scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse)).toEqual([]);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('gibt korrektes Objekt {id, fileSlug, name, description} zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['german.instructions.md']);
    fs.readFileSync.mockReturnValue('---\nname: Deutsch\ndescription: Immer Deutsch antworten\n---\n\nAntworte immer auf Deutsch.');
    yamlParse.mockReturnValue({ name: 'Deutsch', description: 'Immer Deutsch antworten' });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toEqual([
      { id: 'Deutsch', fileSlug: 'german', name: 'Deutsch', description: 'Immer Deutsch antworten' },
    ]);
  });

  test('verwendet Dateiname als Fallback wenn name fehlt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['fallback.instructions.md']);
    fs.readFileSync.mockReturnValue('---\ndescription: Kein Name\n---\n');
    yamlParse.mockReturnValue({ description: 'Kein Name' });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result[0].id).toBe('fallback');
    expect(result[0].name).toBe('fallback');
  });

  test('verwendet leeren String als Fallback wenn description fehlt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['nodesc.instructions.md']);
    fs.readFileSync.mockReturnValue('---\nname: NoDesc\n---\n');
    yamlParse.mockReturnValue({ name: 'NoDesc' });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result[0].description).toBe('');
  });

  test('ignoriert Dateien ohne Frontmatter', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['no-frontmatter.instructions.md']);
    fs.readFileSync.mockReturnValue('# Just markdown\n\nKein Frontmatter hier.');

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toEqual([]);
    expect(yamlParse).not.toHaveBeenCalled();
  });

  test('entfernt BOM (\\uFEFF) am Dateianfang', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['bom.instructions.md']);
    fs.readFileSync.mockReturnValue('\uFEFF---\nname: BomInstr\ndescription: BOM test\n---\n');
    yamlParse.mockReturnValue({ name: 'BomInstr', description: 'BOM test' });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('BomInstr');
  });

  test('unterstützt Windows-Zeilenumbrüche (\\r\\n) in Frontmatter', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['win.instructions.md']);
    fs.readFileSync.mockReturnValue('---\r\nname: WinInstr\r\ndescription: Windows\r\n---\r\nContent');
    yamlParse.mockReturnValue({ name: 'WinInstr', description: 'Windows' });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('WinInstr');
  });

  test('verarbeitet mehrere Instructions-Dateien korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['a.instructions.md', 'b.instructions.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      return `---\nname: Instr${readCount}\n---\n`;
    });
    let parseCount = 0;
    yamlParse.mockImplementation(() => {
      parseCount++;
      return { name: `Instr${parseCount}` };
    });

    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Instr1');
    expect(result[1].name).toBe('Instr2');
  });

  test('fängt Parse-Fehler und fährt mit nächster Datei fort', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['broken.instructions.md', 'good.instructions.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      return `---\nname: file${readCount}\n---\n`;
    });
    let parseCount = 0;
    yamlParse.mockImplementation(() => {
      parseCount++;
      if (parseCount === 1) throw new Error('Invalid YAML');
      return { name: 'GoodInstr' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('GoodInstr');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('fängt Lesefehler (EACCES) und fährt fort', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['denied.instructions.md', 'ok.instructions.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      if (readCount === 1) throw new Error('EACCES: permission denied');
      return '---\nname: OK\n---\n';
    });
    yamlParse.mockReturnValue({ name: 'OK' });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('OK');
    warnSpy.mockRestore();
  });

  test('liest Dateien mit utf-8 Encoding', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['test.instructions.md']);
    fs.readFileSync.mockReturnValue('---\nname: Test\n---\n');
    yamlParse.mockReturnValue({ name: 'Test' });

    scanInstructionsDirectory(INSTRUCTIONS_DIR, yamlParse);
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join(INSTRUCTIONS_DIR, 'test.instructions.md'),
      'utf-8',
    );
  });
});

// ══════════════════════════════════════════════════════════════
// readInstructionsContent
// ══════════════════════════════════════════════════════════════

describe('readInstructionsContent', () => {
  const FILE = path.join(INSTRUCTIONS_DIR, 'tone.instructions.md');

  test('gibt den Body ohne Frontmatter zurück, getrimmt', () => {
    fs.statSync.mockReturnValue({ isFile: () => true, size: 100 });
    fs.readFileSync.mockReturnValue('---\nname: tone\ndescription: x\n---\n\nSei kurz und direkt.\n');

    expect(readInstructionsContent(FILE)).toBe('Sei kurz und direkt.');
  });

  test('gibt "" zurück wenn die Datei nicht existiert (statSync wirft)', () => {
    fs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readInstructionsContent(FILE)).toBe('');
  });

  test('gibt "" zurück wenn der Pfad kein File ist (z.B. ein Verzeichnis)', () => {
    fs.statSync.mockReturnValue({ isFile: () => false, size: 0 });
    expect(readInstructionsContent(FILE)).toBe('');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('gibt "" zurück wenn die Datei die Größenobergrenze überschreitet', () => {
    fs.statSync.mockReturnValue({ isFile: () => true, size: 64 * 1024 + 1 });
    expect(readInstructionsContent(FILE)).toBe('');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('entfernt BOM (\\uFEFF) am Dateianfang', () => {
    fs.statSync.mockReturnValue({ isFile: () => true, size: 100 });
    fs.readFileSync.mockReturnValue('\uFEFF---\nname: x\n---\nInhalt');

    expect(readInstructionsContent(FILE)).toBe('Inhalt');
  });

  test('gibt den ganzen getrimmten Text zurück, wenn kein Frontmatter vorhanden ist', () => {
    fs.statSync.mockReturnValue({ isFile: () => true, size: 100 });
    fs.readFileSync.mockReturnValue('  Nur Text, kein Frontmatter.  \n');

    expect(readInstructionsContent(FILE)).toBe('Nur Text, kein Frontmatter.');
  });

  test('fängt Lesefehler ab und gibt "" zurück', () => {
    fs.statSync.mockReturnValue({ isFile: () => true, size: 100 });
    fs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });

    expect(readInstructionsContent(FILE)).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════
// readAllInstructions
// ══════════════════════════════════════════════════════════════

describe('readAllInstructions', () => {
  test('liest jede .instructions.md-Datei im Verzeichnis vollständig — keine Aktiv/Inaktiv-Auswahl', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['tone.instructions.md', 'length.instructions.md']);
    fs.statSync.mockReturnValue({ isFile: () => true, size: 100 });
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('tone')) return '---\nname: Tonfall\n---\n\nSei kurz und direkt.';
      return '---\nname: Länge\n---\n\nAntworte in max. 3 Sätzen.';
    });
    yamlParse.mockImplementation((yamlStr) => (yamlStr.includes('Tonfall') ? { name: 'Tonfall' } : { name: 'Länge' }));

    const result = readAllInstructions(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toEqual([
      { name: 'Tonfall', content: 'Sei kurz und direkt.' },
      { name: 'Länge', content: 'Antworte in max. 3 Sätzen.' },
    ]);
  });

  test('gibt [] zurück wenn das Verzeichnis leer/nicht vorhanden ist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readAllInstructions(INSTRUCTIONS_DIR, yamlParse)).toEqual([]);
  });

  test('filtert Dateien ohne lesbaren Inhalt heraus (z.B. zu groß)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['huge.instructions.md', 'ok.instructions.md']);
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('huge')) return '---\nname: Huge\n---\n\nInhalt';
      return '---\nname: Ok\n---\n\nInhalt';
    });
    yamlParse.mockImplementation((yamlStr) => (yamlStr.includes('Huge') ? { name: 'Huge' } : { name: 'Ok' }));
    fs.statSync.mockImplementation((filePath) => ({
      isFile: () => true,
      size: String(filePath).includes('huge') ? 64 * 1024 + 1 : 100,
    }));

    const result = readAllInstructions(INSTRUCTIONS_DIR, yamlParse);
    expect(result).toEqual([{ name: 'Ok', content: 'Inhalt' }]);
  });
});

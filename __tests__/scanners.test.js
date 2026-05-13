/**
 * Tests für src/scanners.js — Scanner- und Config-Funktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { scanSkillDirectory, readFolderConfig, writeFolderConfig } = require('../src/scanners');

const SKILLS_DIR = path.join('C:', 'test', 'skills');
const CONFIG_PATH = path.join('C:', 'test', '.copilot-desktop', 'folders.json');

// Helper: erzeugt Dirent-Objekte
function dirent(name, isDir = true) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

// Einfacher yamlParse-Mock
const yamlParse = jest.fn();

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.readdirSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.mkdirSync.mockReset();
  yamlParse.mockReset();
});

// ══════════════════════════════════════════════════════════════
// scanSkillDirectory
// ══════════════════════════════════════════════════════════════

describe('scanSkillDirectory', () => {
  const iconFn = jest.fn(() => '🧩');

  beforeEach(() => {
    iconFn.mockClear();
  });

  test('gibt [] zurück wenn dir nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).toEqual([]);
  });

  test('gibt [] zurück wenn keine Unterverzeichnisse vorhanden', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).toEqual([]);
  });

  test('ignoriert Verzeichnisse ohne SKILL.md', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      return false; // SKILL.md existiert nicht
    });
    fs.readdirSync.mockReturnValue([dirent('my-skill')]);
    expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).toEqual([]);
  });

  test('parst Frontmatter korrekt', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'code-review', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('code-review')]);
    fs.readFileSync.mockReturnValue('---\nname: code-review\ndescription: Reviews code\nicon: 🔍\n---\n\n# Content');
    yamlParse.mockReturnValue({ name: 'code-review', description: 'Reviews code', icon: '🔍' });

    const result = scanSkillDirectory(SKILLS_DIR, 'builtin', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'code-review',
      dirName: 'code-review',
      name: 'code-review',
      description: 'Reviews code',
      source: 'builtin',
      icon: '🔍',
    });
  });

  test('entfernt BOM (\\uFEFF) am Dateianfang', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('my-skill')]);
    fs.readFileSync.mockReturnValue('\uFEFF---\nname: bom-skill\ndescription: BOM test\n---\n');
    yamlParse.mockReturnValue({ name: 'bom-skill', description: 'BOM test' });

    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bom-skill');
  });

  test('gibt icon aus meta zurück wenn vorhanden', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('my-skill')]);
    fs.readFileSync.mockReturnValue('---\nname: test\nicon: 🚀\n---\n');
    yamlParse.mockReturnValue({ name: 'test', icon: '🚀' });

    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].icon).toBe('🚀');
    expect(iconFn).not.toHaveBeenCalled();
  });

  test('verwendet iconFn als Fallback wenn kein icon in meta', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('my-skill')]);
    fs.readFileSync.mockReturnValue('---\nname: no-icon\ndescription: test\n---\n');
    yamlParse.mockReturnValue({ name: 'no-icon', description: 'test' });
    iconFn.mockReturnValue('🎯');

    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].icon).toBe('🎯');
    expect(iconFn).toHaveBeenCalledWith('no-icon');
  });

  test('fängt Parse-Fehler und fährt fort', () => {
    const skill1Path = path.join(SKILLS_DIR, 'skill-1', 'SKILL.md');
    const skill2Path = path.join(SKILLS_DIR, 'skill-2', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skill1Path || p === skill2Path) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('skill-1'), dirent('skill-2')]);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      if (readCount === 1) return '---\nname: broken\n---\n';
      return '---\nname: good\ndescription: works\n---\n';
    });

    let parseCount = 0;
    yamlParse.mockImplementation(() => {
      parseCount++;
      if (parseCount === 1) throw new Error('Invalid YAML');
      return { name: 'good', description: 'works' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('verarbeitet mehrere Skills korrekt', () => {
    const s1Path = path.join(SKILLS_DIR, 'skill-a', 'SKILL.md');
    const s2Path = path.join(SKILLS_DIR, 'skill-b', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === s1Path || p === s2Path) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('skill-a'), dirent('skill-b')]);
    fs.readFileSync.mockReturnValue('---\nname: x\n---\n');

    let count = 0;
    yamlParse.mockImplementation(() => {
      count++;
      return { name: `skill-${count}`, description: `Desc ${count}` };
    });

    const result = scanSkillDirectory(SKILLS_DIR, 'builtin', iconFn, yamlParse);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('skill-1');
    expect(result[1].name).toBe('skill-2');
  });

  test('verwendet entry.name als Fallback wenn meta.name fehlt', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'fallback-dir', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('fallback-dir')]);
    fs.readFileSync.mockReturnValue('---\ndescription: no name\n---\n');
    yamlParse.mockReturnValue({ description: 'no name' });

    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].id).toBe('fallback-dir');
    expect(result[0].name).toBe('fallback-dir');
    expect(iconFn).toHaveBeenCalledWith('fallback-dir');
  });

  test('ignoriert SKILL.md ohne Frontmatter', () => {
    const skillMdPath = path.join(SKILLS_DIR, 'no-fm', 'SKILL.md');
    fs.existsSync.mockImplementation((p) => {
      if (p === SKILLS_DIR) return true;
      if (p === skillMdPath) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('no-fm')]);
    fs.readFileSync.mockReturnValue('# Just markdown\n\nNo frontmatter here.');

    const result = scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toEqual([]);
    expect(yamlParse).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// readFolderConfig
// ══════════════════════════════════════════════════════════════

describe('readFolderConfig', () => {
  test('gibt {} zurück wenn Datei nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readFolderConfig(CONFIG_PATH)).toEqual({});
  });

  test('parst gültiges JSON korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"copilotDir":"/home/.copilot","cwd":"/home/project"}');
    expect(readFolderConfig(CONFIG_PATH)).toEqual({
      copilotDir: '/home/.copilot',
      cwd: '/home/project',
    });
  });

  test('gibt {} bei ungültigem JSON zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{ broken json !!!');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readFolderConfig(CONFIG_PATH)).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('gibt {} bei Lesefehler zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readFolderConfig(CONFIG_PATH)).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════
// writeFolderConfig
// ══════════════════════════════════════════════════════════════

describe('writeFolderConfig', () => {
  test('schreibt JSON mit 2-Leerzeichen-Einrückung', () => {
    fs.existsSync.mockReturnValue(true);
    const config = { copilotDir: '/test', cwd: '/project' };
    writeFolderConfig(CONFIG_PATH, config);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  });

  test('erstellt Verzeichnis wenn es nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    writeFolderConfig(CONFIG_PATH, { key: 'value' });
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.dirname(CONFIG_PATH),
      { recursive: true }
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('erstellt kein Verzeichnis wenn es bereits existiert', () => {
    fs.existsSync.mockReturnValue(true);
    writeFolderConfig(CONFIG_PATH, {});
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

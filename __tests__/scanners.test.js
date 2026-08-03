/**
 * Tests für src/scanners.js — Scanner- und Config-Funktionen
 *
 * scanSkillDirectory/scanSkillsIndex sind asynchron (fs/promises), damit der
 * Main-Prozess beim Scannen nicht blockiert — deshalb wird hier `fs/promises`
 * gemockt. readFolderConfig/writeFolderConfig sind weiterhin synchron und
 * nutzen den `fs`-Mock.
 */

jest.mock('fs');
jest.mock('fs/promises');

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { scanSkillDirectory, scanSkillsIndex, readFolderConfig, writeFolderConfig } = require('../src/scanners');

const SKILLS_DIR = path.join('C:', 'test', 'skills');
const CONFIG_PATH = path.join('C:', 'test', '.copilot-desktop', 'folders.json');

// Helper: erzeugt Dirent-Objekte
function dirent(name, isDir = true) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

function enoent() {
  const e = new Error('ENOENT: no such file or directory');
  e.code = 'ENOENT';
  return e;
}

/**
 * Baut ein virtuelles Dateisystem für die async-Scanner.
 * @param {Object} tree - '<verzeichnis>': ['eintrag', …] und '<datei>': 'inhalt'.
 *   Alles, was nicht im Baum steht, wirft ENOENT — wie echtes fs.
 */
function mockTree(tree) {
  fsp.readdir.mockImplementation(async (dir, opts) => {
    const names = tree[dir];
    if (!Array.isArray(names)) throw enoent();
    return opts && opts.withFileTypes ? names.map(n => dirent(n)) : names;
  });
  fsp.readFile.mockImplementation(async (file) => {
    const content = tree[file];
    if (typeof content !== 'string') throw enoent();
    return content;
  });
}

// Einfacher yamlParse-Mock
const yamlParse = jest.fn();

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.mkdirSync.mockReset();
  fsp.readdir.mockReset();
  fsp.readFile.mockReset();
  yamlParse.mockReset();
});

// ══════════════════════════════════════════════════════════════
// scanSkillDirectory
// ══════════════════════════════════════════════════════════════

describe('scanSkillDirectory', () => {
  const iconFn = jest.fn(() => 'ICON');

  beforeEach(() => {
    iconFn.mockClear();
    iconFn.mockReturnValue('ICON');
  });

  test('gibt [] zurück wenn dir nicht existiert', async () => {
    mockTree({});
    await expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).resolves.toEqual([]);
  });

  test('gibt [] zurück wenn keine Unterverzeichnisse vorhanden', async () => {
    mockTree({ [SKILLS_DIR]: [] });
    await expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).resolves.toEqual([]);
  });

  test('ignoriert Verzeichnisse ohne SKILL.md', async () => {
    mockTree({ [SKILLS_DIR]: ['my-skill'] }); // SKILL.md fehlt -> ENOENT
    await expect(scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse)).resolves.toEqual([]);
  });

  test('meldet eine fehlende SKILL.md nicht als Fehler', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockTree({ [SKILLS_DIR]: ['leerer-ordner'] });
    await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('parst Frontmatter korrekt', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'code-review', 'SKILL.md');
    mockTree({
      [SKILLS_DIR]: ['code-review'],
      [skillMdPath]: '---\nname: code-review\ndescription: Reviews code\nicon: LUPE\n---\n\n# Content',
    });
    yamlParse.mockReturnValue({ name: 'code-review', description: 'Reviews code', icon: 'LUPE' });

    const result = await scanSkillDirectory(SKILLS_DIR, 'builtin', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'code-review',
      dirName: 'code-review',
      name: 'code-review',
      description: 'Reviews code',
      source: 'builtin',
      icon: 'LUPE',
    });
  });

  test('entfernt BOM am Dateianfang', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    mockTree({
      [SKILLS_DIR]: ['my-skill'],
      [skillMdPath]: '﻿---\nname: bom-skill\ndescription: BOM test\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'bom-skill', description: 'BOM test' });

    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bom-skill');
  });

  test('gibt icon aus meta zurück wenn vorhanden', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    mockTree({ [SKILLS_DIR]: ['my-skill'], [skillMdPath]: '---\nname: test\nicon: RAKETE\n---\n' });
    yamlParse.mockReturnValue({ name: 'test', icon: 'RAKETE' });

    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].icon).toBe('RAKETE');
    expect(iconFn).not.toHaveBeenCalled();
  });

  test('verwendet iconFn als Fallback wenn kein icon in meta', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'my-skill', 'SKILL.md');
    mockTree({ [SKILLS_DIR]: ['my-skill'], [skillMdPath]: '---\nname: no-icon\ndescription: test\n---\n' });
    yamlParse.mockReturnValue({ name: 'no-icon', description: 'test' });
    iconFn.mockReturnValue('ZIEL');

    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].icon).toBe('ZIEL');
    expect(iconFn).toHaveBeenCalledWith('no-icon');
  });

  test('fängt Parse-Fehler und fährt fort', async () => {
    const skill1Path = path.join(SKILLS_DIR, 'skill-1', 'SKILL.md');
    const skill2Path = path.join(SKILLS_DIR, 'skill-2', 'SKILL.md');
    mockTree({
      [SKILLS_DIR]: ['skill-1', 'skill-2'],
      [skill1Path]: '---\nname: broken\n---\n',
      [skill2Path]: '---\nname: good\ndescription: works\n---\n',
    });
    yamlParse.mockImplementation((raw) => {
      if (raw.includes('broken')) throw new Error('Invalid YAML');
      return { name: 'good', description: 'works' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('verarbeitet mehrere Skills korrekt', async () => {
    const s1Path = path.join(SKILLS_DIR, 'skill-a', 'SKILL.md');
    const s2Path = path.join(SKILLS_DIR, 'skill-b', 'SKILL.md');
    mockTree({
      [SKILLS_DIR]: ['skill-a', 'skill-b'],
      [s1Path]: '---\nname: skill-a\n---\n',
      [s2Path]: '---\nname: skill-b\n---\n',
    });
    yamlParse.mockImplementation((raw) => ({ name: raw.match(/name: (\S+)/)[1], description: 'Desc' }));

    const result = await scanSkillDirectory(SKILLS_DIR, 'builtin', iconFn, yamlParse);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name).sort()).toEqual(['skill-a', 'skill-b']);
  });

  test('verwendet entry.name als Fallback wenn meta.name fehlt', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'fallback-dir', 'SKILL.md');
    mockTree({ [SKILLS_DIR]: ['fallback-dir'], [skillMdPath]: '---\ndescription: no name\n---\n' });
    yamlParse.mockReturnValue({ description: 'no name' });

    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result[0].id).toBe('fallback-dir');
    expect(result[0].name).toBe('fallback-dir');
    expect(iconFn).toHaveBeenCalledWith('fallback-dir');
  });

  test('ignoriert SKILL.md ohne Frontmatter', async () => {
    const skillMdPath = path.join(SKILLS_DIR, 'no-fm', 'SKILL.md');
    mockTree({ [SKILLS_DIR]: ['no-fm'], [skillMdPath]: '# Just markdown\n\nNo frontmatter here.' });

    const result = await scanSkillDirectory(SKILLS_DIR, 'user', iconFn, yamlParse);
    expect(result).toEqual([]);
    expect(yamlParse).not.toHaveBeenCalled();
  });

  // ── Projekt-Skills (source='project') ─────────────────────

  test('setzt source="project" korrekt', async () => {
    const projectSkillsDir = path.join('C:', 'myproject', '.agent-desktop', 'skills');
    const skillMdPath = path.join(projectSkillsDir, 'my-skill', 'SKILL.md');
    mockTree({
      [projectSkillsDir]: ['my-skill'],
      [skillMdPath]: '---\nname: my-skill\ndescription: A project skill\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'my-skill', description: 'A project skill' });

    const result = await scanSkillDirectory(projectSkillsDir, 'project', iconFn, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('project');
    expect(result[0].name).toBe('my-skill');
  });

  test('gibt [] zurück wenn das Projekt-Skillverzeichnis fehlt', async () => {
    mockTree({});
    const dir = path.join('C:', 'myproject', '.agent-desktop', 'skills');
    await expect(scanSkillDirectory(dir, 'project', iconFn, yamlParse)).resolves.toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// scanSkillsIndex
// ══════════════════════════════════════════════════════════════

describe('scanSkillsIndex', () => {
  const PROVIDER_DIR = path.join('C:', 'test', 'userData', '.agent-desktop', 'claude-code', 'skills');
  const PROJECT_DIR = path.join('C:', 'myproject', '.agent-desktop', 'skills');

  test('baut Index mit name/description/absolutem Dateipfad, ohne Volltext', async () => {
    const skillMdPath = path.join(PROVIDER_DIR, 'pdf', 'SKILL.md');
    mockTree({
      [PROVIDER_DIR]: ['pdf'],
      [skillMdPath]: '---\nname: pdf\ndescription: PDF-Verarbeitung\n---\n\nVolltext-Anleitung',
    });
    yamlParse.mockReturnValue({ name: 'pdf', description: 'PDF-Verarbeitung' });

    const result = await scanSkillsIndex([PROVIDER_DIR], yamlParse);
    expect(result).toEqual([
      { name: 'pdf', description: 'PDF-Verarbeitung', file: skillMdPath },
    ]);
  });

  test('ignoriert leere/undefined Verzeichnisse', async () => {
    mockTree({});
    await expect(scanSkillsIndex([null, undefined, ''], yamlParse)).resolves.toEqual([]);
  });

  test('dedupliziert nach dirName über mehrere Verzeichnisse, erstes Match gewinnt', async () => {
    const providerSkillMd = path.join(PROVIDER_DIR, 'shared', 'SKILL.md');
    const projectSkillMd = path.join(PROJECT_DIR, 'shared', 'SKILL.md');
    mockTree({
      [PROVIDER_DIR]: ['shared'],
      [PROJECT_DIR]: ['shared'],
      [providerSkillMd]: '---\nname: shared\ndescription: Provider-Version\n---\n',
      [projectSkillMd]: '---\nname: shared\ndescription: Projekt-Version\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'shared', description: 'Provider-Version' });

    const result = await scanSkillsIndex([PROVIDER_DIR, PROJECT_DIR], yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(providerSkillMd);
  });

  test('gibt [] zurück wenn keine Verzeichnisse existieren', async () => {
    mockTree({});
    await expect(scanSkillsIndex([PROVIDER_DIR], yamlParse)).resolves.toEqual([]);
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

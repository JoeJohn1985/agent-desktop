/**
 * Tests für src/agents.js — Agent-Scanner-Funktionen
 *
 * Die Scanner sind asynchron (fs/promises), damit der Main-Prozess beim
 * Scannen nicht blockiert — deshalb wird hier `fs/promises` gemockt.
 */

jest.mock('fs/promises');

const fsp = require('fs/promises');
const path = require('path');
const { scanAgentsDirectory, scanAgentsIndex } = require('../src/agents');

const AGENTS_DIR = path.join('C:', 'Users', 'test', '.copilot', 'agents');
const ROBOT = '\u{1F916}';

function enoent() {
  const e = new Error('ENOENT: no such file or directory');
  e.code = 'ENOENT';
  return e;
}

/**
 * Baut ein virtuelles Dateisystem.
 * @param {Object} tree - '<verzeichnis>': ['datei', …] und '<datei>': 'inhalt'.
 */
function mockTree(tree) {
  fsp.readdir.mockImplementation(async (dir) => {
    const names = tree[dir];
    if (!Array.isArray(names)) throw enoent();
    return names;
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
  fsp.readdir.mockReset();
  fsp.readFile.mockReset();
  yamlParse.mockReset();
});

// ══════════════════════════════════════════════════════════════
// scanAgentsDirectory
// ══════════════════════════════════════════════════════════════

describe('scanAgentsDirectory', () => {

  test('gibt [] zurück wenn Verzeichnis nicht existiert', async () => {
    mockTree({});
    await expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).resolves.toEqual([]);
  });

  test('gibt [] zurück wenn Verzeichnis leer ist', async () => {
    mockTree({ [AGENTS_DIR]: [] });
    await expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).resolves.toEqual([]);
  });

  test('ignoriert Dateien ohne .agent.md Endung', async () => {
    mockTree({ [AGENTS_DIR]: ['readme.md', 'config.json', 'notes.txt'] });
    await expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).resolves.toEqual([]);
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  test('parst name aus YAML-Frontmatter korrekt', async () => {
    mockTree({
      [AGENTS_DIR]: ['code-reviewer.agent.md'],
      [path.join(AGENTS_DIR, 'code-reviewer.agent.md')]: '---\nname: Code Reviewer\ndescription: Reviews code\n---\n\n# Content',
    });
    yamlParse.mockReturnValue({ name: 'Code Reviewer', description: 'Reviews code' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Code Reviewer');
  });

  test('parst description aus YAML-Frontmatter korrekt', async () => {
    mockTree({
      [AGENTS_DIR]: ['helper.agent.md'],
      [path.join(AGENTS_DIR, 'helper.agent.md')]: '---\nname: Helper\ndescription: Hilft bei Aufgaben\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'Helper', description: 'Hilft bei Aufgaben' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].description).toBe('Hilft bei Aufgaben');
  });

  test('gibt korrektes Objekt {id, fileSlug, name, description, icon} zurück', async () => {
    mockTree({
      [AGENTS_DIR]: ['test-agent.agent.md'],
      [path.join(AGENTS_DIR, 'test-agent.agent.md')]: '---\nname: TestAgent\ndescription: Ein Test\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'TestAgent', description: 'Ein Test' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0]).toEqual({
      id: 'TestAgent',
      fileSlug: 'test-agent',
      name: 'TestAgent',
      description: 'Ein Test',
      icon: ROBOT,
    });
  });

  test('icon ist immer das Roboter-Symbol, auch wenn die Datei eins vorgibt', async () => {
    mockTree({
      [AGENTS_DIR]: ['a.agent.md'],
      [path.join(AGENTS_DIR, 'a.agent.md')]: '---\nname: A\nicon: FLAMME\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'A', icon: 'FLAMME' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].icon).toBe(ROBOT);
  });

  test('verwendet Dateiname als Fallback wenn name fehlt', async () => {
    mockTree({
      [AGENTS_DIR]: ['fallback-agent.agent.md'],
      [path.join(AGENTS_DIR, 'fallback-agent.agent.md')]: '---\ndescription: Kein Name\n---\n',
    });
    yamlParse.mockReturnValue({ description: 'Kein Name' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].id).toBe('fallback-agent');
    expect(result[0].name).toBe('fallback-agent');
  });

  test('verwendet leeren String als Fallback wenn description fehlt', async () => {
    mockTree({
      [AGENTS_DIR]: ['nodesc.agent.md'],
      [path.join(AGENTS_DIR, 'nodesc.agent.md')]: '---\nname: NoDesc\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'NoDesc' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].description).toBe('');
  });

  test('entfernt BOM am Dateianfang', async () => {
    mockTree({
      [AGENTS_DIR]: ['bom.agent.md'],
      [path.join(AGENTS_DIR, 'bom.agent.md')]: '﻿---\nname: BomAgent\ndescription: BOM test\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'BomAgent', description: 'BOM test' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('BomAgent');
  });

  test('ignoriert Dateien ohne Frontmatter', async () => {
    mockTree({
      [AGENTS_DIR]: ['no-frontmatter.agent.md'],
      [path.join(AGENTS_DIR, 'no-frontmatter.agent.md')]: '# Just markdown\n\nKein Frontmatter hier.',
    });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toEqual([]);
    expect(yamlParse).not.toHaveBeenCalled();
  });

  test('verarbeitet mehrere Agent-Dateien korrekt', async () => {
    mockTree({
      [AGENTS_DIR]: ['agent-a.agent.md', 'agent-b.agent.md'],
      [path.join(AGENTS_DIR, 'agent-a.agent.md')]: '---\nname: AgentA\ndescription: DescA\n---\n',
      [path.join(AGENTS_DIR, 'agent-b.agent.md')]: '---\nname: AgentB\ndescription: DescB\n---\n',
    });
    yamlParse.mockImplementation((raw) => ({ name: raw.match(/name: (\S+)/)[1], description: 'x' }));

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name).sort()).toEqual(['AgentA', 'AgentB']);
  });

  test('fängt Parse-Fehler und fährt mit nächster Datei fort', async () => {
    mockTree({
      [AGENTS_DIR]: ['broken.agent.md', 'good.agent.md'],
      [path.join(AGENTS_DIR, 'broken.agent.md')]: '---\nname: broken\n---\n',
      [path.join(AGENTS_DIR, 'good.agent.md')]: '---\nname: GoodAgent\n---\n',
    });
    yamlParse.mockImplementation((raw) => {
      if (raw.includes('broken')) throw new Error('Invalid YAML');
      return { name: 'GoodAgent', description: 'works' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('GoodAgent');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('fängt Lesefehler (EACCES) und fährt fort', async () => {
    mockTree({
      [AGENTS_DIR]: ['denied.agent.md', 'ok.agent.md'],
      [path.join(AGENTS_DIR, 'ok.agent.md')]: '---\nname: OK\n---\n',
      // denied.agent.md fehlt im Baum -> Lesen wirft
    });
    yamlParse.mockReturnValue({ name: 'OK' });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('OK');
    warnSpy.mockRestore();
  });

  test('unterstützt Windows-Zeilenumbrüche in Frontmatter', async () => {
    mockTree({
      [AGENTS_DIR]: ['win.agent.md'],
      [path.join(AGENTS_DIR, 'win.agent.md')]: '---\r\nname: WinAgent\r\ndescription: Windows\r\n---\r\nContent',
    });
    yamlParse.mockReturnValue({ name: 'WinAgent', description: 'Windows' });

    const result = await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('WinAgent');
  });

  test('liest Dateien mit utf-8 Encoding', async () => {
    mockTree({
      [AGENTS_DIR]: ['test.agent.md'],
      [path.join(AGENTS_DIR, 'test.agent.md')]: '---\nname: Test\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'Test' });

    await scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(fsp.readFile).toHaveBeenCalledWith(
      path.join(AGENTS_DIR, 'test.agent.md'),
      'utf-8'
    );
  });
});

// ══════════════════════════════════════════════════════════════
// scanAgentsIndex
// ══════════════════════════════════════════════════════════════

describe('scanAgentsIndex', () => {
  const PROVIDER_DIR = path.join('C:', 'test', 'userData', '.agent-desktop', 'claude-code', 'agents');
  const PROJECT_DIR = path.join('C:', 'myproject', '.agent-desktop', 'agents');

  test('baut Index mit name/description/absolutem Dateipfad, ohne Volltext', async () => {
    mockTree({
      [PROVIDER_DIR]: ['planner.agent.md'],
      [path.join(PROVIDER_DIR, 'planner.agent.md')]: '---\nname: planner\ndescription: Plant Aufgaben\n---\n\nVolltext-Anleitung',
    });
    yamlParse.mockReturnValue({ name: 'planner', description: 'Plant Aufgaben' });

    const result = await scanAgentsIndex([PROVIDER_DIR], yamlParse);
    expect(result).toEqual([
      { name: 'planner', description: 'Plant Aufgaben', file: path.join(PROVIDER_DIR, 'planner.agent.md') },
    ]);
  });

  test('ignoriert leere/undefined Verzeichnisse', async () => {
    mockTree({});
    await expect(scanAgentsIndex([null, undefined, ''], yamlParse)).resolves.toEqual([]);
  });

  test('dedupliziert nach fileSlug über mehrere Verzeichnisse, erstes Match gewinnt', async () => {
    mockTree({
      [PROVIDER_DIR]: ['shared.agent.md'],
      [PROJECT_DIR]: ['shared.agent.md'],
      [path.join(PROVIDER_DIR, 'shared.agent.md')]: '---\nname: shared\ndescription: Provider-Version\n---\n',
      [path.join(PROJECT_DIR, 'shared.agent.md')]: '---\nname: shared\ndescription: Projekt-Version\n---\n',
    });
    yamlParse.mockReturnValue({ name: 'shared', description: 'Provider-Version' });

    const result = await scanAgentsIndex([PROVIDER_DIR, PROJECT_DIR], yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(path.join(PROVIDER_DIR, 'shared.agent.md'));
  });

  test('gibt [] zurück wenn keine Verzeichnisse existieren', async () => {
    mockTree({});
    await expect(scanAgentsIndex([PROVIDER_DIR], yamlParse)).resolves.toEqual([]);
  });
});

/**
 * Tests für src/agents.js — Agent-Scanner-Funktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { scanAgentsDirectory } = require('../src/agents');

const AGENTS_DIR = path.join('C:', 'Users', 'test', '.copilot', 'agents');

// Einfacher yamlParse-Mock
const yamlParse = jest.fn();

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  fs.readdirSync.mockReset();
  yamlParse.mockReset();
});

// ══════════════════════════════════════════════════════════════
// scanAgentsDirectory
// ══════════════════════════════════════════════════════════════

describe('scanAgentsDirectory', () => {

  test('gibt [] zurück wenn Verzeichnis nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).toEqual([]);
  });

  test('gibt [] zurück wenn Verzeichnis leer ist', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).toEqual([]);
  });

  test('ignoriert Dateien ohne .agent.md Endung', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['readme.md', 'config.json', 'notes.txt']);
    expect(scanAgentsDirectory(AGENTS_DIR, yamlParse)).toEqual([]);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('parst name aus YAML-Frontmatter korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['code-reviewer.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: Code Reviewer\ndescription: Reviews code\n---\n\n# Content');
    yamlParse.mockReturnValue({ name: 'Code Reviewer', description: 'Reviews code' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Code Reviewer');
  });

  test('parst description aus YAML-Frontmatter korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['helper.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: Helper\ndescription: Hilft bei Aufgaben\n---\n');
    yamlParse.mockReturnValue({ name: 'Helper', description: 'Hilft bei Aufgaben' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].description).toBe('Hilft bei Aufgaben');
  });

  test('gibt korrektes Objekt {id, name, description, icon} zurück', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['test-agent.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: TestAgent\ndescription: Ein Test\n---\n');
    yamlParse.mockReturnValue({ name: 'TestAgent', description: 'Ein Test' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0]).toEqual({
      id: 'TestAgent',
      fileSlug: 'test-agent',
      name: 'TestAgent',
      description: 'Ein Test',
      icon: '🤖',
    });
  });

  test('icon ist immer 🤖', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['a.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: A\nicon: 🔥\n---\n');
    yamlParse.mockReturnValue({ name: 'A', icon: '🔥' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].icon).toBe('🤖');
  });

  test('verwendet Dateiname als Fallback wenn name fehlt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['fallback-agent.agent.md']);
    fs.readFileSync.mockReturnValue('---\ndescription: Kein Name\n---\n');
    yamlParse.mockReturnValue({ description: 'Kein Name' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].id).toBe('fallback-agent');
    expect(result[0].name).toBe('fallback-agent');
  });

  test('verwendet leeren String als Fallback wenn description fehlt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['nodesc.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: NoDesc\n---\n');
    yamlParse.mockReturnValue({ name: 'NoDesc' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result[0].description).toBe('');
  });

  test('entfernt BOM (\\uFEFF) am Dateianfang', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['bom.agent.md']);
    fs.readFileSync.mockReturnValue('\uFEFF---\nname: BomAgent\ndescription: BOM test\n---\n');
    yamlParse.mockReturnValue({ name: 'BomAgent', description: 'BOM test' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('BomAgent');
  });

  test('ignoriert Dateien ohne Frontmatter', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['no-frontmatter.agent.md']);
    fs.readFileSync.mockReturnValue('# Just markdown\n\nKein Frontmatter hier.');

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toEqual([]);
    expect(yamlParse).not.toHaveBeenCalled();
  });

  test('verarbeitet mehrere Agent-Dateien korrekt', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['agent-a.agent.md', 'agent-b.agent.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      return `---\nname: Agent${readCount}\ndescription: Desc${readCount}\n---\n`;
    });

    let parseCount = 0;
    yamlParse.mockImplementation(() => {
      parseCount++;
      return { name: `Agent${parseCount}`, description: `Desc${parseCount}` };
    });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Agent1');
    expect(result[1].name).toBe('Agent2');
  });

  test('fängt Parse-Fehler und fährt mit nächster Datei fort', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['broken.agent.md', 'good.agent.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      return `---\nname: file${readCount}\n---\n`;
    });

    let parseCount = 0;
    yamlParse.mockImplementation(() => {
      parseCount++;
      if (parseCount === 1) throw new Error('Invalid YAML');
      return { name: 'GoodAgent', description: 'works' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('GoodAgent');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('fängt Lesefehler (EACCES) und fährt fort', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['denied.agent.md', 'ok.agent.md']);

    let readCount = 0;
    fs.readFileSync.mockImplementation(() => {
      readCount++;
      if (readCount === 1) throw new Error('EACCES: permission denied');
      return '---\nname: OK\n---\n';
    });
    yamlParse.mockReturnValue({ name: 'OK' });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('OK');
    warnSpy.mockRestore();
  });

  test('unterstützt Windows-Zeilenumbrüche (\\r\\n) in Frontmatter', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['win.agent.md']);
    fs.readFileSync.mockReturnValue('---\r\nname: WinAgent\r\ndescription: Windows\r\n---\r\nContent');
    yamlParse.mockReturnValue({ name: 'WinAgent', description: 'Windows' });

    const result = scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('WinAgent');
  });

  test('liest Dateien mit utf-8 Encoding', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['test.agent.md']);
    fs.readFileSync.mockReturnValue('---\nname: Test\n---\n');
    yamlParse.mockReturnValue({ name: 'Test' });

    scanAgentsDirectory(AGENTS_DIR, yamlParse);
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join(AGENTS_DIR, 'test.agent.md'),
      'utf-8'
    );
  });
});

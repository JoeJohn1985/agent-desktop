/**
 * Tests für src/scanners.js — Scanner- und Config-Funktionen
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { scanSessions, scanSkillDirectory, readFolderConfig, writeFolderConfig } = require('../src/scanners');

const SESSIONS_DIR = path.join('C:', 'test', 'sessions');
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
// scanSessions
// ══════════════════════════════════════════════════════════════

describe('scanSessions', () => {
  test('gibt [] zurück wenn sessionsDir nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    expect(scanSessions(SESSIONS_DIR, yamlParse)).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith(SESSIONS_DIR);
  });

  test('gibt [] zurück wenn keine Unterverzeichnisse vorhanden', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    expect(scanSessions(SESSIONS_DIR, yamlParse)).toEqual([]);
  });

  test('ignoriert Dateien (nur Verzeichnisse werden gescannt)', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('readme.txt', false)]);
    expect(scanSessions(SESSIONS_DIR, yamlParse)).toEqual([]);
  });

  test('ignoriert Verzeichnisse ohne workspace.yaml', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      // workspace.yaml existiert nicht
      return false;
    });
    fs.readdirSync.mockReturnValue([dirent('session-1')]);
    expect(scanSessions(SESSIONS_DIR, yamlParse)).toEqual([]);
  });

  test('parst workspace.yaml korrekt mit allen Feldern', () => {
    const wsData = {
      id: 'sess-abc',
      name: 'Meine Session',
      summary: 'Zusammenfassung',
      cwd: '/home/user/project',
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-02T12:00:00Z',
      summary_count: 3,
    };
    const sessionDir = path.join(SESSIONS_DIR, 'session-1');
    const wsPath = path.join(sessionDir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      // checkpoints dir, plan.md → false
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('session-1')];
      if (p === sessionDir) return []; // no inuse file
      return [];
    });
    fs.readFileSync.mockReturnValue('yaml-content');
    yamlParse.mockReturnValue(wsData);

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'sess-abc',
      name: 'Meine Session',
      summary: 'Zusammenfassung',
      cwd: '/home/user/project',
      createdAt: '2025-01-01T10:00:00Z',
      updatedAt: '2025-01-02T12:00:00Z',
      summaryCount: 3,
      checkpointCount: 0,
      hasPlan: false,
      isActive: false,
    });
  });

  test('zählt Checkpoints korrekt (nur \\d{3}-*.md Dateien)', () => {
    const sessionDir = path.join(SESSIONS_DIR, 'sess-1');
    const wsPath = path.join(sessionDir, 'workspace.yaml');
    const cpDir = path.join(sessionDir, 'checkpoints');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      if (p === cpDir) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1')];
      if (p === cpDir) return ['001-first.md', '002-second.md', 'notes.txt', '003-third.md', 'abc-invalid.md'];
      if (p === sessionDir) return [];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockReturnValue({ id: 'x' });

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0].checkpointCount).toBe(3);
  });

  test('erkennt hasPlan wenn plan.md vorhanden ist', () => {
    const sessionDir = path.join(SESSIONS_DIR, 'sess-1');
    const wsPath = path.join(sessionDir, 'workspace.yaml');
    const planPath = path.join(sessionDir, 'plan.md');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      if (p === planPath) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1')];
      if (p === sessionDir) return [];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockReturnValue({ id: 'x' });

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0].hasPlan).toBe(true);
  });

  test('erkennt isActive wenn inuse.* Datei vorhanden ist', () => {
    const sessionDir = path.join(SESSIONS_DIR, 'sess-1');
    const wsPath = path.join(sessionDir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1')];
      if (p === sessionDir) return ['workspace.yaml', 'inuse.12345'];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockReturnValue({ id: 'x' });

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0].isActive).toBe(true);
  });

  test('sortiert nach updatedAt absteigend', () => {
    const sess1Dir = path.join(SESSIONS_DIR, 'sess-1');
    const sess2Dir = path.join(SESSIONS_DIR, 'sess-2');
    const ws1Path = path.join(sess1Dir, 'workspace.yaml');
    const ws2Path = path.join(sess2Dir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === ws1Path || p === ws2Path) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1'), dirent('sess-2')];
      if (p === sess1Dir || p === sess2Dir) return [];
      return [];
    });
    let callCount = 0;
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { id: 'older', updated_at: '2025-01-01' };
      return { id: 'newer', updated_at: '2025-06-15' };
    });

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0].id).toBe('newer');
    expect(result[1].id).toBe('older');
  });

  test('fängt YAML-Parse-Fehler und fährt mit nächster Session fort', () => {
    const sess1Dir = path.join(SESSIONS_DIR, 'sess-1');
    const sess2Dir = path.join(SESSIONS_DIR, 'sess-2');
    const ws1Path = path.join(sess1Dir, 'workspace.yaml');
    const ws2Path = path.join(sess2Dir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === ws1Path || p === ws2Path) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1'), dirent('sess-2')];
      if (p === sess2Dir) return [];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');

    let callCount = 0;
    yamlParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('Invalid YAML');
      return { id: 'ok-session' };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok-session');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('verwendet entry.name als Fallback für id wenn ws.id fehlt', () => {
    const sessionDir = path.join(SESSIONS_DIR, 'my-session-dir');
    const wsPath = path.join(sessionDir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('my-session-dir')];
      if (p === sessionDir) return [];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockReturnValue({ name: 'Test' }); // kein id-Feld

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0].id).toBe('my-session-dir');
  });

  test('setzt Standardwerte für fehlende Felder', () => {
    const sessionDir = path.join(SESSIONS_DIR, 'sess-1');
    const wsPath = path.join(sessionDir, 'workspace.yaml');

    fs.existsSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return true;
      if (p === wsPath) return true;
      return false;
    });
    fs.readdirSync.mockImplementation((p) => {
      if (p === SESSIONS_DIR) return [dirent('sess-1')];
      if (p === sessionDir) return [];
      return [];
    });
    fs.readFileSync.mockReturnValue('raw');
    yamlParse.mockReturnValue({}); // komplett leer

    const result = scanSessions(SESSIONS_DIR, yamlParse);
    expect(result[0]).toMatchObject({
      id: 'sess-1',
      name: null,
      summary: null,
      cwd: '',
      createdAt: '',
      updatedAt: '',
      summaryCount: 0,
    });
  });
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

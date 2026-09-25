'use strict';

/**
 * Tests für src/context-list.js.
 *
 * Diese Logik lag vorher komplett inline in drei ipcMain.handle()-Bodies in
 * main.js, wodurch die einzige "Abdeckung" ein Regex war, der nur prüfte, ob
 * bestimmte Strings im main.js-Quelltext vorkommen — kein echter Verhaltens-
 * test. Hier wird die tatsächliche Logik direkt aufgerufen, mit injizierten
 * Fake-Abhängigkeiten statt echtem Dateisystemzugriff.
 */

const path = require('path');
const {
  ALL_PROVIDERS,
  validateContextTarget,
  dedupeFirstWins,
  buildSkillsList,
  buildAgentsList,
  buildContextPaths,
} = require('../src/context-list');

// ══════════════════════════════════════════════════════════════
// validateContextTarget
// ══════════════════════════════════════════════════════════════

describe('validateContextTarget', () => {
  test('akzeptiert jeden Provider aus ALL_PROVIDERS', () => {
    for (const p of ALL_PROVIDERS) {
      expect(validateContextTarget(p, null)).toEqual({ provider: p, cwd: null });
    }
  });

  test('lehnt einen unbekannten Provider ab', () => {
    expect(validateContextTarget('evil-provider', 'C:\\projekt')).toBeNull();
  });

  test('lehnt einen leeren/undefined Provider ab', () => {
    expect(validateContextTarget('', 'C:\\projekt')).toBeNull();
    expect(validateContextTarget(undefined, 'C:\\projekt')).toBeNull();
  });

  test('behält einen gültigen Provider, setzt cwd aber auf null wenn relativ', () => {
    expect(validateContextTarget('copilot', '../etc')).toEqual({ provider: 'copilot', cwd: null });
  });

  test('behält einen gültigen Provider, setzt cwd auf null wenn kein String', () => {
    expect(validateContextTarget('copilot', 123)).toEqual({ provider: 'copilot', cwd: null });
    expect(validateContextTarget('copilot', undefined)).toEqual({ provider: 'copilot', cwd: null });
  });

  test('übernimmt einen gültigen absoluten cwd unverändert', () => {
    const absolute = path.resolve(path.sep, 'projekt');
    expect(validateContextTarget('copilot', absolute)).toEqual({ provider: 'copilot', cwd: absolute });
  });
});

// ══════════════════════════════════════════════════════════════
// dedupeFirstWins
// ══════════════════════════════════════════════════════════════

describe('dedupeFirstWins', () => {
  test('gibt eine leere Liste bei leeren Eingaben zurück', () => {
    expect(dedupeFirstWins([], x => x)).toEqual([]);
    expect(dedupeFirstWins([[], []], x => x)).toEqual([]);
  });

  test('behält alle Elemente wenn keine Schlüssel doppelt vorkommen', () => {
    const result = dedupeFirstWins([['a', 'b'], ['c']], x => x);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  test('erstes Vorkommen gewinnt bei doppeltem Schlüssel, spätere werden verworfen', () => {
    const result = dedupeFirstWins(
      [[{ id: 'x', from: 'first' }], [{ id: 'x', from: 'second' }]],
      item => item.id,
    );
    expect(result).toEqual([{ id: 'x', from: 'first' }]);
  });

  test('Reihenfolge der Listen bestimmt Priorität', () => {
    const result = dedupeFirstWins(
      [['project-a'], ['global-a', 'global-b']],
      x => x.split('-')[1],
    );
    // 'a' kommt aus der ersten Liste zuerst, 'global-a' wird verworfen.
    expect(result).toEqual(['project-a', 'global-b']);
  });
});

// ══════════════════════════════════════════════════════════════
// buildSkillsList
// ══════════════════════════════════════════════════════════════

describe('buildSkillsList', () => {
  const fakeSkillDirs = (provider, cwd, opts) => ({
    global: [`global-dir-for-${provider}${opts.skillsDirOverride ? '-override' : ''}`],
    project: cwd ? [`project-dir-for-${provider}`] : [],
  });

  function makeDeps(overrides = {}) {
    return {
      skillDirs: fakeSkillDirs,
      skillsDirOverride: undefined,
      scanBuiltinCopilotSkills: jest.fn().mockResolvedValue([]),
      syncMarketplaceSkills: jest.fn(),
      scanSkillDirectory: jest.fn(async (dir, source) => [{ dirName: `${dir}-skill`, source }]),
      userSkillIcon: () => '🧩',
      yamlParse: jest.fn(),
      ...overrides,
    };
  }

  test('Copilot: ruft builtin-Skills und Marketplace-Sync auf, andere Provider nicht', async () => {
    const deps = makeDeps();
    await buildSkillsList({ provider: 'copilot', cwd: null }, deps);
    expect(deps.scanBuiltinCopilotSkills).toHaveBeenCalledTimes(1);
    expect(deps.syncMarketplaceSkills).toHaveBeenCalledTimes(1);

    const deps2 = makeDeps();
    await buildSkillsList({ provider: 'anthropic', cwd: null }, deps2);
    expect(deps2.scanBuiltinCopilotSkills).not.toHaveBeenCalled();
    expect(deps2.syncMarketplaceSkills).not.toHaveBeenCalled();
  });

  test('scannt globale und Projekt-Verzeichnisse und gibt beide zurück', async () => {
    const deps = makeDeps();
    const result = await buildSkillsList({ provider: 'anthropic', cwd: 'C:\\projekt' }, deps);
    expect(result).toEqual([
      { dirName: 'global-dir-for-anthropic-skill', source: 'global' },
      { dirName: 'project-dir-for-anthropic-skill', source: 'project' },
    ]);
  });

  test('dedupliziert: ein Projekt-Skill mit gleichem dirName wie ein globaler wird nicht doppelt gelistet', async () => {
    const deps = makeDeps({
      scanSkillDirectory: jest.fn(async () => [{ dirName: 'shared', source: 'x' }]),
    });
    const result = await buildSkillsList({ provider: 'anthropic', cwd: 'C:\\projekt' }, deps);
    expect(result).toHaveLength(1);
  });

  test('reicht skillsDirOverride an skillDirs durch', async () => {
    const deps = makeDeps({ skillsDirOverride: 'D:\\custom' });
    const result = await buildSkillsList({ provider: 'copilot', cwd: null }, deps);
    expect(result.some(s => s.dirName.includes('override'))).toBe(true);
  });

  test('ein Fehler in syncMarketplaceSkills lässt den restlichen Scan nicht scheitern', async () => {
    const deps = makeDeps({
      syncMarketplaceSkills: jest.fn(() => { throw new Error('marketplace kaputt'); }),
    });
    await expect(buildSkillsList({ provider: 'copilot', cwd: null }, deps)).resolves.toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════
// buildAgentsList
// ══════════════════════════════════════════════════════════════

describe('buildAgentsList', () => {
  function makeDeps(overrides = {}) {
    return {
      agentDirs: (provider, cwd) => ({
        global: [`global-dir-for-${provider}`],
        project: cwd ? [`project-dir-for-${provider}`] : [],
      }),
      agentsDirOverride: undefined,
      scanAgentsDirectory: jest.fn(async (dir) => [{ fileSlug: `${dir}-agent` }]),
      yamlParse: jest.fn(),
      ...overrides,
    };
  }

  test('markiert global gescannte Agents mit source "global"', async () => {
    const deps = makeDeps();
    const result = await buildAgentsList({ provider: 'copilot', cwd: null }, deps);
    expect(result).toEqual([{ fileSlug: 'global-dir-for-copilot-agent', source: 'global' }]);
  });

  test('markiert projektbezogene Agents mit source "project"', async () => {
    const deps = makeDeps();
    const result = await buildAgentsList({ provider: 'copilot', cwd: 'C:\\projekt' }, deps);
    expect(result).toEqual([
      { fileSlug: 'global-dir-for-copilot-agent', source: 'global' },
      { fileSlug: 'project-dir-for-copilot-agent', source: 'project' },
    ]);
  });

  test('dedupliziert nach fileSlug, globaler Eintrag gewinnt gegen gleichnamigen Projekt-Eintrag', async () => {
    const deps = makeDeps({
      scanAgentsDirectory: jest.fn(async () => [{ fileSlug: 'shared' }]),
    });
    const result = await buildAgentsList({ provider: 'copilot', cwd: 'C:\\projekt' }, deps);
    expect(result).toEqual([{ fileSlug: 'shared', source: 'global' }]);
  });
});

// ══════════════════════════════════════════════════════════════
// buildContextPaths
// ══════════════════════════════════════════════════════════════

describe('buildContextPaths', () => {
  test('reicht Provider/cwd/Overrides an skillDirs und agentDirs durch', () => {
    const skillDirsFn = jest.fn(() => ({ global: ['s-global'], project: ['s-project'] }));
    const agentDirsFn = jest.fn(() => ({ global: ['a-global'], project: ['a-project'] }));

    const result = buildContextPaths(
      { provider: 'copilot', cwd: 'C:\\projekt' },
      { skillDirs: skillDirsFn, agentDirs: agentDirsFn, skillsDirOverride: 'D:\\skills', agentsDirOverride: 'D:\\agents' },
    );

    expect(skillDirsFn).toHaveBeenCalledWith('copilot', 'C:\\projekt', { skillsDirOverride: 'D:\\skills' });
    expect(agentDirsFn).toHaveBeenCalledWith('copilot', 'C:\\projekt', { agentsDirOverride: 'D:\\agents' });
    expect(result).toEqual({
      skills: { global: ['s-global'], project: ['s-project'] },
      agents: { global: ['a-global'], project: ['a-project'] },
    });
  });
});

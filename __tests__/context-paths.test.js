'use strict';

/**
 * Tests für src/context-paths.js — die zentrale Antwort auf "welche Ordner
 * liest dieser Provider?".
 *
 * Der Wert dieses Moduls liegt darin, dass Sidebar und Prompt-Injektion
 * dieselbe Quelle benutzen. Geht hier etwas schief, zeigt die App Skills an,
 * die der Provider nicht sieht (oder verschweigt welche, die er sieht) — und
 * das fällt im Betrieb niemandem auf. Deshalb wird jede Provider-Familie
 * einzeln geprüft statt nur exemplarisch.
 */

const os = require('os');
const path = require('path');
const { skillDirs, agentDirs, needsContextInjection, PROJECT_DIR_NAME } = require('../src/context-paths');
const { DATA_DIR } = require('../src/data-dir');

const CWD = path.join('C:', 'projekte', 'meinprojekt');
const HOME = os.homedir();
const API_PROVIDERS = ['anthropic', 'openai', 'glm', 'ollama'];

describe('skillDirs', () => {
  test('Copilot nutzt seine eigene CLI-Struktur (~/.copilot + .github)', () => {
    const dirs = skillDirs('copilot', CWD);
    expect(dirs.global).toEqual([path.join(HOME, '.copilot', 'skills')]);
    expect(dirs.project).toEqual([path.join(CWD, '.github', 'skills')]);
  });

  test('Copilot respektiert einen konfigurierten Skills-Ordner', () => {
    const custom = path.join('D:', 'eigene', 'skills');
    expect(skillDirs('copilot', CWD, { skillsDirOverride: custom }).global).toEqual([custom]);
  });

  test('Copilot: der Override betrifft nur global, nicht das Projekt', () => {
    const dirs = skillDirs('copilot', CWD, { skillsDirOverride: 'D:\\x' });
    expect(dirs.project).toEqual([path.join(CWD, '.github', 'skills')]);
  });

  test('Claude Code nutzt seine nativen Ordner (~/.claude + .claude)', () => {
    const dirs = skillDirs('claude-code', CWD);
    expect(dirs.global).toEqual([path.join(HOME, '.claude', 'skills')]);
    expect(dirs.project).toEqual([path.join(CWD, '.claude', 'skills')]);
  });

  test('Claude Code liest NICHT aus .github — das ist Copilots Konvention', () => {
    const dirs = skillDirs('claude-code', CWD);
    expect([...dirs.global, ...dirs.project].join('|')).not.toContain('.github');
  });

  test.each(API_PROVIDERS)('%s nutzt den app-eigenen, herstellerneutralen Projektordner', (provider) => {
    const dirs = skillDirs(provider, CWD);
    expect(dirs.project).toEqual([path.join(CWD, PROJECT_DIR_NAME, 'skills')]);
    expect(dirs.global[0]).toContain(path.join(provider, 'skills'));
  });

  test.each(API_PROVIDERS)('%s liest weder .github noch .claude', (provider) => {
    const all = Object.values(skillDirs(provider, CWD)).flat().join('|');
    expect(all).not.toContain('.github');
    expect(all).not.toContain(`${path.sep}.claude${path.sep}`);
  });

  test('Gemini hat gar keine Skills — die Sektion bleibt leer', () => {
    expect(skillDirs('gemini', CWD)).toEqual({ global: [], project: [] });
  });

  test('ohne Projekt gibt es nur globale Ordner', () => {
    for (const p of ['copilot', 'claude-code', ...API_PROVIDERS]) {
      expect(skillDirs(p, null).project).toEqual([]);
      expect(skillDirs(p, null).global.length).toBeGreaterThan(0);
    }
  });

  test('jeder Provider bekommt einen eigenen globalen Ordner (keine Überschneidung)', () => {
    const globals = ['copilot', 'claude-code', ...API_PROVIDERS].map(p => skillDirs(p, CWD).global[0]);
    expect(new Set(globals).size).toBe(globals.length);
  });

  test('alle Pfade sind absolut', () => {
    for (const p of ['copilot', 'claude-code', ...API_PROVIDERS]) {
      for (const dir of Object.values(skillDirs(p, CWD)).flat()) {
        expect(path.isAbsolute(dir)).toBe(true);
      }
    }
  });

  test('ein Provider-Name mit Traversal-Segmenten erzeugt gar keinen Pfad (Defense in Depth)', () => {
    // Der Aufrufer validiert provider bereits gegen eine Allow-Liste
    // (validateContextTarget in context-list.js) — dieser Test prüft, dass
    // skillDirs() sich nicht blind darauf verlässt. Echte Containment-Prüfung,
    // nicht nur "kein '..' mehr im normalisierten String": path.normalize()
    // löst '..'-Segmente ja gerade auf, ein Pfad kann also außerhalb der Basis
    // landen, ohne dass ein literales '..' im Ergebnis übrig bleibt.
    const dirs = skillDirs('..\\..\\evil', CWD);
    expect(dirs).toEqual({ global: [], project: [] });
  });

  test('ein Provider-Name mit Traversal-Segmenten bleibt nachweislich innerhalb von DATA_DIR', () => {
    // Fasst dieselbe Erwartung als generische Containment-Prüfung, damit sie
    // auch dann noch etwas beweist, falls skillDirs() sich künftig ändert
    // (z.B. doch mal einen Fallback-Pfad statt [] zurückgeben würde).
    const base = path.resolve(DATA_DIR);
    const dirs = skillDirs('..\\..\\evil', CWD);
    for (const dir of [...dirs.global, ...dirs.project]) {
      const resolved = path.resolve(dir);
      expect(resolved === base || resolved.startsWith(base + path.sep)).toBe(true);
    }
  });

  test('lehnt Provider-Namen mit Slashes/Punkten generell ab, nicht nur das eine Beispiel', () => {
    for (const evil of ['../evil', '..', 'a/b', 'a\\b', 'foo.bar', '']) {
      expect(skillDirs(evil, CWD)).toEqual({ global: [], project: [] });
    }
  });
});

describe('agentDirs', () => {
  test('Copilot nutzt ~/.copilot/agents und .github/agents', () => {
    const dirs = agentDirs('copilot', CWD);
    expect(dirs.global).toEqual([path.join(HOME, '.copilot', 'agents')]);
    expect(dirs.project).toEqual([path.join(CWD, '.github', 'agents')]);
  });

  test('Copilot respektiert einen konfigurierten Agents-Ordner', () => {
    const custom = path.join('D:', 'eigene', 'agents');
    expect(agentDirs('copilot', CWD, { agentsDirOverride: custom }).global).toEqual([custom]);
  });

  test('Claude Code nutzt seine nativen Ordner (~/.claude + .claude)', () => {
    const dirs = agentDirs('claude-code', CWD);
    expect(dirs.global).toEqual([path.join(HOME, '.claude', 'agents')]);
    expect(dirs.project).toEqual([path.join(CWD, '.claude', 'agents')]);
  });

  test.each(API_PROVIDERS)('%s nutzt den app-eigenen Projektordner', (provider) => {
    expect(agentDirs(provider, CWD).project).toEqual([path.join(CWD, PROJECT_DIR_NAME, 'agents')]);
  });

  test('Gemini hat keine Agents', () => {
    expect(agentDirs('gemini', CWD)).toEqual({ global: [], project: [] });
  });

  test('Skills und Agents liegen pro Provider in getrennten Ordnern', () => {
    for (const p of ['copilot', 'claude-code', ...API_PROVIDERS]) {
      expect(skillDirs(p, CWD).global[0]).not.toBe(agentDirs(p, CWD).global[0]);
      expect(skillDirs(p, CWD).project[0]).not.toBe(agentDirs(p, CWD).project[0]);
    }
  });

  test('lehnt Provider-Namen mit Traversal-Segmenten ab (Defense in Depth, wie skillDirs)', () => {
    for (const evil of ['..\\..\\evil', '../evil', 'a/b', '']) {
      expect(agentDirs(evil, CWD)).toEqual({ global: [], project: [] });
    }
  });
});

describe('needsContextInjection', () => {
  test('CLI-Provider brauchen keine Injektion — sie finden ihre Dateien selbst', () => {
    expect(needsContextInjection('copilot')).toBe(false);
    expect(needsContextInjection('claude-code')).toBe(false);
  });

  test.each(API_PROVIDERS)('%s braucht Injektion — es gibt keine CLI, die scannt', (provider) => {
    expect(needsContextInjection(provider)).toBe(true);
  });

  test('Gemini bekommt nichts injiziert', () => {
    expect(needsContextInjection('gemini')).toBe(false);
  });

  test('genau die Provider ohne Skill-Ordner brauchen auch keine Injektion', () => {
    for (const p of ['copilot', 'claude-code', 'gemini', ...API_PROVIDERS]) {
      const hasDirs = skillDirs(p, CWD).global.length > 0;
      if (!hasDirs) expect(needsContextInjection(p)).toBe(false);
    }
  });
});

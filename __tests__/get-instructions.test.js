/**
 * Tests für getInstructions-Logik in main.js
 * 
 * Die getInstructions-Handler nutzt readFolderConfig() für den konfigurierten Pfad
 * und dedupliziert die candidates-Liste.
 * 
 * Da main.js nicht direkt importierbar ist (Electron-App), testen wir die
 * extrahierte Logik isoliert (gleicher Algorithmus wie in main.js Zeile 296-318).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Extrahierte Logik aus main.js (getInstructions) ──────────

/**
 * Berechnet die instruction candidates mit Deduplizierung.
 * Entspricht dem Code in main.js ipcMain.handle('copilot:getInstructions').
 */
function getInstructionCandidates(cwd, configuredPath, homedir) {
  const candidates = [
    configuredPath,
    path.join(cwd, 'copilot-instructions.md'),
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(homedir, '.github', 'copilot-instructions.md'),
  ].filter((p, i, arr) => arr.indexOf(p) === i); // Deduplizieren
  return candidates;
}

/**
 * Findet existierende Instruction-Dateien aus der candidates-Liste.
 */
function findInstructions(cwd, configuredPath, homedir, existsCheck) {
  const candidates = getInstructionCandidates(cwd, configuredPath, homedir);
  const found = [];
  for (const p of candidates) {
    try {
      if (existsCheck(p)) {
        const rel = path.relative(cwd, p) || path.basename(p);
        found.push({ path: rel.startsWith('..') ? p : rel, name: path.basename(p) });
      }
    } catch (_) { /* skip */ }
  }
  return found;
}

// ── Tests ────────────────────────────────────────────────────

describe('getInstructions — Candidate-Berechnung und Deduplication', () => {

  const CWD = path.join('C:', 'projects', 'myapp');
  const HOME = path.join('C:', 'Users', 'TestUser');

  test('Standard: 4 Kandidaten ohne Duplikate', () => {
    const configuredPath = path.join(HOME, '.copilot', 'copilot-instructions.md');
    const candidates = getInstructionCandidates(CWD, configuredPath, HOME);

    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBe(configuredPath);
    expect(candidates[1]).toBe(path.join(CWD, 'copilot-instructions.md'));
    expect(candidates[2]).toBe(path.join(CWD, '.github', 'copilot-instructions.md'));
    expect(candidates[3]).toBe(path.join(HOME, '.github', 'copilot-instructions.md'));
  });

  test('Deduplication: wenn configuredPath == cwd/copilot-instructions.md, nur 3 Kandidaten', () => {
    const configuredPath = path.join(CWD, 'copilot-instructions.md');
    const candidates = getInstructionCandidates(CWD, configuredPath, HOME);

    expect(candidates).toHaveLength(3);
    // Kein Duplikat
    const unique = new Set(candidates);
    expect(unique.size).toBe(candidates.length);
  });

  test('Deduplication: wenn configuredPath == home/.github/copilot-instructions.md', () => {
    const configuredPath = path.join(HOME, '.github', 'copilot-instructions.md');
    const candidates = getInstructionCandidates(CWD, configuredPath, HOME);

    expect(candidates).toHaveLength(3);
    const unique = new Set(candidates);
    expect(unique.size).toBe(candidates.length);
  });

  test('Deduplication: wenn configuredPath == cwd/.github/copilot-instructions.md', () => {
    const configuredPath = path.join(CWD, '.github', 'copilot-instructions.md');
    const candidates = getInstructionCandidates(CWD, configuredPath, HOME);

    expect(candidates).toHaveLength(3);
    const unique = new Set(candidates);
    expect(unique.size).toBe(candidates.length);
  });

  test('configuredPath wird als erster Kandidat verwendet', () => {
    const configuredPath = path.join('D:', 'custom', 'instructions.md');
    const candidates = getInstructionCandidates(CWD, configuredPath, HOME);

    expect(candidates[0]).toBe(configuredPath);
  });

  test('leerer configuredPath bleibt erster Eintrag', () => {
    const candidates = getInstructionCandidates(CWD, '', HOME);
    expect(candidates[0]).toBe('');
  });
});

describe('getInstructions — findInstructions mit existsCheck', () => {

  const CWD = path.join('C:', 'projects', 'myapp');
  const HOME = path.join('C:', 'Users', 'TestUser');
  const CONFIGURED = path.join(HOME, '.copilot', 'copilot-instructions.md');

  test('gibt leeres Array wenn keine Datei existiert', () => {
    const result = findInstructions(CWD, CONFIGURED, HOME, () => false);
    expect(result).toEqual([]);
  });

  test('findet nur existierende Dateien', () => {
    const existing = new Set([CONFIGURED]);
    const result = findInstructions(CWD, CONFIGURED, HOME, (p) => existing.has(p));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('copilot-instructions.md');
  });

  test('gibt relative Pfade für Dateien innerhalb CWD', () => {
    const cwdFile = path.join(CWD, 'copilot-instructions.md');
    const existing = new Set([cwdFile]);
    const result = findInstructions(CWD, CONFIGURED, HOME, (p) => existing.has(p));

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('copilot-instructions.md');
    expect(result[0].path.startsWith('..')).toBe(false);
  });

  test('gibt absolute Pfade für Dateien außerhalb CWD', () => {
    const existing = new Set([CONFIGURED]);
    const result = findInstructions(CWD, CONFIGURED, HOME, (p) => existing.has(p));

    expect(result).toHaveLength(1);
    // Pfad ist absolut (da außerhalb CWD)
    expect(result[0].path).toBe(CONFIGURED);
  });

  test('findet mehrere existierende Dateien', () => {
    const cwdFile = path.join(CWD, 'copilot-instructions.md');
    const githubFile = path.join(CWD, '.github', 'copilot-instructions.md');
    const existing = new Set([cwdFile, githubFile]);
    const result = findInstructions(CWD, CONFIGURED, HOME, (p) => existing.has(p));

    expect(result).toHaveLength(2);
  });

  test('fängt Fehler im existsCheck ab', () => {
    const result = findInstructions(CWD, CONFIGURED, HOME, (p) => {
      if (p === CONFIGURED) throw new Error('Permission denied');
      return false;
    });
    expect(result).toEqual([]);
  });

  test('deduplizierter Pfad wird nicht doppelt zurückgegeben', () => {
    // configuredPath ist identisch mit cwd/copilot-instructions.md
    const cwdFile = path.join(CWD, 'copilot-instructions.md');
    const existing = new Set([cwdFile]);
    const result = findInstructions(CWD, cwdFile, HOME, (p) => existing.has(p));

    // Soll genau 1x zurückgegeben werden, nicht 2x
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('copilot-instructions.md');
  });
});

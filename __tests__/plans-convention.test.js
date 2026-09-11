'use strict';

/**
 * Tests für src/plans-convention.js — der Sync der Plan-Konvention in die
 * globalen Instruction-Dateien der ACP-Provider.
 *
 * Schwerpunkt liegt auf `applyBlock`: Diese Funktion schreibt in Dateien, die
 * dem Nutzer gehören (~/.claude/CLAUDE.md, ~/.copilot/copilot-instructions.md)
 * und die auch außerhalb dieser App gelesen werden. Ein Fehler bei den
 * Blockgrenzen frisst fremde Instruktionen — deshalb wird jeder Randfall hier
 * direkt geprüft, nicht nur über die Electron-Schicht.
 */

const {
  MARKER_START,
  MARKER_END,
  DEFAULT_PLANS_MD,
  ensureMarkers,
  applyBlock,
  ensureSourceFile,
  syncToTarget,
} = require('../src/plans-convention');

const BLOCK = `${MARKER_START}\n## Pläne\n\nPläne liegen unter \`plans/\`.\n${MARKER_END}`;

describe('ensureMarkers', () => {
  test('lässt einen bereits korrekt umschlossenen Block unverändert', () => {
    expect(ensureMarkers(BLOCK)).toBe(BLOCK);
  });

  test('ergänzt fehlende Marker (Nutzer hat sie aus der Quelldatei gelöscht)', () => {
    const result = ensureMarkers('## Pläne\n\nIrgendein Text.');
    expect(result.startsWith(MARKER_START)).toBe(true);
    expect(result.endsWith(MARKER_END)).toBe(true);
    expect(result).toContain('Irgendein Text.');
  });

  test('umschließt nicht doppelt, wenn beide Marker vorhanden sind', () => {
    const result = ensureMarkers(BLOCK);
    expect(result.match(new RegExp(MARKER_START, 'g'))).toHaveLength(1);
    expect(result.match(new RegExp(MARKER_END, 'g'))).toHaveLength(1);
  });

  test('leerer Inhalt bleibt leer (bekommt keine leeren Marker)', () => {
    expect(ensureMarkers('')).toBe('');
    expect(ensureMarkers('   \n  ')).toBe('');
    expect(ensureMarkers(null)).toBe('');
  });

  test('ergänzt Marker auch, wenn nur der End-Marker vorhanden ist', () => {
    const result = ensureMarkers(`Text\n${MARKER_END}`);
    expect(result.startsWith(MARKER_START)).toBe(true);
  });
});

describe('applyBlock — Block einfügen', () => {
  test('leere Zieldatei bekommt nur den Block', () => {
    const result = applyBlock('', BLOCK);
    expect(result.trim()).toBe(BLOCK);
  });

  test('hängt an bestehenden Inhalt an, ohne ihn zu verändern', () => {
    const existing = '# Meine Instruktionen\n\nSprich immer Deutsch mit mir.';
    const result = applyBlock(existing, BLOCK);
    expect(result).toContain('Sprich immer Deutsch mit mir.');
    expect(result).toContain(MARKER_START);
    expect(result.indexOf('Sprich immer Deutsch')).toBeLessThan(result.indexOf(MARKER_START));
  });

  test('trennt den angehängten Block durch eine Leerzeile vom Bestand', () => {
    expect(applyBlock('Zeile', BLOCK)).toContain(`Zeile\n\n${MARKER_START}`);
  });
});

describe('applyBlock — Block ersetzen', () => {
  test('ersetzt einen vorhandenen Block durch den neuen Inhalt', () => {
    const alt = `${MARKER_START}\nALTER TEXT\n${MARKER_END}`;
    const result = applyBlock(`Vorher\n\n${alt}\n\nNachher`, BLOCK);
    expect(result).not.toContain('ALTER TEXT');
    expect(result).toContain('Pläne liegen unter');
  });

  test('lässt Inhalt VOR und NACH dem Block unangetastet', () => {
    const alt = `${MARKER_START}\nALT\n${MARKER_END}`;
    const result = applyBlock(`# Kopf\n\n${alt}\n\n# Fuß`, BLOCK);
    expect(result).toContain('# Kopf');
    expect(result).toContain('# Fuß');
    expect(result.indexOf('# Kopf')).toBeLessThan(result.indexOf(MARKER_START));
    expect(result.indexOf('# Fuß')).toBeGreaterThan(result.indexOf(MARKER_END));
  });

  test('erzeugt beim Ersetzen keinen zweiten Block', () => {
    const alt = `${MARKER_START}\nALT\n${MARKER_END}`;
    const result = applyBlock(alt, BLOCK);
    expect(result.match(new RegExp(MARKER_START, 'g'))).toHaveLength(1);
  });

  test('ist idempotent — zweimal anwenden ändert nichts mehr', () => {
    const once = applyBlock('# Kopf\n', BLOCK);
    expect(applyBlock(once, BLOCK)).toBe(once);
  });
});

describe('applyBlock — kaputte Marker', () => {
  // Bewusstes Verhalten: bei halb vorhandenen/vertauschten Markern wird
  // ANGEHÄNGT statt geraten, wo der Block endet. Ein doppelter Block ist
  // reparierbar, gefressene Nutzer-Instruktionen sind es nicht.
  test('nur Start-Marker vorhanden → anhängen, Inhalt bleibt erhalten', () => {
    const kaputt = `# Kopf\n${MARKER_START}\nHalber Block ohne Ende`;
    const result = applyBlock(kaputt, BLOCK);
    expect(result).toContain('# Kopf');
    expect(result).toContain('Halber Block ohne Ende');
    expect(result).toContain(MARKER_END);
  });

  test('nur End-Marker vorhanden → anhängen, Inhalt bleibt erhalten', () => {
    const kaputt = `# Kopf\n${MARKER_END}\nRest`;
    const result = applyBlock(kaputt, BLOCK);
    expect(result).toContain('# Kopf');
    expect(result).toContain('Rest');
  });

  test('vertauschte Reihenfolge (end vor start) → anhängen statt Inhalt fressen', () => {
    const kaputt = `${MARKER_END}\nWichtiger Text\n${MARKER_START}`;
    const result = applyBlock(kaputt, BLOCK);
    expect(result).toContain('Wichtiger Text');
  });
});

describe('applyBlock — leere Quelle entfernt den Block', () => {
  test('entfernt einen vorhandenen Block', () => {
    const mit = `# Kopf\n\n${MARKER_START}\nALT\n${MARKER_END}\n\n# Fuß`;
    const result = applyBlock(mit, '');
    expect(result).not.toContain(MARKER_START);
    expect(result).not.toContain('ALT');
    expect(result).toContain('# Kopf');
    expect(result).toContain('# Fuß');
  });

  test('ohne vorhandenen Block passiert nichts', () => {
    const original = '# Nur meine Instruktionen\n';
    expect(applyBlock(original, '')).toBe(original);
  });

  test('leere Quelle auf leerem Ziel bleibt leer', () => {
    expect(applyBlock('', '').trim()).toBe('');
  });
});

describe('applyBlock — Robustheit', () => {
  test('verkraftet CRLF-Zeilenenden im Ziel', () => {
    const crlf = `# Kopf\r\n\r\n${MARKER_START}\r\nALT\r\n${MARKER_END}\r\n`;
    const result = applyBlock(crlf, BLOCK);
    expect(result).toContain('# Kopf');
    expect(result).not.toContain('ALT');
    expect(result.match(new RegExp(MARKER_START, 'g'))).toHaveLength(1);
  });

  test('verkraftet null/undefined als Zielinhalt', () => {
    expect(applyBlock(null, BLOCK).trim()).toBe(BLOCK);
    expect(applyBlock(undefined, BLOCK).trim()).toBe(BLOCK);
  });
});

// ── fs-gestützte Funktionen (mit Fake-fs) ───────────────────────

function createFakeFs(files = {}) {
  const store = { ...files };
  return {
    store,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(store, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(store, p)) throw new Error('ENOENT');
      return store[p];
    },
    writeFileSync: (p, content) => { store[p] = content; },
    mkdirSync: () => {},
  };
}

describe('ensureSourceFile', () => {
  test('legt die Quelldatei mit dem Standardtext an, wenn sie fehlt', () => {
    const fake = createFakeFs();
    const content = ensureSourceFile('/home/u/.agent-desktop/plans.md', fake);
    expect(content).toBe(DEFAULT_PLANS_MD);
    expect(fake.store['/home/u/.agent-desktop/plans.md']).toBe(DEFAULT_PLANS_MD);
  });

  test('überschreibt eine vorhandene Datei NIE (Nutzeranpassungen bleiben)', () => {
    const eigen = `${MARKER_START}\nMein eigener Text\n${MARKER_END}`;
    const fake = createFakeFs({ '/p/plans.md': eigen });
    expect(ensureSourceFile('/p/plans.md', fake)).toBe(eigen);
    expect(fake.store['/p/plans.md']).toBe(eigen);
  });

  test('gibt bei einem fs-Fehler einen leeren String zurück statt zu werfen', () => {
    const brokenFs = {
      existsSync: () => { throw new Error('EACCES'); },
      readFileSync: () => '', writeFileSync: () => {}, mkdirSync: () => {},
    };
    expect(ensureSourceFile('/p/plans.md', brokenFs)).toBe('');
  });

  test('der Standardtext enthält beide Marker und nennt plans/', () => {
    expect(DEFAULT_PLANS_MD).toContain(MARKER_START);
    expect(DEFAULT_PLANS_MD).toContain(MARKER_END);
    expect(DEFAULT_PLANS_MD).toContain('plans/');
  });
});

describe('syncToTarget', () => {
  test('legt eine fehlende Zieldatei an', () => {
    const fake = createFakeFs();
    expect(syncToTarget(BLOCK, '/home/u/.claude/CLAUDE.md', fake)).toBe(true);
    expect(fake.store['/home/u/.claude/CLAUDE.md']).toContain('Pläne liegen unter');
  });

  test('schreibt nicht erneut, wenn sich nichts ändert (Idempotenz)', () => {
    const fake = createFakeFs();
    syncToTarget(BLOCK, '/t/CLAUDE.md', fake);
    const nachErstemLauf = fake.store['/t/CLAUDE.md'];
    expect(syncToTarget(BLOCK, '/t/CLAUDE.md', fake)).toBe(false);
    expect(fake.store['/t/CLAUDE.md']).toBe(nachErstemLauf);
  });

  test('erhält bestehenden Nutzerinhalt der Zieldatei', () => {
    const fake = createFakeFs({ '/t/CLAUDE.md': '# Meins\n\nSprich Deutsch.\n' });
    syncToTarget(BLOCK, '/t/CLAUDE.md', fake);
    expect(fake.store['/t/CLAUDE.md']).toContain('Sprich Deutsch.');
    expect(fake.store['/t/CLAUDE.md']).toContain(MARKER_START);
  });

  test('legt bei leerer Quelle keine neue Datei an', () => {
    const fake = createFakeFs();
    expect(syncToTarget('', '/t/CLAUDE.md', fake)).toBe(false);
    expect(fake.store['/t/CLAUDE.md']).toBeUndefined();
  });

  test('entfernt den Block aus einer vorhandenen Datei, wenn die Quelle leer ist', () => {
    const fake = createFakeFs({ '/t/CLAUDE.md': `# Meins\n\n${MARKER_START}\nALT\n${MARKER_END}\n` });
    expect(syncToTarget('', '/t/CLAUDE.md', fake)).toBe(true);
    expect(fake.store['/t/CLAUDE.md']).toContain('# Meins');
    expect(fake.store['/t/CLAUDE.md']).not.toContain(MARKER_START);
  });

  test('wirft bei einem Schreibfehler nicht, sondern meldet false', () => {
    const brokenFs = {
      existsSync: () => false,
      readFileSync: () => '',
      writeFileSync: () => { throw new Error('EACCES'); },
      mkdirSync: () => {},
    };
    expect(syncToTarget(BLOCK, '/t/CLAUDE.md', brokenFs)).toBe(false);
  });
});

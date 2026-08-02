'use strict';

/**
 * Tests für src/providers/agent-tools.js — das Tool-Runtime der Direkt-API-Provider.
 *
 * Schwerpunkt: Sicherheitskritische Deny-List-Durchsetzung, Glob→RegExp, Pfad-
 * Auflösung, Ausgabe-Kappung und die Executors (echtes Dateisystem in temporären
 * Verzeichnissen, `child_process` gemockt — es wird nie eine echte Shell gestartet).
 */

jest.mock('child_process', () => ({ spawn: jest.fn() }));

const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  executeTool,
  isShellCommandDenied,
  stripShellWrapper,
  globToRegExp,
  getToolDefs,
  TOOL_DEFS,
  SHELL_NAME,
} = require('../src/providers/agent-tools');

const MAX_OUTPUT_CHARS = 30_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_GREP_MATCHES = 200;
const SHELL_TIMEOUT_MS = 120_000;

// ── Temp-Verzeichnis-Helfer ──────────────────────────────────────

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-'));
  spawn.mockReset();
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

function write(rel, content) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

// ── Fake-Shell ───────────────────────────────────────────────────

function makeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

/** Lässt den nächsten spawn() eine Fake-Shell mit vorgegebenem Verlauf liefern. */
function scriptShell({ stdout = '', stderr = '', code = 0, error = null, silent = false }) {
  let proc;
  spawn.mockImplementation(() => {
    proc = makeProc();
    if (!silent) {
      queueMicrotask(() => {
        if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
        if (error) proc.emit('error', error);
        else proc.emit('close', code);
      });
    }
    return proc;
  });
  return () => proc;
}

// ══════════════════════════════════════════════════════════════
// Deny-List (sicherheitskritisch)
// ══════════════════════════════════════════════════════════════

describe('stripShellWrapper', () => {
  test('entfernt die shell(...)-Hülle und trimmt', () => {
    expect(stripShellWrapper('shell(git push)')).toBe('git push');
    expect(stripShellWrapper('  shell( git push )  ')).toBe('git push');
  });

  test('lässt Einträge ohne Hülle unverändert (getrimmt)', () => {
    expect(stripShellWrapper('  git push  ')).toBe('git push');
  });

  test('leere Hülle ergibt einen leeren String', () => {
    expect(stripShellWrapper('shell()')).toBe('');
  });

  test('null/undefined/leer ergeben einen leeren String', () => {
    expect(stripShellWrapper(null)).toBe('');
    expect(stripShellWrapper(undefined)).toBe('');
    expect(stripShellWrapper('')).toBe('');
  });

  test('greift nur bei vollständiger Umklammerung, nicht bei Anhängseln', () => {
    expect(stripShellWrapper('shell(git push) extra')).toBe('shell(git push) extra');
    expect(stripShellWrapper('xshell(git push)')).toBe('xshell(git push)');
  });

  test('mehrzeilige Einträge werden nicht entpackt (kein s-Flag)', () => {
    expect(stripShellWrapper('shell(a\nb)')).toBe('shell(a\nb)');
  });

  test('nicht-String-Eingaben werden in Strings gewandelt', () => {
    expect(stripShellWrapper(42)).toBe('42');
  });
});

describe('isShellCommandDenied', () => {
  test('blockiert den exakt gelisteten Befehl', () => {
    expect(isShellCommandDenied('git push', ['shell(git push)'])).toBe(true);
    expect(isShellCommandDenied('  git push  ', ['git push'])).toBe(true);
  });

  test('blockiert Befehle mit dem gesperrten Eintrag als Präfix', () => {
    expect(isShellCommandDenied('git push origin main --force', ['shell(git push)'])).toBe(true);
  });

  test('blockiert auch Teilstring-Treffer mitten im Befehl (Verkettungsschutz)', () => {
    expect(isShellCommandDenied('cd /tmp && git push', ['shell(git push)'])).toBe(true);
    expect(isShellCommandDenied('echo x; rm -rf /', ['rm -rf'])).toBe(true);
  });

  test('prüft alle Einträge der Sperrliste, nicht nur den ersten', () => {
    const denied = ['shell(git push)', 'shell(npm publish)'];
    expect(isShellCommandDenied('npm publish', denied)).toBe(true);
  });

  test('erlaubt nicht gelistete Befehle', () => {
    expect(isShellCommandDenied('git status', ['shell(git push)'])).toBe(false);
  });

  test('leere/fehlende Sperrlisten blockieren nichts', () => {
    expect(isShellCommandDenied('git push', [])).toBe(false);
    expect(isShellCommandDenied('git push', undefined)).toBe(false);
    expect(isShellCommandDenied('git push', null)).toBe(false);
  });

  test('leere Einträge in der Sperrliste werden übersprungen', () => {
    expect(isShellCommandDenied('git push', ['', '   ', 'shell()'])).toBe(false);
  });

  test('leerer/fehlender Befehl wird nie blockiert', () => {
    expect(isShellCommandDenied('', ['git'])).toBe(false);
    expect(isShellCommandDenied('   ', ['git'])).toBe(false);
    expect(isShellCommandDenied(undefined, ['git'])).toBe(false);
    expect(isShellCommandDenied(null, ['git'])).toBe(false);
  });

  test('Matching ist case-sensitiv — abweichende Schreibweise wird nicht blockiert', () => {
    // Dokumentiert das aktuelle Verhalten (siehe Bericht: potenzielle Umgehung).
    expect(isShellCommandDenied('GIT PUSH', ['shell(git push)'])).toBe(false);
    expect(isShellCommandDenied('Git Push', ['shell(git push)'])).toBe(false);
  });

  test('Teilstring-Matching greift auch innerhalb von Wörtern (bewusst konservativ)', () => {
    // 'rm' steckt in 'charm' → blockiert. Lieber zu streng als zu lasch.
    expect(isShellCommandDenied('echo charm', ['rm'])).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// globToRegExp
// ══════════════════════════════════════════════════════════════

describe('globToRegExp', () => {
  test('* matcht innerhalb eines Segments, nicht über /', () => {
    const re = globToRegExp('*.md');
    expect(re.test('README.md')).toBe(true);
    expect(re.test('.md')).toBe(true);
    expect(re.test('docs/README.md')).toBe(false);
  });

  test('** matcht über Verzeichnisgrenzen inkl. leerem Zwischenpfad', () => {
    const re = globToRegExp('src/**/*.js');
    expect(re.test('src/x.js')).toBe(true);
    expect(re.test('src/a/b/c.js')).toBe(true);
    expect(re.test('src/a/b/c.ts')).toBe(false);
    expect(re.test('lib/a.js')).toBe(false);
  });

  test('** am Ende matcht den gesamten Restpfad', () => {
    const re = globToRegExp('src/**');
    expect(re.test('src/')).toBe(true);
    expect(re.test('src/a/b/c.js')).toBe(true);
    expect(re.test('src')).toBe(false);
  });

  test('? matcht genau ein Zeichen, aber kein /', () => {
    const re = globToRegExp('a?.js');
    expect(re.test('ab.js')).toBe(true);
    expect(re.test('a.js')).toBe(false);
    expect(re.test('abc.js')).toBe(false);
    expect(globToRegExp('a?b').test('a/b')).toBe(false);
  });

  test('der Punkt ist ein Literal, kein Regex-Platzhalter', () => {
    const re = globToRegExp('file.txt');
    expect(re.test('file.txt')).toBe(true);
    expect(re.test('fileXtxt')).toBe(false);
  });

  test('escapt Regex-Sonderzeichen . + ^ $ { } ( ) | [ ] \\', () => {
    expect(globToRegExp('(a).js').test('(a).js')).toBe(true);
    expect(globToRegExp('a+b').test('a+b')).toBe(true);
    expect(globToRegExp('a+b').test('ab')).toBe(false);
    expect(globToRegExp('a^b$c').test('a^b$c')).toBe(true);
    expect(globToRegExp('{a,b}.js').test('{a,b}.js')).toBe(true);
    expect(globToRegExp('{a,b}.js').test('a.js')).toBe(false);
    expect(globToRegExp('a|b').test('a|b')).toBe(true);
    expect(globToRegExp('a|b').test('a')).toBe(false);
    expect(globToRegExp('[abc].js').test('[abc].js')).toBe(true);
    expect(globToRegExp('[abc].js').test('a.js')).toBe(false);
    expect(globToRegExp('a\\b').test('a\\b')).toBe(true);
  });

  test('ist vollständig verankert (^…$)', () => {
    const re = globToRegExp('*.js');
    expect(re.test('x.js.map')).toBe(false);
    expect(re.test('x.jsx')).toBe(false);
    expect(re.test('vorher x.js')).toBe(true);   // Leerzeichen sind erlaubte Zeichen
    expect(re.source.startsWith('^')).toBe(true);
    expect(re.source.endsWith('$')).toBe(true);
  });

  test('leeres Muster matcht nur den leeren String', () => {
    const re = globToRegExp('');
    expect(re.test('')).toBe(true);
    expect(re.test('a')).toBe(false);
  });

  test('Pfadtrenner bleiben Pfadtrenner', () => {
    const re = globToRegExp('a/b/c.js');
    expect(re.test('a/b/c.js')).toBe(true);
    expect(re.test('a\\b\\c.js')).toBe(false);
  });

  test('nur * matcht jede Datei ohne Verzeichnisanteil', () => {
    const re = globToRegExp('*');
    expect(re.test('x')).toBe(true);
    expect(re.test('a/x')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// Tool-Definitionen
// ══════════════════════════════════════════════════════════════

describe('Tool-Definitionen', () => {
  test('getToolDefs liefert genau TOOL_DEFS', () => {
    expect(getToolDefs()).toBe(TOOL_DEFS);
  });

  test('jedes Tool hat Name, Beschreibung und ein Objekt-Schema', () => {
    for (const def of TOOL_DEFS) {
      expect(typeof def.name).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.parameters.type).toBe('object');
      expect(Array.isArray(def.parameters.required)).toBe(true);
    }
  });

  test('SHELL_NAME passt zur Plattform und steht in der shell-Beschreibung', () => {
    expect(SHELL_NAME).toBe(process.platform === 'win32' ? 'PowerShell' : '/bin/sh');
    expect(TOOL_DEFS[0].description).toContain(SHELL_NAME);
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: shell
// ══════════════════════════════════════════════════════════════

describe('executeTool: shell', () => {
  test('blockiert gesperrte Befehle, ohne eine Shell zu starten', async () => {
    const r = await executeTool('shell', { command: 'git push' }, { cwd: tmp, deniedTools: ['shell(git push)'] });
    expect(r.ok).toBe(false);
    expect(r.content).toBe('Befehl durch Tool-Sperrliste blockiert: git push');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('bereits abgebrochenes Signal verhindert den Start', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await executeTool('shell', { command: 'echo hi' }, { cwd: tmp, signal: ac.signal });
    expect(r).toEqual({ ok: false, content: 'Abgebrochen.' });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('führt erlaubte Befehle aus und liefert die getrimmte Ausgabe', async () => {
    scriptShell({ stdout: 'hallo\n', code: 0 });
    const r = await executeTool('shell', { command: 'echo hallo' }, { cwd: tmp, deniedTools: [] });
    expect(r).toEqual({ ok: true, content: 'hallo' });
  });

  test('übergibt cwd, Signal und die plattformspezifische Shell an spawn', async () => {
    scriptShell({ stdout: 'x', code: 0 });
    const ac = new AbortController();
    await executeTool('shell', { command: 'echo hallo' }, { cwd: tmp, signal: ac.signal });
    const [file, args, opts] = spawn.mock.calls[0];
    if (process.platform === 'win32') {
      expect(file).toBe('powershell.exe');
      expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'echo hallo']);
    } else {
      expect(file).toBe('/bin/sh');
      expect(args).toEqual(['-c', 'echo hallo']);
    }
    expect(opts.cwd).toBe(tmp);
    expect(opts.signal).toBe(ac.signal);
    expect(opts.windowsHide).toBe(true);
  });

  test('sammelt stderr zusätzlich zu stdout', async () => {
    scriptShell({ stdout: 'out\n', stderr: 'err\n', code: 0 });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r.content).toBe('out\nerr');
  });

  test('Exit-Code ungleich 0 ohne Ausgabe wird gemeldet', async () => {
    scriptShell({ code: 3 });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'Exit-Code 3' });
  });

  test('Exit-Code 0 ohne Ausgabe meldet "(keine Ausgabe)"', async () => {
    scriptShell({ code: 0 });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(keine Ausgabe)' });
  });

  test('fehlendes command wird zu einem leeren Befehl', async () => {
    scriptShell({ code: 0 });
    await executeTool('shell', {}, { cwd: tmp });
    const [, args] = spawn.mock.calls[0];
    expect(args[args.length - 1]).toBe('');
  });

  test('Fehler beim Starten der Shell wird als Ergebnis zurückgegeben', async () => {
    spawn.mockImplementation(() => { throw new Error('ENOENT'); });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toBe('Shell konnte nicht gestartet werden: ENOENT');
  });

  test('error-Event der Shell wird gemeldet', async () => {
    scriptShell({ error: new Error('kaputt') });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'Shell-Fehler: kaputt' });
  });

  test('error-Event nach Abbruch meldet "Abgebrochen." statt eines Fehlers', async () => {
    const ac = new AbortController();
    spawn.mockImplementation(() => {
      const proc = makeProc();
      queueMicrotask(() => { ac.abort(); proc.emit('error', new Error('AbortError')); });
      return proc;
    });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp, signal: ac.signal });
    expect(r).toEqual({ ok: false, content: 'Abgebrochen.' });
  });

  test('Timeout beendet den Prozess und meldet den Abbruch', async () => {
    jest.useFakeTimers();
    try {
      const getProc = scriptShell({ silent: true });
      const p = executeTool('shell', { command: 'sleep 999' }, { cwd: tmp });
      jest.advanceTimersByTime(SHELL_TIMEOUT_MS);
      const r = await p;
      expect(r.ok).toBe(false);
      expect(r.content).toBe('[Timeout nach 120s: sleep 999]');
      expect(getProc().kill).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('nach dem Timeout wird ein späteres close-Event ignoriert', async () => {
    jest.useFakeTimers();
    try {
      const getProc = scriptShell({ silent: true });
      const p = executeTool('shell', { command: 'x' }, { cwd: tmp });
      jest.advanceTimersByTime(SHELL_TIMEOUT_MS);
      getProc().emit('close', 0);
      const r = await p;
      expect(r.ok).toBe(false);
      expect(r.content).toContain('Timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  test('kappt überlange Shell-Ausgabe', async () => {
    scriptShell({ stdout: 'a'.repeat(MAX_OUTPUT_CHARS + 500), code: 0 });
    const r = await executeTool('shell', { command: 'x' }, { cwd: tmp });
    expect(r.content).toContain('…[gekürzt, 500 weitere Zeichen]');
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: read_file (Pfadauflösung + Kappung)
// ══════════════════════════════════════════════════════════════

describe('executeTool: read_file', () => {
  test('löst relative Pfade gegen cwd auf', async () => {
    write('sub/a.txt', 'Inhalt');
    const r = await executeTool('read_file', { path: 'sub/a.txt' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: 'Inhalt' });
  });

  test('nutzt absolute Pfade unverändert, auch außerhalb von cwd', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-abs-'));
    try {
      const full = path.join(other, 'b.txt');
      fs.writeFileSync(full, 'Absolut');
      const r = await executeTool('read_file', { path: full }, { cwd: tmp });
      expect(r).toEqual({ ok: true, content: 'Absolut' });
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('ohne path wird cwd gelesen → Fehler statt Absturz', async () => {
    const r = await executeTool('read_file', {}, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Fehler in read_file: /);
  });

  test('fehlende Datei liefert eine Fehlermeldung, wirft nicht', async () => {
    const r = await executeTool('read_file', { path: 'gibtsnicht.txt' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Fehler in read_file: /);
  });

  test('zu große Dateien werden nicht gelesen', async () => {
    write('big.bin', 'x'.repeat(MAX_FILE_BYTES + 10));
    const r = await executeTool('read_file', { path: 'big.bin' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toBe(`Datei zu groß (${MAX_FILE_BYTES + 10} Bytes).`);
  });

  test('genau MAX_OUTPUT_CHARS wird nicht gekappt', async () => {
    write('exact.txt', 'a'.repeat(MAX_OUTPUT_CHARS));
    const r = await executeTool('read_file', { path: 'exact.txt' }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(r.content).toHaveLength(MAX_OUTPUT_CHARS);
    expect(r.content).not.toContain('gekürzt');
  });

  test('unter MAX_OUTPUT_CHARS bleibt unverändert', async () => {
    write('small.txt', 'a'.repeat(MAX_OUTPUT_CHARS - 1));
    const r = await executeTool('read_file', { path: 'small.txt' }, { cwd: tmp });
    expect(r.content).toHaveLength(MAX_OUTPUT_CHARS - 1);
  });

  test('über MAX_OUTPUT_CHARS wird mit korrektem Rest-Zähler gekappt', async () => {
    write('long.txt', 'a'.repeat(MAX_OUTPUT_CHARS + 1234));
    const r = await executeTool('read_file', { path: 'long.txt' }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(r.content.startsWith('a'.repeat(MAX_OUTPUT_CHARS))).toBe(true);
    expect(r.content).toBe('a'.repeat(MAX_OUTPUT_CHARS) + '\n…[gekürzt, 1234 weitere Zeichen]');
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: write_file / edit_file
// ══════════════════════════════════════════════════════════════

describe('executeTool: write_file', () => {
  test('legt fehlende Verzeichnisse an und schreibt den Inhalt', async () => {
    const r = await executeTool('write_file', { path: 'neu/tief/a.txt', content: 'Hallo' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: 'Geschrieben: neu/tief/a.txt' });
    expect(fs.readFileSync(path.join(tmp, 'neu', 'tief', 'a.txt'), 'utf-8')).toBe('Hallo');
  });

  test('überschreibt eine bestehende Datei', async () => {
    write('a.txt', 'alt');
    await executeTool('write_file', { path: 'a.txt', content: 'neu' }, { cwd: tmp });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('neu');
  });

  test('fehlender content wird als leerer String geschrieben', async () => {
    await executeTool('write_file', { path: 'leer.txt' }, { cwd: tmp });
    expect(fs.readFileSync(path.join(tmp, 'leer.txt'), 'utf-8')).toBe('');
  });
});

describe('executeTool: edit_file', () => {
  test('ersetzt ein eindeutiges Vorkommen', async () => {
    write('a.txt', 'eins zwei drei');
    const r = await executeTool('edit_file', { path: 'a.txt', old_string: 'zwei', new_string: 'ZWEI' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: 'Bearbeitet: a.txt' });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('eins ZWEI drei');
  });

  test('meldet ein fehlendes old_string und ändert nichts', async () => {
    write('a.txt', 'eins');
    const r = await executeTool('edit_file', { path: 'a.txt', old_string: 'zwei', new_string: 'x' }, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'old_string nicht gefunden.' });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('eins');
  });

  test('meldet ein mehrdeutiges old_string mit Trefferzahl und ändert nichts', async () => {
    write('a.txt', 'x x x');
    const r = await executeTool('edit_file', { path: 'a.txt', old_string: 'x', new_string: 'y' }, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'old_string ist nicht eindeutig (3 Treffer).' });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('x x x');
  });

  test('fehlende Datei liefert eine Fehlermeldung', async () => {
    const r = await executeTool('edit_file', { path: 'weg.txt', old_string: 'a', new_string: 'b' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Fehler in edit_file: /);
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: list_dir
// ══════════════════════════════════════════════════════════════

describe('executeTool: list_dir', () => {
  test('markiert Verzeichnisse mit /', async () => {
    write('datei.txt', 'x');
    fs.mkdirSync(path.join(tmp, 'ordner'));
    const r = await executeTool('list_dir', { path: '.' }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(r.content.split('\n').sort()).toEqual(['datei.txt', 'ordner/']);
  });

  test('ohne path wird cwd gelistet', async () => {
    write('nur-hier.txt', 'x');
    const r = await executeTool('list_dir', {}, { cwd: tmp });
    expect(r.content).toBe('nur-hier.txt');
  });

  test('leeres Verzeichnis meldet "(leer)"', async () => {
    const r = await executeTool('list_dir', {}, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(leer)' });
  });

  test('nicht existierendes Verzeichnis liefert eine Fehlermeldung', async () => {
    const r = await executeTool('list_dir', { path: 'weg' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Fehler in list_dir: /);
  });

  test('args = null wird toleriert', async () => {
    const r = await executeTool('list_dir', null, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(leer)' });
  });

  test('ohne ctx.cwd wird process.cwd() verwendet', async () => {
    const r = await executeTool('list_dir', { path: tmp }, {});
    expect(r).toEqual({ ok: true, content: '(leer)' });
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: glob (walkFiles)
// ══════════════════════════════════════════════════════════════

describe('executeTool: glob', () => {
  test('findet Dateien rekursiv mit POSIX-Trennern', async () => {
    write('src/a.js', '');
    write('src/deep/b.js', '');
    write('src/c.ts', '');
    const r = await executeTool('glob', { pattern: 'src/**/*.js' }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(r.content.split('\n').sort()).toEqual(['src/a.js', 'src/deep/b.js']);
  });

  test('überspringt node_modules und .git', async () => {
    write('a.js', '');
    write('node_modules/pkg/index.js', '');
    write('.git/hooks/pre-commit.js', '');
    const r = await executeTool('glob', { pattern: '**/*.js' }, { cwd: tmp });
    expect(r.content.split('\n')).toEqual(['a.js']);
  });

  test('ohne Treffer wird "(keine Treffer)" gemeldet', async () => {
    write('a.txt', '');
    const r = await executeTool('glob', { pattern: '*.js' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(keine Treffer)' });
  });

  test('ohne pattern wird * verwendet (nur oberste Ebene)', async () => {
    write('a.txt', '');
    write('sub/b.txt', '');
    const r = await executeTool('glob', {}, { cwd: tmp });
    expect(r.content.split('\n')).toEqual(['a.txt']);
  });

  test('nicht lesbares Wurzelverzeichnis führt nicht zum Absturz', async () => {
    const r = await executeTool('glob', { pattern: '**/*' }, { cwd: path.join(tmp, 'gibtsnicht') });
    expect(r).toEqual({ ok: true, content: '(keine Treffer)' });
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: grep
// ══════════════════════════════════════════════════════════════

describe('executeTool: grep', () => {
  test('durchsucht ein Verzeichnis rekursiv mit datei:zeile-Präfix', async () => {
    write('a.txt', 'nichts\ntreffer hier\n');
    write('sub/b.txt', 'auch treffer\n');
    const r = await executeTool('grep', { pattern: 'treffer' }, { cwd: tmp });
    expect(r.ok).toBe(true);
    expect(r.content.split('\n').sort()).toEqual(['a.txt:2: treffer hier', 'sub/b.txt:1: auch treffer']);
  });

  test('durchsucht eine einzelne Datei, wenn path eine Datei ist', async () => {
    write('a.txt', 'x\ntreffer\n');
    write('b.txt', 'treffer\n');
    const r = await executeTool('grep', { pattern: 'treffer', path: 'a.txt' }, { cwd: tmp });
    expect(r.content).toBe('a.txt:2: treffer');
  });

  test('sucht case-insensitiv', async () => {
    write('a.txt', 'TREFFER\n');
    const r = await executeTool('grep', { pattern: 'treffer' }, { cwd: tmp });
    expect(r.content).toBe('a.txt:1: TREFFER');
  });

  test('ungültiges Regex wird gemeldet, ohne zu werfen', async () => {
    const r = await executeTool('grep', { pattern: '([' }, { cwd: tmp });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/^Ungültiges Regex: /);
  });

  test('ohne Treffer wird "(keine Treffer)" gemeldet', async () => {
    write('a.txt', 'nichts\n');
    const r = await executeTool('grep', { pattern: 'zzz' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(keine Treffer)' });
  });

  test('nicht existierender Pfad liefert keine Treffer statt eines Fehlers', async () => {
    const r = await executeTool('grep', { pattern: 'x', path: 'weg' }, { cwd: tmp });
    expect(r).toEqual({ ok: true, content: '(keine Treffer)' });
  });

  test('überspringt node_modules und .git', async () => {
    write('a.txt', 'treffer\n');
    write('node_modules/pkg/x.txt', 'treffer\n');
    write('.git/x.txt', 'treffer\n');
    const r = await executeTool('grep', { pattern: 'treffer' }, { cwd: tmp });
    expect(r.content.split('\n')).toEqual(['a.txt:1: treffer']);
  });

  test('bricht bei MAX_GREP_MATCHES ab (frühzeitiger Abbruch der Traversierung)', async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `treffer ${i}`).join('\n');
    write('viele.txt', lines);
    const r = await executeTool('grep', { pattern: 'treffer' }, { cwd: tmp });
    expect(r.content.split('\n')).toHaveLength(MAX_GREP_MATCHES);
  });

  test('nicht lesbare Dateien werden übersprungen', async () => {
    fs.mkdirSync(path.join(tmp, 'als-datei-gesucht'));
    write('a.txt', 'treffer\n');
    const r = await executeTool('grep', { pattern: 'treffer' }, { cwd: tmp });
    expect(r.content).toBe('a.txt:1: treffer');
  });
});

// ══════════════════════════════════════════════════════════════
// executeTool: Sonstiges
// ══════════════════════════════════════════════════════════════

describe('executeTool: unbekannte Tools und Fehlerbehandlung', () => {
  test('unbekanntes Tool wird namentlich gemeldet', async () => {
    const r = await executeTool('gibtsnicht', {}, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'Unbekanntes Tool: gibtsnicht' });
  });

  test('fehlender Tool-Name wird ebenfalls abgefangen', async () => {
    const r = await executeTool(undefined, {}, { cwd: tmp });
    expect(r).toEqual({ ok: false, content: 'Unbekanntes Tool: undefined' });
  });

  test('Ausnahmen der Executors werden pro Tool-Name gemeldet statt geworfen', async () => {
    await expect(executeTool('read_file', { path: 'weg' }, { cwd: tmp })).resolves.toMatchObject({ ok: false });
    const r = await executeTool('read_file', { path: 'weg' }, { cwd: tmp });
    expect(r.content).toMatch(/^Fehler in read_file: /);
    expect(r.content.length).toBeGreaterThan('Fehler in read_file: '.length);
  });
});

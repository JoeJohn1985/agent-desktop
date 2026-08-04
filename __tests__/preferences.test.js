'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPreferencesManager, PREFS_DEFAULTS } = require('../src/preferences');

describe('Preferences Manager', () => {
  let tempDir;
  let prefsPath;
  let mgr;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-test-'));
    prefsPath = path.join(tempDir, 'preferences.json');
    mgr = createPreferencesManager(prefsPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── read() ─────────────────────────────────────────────────

  describe('read()', () => {
    test('gibt Defaults zurück wenn Datei nicht existiert', () => {
      const result = mgr.read();
      expect(result).toEqual(PREFS_DEFAULTS);
    });

    test('gibt Defaults zurück wenn Datei leer ist', () => {
      fs.writeFileSync(prefsPath, '', 'utf-8');
      const result = mgr.read();
      expect(result).toEqual(PREFS_DEFAULTS);
    });

    test('gibt Defaults zurück wenn Datei nur {} enthält', () => {
      fs.writeFileSync(prefsPath, '{}', 'utf-8');
      const result = mgr.read();
      expect(result).toEqual(PREFS_DEFAULTS);
    });

    test('liest valide Preferences korrekt', () => {
      const data = { theme: 'light', settings: { allowAllPaths: true }, deniedTools: ['shell(git push)'], namedSessions: {}, openTabs: [] };
      fs.writeFileSync(prefsPath, JSON.stringify(data), 'utf-8');
      const result = mgr.read();
      expect(result.theme).toBe('light');
      expect(result.settings.allowAllPaths).toBe(true);
      expect(result.deniedTools).toEqual(['shell(git push)']);
    });

    test('ergänzt fehlende Default-Felder', () => {
      fs.writeFileSync(prefsPath, JSON.stringify({ theme: 'custom-theme' }), 'utf-8');
      const result = mgr.read();
      expect(result.theme).toBe('custom-theme');
      expect(result.namedSessions).toEqual({});
      expect(result.deniedTools).toEqual([]);
      expect(result.openTabs).toEqual([]);
      expect(result.settings).toEqual({ allowAllPaths: false });
    });

    test('stellt Backup wieder her bei korrupter Hauptdatei', () => {
      const bakPath = prefsPath + '.bak';
      const validData = { theme: 'dark', custom: 'value' };
      fs.writeFileSync(bakPath, JSON.stringify(validData), 'utf-8');
      fs.writeFileSync(prefsPath, 'invalid json {{{', 'utf-8');

      const result = mgr.read();
      expect(result.theme).toBe('dark');
      expect(result.custom).toBe('value');
      // Hauptdatei sollte wiederhergestellt sein
      const restored = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      expect(restored.custom).toBe('value');
    });

    test('gibt Defaults zurück wenn beides korrupt ist', () => {
      const bakPath = prefsPath + '.bak';
      fs.writeFileSync(prefsPath, 'broken', 'utf-8');
      fs.writeFileSync(bakPath, 'also broken', 'utf-8');
      const result = mgr.read();
      expect(result).toEqual(PREFS_DEFAULTS);
    });
  });

  // ── write() ────────────────────────────────────────────────

  describe('write()', () => {
    test('schreibt Preferences als formatiertes JSON', () => {
      const data = { theme: 'dark', namedSessions: { 'abc-123': { name: 'Test' } } };
      const ok = mgr.write(data);
      expect(ok).toBe(true);
      const written = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      expect(written.theme).toBe('dark');
      expect(written.namedSessions['abc-123'].name).toBe('Test');
    });

    test('erstellt Backup vor dem Schreiben', () => {
      const bakPath = prefsPath + '.bak';
      fs.writeFileSync(prefsPath, JSON.stringify({ theme: 'old' }), 'utf-8');
      mgr.write({ theme: 'new' });
      const bak = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
      expect(bak.theme).toBe('old');
    });

    test('erstellt kein Backup wenn Hauptdatei nicht existiert', () => {
      const bakPath = prefsPath + '.bak';
      mgr.write({ theme: 'first' });
      expect(fs.existsSync(bakPath)).toBe(false);
    });

    test('schreibt erneut korrekt nach backup-restore Zyklus', () => {
      // Erst normal schreiben
      mgr.write({ theme: 'v1', deniedTools: ['shell(rm)'] });
      // Dann nochmal
      mgr.write({ theme: 'v2', deniedTools: [] });
      const result = mgr.read();
      expect(result.theme).toBe('v2');
      // Backup enthält v1
      const bakPath = prefsPath + '.bak';
      const bak = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
      expect(bak.theme).toBe('v1');
    });
  });

  // ── ensureDir / Verzeichnis-Anlage ─────────────────────────

  describe('Verzeichnis-Anlage', () => {
    test('write() legt fehlendes Elternverzeichnis an', () => {
      const nestedPath = path.join(tempDir, 'a', 'b', 'c', 'preferences.json');
      const nestedMgr = createPreferencesManager(nestedPath);
      const ok = nestedMgr.write({ theme: 'custom-theme' });
      expect(ok).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(nestedPath, 'utf-8'));
      expect(content.theme).toBe('custom-theme');
    });

    test('write() wirft aussagekräftigen Fehler wenn Schreiben fehlschlägt', () => {
      // simulate read-only by pointing at an existing file as if it were a dir
      const blocker = path.join(tempDir, 'blocker');
      fs.writeFileSync(blocker, 'not a directory', 'utf-8');
      const badPath = path.join(blocker, 'sub', 'preferences.json');
      const badMgr = createPreferencesManager(badPath);

      expect(() => badMgr.write({ theme: 'x' })).toThrow(/preferences write failed/);
      try {
        badMgr.write({ theme: 'x' });
      } catch (e) {
        expect(e.prefsPath).toBe(badPath);
      }
    });
  });

  // ── migrateFromIfExists() ──────────────────────────────────

  describe('migrateFromIfExists()', () => {
    test('kopiert alte Datei wenn Ziel nicht existiert', () => {
      const oldPath = path.join(tempDir, 'legacy', 'preferences.json');
      fs.mkdirSync(path.dirname(oldPath), { recursive: true });
      fs.writeFileSync(oldPath, JSON.stringify({ theme: 'custom-theme', custom: 1 }), 'utf-8');

      const migrated = mgr.migrateFromIfExists(oldPath);
      expect(migrated).toBe(true);
      expect(fs.existsSync(prefsPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(prefsPath, 'utf-8')).theme).toBe('custom-theme');
    });

    test('kopiert auch .bak mit', () => {
      const oldPath = path.join(tempDir, 'legacy', 'preferences.json');
      fs.mkdirSync(path.dirname(oldPath), { recursive: true });
      fs.writeFileSync(oldPath, JSON.stringify({ theme: 'a' }), 'utf-8');
      fs.writeFileSync(oldPath + '.bak', JSON.stringify({ theme: 'old-bak' }), 'utf-8');

      mgr.migrateFromIfExists(oldPath);
      expect(fs.existsSync(prefsPath + '.bak')).toBe(true);
      expect(JSON.parse(fs.readFileSync(prefsPath + '.bak', 'utf-8')).theme).toBe('old-bak');
    });

    test('migriert nicht wenn Ziel bereits existiert', () => {
      fs.writeFileSync(prefsPath, JSON.stringify({ theme: 'existing' }), 'utf-8');
      const oldPath = path.join(tempDir, 'legacy', 'preferences.json');
      fs.mkdirSync(path.dirname(oldPath), { recursive: true });
      fs.writeFileSync(oldPath, JSON.stringify({ theme: 'old' }), 'utf-8');

      const migrated = mgr.migrateFromIfExists(oldPath);
      expect(migrated).toBe(false);
      expect(JSON.parse(fs.readFileSync(prefsPath, 'utf-8')).theme).toBe('existing');
    });

    test('liefert false wenn Quelle nicht existiert', () => {
      expect(mgr.migrateFromIfExists(path.join(tempDir, 'nope.json'))).toBe(false);
    });

    test('liefert false wenn oldPath identisch zu prefsPath', () => {
      expect(mgr.migrateFromIfExists(prefsPath)).toBe(false);
    });

    test('legt Zielverzeichnis bei Bedarf an', () => {
      const targetPath = path.join(tempDir, 'new-dir', 'preferences.json');
      const targetMgr = createPreferencesManager(targetPath);
      const oldPath = path.join(tempDir, 'preferences.json');
      fs.writeFileSync(oldPath, JSON.stringify({ theme: 'm' }), 'utf-8');

      expect(targetMgr.migrateFromIfExists(oldPath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
    });
  });

  // ── Defaults-Garantie ──────────────────────────────────────

  describe('PREFS_DEFAULTS', () => {
    test('enthält alle kritischen Felder', () => {
      expect(PREFS_DEFAULTS).toHaveProperty('theme');
      expect(PREFS_DEFAULTS).toHaveProperty('settings');
      expect(PREFS_DEFAULTS).toHaveProperty('deniedTools');
      expect(PREFS_DEFAULTS).toHaveProperty('namedSessions');
      expect(PREFS_DEFAULTS).toHaveProperty('openTabs');
    });

    test('namedSessions ist leeres Objekt per Default', () => {
      expect(PREFS_DEFAULTS.namedSessions).toEqual({});
    });

    test('theme Default ist dark', () => {
      expect(PREFS_DEFAULTS.theme).toBe('dark');
    });
  });
});

'use strict';

// Real-git-repo tests for the self-updater's ahead/behind detection and the
// apply (pull) flow. This replaced a release-tag comparison that silently
// went stale — package.json's version was bumped on every commit without a
// matching tag ever being created, so "no newer tag" kept reporting "up to
// date" even with plenty of newer commits sitting on origin/main. These
// tests exercise real `origin`/local checkouts (temp dirs) precisely to
// cover that "newer commits, no tag" scenario, which a mocked-fs test
// wouldn't meaningfully exercise.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { checkForUpdate, applyUpdate } = require('../src/updater');

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(__dirname, '.updater-fixture-'));
}

function commitVersion(dir, version, message) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  sh(dir, ['add', '.']);
  sh(dir, ['commit', '--quiet', '-m', message]);
}

function initRepoWithVersion(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, ['init', '--quiet', '-b', 'main']);
  sh(dir, ['config', 'user.email', 'test@test.local']);
  sh(dir, ['config', 'user.name', 'Test']);
  commitVersion(dir, version, 'init');
}

describe('updater: checkForUpdate (echte Git-Repos)', () => {
  let root, originDir, localDir;

  beforeEach(() => {
    root = mkTmp();
    originDir = path.join(root, 'origin');
    localDir = path.join(root, 'local');
    initRepoWithVersion(originDir, '1.0.0');
    sh(root, ['clone', '--quiet', originDir, localDir]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('meldet kein Update, wenn lokal und origin/main gleichauf sind', async () => {
    const result = await checkForUpdate(localDir);
    expect(result.ok).toBe(true);
    expect(result.updateAvailable).toBe(false);
    expect(result.currentVersion).toBe('1.0.0');
    expect(result.latestVersion).toBe('1.0.0');
  });

  it('meldet ein Update bei neuen Commits auf origin/main — auch ganz ohne Tag', () => {
    commitVersion(originDir, '1.1.0', 'bump');
    return checkForUpdate(localDir).then((result) => {
      expect(result.ok).toBe(true);
      expect(result.updateAvailable).toBe(true);
      expect(result.currentVersion).toBe('1.0.0');
      expect(result.latestVersion).toBe('1.1.0');
    });
  });

  it('meldet kein Update, wenn der lokale Checkout einen eigenen, noch nicht gepushten Commit hat', async () => {
    fs.writeFileSync(path.join(localDir, 'extra.txt'), 'x');
    sh(localDir, ['add', '.']);
    sh(localDir, ['commit', '--quiet', '-m', 'lokale Änderung']);

    const result = await checkForUpdate(localDir);
    expect(result.ok).toBe(true);
    expect(result.updateAvailable).toBe(false);
  });

  it('ist kein Git-Checkout bei nicht vorhandenem Arbeitsverzeichnis', async () => {
    const outside = mkTmp();
    try {
      const result = await checkForUpdate(path.join(outside, 'missing'));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('not-a-git-checkout');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('updater: applyUpdate (echte Git-Repos)', () => {
  let root, originDir, localDir;
  let npmRun;

  beforeEach(() => {
    root = mkTmp();
    originDir = path.join(root, 'origin');
    localDir = path.join(root, 'local');
    initRepoWithVersion(originDir, '1.0.0');
    sh(root, ['clone', '--quiet', originDir, localDir]);
    npmRun = jest.fn().mockResolvedValue({ ok: true, stdout: '{}', stderr: '' });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('pullt neue Commits fast-forward und liefert die neue Version', async () => {
    commitVersion(originDir, '1.1.0', 'bump');

    const result = await applyUpdate(localDir, { npmRun });
    expect(result.ok).toBe(true);
    expect(result.newVersion).toBe('1.1.0');
    expect(npmRun.mock.calls[0][1]).toContain('install');
    expect(npmRun.mock.calls[1][1]).toContain('ls');
  });

  it('installiert nach npm-Fehler bei gleichem HEAD erneut; gibt stdout und stderr aus', async () => {
    commitVersion(originDir, '1.1.0', 'bump');
    npmRun.mockResolvedValueOnce({ ok: false, stdout: 'install output', stderr: 'network error' });
    const failed = await applyUpdate(localDir, { npmRun });
    expect(failed).toMatchObject({ ok: false, reason: 'npm-install-failed', codeUpdated: true });
    expect(failed.error).toContain('install output');
    expect(failed.error).toContain('network error');
    const head = sh(localDir, ['rev-parse', 'HEAD']);
    expect((await applyUpdate(localDir, { npmRun })).ok).toBe(true);
    expect(sh(localDir, ['rev-parse', 'HEAD'])).toBe(head);
    expect(npmRun.mock.calls.filter(([, args]) => args[0] === 'install')).toHaveLength(2);
  });

  it('repariert fehlende Runtime-Imports auch ohne neue Remoteversion', async () => {
    fs.writeFileSync(path.join(originDir, 'main.js'), "require('fixture-runtime/entry.js');");
    sh(originDir, ['add', '.']);
    sh(originDir, ['commit', '--quiet', '-m', 'runtime']);
    sh(localDir, ['pull', '--ff-only']);
    expect(fs.existsSync(path.join(localDir, 'node_modules', 'fixture-runtime'))).toBe(false);
    npmRun.mockImplementation(async (_cmd, args) => {
      if (args[0] === 'install') {
        const dep = path.join(localDir, 'node_modules', 'fixture-runtime');
        fs.mkdirSync(dep, { recursive: true });
        fs.writeFileSync(path.join(dep, 'entry.js'), 'throw new Error("must not execute");');
      }
      return { ok: true, stdout: '{}', stderr: '' };
    });
    expect((await applyUpdate(localDir, { npmRun })).ok).toBe(true);
  });

  it('meldet non-ok, wenn npm ls nach erfolgreichem install fehlschlägt', async () => {
    npmRun.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, stderr: 'missing transitive dependency' });
    expect(await applyUpdate(localDir, { npmRun })).toMatchObject({ ok: false, reason: 'dependency-validation-failed' });
  });

  it('meldet non-ok bei fehlender Importdatei trotz erfolgreichem npm ls', async () => {
    fs.writeFileSync(path.join(originDir, 'main.js'), "require('definitely-missing-runtime/entry.js');");
    sh(originDir, ['add', '.']);
    sh(originDir, ['commit', '--quiet', '-m', 'runtime']);
    expect(await applyUpdate(localDir, { npmRun })).toMatchObject({ ok: false, reason: 'dependency-validation-failed' });
  });

  it('behält ff-only Schutz bei divergiertem Verlauf', async () => {
    sh(localDir, ['config', 'user.email', 'test@test.local']);
    sh(localDir, ['config', 'user.name', 'Test']);
    commitVersion(localDir, '2.0.0', 'local');
    commitVersion(originDir, '3.0.0', 'remote');
    expect(await applyUpdate(localDir, { npmRun })).toMatchObject({ ok: false, reason: 'pull-failed' });
    expect(npmRun).not.toHaveBeenCalled();
  });

  it('bricht bei unsauberem Arbeitsverzeichnis ab', async () => {
    fs.writeFileSync(path.join(localDir, 'dirty.txt'), 'x');
    const result = await applyUpdate(localDir, { npmRun });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dirty-working-tree');
  });
});

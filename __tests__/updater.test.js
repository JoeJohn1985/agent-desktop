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
const os = require('os');
const path = require('path');
const { checkForUpdate, applyUpdate } = require('../src/updater');

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-updater-'));
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

  it('ist kein Git-Checkout außerhalb eines Repos', async () => {
    const outside = mkTmp();
    const result = await checkForUpdate(outside);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-a-git-checkout');
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('updater: applyUpdate (echte Git-Repos)', () => {
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

  it('pullt neue Commits fast-forward und liefert die neue Version', async () => {
    commitVersion(originDir, '1.1.0', 'bump');

    const result = await applyUpdate(localDir);
    expect(result.ok).toBe(true);
    expect(result.newVersion).toBe('1.1.0');
  });

  it('bricht bei unsauberem Arbeitsverzeichnis ab', async () => {
    fs.writeFileSync(path.join(localDir, 'dirty.txt'), 'x');
    const result = await applyUpdate(localDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dirty-working-tree');
  });
});

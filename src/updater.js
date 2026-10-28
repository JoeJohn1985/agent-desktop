'use strict';

// Git-based self-update for the source-checkout distribution model.
//
// The app is run from a Git checkout (not a packaged installer), so "updating"
// means pulling the latest code from `main`. Whether a newer version exists is
// detected via plain git ahead/behind detection against `origin/main` — using
// each user's own credentials, so no token has to be embedded in the app.
//
// This used to compare against the newest release *tag* instead, but that
// silently went stale: package.json's version gets bumped on every commit
// without a matching tag ever being created, so "no newer tag" kept reporting
// "up to date" even when origin/main had plenty of newer commits to pull.
// Comparing HEAD against origin/main directly can't go stale the same way —
// it's exactly the same condition `applyUpdate`'s `pull --ff-only` needs.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createRequire, isBuiltin } = require('module');

const UPDATE_BRANCH = 'main';
const GIT_TIMEOUT_MS = 30_000;
const NPM_TIMEOUT_MS = 300_000;

// ── git/npm execution (main process) ─────────────────────────

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: GIT_TIMEOUT_MS, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: (stdout || '').toString(), stderr: (stderr || '').toString(), error: err });
    });
  });
}

const git = (repoDir, args, opts) => run('git', args, { cwd: repoDir, ...opts });

function commandError(result) {
  return [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
}

async function validateDependencies(repoDir, npmRun = run) {
  const tree = await npmRun(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ls', '--all', '--include=dev', '--omit=optional', '--json'],
    { cwd: repoDir, timeout: NPM_TIMEOUT_MS, shell: process.platform === 'win32' });
  if (!tree.ok) return { ok: false, error: commandError(tree) };
  // Resolve actual static runtime imports, without evaluating package code.
  // npm ls alone does not notice deleted entry files inside an installed package.
  const files = ['main.js', 'preload.js'].map(file => path.join(repoDir, file));
  function collect(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.name.endsWith('.js')) files.push(file);
    }
  }
  collect(path.join(repoDir, 'src'));
  try {
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      const imports = source.matchAll(/(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*)['"]([^'"]+)['"]/g);
      for (const [, specifier] of imports) {
        if (specifier.startsWith('.') || path.isAbsolute(specifier) || isBuiltin(specifier)) continue;
        if (specifier === 'electron' && process.versions.electron) continue;
        const resolved = createRequire(file).resolve(specifier);
        if (!fs.statSync(resolved).isFile()) throw new Error(`Runtime-Import ist keine Datei: ${specifier}`);
      }
    }
    return { ok: true };
  } catch (error) {
    console.warn('[updater:dependencies]', error.message);
    return { ok: false, error: error.message };
  }
}

/** True if repoDir is inside a Git working tree. */
async function isGitRepo(repoDir) {
  const r = await git(repoDir, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/** True if the working tree has no uncommitted changes. */
async function isWorkingTreeClean(repoDir) {
  const r = await git(repoDir, ['status', '--porcelain']);
  return r.ok && r.stdout.trim() === '';
}

function readLocalVersion(repoDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Check whether `origin/main` has commits not yet in the local checkout.
 * `latestVersion` is read from the remote's package.json purely for display —
 * it plays no part in the updateAvailable decision, which is pure git ancestry
 * (does HEAD..origin/main have anything, and is HEAD still fast-forwardable).
 * @param {string} repoDir
 * @returns {Promise<{ok:boolean, currentVersion:string, latestVersion:string|null, updateAvailable:boolean, reason?:string, error?:string}>}
 */
async function checkForUpdate(repoDir) {
  const currentVersion = readLocalVersion(repoDir);
  if (!(await isGitRepo(repoDir))) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, reason: 'not-a-git-checkout' };
  }

  const fetch = await git(repoDir, ['fetch', '--quiet', 'origin', UPDATE_BRANCH]);
  if (!fetch.ok) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, reason: 'git-failed', error: (fetch.stderr || fetch.error?.message || '').trim() };
  }

  const localHead = await git(repoDir, ['rev-parse', 'HEAD']);
  const remoteHead = await git(repoDir, ['rev-parse', `origin/${UPDATE_BRANCH}`]);
  if (!localHead.ok || !remoteHead.ok) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, reason: 'git-failed', error: (localHead.stderr || remoteHead.stderr || '').trim() };
  }

  let latestVersion = currentVersion;
  const show = await git(repoDir, ['show', `origin/${UPDATE_BRANCH}:package.json`]);
  if (show.ok) {
    try { latestVersion = JSON.parse(show.stdout).version || currentVersion; } catch { /* keep currentVersion */ }
  }

  if (localHead.stdout.trim() === remoteHead.stdout.trim()) {
    return { ok: true, currentVersion, latestVersion, updateAvailable: false };
  }

  // Exit code 0 = HEAD is an ancestor of origin/main → purely behind, a
  // fast-forward pull will work. Anything else (diverged, or local ahead)
  // reports no update — `applyUpdate`'s --ff-only pull couldn't apply it anyway.
  const ancestor = await git(repoDir, ['merge-base', '--is-ancestor', 'HEAD', `origin/${UPDATE_BRANCH}`]);
  return { ok: true, currentVersion, latestVersion, updateAvailable: ancestor.ok };
}

/**
 * Apply the update: requires a clean working tree, pulls `main`, and runs
 * `npm install` on every explicit update/repair, then validates dependencies. Does NOT restart — the
 * caller relaunches the app on success.
 * @param {string} repoDir
 * @returns {Promise<{ok:boolean, reason?:string, depsInstalled?:boolean, newVersion?:string, error?:string}>}
 */
async function applyUpdate(repoDir, { npmRun = run } = {}) {
  if (!(await isGitRepo(repoDir))) return { ok: false, reason: 'not-a-git-checkout' };
  if (!(await isWorkingTreeClean(repoDir))) return { ok: false, reason: 'dirty-working-tree' };

  const pull = await git(repoDir, ['pull', '--ff-only', 'origin', UPDATE_BRANCH]);
  if (!pull.ok) {
    return { ok: false, reason: 'pull-failed', error: (pull.stderr || pull.error?.message || '').trim() };
  }

  // npm.cmd requires a shell on Windows; all arguments are fixed.
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const install = await npmRun(npmCmd, ['install', '--include=dev', '--include=optional', '--no-save', '--no-audit', '--no-fund'], { cwd: repoDir, timeout: NPM_TIMEOUT_MS, shell: isWindows });
  if (!install.ok) {
    console.warn('[updater:install]', commandError(install));
    return { ok: false, reason: 'npm-install-failed', error: commandError(install), codeUpdated: true };
  }
  const validation = await validateDependencies(repoDir, npmRun);
  if (!validation.ok) {
    console.warn('[updater:validation]', validation.error);
    return { ok: false, reason: 'dependency-validation-failed', error: validation.error, codeUpdated: true };
  }

  return { ok: true, depsInstalled: true, newVersion: readLocalVersion(repoDir) };
}

module.exports = {
  isGitRepo,
  isWorkingTreeClean,
  readLocalVersion,
  checkForUpdate,
  applyUpdate,
  validateDependencies,
  UPDATE_BRANCH,
};

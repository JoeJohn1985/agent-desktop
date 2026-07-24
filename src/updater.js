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
 * `npm install` if the dependency manifests changed. Does NOT restart — the
 * caller relaunches the app on success.
 * @param {string} repoDir
 * @returns {Promise<{ok:boolean, reason?:string, depsInstalled?:boolean, newVersion?:string, error?:string}>}
 */
async function applyUpdate(repoDir) {
  if (!(await isGitRepo(repoDir))) return { ok: false, reason: 'not-a-git-checkout' };
  if (!(await isWorkingTreeClean(repoDir))) return { ok: false, reason: 'dirty-working-tree' };

  const before = await git(repoDir, ['rev-parse', 'HEAD']);
  const headBefore = before.stdout.trim();

  const pull = await git(repoDir, ['pull', '--ff-only', 'origin', UPDATE_BRANCH]);
  if (!pull.ok) {
    return { ok: false, reason: 'pull-failed', error: (pull.stderr || pull.error?.message || '').trim() };
  }

  const after = await git(repoDir, ['rev-parse', 'HEAD']);
  const headAfter = after.stdout.trim();

  // Did dependency manifests change between the old and new HEAD?
  let depsInstalled = false;
  if (headBefore && headAfter && headBefore !== headAfter) {
    const diff = await git(repoDir, ['diff', '--name-only', headBefore, headAfter]);
    const changed = diff.stdout.split('\n').map(s => s.trim());
    if (changed.includes('package.json') || changed.includes('package-lock.json')) {
      // npm ships as npm.cmd on Windows — a batch file, which Node's spawn/
      // execFile refuses to run directly (throws EINVAL) without shell: true,
      // regardless of the shell option's docs suggesting otherwise. Same
      // reasoning as npx's shell:true in acp-client.js. Fixed args below, no
      // untrusted input, so shell:true here carries no injection risk.
      const isWindows = process.platform === 'win32';
      const npmCmd = isWindows ? 'npm.cmd' : 'npm';
      const install = await run(npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: repoDir, timeout: NPM_TIMEOUT_MS, shell: isWindows });
      if (!install.ok) {
        return { ok: false, reason: 'npm-install-failed', error: (install.stderr || install.error?.message || '').trim() };
      }
      depsInstalled = true;
    }
  }

  return { ok: true, depsInstalled, newVersion: readLocalVersion(repoDir) };
}

module.exports = {
  isGitRepo,
  isWorkingTreeClean,
  readLocalVersion,
  checkForUpdate,
  applyUpdate,
  UPDATE_BRANCH,
};

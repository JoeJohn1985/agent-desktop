'use strict';

// Git-based self-update for the source-checkout distribution model.
//
// The app is run from a Git checkout (not a packaged installer), so "updating"
// means pulling the latest code from `main`. We detect whether a newer version
// exists by reading the newest release *tag* from the remote — via plain `git`
// using each user's own credentials, so no token has to be embedded in the app
// (works for the private repo today and a public one later, unchanged).
//
// This module keeps the parsing/compare logic pure (and unit-tested); the git
// invocations are thin async wrappers around child_process.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const UPDATE_BRANCH = 'main';
const GIT_TIMEOUT_MS = 30_000;
const NPM_TIMEOUT_MS = 300_000;

// ── Pure helpers (no I/O — unit-tested) ──────────────────────

/**
 * Parse a version string ("v1.2.3", "1.2.3-beta.1") into comparable parts.
 * @param {string} v
 * @returns {{major:number,minor:number,patch:number,pre:string|null}|null}
 */
function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}

/**
 * Compare two semver strings. Returns -1 if a<b, 0 if equal, 1 if a>b.
 * A release (no prerelease) ranks higher than a prerelease of the same x.y.z.
 * Unparseable inputs sort as lowest.
 */
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  // Same x.y.z: a release outranks a prerelease.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    if (pa.pre === pb.pre) return 0;
    return pa.pre < pb.pre ? -1 : 1;
  }
  return 0;
}

/**
 * Extract tag names from `git ls-remote --tags` output. Drops the peeled
 * "^{}" duplicates that annotated tags produce.
 * @param {string} output
 * @returns {string[]}
 */
function parseTagsFromLsRemote(output) {
  if (!output) return [];
  const tags = [];
  for (const line of output.split('\n')) {
    const m = line.match(/refs\/tags\/(.+?)(\^\{\})?$/);
    if (m) tags.push(m[1]);
  }
  return [...new Set(tags)];
}

/**
 * Pick the highest stable (non-prerelease) semver tag. Returns null if none.
 * @param {string[]} tags
 * @returns {string|null}
 */
function pickLatestStableTag(tags) {
  let best = null;
  for (const t of tags || []) {
    const p = parseSemver(t);
    if (!p || p.pre) continue; // only well-formed, non-prerelease tags
    if (best === null || compareSemver(t, best) > 0) best = t;
  }
  return best;
}

/**
 * Whether `latestTag` represents a newer version than `currentVersion`.
 * @param {string} currentVersion
 * @param {string|null} latestTag
 * @returns {boolean}
 */
function isUpdateAvailable(currentVersion, latestTag) {
  if (!latestTag) return false;
  return compareSemver(latestTag, currentVersion) > 0;
}

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
 * Check the remote for a newer release tag.
 * @param {string} repoDir
 * @returns {Promise<{ok:boolean, currentVersion:string, latestVersion:string|null, updateAvailable:boolean, reason?:string, error?:string}>}
 */
async function checkForUpdate(repoDir) {
  const currentVersion = readLocalVersion(repoDir);
  if (!(await isGitRepo(repoDir))) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, reason: 'not-a-git-checkout' };
  }
  const ls = await git(repoDir, ['ls-remote', '--tags', 'origin']);
  if (!ls.ok) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, reason: 'git-failed', error: (ls.stderr || ls.error?.message || '').trim() };
  }
  const latestVersion = pickLatestStableTag(parseTagsFromLsRemote(ls.stdout));
  return {
    ok: true,
    currentVersion,
    latestVersion,
    updateAvailable: isUpdateAvailable(currentVersion, latestVersion),
  };
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
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const install = await run(npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: repoDir, timeout: NPM_TIMEOUT_MS });
      if (!install.ok) {
        return { ok: false, reason: 'npm-install-failed', error: (install.stderr || install.error?.message || '').trim() };
      }
      depsInstalled = true;
    }
  }

  return { ok: true, depsInstalled, newVersion: readLocalVersion(repoDir) };
}

module.exports = {
  // pure
  parseSemver,
  compareSemver,
  parseTagsFromLsRemote,
  pickLatestStableTag,
  isUpdateAvailable,
  // git/io
  isGitRepo,
  isWorkingTreeClean,
  readLocalVersion,
  checkForUpdate,
  applyUpdate,
  UPDATE_BRANCH,
};

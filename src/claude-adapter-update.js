'use strict';

// Registry discovery is developer-only; it never replaces the bundled release.

const PACKAGE_NAME = '@agentclientprotocol/claude-agent-acp';
// Kept as a compatibility export; package.json is the single source of truth.
const DEFAULT_VERSION = require('./claude-runtime').RELEASE_VERSION;
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Compares two dotted version strings numerically, ignoring any
 * -prerelease/+build suffix. Returns -1/0/1 (a<b / a===b / a>b).
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const parts = (v) => String(v || '0').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Checks npm's registry for the latest published version of the adapter.
 * @param {string} currentVersion - The currently pinned version.
 * @returns {Promise<{ok:boolean, currentVersion:string, latestVersion:string|null, updateAvailable:boolean, error?:string}>}
 */
async function checkForAdapterUpdate(currentVersion) {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const latestVersion = data?.version || null;
    if (!latestVersion) throw new Error('Antwort enthielt keine Version');
    return {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    };
  } catch (e) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, error: e.message || String(e) };
  }
}

module.exports = { PACKAGE_NAME, DEFAULT_VERSION, REGISTRY_URL, compareVersions, checkForAdapterUpdate };

'use strict';

// Version-update check for the Claude Code ACP adapter package
// (@agentclientprotocol/claude-agent-acp). The adapter is pinned to one exact
// version (see main.js claudeCodeClientOptions) instead of always resolving
// to whatever `npx -y <pkg>` considers "latest" — an unpinned npx run
// reinstalls on every session open, and once hit a broken install where the
// adapter's own optional native-binary dependency silently failed to
// download (session/new then failed with a generic "Internal error").
// Pinning makes installs deterministic; this module lets the user check npm's
// registry for a newer version instead of just going stale forever.
//
// That check is developer-mode only (see checkClaudeAdapterUpdate in
// renderer/app.js): the package releases often and has broken this app before
// — 0.75.0 switched `/usage` from prose to markdown, which silently emptied the
// subscription display. Bumping DEFAULT_VERSION is therefore a deliberate act
// that requires re-verifying the whole surface the app depends on.

const PACKAGE_NAME = '@agentclientprotocol/claude-agent-acp';
/**
 * Last version verified end-to-end (see main.js claudeCodeClientOptions).
 *
 * Verified on 2026-09-15 against a live adapter: process start, `session/new`,
 * 5 session modes and 5 models reported, `/usage` parsed into 2 plan windows,
 * `/context` parsed to a percentage — identical results to 0.76.0.
 *
 * 0.77.0's breaking change (the `agent` config option is no longer forwarded,
 * `DEFAULT_AGENT_ID`/`AGENT_CONFIG_ID`/`discoverCustomAgents` removed) does not
 * affect this app: it only ever sets the `model`, `mode` and `effort` config
 * options, never `agent`. Its permission fix concerns the host-level
 * `allowDangerouslySkipPermissions` opt-out, which this app doesn't pass
 * either — approvals run app-side off `session/request_permission`.
 *
 * Only applies to fresh installs — an existing `claudeCodeAdapterVersion`
 * preference wins over this.
 */
const DEFAULT_VERSION = '0.77.0';
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

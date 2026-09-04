'use strict';

// Builds the shell commands sent to a remote host for the Claude Code (SSH)
// provider, and parses what comes back.
//
// This lives in its own module rather than inline in main.js because it is the
// one place where user-supplied strings (a working directory, an SSH target)
// end up inside a command line that a shell on ANOTHER machine executes. SSH
// does not pass argv through: it joins its arguments into one string and hands
// that to a remote shell. So an unquoted path containing `;` or backticks is
// not a display bug, it is remote command execution — which makes this worth
// testing directly instead of only through the Electron layer.

/**
 * Quotes a string for safe use inside a remote POSIX shell command.
 *
 * Single quotes disable all shell interpretation. The only character that
 * cannot appear inside them is `'` itself, so it is closed, escaped, and
 * reopened (`'\''`) — the standard POSIX idiom.
 * @param {string} s
 * @returns {string}
 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * Remote command that launches the ACP adapter in `cwd`.
 *
 * `cd` is needed because SSH always starts in the remote home directory, and
 * Claude Code binds a session to the directory it runs in. `exec` replaces the
 * shell with the adapter so there is no extra process between SSH and the
 * adapter — otherwise killing the SSH client could leave the adapter running.
 * @param {string} cwd - Working directory on the remote host.
 * @param {string} adapterSpec - npm package spec, e.g. 'pkg@1.2.3'.
 * @returns {string}
 */
function buildAdapterCommand(cwd, adapterSpec) {
  return `cd ${shellQuote(cwd)} && exec npx -y ${shellQuote(adapterSpec)}`;
}

/**
 * Remote command for the connection test: reports node/claude versions and
 * whether `cwd` exists, in one round trip (each SSH handshake costs seconds).
 * `|| true` keeps a missing tool from aborting the rest under `set -e`.
 * @param {string} [cwd] - Optional directory to check for existence.
 * @returns {string}
 */
function buildProbeCommand(cwd) {
  return [
    'echo NODE=$(node --version 2>/dev/null || true)',
    'echo CLAUDE=$(claude --version 2>/dev/null || true)',
    cwd ? `echo CWD=$([ -d ${shellQuote(cwd)} ] && echo yes || echo no)` : 'echo CWD=skip',
  ].join('; ');
}

/**
 * Parses buildProbeCommand()'s output.
 * @param {string} stdout
 * @returns {{nodeVersion: string|null, claudeVersion: string|null, cwdOk: boolean|undefined}}
 */
function parseProbeOutput(stdout) {
  const pick = (key) => (String(stdout || '').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] || '').trim();
  const cwdRaw = pick('CWD');
  return {
    nodeVersion: pick('NODE') || null,
    claudeVersion: pick('CLAUDE') || null,
    cwdOk: cwdRaw === 'skip' || cwdRaw === '' ? undefined : cwdRaw === 'yes',
  };
}

/**
 * Remote command for the folder picker: the resolved absolute path first (so
 * '..' and '~' come back canonicalized), then one entry per line.
 *
 * An empty path means "remote home", written as an unquoted `~` — quoting it
 * would stop the remote shell from expanding it. Every caller-supplied path is
 * quoted.
 * @param {string} [dirPath]
 * @returns {string}
 */
function buildListDirCommand(dirPath) {
  const cd = dirPath ? `cd ${shellQuote(dirPath)}` : 'cd ~';
  return `${cd} && pwd && ls -1 -p`;
}

/**
 * Parses buildListDirCommand()'s output into the resolved path plus its
 * subdirectories. `ls -p` marks directories with a trailing slash, which is
 * how they're told apart without a round trip per entry.
 * @param {string} stdout
 * @returns {{path: string, dirs: string[]}}
 */
function parseListDirOutput(stdout) {
  const lines = String(stdout || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const path = (lines.shift() || '').trim();
  const dirs = lines
    .filter((l) => l.endsWith('/'))
    .map((l) => l.slice(0, -1))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'de'));
  return { path, dirs };
}

module.exports = {
  shellQuote,
  buildAdapterCommand,
  buildProbeCommand,
  parseProbeOutput,
  buildListDirCommand,
  parseListDirOutput,
};

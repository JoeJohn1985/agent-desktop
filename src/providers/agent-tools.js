'use strict';

// Provider-agnostic agent tool runtime. Defines a single tool set as JSON
// Schema (each provider adapter converts it to its own function-calling format)
// and executes the tools locally in the main process, scoped to a working dir.
//
// Pure helpers (schema, deny-matching) are unit-tested; the executors do I/O.

const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

// Shell used for the `shell` tool. On Windows, bash-style commands (ls, grep,
// cat …) fail under cmd.exe, so we run via PowerShell; elsewhere /bin/sh.
const IS_WINDOWS = process.platform === 'win32';
const SHELL_NAME = IS_WINDOWS ? 'PowerShell' : '/bin/sh';

const MAX_FILE_BYTES = 256 * 1024;       // cap file reads
const MAX_OUTPUT_CHARS = 30_000;         // cap any tool output fed back to the model
const MAX_GREP_MATCHES = 200;
const MAX_WALK_ENTRIES = 5000;
const SHELL_TIMEOUT_MS = 120_000;

// ── Tool schema (provider-agnostic) ──────────────────────────────

const TOOL_DEFS = [
  {
    name: 'shell',
    description: `Run a shell command in the working directory and return its stdout/stderr. Commands run in ${SHELL_NAME} — use its syntax. Use for builds, tests, git, and any command-line task.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file and return its contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path (relative to the working directory or absolute).' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given text content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact unique substring in a file. Fails if old_string is missing or not unique.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path.' },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file).' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path (defaults to the working directory).' } },
      required: [],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g. "src/**/*.js"), relative to the working directory.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Glob pattern.' } },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search file contents for a regular expression and return matching lines with file:line prefixes.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: { type: 'string', description: 'Directory or file to search (defaults to the working directory).' },
      },
      required: ['pattern'],
    },
  },
];

function getToolDefs() {
  return TOOL_DEFS;
}

// ── Deny-list matching (reused for the shell tool) ───────────────

/**
 * Strips a `shell(...)` wrapper from a denied-tool entry, matching the format
 * used by the session tools UI.
 * @param {string} entry
 * @returns {string}
 */
function stripShellWrapper(entry) {
  const m = /^shell\((.*)\)$/.exec(String(entry || '').trim());
  return m ? m[1].trim() : String(entry || '').trim();
}

/**
 * Whether a shell command is blocked by the denied-tools list. A command is
 * denied if it starts with (or contains as a leading token) any denied entry.
 * @param {string} command
 * @param {string[]} deniedTools
 * @returns {boolean}
 */
function isShellCommandDenied(command, deniedTools) {
  const cmd = String(command || '').trim();
  if (!cmd) return false;
  for (const raw of deniedTools || []) {
    const needle = stripShellWrapper(raw);
    if (!needle) continue;
    if (cmd === needle || cmd.startsWith(needle + ' ') || cmd.includes(needle)) {
      return true;
    }
  }
  return false;
}

// ── Path helpers ─────────────────────────────────────────────────

function resolveInCwd(cwd, p) {
  if (!p) return cwd;
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function truncate(str) {
  if (str.length <= MAX_OUTPUT_CHARS) return str;
  return str.slice(0, MAX_OUTPUT_CHARS) + `\n…[gekürzt, ${str.length - MAX_OUTPUT_CHARS} weitere Zeichen]`;
}

// ── Glob → RegExp (small, dependency-free) ───────────────────────

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else if (c === '/') re += '/';
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

async function walkFiles(root, onFile) {
  let count = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (count >= MAX_WALK_ENTRIES) return;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else { count++; const stop = await onFile(full); if (stop) return; }
    }
  }
  await walk(root);
}

// ── Executors ────────────────────────────────────────────────────

function runShell(command, cwd, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve({ ok: false, content: 'Abgebrochen.' });
      return;
    }

    const [file, args] = IS_WINDOWS
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
      : ['/bin/sh', ['-c', command]];

    let proc;
    try {
      proc = spawn(file, args, { cwd, signal, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, content: `Shell konnte nicht gestartet werden: ${e.message}` });
      return;
    }

    const CAP = 2 * 1024 * 1024; // hard memory cap for captured output
    let out = '';
    let done = false;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };

    const capture = (buf) => {
      if (out.length < CAP) out += buf.toString();
    };
    proc.stdout?.on('data', capture);
    proc.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* ignore */ }
      finish({ ok: false, content: truncate((out.trim() + `\n[Timeout nach ${SHELL_TIMEOUT_MS / 1000}s: ${command}]`).trim()) });
    }, SHELL_TIMEOUT_MS);

    proc.on('error', (e) => {
      const msg = signal && signal.aborted ? 'Abgebrochen.' : `Shell-Fehler: ${e.message}`;
      finish({ ok: false, content: msg });
    });
    proc.on('close', (code) => {
      const text = out.trim() || (code === 0 ? '(keine Ausgabe)' : `Exit-Code ${code}`);
      finish({ ok: code === 0, content: truncate(text) });
    });
  });
}

/**
 * Executes a tool by name. Returns { ok, content } where content is a string
 * fed back to the model as the tool result.
 * @param {string} name
 * @param {Object} args
 * @param {{cwd: string, deniedTools?: string[], signal?: AbortSignal}} ctx
 * @returns {Promise<{ok: boolean, content: string}>}
 */
async function executeTool(name, args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  args = args || {};
  try {
    switch (name) {
      case 'shell': {
        if (isShellCommandDenied(args.command, ctx.deniedTools)) {
          return { ok: false, content: `Befehl durch Tool-Sperrliste blockiert: ${args.command}` };
        }
        return await runShell(String(args.command || ''), cwd, ctx.signal);
      }
      case 'read_file': {
        const fp = resolveInCwd(cwd, args.path);
        const stat = await fsp.stat(fp);
        if (stat.size > MAX_FILE_BYTES) return { ok: false, content: `Datei zu groß (${stat.size} Bytes).` };
        return { ok: true, content: truncate(await fsp.readFile(fp, 'utf-8')) };
      }
      case 'write_file': {
        const fp = resolveInCwd(cwd, args.path);
        await fsp.mkdir(path.dirname(fp), { recursive: true });
        await fsp.writeFile(fp, String(args.content ?? ''), 'utf-8');
        return { ok: true, content: `Geschrieben: ${args.path}` };
      }
      case 'edit_file': {
        const fp = resolveInCwd(cwd, args.path);
        const text = await fsp.readFile(fp, 'utf-8');
        const occ = text.split(args.old_string).length - 1;
        if (occ === 0) return { ok: false, content: 'old_string nicht gefunden.' };
        if (occ > 1) return { ok: false, content: `old_string ist nicht eindeutig (${occ} Treffer).` };
        await fsp.writeFile(fp, text.replace(args.old_string, args.new_string), 'utf-8');
        return { ok: true, content: `Bearbeitet: ${args.path}` };
      }
      case 'list_dir': {
        const dir = resolveInCwd(cwd, args.path);
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        const lines = entries.map(e => (e.isDirectory() ? e.name + '/' : e.name));
        return { ok: true, content: truncate(lines.join('\n') || '(leer)') };
      }
      case 'glob': {
        const re = globToRegExp(args.pattern || '*');
        const matches = [];
        await walkFiles(cwd, (full) => {
          const rel = path.relative(cwd, full).split(path.sep).join('/');
          if (re.test(rel)) matches.push(rel);
          return matches.length >= MAX_WALK_ENTRIES;
        });
        return { ok: true, content: truncate(matches.join('\n') || '(keine Treffer)') };
      }
      case 'grep': {
        let re;
        try { re = new RegExp(args.pattern, 'i'); }
        catch (e) { return { ok: false, content: `Ungültiges Regex: ${e.message}` }; }
        const root = resolveInCwd(cwd, args.path);
        const results = [];
        const searchFile = async (full) => {
          let content;
          try { content = await fsp.readFile(full, 'utf-8'); } catch { return false; }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              const rel = path.relative(cwd, full).split(path.sep).join('/');
              results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= MAX_GREP_MATCHES) return true;
            }
          }
          return false;
        };
        const stat = await fsp.stat(root).catch(() => null);
        if (stat && stat.isFile()) await searchFile(root);
        else await walkFiles(root, searchFile);
        return { ok: true, content: truncate(results.join('\n') || '(keine Treffer)') };
      }
      default:
        return { ok: false, content: `Unbekanntes Tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, content: `Fehler in ${name}: ${e?.message || String(e)}` };
  }
}

module.exports = {
  TOOL_DEFS,
  SHELL_NAME,
  getToolDefs,
  executeTool,
  isShellCommandDenied,
  stripShellWrapper,
  globToRegExp,
};

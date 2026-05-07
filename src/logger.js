// ── File Logger ─────────────────────────────────────────────
// Writes structured log lines to ~/.copilot-desktop/logs/copilot-desktop-<date>.log
// Rotates daily and cleans up logs older than 7 days on startup.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.copilot-desktop', 'logs');
const MAX_AGE_DAYS = 7;

let _stream = null;

function _pad(n) { return String(n).padStart(2, '0'); }

function _dateTag(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function _timestamp(d) {
  return `${_dateTag(d)}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function _ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function _logFilePath(d) {
  return path.join(LOG_DIR, `copilot-desktop-${_dateTag(d)}.log`);
}

function _cleanOldLogs() {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(LOG_DIR)) {
      if (!entry.startsWith('copilot-desktop-') || !entry.endsWith('.log')) continue;
      const fullPath = path.join(LOG_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(fullPath);
      } catch (_) { /* ignore individual file errors */ }
    }
  } catch (_) { /* ignore if dir doesn't exist yet */ }
}

function _getStream() {
  const now = new Date();
  const target = _logFilePath(now);

  if (_stream && _stream._logPath === target) return _stream;

  // Close previous day's stream
  if (_stream) {
    try { _stream.end(); } catch (_) { /* ignore */ }
  }

  _ensureDir();
  _stream = fs.createWriteStream(target, { flags: 'a' });
  _stream._logPath = target;
  return _stream;
}

/**
 * Write a single log entry.
 * @param {'info'|'warn'|'error'} level
 * @param {any[]} args
 */
function writeLog(level, args) {
  try {
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
    const line = `[${_timestamp(new Date())}] [${level.toUpperCase().padEnd(5)}] ${msg}\n`;
    _getStream().write(line);
  } catch (_) { /* never crash the app because of logging */ }
}

/** Initialise logger: ensure directory exists and clean old logs. */
function initLogger() {
  _ensureDir();
  _cleanOldLogs();
}

/** Close the log stream (call on app quit). */
function closeLogger() {
  if (_stream) {
    try { _stream.end(); } catch (_) { /* ignore */ }
    _stream = null;
  }
}

/** Return the logs directory path. */
function getLogDir() {
  return LOG_DIR;
}

module.exports = { initLogger, writeLog, closeLogger, getLogDir };

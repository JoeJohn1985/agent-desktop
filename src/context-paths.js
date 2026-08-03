'use strict';

// Single source of truth for WHERE each provider reads skills and agents from.
//
// This exists because the answer differs per provider and per scope, and getting
// it wrong is invisible: the sidebar would happily list skills a provider can't
// actually see (or hide ones it can), and nobody notices until a skill silently
// fails to apply. Every path decision lives here so there is exactly one place
// to correct when a CLI vendor changes their layout.
//
// The rule behind the table: CLI-backed providers (Copilot, Claude Code) discover
// their own files — we only mirror their native locations so the UI can show the
// truth. Direct-API providers have no CLI, so the app both scans and injects for
// them, and therefore gets to pick its own (vendor-neutral) location.

const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./data-dir');

/** Project-level folder for everything the app itself manages, per project. */
const PROJECT_DIR_NAME = '.agent-desktop';

/** Providers with no skills/agents support at all (see PROVIDER_CAPABILITIES). */
const UNSUPPORTED_PROVIDERS = new Set(['gemini']);

/**
 * Directories a provider reads SKILLS from, in priority order.
 *
 * - copilot: its CLI's own layout. `skillsDirOverride` mirrors the configurable
 *   folder setting; builtin + marketplace-mirrored skills are handled separately
 *   in main.js since they aren't a plain directory scan.
 * - claude-code: Claude's native layout. Both are discovered by Claude Code
 *   itself — the app must NOT inject an index for them, it would just duplicate
 *   what the CLI already loads.
 * - direct-API providers: app-managed, deliberately not under `.github/`
 *   (that's GitHub Copilot's convention, not a cross-vendor standard).
 *
 * @param {string} provider
 * @param {string|null} cwd - Active project directory, or null for global-only.
 * @param {{skillsDirOverride?: string}} [opts]
 * @returns {{global: string[], project: string[]}}
 */
function skillDirs(provider, cwd, opts = {}) {
  if (UNSUPPORTED_PROVIDERS.has(provider)) return { global: [], project: [] };

  if (provider === 'copilot') {
    return {
      global: [opts.skillsDirOverride || path.join(os.homedir(), '.copilot', 'skills')],
      project: cwd ? [path.join(cwd, '.github', 'skills')] : [],
    };
  }

  if (provider === 'claude-code') {
    return {
      global: [path.join(os.homedir(), '.claude', 'skills')],
      project: cwd ? [path.join(cwd, '.claude', 'skills')] : [],
    };
  }

  return {
    global: [path.join(DATA_DIR, provider, 'skills')],
    project: cwd ? [path.join(cwd, PROJECT_DIR_NAME, 'skills')] : [],
  };
}

/**
 * Directories a provider reads AGENTS from, in priority order.
 * Same rationale as skillDirs().
 * @param {string} provider
 * @param {string|null} cwd
 * @param {{agentsDirOverride?: string}} [opts]
 * @returns {{global: string[], project: string[]}}
 */
function agentDirs(provider, cwd, opts = {}) {
  if (UNSUPPORTED_PROVIDERS.has(provider)) return { global: [], project: [] };

  if (provider === 'copilot') {
    return {
      global: [opts.agentsDirOverride || path.join(os.homedir(), '.copilot', 'agents')],
      project: cwd ? [path.join(cwd, '.github', 'agents')] : [],
    };
  }

  if (provider === 'claude-code') {
    return {
      global: [path.join(os.homedir(), '.claude', 'agents')],
      project: cwd ? [path.join(cwd, '.claude', 'agents')] : [],
    };
  }

  return {
    global: [path.join(DATA_DIR, provider, 'agents')],
    project: cwd ? [path.join(cwd, PROJECT_DIR_NAME, 'agents')] : [],
  };
}

/**
 * Whether the app has to inject a skills/agents index into the prompt for this
 * provider. False for CLI-backed providers: they discover their own files, so
 * injecting would load everything twice and waste context.
 * @param {string} provider
 * @returns {boolean}
 */
function needsContextInjection(provider) {
  if (UNSUPPORTED_PROVIDERS.has(provider)) return false;
  return provider !== 'copilot' && provider !== 'claude-code';
}

module.exports = {
  skillDirs,
  agentDirs,
  needsContextInjection,
  PROJECT_DIR_NAME,
  UNSUPPORTED_PROVIDERS,
};

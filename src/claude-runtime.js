'use strict';

const fs = require('fs');
const path = require('path');
const manifest = require('../package.json');

const PACKAGE_NAME = '@agentclientprotocol/claude-agent-acp';
const RELEASE_VERSION = manifest.dependencies[PACKAGE_NAME];
const SDK_VERSION = manifest.dependencies['@anthropic-ai/claude-agent-sdk'];
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function selection(prefs = {}) {
  const override = prefs.settings?.devMode === true && prefs.claudeCodeAdapterDeveloperVersion;
  if (override && !EXACT_VERSION.test(override)) throw new Error('Ungültige Claude-Entwicklerversion');
  return { version: override || RELEASE_VERSION, developerOverride: Boolean(override && override !== RELEASE_VERSION) };
}

function bundledPaths({ appPath = path.join(__dirname, '..'), platform = process.platform, arch = process.arch } = {}) {
  const root = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js');
  const nativeName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const native = path.join(modules, nativeName, platform === 'win32' ? 'claude.exe' : 'claude');
  for (const [file, version] of [
    [path.join(modules, PACKAGE_NAME, 'package.json'), RELEASE_VERSION],
    [path.join(modules, '@anthropic-ai/claude-agent-sdk', 'package.json'), SDK_VERSION],
    [path.join(modules, nativeName, 'package.json'), SDK_VERSION],
  ]) {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).version !== version) {
      throw new Error(`Claude-Release-Runtime unvollständig oder abweichend: ${file}`);
    }
  }
  for (const file of [entry, native]) {
    if (!fs.existsSync(file)) throw new Error(`Claude-Release-Datei fehlt: ${file}. App neu installieren (optionale Dependencies benötigt).`);
  }
  return { entry, native };
}

function localOptions(prefs, options = {}) {
  const chosen = selection(prefs);
  const common = {
    localCommandStdout: true, useConfigOptions: true, mcpServers: [],
    stripEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_EXECUTABLE'],
  };
  if (chosen.developerOverride) {
    return { ...common, command: 'npx', baseArgs: ['-y', `${PACKAGE_NAME}@${chosen.version}`], shell: true };
  }
  const { entry } = bundledPaths(options);
  return {
    ...common, command: options.execPath || process.execPath, baseArgs: [entry], shell: false,
    env: { ELECTRON_RUN_AS_NODE: '1', DISABLE_AUTOUPDATER: '1' },
  };
}

module.exports = { PACKAGE_NAME, RELEASE_VERSION, SDK_VERSION, EXACT_VERSION, selection, bundledPaths, localOptions };

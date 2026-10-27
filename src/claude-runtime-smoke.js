'use strict';

// Metadata only: never send session/prompt or read the user's Claude home.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { localOptions, bundledPaths } = require('./claude-runtime');

async function smoke(appPath, execPath) {
  const fixture = path.resolve('dist', `claude-smoke-${process.pid}`);
  const options = localOptions({}, { appPath, execPath });
  fs.mkdirSync(fixture, { recursive: true });
  const env = {
    ...process.env, ...options.env,
    HOME: fixture, USERPROFILE: fixture, CLAUDE_CONFIG_DIR: fixture,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '', npm_config_offline: 'true',
    NODE_OPTIONS: '', NODE_PATH: '', CLAUDE_AGENT_LOGS: path.join(fixture, 'logs'),
    AGENT_DESKTOP_SMOKE_MODULE_ROOT: path.resolve(path.dirname(options.baseArgs[0]), '..', '..', '..'),
  };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_EXECUTABLE|AWS_|GOOGLE_)/.test(key)) delete env[key];
  }
  const child = spawn(options.command, [
    '--require', path.join(__dirname, 'claude-runtime-smoke-guard.js'), ...options.baseArgs,
  ], { cwd: fixture, env, shell: false, windowsHide: true });
  const pending = new Map();
  child.on('error', error => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  });
  let buffer = '', stderr = '', nextId = 0;
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    }
  });
  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timeout: ${stderr.slice(-1000)}`)), 30000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  try {
    const initialized = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'release-smoke', version: '1' } });
    if (initialized.protocolVersion !== 1) throw new Error('ACP v1 negotiation failed');
    const session = await request('session/new', { cwd: fixture, mcpServers: [] });
    if (!session.sessionId) throw new Error('Missing session id');
    const configChanges = [];
    for (const [configId, value] of [['mode', 'plan'], ['model', 'sonnet'], ['effort', 'medium']]) {
      const result = await request('session/set_config_option', { sessionId: session.sessionId, configId, value });
      if (!result.configOptions?.some(option => option.id === configId && option.currentValue === value)) {
        throw new Error(`Config change failed: ${configId}`);
      }
      configChanges.push({ configId, value });
    }
    let missingSessionRejected = false;
    try {
      await request('session/load', { sessionId: '00000000-0000-0000-0000-000000000000', cwd: fixture, mcpServers: [] });
    } catch (error) {
      if (/timeout/.test(error.message)) throw error;
      missingSessionRejected = true;
    }
    if (!missingSessionRejected) throw new Error('Missing session unexpectedly loaded');
    const fixtureSession = '11111111-1111-4111-8111-111111111111';
    const project = path.join(fixture, 'projects', fixture.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(project, { recursive: true });
    const transcript = {
      type: 'user', uuid: '22222222-2222-4222-8222-222222222222', parentUuid: null,
      sessionId: fixtureSession, cwd: fixture, version: '2.1.310',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Synthetic transcript fixture, not a model request.' },
    };
    fs.writeFileSync(path.join(project, `${fixtureSession}.jsonl`), JSON.stringify(transcript) + '\n');
    const loaded = await request('session/load', { sessionId: fixtureSession, cwd: fixture, mcpServers: [] });
    if (!loaded.configOptions?.some(option => option.id === 'model')) throw new Error('Fixture session load failed');
    const { native } = bundledPaths({ appPath });
    const version = spawnSync(native, ['--version'], { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (version.status !== 0) throw new Error(`Native CLI failed: ${version.stderr}`);
    console.log(JSON.stringify({
      appPath, native, nativeVersion: version.stdout.trim(),
      agentInfo: initialized.agentInfo, protocolVersion: initialized.protocolVersion,
      models: session.configOptions.find(option => option.id === 'model').options.length,
      modes: session.modes.availableModes.length, configChanges, missingSessionRejected, fixtureSessionLoaded: true,
    }, null, 2));
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    if (child.exitCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (require.main === module) {
  smoke(path.resolve(process.argv[2] || '.'), process.argv[3] || require('electron')).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { smoke };

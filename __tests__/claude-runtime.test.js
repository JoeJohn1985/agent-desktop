'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const runtime = require('../src/claude-runtime');
const manifest = require('../package.json');
const { buildAdapterCommand } = require('../src/ssh-remote');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { parseUsageWindows } = require('../src/renderer-logic');

describe('Claude release selection', () => {
  test.each([{}, { claudeCodeAdapterVersion: '0.73.0' }, { settings: { devMode: true }, claudeCodeAdapterVersion: '0.77.0' },
    { settings: { devMode: false }, claudeCodeAdapterDeveloperVersion: '0.96.0' },
    { settings: { devMode: true }, claudeCodeAdapterDeveloperVersion: '0.97.0' }])('ignores obsolete or disabled pins: %j', prefs => {
    expect(runtime.selection(prefs)).toEqual({ version: '0.97.0', developerOverride: false });
  });
  test('only explicit developer preference overrides', () => {
    expect(runtime.selection({ settings: { devMode: true }, claudeCodeAdapterDeveloperVersion: '0.96.0' }))
      .toEqual({ version: '0.96.0', developerOverride: true });
  });
  test.each(['latest', '0.97.0;echo bad', '0.97.0-beta.1', '*'])('rejects unsafe/nonexact versions %s', version => {
    expect(() => runtime.selection({ settings: { devMode: true }, claudeCodeAdapterDeveloperVersion: version })).toThrow();
  });
  test('local release never uses npx, shell or system Claude', () => {
    const options = runtime.localOptions({ claudeCodeAdapterVersion: '0.70.0' }, { execPath: 'electron.exe' });
    expect(options.command).toBe('electron.exe');
    expect(options.shell).toBe(false);
    expect(options.baseArgs).toEqual([expect.stringMatching(/node_modules.*claude-agent-acp.*index\.js$/)]);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(options.stripEnv).toContain('CLAUDE_CODE_EXECUTABLE');
    expect(options.stripEnv).toContain('ANTHROPIC_API_KEY');
  });
  test('developer launch and SSH both use exact selected version', () => {
    const prefs = { settings: { devMode: true }, claudeCodeAdapterDeveloperVersion: '0.96.0' };
    expect(runtime.localOptions(prefs).baseArgs).toEqual(['-y', `${runtime.PACKAGE_NAME}@0.96.0`]);
    expect(buildAdapterCommand('/project with spaces', `${runtime.PACKAGE_NAME}@${runtime.selection(prefs).version}`))
      .toContain("exec npx -y '@agentclientprotocol/claude-agent-acp@0.96.0'");
    expect(buildAdapterCommand('/project', `${runtime.PACKAGE_NAME}@${runtime.selection({ claudeCodeAdapterVersion: '0.1.0' }).version}`))
      .toContain('@agentclientprotocol/claude-agent-acp@0.97.0');
  });
});

describe('release packaging contract', () => {
  const fixture = path.resolve('dist', `runtime-test-${process.pid}`);
  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));
  test('packaged resolver uses physical unpacked paths and fails if native binary is absent', () => {
    const appPath = path.join(fixture, 'resources', 'app.asar');
    const root = `${appPath}.unpacked`;
    const files = [
      ['@agentclientprotocol/claude-agent-acp', runtime.RELEASE_VERSION, 'dist/index.js'],
      ['@anthropic-ai/claude-agent-sdk', runtime.SDK_VERSION, 'sdk.mjs'],
      ['@anthropic-ai/claude-agent-sdk-win32-x64', runtime.SDK_VERSION, 'claude.exe'],
    ];
    for (const [name, version, entry] of files) {
      const base = path.join(root, 'node_modules', name);
      fs.mkdirSync(path.dirname(path.join(base, entry)), { recursive: true });
      fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ version }));
      fs.writeFileSync(path.join(base, entry), '');
    }
    const resolved = runtime.bundledPaths({ appPath, platform: 'win32', arch: 'x64' });
    expect(resolved.entry).toContain('app.asar.unpacked');
    fs.unlinkSync(resolved.native);
    expect(() => runtime.bundledPaths({ appPath, platform: 'win32', arch: 'x64' })).toThrow('fehlt');
  });

  test('real 0.97.0 usage formatter remains readable, including fractional utilization', () => {
    const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'node_modules', runtime.PACKAGE_NAME, 'dist', 'usage-markdown.js')).href;
    const usage = {
      session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, model_usage: {} },
      subscription_type: 'pro', rate_limits_available: true, behaviors: null,
      rate_limits: {
        five_hour: { utilization: 12.5, resets_at: null },
        seven_day: { utilization: 40, resets_at: null },
        seven_day_opus: { utilization: 9, resets_at: null },
      },
    };
    const code = `import(${JSON.stringify(moduleUrl)}).then(m => console.log(m.formatUsageResponse(${JSON.stringify(usage)})))`;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const windows = parseUsageWindows(result.stdout);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({ rateLimitType: 'five_hour', utilization: 12.5 });
    expect(windows[1]).toMatchObject({ rateLimitType: 'seven_day', utilization: 40, secondary: false });
    expect(windows[2]).toMatchObject({ secondary: true, utilization: 9 });
  });

  test('checkout app update installs changed manifests including optional native packages', async () => {
    let head = 0;
    const exec = jest.spyOn(require('child_process'), 'execFile').mockImplementation((cmd, args, _options, callback) => {
      let output = '';
      if (args.includes('--is-inside-work-tree')) output = 'true';
      else if (args[0] === 'rev-parse') output = ++head === 1 ? 'before' : 'after';
      else if (args[0] === 'diff') output = 'package.json\npackage-lock.json\n';
      callback(null, output, '');
    });
    try {
      let updater;
      jest.isolateModules(() => { updater = require('../src/updater'); });
      expect((await updater.applyUpdate(path.join(__dirname, '..'))).depsInstalled).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/^npm(?:\.cmd)?$/),
        ['install', '--include=dev', '--include=optional', '--no-save', '--no-audit', '--no-fund'],
        expect.any(Object), expect.any(Function),
      );
    } finally {
      exec.mockRestore();
    }
  });
  test('SDK and native optional packages are exactly pinned and ship outside asar', () => {
    const sdk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8'));
    expect(manifest.dependencies[runtime.PACKAGE_NAME]).toBe(runtime.RELEASE_VERSION);
    expect(manifest.dependencies['@anthropic-ai/claude-agent-sdk']).toBe(runtime.SDK_VERSION);
    for (const version of Object.values(sdk.optionalDependencies)) expect(version).toBe(runtime.SDK_VERSION);
    expect(manifest.build.asarUnpack).toContain('node_modules/**');
    expect(runtime.bundledPaths().native).toBeTruthy();
  });
});

describe('main process developer guards and process preservation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  function handler(prefs) {
    let callback;
    const start = jest.fn().mockResolvedValue();
    const destroy = jest.fn().mockResolvedValue();
    const write = jest.fn().mockReturnValue(true);
    const source = main.match(/^ipcMain.handle\('claudecode:applyAdapterUpdate',[\s\S]*?^\}\);/m)[0];
    vm.runInNewContext(source, {
      ipcMain: { handle: (_name, fn) => { callback = fn; } },
      claudeRuntime: runtime, claudeAdapterUpdate: { PACKAGE_NAME: runtime.PACKAGE_NAME },
      readPreferences: () => prefs, writePreferences: write,
      AcpClient: function () { return { start, destroy }; },
      app: { getAppPath: () => path.join(__dirname, '..') },
    });
    return { callback, start, write };
  }
  test('normal user cannot invoke update IPC', async () => {
    const h = handler({});
    expect((await h.callback(null, '0.96.0')).ok).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  test('override persists only new preference and never tears down backends', async () => {
    const prefs = { settings: { devMode: true }, claudeCodeAdapterVersion: '0.1.0' };
    const h = handler(prefs);
    expect((await h.callback(null, '0.96.0')).ok).toBe(true);
    expect(prefs.claudeCodeAdapterDeveloperVersion).toBe('0.96.0');
    expect(prefs.claudeCodeAdapterVersion).toBe('0.1.0');
    // No backends binding in this VM: accessing it would fail this test.
    expect(h.start).toHaveBeenCalledTimes(1);
  });
  test('returning to bundled release clears override without downloading', async () => {
    const prefs = { settings: { devMode: true }, claudeCodeAdapterDeveloperVersion: '0.96.0' };
    const h = handler(prefs);
    expect((await h.callback(null, runtime.RELEASE_VERSION)).ok).toBe(true);
    expect(prefs.claudeCodeAdapterDeveloperVersion).toBeUndefined();
    expect(h.start).not.toHaveBeenCalled();
  });
  test('main uses resolver locally and selected exact package over SSH', async () => {
    const source = main.match(/^async function claudeCodeClientOptions[\s\S]*?^\}/m)[0];
    const context = {
      claudeRuntime: runtime, claudeAdapterUpdate: { PACKAGE_NAME: runtime.PACKAGE_NAME },
      getClaudeAdapterVersion: () => runtime.RELEASE_VERSION, readPreferences: () => ({}),
      app: { getAppPath: () => path.join(__dirname, '..') },
      resolveSshExecutable: async () => 'ssh.exe',
      sshRemote: require('../src/ssh-remote'), sshPasswordEnv: () => ({}), process,
    };
    vm.runInNewContext(source, context);
    const local = await context.claudeCodeClientOptions('C:\\fixture');
    expect(local.shell).toBe(false);
    expect(local.command).toBe(process.execPath);
    const remote = await context.claudeCodeClientOptions('/remote', { sshHost: 'test-alias' });
    expect(remote.command).toBe('ssh.exe');
    expect(remote.shell).toBe(false);
    expect(remote.baseArgs).toContain('test-alias');
    expect(remote.baseArgs.at(-1)).toContain(`@agentclientprotocol/claude-agent-acp@${runtime.RELEASE_VERSION}`);
    expect(remote.baseArgs.at(-1)).toContain('unset CLAUDE_CODE_EXECUTABLE ANTHROPIC_API_KEY');
    expect(remote.env).toEqual({});
    expect(remote.spawnCwd).toBe(process.cwd());
  });
  test.each(['login', 'logout'])('Windows %s terminal invokes bundled native CLI, not a system install', async action => {
    const { EventEmitter } = require('events');
    const child = new EventEmitter();
    child.unref = jest.fn();
    const spawn = jest.fn(() => {
      process.nextTick(() => child.emit('spawn'));
      return child;
    });
    const source = main.match(/^async function claudeAuthTerminal[\s\S]*?^\}/m)[0];
    const context = {
      claudeRuntime: runtime, app: { getAppPath: () => path.join(__dirname, '..') },
      process: { platform: 'win32' }, Buffer, spawn, console,
    };
    vm.runInNewContext(source, context);
    expect((await context.claudeAuthTerminal(action)).success).toBe(true);
    const encoded = spawn.mock.calls[0][0].split('-EncodedCommand ')[1];
    const command = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(command).toContain(runtime.bundledPaths().native);
    expect(command).toContain(`auth ${action}`);
    expect(command).not.toContain('npm');
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const readConfigSource = main.match(/^function readCopilotConfig\(\) \{[\s\S]*?^\}/m)[0];

function authHandlers(raw, { exists = true, spawnError = false } = {}) {
  const handlers = new Map();
  const unref = jest.fn();
  const spawn = jest.fn(() => {
    if (spawnError) throw new Error('terminal unavailable');
    return { unref };
  });
  const context = {
    fs: { existsSync: () => exists, readFileSync: () => raw },
    os: { homedir: () => 'C:\\fixture-home' },
    path,
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    process: { platform: 'win32' },
    require: () => ({ spawn }),
  };
  const checkSource = main.match(/^ipcMain.handle\('auth:check',[\s\S]*?^\}\);/m)[0];
  const loginSource = main.match(/^ipcMain.handle\('auth:login',[\s\S]*?^\}\);/m)[0];
  vm.runInNewContext(`${readConfigSource}\n${checkSource}\n${loginSource}`, context);
  return { check: handlers.get('auth:check'), login: handlers.get('auth:login'), spawn, unref };
}

describe('Regular Copilot authentication without setup wizard', () => {
  test.each([
    ['testuser', 'https://github.com'],
    ['my-org-user', 'https://github.com'],
  ])('auth:check preserves login %s and host', async (login, host) => {
    const { check } = authHandlers(JSON.stringify({ lastLoggedInUser: { login, host } }));
    await expect(check()).resolves.toEqual({ success: true, authenticated: true, user: login, host });
  });

  test.each([
    '{}',
    '{"firstLaunchAt":"2026-01-01"}',
    '{"lastLoggedInUser":{"host":"https://github.com"}}',
    '{"trustedFolders":["C:\\\\DEV"]}',
    '{broken json',
    '',
  ])('auth:check tolerates missing user or invalid config: %s', async raw => {
    await expect(authHandlers(raw).check()).resolves.toEqual({
      success: true, authenticated: false, user: null,
    });
  });

  test('auth:check handles missing config without writing user data', async () => {
    await expect(authHandlers(null, { exists: false }).check()).resolves.toEqual({
      success: true, authenticated: false, user: null,
    });
  });

  test('auth:check accepts config comments', async () => {
    const { check } = authHandlers('// Managed config\n{"lastLoggedInUser":{"login":"commentuser"}}');
    expect((await check()).user).toBe('commentuser');
  });

  test('auth:login still opens the terminal-based login flow (mocked)', async () => {
    const { login, spawn, unref } = authHandlers('{}');
    await expect(login()).resolves.toEqual({ success: true, pendingInTerminal: true, error: null });
    expect(spawn).toHaveBeenCalledWith(expect.stringContaining('copilot login'), expect.objectContaining({
      shell: true, detached: true, windowsHide: false,
    }));
    expect(unref).toHaveBeenCalledTimes(1);
  });

  test('auth:login reports terminal errors', async () => {
    await expect(authHandlers('{}', { spawnError: true }).login()).resolves.toEqual({
      success: false, pendingInTerminal: false, error: 'terminal unavailable',
    });
  });
});

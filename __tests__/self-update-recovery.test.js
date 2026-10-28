'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

it('manueller Check bietet Reparatur bei unverändertem Remote-HEAD', async () => {
  const banner = jest.fn();
  const updates = { check: async () => ({ ok: true, updateAvailable: false, currentVersion: '1', latestVersion: '1' }) };
  const context = {
    window: { desktop: { updates } }, desktop: { updates },
    document: { getElementById: () => ({ textContent: '' }) },
    showNotification: jest.fn(), banner,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'self-update.js'), 'utf8'), context);
  await vm.runInContext('showUpdateBanner = banner; checkForUpdates({ silent: false })', context);
  expect(banner).toHaveBeenCalledWith('1', '1', true);
});

it('UI bietet nach non-ok Reparatur statt Neustart an', async () => {
  const btn = { disabled: false, textContent: '' };
  const text = { textContent: '' };
  const notify = jest.fn();
  const context = {
    document: { getElementById: () => btn },
    desktop: { updates: { apply: jest.fn().mockResolvedValue({ ok: false, codeUpdated: true, reason: 'npm-install-failed', error: 'network' }) } },
    showNotification: notify,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'self-update.js'), 'utf8'), context);
  context.bar = { querySelector: () => text };
  await vm.runInContext('applyUpdate(bar)', context);
  expect(btn.disabled).toBe(false);
  expect(btn.textContent).toMatch(/Reparatur/);
  expect(text.textContent).toMatch(/nicht neu starten/);
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('fehlgeschlagen'), 'error');
});

it('Main IPC plant bei fehlgeschlagenem Update keinen Relaunch', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const handler = source.slice(source.indexOf("ipcMain.handle('updates:apply'"), source.indexOf('/**', source.indexOf("ipcMain.handle('updates:apply'")));
  const timeout = jest.fn();
  let apply;
  vm.runInNewContext(handler, {
    ipcMain: { handle: (_name, callback) => { apply = callback; } },
    updater: { applyUpdate: async () => ({ ok: false, reason: 'dependency-validation-failed' }) },
    REPO_DIR: 'fixture', setTimeout: timeout, console,
  });
  expect((await apply()).ok).toBe(false);
  expect(timeout).not.toHaveBeenCalled();
});

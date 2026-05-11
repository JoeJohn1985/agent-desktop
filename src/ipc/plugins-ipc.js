// ── Plugins IPC Handlers ────────────────────────────────────
// Plugin management via copilot CLI: list, install, uninstall, update, marketplace
'use strict';

const { ipcMain } = require('electron');

// Validate plugin/marketplace identifiers — only allow safe characters
// Valid: alphanumeric, hyphens, underscores, dots, slashes, @, colons (for URLs)
const SAFE_PLUGIN_NAME = /^[a-zA-Z0-9_\-\.@\/:]+$/;

function validatePluginArg(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  return SAFE_PLUGIN_NAME.test(value);
}

function registerPluginsIPC() {

  ipcMain.handle('plugin:list', async () => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'list'], {
        timeout: 15000,
      }, (_error, stdout, stderr) => {
        try {
          const output = (stdout || '').trim();
          if (!output || output.includes('No plugins installed')) {
            return resolve({ success: true, plugins: [] });
          }

          const plugins = [];
          const lines = output.split('\n');
          for (const line of lines) {
            const match = line.match(/•\s+(\S+)\s+\(([^)]+)\)\s+v?(\S+)(\s+\[update available\])?/i);
            if (match) {
              plugins.push({
                name: match[1],
                marketplace: match[2],
                version: match[3],
                updateAvailable: !!match[4],
              });
            }
          }
          resolve({ success: true, plugins });
        } catch (parseErr) {
          resolve({
            success: false,
            plugins: [],
            error: stderr || stdout || parseErr.message,
          });
        }
      });
    });
  });

  ipcMain.handle('plugin:install', async (_event, target) => {
    if (!validatePluginArg(target)) {
      return { success: false, message: 'Ungültiger Plugin-Name', error: 'Invalid plugin target' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'install', target], {
        timeout: 60000,
      }, (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            message: stderr || stdout || error.message,
            error: stderr || error.message,
          });
        }
        resolve({
          success: true,
          message: (stdout || '').trim() || 'Plugin installiert.',
        });
      });
    });
  });

  ipcMain.handle('plugin:uninstall', async (_event, name) => {
    if (!validatePluginArg(name)) {
      return { success: false, message: 'Ungültiger Plugin-Name', error: 'Invalid plugin name' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'uninstall', name], {
        timeout: 30000,
      }, (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            message: stderr || stdout || error.message,
            error: stderr || error.message,
          });
        }
        resolve({
          success: true,
          message: (stdout || '').trim() || 'Plugin deinstalliert.',
        });
      });
    });
  });

  ipcMain.handle('plugin:update', async (_event, name) => {
    if (!validatePluginArg(name)) {
      return { success: false, message: 'Ungültiger Plugin-Name', error: 'Invalid plugin name' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'update', name], {
        timeout: 60000,
      }, (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            message: stderr || stdout || error.message,
            error: stderr || error.message,
          });
        }
        resolve({
          success: true,
          message: (stdout || '').trim() || 'Plugin aktualisiert.',
        });
      });
    });
  });

  ipcMain.handle('plugin:marketplace-list', async () => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'marketplace', 'list'], {
        timeout: 15000,
      }, (_error, stdout, stderr) => {
        try {
          const output = (stdout || '').trim();
          if (!output) {
            return resolve({ success: true, marketplaces: [] });
          }

          const defaultMarketplaces = [];
          const customMarketplaces = [];
          const lines = output.split('\n');
          for (const line of lines) {
            const match = line.match(/([◆•])\s+(\S+)\s+\((\w+):\s*(.+)\)/);
            if (match) {
              const entry = {
                name: match[2],
                type: match[3],
                source: match[4].trim(),
              };
              if (match[1] === '•') {
                customMarketplaces.push(entry); // registered (newest last → reverse for newest first)
              } else {
                defaultMarketplaces.push(entry);
              }
            }
          }
          // Newest registered marketplace first, then defaults
          const marketplaces = [...customMarketplaces.reverse(), ...defaultMarketplaces];
          resolve({ success: true, marketplaces });
        } catch (parseErr) {
          resolve({
            success: false,
            marketplaces: [],
            error: stderr || stdout || parseErr.message,
          });
        }
      });
    });
  });

  ipcMain.handle('plugin:marketplace-browse', async (_event, name) => {
    if (!validatePluginArg(name)) {
      return { success: false, name, plugins: [], error: 'Ungültiger Marketplace-Name' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'marketplace', 'browse', name], {
        timeout: 60000,
      }, (error, stdout, stderr) => {
        try {
          if (error) {
            const errMsg = (stderr || stdout || error.message || '').trim();
            return resolve({ success: false, name, plugins: [], error: errMsg });
          }

          const output = (stdout || '').trim();
          const plugins = [];
          const lines = output.split('\n');
          for (const line of lines) {
            const match = line.match(/•\s+(\S+)\s+-\s+(.+)/);
            if (match) {
              plugins.push({
                name: match[1],
                description: match[2].trim(),
              });
            }
          }
          resolve({ success: true, name, plugins });
        } catch (parseErr) {
          resolve({
            success: false,
            name,
            plugins: [],
            error: stderr || stdout || parseErr.message,
          });
        }
      });
    });
  });

  ipcMain.handle('plugin:marketplace-add', async (_event, source) => {
    if (!source || typeof source !== 'string' || source.length > 500) {
      return { success: false, error: 'Ungültige Marketplace-Quelle' };
    }
    const isUrl = source.startsWith('http://') || source.startsWith('https://');
    if (!isUrl && !SAFE_PLUGIN_NAME.test(source)) {
      return { success: false, error: 'Ungültige Marketplace-Quelle' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'marketplace', 'add', source], {
        timeout: 30000,
      }, (error, stdout, stderr) => {
        if (error) {
          const errMsg = (stderr || stdout || error.message || '').trim();
          return resolve({ success: false, error: errMsg });
        }
        const output = (stdout || '').trim();
        const nameMatch = output.match(/added.*?[""]?(\S+)[""]?/i) || output.match(/(\S+)/);
        resolve({
          success: true,
          name: nameMatch ? nameMatch[1] : source,
          message: output || 'Marketplace hinzugefügt.',
        });
      });
    });
  });

  ipcMain.handle('plugin:marketplace-remove', async (_event, name) => {
    if (!validatePluginArg(name)) {
      return { success: false, error: 'Ungültiger Marketplace-Name' };
    }
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('copilot', ['plugin', 'marketplace', 'remove', name], {
        timeout: 15000,
      }, (error, stdout, stderr) => {
        if (error) {
          const errMsg = (stderr || stdout || error.message || '').trim();
          return resolve({ success: false, error: errMsg });
        }
        resolve({
          success: true,
          message: (stdout || '').trim() || 'Marketplace entfernt.',
        });
      });
    });
  });
}

module.exports = { registerPluginsIPC, validatePluginArg };

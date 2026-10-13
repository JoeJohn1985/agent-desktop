'use strict';

function registerAppMcpIPC({ ipcMain, manager }) {
  function handler(channel, action) {
    return async (_event, ...args) => {
      try {
        await action(...args);
        return { success: true, servers: manager.list() };
      } catch (e) {
        console.error(`[${channel}]`, e.message);
        return { success: false, error: e.message };
      }
    };
  }
  ipcMain.handle('mcp:save', handler('mcp:save', input => manager.save(input)));
  ipcMain.handle('mcp:remove', handler('mcp:remove', id => manager.remove(id)));
  ipcMain.handle('mcp:connect', handler('mcp:connect', id => manager.connect(id, true)));
  ipcMain.handle('mcp:disconnect', handler('mcp:disconnect', (id, logout) => manager.disconnect(id, logout === true)));
}

module.exports = { registerAppMcpIPC };

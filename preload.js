const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copilot', {
  // Terminal (multi-tab)
  terminal: {
    create: (command, cols, rows) => ipcRenderer.invoke('terminal:create', command, cols, rows),
    write: (tabId, data) => ipcRenderer.send('terminal:input', tabId, data),
    resize: (tabId, cols, rows) => ipcRenderer.send('terminal:resize', tabId, cols, rows),
    close: (tabId) => ipcRenderer.send('terminal:close', tabId),
    onData: (cb) => ipcRenderer.on('terminal:data', (_e, tabId, data) => cb(tabId, data)),
    onExit: (cb) => ipcRenderer.on('terminal:exit', (_e, tabId, code) => cb(tabId, code)),
  },
  // Sessions
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    readCheckpoints: (id) => ipcRenderer.invoke('sessions:readCheckpoints', id),
    readPlan: (id) => ipcRenderer.invoke('sessions:readPlan', id),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
  },
  // Config
  config: {
    read: () => ipcRenderer.invoke('config:read'),
  },
  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
  },
  // Window
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});

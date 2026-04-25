const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Markdown + Syntax Highlighting ──────────────────────────
let markdownRender = (text) => text; // fallback: plain text
try {
  const { marked } = require('marked');
  const hljs = require('highlight.js/lib/common');

  marked.use({
    renderer: {
      code(obj) {
        const lang = obj.lang || '';
        const text = obj.text || '';
        let highlighted;
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(text, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(text).value;
        }
        return '<pre><code class="hljs">' + highlighted + '</code></pre>';
      }
    },
    breaks: true,
    gfm: true,
  });

  markdownRender = (text) => marked.parse(text);
} catch (e) {
  console.warn('Markdown/highlight.js not available:', e.message);
}

contextBridge.exposeInMainWorld('markdown', {
  render: markdownRender,
});

contextBridge.exposeInMainWorld('copilot', {
  // Chat (JSONL-based communication)
  chat: {
    newTab: () => ipcRenderer.invoke('copilot:newTab'),
    send: (tabId, prompt, options) => ipcRenderer.invoke('copilot:send', tabId, prompt, options),
    stop: (tabId) => ipcRenderer.send('copilot:stop', tabId),
    getCwd: () => ipcRenderer.invoke('copilot:getCwd'),
    openCwd: () => ipcRenderer.invoke('copilot:openCwd'),
    getVersions: () => ipcRenderer.invoke('copilot:getVersions'),
    getInstructions: () => ipcRenderer.invoke('copilot:getInstructions'),
    onEvent: (cb) => ipcRenderer.on('copilot:event', (_e, tabId, event) => cb(tabId, event)),
    onDone: (cb) => ipcRenderer.on('copilot:done', (_e, tabId, code) => cb(tabId, code)),
  },
  // Sessions
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    readCheckpoints: (id) => ipcRenderer.invoke('sessions:readCheckpoints', id),
    readPlan: (id) => ipcRenderer.invoke('sessions:readPlan', id),
    rename: (id, name) => ipcRenderer.invoke('sessions:rename', id, name),
    create: (name) => ipcRenderer.invoke('sessions:create', name),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
  },
  // Todos (per session)
  todos: {
    list: (sessionId) => ipcRenderer.invoke('todos:list', sessionId),
    add: (sessionId, todo) => ipcRenderer.invoke('todos:add', sessionId, todo),
    update: (sessionId, todoId, updates) => ipcRenderer.invoke('todos:update', sessionId, todoId, updates),
    delete: (sessionId, todoId) => ipcRenderer.invoke('todos:delete', sessionId, todoId),
    reorder: (sessionId, orderedIds) => ipcRenderer.invoke('todos:reorder', sessionId, orderedIds),
  },
  // Images
  images: {
    list: () => ipcRenderer.invoke('images:list'),
    open: (filePath) => ipcRenderer.invoke('images:open', filePath),
    delete: (filePath) => ipcRenderer.invoke('images:delete', filePath),
    openFolder: () => ipcRenderer.invoke('images:openFolder'),
    onChanged: (cb) => ipcRenderer.on('images:changed', cb),
  },
  // Config
  config: {
    read: () => ipcRenderer.invoke('config:read'),
  },
  // Instructions
  instructions: {
    getShellExceptions: () => ipcRenderer.invoke('instructions:getShellExceptions'),
    setShellExceptions: (exceptions) => ipcRenderer.invoke('instructions:setShellExceptions', exceptions),
  },
  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
  },
  // Context (silent /context query)
  context: {
    fetch: (tabId) => ipcRenderer.invoke('context:fetch', tabId),
  },
  // Terminal (interactive PTY for slash commands)
  terminal: {
    available: () => ipcRenderer.invoke('terminal:available'),
    spawn: (tabId, sessionId, slashCommand) => ipcRenderer.invoke('terminal:spawn', tabId, sessionId, slashCommand),
    input: (tabId, data) => ipcRenderer.send('terminal:input', tabId, data),
    resize: (tabId, cols, rows) => ipcRenderer.send('terminal:resize', tabId, cols, rows),
    close: (tabId) => ipcRenderer.send('terminal:close', tabId),
    onData: (cb) => ipcRenderer.on('terminal:data', (_e, tabId, data) => cb(tabId, data)),
    onExit: (cb) => ipcRenderer.on('terminal:exit', (_e, tabId, code) => cb(tabId, code)),
  },
  // Window
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  // File utilities
  files: {
    getPath: (file) => webUtils.getPathForFile(file),
    processDropped: (filePath) => ipcRenderer.invoke('files:processDropped', filePath),
  },
});

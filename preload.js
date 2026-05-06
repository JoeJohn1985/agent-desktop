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

  // DOMPurify for XSS prevention
  const DOMPurify = require('dompurify');
  markdownRender = (text) => DOMPurify.sanitize(marked.parse(text), {
    ADD_TAGS: ['pre', 'code'],
    ADD_ATTR: ['class'],
  });
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
    onEvent: (cb) => {
      const handler = (_e, tabId, event) => cb(tabId, event);
      ipcRenderer.on('copilot:event', handler);
      return () => ipcRenderer.removeListener('copilot:event', handler);
    },
    onDone: (cb) => {
      const handler = (_e, tabId, code) => cb(tabId, code);
      ipcRenderer.on('copilot:done', handler);
      return () => ipcRenderer.removeListener('copilot:done', handler);
    },
  },
  // Sessions
  sessions: {
    readCheckpoints: (id) => ipcRenderer.invoke('sessions:readCheckpoints', id),
    readPlan: (id) => ipcRenderer.invoke('sessions:readPlan', id),
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
    onChanged: (cb) => {
      ipcRenderer.on('images:changed', cb);
      return () => ipcRenderer.removeListener('images:changed', cb);
    },
  },
  videos: {
    extractFrames: (videoPath, options) => ipcRenderer.invoke('videos:extractFrames', videoPath, options),
  },
  // Preferences (file-based persistent settings)
  preferences: {
    read: () => ipcRenderer.invoke('preferences:read'),
    write: (prefs) => ipcRenderer.invoke('preferences:write', prefs),
  },
  // Folders
  folders: {
    read: () => ipcRenderer.invoke('folders:read'),
    save: (config) => ipcRenderer.invoke('folders:save', config),
    browse: () => ipcRenderer.invoke('folders:browse'),
    browseFile: (filters) => ipcRenderer.invoke('folders:browse-file', filters),
  },

  // Instructions
  instructions: {
    read: () => ipcRenderer.invoke('instructions:read'),
    write: (content) => ipcRenderer.invoke('instructions:write', content),
  },

  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
  },
  // Tests
  tests: {
    run: () => ipcRenderer.invoke('tests:run'),
    e2e: () => ipcRenderer.invoke('tests:e2e'),
    coverage: () => ipcRenderer.invoke('tests:coverage'),
  },
  // Dev Console
  devConsole: {
    onLog: (cb) => {
      const handler = (_e, entry) => cb(entry);
      ipcRenderer.on('dev-console:log', handler);
      return () => ipcRenderer.removeListener('dev-console:log', handler);
    },
  },
  // Terminal (interactive PTY for slash commands)
  terminal: {
    available: () => ipcRenderer.invoke('terminal:available'),
    spawn: (tabId, sessionId, slashCommand) => ipcRenderer.invoke('terminal:spawn', tabId, sessionId, slashCommand),
    spawnBackground: (tabId, sessionId) => ipcRenderer.invoke('terminal:spawn-background', tabId, sessionId),
    getBuffer: (tabId) => ipcRenderer.invoke('terminal:get-buffer', tabId),
    sendCommand: (tabId, command) => ipcRenderer.invoke('terminal:send-command', tabId, command),
    fetchContext: (tabId) => ipcRenderer.invoke('terminal:fetch-context', tabId),
    sendSlash: (tabId, command) => ipcRenderer.invoke('terminal:send-slash', tabId, command),
    input: (tabId, data) => ipcRenderer.send('terminal:input', tabId, data),
    resize: (tabId, cols, rows) => ipcRenderer.send('terminal:resize', tabId, cols, rows),
    close: (tabId) => ipcRenderer.send('terminal:close', tabId),
    onData: (cb) => {
      const handler = (_e, tabId, data) => cb(tabId, data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (cb) => {
      const handler = (_e, tabId, code) => cb(tabId, code);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
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

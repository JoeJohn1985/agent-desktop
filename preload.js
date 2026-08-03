const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Markdown + Syntax Highlighting ──────────────────────────

/**
 * Renders Markdown to sanitized HTML with syntax highlighting.
 * Falls back to plain-text passthrough if marked/highlight.js are unavailable.
 *
 * @type {(text: string) => string}
 */
let markdownRender = (text) => text; // fallback: plain text
/**
 * Cheap variant for throttled mid-stream re-renders (~every 100ms while a
 * response streams): skips hljs entirely. hljs.highlightAuto() recompiles a
 * language's grammar into fresh RegExp/mode objects on every call (no cross-
 * call caching), and marked re-parses the whole accumulated response each
 * tick — so for an untagged code block, every single throttled tick was
 * re-running highlightAuto() across all common languages, on text that keeps
 * growing. That's the main source of the streaming-tab jank/memory growth.
 * Still gets full markdown formatting (bold/lists/headers/code blocks), just
 * without color — the final render (see `render`, called once the message is
 * complete) adds real highlighting.
 * @type {(text: string) => string}
 */
let markdownRenderFast = (text) => text;
try {
  const { marked, Marked } = require('marked');
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
  // Independent instance, default (non-highlighting) code renderer.
  const markedFast = new Marked({ breaks: true, gfm: true });

  // DOMPurify for XSS prevention
  const DOMPurify = require('dompurify');
  const purifyOpts = { ADD_TAGS: ['pre', 'code'], ADD_ATTR: ['class'] };
  markdownRender = (text) => DOMPurify.sanitize(marked.parse(text), purifyOpts);
  markdownRenderFast = (text) => DOMPurify.sanitize(markedFast.parse(text), purifyOpts);
} catch (e) {
  console.warn('Markdown/highlight.js not available:', e.message);
}

/** Exposes a safe markdown renderer to the renderer process. */
contextBridge.exposeInMainWorld('markdown', {
  render: markdownRender,
  renderFast: markdownRenderFast,
});

/**
 * IPC bridge: Exposes the `copilot.*` namespace to the renderer process
 * via Electron's contextBridge. All methods delegate to ipcRenderer.invoke
 * (request/response) or ipcRenderer.send (fire-and-forget).
 *
 * @namespace copilot
 */
contextBridge.exposeInMainWorld('copilot', {

  // ── Chat (JSONL-based communication) ──────────────────────

  /**
   * Chat API — spawns Copilot CLI processes and streams JSONL events.
   *
   * @namespace copilot.chat
   */
  chat: {
    /** @ipc copilot:newTab — Allocates a new tab ID. @returns {Promise<number>} */
    newTab: () => ipcRenderer.invoke('copilot:newTab'),
    /**
     * Sends a prompt to the Copilot CLI for the given tab.
     * @ipc copilot:send
     * @param {number} tabId - Target tab identifier
     * @param {string} prompt - User prompt text
     * @param {Object} [options] - Spawn options (model, sessionId, deniedTools, etc.)
     * @returns {Promise<number>} The tab ID
     */
    send: (tabId, prompt, options) => ipcRenderer.invoke('copilot:send', tabId, prompt, options),
    /**
     * Kills the running Copilot process for a tab.
     * @ipc copilot:stop
     * @param {number} tabId
     */
    stop: (tabId) => ipcRenderer.send('copilot:stop', tabId),
    /** @ipc copilot:restartWithDeniedTools — Restarts the ACP process with new denied tools, reloads session. */
    restartWithDeniedTools: (tabId, deniedTools) => ipcRenderer.invoke('copilot:restartWithDeniedTools', tabId, deniedTools),
    /** @ipc copilot:silentCommand — Runs a slash command silently, returns {success, text}. */
    silentCommand: (tabId, command, timeoutMs) => ipcRenderer.invoke('copilot:silentCommand', tabId, command, timeoutMs),
    /** @ipc copilot:respondPermission — Answers an ACP permission request. */
    respondPermission: (tabId, requestId, optionId) => ipcRenderer.invoke('copilot:respondPermission', tabId, requestId, optionId),
    /** @ipc copilot:resetBackend — Destroys a tab's backend (fresh session on next prompt). */
    resetBackend: (tabId) => ipcRenderer.invoke('copilot:resetBackend', tabId),
    /** @ipc claudecode:status — {installed, version} for the Claude Code CLI. */
    claudeCodeStatus: () => ipcRenderer.invoke('claudecode:status'),
    /** @ipc copilot:setApproval — Toggle a tab between manual approval and allow-all. */
    setApproval: (tabId, manualApproval) => ipcRenderer.invoke('copilot:setApproval', tabId, manualApproval),
    /** @ipc copilot:getCwd @returns {Promise<string>} Current working directory */
    getCwd: () => ipcRenderer.invoke('copilot:getCwd'),
    /** @ipc copilot:openCwd — Opens the CWD in the system file explorer. @returns {Promise<void>} */
    openCwd: () => ipcRenderer.invoke('copilot:openCwd'),
    /** @ipc copilot:getVersions @returns {Promise<{app: string, cli: string}>} App and CLI versions */
    getVersions: () => ipcRenderer.invoke('copilot:getVersions'),
    /** @ipc copilot:getInstructions @returns {Promise<Array<{path: string, name: string}>>} Found instruction files */
    getInstructions: () => ipcRenderer.invoke('copilot:getInstructions'),
    /**
     * Subscribes to JSONL events streamed from the Copilot CLI.
     * @param {(tabId: number, event: Object) => void} cb - Event callback
     * @returns {() => void} Unsubscribe function
     */
    onEvent: (cb) => {
      const handler = (_e, tabId, event) => cb(tabId, event);
      ipcRenderer.on('copilot:event', handler);
      return () => ipcRenderer.removeListener('copilot:event', handler);
    },
    /**
     * Subscribes to process-done events (Copilot CLI exited).
     * @param {(tabId: number, code: number|null) => void} cb - Done callback with exit code
     * @returns {() => void} Unsubscribe function
     */
    onDone: (cb) => {
      const handler = (_e, tabId, code) => cb(tabId, code);
      ipcRenderer.on('copilot:done', handler);
      return () => ipcRenderer.removeListener('copilot:done', handler);
    },
  },

  // ── Sessions ──────────────────────────────────────────────

  /**
   * Session management — read checkpoints, plans, and messages from session state.
   *
   * @namespace copilot.sessions
   */
  sessions: {
    /** @ipc sessions:readCheckpoints @param {string} id - Session ID @returns {Promise<Array>} */
    readCheckpoints: (id) => ipcRenderer.invoke('sessions:readCheckpoints', id),
    /** @ipc sessions:readPlan @param {string} id - Session ID @returns {Promise<string|null>} */
    readPlan: (id) => ipcRenderer.invoke('sessions:readPlan', id),
    /** @ipc sessions:readRecentMessages @param {string} id - Session ID @returns {Promise<Array>} Last 5 messages */
    readRecentMessages: (id) => ipcRenderer.invoke('sessions:readRecentMessages', id),
    /** @ipc sessions:readAllMessages — Full chronological history. @param {string} id @returns {Promise<Array>} */
    readAllMessages: (id) => ipcRenderer.invoke('sessions:readAllMessages', id),
    /** @ipc sessions:readClaudeCodeTranscript — Full history from Claude Code's own transcript. @param {string} cwd @param {string} id @returns {Promise<Array>} */
    readClaudeCodeTranscript: (cwd, id) => ipcRenderer.invoke('sessions:readClaudeCodeTranscript', cwd, id),
    /** @ipc sessions:create @param {string} name - Session display name @returns {Promise<string>} New session UUID */
    create: (name) => ipcRenderer.invoke('sessions:create', name),
    /** @ipc sessions:delete @param {string} id - Session ID @returns {Promise<boolean>} */
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
  },

  // ── Todos (per session) ───────────────────────────────────

  /**
   * Per-session todo list management.
   *
   * @namespace copilot.todos
   */
  todos: {
    /** @ipc todos:list @param {string} cwd Project directory @returns {Promise<Array<Object>>} */
    list: (cwd) => ipcRenderer.invoke('todos:list', cwd),
    /**
     * @ipc todos:add
     * @param {string} cwd - Project directory
     * @param {Object} todo - Todo object with at least `text` property
     * @returns {Promise<Array<Object>>} Updated todo list
     */
    add: (cwd, todo) => ipcRenderer.invoke('todos:add', cwd, todo),
    /**
     * @ipc todos:update
     * @param {string} cwd - Project directory
     * @param {string} todoId
     * @param {Object} updates - Fields to merge into the todo
     * @returns {Promise<Array<Object>>} Updated todo list
     */
    update: (cwd, todoId, updates) => ipcRenderer.invoke('todos:update', cwd, todoId, updates),
    /** @ipc todos:delete @param {string} cwd @param {string} todoId @returns {Promise<Array<Object>>} */
    delete: (cwd, todoId) => ipcRenderer.invoke('todos:delete', cwd, todoId),
    /**
     * Reorders todos according to the given ID sequence.
     * @ipc todos:reorder
     * @param {string} cwd - Project directory
     * @param {string[]} orderedIds - Todo IDs in desired order
     * @returns {Promise<Array<Object>>} Reordered todo list
     */
    reorder: (cwd, orderedIds) => ipcRenderer.invoke('todos:reorder', cwd, orderedIds),
  },

  // ── Images ────────────────────────────────────────────────

  /**
   * Image file management (list, open, delete) in the project images directory.
   *
   * @namespace copilot.images
   */
  images: {
    /** @ipc images:list @returns {Promise<Array<Object>>} */
    list: () => ipcRenderer.invoke('images:list'),
    /** @ipc images:open @param {string} filePath @returns {Promise<void>} */
    open: (filePath) => ipcRenderer.invoke('images:open', filePath),
    /** @ipc images:delete @param {string} filePath @returns {Promise<Object>} */
    delete: (filePath) => ipcRenderer.invoke('images:delete', filePath),
    /** @ipc images:openFolder — Opens the images directory in the file explorer. @returns {Promise<void>} */
    openFolder: () => ipcRenderer.invoke('images:openFolder'),
    /**
     * Subscribes to image directory change events (file watcher).
     * @param {Function} cb - Change callback
     * @returns {() => void} Unsubscribe function
     */
    onChanged: (cb) => {
      ipcRenderer.on('images:changed', cb);
      return () => ipcRenderer.removeListener('images:changed', cb);
    },
  },

  /**
   * Video utilities — frame extraction for video files.
   *
   * @namespace copilot.videos
   */
  videos: {
    /**
     * Extracts frames from a video file (via ffmpeg).
     * @ipc videos:extractFrames
     * @param {string} videoPath - Absolute path to the video
     * @param {Object} [options] - Extraction options (count, interval, etc.)
     * @returns {Promise<Object>} Extraction result with frame paths
     */
    extractFrames: (videoPath, options) => ipcRenderer.invoke('videos:extractFrames', videoPath, options),
  },

  // ── Preferences ───────────────────────────────────────────

  /**
   * Persistent file-based user preferences (theme, language, etc.).
   *
   * @namespace copilot.preferences
   */
  preferences: {
    /** @ipc preferences:read @returns {Promise<Object>} Current preferences merged with defaults */
    read: () => ipcRenderer.invoke('preferences:read'),
    /** @ipc preferences:write @param {Object} prefs - Preferences to persist @returns {Promise<boolean>} */
    write: (prefs) => ipcRenderer.invoke('preferences:write', prefs),
  },

  // ── Provider API keys (secure store) ──────────────────────

  /**
   * Encrypted provider API key management. Keys are stored via the OS keychain
   * in the main process and are never returned to the renderer.
   *
   * @namespace copilot.providers
   */
  providers: {
    /** @ipc providers:status @returns {Promise<{available: boolean, keyed: Object<string,boolean>}>} */
    status: () => ipcRenderer.invoke('providers:status'),
    /** @ipc providers:setKey @param {string} provider @param {string} key @returns {Promise<{success:boolean,error?:string}>} */
    setKey: (provider, key) => ipcRenderer.invoke('providers:setKey', provider, key),
    /** @ipc providers:deleteKey @param {string} provider @returns {Promise<{success:boolean}>} */
    deleteKey: (provider) => ipcRenderer.invoke('providers:deleteKey', provider),
    /** @ipc providers:loadSessionHistory @param {string} sessionId @returns {Promise<{messages: Array, geminiMode?: string}>} Persisted API conversation + provider-specific extras */
    loadSessionHistory: (sessionId) => ipcRenderer.invoke('providers:loadSessionHistory', sessionId),
    /** @ipc providers:listModels @param {string} provider @param {string} [baseURL] @returns {Promise<{ok:boolean,models:Array,reason?:string}>} */
    listModels: (provider, baseURL) => ipcRenderer.invoke('providers:listModels', provider, baseURL),
  },

  // ── Folders ───────────────────────────────────────────────

  /**
   * Folder configuration — read/save project paths, browse for directories/files.
   *
   * @namespace copilot.folders
   */
  folders: {
    /** @ipc folders:read @returns {Promise<Object>} All configured folder paths */
    read: () => ipcRenderer.invoke('folders:read'),
    /**
     * Merges new folder paths into the existing config. May require app restart.
     * @ipc folders:save
     * @param {Object} config - Folder paths to merge in
     * @returns {Promise<{success: boolean, requiresRestart?: boolean, error?: string}>}
     */
    save: (config) => ipcRenderer.invoke('folders:save', config),
    /**
     * Wipes all folder config back to hardcoded defaults (does NOT merge).
     * @ipc folders:reset
     * @returns {Promise<{success: boolean, requiresRestart?: boolean, error?: string}>}
     */
    reset: () => ipcRenderer.invoke('folders:reset'),
    /** @ipc folders:browse — Opens a native directory picker. @returns {Promise<string|null>} */
    browse: () => ipcRenderer.invoke('folders:browse'),
    /**
     * Opens a native file picker with optional filters.
     * @ipc folders:browse-file
     * @param {Array<{name: string, extensions: string[]}>} [filters] - File type filters
     * @returns {Promise<string|null>} Selected file path or null
     */
    browseFile: (filters) => ipcRenderer.invoke('folders:browse-file', filters),
    /** @ipc folders:openPath — Opens an arbitrary absolute path in the OS file explorer (creates it first if missing). @param {string} targetPath */
    openPath: (targetPath) => ipcRenderer.invoke('folders:openPath', targetPath),
    /** @ipc folders:providerPaths @param {string} provider @returns {Promise<{skillsDir?: string, agentsDir?: string, instructionsDir?: string}>} */
    providerPaths: (provider) => ipcRenderer.invoke('folders:providerPaths', provider),
  },

  // ── Instructions ──────────────────────────────────────────

  /**
   * Read/write the copilot-instructions.md file.
   *
   * @namespace copilot.instructions
   */
  instructions: {
    /** @ipc instructions:read @returns {Promise<{success: boolean, content: string, path: string}>} */
    read: () => ipcRenderer.invoke('instructions:read'),
    /** @ipc instructions:write @param {string} content - Markdown content @returns {Promise<{success: boolean, path: string}>} */
    write: (content) => ipcRenderer.invoke('instructions:write', content),
    /** @ipc instructions:readClaudeCode — Reads Claude Code's own global ~/.claude/CLAUDE.md. @returns {Promise<{success: boolean, content: string, path: string}>} */
    readClaudeCode: () => ipcRenderer.invoke('instructions:readClaudeCode'),
    /** @ipc instructions:writeClaudeCode @param {string} content - Markdown content @returns {Promise<{success: boolean, path: string}>} */
    writeClaudeCode: (content) => ipcRenderer.invoke('instructions:writeClaudeCode', content),
  },

  // ── Skills ────────────────────────────────────────────────

  /**
   * Skills and agents, always resolved for a concrete (provider, project)
   * pair — there is no provider-agnostic list, because there is no
   * provider-agnostic answer: each provider reads different folders (see
   * src/context-paths.js).
   *
   * @namespace copilot.context
   */
  context: {
    /** @ipc context:listSkills @param {string} provider @param {string|null} cwd @returns {Promise<Array<Object>>} */
    listSkills: (provider, cwd) => ipcRenderer.invoke('context:listSkills', provider, cwd),
    /** @ipc context:listAgents @param {string} provider @param {string|null} cwd @returns {Promise<Array<Object>>} */
    listAgents: (provider, cwd) => ipcRenderer.invoke('context:listAgents', provider, cwd),
    /** @ipc context:paths @param {string} provider @param {string|null} cwd @returns {Promise<{skills: {global: string[], project: string[]}, agents: {global: string[], project: string[]}}>} */
    paths: (provider, cwd) => ipcRenderer.invoke('context:paths', provider, cwd),
  },

  // ── Agents ────────────────────────────────────────────────

  /**
   * Agent file management (listing lives in copilot.context).
   *
   * @namespace copilot.agents
   */
  agents: {
    /** @ipc agents:delete @param {string} fileSlug - Agent file slug (without .agent.md) @returns {Promise<{success: boolean, error?: string}>} */
    delete: (fileSlug) => ipcRenderer.invoke('agents:delete', fileSlug),
  },

  // ── MCP ────────────────────────────────────────────────────

  /**
   * MCP server management — list project-configured MCP servers.
   *
   * @namespace copilot.mcp
   */
  mcp: {
    /** @ipc mcp:list @returns {Promise<Array<Object>>} All configured MCP servers (copilot mcp list --json) */
    list: () => ipcRenderer.invoke('mcp:list'),
    /** @ipc mcp:probe @returns {Promise<Array<Object>>} Configured servers with connectivity status (http/sse reachability) */
    probe: () => ipcRenderer.invoke('mcp:probe'),
    /** @ipc mcp:listProject @param {string} cwd @returns {Promise<Array<Object>>} Project MCP servers from .github/mcp.json */
    listProject: (cwd) => ipcRenderer.invoke('mcp:listProject', cwd),
  },

  // ── Tests ─────────────────────────────────────────────────

  /**
   * Test runner — execute unit tests, e2e tests and coverage reports.
   *
   * @namespace copilot.tests
   */
  tests: {
    /** @ipc tests:run @returns {Promise<Object>} Test run result */
    run: () => ipcRenderer.invoke('tests:run'),
    /** @ipc tests:e2e @returns {Promise<Object>} E2E test result */
    e2e: () => ipcRenderer.invoke('tests:e2e'),
    /** @ipc tests:coverage @returns {Promise<Object>} Coverage report result */
    coverage: () => ipcRenderer.invoke('tests:coverage'),
  },

  // ── Plugins ───────────────────────────────────────────────

  /**
   * Plugin management — install, uninstall, update plugins and manage marketplaces.
   *
   * @namespace copilot.plugins
   */
  plugins: {
    /** @ipc plugin:list @returns {Promise<Array<Object>>} Installed plugins */
    list: () => ipcRenderer.invoke('plugin:list'),
    /** @ipc plugin:install @param {string} target - Plugin name or path @returns {Promise<Object>} */
    install: (target) => ipcRenderer.invoke('plugin:install', target),
    /** @ipc plugin:uninstall @param {string} name @returns {Promise<Object>} */
    uninstall: (name) => ipcRenderer.invoke('plugin:uninstall', name),
    /** @ipc plugin:update @param {string} name @returns {Promise<Object>} */
    update: (name) => ipcRenderer.invoke('plugin:update', name),
    /** @ipc plugin:marketplace-list @returns {Promise<Array<Object>>} Registered marketplace sources */
    listMarketplaces: () => ipcRenderer.invoke('plugin:marketplace-list'),
    /** @ipc plugin:marketplace-add @param {string} source - Marketplace URL or identifier @returns {Promise<Object>} */
    addMarketplace: (source) => ipcRenderer.invoke('plugin:marketplace-add', source),
    /** @ipc plugin:marketplace-remove @param {string} name @returns {Promise<Object>} */
    removeMarketplace: (name) => ipcRenderer.invoke('plugin:marketplace-remove', name),
    /** @ipc plugin:marketplace-browse @param {string} name - Marketplace name @returns {Promise<Array<Object>>} Available plugins */
    browseMarketplace: (name) => ipcRenderer.invoke('plugin:marketplace-browse', name),
  },

  // ── Dev Console ───────────────────────────────────────────

  /**
   * Dev console log stream — receives main-process console output in the renderer.
   *
   * @namespace copilot.devConsole
   */
  devConsole: {
    /**
     * Subscribes to dev console log entries forwarded from the main process.
     * @param {(entry: {level: string, message: string, timestamp: number}) => void} cb
     * @returns {() => void} Unsubscribe function
     */
    onLog: (cb) => {
      const handler = (_e, entry) => cb(entry);
      ipcRenderer.on('dev-console:log', handler);
      return () => ipcRenderer.removeListener('dev-console:log', handler);
    },
  },

  // ── Logging (renderer → main → file) ─────────────────────

  /**
   * Renderer-to-file logging bridge. Messages are forwarded to the main process
   * file logger via fire-and-forget IPC.
   *
   * @namespace copilot.log
   */
  log: {
    /**
     * @ipc log:write
     * @param {string} level - Log level ('info'|'warn'|'error')
     * @param {string} message - Log message
     */
    write: (level, message) => ipcRenderer.send('log:write', level, message),
  },

  // ── Setup ─────────────────────────────────────────────────

  /**
   * First-run setup — creates default folders, starter agents and personalized configs.
   *
   * @namespace copilot.setup
   */
  setup: {
    /** @ipc setup:getFolderStatus @returns {Promise<Object>} Existence status of each setup folder */
    getFolderStatus: () => ipcRenderer.invoke('setup:getFolderStatus'),
    /** @ipc setup:createFolders — Creates missing default folders and instructions file. @returns {Promise<Object>} */
    createFolders: () => ipcRenderer.invoke('setup:createFolders'),
    /** @ipc setup:getCategories @returns {Promise<Array<{id: string, icon: string, title: string, desc: string}>>} */
    getCategories: () => ipcRenderer.invoke('setup:getCategories'),
    /**
     * Creates starter agent/skill files for the selected categories.
     * @ipc setup:createStarterFiles
     * @param {string[]} categories - Array of category IDs
     * @returns {Promise<{success: boolean, created: string[], skipped: string[], errors: string[]}>}
     */
    createStarterFiles: (categories) => ipcRenderer.invoke('setup:createStarterFiles', categories),
    /**
     * Returns prompts for personalized skill/agent generation (non-blocking variant).
     * @ipc setup:startPersonalizedSessions
     * @param {Object} data
     * @param {string} data.role
     * @param {string[]} [data.missingRoles]
     * @returns {Promise<{skillPrompt: string, agentPrompt: string|null}>}
     */
    startPersonalizedSessions: (data) => ipcRenderer.invoke('setup:startPersonalizedSessions', data),
  },

  // ── Onboarding ────────────────────────────────────────────

  /**
   * Onboarding state — tracks whether the user has completed the first-run wizard.
   *
   * @namespace copilot.onboarding
   */
  onboarding: {
    /** @ipc onboarding:isFirstRun @returns {Promise<boolean>} True if onboarding not yet completed */
    isFirstRun: () => ipcRenderer.invoke('onboarding:isFirstRun'),
    /** @ipc onboarding:complete — Marks onboarding as done. @returns {Promise<{success: boolean}>} */
    complete: () => ipcRenderer.invoke('onboarding:complete'),
  },

  // ── Tutorial ──────────────────────────────────────────────

  /**
   * Tutorial flag management — tracks which tutorial hints have been shown.
   *
   * @namespace copilot.tutorial
   */
  tutorial: {
    /** @ipc tutorial:getFlags @returns {Promise<{tutorialSkillsShown: boolean, tutorialRenameShown: boolean}>} */
    getFlags: () => ipcRenderer.invoke('tutorial:getFlags'),
    /**
     * @ipc tutorial:setFlag
     * @param {string} key - Flag key ('tutorialSkillsShown'|'tutorialRenameShown')
     * @param {boolean} value
     * @returns {Promise<{success: boolean}>}
     */
    setFlag: (key, value) => ipcRenderer.invoke('tutorial:setFlag', key, value),
  },

  // ── Dev Tools ─────────────────────────────────────────────

  /**
   * Developer tools — inspect and manipulate onboarding state for debugging.
   *
   * @namespace copilot.dev
   */
  dev: {
    /** @ipc dev:getOnboardingState @returns {Promise<{onboardingComplete: boolean}>} */
    getOnboardingState: () => ipcRenderer.invoke('dev:getOnboardingState'),
    /**
     * Overrides the onboarding completion flag (resets tutorial flags when set to false).
     * @ipc dev:setOnboardingComplete
     * @param {boolean} value
     * @returns {Promise<{success: boolean}>}
     */
    setOnboardingComplete: (value) => ipcRenderer.invoke('dev:setOnboardingComplete', value),
  },

  // ── Auth ──────────────────────────────────────────────────

  /**
   * Authentication — checks login status and triggers Copilot CLI login flow.
   *
   * @namespace copilot.auth
   */
  auth: {
    /** @ipc auth:check @returns {Promise<{success: boolean, authenticated: boolean, user: string|null, host?: string}>} */
    check: () => ipcRenderer.invoke('auth:check'),
    /** @ipc auth:login — Opens a new terminal window for `copilot login`. @returns {Promise<{success: boolean, pendingInTerminal: boolean}>} */
    login: () => ipcRenderer.invoke('auth:login'),
    /** @ipc copilot:status — Copilot CLI install + login status. @returns {Promise<{cliInstalled:boolean, version:string|null, authenticated:boolean, user:string|null}>} */
    status: () => ipcRenderer.invoke('copilot:status'),
  },

  /**
   * Self-update (git-based): check for newer release tags and apply via git pull.
   *
   * @namespace copilot.updates
   */
  updates: {
    /** @ipc updates:check @returns {Promise<{ok:boolean, currentVersion:string, latestVersion:string|null, updateAvailable:boolean, reason?:string, error?:string}>} */
    check: () => ipcRenderer.invoke('updates:check'),
    /** @ipc updates:apply — Pulls latest main, installs deps if needed, relaunches. @returns {Promise<{ok:boolean, reason?:string, depsInstalled?:boolean, newVersion?:string, error?:string}>} */
    apply: () => ipcRenderer.invoke('updates:apply'),
  },

  /**
   * Public pricing fallback source (LiteLLM) for models without a hardcoded price.
   *
   * @namespace copilot.pricing
   */
  pricing: {
    /** @ipc pricing:getMap @returns {Promise<Object<string,{input:number,cache:number,output:number}>>} normalized model key → USD/1M */
    getMap: () => ipcRenderer.invoke('pricing:getMap'),
  },

  // ── Window ────────────────────────────────────────────────

  /**
   * Frameless window controls (minimize, maximize/restore, close).
   *
   * @namespace copilot.window
   */
  window: {
    /** @ipc window:minimize */
    minimize: () => ipcRenderer.send('window:minimize'),
    /** @ipc window:maximize — Toggles between maximized and restored state. */
    maximize: () => ipcRenderer.send('window:maximize'),
    /** @ipc window:close */
    close: () => ipcRenderer.send('window:close'),
    /** @ipc window:openDevTools — Opens Chromium DevTools in a detached window (dev mode only). */
    openDevTools: () => ipcRenderer.send('window:openDevTools'),
    /** @ipc app:relaunch — Restarts the app (e.g. after Copilot login). @returns {Promise<{success: boolean}>} */
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
  },

  // ── File Utilities ────────────────────────────────────────

  /**
   * File utilities — resolve dropped file paths and process file content.
   *
   * @namespace copilot.files
   */
  files: {
    /**
     * Resolves the native file system path for a drag-and-dropped File object.
     * @param {File} file - DOM File object from a drop event
     * @returns {string} Absolute file path
     */
    getPath: (file) => webUtils.getPathForFile(file),
    /**
     * Processes a dropped file — reads text content or copies to the Dateien folder.
     * @ipc files:processDropped
     * @param {string} filePath - Absolute path of the dropped file
     * @returns {Promise<{type: string, content?: string, path?: string, message?: string}>}
     */
    processDropped: (filePath) => ipcRenderer.invoke('files:processDropped', filePath),
  },
});

'use strict';

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const { EventEmitter } = require('events');

// ── Constants ────────────────────────────────────────────────
const MAX_RESTARTS_PER_MINUTE = 3;
const RESTART_WINDOW_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 5_000;

/**
 * AcpClient — manages a single `copilot --acp` child process.
 * One instance per tab. Handles JSON-RPC communication, state machine,
 * crash recovery and event mapping for the renderer.
 */
class AcpClient extends EventEmitter {
  // ── Configuration ────────────────────────────────────────────
  #tabId;
  #sendToRenderer;
  #options;      // CLI options (model, deniedTools, addDirs, etc.)
  #cwd;
  #copilotBin;

  // ── Process ──────────────────────────────────────────────────
  #process = null;
  #state = 'dead'; // 'dead' | 'starting' | 'ready' | 'busy'
  #readline = null;

  // ── Protocol ─────────────────────────────────────────────────
  #requestId = 0;
  #pendingRequests = new Map(); // Map<id, {resolve, reject, timer}>

  // ── Session ──────────────────────────────────────────────────
  #sessionId = null;

  // ── Recovery ─────────────────────────────────────────────────
  #restartTimestamps = [];
  #stopping = false;

  /**
   * @param {number} tabId - Tab identifier
   * @param {Function} sendToRenderer - Function to send IPC messages (channel, ...args)
   * @param {Object} [options={}] - Configuration
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.copilotBin='copilot'] - Path to copilot binary
   * @param {string} [options.model] - Model override
   * @param {string[]} [options.deniedTools] - Tools to deny
   * @param {string[]} [options.addDirs] - Additional allowed directories
   * @param {boolean} [options.allowAllPaths] - Allow all paths
   */
  constructor(tabId, sendToRenderer, options = {}) {
    super();
    this.#tabId = tabId;
    this.#sendToRenderer = sendToRenderer;
    this.#cwd = options.cwd || process.cwd();
    this.#copilotBin = options.copilotBin || 'copilot';
    this.#options = options;
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get tabId() { return this.#tabId; }

  // ── Process Management ───────────────────────────────────────

  /**
   * Spawns the copilot --acp process and performs the initialize handshake.
   */
  async start() {
    if (this.#state !== 'dead') return;
    this.#stopping = false;
    this.#state = 'starting';

    const args = ['--acp', '--allow-all'];
    if (this.#options.model) args.push('--model', this.#options.model);
    if (this.#options.deniedTools) {
      for (const t of this.#options.deniedTools) args.push('--deny-tool=' + t);
    }
    if (this.#options.addDirs) {
      for (const d of this.#options.addDirs) args.push('--add-dir', d);
    }
    if (this.#options.allowAllPaths) args.push('--allow-all-paths');

    const proc = spawn(this.#copilotBin, args, {
      cwd: this.#cwd,
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.#process = proc;

    // NDJSON reader on stdout
    this.#readline = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    this.#readline.on('line', (line) => this.#handleLine(line));

    // stderr → error events to renderer
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        console.warn(`[acp:tab${this.#tabId}:stderr]`, text);
      }
    });

    // Exit handler
    proc.on('close', (code, signal) => {
      this.#handleExit(code, signal);
    });

    proc.on('error', (err) => {
      console.error(`[acp:tab${this.#tabId}] spawn error:`, err.message);
      this.#state = 'dead';
      this.#rejectAllPending(new Error('Process spawn failed: ' + err.message));
    });

    // Initialize handshake
    try {
      await this.#initialize();
    } catch (err) {
      console.error(`[acp:tab${this.#tabId}] initialize failed:`, err.message);
      this.#killProcess();
      this.#state = 'dead';
      throw err;
    }
  }

  /**
   * Gracefully stops the process.
   */
  async stop() {
    this.#stopping = true;
    this.#rejectAllPending(new Error('Client stopped'));
    if (!this.#process) {
      this.#state = 'dead';
      return;
    }

    const proc = this.#process;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        resolve();
      }, STOP_GRACE_MS);

      proc.once('close', () => {
        clearTimeout(timer);
        resolve();
      });

      try { proc.kill('SIGTERM'); } catch (_) {}
    }).then(() => {
      this.#process = null;
      this.#state = 'dead';
    });
  }

  // ── Session Management ───────────────────────────────────────

  /**
   * Creates a new session.
   * @param {string} [cwd] - Override working directory
   * @param {Array} [mcpServers=[]] - MCP server configurations
   * @returns {Promise<Object>} Session result (sessionId, models, etc.)
   */
  async newSession(cwd, mcpServers = []) {
    await this.#ensureReady();
    const result = await this.#sendRequest('session/new', {
      cwd: cwd || this.#cwd,
      mcpServers,
    });
    if (result && result.sessionId) {
      this.#sessionId = result.sessionId;
      // Emit session ID as result event for renderer compatibility
      this.#emitToRenderer({
        type: 'result',
        sessionId: result.sessionId,
      });
    }
    return result;
  }

  /**
   * Loads an existing session. Falls back to newSession on failure.
   * @param {string} sessionId
   * @param {string} [cwd]
   * @param {Array} [mcpServers=[]]
   * @returns {Promise<Object>}
   */
  async loadSession(sessionId, cwd, mcpServers = []) {
    await this.#ensureReady();
    try {
      const result = await this.#sendRequest('session/load', {
        sessionId,
        cwd: cwd || this.#cwd,
        mcpServers,
      });
      if (result && result.sessionId) {
        this.#sessionId = result.sessionId;
        this.#emitToRenderer({
          type: 'result',
          sessionId: result.sessionId,
        });
      }
      return result;
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] session/load failed, falling back to new:`, err.message);
      return this.newSession(cwd, mcpServers);
    }
  }

  /**
   * Lists available sessions.
   * @returns {Promise<Array>}
   */
  async listSessions() {
    await this.#ensureReady();
    return this.#sendRequest('session/list', {});
  }

  // ── Prompt + Streaming ───────────────────────────────────────

  /**
   * Sends a prompt and streams events to the renderer.
   * @param {string} text - User prompt
   * @returns {Promise<Object>} Prompt result (stopReason, etc.)
   */
  async prompt(text) {
    await this.#ensureReady();
    if (!this.#sessionId) {
      throw new Error('No active session. Call newSession() or loadSession() first.');
    }

    this.#state = 'busy';
    try {
      const result = await this.#sendRequest('session/prompt', {
        sessionId: this.#sessionId,
        prompt: [{ type: 'text', text }],
      });
      this.#state = 'ready';
      // Signal done to renderer
      this.#sendToRenderer('copilot:done', this.#tabId, 0);
      return result;
    } catch (err) {
      this.#state = this.#process ? 'ready' : 'dead';
      // Signal error-done to renderer
      this.#sendToRenderer('copilot:done', this.#tabId, 1);
      throw err;
    }
  }

  /**
   * Cancels the current prompt by killing the process and restarting.
   */
  async cancel() {
    const sessionId = this.#sessionId;
    this.#rejectAllPending(new Error('Cancelled'));
    this.#killProcess();
    this.#state = 'dead';

    // Signal done (cancelled) to renderer
    this.#sendToRenderer('copilot:done', this.#tabId, -1);

    // Restart and reload session
    try {
      await this.start();
      if (sessionId) {
        await this.loadSession(sessionId);
      }
    } catch (err) {
      console.error(`[acp:tab${this.#tabId}] restart after cancel failed:`, err.message);
    }
  }

  // ── Private: JSON-RPC Protocol ───────────────────────────────

  async #initialize() {
    const result = await this.#sendRequest('initialize', {
      protocolVersion: 1,
      capabilities: {},
    }, INITIALIZE_TIMEOUT_MS);
    this.#state = 'ready';
    return result;
  }

  /**
   * Sends a JSON-RPC request and returns a Promise for the response.
   */
  #sendRequest(method, params, timeout = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.#process || !this.#process.stdin || this.#process.stdin.destroyed) {
        return reject(new Error('Process not available'));
      }

      const id = ++this.#requestId;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      const timer = setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${timeout}ms`));
      }, timeout);

      this.#pendingRequests.set(id, { resolve, reject, timer });

      // Track active prompt for event correlation
      try {
        this.#process.stdin.write(msg + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.#pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  // ── Private: Line Parser ─────────────────────────────────────

  #handleLine(line) {
    if (!line.trim()) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] JSON parse error:`, err.message, line.substring(0, 200));
      return;
    }

    // JSON-RPC Response (has id)
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.#pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // JSON-RPC Notification (no id) — these are events
    if (msg.method === 'session/update' && msg.params) {
      this.#handleSessionUpdate(msg.params);
    }
  }

  // ── Private: Event Mapping ───────────────────────────────────

  /**
   * Maps ACP session/update events to the JSONL format the renderer expects.
   */
  #handleSessionUpdate(params) {
    const update = params.update || params;
    const eventType = update.sessionUpdate || update.type;
    const content = update.content || update.data || {};

    switch (eventType) {
      case 'agent_message_chunk': {
        // → assistant.message_delta { deltaContent }
        const text = content.text || (typeof content === 'string' ? content : '');
        this.#emitToRenderer({
          type: 'assistant.message_delta',
          data: { deltaContent: text },
        });
        break;
      }

      case 'agent_thought_chunk': {
        // → assistant.reasoning_delta { deltaContent }
        const text = content.text || (typeof content === 'string' ? content : '');
        this.#emitToRenderer({
          type: 'assistant.reasoning_delta',
          data: { deltaContent: text },
        });
        break;
      }

      case 'tool_call': {
        // → tool.execution_start { toolCallId, toolName, arguments }
        this.#emitToRenderer({
          type: 'tool.execution_start',
          data: {
            toolCallId: content.toolCallId || content.id || '',
            toolName: content.name || content.toolName || '',
            arguments: content.input || content.arguments || {},
          },
        });
        break;
      }

      case 'tool_call_update': {
        // → tool.execution_complete { toolCallId, toolName, success, result }
        const _isCompleted = content.status === 'completed' || content.status === undefined;
        this.#emitToRenderer({
          type: 'tool.execution_complete',
          data: {
            toolCallId: content.toolCallId || content.id || '',
            toolName: content.name || content.toolName || '',
            success: content.error ? false : true,
            result: {
              content: content.output || content.result || '',
            },
            error: content.error || undefined,
          },
        });
        break;
      }

      case 'config_option_update': {
        // → session.tools_updated with model info
        if (content.model || content.key === 'model') {
          this.#emitToRenderer({
            type: 'session.tools_updated',
            data: { model: content.model || content.value || '' },
          });
        }
        break;
      }

      case 'available_commands_update': {
        // No direct renderer equivalent currently — emit as-is for future use
        this.emit('commands_update', content);
        break;
      }

      case 'agent_message': {
        // Final complete message
        this.#emitToRenderer({
          type: 'assistant.message',
          data: {
            content: content.text || (typeof content === 'string' ? content : ''),
            toolRequests: content.toolRequests || [],
          },
        });
        break;
      }

      case 'agent_turn_start': {
        this.#emitToRenderer({
          type: 'assistant.turn_start',
          data: {},
        });
        break;
      }

      case 'agent_turn_end': {
        this.#emitToRenderer({
          type: 'assistant.turn_end',
          data: {},
        });
        break;
      }

      case 'mcp_server_status_changed': {
        this.#emitToRenderer({
          type: 'session.mcp_server_status_changed',
          data: content,
        });
        break;
      }

      case 'mcp_servers_loaded': {
        this.#emitToRenderer({
          type: 'session.mcp_servers_loaded',
          data: content,
        });
        break;
      }

      case 'skills_loaded': {
        this.#emitToRenderer({
          type: 'session.skills_loaded',
          data: content,
        });
        break;
      }

      case 'tools_updated': {
        this.#emitToRenderer({
          type: 'session.tools_updated',
          data: content,
        });
        break;
      }

      default: {
        // Pass through unknown events with a generic type
        console.log(`[acp:tab${this.#tabId}] unhandled update: ${eventType}`);
        break;
      }
    }
  }

  // ── Private: Emit to Renderer ────────────────────────────────

  #emitToRenderer(event) {
    this.#sendToRenderer('copilot:event', this.#tabId, event);
  }

  // ── Private: Process Lifecycle ───────────────────────────────

  #killProcess() {
    if (this.#readline) {
      this.#readline.close();
      this.#readline = null;
    }
    if (this.#process) {
      try { this.#process.kill('SIGKILL'); } catch (_) {}
      this.#process = null;
    }
  }

  #handleExit(code, signal) {
    this.#process = null;
    if (this.#readline) {
      this.#readline.close();
      this.#readline = null;
    }

    // Reject pending requests
    this.#rejectAllPending(new Error(`Process exited (code=${code}, signal=${signal})`));

    if (this.#stopping) {
      this.#state = 'dead';
      return;
    }

    console.warn(`[acp:tab${this.#tabId}] process exited unexpectedly (code=${code}, signal=${signal})`);
    this.#state = 'dead';

    // Auto-restart with rate limiting
    this.#attemptRestart();
  }

  async #attemptRestart() {
    const now = Date.now();
    this.#restartTimestamps = this.#restartTimestamps.filter(t => now - t < RESTART_WINDOW_MS);

    if (this.#restartTimestamps.length >= MAX_RESTARTS_PER_MINUTE) {
      console.error(`[acp:tab${this.#tabId}] max restarts reached (${MAX_RESTARTS_PER_MINUTE}/${RESTART_WINDOW_MS}ms)`);
      this.#emitToRenderer({
        type: 'error',
        data: { message: 'Copilot-Prozess konnte nicht wiederhergestellt werden. Bitte Tab neu starten.' },
      });
      return;
    }

    this.#restartTimestamps.push(now);
    console.log(`[acp:tab${this.#tabId}] auto-restarting (attempt ${this.#restartTimestamps.length})`);

    try {
      await this.start();
      // Reload session if we had one
      if (this.#sessionId) {
        await this.loadSession(this.#sessionId);
        this.#emitToRenderer({
          type: 'error',
          data: { message: 'Session wiederhergestellt nach Prozess-Neustart.' },
        });
      }
    } catch (err) {
      console.error(`[acp:tab${this.#tabId}] restart failed:`, err.message);
      this.#emitToRenderer({
        type: 'error',
        data: { message: 'Neustart fehlgeschlagen: ' + err.message },
      });
    }
  }

  #rejectAllPending(err) {
    for (const [_id, { reject, timer }] of this.#pendingRequests) {
      clearTimeout(timer);
      reject(err);
    }
    this.#pendingRequests.clear();
  }

  async #ensureReady() {
    if (this.#state === 'dead') {
      await this.start();
    }
    if (this.#state !== 'ready' && this.#state !== 'busy') {
      // Wait a bit for state to transition
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.#state !== 'ready' && this.#state !== 'busy') {
        throw new Error(`AcpClient not ready (state=${this.#state})`);
      }
    }
  }

  /**
   * Updates runtime options (e.g., model change for next session).
   */
  updateOptions(options) {
    Object.assign(this.#options, options);
  }

  /**
   * Destroys the client completely, releasing all resources.
   */
  async destroy() {
    await this.stop();
    this.removeAllListeners();
  }
}

module.exports = { AcpClient };

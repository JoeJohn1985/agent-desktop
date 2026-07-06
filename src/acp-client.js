'use strict';

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const { EventEmitter } = require('events');

// ── Constants ────────────────────────────────────────────────
const MAX_RESTARTS_PER_MINUTE = 3;
const RESTART_WINDOW_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;
const SLASH_COMMAND_TIMEOUT_MS = 180_000; // silent slash commands (/context, /compact …)
const DEBUG_ACP = process.env.ACP_DEBUG === '1'; // verbose diagnostics (models dump, unhandled events)
const LOCAL_CMD_GRACE_MS = 2_000; // wait for a stderr <local-command-stdout> flush (Claude Code)
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
  #baseArgs = null;   // fixed spawn args for a non-Copilot ACP adapter (else null)
  #stripEnv = [];     // env vars removed from the child (e.g. ANTHROPIC_API_KEY)
  #shell = false;     // spawn via a shell — needed on Windows for .cmd/.bat (npx)
  #localCommandStdout = false; // adapter returns slash output on stderr (Claude Code)

  // ── Process ──────────────────────────────────────────────────
  #process = null;
  #state = 'dead'; // 'dead' | 'starting' | 'ready' | 'busy'
  #readline = null;

  // ── Protocol ─────────────────────────────────────────────────
  #requestId = 0;
  #pendingRequests = new Map(); // Map<id, {resolve, reject, timer}>

  // ── Session ──────────────────────────────────────────────────
  #sessionId = null;
  #sessionLoadedInProcess = false; // true once the *current* live process has the session loaded
  #appliedModel = null; // the model currently applied to the live session via session/set_model
  #appliedMode = null; // the mode (full ACP id) currently applied via session/set_mode
  #availableModes = []; // modes.availableModes from the last session/new|load result

  // ── Prompt State ─────────────────────────────────────────────
  #promptDone = false; // true once copilot:done has been sent for the current prompt
  #suppressReplay = false; // true while session/load replays history (don't re-render to UI)
  #cancelRequested = false; // true while a session/cancel is pending for the current prompt
  #contextQueryCollector = null; // when set, agent_message_chunks are collected here instead of UI
  #openPermissions = new Set(); // JSON-RPC ids of permission requests awaiting a UI answer
  #probedSessions = false;      // one-shot session/list capability probe (diagnostic)
  #localCmdBuf = '';       // stderr buffer while capturing a <local-command-stdout> block (Claude Code)
  #localCmdWaiter = null;  // resolver awaited by silentCommand until the block arrives
  #toolKinds = new Map(); // Map<toolCallId, kind> — ACP sends `kind` on tool_call but often omits it on tool_call_update

  // ── Recovery ─────────────────────────────────────────────────
  #restartTimestamps = [];
  #stopping = false;

  /**
   * @param {number} tabId - Tab identifier
   * @param {Function} sendToRenderer - Function to send IPC messages (channel, ...args)
   * @param {Object} [options={}] - Configuration
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.copilotBin='copilot'] - Path to the copilot binary
   * @param {string} [options.command] - ACP process command (overrides copilotBin;
   *   e.g. 'npx' for the Claude Code adapter). Defaults to the copilot binary.
   * @param {string[]} [options.baseArgs] - Fixed spawn args for a non-Copilot ACP
   *   adapter (e.g. ['@zed-industries/claude-code-acp']). When set, the
   *   Copilot-specific flag builder (--acp/--model/--deny-tool/…) is skipped;
   *   model/deny are applied via ACP instead.
   * @param {string[]} [options.stripEnv] - Env vars to remove from the child
   *   process (e.g. ['ANTHROPIC_API_KEY'] so Claude Code bills the subscription,
   *   not the API).
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
    this.#copilotBin = options.command || options.copilotBin || 'copilot';
    this.#baseArgs = Array.isArray(options.baseArgs) ? options.baseArgs : null;
    this.#stripEnv = Array.isArray(options.stripEnv) ? options.stripEnv : [];
    this.#shell = options.shell === true;
    this.#localCommandStdout = options.localCommandStdout === true;
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
    // A fresh process has no session loaded yet, even if we remember a sessionId.
    this.#sessionLoadedInProcess = false;
    this.#appliedModel = null;
    this.#appliedMode = null;

    // Non-Copilot ACP adapters (e.g. Claude Code) get their fixed args verbatim;
    // model/deny are applied over ACP, not via CLI flags. Copilot uses its flags.
    let args;
    if (this.#baseArgs) {
      args = [...this.#baseArgs];
    } else {
      // --allow-all makes the CLI auto-approve tools (no permission prompts). When
      // manual approval is on we drop it so the CLI asks via session/request_permission.
      args = ['--acp'];
      if (this.#options.allowAll !== false) args.push('--allow-all');
      if (this.#options.model) args.push('--model', this.#options.model);
      if (this.#options.deniedTools) {
        for (const t of this.#options.deniedTools) args.push('--deny-tool=' + t);
      }
      if (this.#options.addDirs) {
        for (const d of this.#options.addDirs) args.push('--add-dir', d);
      }
      if (this.#options.allowAllPaths) args.push('--allow-all-paths');
    }

    // Build the child env, removing any keys the backend must not see. Critical
    // for Claude Code: an inherited ANTHROPIC_API_KEY would switch billing from
    // the subscription to pay-per-token API usage.
    const env = { ...process.env, NO_COLOR: '1' };
    for (const key of this.#stripEnv) delete env[key];

    const proc = spawn(this.#copilotBin, args, {
      cwd: this.#cwd,
      env,
      shell: this.#shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.#process = proc;

    // NDJSON reader on stdout
    this.#readline = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    this.#readline.on('line', (line) => this.#handleLine(line));

    // stderr → error events to renderer
    proc.stderr.on('data', (chunk) => {
      const raw = chunk.toString('utf-8');
      const text = raw.trim();
      if (text) {
        console.warn(`[acp:tab${this.#tabId}:stderr]`, text);
      }
      // Some ACP adapters (Claude Code) return slash-command output on stderr,
      // wrapped in <local-command-stdout>…</local-command-stdout>, instead of the
      // normal ACP response. Capture it while a silentCommand is in flight.
      if (this.#contextQueryCollector) {
        this.#localCmdBuf += raw;
        const m = this.#localCmdBuf.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
        if (m) {
          this.#contextQueryCollector.push(m[1]);
          this.#localCmdBuf = '';
          if (this.#localCmdWaiter) { const w = this.#localCmdWaiter; this.#localCmdWaiter = null; w(); }
        }
      }
    });

    // Exit handler — ignore stale events from a process we've already
    // replaced or intentionally killed (prevents restart cascades on cancel).
    proc.on('close', (code, signal) => {
      if (proc !== this.#process) return;
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
   * @param {Array} [mcpServers] - MCP server configurations (defaults to configured ones)
   * @returns {Promise<Object>} Session result (sessionId, models, etc.)
   */
  async newSession(cwd, mcpServers) {
    await this.#ensureReady();
    const result = await this.#sendRequest('session/new', {
      cwd: cwd || this.#cwd,
      mcpServers: mcpServers ?? this.#options.mcpServers ?? [],
    });
    // sessionId may live at result.sessionId or result.session.id depending on ACP version
    const sessionId = result?.sessionId ?? result?.session?.id ?? result?.id;
    if (sessionId) {
      this.#sessionId = sessionId;
      this.#sessionLoadedInProcess = true;
      this.#emitToRenderer({ type: 'result', sessionId });
    } else {
      console.error(`[acp:tab${this.#tabId}] session/new: no sessionId in result`, JSON.stringify(result));
    }
    this.#captureModes(result);
    if (DEBUG_ACP) {
      try {
        console.log(`[acp:tab${this.#tabId}] session/new models :: ${JSON.stringify(result?.models ?? result?.configOptions ?? {}).slice(0, 1500)}`);
      } catch (_) { /* ignore */ }
    }
    this.#emitCurrentModel(result);
    this.#emitAvailableModels(result);
    this.#probeSessionList();
    return result;
  }

  /**
   * One-shot diagnostic: probe whether this ACP backend supports session/list
   * (needed to know if Claude Code session resume/interop is feasible). Logs the
   * result; never throws. Only runs when the probeSessionList option is set.
   */
  #probeSessionList() {
    if (!this.#options.probeSessionList || this.#probedSessions) return;
    this.#probedSessions = true;
    this.listSessions()
      .then((r) => console.log(`[acp:tab${this.#tabId}] session/list :: ${JSON.stringify(r).slice(0, 1200)}`))
      .catch((e) => console.log(`[acp:tab${this.#tabId}] session/list not supported: ${e?.message || e}`));
  }

  /**
   * Loads an existing session. Falls back to newSession on failure.
   * @param {string} sessionId
   * @param {string} [cwd]
   * @param {Array} [mcpServers] - MCP server configurations (defaults to configured ones)
   * @returns {Promise<Object>}
   */
  async loadSession(sessionId, cwd, mcpServers) {
    await this.#ensureReady();
    // session/load replays the conversation history as session/update events.
    // Suppress them so the renderer doesn't duplicate the existing chat.
    this.#suppressReplay = true;
    try {
      const result = await this.#sendRequest('session/load', {
        sessionId,
        cwd: cwd || this.#cwd,
        mcpServers: mcpServers ?? this.#options.mcpServers ?? [],
      });
      // session/load does not echo back the sessionId — it returns models/modes/config.
      // The session is now active under the ID we passed in.
      this.#sessionId = sessionId;
      this.#sessionLoadedInProcess = true;
      this.#emitToRenderer({ type: 'result', sessionId });
      this.#captureModes(result);
      this.#emitCurrentModel(result);
      this.#emitAvailableModels(result);
      return result;
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] session/load failed, falling back to new:`, err.message);
      // Tell the renderer the previous conversation could not be restored,
      // so it can inform the user before a fresh session is created.
      this.#emitToRenderer({ type: 'session.restore_failed', data: { sessionId } });
      return this.newSession(cwd, mcpServers);
    } finally {
      this.#suppressReplay = false;
    }
  }

  /**
   * Applies the configured model to the active session via `session/set_model`,
   * unless it is already applied. No-op if no model is configured or no session.
   */
  async #applyModel() {
    const model = this.#options.model;
    if (!model || !this.#sessionId || model === this.#appliedModel) return;
    try {
      await this.#sendRequest('session/set_model', { sessionId: this.#sessionId, modelId: model });
      this.#appliedModel = model;
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] session/set_model(${model}) failed:`, err.message);
    }
  }

  /** Captures the available session modes from a session/new|load result. */
  #captureModes(result) {
    const modes = result?.modes?.availableModes;
    if (Array.isArray(modes) && modes.length) {
      this.#availableModes = modes;
    } else {
      // Current Claude Code adapter reports modes via a configOptions entry.
      const opt = (result?.configOptions || []).find((o) => o && o.id === 'mode');
      if (opt && Array.isArray(opt.options)) {
        this.#availableModes = opt.options.filter((o) => o && o.value).map((o) => ({ id: o.value, name: o.name || o.value }));
      }
    }
    this.#emitAvailableModes(result);
  }

  /** Emit the session modes (both ACP shapes) so the renderer can offer them. */
  #emitAvailableModes(result) {
    let modes = [];
    let currentModeId = null;
    const list = result?.modes?.availableModes;
    if (Array.isArray(list) && list.length) {
      modes = list.map((m) => ({ id: m.id, name: m.name || m.id, description: m.description || '' }));
      currentModeId = result?.modes?.currentModeId || null;
    } else {
      const opt = (result?.configOptions || []).find((o) => o && o.id === 'mode');
      if (opt && Array.isArray(opt.options)) {
        modes = opt.options.filter((o) => o && o.value).map((o) => ({ id: o.value, name: o.name || o.value, description: o.description || '' }));
        currentModeId = opt.currentValue || null;
      }
    }
    if (modes.length) {
      this.#emitToRenderer({ type: 'session.modes_available', data: { modes, currentModeId } });
    }
  }

  /**
   * Resolves a short mode id ('agent'|'plan'|'autopilot') to the full ACP mode id
   * (e.g. ".../session-modes#autopilot") using the session's available modes.
   * @param {string} shortId
   * @returns {string|null}
   */
  #resolveModeId(shortId) {
    if (!shortId) return null;
    const match = this.#availableModes.find(
      (m) => m.id === shortId || m.id?.endsWith('#' + shortId) || m.name?.toLowerCase() === shortId,
    );
    return match?.id || null;
  }

  /**
   * Applies the configured session mode via `session/set_mode`, unless already
   * applied. No-op if no mode is configured, no session, or mode is unknown.
   */
  async #applyMode() {
    const shortId = this.#options.mode;
    if (!shortId || !this.#sessionId) return;
    const modeId = this.#resolveModeId(shortId);
    if (!modeId || modeId === this.#appliedMode) return;
    try {
      await this.#sendRequest('session/set_mode', { sessionId: this.#sessionId, modeId });
      this.#appliedMode = modeId;
      if (DEBUG_ACP) console.log(`[acp:tab${this.#tabId}] session/set_mode(${modeId}) ok`);
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] session/set_mode(${shortId} → ${modeId}) failed:`, err.message);
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
    // After a process restart the live process has no session loaded yet,
    // even though we remember the sessionId. Reload it before prompting.
    if (!this.#sessionLoadedInProcess) {
      await this.loadSession(this.#sessionId);
    }

    // Ensure the session uses the selected model. session/load restores the
    // session's originally-stored model and ignores the --model spawn flag,
    // so we must explicitly set it here (also covers runtime model switches).
    await this.#applyModel();
    // Apply the selected session mode (agent/plan/autopilot) the same way.
    await this.#applyMode();

    this.#state = 'busy';
    this.#promptDone = false;
    this.#cancelRequested = false;
    try {
      const result = await this.#sendRequest('session/prompt', {
        sessionId: this.#sessionId,
        prompt: [{ type: 'text', text }],
      }, 0); // no timeout — an agentic turn can run for minutes (see #sendRequest)
      this.#state = 'ready';
      // A cancelled turn returns stopReason "cancelled" → report code -1 to the UI.
      const cancelled = this.#cancelRequested || result?.stopReason === 'cancelled';
      this.#cancelRequested = false;
      // If agent_turn_end already arrived, copilot:done was already sent.
      // Otherwise send it now (session/prompt response = end of turn).
      if (!this.#promptDone) {
        this.#promptDone = true;
        this.#sendToRenderer('copilot:done', this.#tabId, cancelled ? -1 : 0);
      }
      return result;
    } catch (err) {
      this.#state = this.#process ? 'ready' : 'dead';
      // If cancel() already sent copilot:done(-1), don't also send an error-done.
      if (!this.#promptDone) {
        this.#promptDone = true;
        this.#sendToRenderer('copilot:done', this.#tabId, 1);
      }
      throw err;
    }
  }

  /**
   * Cancels the current prompt via the ACP `session/cancel` notification.
   * This aborts the running turn without killing the process, so the session
   * (and its conversation context) stays alive. The in-flight session/prompt
   * request resolves with stopReason "cancelled", which emits copilot:done(-1).
   */
  async cancel() {
    if (this.#state !== 'busy' || !this.#process || !this.#sessionId) {
      // Nothing in flight — emit a done(-1) so the UI unlocks anyway.
      if (!this.#promptDone) {
        this.#promptDone = true;
        this.#sendToRenderer('copilot:done', this.#tabId, -1);
      }
      return;
    }
    this.#cancelRequested = true;
    this.#cancelOpenPermissions();
    this.#sendNotification('session/cancel', { sessionId: this.#sessionId });
  }

  /**
   * Sends a slash command silently (without rendering to the chat UI).
   * Collects and returns the raw response text.
   */
  async silentCommand(command) {
    if (this.#state === 'busy') throw new Error('Cannot run command while busy');
    await this.#ensureReady();
    if (!this.#sessionId) throw new Error('No active session');
    if (!this.#sessionLoadedInProcess) {
      await this.loadSession(this.#sessionId);
    }

    this.#state = 'busy';
    this.#promptDone = false;
    this.#contextQueryCollector = [];
    this.#localCmdBuf = '';
    try {
      await this.#sendRequest('session/prompt', {
        sessionId: this.#sessionId,
        prompt: [{ type: 'text', text: command }],
      }, SLASH_COMMAND_TIMEOUT_MS);
      // If nothing arrived via the ACP response, give adapters that emit slash
      // output on stderr (Claude Code) a moment to flush a <local-command-stdout>
      // block. Other backends return immediately.
      if (this.#localCommandStdout && !this.#contextQueryCollector.join('')) {
        await new Promise((resolve) => {
          this.#localCmdWaiter = resolve;
          setTimeout(() => {
            if (this.#localCmdWaiter) { this.#localCmdWaiter = null; resolve(); }
          }, LOCAL_CMD_GRACE_MS);
        });
      }
      return this.#contextQueryCollector.join('');
    } finally {
      this.#contextQueryCollector = null;
      this.#localCmdBuf = '';
      this.#localCmdWaiter = null;
      this.#promptDone = true;
      this.#state = this.#process ? 'ready' : 'dead';
    }
  }

  async getContextInfo() {
    return this.silentCommand('/context');
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

      // timeout <= 0 means "no timeout" — used for session/prompt, whose agentic
      // turns can run for minutes. Such turns are bounded by user cancel and by
      // the process lifecycle (a process exit rejects all pending requests), so
      // a fixed timeout here would falsely abort a still-running turn while the
      // CLI keeps streaming — leaving the UI stuck in a "running" state.
      const timer = timeout > 0 ? setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${timeout}ms`));
      }, timeout) : null;

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

  /**
   * Sends a JSON-RPC notification (no id, no response expected).
   * @param {string} method
   * @param {Object} params
   * @returns {boolean} true if written successfully
   */
  #sendNotification(method, params) {
    if (!this.#process || !this.#process.stdin || this.#process.stdin.destroyed) {
      return false;
    }
    try {
      this.#process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
      return true;
    } catch (err) {
      console.warn(`[acp:tab${this.#tabId}] notification ${method} failed:`, err.message);
      return false;
    }
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

    // JSON-RPC message with an id: either a response to OUR request, or a request
    // FROM the agent (e.g. session/request_permission) that we must answer.
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
        return;
      }
      if (msg.method) { this.#handleAgentRequest(msg); }
      return;
    }

    // JSON-RPC Notification (no id) — these are events
    if (msg.method === 'session/update' && msg.params) {
      this.#handleSessionUpdate(msg.params);
    }
  }

  /**
   * Handles a JSON-RPC request initiated by the agent (bidirectional ACP). We
   * answer session/request_permission (via the UI); anything else gets a
   * method-not-found reply so the agent doesn't hang waiting.
   */
  #handleAgentRequest(msg) {
    const { id, method, params } = msg;
    if (method === 'session/request_permission') {
      this.#handlePermissionRequest(id, params || {});
      return;
    }
    console.log(`[acp:tab${this.#tabId}] agent request (unhandled): ${method} :: ${JSON.stringify(params || {}).slice(0, 400)}`);
    this.#sendResponse(id, undefined, { code: -32601, message: `Method not handled: ${method}` });
  }

  /**
   * Forwards a permission request to the renderer (dropup UI) and tracks it so
   * the user's answer can be routed back via respondPermission().
   */
  #handlePermissionRequest(id, params) {
    const options = Array.isArray(params.options) ? params.options : [];
    const tc = params.toolCall || {};
    // Auto-approve (read live from options so a per-tab toggle works without a
    // restart): pick an allow option and answer immediately, no UI prompt.
    if (this.#options.autoApprovePermissions) {
      const allow = options.find((o) => /allow/.test(o.kind || '')) || options[0];
      if (allow && allow.optionId) {
        this.#sendResponse(id, { outcome: { outcome: 'selected', optionId: allow.optionId } });
        return;
      }
    }
    this.#openPermissions.add(id);
    this.#emitToRenderer({
      type: 'session.permission_request',
      data: {
        requestId: id,
        title: tc.title || tc.rawInput?.command || tc.kind || 'Aktion',
        kind: tc.kind || '',
        toolName: AcpClient.#mapToolKind(tc.kind, tc.title),
        options: options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      },
    });
  }

  /**
   * Answers a pending permission request with the chosen option (or cancels it
   * when optionId is falsy). No-op if the request is unknown/already answered.
   * @param {number|string} requestId
   * @param {string} [optionId]
   */
  respondPermission(requestId, optionId) {
    if (!this.#openPermissions.has(requestId)) return;
    this.#openPermissions.delete(requestId);
    const outcome = optionId
      ? { outcome: 'selected', optionId }
      : { outcome: 'cancelled' };
    this.#sendResponse(requestId, { outcome });
  }

  /** Writes a JSON-RPC response (result or error) for an agent-initiated request. */
  #sendResponse(id, result, error) {
    try {
      if (!this.#process?.stdin || this.#process.stdin.destroyed) return;
      const payload = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
      this.#process.stdin.write(JSON.stringify(payload) + '\n');
    } catch (_) { /* process gone */ }
  }

  /** Cancel all open permission requests (e.g. on stop/cancel) so nothing hangs. */
  #cancelOpenPermissions() {
    for (const id of this.#openPermissions) {
      this.#sendResponse(id, { outcome: { outcome: 'cancelled' } });
    }
    this.#openPermissions.clear();
  }

  // ── Private: Event Mapping ───────────────────────────────────

  /**
   * Maps ACP session/update events to the JSONL format the renderer expects.
   */
  #handleSessionUpdate(params) {
    const update = params.update || params;
    const eventType = update.sessionUpdate || update.type;
    const content = update.content || update.data || {};

    // During session/load the agent replays the conversation history.
    // Skip it — the renderer already holds the chat from its own state.
    if (this.#suppressReplay) return;

    switch (eventType) {
      case 'agent_message_chunk': {
        const text = content.text || (typeof content === 'string' ? content : '');
        if (this.#contextQueryCollector) {
          this.#contextQueryCollector.push(text);
          break;
        }
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
        // ACP tool_call fields live directly on `update`, not in `content`.
        const callId = update.toolCallId || update.id || '';
        // Remember the kind so the follow-up tool_call_update (which frequently
        // omits `kind`) still resolves to the right tool name/icon in the UI.
        if (callId && update.kind) this.#toolKinds.set(callId, update.kind);
        this.#emitToRenderer({
          type: 'tool.execution_start',
          data: {
            toolCallId: callId,
            toolName: AcpClient.#mapToolKind(update.kind, update.title),
            arguments: update.rawInput || update.input || {},
          },
        });
        break;
      }

      case 'tool_call_update': {
        // → tool.execution_complete { toolCallId, toolName, success, result }
        const callId = update.toolCallId || update.id || '';
        // Fall back to the kind captured at tool_call time when this update omits it.
        const kind = update.kind || this.#toolKinds.get(callId);
        this.#emitToRenderer({
          type: 'tool.execution_complete',
          data: {
            toolCallId: callId,
            toolName: AcpClient.#mapToolKind(kind, update.title),
            success: update.error ? false : true,
            result: {
              content: AcpClient.#extractToolContent(update.content),
            },
            error: update.error || undefined,
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
        if (this.#contextQueryCollector) break;
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
        if (this.#contextQueryCollector) break;
        this.#emitToRenderer({
          type: 'assistant.turn_start',
          data: {},
        });
        break;
      }

      case 'agent_turn_end': {
        if (this.#contextQueryCollector) break;
        this.#emitToRenderer({
          type: 'assistant.turn_end',
          data: {},
        });
        // Signal completion if session/prompt hasn't already done so.
        if (!this.#promptDone) {
          this.#promptDone = true;
          this.#sendToRenderer('copilot:done', this.#tabId, this.#cancelRequested ? -1 : 0);
        }
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

      case 'user_message_chunk': {
        // Echo of the user's own message (e.g. during session/load history replay) — ignore.
        break;
      }

      case 'usage_update': {
        // Claude Code adapter: live context usage + subscription rate-limit + a
        // USD cost equivalent. → drive the context % and the subscription display.
        if (this.#contextQueryCollector) break;
        this.#emitToRenderer({
          type: 'session.usage_update',
          data: {
            used: update.used,
            size: update.size,
            rateLimit: update._meta?.['_claude/rateLimit'] || null,
            cost: update.cost || null,
          },
        });
        break;
      }

      case 'session_info_update': {
        // Adapter-generated session title (e.g. from the first message). Not used yet.
        break;
      }

      default: {
        // Unknown update — only dump the full payload under ACP_DEBUG to keep
        // normal logs clean; otherwise just note the type.
        if (DEBUG_ACP) {
          let dump;
          try { dump = JSON.stringify(update).slice(0, 2000); } catch (_) { dump = String(update); }
          console.log(`[acp:tab${this.#tabId}] unhandled update: ${eventType} :: ${dump}`);
        } else {
          console.log(`[acp:tab${this.#tabId}] unhandled update: ${eventType}`);
        }
        break;
      }
    }
  }

  // ── Private: Tool Mapping Helpers ────────────────────────────

  /**
   * Maps an ACP tool `kind` to the tool name the renderer's toolIcon expects.
   * @param {string} kind - ACP tool kind (read, edit, search, execute, fetch, ...)
   * @param {string} [title] - Human-readable title (fallback)
   * @returns {string}
   */
  static #mapToolKind(kind, title) {
    const map = {
      read: 'view',
      edit: 'edit',
      create: 'create',
      search: 'grep',
      execute: 'powershell',
      fetch: 'web_fetch',
      think: 'task',
    };
    return map[kind] || kind || title || '';
  }

  /**
   * Extracts text content from an ACP tool_call_update `content` array.
   * @param {Array|string} content - ACP content array or string
   * @returns {string}
   */
  static #extractToolContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((item) => {
        const inner = item?.content ?? item;
        if (typeof inner === 'string') return inner;
        return inner?.text || '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Extracts the current model from a session/new or session/load result and
   * emits it to the renderer so the tab header can show the active model.
   * @param {Object} result - The JSON-RPC result of session/new or session/load
   */
  #emitCurrentModel(result) {
    const models = result?.models;
    let modelId = models?.currentModelId;
    if (!modelId) {
      const modelOption = (result?.configOptions || []).find((o) => o.id === 'model');
      modelId = modelOption?.currentValue;
    }
    if (!modelId) return;
    // Resolve the human-readable name if available.
    const match = (models?.availableModels || []).find((m) => m.modelId === modelId);
    const name = match?.name || modelId;
    this.#emitToRenderer({ type: 'session.tools_updated', data: { model: name } });
  }

  /**
   * Emit the models the Copilot CLI reports as available for this account, so
   * the renderer can offer the real model list instead of a hardcoded one.
   * @param {Object} result - session/new|load result
   */
  #emitAvailableModels(result) {
    let models = [];
    let currentModelId = null;

    // Shape A (Copilot / old Claude Code adapter): result.models.availableModels
    const list = result?.models?.availableModels;
    if (Array.isArray(list) && list.length) {
      models = list.filter((m) => m && m.modelId).map((m) => ({ id: m.modelId, name: m.name || m.modelId }));
      currentModelId = result?.models?.currentModelId || null;
    }

    // Shape B (current Claude Code adapter): a configOptions entry id 'model'
    // with { options:[{value,name,description}], currentValue }.
    if (!models.length) {
      const opt = (result?.configOptions || []).find((o) => o && o.id === 'model');
      if (opt && Array.isArray(opt.options)) {
        models = opt.options
          .filter((o) => o && o.value)
          .map((o) => {
            // The version lives in the description ("Sonnet 5 · …"); the name is
            // just "Sonnet". Prefer the version so the UI shows model numbers.
            const version = String(o.description || '').split('·')[0].trim();
            let name = version || o.name || o.value;
            if (o.value === 'default' && version) name = `Default (${version})`;
            return { id: o.value, name };
          });
        currentModelId = opt.currentValue || null;
      }
    }

    if (models.length) {
      this.#emitToRenderer({ type: 'copilot.models_available', data: { models, currentModelId } });
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

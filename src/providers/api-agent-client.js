'use strict';

// Base class for direct LLM-API backends (Anthropic / Gemini / OpenAI-compatible).
//
// Implements the same "ChatBackend" surface as AcpClient (start/newSession/
// loadSession/prompt/silentCommand/cancel/stop/destroy + state/sessionId
// getters) and emits the SAME renderer event vocabulary over IPC, so the
// renderer treats it identically to the Copilot ACP backend.
//
// It owns the agentic tool loop, local tool execution (with deny-list gating)
// and token accounting. Provider-specific request/stream/tool-format details
// are delegated to subclass hooks (_ensureClient, _resetHistory, _pushUserText,
// _streamAssistantTurn, _pushToolResults).

const crypto = require('crypto');
const { executeTool } = require('./agent-tools');

const MAX_TOOL_ITERATIONS = 50;

class ApiAgentClient {
  #tabId;
  #sendToRenderer;
  #options;
  #state = 'dead';          // 'dead' | 'ready' | 'busy'
  #sessionId = null;
  #abort = null;

  // token accounting (cumulative for the session)
  _tokens = { input: 0, output: 0, cache: 0, cacheWrite: 0 };
  // size (in tokens) of the most recent request's full prompt — used for the
  // context-window utilisation percentage.
  _lastContextTokens = 0;

  /**
   * @param {number} tabId
   * @param {Function} sendToRenderer - (channel, ...args) => void
   * @param {Object} [options] - { cwd, model, deniedTools, apiKey, baseURL }
   */
  constructor(tabId, sendToRenderer, options = {}) {
    this.#tabId = tabId;
    this.#sendToRenderer = sendToRenderer;
    this.#options = options;
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get tabId() { return this.#tabId; }
  get options() { return this.#options; }

  updateOptions(opts = {}) {
    this.#options = { ...this.#options, ...opts };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start() {
    this._ensureClient();           // throws if no API key
    this.#state = 'ready';
  }

  async newSession(cwd) {
    if (cwd) this.#options.cwd = cwd;
    this.#sessionId = 'api-' + crypto.randomUUID();
    this._tokens = { input: 0, output: 0, cache: 0, cacheWrite: 0 };
    this._lastContextTokens = 0;
    this._resetHistory();
    // Mirror AcpClient: tell the renderer the new session id so it persists it.
    this.#emit({ type: 'result', sessionId: this.#sessionId });
    return this.#sessionId;
  }

  async loadSession(sessionId, cwd) {
    if (cwd) this.#options.cwd = cwd;
    this.#sessionId = sessionId;
    this._resetHistory();
    this._tokens = { input: 0, output: 0, cache: 0, cacheWrite: 0 };
    this._lastContextTokens = 0;

    // Restore persisted conversation history so the session continues with
    // full context. Stateless APIs have no server session, so this is the
    // only source of prior context. Token counters intentionally start at 0:
    // restoring cumulative tokens would make the renderer's delta-based cost
    // tracking re-count the already-logged usage. Context-% self-corrects on
    // the first turn (the next request includes the full restored history).
    try {
      const store = require('./session-store');
      const data = store.load(sessionId);
      if (data && Array.isArray(data.messages)) this._restoreHistory(data.messages);
    } catch (e) {
      console.warn('[api-agent] loadSession restore failed:', e?.message);
    }
    return this.#sessionId;
  }

  /** Persist the current session history (fire-and-forget, after each turn). */
  #persist() {
    if (!this.#sessionId) return;
    try {
      const store = require('./session-store');
      store.save(this.#sessionId, {
        model: this.#options.model,
        tokens: this._tokens,
        lastContextTokens: this._lastContextTokens,
        messages: this._serializeHistory(),
        ...this._persistedExtras(),
      });
    } catch (e) {
      console.warn('[api-agent] persist failed:', e?.message);
    }
  }

  async stop() { /* no separate process to stop */ }

  async cancel() {
    if (this.#abort) this.#abort.abort();
  }

  async destroy() {
    if (this.#abort) this.#abort.abort();
    this.#state = 'dead';
  }

  // ── Prompt (agentic loop) ──────────────────────────────────────

  async prompt(text) {
    this.#state = 'busy';
    this.#abort = new AbortController();
    const signal = this.#abort.signal;

    const emit = {
      text: (s) => this.#emit({ type: 'assistant.message_delta', data: { deltaContent: s } }),
      reasoning: (s) => this.#emit({ type: 'assistant.reasoning_delta', data: { deltaContent: s } }),
    };

    this.#emit({ type: 'assistant.turn_start', data: {} });

    try {
      this._pushUserText(text);

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        if (signal.aborted) throw new Error('Cancelled');

        const { toolUses, usage } = await this._streamAssistantTurn({ emit, signal });
        this.#addUsage(usage);

        if (!toolUses || toolUses.length === 0) break;

        // Execute each tool. CRITICAL: every emitted tool.execution_start must
        // get a matching tool.execution_complete (or the UI shows an orphaned
        // spinner forever), and every tool_use must get a tool_result (or the
        // next request to the API is rejected with a 400 — recurring "Code 1").
        // So even when cancelled we still emit a result for each tool.
        const results = [];
        for (const tu of toolUses) {
          this.#emit({
            type: 'tool.execution_start',
            data: { toolCallId: tu.id, toolName: tu.name, arguments: tu.input || {} },
          });
          const r = signal.aborted
            ? { ok: false, content: 'Abgebrochen.' }
            : await executeTool(tu.name, tu.input || {}, {
              cwd: this.#options.cwd,
              deniedTools: this.#options.deniedTools || [],
              signal,
            });
          this.#emit({
            type: 'tool.execution_complete',
            data: {
              toolCallId: tu.id,
              toolName: tu.name,
              success: r.ok,
              result: { content: r.content },
              error: r.ok ? undefined : r.content,
            },
          });
          results.push({ id: tu.id, name: tu.name, content: r.content, ok: r.ok });
        }

        // Push results first so the history stays valid, THEN honour the abort.
        this._pushToolResults(results);
        if (signal.aborted) throw new Error('Cancelled');
      }

      this.#emit({ type: 'assistant.turn_end', data: {} });
      this.#persist();
      this.#state = 'ready';
      this.#sendToRenderer('agent:done', this.#tabId, 0);
    } catch (err) {
      this.#state = 'ready';
      const cancelled = signal.aborted || err?.name === 'AbortError' || err?.message === 'Cancelled';
      if (cancelled) {
        this.#sendToRenderer('agent:done', this.#tabId, -1);
      } else {
        this.#emit({ type: 'error', data: { message: err?.message || String(err) } });
        this.#sendToRenderer('agent:done', this.#tabId, 1);
      }
    }
  }

  // ── Slash commands (local equivalents) ─────────────────────────

  async silentCommand(command) {
    const cmd = String(command || '').trim();
    if (cmd === '/usage') {
      // Match the Copilot /usage line shape so the renderer's existing cost
      // parser (parseUsageTokens) works unchanged.
      return `Tokens: input ${this._tokens.input}, output ${this._tokens.output}, cached ${this._tokens.cache}, cachewrite ${this._tokens.cacheWrite}`;
    }
    if (cmd === '/clear') {
      this._resetHistory();
      this._tokens = { input: 0, output: 0, cache: 0, cacheWrite: 0 };
      this._lastContextTokens = 0;
      return 'Kontext gelöscht.';
    }
    if (cmd === '/context') {
      const win = this._contextWindow() || 0;
      const used = this._lastContextTokens || 0;
      const pct = win ? Math.min(100, Math.round((used / win) * 100)) : 0;
      // The "(NN%)" suffix is what the renderer's parseContextPercent reads.
      return `Kontext: ${used.toLocaleString('de-DE')} / ${win.toLocaleString('de-DE')} Tokens (${pct}%)`;
    }
    if (cmd === '/compact') {
      // Don't mutate the history while a turn is streaming/using tools.
      if (this.#state === 'busy') return 'Verdichtung übersprungen (Antwort läuft noch).';
      await this._compact();
      this.#persist();
      return 'Kontext verdichtet.';
    }
    return '';
  }

  /** Context-window size (tokens) of the active model. Override per provider. */
  _contextWindow() { return 0; }
  /** Summarise the history in place to free context. Override per provider. */
  async _compact() { /* default: no-op */ }
  /** Return the provider-native message history as a serialisable array. */
  _serializeHistory() { return []; }
  /** Restore the provider-native message history from a serialised array. */
  _restoreHistory(_arr) { /* override per provider */ }
  /**
   * Extra provider-specific fields to persist alongside the message history
   * (e.g. Gemini's search/files mode, which lives on `options` per-tab and
   * would otherwise silently reset when a session is resumed in a fresh tab).
   * Override per provider; merged into the saved session-store payload.
   */
  _persistedExtras() { return {}; }

  // ── Internal helpers ───────────────────────────────────────────

  #emit(event) {
    this.#sendToRenderer('agent:event', this.#tabId, event);
  }

  #addUsage(u) {
    if (!u) return;
    this._tokens.input += u.input || 0;
    this._tokens.output += u.output || 0;
    this._tokens.cache += u.cache || 0;
    this._tokens.cacheWrite += u.cacheWrite || 0;
    if (u.contextTokens) this._lastContextTokens = u.contextTokens;
  }

  // ── Subclass hooks (must override) ─────────────────────────────

  /** Build/validate the provider SDK client. Throw if the API key is missing. */
  _ensureClient() { throw new Error('not implemented'); }
  /** Reset the provider-native message history. */
  _resetHistory() { throw new Error('not implemented'); }
  /** Append a user text message to history. */
  _pushUserText(_text) { throw new Error('not implemented'); }
  /**
   * Stream one assistant turn: emit text/reasoning deltas, append the assistant
   * message to history, and return { toolUses: [{id,name,input}], usage: {input,output,cache} }.
   */
  async _streamAssistantTurn(_ctx) { throw new Error('not implemented'); }
  /** Append tool results [{id,name,content,ok}] to history in provider-native form. */
  _pushToolResults(_results) { throw new Error('not implemented'); }
}

module.exports = { ApiAgentClient, MAX_TOOL_ITERATIONS };

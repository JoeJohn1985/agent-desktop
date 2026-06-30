'use strict';

// Shared base for OpenAI-compatible chat-completions backends (OpenAI, Ollama,
// GLM/Zhipu). All three speak the same `/chat/completions` wire format with
// `tools` (function calling) and SSE streaming, so the agentic tool loop lives
// here; the concrete adapters only differ in base URL, auth and model metadata.
//
// Dependency-free: uses Node's global fetch + manual SSE parsing (no `openai`
// package), which keeps the bundle small and the base URL fully configurable.

const os = require('os');
const { ApiAgentClient } = require('./api-agent-client');
const { getToolDefs } = require('./agent-tools');

const MAX_OUTPUT_TOKENS = 8192;

/** Convert provider-agnostic tool defs to OpenAI `tools` (function calling). */
function toOpenAITools(defs) {
  return defs.map(d => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

function buildSystemPrompt(cwd, extra) {
  const lines = [
    'You are a helpful coding and research assistant embedded in a desktop app.',
    'You can run shell commands and read/write files via the provided tools.',
    `Working directory: ${cwd}`,
    `Operating system: ${os.platform()} (${os.release()})`,
    'Lead with the outcome; keep explanations concise.',
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

/**
 * Parse an OpenAI-style SSE stream, invoking callbacks for text deltas and
 * accumulating tool calls + usage. Returns { content, toolCalls, usage }.
 * @param {AsyncIterable<Uint8Array>} body
 * @param {(s:string)=>void} onText
 */
async function consumeSSEStream(body, onText) {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = []; // index → { id, name, args }
  let usage = null;

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.usage) usage = json.usage;
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) { content += delta.content; onText(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const idx = tc.index || 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || '', name: '', args: '' };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
      }
    }
  }
  return { content, toolCalls: toolCalls.filter(Boolean), usage };
}

class OpenAICompatibleProvider extends ApiAgentClient {
  #messages = [];
  #tools = toOpenAITools(getToolDefs());

  // ── Adapter configuration (override in subclasses) ─────────────
  /** Default base URL (no trailing slash), e.g. https://api.openai.com/v1. */
  _defaultBaseURL() { throw new Error('not implemented'); }
  /** Whether this provider requires an API key (false → keyless, e.g. Ollama). */
  _requiresKey() { return true; }
  /** Context-window size per model. Override per provider. */
  _contextWindow() { return 128_000; }
  /** Human label for error messages. */
  _providerName() { return 'OpenAI-kompatibel'; }
  /**
   * Name of the output-token-limit request field. OpenAI's newer models
   * (gpt-5.x / o-series) reject `max_tokens` and require `max_completion_tokens`;
   * GLM/Ollama use `max_tokens`. Override per provider.
   */
  _tokenLimitParam() { return 'max_tokens'; }

  #baseURL() {
    return (this.options.baseURL || this._defaultBaseURL()).replace(/\/$/, '');
  }

  _ensureClient() {
    if (this._requiresKey() && !this.options.apiKey) {
      throw new Error(`Kein API-Key für ${this._providerName()} hinterlegt.`);
    }
    return true;
  }

  _resetHistory() {
    this.#messages = [{ role: 'system', content: buildSystemPrompt(this.options.cwd || process.cwd(), this.options.systemContext) }];
  }

  _pushUserText(text) {
    if (this.#messages.length === 0) this._resetHistory();
    this.#messages.push({ role: 'user', content: text });
  }

  async _streamAssistantTurn({ emit, signal }) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;

    const res = await fetch(`${this.#baseURL()}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: this.options.model,
        messages: this.#messages,
        tools: this.#tools,
        stream: true,
        stream_options: { include_usage: true },
        [this._tokenLimitParam()]: MAX_OUTPUT_TOKENS,
      }),
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `HTTP ${res.status} ${res.statusText}`);
    }

    const { content, toolCalls, usage } = await consumeSSEStream(res.body, emit.text);

    // Append the assistant message (text + any tool calls) to history.
    const assistantMsg = { role: 'assistant', content: content || null };
    if (toolCalls.length) {
      assistantMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args || '{}' },
      }));
    }
    this.#messages.push(assistantMsg);

    const toolUses = toolCalls.map(tc => {
      let input = {};
      try { input = JSON.parse(tc.args || '{}'); } catch { /* malformed → empty */ }
      return { id: tc.id, name: tc.name, input };
    });

    const prompt = usage?.prompt_tokens || 0;
    const cached = usage?.prompt_tokens_details?.cached_tokens || 0;
    return {
      toolUses,
      usage: {
        input: Math.max(0, prompt - cached),
        cache: cached,
        output: usage?.completion_tokens || 0,
        contextTokens: prompt,
      },
    };
  }

  _pushToolResults(results) {
    for (const r of results) {
      this.#messages.push({ role: 'tool', tool_call_id: r.id, content: String(r.content ?? '') });
    }
  }

  _serializeHistory() { return this.#messages; }
  _restoreHistory(arr) { this.#messages = Array.isArray(arr) && arr.length ? arr : []; }
}

module.exports = { OpenAICompatibleProvider, toOpenAITools, buildSystemPrompt, consumeSSEStream };

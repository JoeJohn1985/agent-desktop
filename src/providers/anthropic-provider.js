'use strict';

// Anthropic provider — direct Messages API backend with the agentic tool loop.
// Extends ApiAgentClient; implements the provider-specific hooks using
// @anthropic-ai/sdk (streaming, adaptive thinking, manual tool loop).

const os = require('os');
const { ApiAgentClient } = require('./api-agent-client');
const { getToolDefs, SHELL_NAME } = require('./agent-tools');

const MAX_TOKENS = 16000;

// Context-window sizes per Anthropic model (tokens).
const CONTEXT_WINDOWS = {
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-8': 1_000_000,
};

/**
 * Converts the provider-agnostic tool defs to Anthropic's tool format.
 * @param {Array<{name,description,parameters}>} defs
 * @returns {Array<{name,description,input_schema}>}
 */
function toAnthropicTools(defs) {
  return defs.map(d => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
  }));
}

function buildSystemPrompt(cwd, extraContext) {
  const base = [
    'You are a capable software engineering agent embedded in a desktop app.',
    'You can read and write files and run shell commands via the provided tools.',
    `Working directory: ${cwd}`,
    `Operating system: ${os.platform()} (${os.release()})`,
    `The "shell" tool runs commands in ${SHELL_NAME} — use that shell's syntax.`,
    'When you need information from the project, use the tools rather than guessing.',
    'Lead with the outcome; keep explanations concise.',
  ].join('\n');
  // Project instructions, active agents and skills (cached as part of the prefix).
  return extraContext ? `${base}\n\n${extraContext}` : base;
}

class AnthropicProvider extends ApiAgentClient {
  #client = null;
  #messages = [];
  #tools = toAnthropicTools(getToolDefs());

  _ensureClient() {
    if (this.#client) return this.#client;
    const apiKey = this.options.apiKey;
    if (!apiKey) throw new Error('Kein Anthropic-API-Key hinterlegt.');
    // Lazy require so the SDK is only loaded when actually used.
    const Anthropic = require('@anthropic-ai/sdk');
    this.#client = new Anthropic({ apiKey });
    return this.#client;
  }

  _resetHistory() {
    this.#messages = [];
  }

  _pushUserText(text) {
    this.#messages.push({ role: 'user', content: text });
  }

  async _streamAssistantTurn({ emit, signal }) {
    const client = this._ensureClient();
    const model = this.options.model;

    const stream = client.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(this.options.cwd || process.cwd(), this.options.systemContext),
        thinking: { type: 'adaptive', display: 'summarized' },
        tools: this.#tools,
        messages: this.#messages,
        // Prompt caching: auto-place a breakpoint on the last cacheable block.
        // The growing system+tools+history prefix is then re-read at ~10% cost
        // on each agent-loop round-trip and on subsequent turns.
        cache_control: { type: 'ephemeral' },
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') emit.text(event.delta.text);
        else if (event.delta.type === 'thinking_delta') emit.reasoning(event.delta.thinking);
      }
    }

    const final = await stream.finalMessage();

    // Persist the assistant turn verbatim (tool_use blocks must be preserved).
    this.#messages.push({ role: 'assistant', content: final.content });

    const toolUses = [];
    for (const block of final.content) {
      if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    if (final.stop_reason === 'refusal') {
      emit.text('\n[Die Anfrage wurde vom Modell aus Sicherheitsgründen abgelehnt.]');
    }

    const u = final.usage || {};
    const contextTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    return {
      toolUses,
      usage: {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cache: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        contextTokens,
      },
    };
  }

  _pushToolResults(results) {
    this.#messages.push({
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        is_error: !r.ok,
      })),
    });
  }

  _contextWindow() {
    return CONTEXT_WINDOWS[this.options.model] || 200_000;
  }

  _serializeHistory() {
    return this.#messages;
  }

  _restoreHistory(arr) {
    this.#messages = Array.isArray(arr) ? arr : [];
  }

  /**
   * Summarises the conversation so far into a single context message, freeing
   * the bulk of the history. Runs between turns (history ends cleanly).
   */
  async _compact() {
    if (this.#messages.length === 0) return;
    const client = this._ensureClient();
    const resp = await client.messages.create({
      model: this.options.model,
      max_tokens: 2048,
      system: 'Fasse den bisherigen Gesprächsverlauf knapp und vollständig zusammen: wichtige Fakten, getroffene Entscheidungen, relevante Dateipfade und noch offene Aufgaben. Antworte ausschließlich mit der Zusammenfassung.',
      messages: [
        ...this.#messages,
        { role: 'user', content: 'Bitte den bisherigen Verlauf wie instruiert zusammenfassen.' },
      ],
    });
    const summary = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    this.#messages = [
      { role: 'user', content: `Bisheriger Kontext (automatisch zusammengefasst):\n${summary}` },
    ];
    this._lastContextTokens = 0;
  }
}

module.exports = { AnthropicProvider, toAnthropicTools, buildSystemPrompt };

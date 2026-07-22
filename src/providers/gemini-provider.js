'use strict';

// Google Gemini provider — research-oriented backend. Lighter than the Anthropic
// adapter: it gets the file tools (read/create/edit/list/search) so it can write
// files, but NOT the shell tool, and NO skills/agents/instructions injection.
//
// @google/genai is ESM-only, so the client is loaded via dynamic import() at
// call time (this file itself stays CommonJS-requireable).

const os = require('os');
const crypto = require('crypto');
const { ApiAgentClient } = require('./api-agent-client');
const { getToolDefs } = require('./agent-tools');

const MAX_OUTPUT_TOKENS = 8192;

const CONTEXT_WINDOWS = {
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-3.5-flash': 1_048_576,
};

// File tools only — research + file creation, no arbitrary command execution.
const GEMINI_TOOL_NAMES = ['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep'];

function jsonTypeToGemini(t) {
  return { string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', object: 'OBJECT', array: 'ARRAY' }[t] || 'STRING';
}

/** Convert a JSON-Schema fragment to Gemini's Schema (uppercase Type enum). */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = { type: jsonTypeToGemini(schema.type) };
  if (schema.description) out.description = schema.description;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

/** Convert provider-agnostic tool defs to Gemini functionDeclarations. */
function toGeminiTools(defs) {
  return [{
    functionDeclarations: defs.map(d => ({
      name: d.name,
      description: d.description,
      parameters: toGeminiSchema(d.parameters),
    })),
  }];
}

/**
 * Extracts deduplicated web sources from Gemini grounding metadata.
 * @param {Object|null} grounding - candidate.groundingMetadata
 * @returns {Array<{title: string, uri: string}>}
 */
function collectSources(grounding) {
  const chunks = (grounding && grounding.groundingChunks) || [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const web = c && c.web;
    if (!web || !web.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    out.push({ title: web.title || web.domain || web.uri, uri: web.uri });
  }
  return out;
}

// Gemini 2.5 forbids combining the built-in googleSearch tool with custom
// functionDeclarations in the same request, so each turn runs in exactly one
// mode. The mode is switchable per tab between turns.
const GEMINI_MODES = ['search', 'files'];
const DEFAULT_GEMINI_MODE = 'search';

const FILE_TOOLS = toGeminiTools(getToolDefs().filter(d => GEMINI_TOOL_NAMES.includes(d.name)));
const SEARCH_TOOLS = [{ googleSearch: {} }];

function resolveGeminiMode(mode) {
  return GEMINI_MODES.includes(mode) ? mode : DEFAULT_GEMINI_MODE;
}

function buildSystemPrompt(cwd, mode) {
  const lines = [
    'You are a helpful research and writing assistant embedded in a desktop app.',
  ];
  if (resolveGeminiMode(mode) === 'search') {
    lines.push('You can search the web (Google Search) for current information and cite your sources.');
    lines.push('File tools are disabled in this mode; if the user wants the result saved to a file, tell them to switch to "Datei-Modus" and ask again.');
  } else {
    lines.push('You can read files and create or edit files via the provided tools (there is no shell).');
    lines.push('Live web search is disabled in this mode; rely on the conversation and files. If current web info is needed, tell the user to switch to "Recherche-Modus".');
  }
  lines.push(`Working directory: ${cwd}`);
  lines.push(`Operating system: ${os.platform()} (${os.release()})`);
  lines.push('Lead with the outcome; keep explanations concise.');
  return lines.join('\n');
}

class GeminiProvider extends ApiAgentClient {
  #client = null;
  #contents = [];

  // Active tool set per turn: either live Google Search OR the file tools — never
  // both (Gemini 2.5 rejects the combination). Driven by options.geminiMode.
  get #mode() { return resolveGeminiMode(this.options.geminiMode); }
  get #tools() { return this.#mode === 'search' ? SEARCH_TOOLS : FILE_TOOLS; }

  _ensureClient() {
    if (!this.options.apiKey) throw new Error('Kein Google-Gemini-API-Key hinterlegt.');
    return true; // real client is built lazily in #getClient() (ESM import)
  }

  async #getClient() {
    if (this.#client) return this.#client;
    const { GoogleGenAI } = await import('@google/genai');
    this.#client = new GoogleGenAI({ apiKey: this.options.apiKey });
    return this.#client;
  }

  _resetHistory() { this.#contents = []; }

  _pushUserText(text) {
    this.#contents.push({ role: 'user', parts: [{ text }] });
  }

  async _streamAssistantTurn({ emit, signal }) {
    const ai = await this.#getClient();
    const stream = await ai.models.generateContentStream({
      model: this.options.model,
      contents: this.#contents,
      config: {
        systemInstruction: buildSystemPrompt(this.options.cwd || process.cwd(), this.#mode),
        tools: this.#tools,
        abortSignal: signal,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    let fullText = '';
    const callsByKey = new Map(); // dedupe in case a call repeats across chunks
    let usage = null;
    let grounding = null;

    for await (const chunk of stream) {
      const t = chunk.text;
      if (t) { fullText += t; emit.text(t); }
      const calls = chunk.functionCalls;
      if (calls && calls.length) {
        for (const fc of calls) {
          const key = `${fc.name}:${JSON.stringify(fc.args || {})}`;
          if (!callsByKey.has(key)) callsByKey.set(key, fc);
        }
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const gm = chunk.candidates && chunk.candidates[0] && chunk.candidates[0].groundingMetadata;
      if (gm) grounding = gm;
    }

    // Surface web-search sources as a citation footer (UI only, not persisted).
    const sources = collectSources(grounding);
    if (sources.length) {
      emit.text('\n\n---\n**Quellen:**\n' + sources.map(s => `- [${s.title}](${s.uri})`).join('\n'));
    }

    // Rebuild the model turn for history (text + functionCall parts).
    const calls = [...callsByKey.values()];
    const parts = [];
    if (fullText) parts.push({ text: fullText });
    for (const fc of calls) parts.push({ functionCall: { name: fc.name, args: fc.args || {} } });
    if (parts.length) this.#contents.push({ role: 'model', parts });

    const toolUses = calls.map(fc => ({
      id: fc.id || ('gem-' + crypto.randomUUID()), // synthetic id for the UI only
      name: fc.name,
      input: fc.args || {},
    }));

    const prompt = (usage && usage.promptTokenCount) || 0;
    const cached = (usage && usage.cachedContentTokenCount) || 0;
    return {
      toolUses,
      usage: {
        input: Math.max(0, prompt - cached),
        cache: cached,
        output: (usage && usage.candidatesTokenCount) || 0,
        contextTokens: prompt,
      },
    };
  }

  _pushToolResults(results) {
    // Gemini matches function responses to calls positionally (by name/order),
    // so we push them in the same order the model requested them.
    this.#contents.push({
      role: 'user',
      parts: results.map(r => ({
        functionResponse: { name: r.name, response: { output: r.content, success: r.ok } },
      })),
    });
  }

  _contextWindow() { return CONTEXT_WINDOWS[this.options.model] || 1_000_000; }
  _serializeHistory() { return this.#contents; }
  _restoreHistory(arr) { this.#contents = Array.isArray(arr) ? arr : []; }
  // Persist the active search/files mode so resuming a session (in a fresh
  // tab, which starts with the default mode) doesn't silently switch tools.
  _persistedExtras() { return { geminiMode: this.options.geminiMode }; }
}

module.exports = { GeminiProvider, toGeminiTools, toGeminiSchema, buildSystemPrompt, collectSources, resolveGeminiMode, GEMINI_MODES, DEFAULT_GEMINI_MODE };

'use strict';

// Dynamic model discovery for the direct-API providers. Each provider exposes a
// "list models" endpoint; we normalize the responses to [{id, name}]. The parsers
// are pure (unit-tested); listModels() is the thin fetch wrapper.
//
// Copilot models are discovered separately via ACP (see acp-client.js) and are
// NOT handled here.

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  ollama: 'http://localhost:11434/v1',
};

const FETCH_TIMEOUT_MS = 15_000;

// Non-chat model families that /models also returns (OpenAI et al.) but that
// cannot serve as a chat model — filtered out so they don't pollute the picker.
const NON_CHAT_MODEL = /(embedding|whisper|tts|dall-e|dalle|moderation|image|audio|realtime|rerank|speech|transcrib)/i;

// Gemini-specific: Google's catalog also returns image/video/music/robotics/
// agent models that still report `generateContent` as a supported method (it's
// the shared multimodal endpoint), so NON_CHAT_MODEL alone lets them through.
// Everything here is either non-text output or a specialized agent product,
// not a general chat model a user would pick in this dropdown.
// Matched against the raw `models/<id>` name (prefix still attached), so no
// `^` anchors — "models/veo-..." / "models/lyria-..." would never match one.
const NON_CHAT_MODEL_GEMINI = /(embedding|tts|image|audio|video|live|transcrib|computer-use|robotics|deep-research|antigravity|omni|veo-|lyria-)/i;

/** OpenAI-compatible /models → [{id,name}] (chat-capable only). */
function parseOpenAIModels(json) {
  const data = json && json.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter(m => m && m.id && !NON_CHAT_MODEL.test(String(m.id)))
    .map(m => ({ id: String(m.id), name: String(m.id) }));
}

/** Anthropic /v1/models → [{id,name}]. */
function parseAnthropicModels(json) {
  const data = json && json.data;
  if (!Array.isArray(data)) return [];
  return data.filter(m => m && m.id).map(m => ({ id: String(m.id), name: String(m.display_name || m.id) }));
}

/**
 * Gemini /v1beta/models → [{id,name}] (chat-capable only).
 *
 * `generateContent` alone isn't a reliable chat-model filter here: Google's
 * catalog also lists image/video/music/robotics/agent models under the same
 * shared endpoint, so without NON_CHAT_MODEL_GEMINI a discovery run returns
 * dozens of entries no one would pick from a chat dropdown.
 */
function parseGeminiModels(json) {
  const list = json && json.models;
  if (!Array.isArray(list)) return [];
  return list
    .filter(m => m && m.name)
    .filter(m => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
    .filter(m => !NON_CHAT_MODEL_GEMINI.test(String(m.name)))
    .map(m => ({ id: String(m.name).replace(/^models\//, ''), name: String(m.displayName || m.name).replace(/^models\//, '') }));
}

/**
 * List the models a provider currently offers. Returns [{id,name}]; throws on
 * HTTP/network errors (caller decides how to surface).
 * @param {string} provider - anthropic | gemini | openai | glm | ollama
 * @param {{apiKey?:string, baseURL?:string}} [opts]
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
async function listModels(provider, opts = {}) {
  const { apiKey, baseURL } = opts;
  const signalOpt = { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), windowsHide: true };

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' },
      ...signalOpt,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseAnthropicModels(await res.json());
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey || '')}`;
    const res = await fetch(url, signalOpt);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGeminiModels(await res.json());
  }

  // OpenAI-compatible: openai, glm, ollama.
  const base = (baseURL || DEFAULT_BASE_URLS[provider] || '').replace(/\/$/, '');
  if (!base) return [];
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}/models`, { headers, ...signalOpt });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseOpenAIModels(await res.json());
}

module.exports = {
  listModels,
  parseOpenAIModels,
  parseAnthropicModels,
  parseGeminiModels,
  DEFAULT_BASE_URLS,
};

'use strict';

// Provider registry: maps a model ID to its backend provider and constructs
// the right ChatBackend implementation. The Copilot ACP backend is handled
// directly in main.js (it needs the CLI/MCP wiring); this registry covers the
// direct-API providers.

const { getModelProvider } = require('../renderer-logic');
const { AnthropicProvider } = require('./anthropic-provider');
const { GeminiProvider } = require('./gemini-provider');
const { OpenAIProvider } = require('./openai-provider');
const { OllamaProvider } = require('./ollama-provider');
const { GlmProvider } = require('./glm-provider');

/**
 * Creates a direct-API backend for the given provider, or returns null if the
 * provider is 'copilot' (handled by AcpClient) or unknown.
 * @param {string} provider
 * @param {number} tabId
 * @param {Function} sendToRenderer
 * @param {Object} options - { cwd, model, deniedTools, apiKey, baseURL }
 * @returns {import('./api-agent-client').ApiAgentClient|null}
 */
function createApiBackend(provider, tabId, sendToRenderer, options) {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(tabId, sendToRenderer, options);
    case 'gemini':
      return new GeminiProvider(tabId, sendToRenderer, options);
    case 'openai':
      return new OpenAIProvider(tabId, sendToRenderer, options);
    case 'ollama':
      return new OllamaProvider(tabId, sendToRenderer, options);
    case 'glm':
      return new GlmProvider(tabId, sendToRenderer, options);
    default:
      return null;
  }
}

module.exports = { getModelProvider, createApiBackend };

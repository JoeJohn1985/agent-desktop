'use strict';

// Ollama provider — local models via Ollama's OpenAI-compatible endpoint.
// Keyless and local; the base URL (host/port) is configurable in the settings.

const { OpenAICompatibleProvider } = require('./openai-compatible-provider');

class OllamaProvider extends OpenAICompatibleProvider {
  _defaultBaseURL() { return 'http://localhost:11434/v1'; }
  _providerName() { return 'Ollama'; }
  _requiresKey() { return false; } // local, no API key
  _contextWindow() { return 32_768; } // model-dependent; conservative default
}

module.exports = { OllamaProvider };

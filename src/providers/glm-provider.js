'use strict';

// GLM provider — Zhipu AI's GLM models via their OpenAI-compatible endpoint.

const { OpenAICompatibleProvider } = require('./openai-compatible-provider');

const CONTEXT_WINDOWS = {
  'glm-4.6': 200_000,
  'glm-4.5': 128_000,
  'glm-4.5-air': 128_000,
};

class GlmProvider extends OpenAICompatibleProvider {
  _defaultBaseURL() { return 'https://open.bigmodel.cn/api/paas/v4'; }
  _providerName() { return 'GLM (Zhipu)'; }
  _contextWindow() { return CONTEXT_WINDOWS[this.options.model] || 128_000; }
}

module.exports = { GlmProvider, GLM_CONTEXT_WINDOWS: CONTEXT_WINDOWS };

'use strict';

// OpenAI provider — direct OpenAI API (chat completions + function calling).

const { OpenAICompatibleProvider } = require('./openai-compatible-provider');

const CONTEXT_WINDOWS = {
  'gpt-5.1': 400_000,
  'gpt-5.1-mini': 400_000,
  'gpt-4.1': 1_047_576,
};

class OpenAIProvider extends OpenAICompatibleProvider {
  _defaultBaseURL() { return 'https://api.openai.com/v1'; }
  _providerName() { return 'OpenAI'; }
  _tokenLimitParam() { return 'max_completion_tokens'; } // gpt-5.x/o-series reject max_tokens
  _contextWindow() { return CONTEXT_WINDOWS[this.options.model] || 128_000; }
}

module.exports = { OpenAIProvider, OPENAI_CONTEXT_WINDOWS: CONTEXT_WINDOWS };

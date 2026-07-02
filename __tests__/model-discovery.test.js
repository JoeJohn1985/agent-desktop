'use strict';

const {
  parseOpenAIModels,
  parseAnthropicModels,
  parseGeminiModels,
} = require('../src/model-discovery');

describe('model-discovery: parseOpenAIModels', () => {
  it('mappt data[].id → {id,name}', () => {
    expect(parseOpenAIModels({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] }))
      .toEqual([{ id: 'gpt-5', name: 'gpt-5' }, { id: 'gpt-4o', name: 'gpt-4o' }]);
  });
  it('robust bei fehlendem/ungültigem data', () => {
    expect(parseOpenAIModels({})).toEqual([]);
    expect(parseOpenAIModels(null)).toEqual([]);
    expect(parseOpenAIModels({ data: [{}, { id: 'ok' }] })).toEqual([{ id: 'ok', name: 'ok' }]);
  });
  it('filtert Nicht-Chat-Modelle (Embeddings/TTS/Whisper/DALL·E) heraus', () => {
    const res = parseOpenAIModels({ data: [
      { id: 'gpt-5' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'tts-1' },
      { id: 'dall-e-3' },
      { id: 'omni-moderation-latest' },
    ] });
    expect(res).toEqual([{ id: 'gpt-5', name: 'gpt-5' }]);
  });
});

describe('model-discovery: parseAnthropicModels', () => {
  it('nutzt display_name als Name', () => {
    expect(parseAnthropicModels({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] }))
      .toEqual([{ id: 'claude-opus-4-8', name: 'Claude Opus 4.8' }]);
  });
  it('fällt auf id zurück, wenn kein display_name', () => {
    expect(parseAnthropicModels({ data: [{ id: 'x' }] })).toEqual([{ id: 'x', name: 'x' }]);
  });
});

describe('model-discovery: parseGeminiModels', () => {
  it('entfernt models/-Präfix und nutzt displayName', () => {
    expect(parseGeminiModels({ models: [{ name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' }] }))
      .toEqual([{ id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' }]);
  });
  it('filtert Modelle ohne generateContent-Support heraus', () => {
    const res = parseGeminiModels({
      models: [
        { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    expect(res).toEqual([{ id: 'gemini-pro', name: 'gemini-pro' }]);
  });
  it('robust bei ungültiger Eingabe', () => {
    expect(parseGeminiModels(null)).toEqual([]);
    expect(parseGeminiModels({})).toEqual([]);
  });
});

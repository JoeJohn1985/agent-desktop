'use strict';

const {
  listModels,
  parseOpenAIModels,
  parseAnthropicModels,
  parseGeminiModels,
  DEFAULT_BASE_URLS,
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

// ── listModels: der Fetch-Wrapper ────────────────────────────
// Netzwerk wird über global.fetch gemockt — es geht nie ein echter Request raus.

describe('model-discovery: listModels', () => {
  const origFetch = global.fetch;

  /** Lässt den nächsten fetch() eine Antwort mit diesem JSON liefern. */
  function mockJson(json, { ok = true, status = 200 } = {}) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      json: async () => json,
    });
  }

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  describe('anthropic', () => {
    it('ruft den /v1/models-Endpunkt mit API-Key und Version auf', async () => {
      mockJson({ data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }] });
      const res = await listModels('anthropic', { apiKey: 'sk-test' });

      expect(res).toEqual([{ id: 'claude-opus-5', name: 'Claude Opus 5' }]);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
      expect(opts.headers['x-api-key']).toBe('sk-test');
      expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('sendet einen leeren Key statt undefined, wenn keiner übergeben wird', async () => {
      mockJson({ data: [] });
      await listModels('anthropic', {});
      expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe('');
    });

    it('wirft bei HTTP-Fehlerstatus', async () => {
      mockJson({}, { ok: false, status: 401 });
      await expect(listModels('anthropic', { apiKey: 'x' })).rejects.toThrow('HTTP 401');
    });
  });

  describe('gemini', () => {
    it('übergibt den Key URL-kodiert als Query-Parameter', async () => {
      mockJson({ models: [{ name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro' }] });
      const res = await listModels('gemini', { apiKey: 'a+b/c' });

      expect(res).toEqual([{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }]);
      expect(global.fetch.mock.calls[0][0]).toContain('key=a%2Bb%2Fc');
    });

    it('wirft bei HTTP-Fehlerstatus', async () => {
      mockJson({}, { ok: false, status: 403 });
      await expect(listModels('gemini', { apiKey: 'x' })).rejects.toThrow('HTTP 403');
    });
  });

  describe('OpenAI-kompatible Provider', () => {
    it.each([
      ['openai', 'https://api.openai.com/v1'],
      ['glm', 'https://open.bigmodel.cn/api/paas/v4'],
      ['ollama', 'http://localhost:11434/v1'],
    ])('nutzt für %s die hinterlegte Standard-Basis-URL', async (provider, base) => {
      mockJson({ data: [{ id: 'm1' }] });
      const res = await listModels(provider, { apiKey: 'k' });

      expect(res).toEqual([{ id: 'm1', name: 'm1' }]);
      expect(global.fetch.mock.calls[0][0]).toBe(`${base}/models`);
      expect(DEFAULT_BASE_URLS[provider]).toBe(base);
    });

    it('setzt den Authorization-Header nur bei vorhandenem Key', async () => {
      mockJson({ data: [] });
      await listModels('ollama', {});
      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();

      mockJson({ data: [] });
      await listModels('openai', { apiKey: 'sk-1' });
      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-1');
    });

    it('bevorzugt eine eigene baseURL und entfernt einen Schrägstrich am Ende', async () => {
      mockJson({ data: [] });
      await listModels('ollama', { baseURL: 'http://eigen:1234/v1/' });
      expect(global.fetch.mock.calls[0][0]).toBe('http://eigen:1234/v1/models');
    });

    it('filtert Nicht-Chat-Modelle auch über listModels heraus', async () => {
      mockJson({ data: [{ id: 'gpt-5' }, { id: 'text-embedding-3' }, { id: 'whisper-1' }] });
      expect(await listModels('openai', { apiKey: 'k' })).toEqual([{ id: 'gpt-5', name: 'gpt-5' }]);
    });

    it('wirft bei HTTP-Fehlerstatus', async () => {
      mockJson({}, { ok: false, status: 500 });
      await expect(listModels('openai', { apiKey: 'k' })).rejects.toThrow('HTTP 500');
    });

    it('liefert [] für einen unbekannten Provider ohne baseURL — ohne Netzwerkaufruf', async () => {
      global.fetch = jest.fn();
      expect(await listModels('gibtsnicht', {})).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Fehlerfälle über alle Provider', () => {
    it('reicht Netzwerkfehler durch', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(listModels('openai', { apiKey: 'k' })).rejects.toThrow('ECONNREFUSED');
    });

    it('reicht ungültiges JSON durch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      });
      await expect(listModels('anthropic', { apiKey: 'k' })).rejects.toThrow(SyntaxError);
    });

    it('setzt für jeden Request ein Timeout-Signal', async () => {
      mockJson({ data: [] });
      await listModels('openai', { apiKey: 'k' });
      expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('wird ohne opts-Argument nicht zum Absturz gebracht', async () => {
      mockJson({ data: [] });
      await expect(listModels('openai')).resolves.toEqual([]);
    });
  });
});

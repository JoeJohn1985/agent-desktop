'use strict';

jest.mock('../src/providers/session-store');
const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn(() => ({ messages: { create: mockAnthropicCreate } })));

const { createApiBackend } = require('../src/providers');
const store = require('../src/providers/session-store');

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('Native API-Verdichtung', () => {
  test.each(['openai', 'glm', 'ollama'])('%s ersetzt Historie erst nach bestätigter vollständiger Zusammenfassung', async provider => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Bewahrte Entscheidungen' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } } }),
    });
    const client = createApiBackend(provider, 1, () => {}, { apiKey: 'fake', model: 'model', baseURL: 'https://example.invalid/v1' });
    client._pushUserText('Alte Nachricht');
    await client.newSession();
    client._pushUserText('Alte Nachricht');
    client._lastContextTokens = 100000;
    await expect(client.silentCommand('/compact')).resolves.toBe('Kontext verdichtet.');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.messages[1].content).toBe('Alte Nachricht');
    expect(client._serializeHistory()).toHaveLength(2);
    expect(client._serializeHistory()[1].content).toContain('Bewahrte Entscheidungen');
    expect(client._lastContextTokens).toBeNull();
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(client._tokens).toEqual({ input: 90, output: 20, cache: 10, cacheWrite: 0 });
  });

  test.each([
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { content: 'abgeschnitten' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
  ])('OpenAI: leere/abgeschnittene Antwort zerstört Historie nicht', async data => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => data });
    const client = createApiBackend('openai', 1, () => {}, { apiKey: 'fake' });
    client._pushUserText('Bewahren');
    const before = client._serializeHistory();
    await expect(client.silentCommand('/compact')).rejects.toThrow('Keine vollständige');
    expect(client._serializeHistory()).toBe(before);
  });

  test('OpenAI HTTP-Fehler wird sichtbar weitergereicht', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, text: async () => 'HTTP 429' });
    const client = createApiBackend('openai', 1, () => {}, { apiKey: 'fake' });
    client._pushUserText('Bewahren');
    await expect(client.silentCommand('/compact')).rejects.toThrow('HTTP 429');
  });

  test('Gemini fasst ohne Tools zusammen und prüft finishReason', async () => {
    const generateContent = jest.fn(async () => ({ text: 'Gemini-Zusammenfassung', candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 10 } }));
    const client = createApiBackend('gemini', 1, () => {}, { apiKey: 'fake', genAiClient: { models: { generateContent } } });
    client._pushUserText('Alte Nachricht');
    await client.silentCommand('/compact');
    expect(generateContent.mock.calls[0][0].config.tools).toBeUndefined();
    expect(client._tokens).toEqual({ input: 90, output: 20, cache: 10, cacheWrite: 0 });
    expect(client._serializeHistory()).toEqual([{ role: 'user', parts: [{ text: 'Bisheriger Kontext (zusammengefasst):\nGemini-Zusammenfassung' }] }]);
    client._pushUserText('Neue Nachricht');
    const before = client._serializeHistory();
    generateContent.mockResolvedValue({ text: 'abgeschnitten', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(client.silentCommand('/compact')).rejects.toThrow('Keine vollständige');
    expect(client._serializeHistory()).toBe(before);
  });

  test('Anthropic akzeptiert keine leere oder abgeschnittene Zusammenfassung', async () => {
    const client = createApiBackend('anthropic', 1, () => {}, { apiKey: 'fake' });
    client._pushUserText('Bewahren');
    const before = client._serializeHistory();
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Teilweise' }] });
    await expect(client.silentCommand('/compact')).rejects.toThrow('Keine vollständige');
    expect(client._serializeHistory()).toBe(before);
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(client.silentCommand('/compact')).rejects.toThrow('Keine vollständige');
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Zusammenfassung' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } });
    await client.silentCommand('/compact');
    expect(client._serializeHistory()[0].content).toContain('Zusammenfassung');
    expect(mockAnthropicCreate.mock.calls[2][1].timeout).toBe(180000);
    expect(client._tokens).toEqual({ input: 100, output: 20, cache: 10, cacheWrite: 5 });
  });
  test('Verdichteter Kontext muss dauerhaft gespeichert werden; Fehler wird nicht als Erfolg verpackt', async () => {
    const client = createApiBackend('anthropic', 1, () => {}, { apiKey: 'fake' });
    await client.newSession();
    client._pushUserText('Bewahren');
    mockAnthropicCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Zusammenfassung' }] });
    store.save.mockImplementation(() => { throw new Error('Platte voll'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(client.silentCommand('/compact')).rejects.toThrow('nicht gespeichert');
    expect(warn).toHaveBeenCalled();
    expect(client.state).toBe('ready');
    store.save.mockReset();
  });
  test('abgebrochene API-Verdichtung verändert die Historie nicht', async () => {
    const client = createApiBackend('anthropic', 1, () => {}, { apiKey: 'fake' });
    client._pushUserText('Bewahren');
    const before = client._serializeHistory();
    mockAnthropicCreate.mockImplementation(async () => {
      await client.cancel();
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Zusammenfassung' }] };
    });
    await expect(client.silentCommand('/compact')).rejects.toThrow();
    expect(client._serializeHistory()).toBe(before);
    expect(client.state).toBe('ready');
    expect(store.save).not.toHaveBeenCalled();
  });
});

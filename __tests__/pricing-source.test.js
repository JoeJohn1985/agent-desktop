'use strict';

const fs = require('fs');
const { extractPricing, normalizeKey, getPricingMap, CACHE_PATH, PRICING_URL } = require('../src/pricing-source');

describe('pricing-source: normalizeKey', () => {
  it('lowercased, provider-prefix entfernt', () => {
    expect(normalizeKey('Gemini/Gemini-2.5-Flash')).toBe('gemini-2.5-flash');
    expect(normalizeKey('claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(normalizeKey('anthropic/claude-opus-4-8')).toBe('claude-opus-4-8');
  });
});

describe('pricing-source: extractPricing', () => {
  it('rechnet Per-Token-Preise in USD pro 1M um', () => {
    const map = extractPricing({
      'claude-sonnet-5': {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_read_input_token_cost: 0.0000003,
      },
    });
    expect(map['claude-sonnet-5']).toEqual({ input: 3, cache: 0.3, output: 15 });
  });

  it('leitet Cache-Preis ab, wenn nicht angegeben (0,1×)', () => {
    const map = extractPricing({
      'gpt-x': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
    });
    expect(map['gpt-x'].cache).toBeCloseTo(0.2, 6);
  });

  it('überspringt Einträge ohne Kosten und sample_spec', () => {
    const map = extractPricing({
      sample_spec: { input_cost_per_token: 1, output_cost_per_token: 1 },
      'no-price': { max_tokens: 8192 },
      'ok': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    });
    expect(map.sample_spec).toBeUndefined();
    expect(map['no-price']).toBeUndefined();
    expect(map.ok).toBeDefined();
  });

  it('normalisiert Keys und erster Treffer gewinnt bei Kollision', () => {
    const map = extractPricing({
      'gemini-2.5-flash': { input_cost_per_token: 0.0000003, output_cost_per_token: 0.0000025 },
      'gemini/gemini-2.5-flash': { input_cost_per_token: 9, output_cost_per_token: 9 },
    });
    expect(map['gemini-2.5-flash'].input).toBeCloseTo(0.3, 6);
  });

  it('robust bei ungültiger Eingabe', () => {
    expect(extractPricing(null)).toEqual({});
    expect(extractPricing('x')).toEqual({});
  });
});

// ── getPricingMap: Cache + Abruf ─────────────────────────────
// fs wird per spyOn ersetzt (nicht jest.mock('fs')), damit das beim Laden
// benötigte data-dir-Modul unangetastet bleibt. Netzwerk über global.fetch.

describe('pricing-source: getPricingMap', () => {
  const origFetch = global.fetch;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  // Minimale LiteLLM-Antwort → ergibt { 'modell-a': {input:1, cache:0.1, output:2} }
  const LITELLM_JSON = {
    'anbieter/modell-a': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
  };
  const EXPECTED_MAP = { 'modell-a': { input: 1, cache: 0.1, output: 2 } };

  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  /** Simuliert den Cache-Inhalt auf der Platte (null = keine lesbare Datei). */
  function mockCache(content) {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      if (content === null) throw new Error('ENOENT');
      return typeof content === 'string' ? content : JSON.stringify(content);
    });
  }

  function mockFetchOk(json) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json });
  }

  it('nutzt einen frischen Cache und verzichtet auf den Netzwerkaufruf', async () => {
    mockCache({ ts: Date.now(), map: EXPECTED_MAP });
    global.fetch = jest.fn();

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('holt neu, sobald der Cache älter als eine Woche ist', async () => {
    mockCache({ ts: Date.now() - WEEK_MS - 1, map: { alt: { input: 9, cache: 9, output: 9 } } });
    mockFetchOk(LITELLM_JSON);

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(global.fetch).toHaveBeenCalledWith(PRICING_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('schreibt das Ergebnis mit Zeitstempel in den Cache', async () => {
    mockCache(null);
    mockFetchOk(LITELLM_JSON);

    await getPricingMap();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [file, data] = fs.writeFileSync.mock.calls[0];
    expect(file).toBe(CACHE_PATH);
    const written = JSON.parse(data);
    expect(written.map).toEqual(EXPECTED_MAP);
    expect(typeof written.ts).toBe('number');
  });

  it('holt neu, wenn noch gar kein Cache existiert', async () => {
    mockCache(null);
    mockFetchOk(LITELLM_JSON);

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('behandelt eine kaputte Cache-Datei wie „kein Cache"', async () => {
    mockCache('{kein valides JSON');
    mockFetchOk(LITELLM_JSON);

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('holt neu, wenn der Cache zwar lesbar ist, aber keine map enthält', async () => {
    mockCache({ ts: Date.now() });
    mockFetchOk(LITELLM_JSON);

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('behandelt einen Cache ohne Zeitstempel als abgelaufen', async () => {
    mockCache({ map: EXPECTED_MAP });
    mockFetchOk(LITELLM_JSON);

    await getPricingMap();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('fällt bei Netzwerkfehler auf den veralteten Cache zurück', async () => {
    const alt = { alt: { input: 9, cache: 9, output: 9 } };
    mockCache({ ts: Date.now() - WEEK_MS - 1, map: alt });
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await getPricingMap()).toEqual(alt);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('fällt bei HTTP-Fehlerstatus ebenfalls auf den Cache zurück', async () => {
    const alt = { alt: { input: 9, cache: 9, output: 9 } };
    mockCache({ ts: Date.now() - WEEK_MS - 1, map: alt });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    expect(await getPricingMap()).toEqual(alt);
  });

  it('liefert ein leeres Objekt, wenn Abruf UND Cache fehlschlagen', async () => {
    mockCache(null);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    expect(await getPricingMap()).toEqual({});
  });

  it('wirft nicht, wenn das Schreiben des Caches fehlschlägt', async () => {
    mockCache(null);
    mockFetchOk(LITELLM_JSON);
    fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });

    expect(await getPricingMap()).toEqual(EXPECTED_MAP);
    expect(warnSpy).toHaveBeenCalledWith('[pricing] cache write failed:', 'EACCES');
  });
});

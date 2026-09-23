'use strict';

const fs = require('fs');
const {
  extractPricing,
  parseCopilotPricing,
  normalizeKey,
  getPricingMap,
  CACHE_PATH,
  COPILOT_PRICING_URL,
  LITELLM_PRICING_URL,
  COPILOT_MAX_AGE_MS,
  LITELLM_MAX_AGE_MS,
} = require('../src/pricing-source');

const COPILOT_YAML = `
- model: Claude Sonnet 5
  provider: anthropic
  input: "$2.00"
  cached_input: "$0.20"
  cache_write: "$2.50"
  output: "$10.00"
- model: "Gemini 3.8 Flash[^gemini-flash-promo]"
  provider: google
  tier: Default
  threshold: "Not applicable"
  input: "$0.75"
  cached_input: "$0.075"
  output: "$3.75"
- model: GPT-6 Luna
  provider: openai
  tier: Default
  threshold: "≤ 272K"
  input: "$0.10"
  cached_input: "$0.01"
  cache_write: "$0.125"
  output: "$0.50"
- model: GPT-6 Luna
  provider: openai
  tier: Long context
  threshold: "> 272K"
  input: "$0.20"
  cached_input: "$0.02"
  cache_write: "$0.25"
  output: "$0.75"
- model: "Claude Opus 4.8 (fast mode) (preview)"
  provider: anthropic
  input: "$10.00"
  cached_input: "$1.00"
  cache_write: "$12.50"
  output: "$50.00"
`;

const EXPECTED_COPILOT_MAP = {
  claudesonnet5: { input: 2, cache: 0.2, cacheWrite: 2.5, output: 10 },
  gemini38flash: { input: 0.75, cache: 0.075, cacheWrite: 0, output: 3.75 },
  gpt6luna: {
    input: 0.1,
    cache: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    longContext: { input: 0.2, cache: 0.02, cacheWrite: 0.25, output: 0.75, threshold: 272_000 },
  },
  claudeopus48fast: { input: 10, cache: 1, cacheWrite: 12.5, output: 50 },
};

const LITELLM_JSON = {
  'provider/model-a': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
};
const EXPECTED_FALLBACK_MAP = { modela: { input: 1, cache: 0.1, output: 2 } };

describe('pricing-source: normalizeKey', () => {
  it('normalisiert Provider-Prefixe, Satzzeichen und Modellnamen', () => {
    expect(normalizeKey('Gemini/Gemini-2.5-Flash')).toBe('gemini25flash');
    expect(normalizeKey('claude-sonnet-5')).toBe('claudesonnet5');
    expect(normalizeKey('anthropic/claude-opus-4-8')).toBe('claudeopus48');
    expect(normalizeKey('Claude Opus 4.8 (fast mode) (preview)')).toBe('claudeopus48fast');
  });
});

describe('pricing-source: parseCopilotPricing', () => {
  it('liest USD-Raten, Cache-Write und Default-/Long-Context-Tiers', () => {
    expect(parseCopilotPricing(COPILOT_YAML)).toEqual(EXPECTED_COPILOT_MAP);
  });

  it('bricht bei einer unerwarteten oder unbrauchbaren Quelle explizit ab', () => {
    expect(() => parseCopilotPricing('not: a pricing list')).toThrow('not a YAML list');
    expect(() => parseCopilotPricing('- model: freeform\n  input: n/a')).toThrow('no usable model prices');
    expect(() => parseCopilotPricing(`
- model: GPT X
  tier: Long context
  threshold: unknown
  input: "$1"
  cached_input: "$0.1"
  output: "$2"
`)).toThrow('Invalid long-context threshold');
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
    expect(map.claudesonnet5).toEqual({ input: 3, cache: 0.3, output: 15 });
  });

  it('leitet Cache-Preis ab, wenn nicht angegeben (0,1×)', () => {
    const map = extractPricing({
      'gpt-x': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
    });
    expect(map.gptx.cache).toBeCloseTo(0.2, 6);
  });

  it('überspringt Einträge ohne Kosten und sample_spec', () => {
    const map = extractPricing({
      sample_spec: { input_cost_per_token: 1, output_cost_per_token: 1 },
      'no-price': { max_tokens: 8192 },
      ok: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    });
    expect(map.samplespec).toBeUndefined();
    expect(map.noprice).toBeUndefined();
    expect(map.ok).toBeDefined();
  });

  it('normalisiert Keys und erster Treffer gewinnt bei Kollision', () => {
    const map = extractPricing({
      'gemini-2.5-flash': { input_cost_per_token: 0.0000003, output_cost_per_token: 0.0000025 },
      'gemini/gemini-2.5-flash': { input_cost_per_token: 9, output_cost_per_token: 9 },
    });
    expect(map.gemini25flash.input).toBeCloseTo(0.3, 6);
  });

  it('robust bei ungültiger Eingabe', () => {
    expect(extractPricing(null)).toEqual({});
    expect(extractPricing('x')).toEqual({});
  });
});

describe('pricing-source: getPricingMap', () => {
  const origFetch = global.fetch;

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

  function mockCache(content) {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      if (content === null) throw new Error('ENOENT');
      return typeof content === 'string' ? content : JSON.stringify(content);
    });
  }

  function responseFor(url, { copilotText = COPILOT_YAML, litellmJson = LITELLM_JSON } = {}) {
    if (url === COPILOT_PRICING_URL) {
      return { ok: true, status: 200, text: async () => copilotText };
    }
    if (url === LITELLM_PRICING_URL) {
      return { ok: true, status: 200, json: async () => litellmJson };
    }
    throw new Error(`Unexpected pricing URL: ${url}`);
  }

  function mockFetchOk(options) {
    global.fetch = jest.fn(async (url) => responseFor(url, options));
  }

  function freshCache() {
    const now = Date.now();
    return {
      version: 2,
      sources: {
        copilot: { ts: now, map: EXPECTED_COPILOT_MAP },
        litellm: { ts: now, map: EXPECTED_FALLBACK_MAP },
      },
    };
  }

  it('nutzt frische Quellen-Caches ohne Netzwerkaufruf', async () => {
    mockCache(freshCache());
    global.fetch = jest.fn();

    expect(await getPricingMap()).toEqual({
      copilot: EXPECTED_COPILOT_MAP,
      fallback: EXPECTED_FALLBACK_MAP,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('aktualisiert beide Quellen nach Ablauf ihrer Cache-Zeit', async () => {
    const stale = freshCache();
    stale.sources.copilot.ts = Date.now() - COPILOT_MAX_AGE_MS - 1;
    stale.sources.litellm.ts = Date.now() - LITELLM_MAX_AGE_MS - 1;
    mockCache(stale);
    mockFetchOk();

    expect(await getPricingMap()).toEqual({
      copilot: EXPECTED_COPILOT_MAP,
      fallback: EXPECTED_FALLBACK_MAP,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(COPILOT_PRICING_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(global.fetch).toHaveBeenCalledWith(LITELLM_PRICING_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('migriert den bisherigen flachen LiteLLM-Cache und lädt die Copilot-Preise nach', async () => {
    mockCache({ ts: Date.now(), map: { 'model-a': { input: 1, cache: 0.1, output: 2 } } });
    mockFetchOk();

    expect(await getPricingMap()).toEqual({
      copilot: EXPECTED_COPILOT_MAP,
      fallback: EXPECTED_FALLBACK_MAP,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(COPILOT_PRICING_URL, expect.any(Object));
  });

  it('schreibt beide Quellen und getrennte Zeitstempel in den Cache', async () => {
    mockCache(null);
    mockFetchOk();

    await getPricingMap();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [file, data] = fs.writeFileSync.mock.calls[0];
    expect(file).toBe(CACHE_PATH);
    const written = JSON.parse(data);
    expect(written.version).toBe(2);
    expect(written.sources.copilot.map).toEqual(EXPECTED_COPILOT_MAP);
    expect(written.sources.litellm.map).toEqual(EXPECTED_FALLBACK_MAP);
    expect(typeof written.sources.copilot.ts).toBe('number');
    expect(typeof written.sources.litellm.ts).toBe('number');
  });

  it('verwendet den veralteten Cache einer Quelle, wenn nur diese Quelle fehlschlägt', async () => {
    const stale = freshCache();
    stale.sources.copilot.ts = Date.now() - COPILOT_MAX_AGE_MS - 1;
    stale.sources.litellm.ts = Date.now() - LITELLM_MAX_AGE_MS - 1;
    mockCache(stale);
    global.fetch = jest.fn(async (url) => {
      if (url === COPILOT_PRICING_URL) throw new Error('offline');
      return responseFor(url);
    });

    expect(await getPricingMap()).toEqual({
      copilot: EXPECTED_COPILOT_MAP,
      fallback: EXPECTED_FALLBACK_MAP,
    });
    expect(warnSpy).toHaveBeenCalledWith('[pricing] copilot fetch failed, using cache/none:', 'offline');
  });

  it('liefert leere Teilkarten, wenn kein Cache existiert und beide Abrufe fehlschlagen', async () => {
    mockCache(null);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    expect(await getPricingMap()).toEqual({ copilot: {}, fallback: {} });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('behält abgerufene Preise auch dann, wenn das Schreiben des Caches fehlschlägt', async () => {
    mockCache(null);
    mockFetchOk();
    fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });

    expect(await getPricingMap()).toEqual({
      copilot: EXPECTED_COPILOT_MAP,
      fallback: EXPECTED_FALLBACK_MAP,
    });
    expect(warnSpy).toHaveBeenCalledWith('[pricing] cache write failed:', 'EACCES');
  });
});

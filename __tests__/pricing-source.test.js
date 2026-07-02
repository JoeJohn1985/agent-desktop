'use strict';

const { extractPricing, normalizeKey } = require('../src/pricing-source');

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

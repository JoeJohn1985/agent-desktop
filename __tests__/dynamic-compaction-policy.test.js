'use strict';

const { parseCopilotPricing } = require('../src/pricing-source');
const { resolvePricingInfo, defaultTokenThreshold } = require('../src/auto-compaction-policy');
const { getPolicy, validatePolicies } = require('../src/auto-compaction');

const yaml = `
- model: Future Model 99
  input: 1
  cached_input: 0.1
  output: 2
- model: Future Model 99
  tier: Long context
  threshold: "> 272K"
  input: 2
  cached_input: 0.2
  output: 3
- model: Flat Future
  input: 1
  cached_input: 0.1
  output: 2
`;

test('offizielle neue Modelle, einheitliche Tarife und Fallbacks bleiben unterscheidbar', () => {
  const prices = { copilot: parseCopilotPricing(yaml), sources: { copilot: { updatedAt: 123 } },
    fallback: { unknown: { input: 1 } } };
  const tiered = resolvePricingInfo(prices, 'vendor/Future-Model-99 (preview)');
  expect(tiered).toMatchObject({ known: true, threshold: 272000, updatedAt: 123 });
  expect(getPolicy({}, 'copilot', 'future', tiered).thresholdTokens).toBe(240000);
  const flat = resolvePricingInfo(prices, 'flat-future');
  expect(flat).toMatchObject({ known: true, threshold: null });
  expect(getPolicy({}, 'copilot', 'flat', flat).thresholdPercent).toBe(50);
  expect(resolvePricingInfo(prices, 'unknown')).toMatchObject({ known: false, threshold: null });
});

test('Vorschläge folgen Preisupdates; nur Regeln mit passender Einheit bleiben wirksam', () => {
  const settings = { autoCompaction: { copilot: { enabled: true, thresholdPercent: 77,
    models: { automatic: { mode: 'auto' }, individual: { mode: 'tokens', thresholdTokens: 450000 } } } } };
  validatePolicies(settings.autoCompaction);
  for (const threshold of [200000, 272000, 400000]) {
    expect(getPolicy(settings, 'copilot', 'automatic', { threshold }).thresholdTokens).toBe(defaultTokenThreshold(threshold));
    expect(getPolicy(settings, 'copilot', 'individual', { threshold }).thresholdTokens).toBe(450000);
    expect(getPolicy(settings, 'copilot', 'legacy', { threshold }).thresholdTokens).toBe(defaultTokenThreshold(threshold));
  }
  expect(defaultTokenThreshold(272000)).toBe(240000);
  expect(defaultTokenThreshold(400000)).toBe(350000);
  expect(getPolicy(settings, 'copilot', 'legacy', { threshold: null }).thresholdPercent).toBe(77);
  expect(getPolicy(settings, 'copilot', 'individual', { threshold: null }).thresholdPercent).toBe(50);
});

'use strict';

function defaultTokenThreshold(priceThreshold) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(priceThreshold)) - 1);
  return Math.max(1, Math.round(priceThreshold * 0.88 / step) * step);
}

function normalizePricingKey(id) {
  return String(id || '').toLowerCase().split('/').pop().trim()
    .replace(/\[\^[^\]]+\]/g, '').replace(/\(\s*preview\s*\)/g, '')
    .replace(/\bmode\b/g, '').replace(/[^a-z0-9]/g, '');
}

function resolvePricingInfo(prices, model) {
  const entry = prices?.copilot?.[normalizePricingKey(model)];
  const tier = entry?.longContext;
  const increased = tier && ['input', 'cache', 'cacheWrite', 'output'].some(key => tier[key] > entry[key]);
  return {
    known: !!entry,
    threshold: increased && Number.isSafeInteger(tier.threshold) && tier.threshold > 0 ? tier.threshold : null,
    source: entry ? 'GitHub Copilot (offiziell)' : null,
    updatedAt: prices?.sources?.copilot?.updatedAt ?? null,
  };
}

function resolveCompactionPolicy(settings, provider, model, pricing) {
  const priceThreshold = typeof pricing === 'number' ? pricing : pricing?.threshold;
  const saved = settings?.autoCompaction?.[provider];
  const specific = saved?.models?.[model];
  const tokenRule = provider === 'copilot' && Number.isSafeInteger(priceThreshold) && priceThreshold > 0;
  if (specific && specific.mode !== 'auto' &&
      (provider !== 'copilot' || specific.mode === (tokenRule ? 'tokens' : 'percent'))) {
    return { ...specific, enabled: saved.enabled };
  }
  // A legacy, individually saved percentage must never silently become tokens.
  if (saved && !saved.modelDefaults && !tokenRule && !specific) return { enabled: saved.enabled, thresholdPercent: saved.thresholdPercent };
  if (tokenRule) {
    return { enabled: saved?.enabled ?? true, mode: 'tokens', thresholdTokens: defaultTokenThreshold(priceThreshold) };
  }
  return { enabled: saved?.enabled ?? true, thresholdPercent: 50 };
}

function compactionCostWarning(policy, priceThreshold, contextSize) {
  if (!(priceThreshold > 0) || !policy.enabled) return '';
  const threshold = policy.mode === 'tokens' ? policy.thresholdTokens
    : contextSize > 0 ? contextSize * policy.thresholdPercent / 100 : null;
  if (threshold == null) return 'Prozentregel: Preisrisiko erst bei gemeldetem Sitzungsfenster prüfbar; Kosten können steigen.';
  return threshold > priceThreshold
    ? 'Der Schwellwert liegt über der Preisgrenze. Kosten können steigen; die Eingabe bleibt erlaubt.'
    : '';
}

const AutoCompactionPolicy = { defaultTokenThreshold, resolveCompactionPolicy, compactionCostWarning, normalizePricingKey, resolvePricingInfo };
if (typeof module !== 'undefined' && module.exports) module.exports = AutoCompactionPolicy;
if (typeof window !== 'undefined') globalThis.AutoCompactionPolicy = AutoCompactionPolicy;

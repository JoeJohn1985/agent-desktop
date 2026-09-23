'use strict';

// GitHub publishes Copilot's official per-token prices in its docs data table.
// LiteLLM remains a generic fallback, especially for direct-API models.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { DATA_DIR } = require('./data-dir');

const COPILOT_PRICING_URL = 'https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml';
const LITELLM_PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_PATH = path.join(DATA_DIR, 'pricing-cache.json');
const CACHE_VERSION = 2;
const COPILOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh official rates daily
const LITELLM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh fallback weekly
const FETCH_TIMEOUT_MS = 15_000;

/** Canonicalize labels and ids so dots, hyphens, spaces, and provider prefixes match. */
function normalizeKey(id) {
  return String(id || '')
    .toLowerCase()
    .split('/')
    .pop()
    .trim()
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\(\s*preview\s*\)/g, '')
    .replace(/\bmode\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function parseUsd(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(/,/g, '').match(/^\$?\s*(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

function parseThreshold(value) {
  const match = String(value || '').trim().match(/^>\s*(\d+(?:\.\d+)?)\s*([km])$/i);
  if (!match) return null;
  return Number(match[1]) * (match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000);
}

/**
 * Parse GitHub's official Copilot pricing YAML into USD per 1M tokens.
 * Long-context rates are attached to their default-tier model entry.
 * @param {string} content
 * @returns {Object<string,{input:number,cache:number,cacheWrite:number,output:number,longContext?:Object}>}
 */
function parseCopilotPricing(content) {
  const entries = YAML.parse(content);
  if (!Array.isArray(entries)) throw new Error('Copilot pricing source is not a YAML list');

  const grouped = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.model !== 'string') continue;
    const key = normalizeKey(entry.model);
    if (!key) continue;

    const input = parseUsd(entry.input);
    const cache = parseUsd(entry.cached_input);
    const output = parseUsd(entry.output);
    if (input == null || cache == null || output == null) continue;

    const price = {
      input: round6(input),
      cache: round6(cache),
      cacheWrite: round6(parseUsd(entry.cache_write) ?? 0),
      output: round6(output),
    };
    const isLongContext = /long\s+context/i.test(String(entry.tier || ''))
      || /^>/.test(String(entry.threshold || '').trim());
    const modelPrices = grouped.get(key) || {};

    if (isLongContext) {
      const threshold = parseThreshold(entry.threshold);
      if (threshold == null) throw new Error(`Invalid long-context threshold for ${entry.model}`);
      modelPrices.longContext = { ...price, threshold };
    } else if (!modelPrices.default) {
      modelPrices.default = price;
    }
    grouped.set(key, modelPrices);
  }

  const out = {};
  for (const [key, prices] of grouped) {
    if (!prices.default) continue;
    out[key] = prices.longContext
      ? { ...prices.default, longContext: prices.longContext }
      : prices.default;
  }
  if (!Object.keys(out).length) throw new Error('Copilot pricing source has no usable model prices');
  return out;
}

/**
 * Convert the LiteLLM price table into a slim { normalizedKey: {input,cache,output} }
 * map in USD per 1M. Skips entries without per-token input/output cost.
 * On key collision the first (typically un-prefixed) entry wins.
 * @param {object} litellm
 * @returns {Object<string,{input:number,cache:number,output:number}>}
 */
function extractPricing(litellm) {
  const out = {};
  if (!litellm || typeof litellm !== 'object') return out;
  for (const [key, v] of Object.entries(litellm)) {
    if (!v || typeof v !== 'object') continue;
    if (key === 'sample_spec') continue;
    const inTok = v.input_cost_per_token;
    const outTok = v.output_cost_per_token;
    if (typeof inTok !== 'number' || typeof outTok !== 'number') continue;
    const cacheTok = typeof v.cache_read_input_token_cost === 'number' ? v.cache_read_input_token_cost : inTok * 0.1;
    const nk = normalizeKey(key);
    if (!nk || Object.prototype.hasOwnProperty.call(out, nk)) continue;
    out[nk] = { input: round6(inTok * 1e6), cache: round6(cacheTok * 1e6), output: round6(outTok * 1e6) };
  }
  return out;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePricingMap(map) {
  const out = {};
  if (!isRecord(map)) return out;
  for (const [key, value] of Object.entries(map)) {
    const normalized = normalizeKey(key);
    if (normalized && isRecord(value)) out[normalized] = value;
  }
  return out;
}

function readCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    return isRecord(cache) ? cache : null;
  } catch {
    return null;
  }
}

function getCachedSource(cache, name) {
  const source = cache?.sources?.[name];
  if (isRecord(source) && isRecord(source.map)) {
    return { ts: typeof source.ts === 'number' ? source.ts : 0, map: source.map };
  }
  // Migrate the previous flat LiteLLM cache without discarding it.
  if (name === 'litellm' && !cache?.sources && isRecord(cache?.map)) {
    return {
      ts: typeof cache.ts === 'number' ? cache.ts : 0,
      map: normalizePricingMap(cache.map),
    };
  }
  return null;
}

function writeCache(sources) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ version: CACHE_VERSION, sources }, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[pricing] cache write failed:', e.message || e);
  }
}

async function fetchCopilotPricing() {
  const res = await fetch(COPILOT_PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCopilotPricing(await res.text());
}

async function fetchLiteLLMPricing() {
  const res = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const map = extractPricing(await res.json());
  if (!Object.keys(map).length) throw new Error('LiteLLM pricing source has no usable model prices');
  return map;
}

function isFresh(source, maxAge) {
  return source && typeof source.ts === 'number' && Date.now() - source.ts < maxAge;
}

async function loadSource(name, cached, maxAge, fetcher) {
  if (isFresh(cached, maxAge)) return { source: cached, refreshed: false };
  try {
    return {
      source: { ts: Date.now(), map: await fetcher() },
      refreshed: true,
    };
  } catch (e) {
    console.warn(`[pricing] ${name} fetch failed, using cache/none:`, e.message || e);
    return { source: cached || { ts: 0, map: {} }, refreshed: false };
  }
}

/**
 * Return official Copilot rates and a LiteLLM fallback map. Each source has
 * its own cache age so a failure in one does not block updates from the other.
 * @returns {Promise<{copilot:Object,fallback:Object}>}
 */
async function getPricingMap() {
  const cached = readCache();
  const cachedCopilot = getCachedSource(cached, 'copilot');
  const cachedLiteLLM = getCachedSource(cached, 'litellm');
  const [copilot, litellm] = await Promise.all([
    loadSource('copilot', cachedCopilot, COPILOT_MAX_AGE_MS, fetchCopilotPricing),
    loadSource('litellm', cachedLiteLLM, LITELLM_MAX_AGE_MS, fetchLiteLLMPricing),
  ]);
  const sources = { copilot: copilot.source, litellm: litellm.source };

  if (!cached || cached.version !== CACHE_VERSION || copilot.refreshed || litellm.refreshed) {
    writeCache(sources);
  }
  return { copilot: sources.copilot.map, fallback: sources.litellm.map };
}

module.exports = {
  extractPricing,
  parseCopilotPricing,
  normalizeKey,
  getPricingMap,
  COPILOT_PRICING_URL,
  LITELLM_PRICING_URL,
  COPILOT_MAX_AGE_MS,
  LITELLM_MAX_AGE_MS,
  CACHE_PATH,
};

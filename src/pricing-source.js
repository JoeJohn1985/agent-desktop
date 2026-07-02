'use strict';

// Public pricing fallback source. Model prices we don't hardcode (e.g. a Copilot
// model the CLI reports dynamically) are looked up from LiteLLM's public
// price table, converted to USD-per-1M and cached under ~/.copilot-desktop/.
//
// The renderer keeps its own hardcoded MODEL_PRICING as the source of truth; this
// only fills gaps. All parsing is pure and unit-tested; the fetch/cache is a thin
// wrapper.

const fs = require('fs');
const path = require('path');
const os = require('os');

const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_PATH = path.join(os.homedir(), '.copilot-desktop', 'pricing-cache.json');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh at most weekly
const FETCH_TIMEOUT_MS = 15_000;

/** Normalize a model id/key for matching: lowercase, drop provider prefix. */
function normalizeKey(id) {
  return String(id || '').toLowerCase().split('/').pop().trim();
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Convert the LiteLLM price table into a slim { normalizedKey: {input,cache,output} }
 * map in USD per 1M tokens. Skips entries without per-token input/output cost.
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
    if (!nk || out[nk]) continue;
    out[nk] = { input: round6(inTok * 1e6), cache: round6(cacheTok * 1e6), output: round6(outTok * 1e6) };
  }
  return out;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(map) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), map }, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[pricing] cache write failed:', e.message || e);
  }
}

async function fetchPricing() {
  const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractPricing(await res.json());
}

/**
 * Return the slim pricing map, using the cache when fresh; otherwise fetch and
 * refresh. On fetch failure, fall back to any cached map (or {}). Never throws.
 * @returns {Promise<Object<string,{input:number,cache:number,output:number}>>}
 */
async function getPricingMap() {
  const cached = readCache();
  if (cached && cached.map && (Date.now() - (cached.ts || 0) < MAX_AGE_MS)) {
    return cached.map;
  }
  try {
    const map = await fetchPricing();
    writeCache(map);
    return map;
  } catch (e) {
    console.warn('[pricing] fetch failed, using cache/none:', e.message || e);
    return (cached && cached.map) || {};
  }
}

module.exports = { extractPricing, normalizeKey, getPricingMap, PRICING_URL, CACHE_PATH };

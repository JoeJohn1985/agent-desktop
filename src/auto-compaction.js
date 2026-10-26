'use strict';

const PROVIDERS = ['copilot', 'claude-code', 'claude-code-ssh', 'anthropic', 'gemini', 'openai', 'glm', 'ollama'];
const { resolveCompactionPolicy, compactionCostWarning } = require('./auto-compaction-policy');

function parseContextTokens(text) {
  const match = String(text || '').match(/([\d.,]+(?:[ \u00a0]\d{3})*)\s*([km]?)\s*\/\s*([\d.,]+(?:[ \u00a0]\d{3})*)\s*([km]?)\s*tokens/i);
  if (!match) return null;
  const number = (value, unit) => unit ? Number(value.replace(',', '.')) * (unit.toLowerCase() === 'k' ? 1000 : 1000000)
    : /^\d+(?:[.,\s]\d{3})*$/.test(value) ? Number(value.replace(/[.,\s]/g, '')) : NaN;
  const used = number(match[1], match[2]);
  const size = number(match[3], match[4]);
  return Number.isSafeInteger(used) && used >= 0 && Number.isSafeInteger(size) && size > 0 ? { used, size } : null;
}

function parseContextPercent(text) {
  const source = String(text || '');
  const match = source.match(/\((\d+(?:[.,]\d+)?)%\)/)
    || source.match(/(?:context|kontext)[^\n]*?\b(\d+(?:[.,]\d+)?)%/i);
  const value = match ? Number(match[1].replace(',', '.')) : null;
  return value != null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
function validatePolicies(policies) {
  if (policies === undefined) return;
  if (!policies || typeof policies !== 'object' || Array.isArray(policies)) throw new Error('Ungültige Komprimierungseinstellungen.');
  for (const [provider, policy] of Object.entries(policies)) {
    if (!PROVIDERS.includes(provider) || !policy || typeof policy.enabled !== 'boolean'
      || !Number.isInteger(policy.thresholdPercent) || policy.thresholdPercent < 1 || policy.thresholdPercent > 95) {
      throw new Error('Automatische Komprimierung: Aktivierung und ganzzahligen Prozentwert von 1 bis 95 angeben.');
    }
    if (policy.modelDefaults !== undefined && typeof policy.modelDefaults !== 'boolean') throw new Error('Ungültiger Policy-Default.');
    if (policy.models !== undefined) {
      if (provider !== 'copilot' || !policy.models || typeof policy.models !== 'object' || Array.isArray(policy.models)) {
        throw new Error('Ungültige modellbezogene Komprimierungseinstellungen.');
      }
      for (const [model, rule] of Object.entries(policy.models)) {
        if (!model || !rule || !['tokens', 'percent', 'auto'].includes(rule.mode)
          || (rule.mode === 'tokens' ? !Number.isSafeInteger(rule.thresholdTokens) || rule.thresholdTokens < 1
            : rule.mode !== 'auto' && (!Number.isInteger(rule.thresholdPercent) || rule.thresholdPercent < 1 || rule.thresholdPercent > 95))) {
          throw new Error('Komprimierung: positive ganze Tokens oder Prozentwert von 1 bis 95 angeben.');
        }
      }
    }
  }
}

function getPolicy(settings, provider, model, priceThreshold) {
  const policies = settings?.autoCompaction;
  validatePolicies(policies);
  return resolveCompactionPolicy(settings, provider, model, priceThreshold);
}

/** One queue per tab, including prompt setup and the entire agentic response. */
function createAutoCompaction({ getClient, getSettings, send, getPriceThreshold = async () => null, log = console.warn }) {
  const queues = new Map();
  const turns = new Map();
  const cancellations = new Map();

  function enqueue(tabId, operation) {
    const previous = queues.get(tabId) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    const tail = task.catch(() => {});
    queues.set(tabId, tail);
    tail.then(() => { if (queues.get(tabId) === tail) queues.delete(tabId); });
    return task;
  }

  function observe(channel, tabId, event) {
    const turn = turns.get(tabId);
    if (!turn) return;
    if (turn.phase !== 'prompt') {
      if (turn.phase === 'maintenance' && channel === 'agent:event'
        && /permission|question|user_input|error|auth/.test(event?.type || '')) turn.blocked = true;
      return;
    }
    if (channel === 'agent:done') {
      if (event !== 0) turn.blocked = true;
      turn.done = event;
      return;
    }
    if (channel !== 'agent:event') return;
    const type = event?.type || '';
    const data = event?.data || {};
    if (/permission|question|user_input|error|auth/.test(type)
      || /ask.?user|question|user.?input/i.test(data.toolName || '')
      || (type === 'tool.execution_complete' && data.success === false)) turn.blocked = true;
    if (type === 'assistant.message_delta' || type === 'assistant.message') {
      turn.text += data.deltaContent || data.content || '';
    }
    if (type === 'tool.execution_start') turn.tools.add(data.toolCallId);
    if (type === 'tool.execution_complete') turn.tools.delete(data.toolCallId);
    if (type === 'session.usage_update' && !data.cost
      && Number.isFinite(data.used) && data.used >= 0 && Number.isFinite(data.size) && data.size > 0) {
      turn.percent = Math.min(100, data.used / data.size * 100);
      turn.context = { used: data.used, size: data.size };
    }
  }

  async function finish(tabId, turn, result) {
    turn.phase = 'maintenance';
    if (turn.blocked || turn.done !== 0 || turn.tools.size
      || (result?.stopReason && result.stopReason !== 'end_turn')
      || /\?|bitte (bestätig|anmeld|freigeb|entscheide)|möchtest du|please (confirm|sign in|approve)/i.test(turn.text)) return;
    const client = getClient(tabId);
    if (!client || client.state !== 'ready') return;
    try {
      const model = client.model || client.__model;
      const pricing = client.__provider === 'copilot' ? await getPriceThreshold(model) : null;
      const priceThreshold = typeof pricing === 'number' ? pricing : pricing?.threshold;
      const policy = getPolicy(getSettings(), client.__provider, model, pricing);
      if (!policy.enabled) return;
      // Never infer Copilot's context window from its model name or token totals.
      const context = await client.silentCommand('/context');
      send('agent:event', tabId, { type: 'session.context_updated', data: { text: context } });
      if (turn.blocked) return;
      const percent = parseContextPercent(context) ?? turn.percent;
      const tokens = parseContextTokens(context) || turn.context;
      const warning = compactionCostWarning(policy, priceThreshold, tokens?.size);
      if (warning) send('agent:event', tabId, { type: 'session.auto_compaction', data: { status: 'warning', message: warning } });
      const measured = policy.mode === 'tokens' ? tokens?.used : percent;
      if (measured == null) {
        log(`[auto-compact:tab${tabId}] Auslastung unbekannt — übersprungen.`);
        send('agent:event', tabId, { type: 'session.auto_compaction', data: { status: 'skipped', reason: 'Auslastung unbekannt' } });
        return;
      }
      if (measured < (policy.mode === 'tokens' ? policy.thresholdTokens : policy.thresholdPercent)) return;
      send('agent:event', tabId, { type: 'session.auto_compaction', data: { status: 'started', percent, used: tokens?.used } });
      const compact = await client.silentCommand('/compact');
      if (turn.blocked) throw new Error('Verdichtung abgebrochen oder Aufmerksamkeit erforderlich.');
      if (typeof compact !== 'string' || !compact.trim()
        || /verdichtung übersprungen|unknown command|unbekannter befehl|(?:^|\n)\s*(?:error:|fehler:)|(?:command|befehl|compact|verdichtung)[^\n]*(?:unsupported|not supported|failed|fehlgeschlagen)/i.test(compact)) {
        throw new Error('Backend hat die Verdichtung nicht bestätigt.');
      }
      const after = await client.silentCommand('/context');
      send('agent:event', tabId, { type: 'session.context_updated', data: { text: after } });
      send('agent:event', tabId, { type: 'session.auto_compaction', data: { status: 'completed' } });
    } catch (error) {
      log(`[auto-compact:tab${tabId}] ${error.message}`);
      send('agent:event', tabId, { type: 'session.auto_compaction', data: { status: 'error', message: error.message } });
    }
  }

  // Acknowledge only after setup, but retain the queue until prompt + maintenance
  // settle. This preserves the existing streaming IPC acknowledgement contract.
  function startPrompt(tabId, operation) {
    const generation = cancellations.get(tabId) || 0;
    return new Promise((resolve, reject) => {
      enqueue(tabId, async () => {
        if ((cancellations.get(tabId) || 0) !== generation) throw new Error('Cancelled');
        const turn = { phase: 'setup', blocked: false, done: null, text: '', percent: null, tools: new Set() };
        turns.set(tabId, turn);
        try {
          const result = await operation(() => {
            if (turn.blocked || (cancellations.get(tabId) || 0) !== generation) throw new Error('Cancelled');
            turn.phase = 'prompt';
            resolve(tabId);
          });
          await finish(tabId, turn, result);
        } catch (error) {
          reject(error);
          if (turn.phase === 'prompt' && error.message !== 'Cancelled') {
            log(`[prompt:tab${tabId}] ${error.message}`);
            if (turn.done === null || turn.done === 0) {
              send('agent:event', tabId, { type: 'error', data: { message: error.message } });
              send('agent:done', tabId, 1);
            }
          }
        } finally {
          if (turns.get(tabId) === turn) turns.delete(tabId);
        }
      }).catch(reject);
    });
  }

  return { startPrompt, observe, cancel: tabId => {
    cancellations.set(tabId, (cancellations.get(tabId) || 0) + 1);
    const turn = turns.get(tabId);
    if (turn) turn.blocked = true;
  }, command: (tabId, command, timeout) => enqueue(tabId, () => {
    const client = getClient(tabId);
    if (!client) throw new Error(`Kein aktiver Client für Tab ${tabId}`);
    return client.silentCommand(command, timeout);
  }) };
}

module.exports = { createAutoCompaction, getPolicy, validatePolicies, parseContextPercent, parseContextTokens, PROVIDERS };

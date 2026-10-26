'use strict';

const fs = require('fs');
const path = require('path');

async function readCopilotUsage(sessionDir) {
  let totalNanoAiu = null;
  let asOf = null;
  const entries = [];
  let previousTs = null;
  let startTs = null;
  let records = [];
  const seenRecords = new Set();
  let incompleteTail = false;
  let pending = '';

  function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'session.start' && totalNanoAiu === null && startTs === null) {
      const ts = Date.parse(event.timestamp);
      if (Number.isFinite(ts)) startTs = ts;
    }
    if (event.type === 'session.usage_record') {
      const usage = event.data?.usage;
      const amount = usage?.copilotUsage?.totalNanoAiu;
      const ts = Date.parse(event.timestamp);
      const accounting = usage?.accounting;
      const key = accounting?.usageId
        || (accounting?.sourceSessionId && Number.isSafeInteger(accounting.sequence)
          ? `${accounting.sourceSessionId}:${accounting.sequence}` : null);
      if (!key || !seenRecords.has(key)) {
        if (key) seenRecords.add(key);
        records.push({ ts, amount });
      }
      return;
    }
    if (event.type !== 'session.usage_checkpoint') return;
    const total = event.data?.totalNanoAiu;
    const ts = Date.parse(event.timestamp);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isFinite(ts)) {
      throw new Error('Ungültiger Copilot-Verbrauchscheckpoint');
    }
    if (totalNanoAiu !== null && total < totalNanoAiu) {
      throw new Error('Copilot-Sitzungsverbrauch ist rückläufig');
    }
    if (previousTs !== null && ts < previousTs) {
      throw new Error('Copilot-Checkpoint-Zeit ist rückläufig');
    }
    const delta = total - (totalNanoAiu ?? 0);
    // Only reconciled, CLI-reported amounts may refine checkpoint timing.
    // Token prices and usage.cost are deliberately not accounting sources.
    const complete = records.length > 0
      && records.every(r => Number.isSafeInteger(r.amount) && r.amount >= 0
        && Number.isFinite(r.ts) && r.ts <= ts)
      && records.reduce((sum, r) => sum + r.amount, 0) === delta;
    if (delta > 0) {
      if (complete) {
        entries.push(...records.filter(r => r.amount > 0).map(r => ({
          ts: r.ts, usd: r.amount / 100_000_000_000, timing: 'reported',
        })));
      } else {
        entries.push({ ts, usd: delta / 100_000_000_000,
          fromTs: previousTs ?? (startTs !== null && startTs <= ts ? startTs : null), timing: 'interval' });
      }
    }
    records = [];
    totalNanoAiu = total;
    previousTs = ts;
    asOf = event.timestamp;
  }

  for await (const chunk of fs.createReadStream(path.join(sessionDir, 'events.jsonl'), { encoding: 'utf8' })) {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      consume(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  }
  // Die CLI kann die letzte Zeile gerade schreiben; nur vollständiges JSON lesen.
  if (pending.trim()) {
    let complete = true;
    try { JSON.parse(pending); } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      complete = false;
      incompleteTail = true;
      console.warn('[copilot:usage] Unvollständige letzte Ereigniszeile; letzter Checkpoint wird verwendet');
    }
    if (complete) consume(pending);
  }
  if (totalNanoAiu === null) {
    throw new Error('Kein CLI-Verbrauchscheckpoint für diese Sitzung verfügbar');
  }
  return {
    totalNanoAiu,
    asOf,
    aic: totalNanoAiu / 1_000_000_000,
    usd: totalNanoAiu / 100_000_000_000,
    entries,
    pendingUsage: records.filter(r => r.amount !== 0).map(r => ({
      ts: Number.isFinite(r.ts) ? r.ts : null,
    })),
    incompleteTail,
  };
}

module.exports = { readCopilotUsage };

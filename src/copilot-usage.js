'use strict';

const fs = require('fs');
const path = require('path');

async function readCopilotUsage(sessionDir) {
  let totalNanoAiu = null;
  let asOf = null;
  const entries = [];
  let pending = '';

  function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type !== 'session.usage_checkpoint') return;
    const total = event.data?.totalNanoAiu;
    const ts = Date.parse(event.timestamp);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isFinite(ts)) {
      throw new Error('Ungültiger Copilot-Verbrauchscheckpoint');
    }
    if (totalNanoAiu !== null && total < totalNanoAiu) {
      throw new Error('Copilot-Sitzungsverbrauch ist rückläufig');
    }
    const delta = total - (totalNanoAiu ?? 0);
    if (delta > 0) entries.push({ ts, usd: delta / 100_000_000_000 });
    totalNanoAiu = total;
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
  };
}

module.exports = { readCopilotUsage };

const fs = require('fs');
const path = require('path');

/**
 * Liest Checkpoints aus checkpoints/index.md im Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @returns {Array<{number: number, title: string, file: string}>}
 */
function readCheckpoints(sessionDir) {
  const indexPath = path.join(sessionDir, 'checkpoints', 'index.md');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const checkpoints = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (match) {
        checkpoints.push({
          number: parseInt(match[1]),
          title: match[2].trim(),
          file: match[3].trim(),
        });
      }
    }
    return checkpoints;
  } catch (e) {
    console.warn('[sessions:readCheckpoints] Fehler:', e.message || e);
    return [];
  }
}

/**
 * Liest plan.md aus dem Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @returns {string|null}
 */
function readPlan(sessionDir) {
  const planPath = path.join(sessionDir, 'plan.md');
  if (!fs.existsSync(planPath)) return null;
  return fs.readFileSync(planPath, 'utf-8');
}

/**
 * Liest die letzten `limit` Nachrichten (user/assistant) aus events.jsonl.
 * Liest effizient von hinten in Chunks, um große Dateien nicht komplett zu laden.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @param {number} limit - Maximale Anzahl Nachrichten (default 5)
 * @returns {Array<{role: string, content: string, timestamp: string}>}
 */
function readRecentMessages(sessionDir, limit = 5) {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];

  try {
    const stat = fs.statSync(eventsPath);
    const fileSize = stat.size;
    if (fileSize === 0) return [];

    const fd = fs.openSync(eventsPath, 'r');
    const CHUNK_SIZE = 32 * 1024;
    const messages = [];
    let remainder = '';
    let position = fileSize;

    try {
      while (position > 0 && messages.length < limit) {
        const readSize = Math.min(CHUNK_SIZE, position);
        position -= readSize;
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, position);

        const chunk = buffer.toString('utf-8') + remainder;
        const lines = chunk.split('\n');
        remainder = lines.shift();

        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (!line) continue;

          try {
            const event = JSON.parse(line);
            if (event.type === 'user.message' || event.type === 'assistant.message') {
              const role = event.type === 'user.message' ? 'user' : 'assistant';
              let content = '';
              const rawContent = event.data && event.data.content;
              if (typeof rawContent === 'string') {
                content = rawContent;
              } else if (Array.isArray(rawContent)) {
                content = rawContent
                  .filter(p => typeof p === 'string' || (p && p.type === 'text'))
                  .map(p => typeof p === 'string' ? p : p.text || '')
                  .join('');
              }
              messages.push({ role, content, timestamp: event.timestamp || '' });
              if (messages.length >= limit) break;
            }
          } catch (_) { /* skip malformed lines */ }
        }
      }

      // Check remainder (first line of file)
      if (messages.length < limit && remainder.trim()) {
        try {
          const event = JSON.parse(remainder.trim());
          if (event.type === 'user.message' || event.type === 'assistant.message') {
            const role = event.type === 'user.message' ? 'user' : 'assistant';
            let content = '';
            const rawContent = event.data && event.data.content;
            if (typeof rawContent === 'string') {
              content = rawContent;
            } else if (Array.isArray(rawContent)) {
              content = rawContent
                .filter(p => typeof p === 'string' || (p && p.type === 'text'))
                .map(p => typeof p === 'string' ? p : p.text || '')
                .join('');
            }
            messages.push({ role, content, timestamp: event.timestamp || '' });
          }
        } catch (_) { /* skip */ }
      }
    } finally {
      fs.closeSync(fd);
    }

    // Reverse to chronological order (oldest first)
    return messages.reverse();
  } catch (e) {
    console.warn('[sessions:readRecentMessages] Fehler:', e.message || e);
    return [];
  }
}

/** Extract plain text from a user/assistant message event's `data.content`. */
function extractMessageContent(rawContent) {
  if (typeof rawContent === 'string') return rawContent;
  if (Array.isArray(rawContent)) {
    return rawContent
      .filter(p => typeof p === 'string' || (p && p.type === 'text'))
      .map(p => typeof p === 'string' ? p : p.text || '')
      .join('');
  }
  return '';
}

/**
 * Liest den GESAMTEN Nachrichtenverlauf (user/assistant) aus events.jsonl in
 * chronologischer Reihenfolge. Für das Wiederherstellen des kompletten
 * Session-Verlaufs beim erneuten Öffnen einer Copilot-Session.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @param {number} [limit=1000] - Obergrenze (jüngste behalten), 0 = unbegrenzt
 * @returns {Array<{role: string, content: string, timestamp: string}>}
 */
function readAllMessages(sessionDir, limit = 1000) {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  try {
    const content = fs.readFileSync(eventsPath, 'utf-8');
    const messages = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'user.message' || event.type === 'assistant.message') {
          const role = event.type === 'user.message' ? 'user' : 'assistant';
          messages.push({
            role,
            content: extractMessageContent(event.data && event.data.content),
            timestamp: event.timestamp || '',
          });
        }
      } catch (_) { /* skip malformed lines */ }
    }
    return limit > 0 && messages.length > limit ? messages.slice(-limit) : messages;
  } catch (e) {
    console.warn('[sessions:readAllMessages] Fehler:', e.message || e);
    return [];
  }
}

module.exports = { readCheckpoints, readPlan, readRecentMessages, readAllMessages };

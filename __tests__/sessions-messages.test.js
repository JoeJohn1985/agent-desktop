/**
 * Tests für readRecentMessages() in src/sessions.js
 * Liest letzte user/assistant Nachrichten aus events.jsonl (effizient von hinten).
 */

jest.mock('fs');

const fs = require('fs');
const path = require('path');
const { readRecentMessages } = require('../src/sessions');

const SESSION_DIR = path.join('C:', 'test', 'sessions', 'abc-123');
const EVENTS_PATH = path.join(SESSION_DIR, 'events.jsonl');

beforeEach(() => {
  jest.restoreAllMocks();
  fs.existsSync.mockReset();
  fs.statSync = jest.fn();
  fs.openSync = jest.fn().mockReturnValue(42);
  fs.readSync = jest.fn();
  fs.closeSync = jest.fn();
});

// ── Helper ───────────────────────────────────────────────────

function makeEvent(type, content, timestamp) {
  return JSON.stringify({ type, data: { content }, timestamp: timestamp || new Date().toISOString() });
}

function mockFileContent(jsonlContent) {
  const buf = Buffer.from(jsonlContent, 'utf-8');
  fs.existsSync.mockReturnValue(true);
  fs.statSync.mockReturnValue({ size: buf.length });
  fs.openSync.mockReturnValue(42);
  fs.readSync.mockImplementation((_fd, buffer, offset, length, position) => {
    // Simulate reading from file: copy relevant portion into buffer
    const start = position;
    const end = Math.min(position + length, buf.length);
    const bytesRead = end - start;
    buf.copy(buffer, offset, start, end);
    return bytesRead;
  });
  fs.closeSync.mockImplementation(() => {});
}

// ── Tests ────────────────────────────────────────────────────

describe('readRecentMessages', () => {

  test('gibt leeres Array zurück wenn events.jsonl nicht existiert', () => {
    fs.existsSync.mockReturnValue(false);
    const result = readRecentMessages(SESSION_DIR);
    expect(result).toEqual([]);
    expect(fs.existsSync).toHaveBeenCalledWith(EVENTS_PATH);
  });

  test('gibt leeres Array zurück bei leerer Datei', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 0 });
    const result = readRecentMessages(SESSION_DIR);
    expect(result).toEqual([]);
  });

  test('gibt leeres Array zurück wenn nur unbekannte Event-Typen vorhanden', () => {
    const lines = [
      JSON.stringify({ type: 'system.init', data: { content: 'boot' }, timestamp: '2025-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'tool.call', data: { content: 'ls' }, timestamp: '2025-01-01T00:01:00Z' }),
    ].join('\n');

    mockFileContent(lines);
    const result = readRecentMessages(SESSION_DIR);
    expect(result).toEqual([]);
  });

  test('gibt eine user.message korrekt zurück', () => {
    const ts = '2025-06-01T10:00:00Z';
    const lines = makeEvent('user.message', 'Hallo Welt', ts);
    mockFileContent(lines);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'Hallo Welt', timestamp: ts });
  });

  test('gibt eine assistant.message korrekt zurück', () => {
    const ts = '2025-06-01T10:01:00Z';
    const lines = makeEvent('assistant.message', 'Ich helfe gerne!', ts);
    mockFileContent(lines);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Ich helfe gerne!', timestamp: ts });
  });

  test('gibt 5 gemischte Nachrichten chronologisch sortiert zurück', () => {
    const events = [
      makeEvent('user.message', 'Frage 1', '2025-06-01T10:00:00Z'),
      makeEvent('assistant.message', 'Antwort 1', '2025-06-01T10:01:00Z'),
      makeEvent('user.message', 'Frage 2', '2025-06-01T10:02:00Z'),
      makeEvent('assistant.message', 'Antwort 2', '2025-06-01T10:03:00Z'),
      makeEvent('user.message', 'Frage 3', '2025-06-01T10:04:00Z'),
    ].join('\n');

    mockFileContent(events);
    const result = readRecentMessages(SESSION_DIR, 10);
    expect(result).toHaveLength(5);
    // Chronologisch: älteste zuerst
    expect(result[0].content).toBe('Frage 1');
    expect(result[0].role).toBe('user');
    expect(result[4].content).toBe('Frage 3');
    expect(result[4].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  test('gibt nur die letzten limit Nachrichten zurück', () => {
    const events = [
      makeEvent('user.message', 'Msg 1', '2025-06-01T10:00:00Z'),
      makeEvent('assistant.message', 'Msg 2', '2025-06-01T10:01:00Z'),
      makeEvent('user.message', 'Msg 3', '2025-06-01T10:02:00Z'),
      makeEvent('assistant.message', 'Msg 4', '2025-06-01T10:03:00Z'),
      makeEvent('user.message', 'Msg 5', '2025-06-01T10:04:00Z'),
      makeEvent('assistant.message', 'Msg 6', '2025-06-01T10:05:00Z'),
    ].join('\n');

    mockFileContent(events);
    const result = readRecentMessages(SESSION_DIR, 3);
    expect(result).toHaveLength(3);
    // Letzte 3 Nachrichten, chronologisch sortiert (älteste zuerst)
    expect(result[0].content).toBe('Msg 4');
    expect(result[1].content).toBe('Msg 5');
    expect(result[2].content).toBe('Msg 6');
  });

  test('concateniert content-Array (OpenAI-Format) korrekt', () => {
    const ts = '2025-06-01T10:00:00Z';
    const event = JSON.stringify({
      type: 'user.message',
      data: {
        content: [
          { type: 'text', text: 'Hallo ' },
          { type: 'text', text: 'Welt!' },
        ]
      },
      timestamp: ts
    });
    mockFileContent(event);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hallo Welt!');
  });

  test('ignoriert ungültige JSON-Zeilen und gibt gültige zurück', () => {
    const lines = [
      'das ist kein JSON',
      makeEvent('user.message', 'Gültig', '2025-06-01T10:00:00Z'),
      '{kaputtes json: >>>',
      makeEvent('assistant.message', 'Auch gültig', '2025-06-01T10:01:00Z'),
    ].join('\n');

    mockFileContent(lines);
    const result = readRecentMessages(SESSION_DIR, 10);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Gültig');
    expect(result[1].content).toBe('Auch gültig');
  });

  test('gibt leeres Array zurück wenn fs.statSync wirft', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockImplementation(() => { throw new Error('EACCES'); });

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toEqual([]);
  });

  test('schließt File Descriptor auch bei Fehler', () => {
    const ts = '2025-06-01T10:00:00Z';
    mockFileContent(makeEvent('user.message', 'Test', ts));

    readRecentMessages(SESSION_DIR);
    expect(fs.closeSync).toHaveBeenCalledWith(42);
  });

  test('gibt leeren timestamp wenn keiner im Event vorhanden', () => {
    const event = JSON.stringify({ type: 'user.message', data: { content: 'Ohne TS' } });
    mockFileContent(event);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe('');
  });

  test('default limit ist 5', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent('user.message', `Msg ${i}`, `2025-06-01T10:0${i}:00Z`));
    }
    mockFileContent(events.join('\n'));

    const result = readRecentMessages(SESSION_DIR); // kein limit → default 5
    expect(result).toHaveLength(5);
  });

  test('behandelt content-Array mit gemischten String- und Objekt-Teilen', () => {
    const event = JSON.stringify({
      type: 'assistant.message',
      data: {
        content: [
          'Direkter String',
          { type: 'text', text: ' und Objekt' },
        ]
      },
      timestamp: '2025-06-01T10:00:00Z'
    });
    mockFileContent(event);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Direkter String und Objekt');
  });

  test('ignoriert Events ohne data.content', () => {
    const event = JSON.stringify({
      type: 'user.message',
      data: {},
      timestamp: '2025-06-01T10:00:00Z'
    });
    mockFileContent(event);

    const result = readRecentMessages(SESSION_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('');
  });
});

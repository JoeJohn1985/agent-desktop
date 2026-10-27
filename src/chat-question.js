(function (root) {
  'use strict';
  const instruction = [
    'Agent Desktop chat format: when asking the user ONE question with suggested single-choice answers,',
    'prefer a native ask_user tool if available; never duplicate native questions or permissions.',
    'Otherwise end your final assistant response with exactly one standalone fenced JSON block:',
    '```agent-desktop-question',
    '{"question":"Your concise question?","options":["First answer","Second answer"]}',
    '```',
    'Use only these keys, 2–6 distinct nonempty plain-text options (max 300 characters each),',
    'question max 500 characters. Each option is the exact user reply to send. Free replies remain possible.',
    'Use this format only for an actual question awaiting a reply, never for examples, ordinary lists, commentary or tool progress.',
  ].join('\n');

  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > 200000) return null;
    const matches = [...raw.matchAll(/^```agent-desktop-question\r?\n([\s\S]*?)^```[ \t]*$/gm)];
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (raw.slice(match.index + match[0].length).trim() || match[1].length > 4096) return null;
    // A block nested in another code fence is an example, not a question.
    const before = raw.slice(0, match.index);
    if ((before.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2) return null;
    try {
      const value = JSON.parse(match[1]);
      if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'options,question') return null;
      const valid = (s, max) => typeof s === 'string' && s === s.trim() && s.length > 0 &&
        s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);
      if (!valid(value.question, 500) || !Array.isArray(value.options) ||
          value.options.length < 2 || value.options.length > 6 ||
          !value.options.every(s => valid(s, 300)) || new Set(value.options).size !== value.options.length) return null;
      return { text: before.trimEnd(), question: value.question, options: value.options };
    } catch { return null; }
  }
  function displayReply(raw) {
    if (typeof raw !== 'string') return raw;
    return raw.startsWith(instruction) ? raw.slice(instruction.length).trimStart() : raw;
  }
  function answerText(raw) {
    let text = displayReply(raw);
    if (typeof text !== 'string') return text;
    // Remove only prefixes produced by the app's existing send path, not
    // arbitrary user prose. Native history itself is never rewritten.
    text = text.replace(/^(?:\/agent [^\r\n]+\r?\n)+\r?\n/, '');
    text = text.replace(/^Nimm für diese Aufgabe die Rolle\/Herangehensweise folgender Agenten ein:\r?\n(?:- [^\r\n]+\r?\n)+\r?\n/, '');
    return text.replace(/^Verwende folgende Skills für diese Aufgabe:\r?\n(?:- [^\r\n]+\r?\n)+\r?\n/, '');
  }
  const api = { instruction, parse, displayReply, answerText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChatQuestion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

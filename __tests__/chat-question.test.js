const { parse, instruction } = require('../src/chat-question');
const fs = require('fs');
const path = require('path');
const block = value => 'Text\n\n```agent-desktop-question\n' + JSON.stringify(value) + '\n```';
const valid = { question: 'Welche Richtung?', options: ['A', 'B'] };

test('explicit bounded contract only; HTML remains plain strings', () => {
  expect(parse(block(valid))).toEqual({ text: 'Text', ...valid });
  expect(parse(block({ ...valid, options: ['<img src=x onerror=alert(1)>', 'B'] })).options[0]).toContain('<img');
});
test.each([
  '- A\n- B', '```agent-desktop-question\n{', block(valid).slice(0, -1),
  block(valid) + '\nweiter', block(valid) + '\n' + block(valid),
  '````text\n' + block(valid) + '\n````',
  ...[
    null, [], {}, { ...valid, extra: true }, { ...valid, question: '' },
    { ...valid, question: 'x'.repeat(501) }, { ...valid, options: ['A'] },
    { ...valid, options: Array(7).fill('A') }, { ...valid, options: ['A', 'A'] },
    { ...valid, options: ['A', 1] }, { ...valid, options: ['A', 'x'.repeat(301)] },
    { ...valid, options: [' A', 'B'] }, { ...valid, options: ['A\nB', 'C'] },
  ].map(block),
])('keeps invalid/incomplete/ordinary content intact: %s', raw => expect(parse(raw)).toBeNull());

test.each([
  ['anthropic-provider', ['cwd', 'custom instructions']],
  ['openai-compatible-provider', ['cwd', 'custom instructions']],
  ['gemini-provider', ['cwd', 'search', false]],
])('%s system prompt contains contract exactly once', (name, args) => {
  const prompt = require(`../src/providers/${name}`).buildSystemPrompt(...args);
  expect(prompt.split(instruction)).toHaveLength(2);
});
test('ACP path sends contract through existing invisible context, not native files', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  expect(source).toContain("client.prompt(prompt, require('./src/chat-question').instruction)");
});

test('restored OpenAI-compatible system context gains contract once without mutating source history', () => {
  const { OpenAICompatibleProvider } = require('../src/providers/openai-compatible-provider');
  const provider = new OpenAICompatibleProvider(1, () => {}, { cwd: 'fixture' });
  const source = [{ role: 'system', content: 'Existing rules' }, { role: 'user', content: 'Hello' }];
  provider._restoreHistory(source);
  expect(provider._serializeHistory()[0].content).toContain(instruction);
  expect(provider._serializeHistory()[0].content).toContain('Existing rules');
  expect(source[0].content).toBe('Existing rules');
  provider._restoreHistory(provider._serializeHistory());
  expect(provider._serializeHistory()[0].content.split(instruction)).toHaveLength(2);
});

test('ACP app context is hidden only in display projection', () => {
  const { displayReply } = require('../src/chat-question');
  expect(displayReply(instruction + '\n\nJa')).toBe('Ja');
  expect(displayReply('Normal text')).toBe('Normal text');
});

test('selected option is reconstructable with existing skill/agent send prefixes', () => {
  const { answerText } = require('../src/chat-question');
  const skills = 'Verwende folgende Skills für diese Aufgabe:\n- Test\n\n';
  expect(answerText(instruction + '\n/agent Tester\n\n' + skills + 'Ja')).toBe('Ja');
  expect(answerText('Nimm für diese Aufgabe die Rolle/Herangehensweise folgender Agenten ein:\n- Tester\n\n' + skills + 'Ja')).toBe('Ja');
  expect(answerText('Meine freie Antwort\n\nJa')).toBe('Meine freie Antwort\n\nJa');
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractMessageContent } = require('../src/sessions');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness() {
  const markdown = { render: jest.fn(text => `<p>${text}</p>`) };
  const context = vm.createContext({
    window: { markdown },
    document: { createElement: tag => ({ tag, dataset: {} }) },
    escapeHtml: text => text.replace(/</g, '&lt;'),
    Date,
  });
  vm.runInContext(read('renderer/modules/sessions-sidebar.js'), context);
  const nodes = [];
  const tab = {};
  return { context, nodes, tab, markdown, insert: node => nodes.push(node) };
}

test('Copilot and Claude text previews use live bubble markup and omit empty tool turns', () => {
  const h = harness();
  const tool = [{ type: 'tool_use', name: 'read_file', input: { file: 'secret' } }];
  const messages = [
    { role: 'user', content: 'Frage' },
    { role: 'assistant', content: extractMessageContent(tool) },
    { role: 'assistant', content: extractMessageContent([...tool, { type: 'text', text: 'Antwort' }]) },
    { role: 'assistant', content: '   ' },
    { role: 'tool', content: 'Ergebnis' },
  ];
  const snapshot = JSON.stringify(messages);
  h.context.renderSimpleHistory(messages, h.insert, h.tab);
  expect(h.nodes.map(n => n.className)).toEqual(['stream-input', 'stream-response markdown-body']);
  expect(h.nodes[0].textContent).toBe('Frage');
  expect(h.nodes[1].innerHTML).toBe('<p>Antwort</p>');
  expect(h.nodes.every(n => Number(n.dataset.ts) > 0)).toBe(true);
  expect(JSON.stringify(messages)).toBe(snapshot);
});

test.each([
  ['Anthropic', [
    { role: 'user', content: [{ type: 'tool_result', content: 'private' }, { type: 'text', text: 'Frage' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'tool_use', name: 'read' }] },
    { role: 'assistant', content: [{ type: 'tool_use', name: 'read' }, { type: 'text', text: 'Antwort' }] },
    { role: 'user', content: [{ type: 'tool_result', content: 'private' }] },
  ]],
  ['Gemini', [
    { role: 'user', parts: [{ text: 'Frage' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read', args: {} } }, { thought: true, text: 'private' }] },
    { role: 'model', parts: [{ text: 'Antwort' }, { functionCall: { name: 'read' } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read', response: 'private' } }] },
  ]],
  ['OpenAI-compatible', [
    { role: 'user', content: 'Frage' },
    { role: 'assistant', content: null, tool_calls: [{ function: { name: 'read', arguments: '{}' } }] },
    { role: 'assistant', content: 'Antwort', tool_calls: [{ function: { name: 'read', arguments: 'malformed' } }] },
    { role: 'tool', content: 'private' },
  ]],
])('%s history displays only text without mutating native context', (_provider, messages) => {
  const h = harness();
  const snapshot = JSON.stringify(messages);
  h.context.renderApiHistory(messages, h.insert, h.tab);
  expect(h.nodes.map(n => n.className)).toEqual(['stream-input', 'stream-response markdown-body']);
  expect(h.nodes[0].textContent).toBe('Frage');
  expect(h.nodes[1].innerHTML).toBe('<p>Antwort</p>');
  expect(h.nodes.every(n => Number(n.dataset.ts) > 0)).toBe(true);
  expect(JSON.stringify(messages)).toBe(snapshot);
});

test.each(['renderSimpleHistory', 'renderApiHistory'])('%s keeps backlog lazy and ordered', renderer => {
  const h = harness();
  const messages = Array.from({ length: 25 }, (_, i) => ({ role: 'assistant', content: `Text ${i}` }));
  h.context[renderer](messages, h.insert, h.tab);
  expect(h.nodes).toHaveLength(20);
  expect(h.markdown.render).toHaveBeenCalledTimes(20);
  expect(h.nodes[0].innerHTML).toBe('<p>Text 5</p>');
  expect(h.tab._prunedNodes).toHaveLength(5);
  const older = h.tab._prunedNodes.flatMap(build => build());
  expect([...older, ...h.nodes].map(n => n.innerHTML)).toEqual(messages.map(m => `<p>${m.content}</p>`));
});

test('restored bubbles share live styles; live tool rendering and restore routing remain available', () => {
  expect(read('renderer/styles.css')).not.toMatch(/\.stream-(?:input|response|tool)--history/);
  const live = read('renderer/modules/agent-ipc.js');
  expect(live).toContain("className = 'stream-response markdown-body'");
  expect(live).toContain("className = 'stream-tool-result'");
  const restore = read('renderer/modules/sessions-sidebar.js');
  expect(restore).toContain('renderSimpleHistory(await desktop.sessions.readAllMessages');
  expect(restore).toContain('renderSimpleHistory(await desktop.sessions.readClaudeCodeTranscript');
  expect(restore).toContain('renderApiHistory(messages, insertBefore, tab)');
  expect(read('renderer/app.js')).toContain('if (t.sessionId) displaySessionContext(tab, t.sessionId, tabId)');
});

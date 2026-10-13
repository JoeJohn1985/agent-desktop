const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

test('background tab allocation preserves active tab and draft and forces no new IPC ID', async () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'modules', 'tabs.js'), 'utf8');
  const start = source.indexOf('async function createTab(');
  const end = source.indexOf('\n/**', start);
  const original = { inputText: 'Ungesendeter Entwurf' };
  const tabs = new Map([[1, original]]);
  const stream = () => ({ style: {}, appendChild: jest.fn() });
  const context = vm.createContext({
    tabs, activeTabId: 1, window: { RendererLogic: { seedReasoningForNewTab: () => ({}) } },
    document: { createElement: stream, getElementById: stream },
    desktop: { chat: { newTab: jest.fn() } },
    initAutoScroll: jest.fn(), getSettings: () => ({}),
    getDefaultModelForProvider: () => 'gpt-5', providerHasReasoning: () => false,
    normalizeReasoningByModel: x => x, getSavedModeForProvider: () => null,
    DEFAULT_MODE_ID: 'agent', switchTab: jest.fn(), renderTabs: jest.fn(), updateStatus: jest.fn(),
  });
  vm.runInContext(source.slice(start, end), context);
  await context.createTab('🗓️ Aufgabe', 'gpt-5', 'copilot', undefined, 9);
  expect(context.switchTab).not.toHaveBeenCalled();
  expect(context.desktop.chat.newTab).not.toHaveBeenCalled();
  expect(context.activeTabId).toBe(1);
  expect(original.inputText).toBe('Ungesendeter Entwurf');
  expect(tabs.get(9).streamEl.style.display).toBe('none');
});

test('scheduled IPC validates provider and delegates confirmed catch-up without coercion', () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('scheduled:list'");
  const end = source.indexOf('\n', source.indexOf("ipcMain.handle('scheduled:action'", start));
  const handlers = new Map();
  const scheduledTasks = { snapshot: jest.fn(() => ({ tasks: [] })), upsert: jest.fn(), action: jest.fn() };
  const context = vm.createContext({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    scheduledTasks, getModelProvider: id => id === 'copilot-model' ? 'copilot' : 'anthropic',
  });
  vm.runInContext(source.slice(start, end), context);
  expect(handlers.get('scheduled:list')()).toEqual({ tasks: [] });
  expect(() => handlers.get('scheduled:save')(null, { model: 'api-model' })).toThrow('Copilot');
  handlers.get('scheduled:save')(null, { model: 'copilot-model' });
  expect(scheduledTasks.upsert).toHaveBeenCalledWith({ model: 'copilot-model' });
  handlers.get('scheduled:action')(null, 'id', 'catchUp', 'true');
  expect(scheduledTasks.action).toHaveBeenCalledWith('id', 'catchUp', 'true');
});

test('preload only allows scheduled event channels and unsubscribes exact listener', () => {
  const source = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const start = source.indexOf("contextBridge.exposeInMainWorld('scheduled'");
  const end = source.indexOf('\n});', start) + 4;
  let api;
  const ipcRenderer = { invoke: jest.fn(), on: jest.fn(), removeListener: jest.fn() };
  vm.runInNewContext(source.slice(start, end), {
    contextBridge: { exposeInMainWorld: (_name, bridge) => { api = bridge; } }, ipcRenderer,
  });
  expect(() => api.on('agent:event', jest.fn())).toThrow();
  const callback = jest.fn();
  const remove = api.on('changed', callback);
  const handler = ipcRenderer.on.mock.calls[0][1];
  handler({}, { tasks: [] });
  expect(callback).toHaveBeenCalledWith({ tasks: [] });
  remove();
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith('scheduled:changed', handler);
  api.action('id', 'catchUp', true);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith('scheduled:action', 'id', 'catchUp', true);
});

test('scheduled ACP prompts reuse MCP but cannot enable auto-approval or crash restart', async () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const prompt = source.match(/^async function sendAgentPrompt\b[\s\S]*?^\}/m)[0];
  const client = {
    state: 'ready', sessionId: 'fresh-session', __provider: 'copilot', __mcpRevision: 1,
    updateOptions: jest.fn(), prompt: jest.fn().mockResolvedValue(),
  };
  const send = vm.runInNewContext(`(${prompt})`, {
    scheduledTabs: new Map([[7, { id: 'run' }]]), backends: new Map([[7, client]]),
    appMcp: { revision: 1, getCopilotMcpConfig: jest.fn().mockResolvedValue('app-mcp.json') },
    COPILOT_CWD: 'C:\\project', COPILOT_BIN: 'copilot',
  });
  await send(7, 'Prompt', { provider: 'copilot', cwd: 'C:\\project', model: 'copilot-model', manualApproval: false });
  expect(client.updateOptions).toHaveBeenCalledWith(expect.objectContaining({
    allowAll: false, autoApprovePermissions: false, autoRestart: false,
    additionalMcpConfig: 'app-mcp.json', model: 'copilot-model', cwd: 'C:\\project',
  }));
  expect(client.prompt).toHaveBeenCalledWith('Prompt');
});

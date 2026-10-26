const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'functions.js'), 'utf8');

function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, attributes: {},
      classList: { toggle: jest.fn() },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    window: {},
    document: { getElementById: element, querySelector: element, addEventListener: jest.fn() },
    renderSkills: jest.fn(), renderMcpServers: jest.fn(), renderPlugins: jest.fn(),
    renderCostsPanel: jest.fn(), renderScheduledTasks: jest.fn(), requestAnimationFrame: callback => callback(),
  });
  vm.runInContext(source, context);
  return { context, element };
}

test('opens every subpage exclusively and retains last selection on return', () => {
  const { context, element } = setup();
  for (const [page, id, renderer] of [
    ['skills', 'skillsView', 'renderSkills'], ['connections', 'connectionsView', 'renderMcpServers'],
    ['plugins', 'pluginsView', 'renderPlugins'], ['costs', 'costsView', 'renderCostsPanel'],
    ['scheduled', 'scheduledView', 'renderScheduledTasks'],
  ]) {
    context.openFunctionsView(page);
    expect(element(id).style.display).toBe('flex');
    expect(element('functionsView').classList.toggle).toHaveBeenLastCalledWith('functions-view--compact', true);
    if (page === 'scheduled') {
      expect(element('.functions-view__nav').style.display).toBe('none');
      expect(element('btnScheduled').attributes['aria-expanded']).toBe('true');
      expect(element('btnFunctions').attributes['aria-expanded']).toBe('false');
    }
    expect(context[renderer]).toHaveBeenCalled();
    expect(['skillsView', 'connectionsView', 'pluginsView', 'costsView', 'scheduledView']
      .filter(key => element(key).style.display === 'flex')).toEqual([id]);
    expect(element('#streamArea').style.display).toBe('none');
    context.closeFunctionsView();
    expect(context.window.functionsViewActive).toBe(false);
    expect(element('#streamArea').style.display).toBe('');
    context.openFunctionsView();
    expect(element(page === 'scheduled' ? 'costsView' : id).style.display).toBe('flex');
  }
});

test('rejects unknown subpages before changing the view', () => {
  const { context } = setup();
  expect(() => context.openFunctionsView('invalid')).toThrow('Unbekannter Funktionsbereich');
  expect(context.window.functionsViewActive).toBe(false);
});

test('existing plugin entry points route to the shared view and retain plugin actions', async () => {
  const { context, element } = setup();
  const { escapeHtml, escapeAttr } = require('../src/renderer-logic');
  const success = { success: true };
  Object.assign(context, {
    escapeHtml, escapeAttr, CSS: { escape: value => value },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    showNotification: jest.fn(), reloadSkills: jest.fn(),
    desktop: { plugins: {
      list: jest.fn().mockResolvedValue({ success: true, plugins: [{ name: 'fixture', version: '1' }] }),
      listMarketplaces: jest.fn().mockResolvedValue({ success: true, marketplaces: [] }),
      install: jest.fn().mockResolvedValue(success), uninstall: jest.fn().mockResolvedValue(success),
      update: jest.fn().mockResolvedValue(success),
    } },
  });
  const querySelector = context.document.querySelector;
  context.document.querySelector = selector => selector.startsWith('.plugin-tile') ? null : querySelector(selector);
  element('pluginSearch').value = '';
  const pluginSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'plugins.js'), 'utf8');
  vm.runInContext(pluginSource, context);
  context.window.switchToPluginsView();
  expect(element('pluginsView').style.display).toBe('flex');
  context.window.switchToCostsView();
  expect(element('costsView').style.display).toBe('flex');
  context.switchToChatView();
  expect(context.window.functionsViewActive).toBe(false);
  await context.window.installPlugin('fixture@market');
  await context.window.updatePlugin('fixture');
  await context.window.uninstallPlugin('fixture');
  expect(context.desktop.plugins.install).toHaveBeenCalledWith('fixture@market');
  expect(context.desktop.plugins.update).toHaveBeenCalledWith('fixture');
  expect(context.desktop.plugins.uninstall).toHaveBeenCalledWith('fixture');
  expect(context.reloadSkills).toHaveBeenCalledTimes(3);
  expect(element('pluginList').innerHTML).toContain('fixture');
  expect(element('pluginCount').textContent).toBe('1');
  element('pluginSearch').value = 'unmatched';
  context.renderPlugins();
  expect(element('pluginList').innerHTML).toContain('Keine Ergebnisse');
});

describe('actual skill and connection renderers', () => {
  const skillSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'skills-mcp.js'), 'utf8');
  const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

  function setupSkills() {
    const elements = Object.fromEntries(['skillList', 'skillsContext', 'mcpList', 'connectionsContext']
      .map(id => [id, { innerHTML: '', textContent: '' }]));
    const context = vm.createContext({
      document: { getElementById: id => elements[id] },
      tabs: new Map([
        ['a', { cwd: 'C:\\first', provider: 'copilot', activeSkills: new Set() }],
        ['b', { cwd: 'C:\\second', provider: 'anthropic', activeSkills: new Set() }],
      ]),
      activeTabId: 'a',
      getTabProvider: tab => tab?.provider || 'copilot',
      escapeHtml, escapeAttr,
      emptyStateHtml: (_icon, message) => escapeHtml(message),
      MCP_STATUS_LABELS: { connected: 'verbunden' },
      mcpMenuButtonHtml: () => '<button>Optionen</button>',
      console,
      desktop: { context: { listSkills: jest.fn().mockResolvedValue([]), listAgents: jest.fn().mockResolvedValue([]) } },
    });
    vm.runInContext(skillSource, context);
    return { context, elements };
  }

  test('skill activation stays per tab and shows source, description and context', () => {
    const { context, elements } = setupSkills();
    vm.runInContext(`skills = [{id: 'test', name: '<Name>', description: '<Description>', source: 'project'}]; renderSkills(); toggleSkill('test');`, context);
    expect(elements.skillList.innerHTML).toContain('aria-pressed="true"');
    expect(elements.skillList.innerHTML).toContain('&lt;Description&gt;');
    expect(elements.skillList.innerHTML).toContain('project');
    expect(elements.skillsContext.textContent).toContain('C:\\first');
    context.activeTabId = 'b';
    context.renderSkills();
    expect(elements.skillList.innerHTML).toContain('aria-pressed="false"');
    expect(elements.skillsContext.textContent).toContain('anthropic');
    expect(context.tabs.get('a').activeSkills.has('test')).toBe(true);
    expect(context.tabs.get('b').activeSkills.size).toBe(0);
  });

  test('empty skills and management without an active chat remain explicit', () => {
    const { context, elements } = setupSkills();
    context.activeTabId = null;
    context.renderSkills();
    context.renderMcpServers();
    expect(elements.skillsContext.textContent).toBe('Kein Chat-Tab ausgewählt.');
    expect(elements.skillList.innerHTML).toContain('Keine Skills');
    expect(elements.mcpList.innerHTML).toContain('hinzufügen');
  });

  test('MCP management remains visible for non-Copilot tabs without changing provider wiring', () => {
    const { context, elements } = setupSkills();
    context.activeTabId = 'b';
    vm.runInContext(`globalMcpServers = [{name:'app-server', managed:true, status:'connected', error:'<fixture error>'}];
      mcpServers = [{name:'native', fromProject:true, status:'configured'}]; renderMcpServers();`, context);
    expect(elements.mcpList.innerHTML).toContain('app-server (App)');
    expect(elements.mcpList.innerHTML).toContain('native (Projekt / CLI)');
    expect(elements.mcpList.innerHTML).toContain('<div class="mcp-manager__error">&lt;fixture error&gt;</div>');
    expect(elements.connectionsContext.textContent).toContain('anthropic');
  });

  test('skill load errors are visible and an explicit reload can recover', async () => {
    const { context, elements } = setupSkills();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      context.desktop.context.listSkills.mockRejectedValueOnce(new Error('fixture failure'));
      await context.loadContextForTab('copilot', 'C:\\first');
      expect(elements.skillList.innerHTML).toContain('fixture failure');
      await context.reloadSkills();
      expect(elements.skillList.innerHTML).toContain('Keine Skills');
    } finally {
      warn.mockRestore();
    }
  });
});

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
    loadGlobalSkills: jest.fn().mockResolvedValue(),
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
    expect(element('#sessionActions').style.display).toBe('none');
    expect(element('.chat-input-bar').style.display).toBe('none');
    context.closeFunctionsView();
    expect(context.window.functionsViewActive).toBe(false);
    expect(element('#streamArea').style.display).toBe('');
    expect(element('#sessionActions').style.display).toBe('');
    expect(element('.chat-input-bar').style.display).toBe('');
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
      .map(id => [id, { innerHTML: '', textContent: '', querySelectorAll: () => [] }]));
    const context = vm.createContext({
      window: { addEventListener: jest.fn() },
      getConnectedProviders: jest.fn().mockResolvedValue(['copilot', 'claude-code', 'anthropic'].map(id => ({ id, label: id }))),
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
      showNotification: jest.fn(),
      desktop: { context: { listGlobalSkills: jest.fn().mockResolvedValue([]), listSkills: jest.fn().mockResolvedValue([]), listAgents: jest.fn().mockResolvedValue([]) } },
    });
    vm.runInContext(skillSource, context);
    return { context, elements };
  }

  test('global management uses provider-grouped standard toggles and remains unchanged on tab switch', async () => {
    const { context, elements } = setupSkills();
    context.desktop.context.listGlobalSkills.mockResolvedValueOnce([
      { providers: ['copilot'], directory: 'global-copilot', skills: [{ name: '<Name>', description: '<Description>' }] },
      { providers: ['anthropic'], directory: 'global-api', skills: [{ name: '<Name>' }] },
    ]);
    await context.loadGlobalSkills();
    vm.runInContext(`skills = [{id: 'test', name: '<Name>', description: '<Description>', source: 'project'}]; renderSkills(); toggleSkill('test');`, context);
    expect(elements.skillList.innerHTML).not.toContain('aria-pressed');
    expect(elements.skillList.innerHTML).not.toContain('skill-card__toggle');
    expect(elements.skillList.innerHTML).toContain('class="settings__toggle"');
    expect(elements.skillList.innerHTML).toContain('data-unsupported-skill disabled');
    expect(elements.skillList.innerHTML).toContain('&lt;Description&gt;');
    expect(elements.skillList.innerHTML).not.toContain('project');
    const html = elements.skillList.innerHTML;
    context.activeTabId = 'b';
    context.renderSkills();
    expect(elements.skillList.innerHTML).toBe(html);
    expect(elements.skillList.innerHTML).toContain('anthropic');
    expect(context.tabs.get('a').activeSkills.has('test')).toBe(true);
    expect(context.tabs.get('b').activeSkills.size).toBe(0);
  });

  test('connected providers alone determine sections, order, shared roots and status changes without tabs', async () => {
    const { context, elements } = setupSkills();
    context.activeTabId = null;
    context.desktop.context.listGlobalSkills.mockResolvedValue([
      { providers: ['anthropic'], directory: 'api', skills: [] },
      { providers: ['claude-code'], directory: 'claude', skills: [] },
      { providers: ['copilot'], directory: 'copilot', skills: [] },
      { providers: ['claude-code', 'openai'], directory: 'shared', skills: [] },
    ]);
    await context.loadGlobalSkills();
    const html = elements.skillList.innerHTML;
    expect(html.indexOf('data-skill-provider="copilot"')).toBeLessThan(html.indexOf('data-skill-provider="claude-code"'));
    expect(html.indexOf('data-skill-provider="claude-code"')).toBeLessThan(html.indexOf('data-skill-provider="anthropic"'));
    expect(html).not.toContain('data-skill-provider="openai"');
    expect(html).toContain('shared');
    context.getConnectedProviders.mockResolvedValue([]);
    await context.loadGlobalSkills();
    expect(elements.skillList.innerHTML).not.toContain('data-skill-provider');
    expect(elements.skillList.innerHTML).not.toContain('shared');
  });

  test('late connection snapshots cannot overwrite a newer refresh', async () => {
    const { context, elements } = setupSkills();
    let resolve;
    context.getConnectedProviders.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const old = context.loadGlobalSkills();
    context.getConnectedProviders.mockResolvedValue([]);
    await context.loadGlobalSkills();
    resolve([{ id: 'copilot', label: 'Stale' }]);
    await old;
    expect(elements.skillList.innerHTML).not.toContain('Stale');
  });

  test('native Copilot activation works without a tab and refreshes authoritative status', async () => {
    const { context, elements } = setupSkills();
    context.activeTabId = null;
    context.desktop.context.setGlobalSkillEnabled = jest.fn().mockResolvedValue();
    context.desktop.context.listGlobalSkills.mockResolvedValue([{
      providers: ['copilot'], native: true, directory: 'native',
      skills: [{ id: 'native-path', name: '<Name>', enabled: false }],
    }]);
    await context.setGlobalSkillEnabled('native-path', false);
    expect(context.desktop.context.setGlobalSkillEnabled).toHaveBeenCalledWith('copilot', 'native-path', false);
    expect(elements.skillList.innerHTML).toContain('Deaktiviert · Aktivieren');
    expect(elements.skillList.innerHTML).toContain('class="settings__toggle"');
    expect(elements.skillList.innerHTML).toContain('type="checkbox"');
    expect(elements.skillList.innerHTML).not.toContain(' checked');
    expect(elements.skillList.innerHTML).toContain('&lt;Name&gt;');
    expect(context.desktop.context.listSkills).not.toHaveBeenCalled();
  });

  test('native failures remain visible, preserve tab selections and release the mutation lock', async () => {
    const { context } = setupSkills();
    context.desktop.context.setGlobalSkillEnabled = jest.fn().mockRejectedValue(new Error('fixture refusal'));
    context.tabs.get('a').activeSkills.add('keep');
    await context.setGlobalSkillEnabled('native-path', false);
    expect(context.showNotification).toHaveBeenCalledWith(expect.stringContaining('fixture refusal'), 'error');
    expect(context.tabs.get('a').activeSkills.has('keep')).toBe(true);
    expect(vm.runInContext('_globalSkillMutation', context)).toBe(false);
  });

  test('a successful native change forces active session discovery without dropping other selections', async () => {
    const { context } = setupSkills();
    context.tabs.get('a').activeSkills.add('keep');
    context.desktop.context.setGlobalSkillEnabled = jest.fn().mockResolvedValue();
    context.desktop.context.listSkills.mockResolvedValue([{ id: 'keep', name: 'Keep' }]);
    await context.setGlobalSkillEnabled('native-path', false);
    expect(context.desktop.context.listSkills).toHaveBeenCalledWith('copilot', 'C:\\first');
    expect(context.getActiveSkillDefinitions(context.tabs.get('a')).map(s => s.id)).toEqual(['keep']);
  });

  test('empty skills and management without an active chat remain explicit', async () => {
    const { context, elements } = setupSkills();
    context.activeTabId = null;
    await context.loadGlobalSkills();
    context.renderMcpServers();
    expect(elements.skillsContext.textContent).toContain('Benutzerweite Skills');
    expect(elements.skillList.innerHTML).toContain('Keine lokalen');
    expect(context.desktop.context.listSkills).not.toHaveBeenCalled();
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
      context.desktop.context.listGlobalSkills.mockRejectedValueOnce(new Error('fixture failure'));
      await context.loadGlobalSkills();
      expect(elements.skillList.innerHTML).toContain('fixture failure');
      await context.reloadSkills();
      expect(elements.skillList.innerHTML).toContain('Keine lokalen');
    } finally {
      warn.mockRestore();
    }
  });

  test('resolved prompt skills persist until toggled and never leak across pending context loads', async () => {
    const { context } = setupSkills();
    const fixture = [{ id: 'test', name: 'Skill' }];
    context.desktop.context.listSkills.mockResolvedValueOnce(fixture);
    await context.loadContextForTab('copilot', 'C:\\first');
    context.toggleSkill('test');
    const a = context.tabs.get('a');
    expect(context.getActiveSkillDefinitions(a).map(s => s.name)).toEqual(['Skill']);
    expect(context.getActiveSkillDefinitions(a)).toHaveLength(1);
    let resolve;
    context.desktop.context.listSkills.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    context.activeTabId = 'b';
    const pending = context.loadContextForTab('anthropic', 'C:\\second');
    expect(context.getActiveSkillDefinitions(a)).toHaveLength(0);
    context.toggleSkill('test');
    expect(context.tabs.get('b').activeSkills.size).toBe(0);
    context.activeTabId = 'a';
    context.desktop.context.listSkills.mockResolvedValueOnce(fixture);
    await context.loadContextForTab('copilot', 'C:\\first');
    resolve([{ id: 'old', name: 'Obsolete' }]);
    await pending;
    expect(context.getActiveSkillDefinitions(a).map(s => s.name)).toEqual(['Skill']);
    context.toggleSkill('test');
    expect(context.getActiveSkillDefinitions(a)).toHaveLength(0);
  });
});

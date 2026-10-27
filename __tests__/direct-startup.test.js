const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('renderer/app.js');
const startup = app.slice(app.lastIndexOf("document.addEventListener('DOMContentLoaded'"));
const splashSource = app.match(/^function hideAppLoadingSplash\(\) \{[\s\S]*?^\}/m)[0];

function startupContext({ restored = false, fail = false } = {}) {
  let callback;
  const splash = { classList: { add: jest.fn() }, remove: jest.fn() };
  const context = {
    document: {
      addEventListener: jest.fn((_event, handler) => { callback = handler; }),
      getElementById: jest.fn(() => splash),
    },
    window: {},
    setTimeout: jest.fn(fn => fn()),
    tabs: new Map([['restored', { cwd: 'C:\\workspace' }]]),
    activeTabId: 'restored',
  };
  const functions = [
    'loadPreferences', 'migrateDeniedToolsToPerProvider', 'initCopilotModels',
    'refreshAllProviderModels', 'applyTheme', 'getCurrentTheme', 'initAgentIPC',
    'initResize', 'initStatusbar', 'initDataLoad', 'createTab', 'getTabProvider',
    'loadContextForTab', 'loadProjectMcpServers', 'initChatInput',
    'initWindowControls', 'initSlashButtons', 'initSettings', 'initSidebar',
    'initMcpManager', 'initPluginButtons', 'initTestRunner', 'initDevConsole',
    'initChatSearch', 'initKeyboardShortcuts', 'initDragDrop', 'initTooltips',
    'initListActionDelegation', 'initSessionSkills', 'initTabModelSelector',
    'initTabModeSelector', 'initGeminiModeToggle', 'initContextInfo',
    'refreshProviderStatus', 'initUpdateChecker', 'initClaudeAdapterUpdateChecker',
    'initDynamicPricing', 'initSubscriptionUsageTicker',
  ];
  for (const name of functions) context[name] = jest.fn();
  context.restoreOpenTabs = jest.fn().mockResolvedValue(restored);
  if (fail) context.initDataLoad.mockRejectedValue(new Error('startup failure'));
  vm.runInNewContext(`${splashSource}\n${startup}`, context);
  return { context, splash, run: () => callback() };
}

describe('Direct startup without legacy wizard', () => {
  test('first launch creates the normal chat and initializes provider/settings/skills controls', async () => {
    const { context, splash, run } = startupContext();
    await run();
    expect(context.createTab).toHaveBeenCalledWith('🤖 Chat');
    for (const name of ['initSettings', 'initSessionSkills', 'initTabModelSelector', 'refreshProviderStatus']) {
      expect(context[name]).toHaveBeenCalledTimes(1);
    }
    expect(splash.classList.add).toHaveBeenCalledWith('app-loading--hidden');
    expect(context.setTimeout).toHaveBeenCalledWith(expect.any(Function), 300);
    expect(splash.remove).toHaveBeenCalledTimes(1);
  });

  test('restored tabs keep their existing context without creating setup sessions', async () => {
    const { context, run } = startupContext({ restored: true });
    await run();
    expect(context.createTab).not.toHaveBeenCalled();
    expect(context.loadContextForTab).toHaveBeenCalledWith(undefined, 'C:\\workspace');
    expect(context.loadProjectMcpServers).toHaveBeenCalledWith('C:\\workspace');
  });

  test('startup failures still release the splash', async () => {
    const { splash, run } = startupContext({ fail: true });
    await expect(run()).rejects.toThrow('startup failure');
    expect(splash.remove).toHaveBeenCalledTimes(1);
  });

  test('splash cleanup tolerates an already removed element', () => {
    const context = { document: { getElementById: () => null }, setTimeout: jest.fn() };
    vm.runInNewContext(`${splashSource}\nhideAppLoadingSplash();`, context);
    expect(context.setTimeout).not.toHaveBeenCalled();
  });

  test('no legacy renderer markup, styles, scripts or IPC remain', () => {
    for (const file of ['renderer/index.html', 'renderer/styles.css', 'renderer/app.js', 'main.js', 'preload.js']) {
      expect(read(file)).not.toMatch(/onboarding|tutorialSkillsShown|tutorialRenameShown|tutorial-popup|setup:(getFolderStatus|createFolders|getCategories|createStarterFiles|startPersonalizedSessions)/i);
    }
    expect(fs.existsSync(path.join(root, 'renderer', 'modules', 'onboarding.js'))).toBe(false);
  });

  test('regular login and provider APIs remain exposed and handled', () => {
    const preload = read('preload.js');
    const main = read('main.js');
    for (const channel of ['auth:check', 'auth:login', 'agent:status', 'providers:setKey']) {
      expect(preload).toContain(`invoke('${channel}'`);
      expect(main).toContain(`handle('${channel}'`);
    }
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8');

test('one complete action bar docks immediately before the entire input bar, after auxiliary panels', () => {
  const html = read('index.html');
  expect(html.match(/id="sessionActions"/g)).toHaveLength(1);
  const actions = html.indexOf('id="sessionActions"');
  for (const id of ['streamArea', 'testRunnerPopup', 'devConsolePanel', 'permissionDropup']) {
    expect(html.indexOf(`id="${id}"`)).toBeLessThan(actions);
  }
  expect(html).toMatch(/<button type="button"[^>]*id="sessionUsage"[^>]*>[^<]*<\/button>\s*<\/div>\s*<div class="chat-input-bar">/);
  const bar = html.slice(actions, html.indexOf('<div class="chat-input-bar">'));
  for (const id of ['btnModelSelect', 'btnModeSelect', 'btnContextInfo', 'btnApprovalToggle',
    'btnGeminiMode', 'sessionProvider', 'sessionUsage']) {
    expect(bar).toContain(`id="${id}"`);
    expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
  }
  const order = ['sessionProvider', 'btnModelSelect', 'btnModeSelect', 'btnApprovalToggle',
    'btnGeminiMode', 'session-actions__spacer', 'btnContextInfo', 'sessionUsage'];
  order.slice(1).forEach((id, index) => {
    expect(bar.indexOf(order[index])).toBeLessThan(bar.indexOf(id));
  });
  expect(html).not.toContain('btnOpenCosts');
});

test('the live usage button opens the existing costs view without an obsolete icon listener', () => {
  const listeners = {};
  const switchToCostsView = jest.fn();
  const context = vm.createContext({
    getPref: () => true,
    window: { RendererLogic: {}, switchToCostsView },
    document: {
      querySelectorAll: () => [],
      getElementById: id => id === 'sessionUsage'
        ? { addEventListener: (event, callback) => { listeners[event] = callback; } } : null,
    },
  });
  const source = read(path.join('modules', 'costs.js'));
  vm.runInContext(source, context);
  vm.runInContext('initCostsPanel()', context);
  listeners.click();
  expect(switchToCostsView).toHaveBeenCalledTimes(1);
  expect(source).not.toContain('btnOpenCosts');
});

test.each([
  [1200, 800, { top: 690, bottom: 720, left: 200 }, 250, 'above', 200],
  [360, 640, { top: 520, bottom: 550, left: 300 }, 240, 'above', 112],
  [360, 240, { top: 20, bottom: 50, left: 4 }, 220, 'below', 8],
])('session menus stay inside a %s × %s viewport', (width, height, rect, menuWidth, direction, left) => {
  const context = vm.createContext({ window: { innerWidth: width, innerHeight: height, RendererLogic: {} } });
  vm.runInContext(read(path.join('modules', 'utils.js')), context);
  const menu = { style: {}, getBoundingClientRect: () => ({ width: menuWidth }) };
  context.positionSessionMenu(menu, { getBoundingClientRect: () => rect });
  expect(menu.style.position).toBe('fixed');
  expect(menu.style.left).toBe(`${left}px`);
  expect(menu.style.maxWidth).toBe(`${width - 16}px`);
  if (direction === 'above') {
    expect(menu.style.top).toBe('auto');
    expect(menu.style.bottom).toBe(`${height - rect.top + 4}px`);
    expect(menu.style.maxHeight).toBe(`${rect.top - 12}px`);
  } else {
    expect(menu.style.bottom).toBe('auto');
    expect(menu.style.top).toBe(`${rect.bottom + 4}px`);
    expect(menu.style.maxHeight).toBe(`${height - rect.bottom - 12}px`);
  }
});

test('all three action dropdowns use viewport positioning after mounting', () => {
  const calls = /appendChild\(dropdown\);\s*positionSessionMenu\(dropdown, btn(?:, true)?\);/g;
  expect(read(path.join('modules', 'model-catalog.js')).match(calls)).toHaveLength(2);
  expect(read('app.js').match(calls)).toHaveLength(1);
  const css = read('styles.css');
  expect(css).toMatch(/\.session-actions\s*\{[^}]*flex-wrap: wrap;/);
  expect(css).toMatch(/\.session-actions \.model-dropdown\s*\{[^}]*overflow: auto;/);
  expect(css).toMatch(/\.session-actions \.model-dropdown__submenu\s*\{[^}]*position: fixed;/);
});

/* global window, document */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const raw = 'Erklärung\n\n```agent-desktop-question\n{"question":"Weiter?","options":["Ja","<b>Nein</b>"]}\n```';
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });

test.beforeEach(async ({ page }) => {
  await page.setContent('<main><span id="status"></span></main><textarea id="chatInput">Entwurf</textarea><div id="chatInputRich"></div>');
  await page.addScriptTag({ content: read('src/chat-question.js') });
  await page.evaluate(() => {
    window.markdown = { render: text => { const el = document.createElement('p'); el.textContent = text; return el.outerHTML; }, renderFast: text => text };
    window.tab = { streamEl: document.querySelector('main'), statusEl: document.querySelector('#status'), activeSkills: new Set(), isProcessing: false };
    window.tabs = new Map([[1, window.tab]]);
    window.activeTabId = 1;
    window.richTextMode = false;
    window.RESIZE_FIT_DELAY_MS = 1;
    window.inputHistory = [];
    window.historyIndex = -1;
    window.historySavedInput = '';
    window.getTabProvider = tab => tab.provider || 'anthropic';
    window.getActiveSkillDefinitions = () => [];
    window.activeAgents = new Set();
    window.getSettings = () => ({});
    window.isClaudeCodeProvider = () => false;
    window.isSubscriptionProvider = () => false;
    window.refreshUsageDisplay = async () => {};
    window.refreshContextDisplay = () => {};
    window.DEFAULT_MODEL_ID = 'fixture';
    window.DEFAULT_MODE_ID = 'agent';
    window.getDeniedTools = () => [];
    window.getEffectiveExtraDirs = () => [];
    window.getProviderBaseUrl = () => '';
    for (const name of ['setTabStatus', 'startInactivityMonitor', 'stopInactivityMonitor', 'scrollToBottom', 'pruneOldMessages', 'handleSendResult']) window[name] = () => {};
    window.formatMessageTime = () => '';
    window.calls = [];
    window.desktop = { chat: {
      send: (...args) => { window.calls.push(args); return Promise.resolve({ success: true }); },
      onEvent: fn => { window.event = fn; }, onDone: fn => { window.done = fn; },
    } };
  });
  await page.addScriptTag({ content: read('renderer/modules/chat-question.js') });
  const app = read('renderer/app.js');
  await page.addScriptTag({ content: app.slice(app.indexOf('async function sendMessage('), app.indexOf('/**\n * Handle the result of desktop.chat.send')) });
  await page.addScriptTag({ content: read('renderer/modules/agent-ipc.js') });
  await page.addScriptTag({ content: read('renderer/modules/sessions-sidebar.js') });
  await page.evaluate(() => window.initAgentIPC());
});

test('stream only becomes interactive on done; safe text, send once, keep draft', async ({ page }) => {
  await page.evaluate(raw => {
    window.tab.isProcessing = true;
    window.event(1, { type: 'assistant.message_delta', data: { deltaContent: raw } });
    window.event(1, { type: 'assistant.message', data: { content: raw } });
  }, raw);
  await expect(page.locator('.chat-question button')).toHaveCount(0);
  await page.evaluate(() => window.done(1, 0));
  await expect(page.locator('.chat-question button')).toHaveCount(2);
  await expect(page.locator('.chat-question b')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ja', exact: true }).evaluate(button => { button.click(); button.click(); });
  expect(await page.evaluate(() => window.calls.map(args => args.slice(0, 2)))).toEqual([[1, 'Ja']]);
  await expect(page.getByRole('button', { name: 'Ja', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#chatInput')).toHaveValue('Entwurf');
  await expect(page.locator('.chat-question button').last()).toBeDisabled();
});

test('wrong/deleted tab never sends; free reply disables; history stays answered', async ({ page }) => {
  await page.evaluate(raw => {
    const el = document.createElement('div');
    window.tab.streamEl.prepend(el);
    window.chatQuestions.render(el, raw, window.tab);
    window.activeTabId = 2;
  }, raw);
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  expect(await page.evaluate(() => window.calls.length)).toBe(0);
  await page.evaluate(() => { window.activeTabId = 1; window.tabs.delete(1); });
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  expect(await page.evaluate(() => window.calls.length)).toBe(0);
  await page.evaluate(() => { window.tabs.set(1, window.tab); return window.sendMessage(); });
  await expect(page.locator('.chat-question button').first()).toBeDisabled();
  await page.evaluate(raw => {
    window.tab.streamEl.replaceChildren(window.tab.statusEl);
    window.tab.isProcessing = false;
    window.renderSimpleHistory([{ role: 'assistant', content: raw }, { role: 'user', content: 'Ja' }],
      el => window.tab.streamEl.prepend(el), window.tab);
  }, raw);
  await expect(page.locator('.chat-question button').first()).toBeDisabled();
  await expect(page.locator('.chat-question button').first()).toHaveAttribute('aria-pressed', 'true');
});

test('tab switch during native skill verification cancels answer without consuming it', async ({ page }) => {
  await page.evaluate(raw => {
    window.tab.provider = 'copilot';
    window.tab.activeSkills.add('skill');
    window.desktop.context = { listSkills: () => new Promise(resolve => { window.finishSkills = resolve; }) };
    const el = document.createElement('div');
    window.tab.streamEl.prepend(el);
    window.chatQuestions.render(el, raw, window.tab);
  }, raw);
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  await page.evaluate(() => { window.activeTabId = 2; window.finishSkills([]); });
  await expect(page.getByRole('button', { name: 'Ja', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.calls.length)).toBe(0);
});

test('aborted and incomplete responses never turn into buttons, including later empty turns', async ({ page }) => {
  await page.evaluate(raw => {
    window.event(1, { type: 'assistant.message_delta', data: { deltaContent: raw } });
    window.done(1, -1);
    window.done(1, 0);
  }, raw);
  await expect(page.locator('.chat-question')).toHaveCount(0);
  await page.evaluate(raw => {
    window.event(1, { type: 'assistant.message_delta', data: { deltaContent: raw.slice(0, -2) } });
    window.done(1, 0);
  }, raw);
  await expect(page.locator('.chat-question')).toHaveCount(0);
});

test('API history and narrow layout keep safe, disabled selected buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addStyleTag({ content: read('renderer/styles.css') });
  await page.evaluate(raw => {
    window.renderApiHistory([
      { role: 'assistant', content: [{ type: 'text', text: raw }] },
      { role: 'user', content: [{ type: 'text', text: '<b>Nein</b>' }] },
    ], el => window.tab.streamEl.insertBefore(el, window.tab.statusEl), window.tab);
  }, raw);
  await expect(page.getByRole('button', { name: '<b>Nein</b>', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '<b>Nein</b>', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('final-only messages work but tool commentary is not an actionable question', async ({ page }) => {
  await page.evaluate(raw => {
    window.event(1, { type: 'assistant.message', data: { content: raw } });
    window.event(1, { type: 'tool.execution_start', data: { toolName: 'report_intent', arguments: { intent: 'Working' } } });
    window.done(1, 0);
  }, raw);
  await expect(page.locator('.chat-question')).toHaveCount(0);
  await page.evaluate(raw => {
    window.event(1, { type: 'assistant.message', data: { content: raw } });
    window.done(1, 0);
  }, raw);
  await expect(page.locator('.chat-question button')).toHaveCount(2);
});

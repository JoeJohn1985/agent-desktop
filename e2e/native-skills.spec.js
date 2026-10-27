/* global window, document */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
test('standard native toggles work without a chat, disable matching names and display failures', async ({ page }) => {
  await page.setContent('<div id="skillsContext"></div><div id="skillList"></div><div id="notification"></div>');
  await page.addStyleTag({ path: path.join(__dirname, '..', 'renderer', 'styles.css') });
  await page.evaluate(() => {
    window.tabs = new Map();
    window.getConnectedProviders = async () => ['copilot', 'claude-code'].map(id => ({ id, label: id }));
    window.activeTabId = null;
    window.escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    window.escapeAttr = window.escapeHtml;
    window.emptyStateHtml = (_icon, message) => window.escapeHtml(message);
    window.showNotification = message => { document.getElementById('notification').textContent = message; };
    let enabled = true;
    window.desktop = { context: {
      listGlobalSkills: async () => [
        { providers: ['copilot'], native: true, directory: 'one', skills: [{ id: 'one', name: 'same', enabled }] },
        { providers: ['copilot'], native: true, directory: 'two', skills: [{ id: 'two', name: 'same', enabled }] },
        { providers: ['claude-code'], directory: 'claude', skills: [{ id: 'claude', name: 'same' }] },
      ],
      setGlobalSkillEnabled: async (_provider, _identity, value) => { enabled = value; },
    } };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'renderer', 'modules', 'skills-mcp.js') });
  await page.evaluate('loadGlobalSkills()');
  const toggles = page.locator('.settings__toggle input[type="checkbox"][data-native-skill]');
  await expect(toggles).toHaveCount(2);
  await expect(toggles.first()).toHaveAccessibleName('same: Aktiv · Deaktivieren');
  await expect(toggles.first()).toBeChecked();
  await toggles.first().focus();
  await page.keyboard.press('Space');
  await expect(toggles.first()).not.toBeChecked();
  await expect(toggles.last()).not.toBeChecked();
  await expect(page.locator('[data-unsupported-skill]')).toHaveAccessibleName('same: Status unbekannt');
  await page.locator('.settings__toggle-slider').first().click();
  await expect(toggles.first()).toBeChecked();
  await expect(toggles.last()).toBeChecked();
  await page.evaluate(() => { window.desktop.context.setGlobalSkillEnabled = async () => { throw new Error('native refusal'); }; });
  await page.locator('.settings__toggle-slider').first().click();
  await expect(page.locator('#notification')).toContainText('native refusal');
  await expect(toggles.first()).toBeEnabled();
  await expect(toggles.first()).toBeChecked();
  await page.evaluate(() => {
    window.desktop.context.setGlobalSkillEnabled = () => new Promise(() => {});
  });
  await page.locator('.settings__toggle-slider').first().click();
  await expect(toggles.first()).toBeDisabled();
  await expect(toggles.last()).toBeDisabled();
});

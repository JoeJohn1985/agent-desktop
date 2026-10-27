/* global window */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
test('provider skill tiles use responsive three, two and one column without overflow', async ({ page }) => {
  await page.setContent('<div class="functions-view functions-view--compact"><div id="skillsContext"></div><div id="skillList" class="functions-view__skills"></div></div>');
  await page.addStyleTag({ path: path.join(__dirname, '..', 'renderer', 'styles.css') });
  await page.evaluate(() => {
    window.getConnectedProviders = async () => ['copilot', 'claude-code'].map(id => ({ id, label: id }));
    window.escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    window.escapeAttr = window.escapeHtml;
    window.emptyStateHtml = (_icon, message) => window.escapeHtml(message);
    window.desktop = { context: { listGlobalSkills: async () => ['copilot', 'claude-code'].map(provider => ({
      providers: [provider], directory: 'source-' + 'long'.repeat(80), native: provider === 'copilot',
      skills: Array.from({ length: 7 }, (_, i) => ({
        id: `${provider}-${i}`, name: `Skill ${i} ` + 'long'.repeat(40),
        description: 'description'.repeat(50), icon: '🧩', enabled: i === 0,
      })),
    })) } };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'renderer', 'modules', 'skills-mcp.js') });
  await page.evaluate('loadGlobalSkills()');
  for (const [width, columns] of [[1600, 3], [1000, 3], [700, 2], [360, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('.functions-view__skill-provider').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const grid = node.querySelector('.functions-view__skill-grid');
      return {
        top: rect.top, bottom: rect.bottom, width: rect.width,
        columns: window.getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        cards: [...grid.children].map(card => {
          const r = card.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, width: r.width };
        }),
      };
    }));
    expect(layout[1].top).toBeGreaterThanOrEqual(layout[0].bottom);
    expect(layout[1].width).toBe(layout[0].width);
    for (const provider of layout) {
      expect(provider.columns).toBe(columns);
      expect(provider.cards).toHaveLength(7);
      for (const card of provider.cards) {
        expect(card.left).toBeGreaterThanOrEqual(0);
        expect(card.right).toBeLessThanOrEqual(width);
        expect(card.width).toBeCloseTo(provider.cards[0].width, 0);
      }
      expect(provider.cards[columns].top).toBeGreaterThan(provider.cards[0].top);
    }
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await expect(page.locator('[data-unsupported-skill]')).toHaveCount(7);
  await expect(page.locator('[data-unsupported-skill]').first()).toBeDisabled();
  await expect(page.locator('[data-native-skill]').first()).toBeChecked();
  await expect(page.locator('#skillList')).not.toContainText('Native Aktivierung nicht verfügbar');
});

test('all provider groups and shared sources use honest standard toggles', async ({ page }) => {
  await page.setContent('<div id="skillsContext"></div><div id="skillList"></div>');
  await page.addStyleTag({ path: path.join(__dirname, '..', 'renderer', 'styles.css') });
  await page.evaluate(() => {
    window.tabs = new Map();
    window.getConnectedProviders = async () => ['copilot', 'claude-code', 'anthropic', 'openai', 'ollama', 'glm', 'gemini', 'claude-code-ssh'].map(id => ({ id, label: id }));
    window.activeTabId = null;
    window.escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    window.escapeAttr = window.escapeHtml;
    window.emptyStateHtml = (_icon, message) => window.escapeHtml(message);
    window.desktop = { context: { listGlobalSkills: async () => [
      { providers: ['copilot'], native: true, directory: 'native', skills: [
        { id: 'on', name: 'Enabled', enabled: true }, { id: 'off', name: 'Disabled', enabled: false },
      ] },
      ...['claude-code', 'anthropic', 'openai', 'ollama', 'glm'].map(provider => ({
        providers: [provider], directory: provider, skills: [{ id: provider, name: provider }],
      })),
      { providers: ['copilot', 'claude-code'], directory: 'shared', skills: [{ name: 'Shared' }] },
      { providers: ['gemini'], directory: 'empty', skills: [] },
      { providers: ['claude-code-ssh'], directory: 'error', skills: [], error: 'unavailable' },
    ] } };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'renderer', 'modules', 'skills-mcp.js') });
  await page.evaluate('loadGlobalSkills()');
  await expect(page.locator('.skill-card > .settings__toggle')).toHaveCount(9);
  await expect(page.getByRole('checkbox', { name: 'Enabled: Aktiv · Deaktivieren', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Disabled: Deaktiviert · Aktivieren', exact: true })).not.toBeChecked();
  for (const name of ['claude-code', 'anthropic', 'openai', 'ollama', 'glm', 'Shared']) {
    const controls = page.getByRole('checkbox', { name: `${name}: Status unbekannt`, exact: true });
    for (const control of await controls.all()) {
      await expect(control).toBeDisabled();
      expect(await control.evaluate(input => input.indeterminate)).toBe(true);
      await expect(control).not.toHaveAttribute('data-native-skill');
    }
  }
  await expect(page.locator('#skillList')).toContainText('Geteilte Quelle');
  await expect(page.locator('#skillList')).toContainText('Keine benutzerweiten Skills');
  await expect(page.locator('#skillList')).toContainText('unavailable');
  const sections = await page.locator('.functions-view__skill-provider').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width };
  }));
  for (let i = 1; i < sections.length; i++) {
    expect(sections[i].top).toBeGreaterThanOrEqual(sections[i - 1].bottom);
    expect(sections[i].width).toBe(sections[0].width);
  }
  await page.evaluate('getConnectedProviders = async () => [{ id: "copilot", label: "Copilot" }]; loadGlobalSkills()');
  await expect(page.locator('[data-skill-provider]')).toHaveCount(1);
  await page.evaluate('getConnectedProviders = async () => []; loadGlobalSkills()');
  await expect(page.locator('[data-skill-provider]')).toHaveCount(0);
});

test('global management without chat, tab switching, errors and session selection', async ({ page }) => {
  await page.setContent('<div id="skillsContext"></div><div id="skillList"></div>');
  await page.evaluate(() => {
    window.tabs = new Map();
    window.getConnectedProviders = async () => ['copilot', 'claude-code'].map(id => ({ id, label: id }));
    window.activeTabId = null;
    window.getTabProvider = tab => tab?.provider || 'copilot';
    window.escapeHtml = value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    window.escapeAttr = window.escapeHtml;
    window.emptyStateHtml = (_icon, message) => window.escapeHtml(message);
    window.desktop = { context: {
      listGlobalSkills: async () => [
        { providers: ['copilot'], directory: 'user-copilot', skills: [{ name: 'Same' }] },
        { providers: ['claude-code'], directory: 'user-claude', skills: [{ name: 'Same' }] },
      ],
      listSkills: async () => [{ id: 'project', name: 'Project skill' }],
      listAgents: async () => [],
    } };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'renderer', 'modules', 'skills-mcp.js') });
  await page.evaluate('loadGlobalSkills()');
  await expect(page.locator('#skillList')).toContainText('copilot');
  await expect(page.locator('#skillList')).toContainText('claude-code');
  await expect(page.locator('#skillList .skill-card')).toHaveCount(2);
  await expect(page.locator('#skillList button')).toHaveCount(0);
  await page.evaluate(`tabs.set('a', { provider:'copilot', cwd:'A', activeSkills:new Set(['project']) });
    tabs.set('b', { provider:'claude-code', cwd:'B', activeSkills:new Set() });
    activeTabId='a'; loadContextForTab('copilot', 'A')`);
  await expect(page.locator('#skillList')).not.toContainText('Project skill');
  expect(await page.evaluate(`getActiveSkillDefinitions(tabs.get('a')).length`)).toBe(1);
  await page.evaluate(`activeTabId='b'; reloadSkills()`);
  expect(await page.evaluate(`tabs.get('a').activeSkills.has('project')`)).toBe(true);
  await expect(page.locator('#skillList .skill-card')).toHaveCount(2);
  await page.evaluate(`desktop.context.listGlobalSkills = async () => { throw new Error('fixture failure'); }; loadGlobalSkills()`);
  await expect(page.locator('#skillList')).toContainText('fixture failure');
});

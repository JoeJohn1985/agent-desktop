/* global document, window */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const renderer = path.join(__dirname, '..', 'renderer');
// Static renderer only: no Electron, preload, provider or user-data access.
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<meta[^>]*Content-Security-Policy[^>]*>/g, '')
  .replace(/<link[^>]*>/g, '');
const css = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
const utils = fs.readFileSync(path.join(renderer, 'modules', 'utils.js'), 'utf8');
const costs = fs.readFileSync(path.join(renderer, 'modules', 'costs.js'), 'utf8');
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });

test('session skills: native toggles, synchronisation, keyboard and constrained scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    document.getElementById('appLoading').remove();
    window.RendererLogic = {};
    window.tabs = new Map([['a', { provider: 'copilot', activeSkills: new Set() }],
      ['b', { provider: 'copilot', activeSkills: new Set() }]]);
    window.activeTabId = 'a';
    window.getTabProvider = tab => tab?.provider || 'copilot';
    window.emptyStateHtml = (_icon, message) => message;
    window.desktop = { context: { listGlobalSkills: async () => [] } };
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(renderer, '..', 'src', 'renderer-logic.js'), 'utf8') });
  await page.addScriptTag({ content: utils });
  await page.addScriptTag({ content: fs.readFileSync(path.join(renderer, 'modules', 'skills-mcp.js'), 'utf8') });
  await expect(page.locator('#btnSessionSkills')).toHaveText('🛠️ Skills (0)');
  await page.evaluate(`skills = Array.from({length: 70}, (_, i) => ({id: 's'+i, name: 'Skill '+i, icon: i === 0 ? '🚀' : i === 1 ? '<img src=x onerror=alert(1)>' : '', description: 'NOT IN MENU'})); initSessionSkills(); renderSkills();`);
  const button = page.locator('#btnSessionSkills');
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('#sessionSkillsDropdown');
  await expect(menu.getByRole('switch').first()).toBeFocused();
  await expect(menu).not.toContainText('NOT IN MENU');
  await expect(menu.getByRole('switch').first()).toHaveText('🚀 Skill 0');
  await expect(menu.getByRole('switch').nth(1)).toHaveText('<img src=x onerror=alert(1)> Skill 1');
  await expect(menu.locator('img')).toHaveCount(0);
  await expect(menu.getByRole('switch').nth(2)).toHaveText('🧩 Skill 2');
  await page.keyboard.press('Space');
  await expect(button).toHaveText('🛠️ Skills (1)');
  await expect(menu.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#skillList [data-skill-id="s0"]')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('switch').nth(1)).toBeFocused();
  const box = await menu.boundingBox();
  const anchor = await button.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(752);
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y - 3);
  expect(await menu.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(menu).toHaveCount(0);
  await button.click();
  await page.evaluate(`activeTabId = 'b'; renderSkills();`);
  await expect(button).toHaveText('🛠️ Skills (0)');
  await expect(menu.getByRole('switch').first()).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(`activeTabId = 'a'; renderSkills(); toggleSkill('s0');`);
  await expect(button).toHaveText('🛠️ Skills (0)');
  await page.locator('#sessionProvider').click();
  await expect(menu).toHaveCount(0);
  await button.click();
  await page.evaluate(`_skillsLoading = true; skills = []; renderSkills();`);
  await expect(menu.getByRole('status')).toContainText('geladen');
  await expect(menu.getByRole('switch')).toHaveCount(0);
  await page.evaluate(`_skillsLoading = false; _skillsLoadError = 'Fixture Fehler'; renderSkills();`);
  await expect(menu.getByRole('status')).toHaveText('Fixture Fehler');
  await page.evaluate(`_skillsLoadError = ''; renderSkills();`);
  await expect(menu.getByRole('status')).toContainText('Keine Skills');
  await page.evaluate(`activeTabId = null; renderSkills();`);
  await expect(menu).toHaveCount(0);
  await expect(button).toBeDisabled();
});

for (const theme of ['light', 'dark']) {
  for (const width of [760, 1200]) {
    test(`${theme}, ${width}px: input dock, scroll and menus stay visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.setContent(html);
      await page.addStyleTag({ content: css });
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        document.getElementById('appLoading').remove();
        window.RendererLogic = {};
        const stream = document.createElement('div');
        stream.className = 'stream-output stream-output--active';
        stream.innerHTML = '<p>Fixture message</p>'.repeat(100);
        document.getElementById('streamArea').appendChild(stream);
      }, theme);
      await page.addScriptTag({ content: utils });
      await page.evaluate(() => {
        window.getPref = () => true;
        window.costsOpened = 0;
        window.switchToCostsView = () => { window.costsOpened++; };
        document.getElementById('geminiModeWrapper').style.display = '';
      });
      await page.addScriptTag({ content: costs });
      await page.evaluate(() => { window.initCostsPanel(); });
      const usage = page.getByRole('button', { name: 'Heute: ~$0.00', exact: true });
      await expect(usage).toHaveAttribute('data-tooltip', 'Kostenübersicht öffnen');
      await usage.click();
      await usage.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      expect(await page.evaluate(() => window.costsOpened)).toBe(3);
      await expect(usage).toBeFocused();
      for (const id of ['sessionProvider', 'btnGeminiMode', 'btnContextInfo', 'sessionUsage']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const actions = await page.locator('#sessionActions').boundingBox();
      const input = await page.locator('.chat-input-bar').boundingBox();
      expect(actions.y + actions.height).toBeCloseTo(input.y, 0);
      expect(input.y + input.height).toBeLessThanOrEqual(720);
      expect(await page.locator('#sessionActions').evaluate(el => el.nextElementSibling.className)).toBe('chat-input-bar');
      await page.locator('.stream-output').evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect(await page.locator('#sessionActions').boundingBox()).toEqual(actions);

      for (const id of ['btnModelSelect', 'btnModeSelect', 'btnContextInfo']) {
        await page.evaluate(id => {
          const button = document.getElementById(id);
          const menu = document.createElement('div');
          menu.className = 'model-dropdown model-dropdown--below';
          menu.innerHTML = '<div class="model-dropdown__item">Fixture option</div>'.repeat(40);
          button.parentElement.appendChild(menu);
          window.positionSessionMenu(menu, button);
        }, id);
        const menu = page.locator('.model-dropdown');
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
        expect(box.y).toBeGreaterThanOrEqual(8);
        const button = await page.locator(`#${id}`).boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(button.y - 3);
        expect(await menu.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await expect(menu.locator('.model-dropdown__item').first()).toBeVisible();
        await menu.evaluate(el => el.remove());
      }
      await page.evaluate(() => {
        const button = document.getElementById('btnModelSelect');
        const menu = document.createElement('div');
        menu.className = 'model-dropdown model-dropdown--below';
        menu.innerHTML = '<div class="model-dropdown__item model-dropdown__item--has-submenu" tabindex="0">'
          + '<span>Fixture model</span><div class="model-dropdown__submenu">'
          + '<button class="model-dropdown__submenu-item">High</button></div></div>';
        button.parentElement.appendChild(menu);
        window.positionSessionMenu(menu, button);
        const item = menu.firstElementChild;
        item.addEventListener('mouseenter', () => window.positionSessionReasoningMenu(item.lastElementChild, menu, item));
        item.addEventListener('focusin', () => window.positionSessionReasoningMenu(item.lastElementChild, menu, item));
      });
      await page.locator('.model-dropdown__item').hover();
      const reasoning = page.locator('.model-dropdown__submenu-item');
      await expect(reasoning).toBeVisible();
      const reasoningBox = await reasoning.boundingBox();
      const modelBox = await page.locator('.model-dropdown').boundingBox();
      expect(reasoningBox.x >= modelBox.x + modelBox.width ||
        reasoningBox.x + reasoningBox.width <= modelBox.x).toBe(true);
      expect(reasoningBox.x).toBeGreaterThanOrEqual(8);
      expect(reasoningBox.x + reasoningBox.width).toBeLessThanOrEqual(width - 8);
      expect(reasoningBox.y).toBeGreaterThanOrEqual(8);
      await reasoning.click();
    });
  }

  for (const side of ['right', 'left', 'shift']) {
    test(`${theme}: reasoning panel opens ${side}, without overlap and with independent scrolling`, async ({ page }) => {
      const viewportWidth = side === 'shift' ? 360 : 760;
      await page.setViewportSize({ width: viewportWidth, height: 360 });
      await page.setContent(html);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: utils });
      await page.evaluate(({ side, theme }) => {
        document.documentElement.dataset.theme = theme;
        document.getElementById('appLoading').remove();
        const button = document.getElementById('btnModelSelect');
        const menu = document.createElement('div');
        menu.className = 'model-dropdown model-dropdown--below';
        menu.innerHTML = '<div class="model-dropdown__item model-dropdown__item--has-submenu" tabindex="0">'
          + '<span>Model</span><div class="model-dropdown__submenu">'
          + '<button class="model-dropdown__submenu-item">High</button>'.repeat(30)
          + '</div></div>' + '<div class="model-dropdown__item">Model</div>'.repeat(40);
        button.parentElement.appendChild(menu);
        window.positionSessionMenu(menu, button, true);
        menu.style.left = side === 'right' ? '20px' : side === 'left' ? '510px' : '100px';
        const item = menu.firstElementChild;
        const position = () => window.positionSessionReasoningMenu(item.lastElementChild, menu, item);
        item.addEventListener('mouseenter', position);
        item.addEventListener('focusin', position);
      }, { side, theme });
      await page.locator('.model-dropdown__item').first().focus();
      const model = await page.locator('.model-dropdown').boundingBox();
      const reasoning = await page.locator('.model-dropdown__submenu').boundingBox();
      expect(side === 'right' ? reasoning.x >= model.x + model.width :
        reasoning.x + reasoning.width <= model.x).toBe(true);
      for (const box of [model, reasoning]) {
        expect(box.x).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 8);
        expect(box.y).toBeGreaterThanOrEqual(8);
        expect(box.y + box.height).toBeLessThanOrEqual(
          (await page.locator('#btnModelSelect').boundingBox()).y - 3);
      }
      for (const selector of ['.model-dropdown', '.model-dropdown__submenu']) {
        expect(await page.locator(selector).evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      }
      await page.locator('.model-dropdown__submenu-item').first().hover();
      await expect(page.locator('.model-dropdown__submenu')).toBeVisible();
      await page.locator('.model-dropdown__submenu-item').first().click();
      await page.locator('.model-dropdown__submenu-item').last().focus();
      expect(await page.locator('.model-dropdown__submenu').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.locator('.model-dropdown').evaluate(el => el.scrollTop)).toBe(0);
    });
  }
}

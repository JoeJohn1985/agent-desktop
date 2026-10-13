/* global window, sessions, openSessionCardMenu, initMcpManager, renderMcpServers, openFunctionsView */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('isolated MCP management UI can add, edit, connect and remove servers without starting the app backend', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-mcp-ui-'));
  let app;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, 'fixtures', 'mcp-ui-app.js')],
      env: { ...process.env, APP_MCP_UI_PROFILE: profile },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      window.document.getElementById('appLoading').remove();
      window.tabs = new Map();
      window.activeTabId = null;
      window.getTabProvider = () => 'copilot';
      window.showNotification = () => {};
      let servers = [];
      let onChanged;
      const result = () => { onChanged?.(servers); return { success: true, servers }; };
      window.desktop = { mcp: {
        onChanged: callback => { onChanged = callback; },
        save: async input => {
          const server = { ...input, id: input.id || 'fixture-id', managed: true, bridgeName: 'agent-desktop-' + input.name, status: 'configured' };
          servers = input.id ? servers.map(s => s.id === input.id ? server : s) : [...servers, server];
          return result();
        },
        connect: async id => { servers = servers.map(s => s.id === id ? { ...s, status: 'connected' } : s); return result(); },
        disconnect: async () => result(),
        remove: async id => { servers = servers.filter(s => s.id !== id); return result(); },
      } };
    });
    for (const file of ['src\\renderer-logic.js', 'renderer\\modules\\utils.js', 'renderer\\modules\\skills-mcp.js', 'renderer\\modules\\sessions-sidebar.js', 'renderer\\modules\\mcp-manager.js', 'renderer\\modules\\functions.js']) {
      await page.addScriptTag({ path: path.join(__dirname, '..', file) });
    }
    await page.evaluate(() => { initMcpManager(); renderMcpServers(); openFunctionsView('connections'); });
    await page.locator('#btnMcpManager').click();
    await expect(page.locator('#mcpManagerOverlay')).toBeVisible();
    expect(await page.locator('.mcp-manager').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(600);
    await page.locator('#mcpServerName').fill('jira');
    await page.locator('#mcpServerUrl').fill('https://example.org/mcp');
    await page.locator('#mcpServerForm [type="submit"]').click();
    await expect(page.locator('#mcpManagedList strong')).toHaveText('jira');
    await expect(page.locator('[data-mcp-action]')).toHaveCount(0);
    const referenceStyles = await page.evaluate(() => {
      sessions.push({ id: 'reference', name: 'Reference' });
      openSessionCardMenu('reference', window.document.querySelector('#mcpManagedList [data-mcp-menu]'));
      const menu = window.document.querySelector('.section-menu[data-session-id="reference"]');
      const read = (element, fields) => {
        const style = window.getComputedStyle(element);
        return Object.fromEntries(fields.map(field => [field, style[field]]));
      };
      return {
        menu: read(menu, ['backgroundColor', 'borderRadius', 'boxShadow', 'padding', 'minWidth', 'maxWidth']),
        item: read(menu.querySelector('.section-menu__item'), ['fontFamily', 'fontSize', 'padding', 'color']),
        danger: window.getComputedStyle(menu.querySelector('.section-menu__item--danger')).color,
      };
    });
    await page.locator('#mcpManagerTitle').click();
    await expect(page.locator('.section-menu[data-session-id="reference"]')).toHaveCount(0);
    await page.locator('#mcpManagedList [data-mcp-menu]').click();
    await expect(page.locator('.mcp-server-menu')).toBeVisible();
    await expect(page.locator('[data-mcp-action="edit"]')).toHaveText('✏️ Bearbeiten');
    await expect(page.locator('[data-mcp-action="remove"]')).toHaveText('🗑️ Entfernen');
    const mcpStyles = await page.locator('.mcp-server-menu').evaluate(menu => {
      const read = (element, fields) => {
        const style = window.getComputedStyle(element);
        return Object.fromEntries(fields.map(field => [field, style[field]]));
      };
      return {
        menu: read(menu, ['backgroundColor', 'borderRadius', 'boxShadow', 'padding', 'minWidth', 'maxWidth']),
        item: read(menu.querySelector('[data-mcp-action="edit"]'), ['fontFamily', 'fontSize', 'padding', 'color']),
        danger: window.getComputedStyle(menu.querySelector('.section-menu__item--danger')).color,
      };
    });
    expect(mcpStyles).toEqual(referenceStyles);
    await page.locator('[data-mcp-action="connect"]').click();
    await expect(page.locator('#mcpManagedList > div > span')).toHaveText('verbunden');
    await page.locator('#btnMcpManagerClose').click();
    await page.locator('#mcpList [data-mcp-menu]').click();
    await expect(page.locator('[data-mcp-action="connect"]')).toBeDisabled();
    await expect(page.locator('[data-mcp-action="disconnect"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-mcp-action="edit"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mcp-server-menu')).toHaveCount(0);
    await expect(page.locator('#mcpList [data-mcp-menu]')).toBeFocused();
    await page.locator('#mcpList [data-mcp-menu]').click();
    await page.locator('[data-mcp-action="toggle"]').click();
    await page.locator('#mcpList [data-mcp-menu]').click();
    await expect(page.locator('[data-mcp-action="connect"]')).toBeDisabled();
    await expect(page.locator('[data-mcp-action="toggle"]')).toHaveText('▶️ Aktivieren');
    await page.locator('[data-mcp-action="toggle"]').click();
    await page.locator('#mcpList [data-mcp-menu]').click();
    await expect(page.locator('[data-mcp-action="connect"]')).toBeEnabled();
    await page.locator('#mcpList .mcp-card__name').click();
    await expect(page.locator('.mcp-server-menu')).toHaveCount(0);
    await page.locator('#mcpList [data-mcp-menu]').click();
    await page.locator('[data-mcp-action="edit"]').click();
    await expect(page.locator('#mcpManagerOverlay')).toBeVisible();
    await expect(page.locator('#mcpServerUrl')).toHaveValue('https://example.org/mcp');
    await page.locator('#mcpServerUrl').fill('https://example.org/updated');
    await page.locator('#mcpServerForm [type="submit"]').click();
    await expect(page.locator('#mcpManagedList .mcp-manager__server')).toHaveCount(1);
    await expect(page.locator('#mcpManagedList')).toContainText('https://example.org/updated');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#mcpManagedList [data-mcp-menu]').click();
    await page.locator('[data-mcp-action="remove"]').click();
    await expect(page.locator('#mcpManagedList')).toContainText('Noch keine');
    await page.locator('#btnMcpManagerClose').click();
    await expect(page.locator('#mcpManagerOverlay')).not.toBeVisible();
    await page.locator('#btnMcpManager').click();
    await page.locator('#mcpServerName').press('Escape');
    await expect(page.locator('#mcpManagerOverlay')).not.toBeVisible();
  } finally {
    if (app) await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

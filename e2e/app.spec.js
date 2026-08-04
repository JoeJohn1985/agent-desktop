/**
 * E2E Tests für Agent Desktop (Electron + Playwright).
 * Testet echte UI-Interaktionen: Fenster-Start, Tab-Management,
 * Theme-Wechsel, Sidebar, Settings, Terminal-Panel.
 */
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_PATH = path.resolve(__dirname, '..');
const TEST_PREFS_PATH = path.join(APP_PATH, 'preferences.test.json');

let electronApp;
let window;

test.beforeAll(async () => {
  // Remove stale test preferences to start clean
  if (fs.existsSync(TEST_PREFS_PATH)) fs.unlinkSync(TEST_PREFS_PATH);
  if (fs.existsSync(TEST_PREFS_PATH + '.bak')) fs.unlinkSync(TEST_PREFS_PATH + '.bak');

  electronApp = await electron.launch({
    args: [APP_PATH],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  // Wait for app to be fully loaded
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000); // extra settle time
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  // Clean up test preferences file
  if (fs.existsSync(TEST_PREFS_PATH)) fs.unlinkSync(TEST_PREFS_PATH);
  if (fs.existsSync(TEST_PREFS_PATH + '.bak')) fs.unlinkSync(TEST_PREFS_PATH + '.bak');
});

// ── App Start ────────────────────────────────────────────────

test.describe('App Start', () => {
  test('Fenster wird geöffnet', async () => {
    expect(window).toBeTruthy();
    const title = await window.title();
    expect(title).toBeTruthy();
  });

  test('HTML hat korrektes data-theme Attribut', async () => {
    const theme = await window.locator('html').getAttribute('data-theme');
    expect(['light', 'dark']).toContain(theme);
  });

  test('Sidebar ist sichtbar', async () => {
    const sidebar = window.locator('#sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('Chat-Input ist sichtbar', async () => {
    const input = window.locator('#chatInput');
    await expect(input).toBeVisible();
  });

  test('mindestens ein Tab ist geöffnet', async () => {
    const tabs = window.locator('#tabBar .tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ── Theme-Wechsel ────────────────────────────────────────────

test.describe('Theme-Wechsel', () => {
  test('Theme kann über Settings geändert werden', async () => {
    // Open settings
    const settingsBtn = window.locator('#btnSettings');
    await settingsBtn.click();
    await window.waitForTimeout(300);
    
    const themeBefore = await window.locator('html').getAttribute('data-theme');
    
    // Change theme via select
    const themeSelect = window.locator('#settTheme');
    await expect(themeSelect).toBeVisible();
    const nextTheme = themeBefore === 'dark' ? 'light' : 'dark';
    await themeSelect.selectOption(nextTheme);
    await window.waitForTimeout(200);
    
    const themeAfter = await window.locator('html').getAttribute('data-theme');
    expect(themeAfter).toBe(nextTheme);
    
    // Close settings
    await window.locator('#btnSettingsClose').click();
    await window.waitForTimeout(200);
  });

  test('Theme persistiert nach Wechsel (data-theme gesetzt)', async () => {
    const theme = await window.locator('html').getAttribute('data-theme');
    expect(['light', 'dark']).toContain(theme);
  });
});

// ── Tab-Management ───────────────────────────────────────────

test.describe('Tab-Management', () => {
  test('neuer Tab kann erstellt werden', async () => {
    const tabsBefore = await window.locator('#tabBar .tab').count();
    
    // Click "+" button (btnAddTab)
    const addBtn = window.locator('#btnAddTab');
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await window.waitForTimeout(500);
    
    const tabsAfter = await window.locator('#tabBar .tab').count();
    expect(tabsAfter).toBe(tabsBefore + 1);
  });

  test('Tab-Wechsel ändert aktiven Tab', async () => {
    const tabs = window.locator('#tabBar .tab');
    const count = await tabs.count();
    if (count < 2) return;
    
    // Click first tab
    await tabs.first().click();
    await window.waitForTimeout(200);
    
    const firstActive = await tabs.first().evaluate(el => el.classList.contains('tab--active'));
    expect(firstActive).toBe(true);
  });

  test('Tab kann geschlossen werden', async () => {
    const tabsBefore = await window.locator('#tabBar .tab').count();
    if (tabsBefore < 2) return;
    
    // Close last tab (hover to show close button)
    const lastTab = window.locator('#tabBar .tab').last();
    await lastTab.hover();
    const closeBtn = lastTab.locator('.tab__close');
    await closeBtn.click();
    await window.waitForTimeout(300);
    
    const tabsAfter = await window.locator('#tabBar .tab').count();
    expect(tabsAfter).toBe(tabsBefore - 1);
  });
});

// ── Sidebar ──────────────────────────────────────────────────

test.describe('Sidebar', () => {
  test('Sidebar kann collapsed werden', async () => {
    const collapseBtn = window.locator('#btnCollapseSidebar');
    await expect(collapseBtn).toBeVisible();
    
    await collapseBtn.click();
    await window.waitForTimeout(300);
    
    const sidebar = window.locator('#sidebar');
    const collapsed = await sidebar.evaluate(el => el.classList.contains('sidebar--collapsed'));
    expect(collapsed).toBe(true);
  });

  test('Sidebar kann wieder expandiert werden', async () => {
    const collapseBtn = window.locator('#btnCollapseSidebar');
    await collapseBtn.click();
    await window.waitForTimeout(300);
    
    const sidebar = window.locator('#sidebar');
    const collapsed = await sidebar.evaluate(el => el.classList.contains('sidebar--collapsed'));
    expect(collapsed).toBe(false);
  });

  test('Session-Suche ist sichtbar', async () => {
    const search = window.locator('#sessionSearch');
    await expect(search).toBeVisible();
  });
});

// ── Settings ─────────────────────────────────────────────────

test.describe('Settings', () => {
  test('Settings-Overlay kann geöffnet werden', async () => {
    const settingsBtn = window.locator('#btnSettings');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await window.waitForTimeout(300);
    
    const overlay = window.locator('#settingsOverlay');
    const visible = await overlay.evaluate(el => el.classList.contains('overlay--visible'));
    expect(visible).toBe(true);
  });

  test('Settings-Overlay kann geschlossen werden', async () => {
    const closeBtn = window.locator('#btnSettingsClose');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await window.waitForTimeout(300);
    
    const overlay = window.locator('#settingsOverlay');
    const visible = await overlay.evaluate(el => el.classList.contains('overlay--visible'));
    expect(visible).toBe(false);
  });
});

// ── Chat Input ───────────────────────────────────────────────

test.describe('Chat Input', () => {
  test('Text kann eingegeben werden', async () => {
    const input = window.locator('#chatInput');
    await input.click();
    await input.fill('Hello Test');
    
    const value = await input.inputValue();
    expect(value).toBe('Hello Test');
  });

  test('Input wächst bei mehrzeiligem Text', async () => {
    const input = window.locator('#chatInput');
    await input.click();
    
    const heightBefore = await input.evaluate(el => el.offsetHeight);
    await input.fill('Zeile 1\nZeile 2\nZeile 3\nZeile 4');
    await window.waitForTimeout(100);
    const heightAfter = await input.evaluate(el => el.offsetHeight);
    
    expect(heightAfter).toBeGreaterThanOrEqual(heightBefore);
  });

  test('Input kann geleert werden', async () => {
    const input = window.locator('#chatInput');
    await input.fill('');
    const value = await input.inputValue();
    expect(value).toBe('');
  });
});

// ── Terminal Panel ───────────────────────────────────────────

test.describe('Terminal Panel', () => {
  test('Terminal-Panel ist initial geschlossen', async () => {
    const panel = window.locator('#terminalPanel');
    const open = await panel.evaluate(el => el.classList.contains('terminal-panel--open'));
    expect(open).toBe(false);
  });

  test('Terminal kann über Button geöffnet werden', async () => {
    const openBtn = window.locator('#btnOpenTerminal');
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    await window.waitForTimeout(1500); // PTY spawn braucht Zeit

    const panel = window.locator('#terminalPanel');
    const open = await panel.evaluate(el => el.classList.contains('terminal-panel--open'));
    expect(open).toBe(true);
  });

  test('Terminal-Minimize-Button klappt Panel ein', async () => {
    const minimizeBtn = window.locator('#btnTerminalMinimize');
    await expect(minimizeBtn).toBeVisible();
    await minimizeBtn.click();
    await window.waitForTimeout(300);

    const panel = window.locator('#terminalPanel');
    const open = await panel.evaluate(el => el.classList.contains('terminal-panel--open'));
    expect(open).toBe(false);
  });

  test('nach Minimize: Tab-Wechsel und zurück → Terminal bleibt zu', async () => {
    // Erstelle zweiten Tab, wechsle hin und zurück
    const addBtn = window.locator('#btnAddTab');
    await addBtn.click();
    await window.waitForTimeout(500);

    // Wechsle zurück zum ersten Tab
    const firstTab = window.locator('#tabBar .tab').first();
    await firstTab.click();
    await window.waitForTimeout(300);

    const panel = window.locator('#terminalPanel');
    const open = await panel.evaluate(el => el.classList.contains('terminal-panel--open'));
    expect(open).toBe(false); // Bug-Regression-Test!

    // Cleanup: zweiten Tab schließen
    const lastTab = window.locator('#tabBar .tab').last();
    await lastTab.hover();
    const closeBtn = lastTab.locator('.tab__close');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await window.waitForTimeout(200);
    }
  });
});

// ── Context Buttons ──────────────────────────────────────────

test.describe('Context Buttons', () => {
  test('Kontext-Button existiert und ist klickbar', async () => {
    const btn = window.locator('#btnSlashContext');
    await expect(btn).toBeVisible();
    await btn.click();
    await window.waitForTimeout(500);

    // Context-Popup wird sichtbar (display != none)
    const popup = window.locator('#contextPopup');
    const display = await popup.evaluate(el => el.style.display);
    expect(display).not.toBe('none');
  });

  test('Context-Popup kann durch erneuten Klick geschlossen werden', async () => {
    const btn = window.locator('#btnSlashContext');
    await btn.click();
    await window.waitForTimeout(300);

    const popup = window.locator('#contextPopup');
    const display = await popup.evaluate(el => el.style.display);
    expect(display).toBe('none');
  });

  test('Compact-Button existiert', async () => {
    const btn = window.locator('#btnSlashCompact');
    await expect(btn).toBeVisible();
  });

  test('Clear-Button existiert', async () => {
    const btn = window.locator('#btnSlashClear');
    await expect(btn).toBeVisible();
  });
});

// ── Session Umbenennen ───────────────────────────────────────

test.describe('Session Umbenennen (Tab-Rename)', () => {
  test('Pencil-Button ✎ öffnet Rename-Input', async () => {
    const tab = window.locator('#tabBar .tab').first();
    await tab.hover();
    await window.waitForTimeout(200);

    const editBtn = tab.locator('.tab__edit');
    await editBtn.click();
    await window.waitForTimeout(300);

    const renameInput = window.locator('.tab__rename-input');
    await expect(renameInput).toBeVisible();

    // Abbrechen
    await renameInput.press('Escape');
    await window.waitForTimeout(200);
  });

  test('Escape bricht Umbenennen ab', async () => {
    // Öffne Rename via Pencil
    const tab = window.locator('#tabBar .tab').first();
    await tab.hover();
    await tab.locator('.tab__edit').click();
    await window.waitForTimeout(300);

    const renameInput = window.locator('.tab__rename-input');
    if (await renameInput.isVisible()) {
      await renameInput.press('Escape');
      await window.waitForTimeout(200);
    }
    // Input sollte weg sein
    const count = await window.locator('.tab__rename-input').count();
    expect(count).toBe(0);
  });

  test('Tab kann umbenannt werden (Enter bestätigt)', async () => {
    // Öffne Rename via Pencil
    const tab = window.locator('#tabBar .tab').first();
    await tab.hover();
    await tab.locator('.tab__edit').click();
    await window.waitForTimeout(300);

    const renameInput = window.locator('.tab__rename-input');
    await expect(renameInput).toBeVisible();

    await renameInput.fill('E2E Test Session');
    await renameInput.press('Enter');
    await window.waitForTimeout(500);

    // Label sollte den neuen Namen enthalten
    const label = window.locator('#tabBar .tab').first().locator('.tab__label');
    const text = await label.textContent();
    expect(text).toContain('E2E Test Session');
  });
});

// ── Window Controls ──────────────────────────────────────────

test.describe('Window Controls', () => {
  test('Minimize-Button existiert', async () => {
    const btn = window.locator('#btnWindowMinimize');
    await expect(btn).toBeVisible();
  });

  test('Maximize-Button existiert', async () => {
    const btn = window.locator('#btnWindowMaximize');
    await expect(btn).toBeVisible();
  });

  test('Close-Button existiert', async () => {
    const btn = window.locator('#btnWindowClose');
    await expect(btn).toBeVisible();
  });
});

/**
 * UI-Tests für Plugin Manager (renderPlugins, renderPluginTile, Suchfilter)
 *
 * WICHTIG: Keine echten Plugins werden installiert. Alle IPC-Calls gemockt.
 * 
 * Strategie: Da renderer/app.js ein Browser-Script ohne module.exports ist,
 * extrahieren wir die zu testenden Funktionen (renderPluginTile, renderPlugins)
 * und ihre Abhängigkeiten (escapeHtml, escapeAttr) in den Test-Scope.
 * Das entspricht dem Pattern aus ui-state-machine.test.js (isolierte Logik-Tests).
 *
 * Da kein jsdom verfügbar ist (testEnvironment: node), nutzen wir einen
 * minimalen DOM-Mock für renderPlugins-Tests und reine String-Tests für Tiles.
 */

const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

// ── Minimal DOM Mock (kein jsdom nötig) ──────────────────────

class MockElement {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
  }
  querySelector(sel) {
    // Very basic: search by class in innerHTML
    if (this.innerHTML.includes(sel.replace('.', 'class="').replace('.', ''))) return new MockElement('div');
    return null;
  }
}

function createMockDocument() {
  const elements = {};
  return {
    _elements: elements,
    getElementById(id) {
      return elements[id] || null;
    },
    _setup() {
      elements['pluginList'] = new MockElement('div', 'pluginList');
      elements['pluginSidebar'] = new MockElement('nav', 'pluginSidebar');
      elements['pluginSearch'] = new MockElement('input', 'pluginSearch');
      elements['pluginSearch'].value = '';
      elements['pluginCount'] = new MockElement('span', 'pluginCount');
    }
  };
}

let mockDoc;

// ── Extrahierte Funktionen aus renderer/app.js ───────────────

let installedPlugins = [];
let marketplaces = [];

function getPluginStatus(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  if (!installed) return 'not-installed';
  return installed.updateAvailable ? 'update-available' : 'installed';
}

function getInstalledVersion(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  return installed ? installed.version : '';
}

function renderPluginTile(plugin, status, target) {
  const version = getInstalledVersion(plugin.name) || plugin.version || '';
  const desc = plugin.description || '';
  const author = plugin.author || '';
  const name = plugin.name || '';

  let badgeHtml = '';
  if (status === 'installed') {
    badgeHtml = `<span class="plugin-tile__badge plugin-tile__badge--installed">✓ Installiert</span>`;
  } else if (status === 'update-available') {
    badgeHtml = `<span class="plugin-tile__badge plugin-tile__badge--update">● Update</span>`;
  }

  let actionsHtml = '';
  if (status === 'not-installed') {
    actionsHtml = `<button class="plugin-btn plugin-btn--install" onclick="installPlugin('${escapeAttr(target)}')">Installieren</button>`;
  } else if (status === 'installed') {
    actionsHtml = `<button class="plugin-btn plugin-btn--remove" onclick="uninstallPlugin('${escapeAttr(name)}')">Entfernen</button>`;
  } else if (status === 'update-available') {
    actionsHtml = `<button class="plugin-btn plugin-btn--update-available" onclick="updatePlugin('${escapeAttr(name)}')">Updaten</button>`;
    actionsHtml += `<button class="plugin-btn plugin-btn--remove" onclick="uninstallPlugin('${escapeAttr(name)}')">✕</button>`;
  }

  const meta = [author ? `👤 ${escapeHtml(author)}` : '', version ? `v${escapeHtml(version)}` : ''].filter(Boolean).join(' · ');

  return `<div class="plugin-tile plugin-tile--${status}" data-plugin="${escapeAttr(name)}">
    <div class="plugin-tile__top">
      <span class="plugin-tile__icon">🧩</span>
      <div class="plugin-tile__title-area">
        <span class="plugin-tile__name">${escapeHtml(name)}</span>
        ${badgeHtml}
      </div>
    </div>
    <div class="plugin-tile__desc">${desc ? escapeHtml(desc) : '<span class="plugin-tile__no-desc">Keine Beschreibung</span>'}</div>
    ${meta ? `<div class="plugin-tile__meta">${meta}</div>` : ''}
    <div class="plugin-tile__actions">${actionsHtml}</div>
  </div>`;
}

function renderPlugins() {
  const container = mockDoc.getElementById('pluginList');
  const sidebar = mockDoc.getElementById('pluginSidebar');
  if (!container) return;

  const searchEl = mockDoc.getElementById('pluginSearch');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

  function matchesQuery(plugin) {
    if (!query) return true;
    return (plugin.name || '').toLowerCase().includes(query) ||
           (plugin.description || '').toLowerCase().includes(query) ||
           (plugin.author || '').toLowerCase().includes(query);
  }

  if (marketplaces.length === 0 && installedPlugins.length === 0) {
    container.innerHTML = `
      <div class="plugin-empty-state">
        <div class="plugin-empty-state__icon">🧩</div>
        <div class="plugin-empty-state__title">Keine Marketplaces konfiguriert</div>
        <div class="plugin-empty-state__desc">Füge einen Marketplace hinzu um Plugins zu entdecken.</div>
        <button class="plugin-btn plugin-btn--install" onclick="document.getElementById('btnAddPlugin').click()">+ Marketplace hinzufügen</button>
      </div>`;
    if (sidebar) sidebar.innerHTML = '';
    return;
  }

  let html = '';
  let sidebarHtml = '';

  const visibleInstalled = installedPlugins.filter(matchesQuery);
  const installedSectionId = 'plugin-section-installed';
  sidebarHtml += `<div class="plugins-sidebar__item ${visibleInstalled.length > 0 ? '' : 'plugins-sidebar__item--empty'}" onclick="document.getElementById('${installedSectionId}').scrollIntoView({behavior:'smooth'})">
    <span class="plugins-sidebar__icon">✓</span>
    <span class="plugins-sidebar__label">Installiert</span>
    <span class="plugins-sidebar__badge">${installedPlugins.length}</span>
  </div>`;

  html += `<section class="plugin-section" id="${installedSectionId}">`;
  html += `<div class="plugin-section__header">`;
  html += `<h3 class="plugin-section__title">Installierte Plugins</h3>`;
  html += `<span class="plugin-section__count">${installedPlugins.length}</span>`;
  html += `</div>`;

  if (visibleInstalled.length > 0) {
    html += `<div class="plugin-grid">`;
    for (const plugin of visibleInstalled) {
      const version = plugin.version || '';
      html += renderPluginTile({ name: plugin.name, version, description: '', author: '' }, 'installed', '');
    }
    html += `</div>`;
  } else if (installedPlugins.length === 0) {
    html += `<div class="plugin-section__empty">Noch keine Plugins installiert.</div>`;
  } else {
    html += `<div class="plugin-section__empty">Keine Ergebnisse für „${escapeHtml(query)}"</div>`;
  }
  html += `</section>`;

  for (let i = 0; i < marketplaces.length; i++) {
    const mp = marketplaces[i];
    const sectionId = `plugin-section-mp-${i}`;
    const mpParts = (mp.marketplace || '').split('/');
    const mpDisplayName = mpParts[mpParts.length - 1] || mp.marketplace;
    const mpSubtitle = mp.marketplace || '';
    const filteredPlugins = (mp.plugins || []).filter(matchesQuery);
    const totalCount = (mp.plugins || []).length;

    sidebarHtml += `<div class="plugins-sidebar__item" onclick="document.getElementById('${sectionId}').scrollIntoView({behavior:'smooth'})">
      <span class="plugins-sidebar__icon">🏪</span>
      <span class="plugins-sidebar__label">${escapeHtml(mpDisplayName)}</span>
      <span class="plugins-sidebar__badge">${totalCount}</span>
    </div>`;

    html += `<section class="plugin-section" id="${sectionId}">`;
    html += `<div class="plugin-section__header">`;
    html += `<div class="plugin-section__header-text">`;
    html += `<h3 class="plugin-section__title">${escapeHtml(mpDisplayName)}</h3>`;
    html += `<span class="plugin-section__subtitle">${escapeHtml(mpSubtitle)}</span>`;
    html += `</div>`;
    html += `<span class="plugin-section__count">${totalCount}</span>`;
    html += `<button class="plugin-section__remove-btn" onclick="removeMarketplace('${escapeAttr(mp.name || mp.marketplace)}')" title="Marketplace entfernen">✕</button>`;
    html += `</div>`;

    if (mp.error) {
      html += `<div class="plugin-section__error">⚠️ ${escapeHtml(mp.error)}</div>`;
    }

    if (filteredPlugins.length > 0) {
      html += `<div class="plugin-grid">`;
      for (const plugin of filteredPlugins) {
        const status = getPluginStatus(plugin.name);
        const target = `${escapeAttr(plugin.name)}@${escapeAttr(mp.marketplace)}`;
        html += renderPluginTile(plugin, status, target);
      }
      html += `</div>`;
    } else if (totalCount > 0) {
      html += `<div class="plugin-section__empty">Keine Ergebnisse für „${escapeHtml(query)}"</div>`;
    } else if (!mp.error) {
      html += `<div class="plugin-section__empty">Keine Plugins in diesem Marketplace.</div>`;
    }

    html += `</section>`;
  }

  container.innerHTML = html;
  if (sidebar) sidebar.innerHTML = sidebarHtml;
}

// ── Setup ────────────────────────────────────────────────────

beforeEach(() => {
  installedPlugins = [];
  marketplaces = [];
  mockDoc = createMockDocument();
  mockDoc._setup();
});

// ── renderPluginTile ─────────────────────────────────────────

describe('renderPluginTile', () => {

  test('not-installed Plugin enthält Plugin-Name und Installieren-Button', () => {
    const html = renderPluginTile(
      { name: 'my-plugin', version: '1.0.0', description: 'Test Plugin', author: 'Autor' },
      'not-installed',
      'my-plugin@github/test'
    );

    expect(html).toContain('my-plugin');
    expect(html).toContain('Installieren');
    expect(html).toContain('plugin-btn--install');
    expect(html).not.toContain('✓ Installiert');
  });

  test('installed Plugin enthält Badge und Entfernen-Button', () => {
    installedPlugins = [{ name: 'my-plugin', version: '2.0.0' }];
    const html = renderPluginTile(
      { name: 'my-plugin', version: '1.0.0', description: 'Desc', author: '' },
      'installed',
      ''
    );

    expect(html).toContain('✓ Installiert');
    expect(html).toContain('plugin-tile__badge--installed');
    expect(html).toContain('Entfernen');
    expect(html).toContain('plugin-btn--remove');
    expect(html).not.toContain('Installieren');
  });

  test('update-available Plugin enthält Update Badge und Updaten/Entfernen-Buttons', () => {
    installedPlugins = [{ name: 'my-plugin', version: '1.0.0', updateAvailable: true }];
    const html = renderPluginTile(
      { name: 'my-plugin', version: '2.0.0', description: '', author: '' },
      'update-available',
      ''
    );

    expect(html).toContain('● Update');
    expect(html).toContain('plugin-tile__badge--update');
    expect(html).toContain('Updaten');
    expect(html).toContain('plugin-btn--update-available');
    expect(html).toContain('✕'); // Remove-Button
  });

  test('zeigt Beschreibung und Author korrekt an', () => {
    const html = renderPluginTile(
      { name: 'fancy-plugin', version: '1.0.0', description: 'Eine tolle Beschreibung', author: 'Max Mustermann' },
      'not-installed',
      'fancy-plugin@test'
    );

    expect(html).toContain('Eine tolle Beschreibung');
    expect(html).toContain('👤 Max Mustermann');
  });

  test('zeigt Placeholder wenn keine Beschreibung vorhanden', () => {
    const html = renderPluginTile(
      { name: 'no-desc-plugin', version: '1.0.0', description: '', author: '' },
      'not-installed',
      'no-desc-plugin@test'
    );

    expect(html).toContain('Keine Beschreibung');
    expect(html).toContain('plugin-tile__no-desc');
  });

  test('setzt data-plugin Attribut korrekt', () => {
    const html = renderPluginTile(
      { name: 'attr-test', version: '1.0.0', description: '', author: '' },
      'not-installed',
      'attr-test@test'
    );

    expect(html).toContain('data-plugin="attr-test"');
  });

  test('setzt CSS-Klasse passend zum Status', () => {
    const htmlInstalled = renderPluginTile({ name: 'p', version: '', description: '', author: '' }, 'installed', '');
    expect(htmlInstalled).toContain('plugin-tile--installed');

    const htmlNotInstalled = renderPluginTile({ name: 'p', version: '', description: '', author: '' }, 'not-installed', '');
    expect(htmlNotInstalled).toContain('plugin-tile--not-installed');

    const htmlUpdate = renderPluginTile({ name: 'p', version: '', description: '', author: '' }, 'update-available', '');
    expect(htmlUpdate).toContain('plugin-tile--update-available');
  });

  test('zeigt Version mit v-Präfix an', () => {
    const html = renderPluginTile(
      { name: 'versioned', version: '3.2.1', description: '', author: '' },
      'not-installed',
      'versioned@test'
    );

    expect(html).toContain('v3.2.1');
  });
});

// ── renderPlugins ────────────────────────────────────────────

describe('renderPlugins', () => {

  test('leerer Zustand zeigt plugin-empty-state', () => {
    marketplaces = [];
    installedPlugins = [];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-empty-state');
    expect(container.innerHTML).toContain('Keine Marketplaces konfiguriert');

    const sidebar = mockDoc.getElementById('pluginSidebar');
    expect(sidebar.innerHTML).toBe('');
  });

  test('mit Marketplace-Plugins werden Sektionen und Grid gerendert', () => {
    marketplaces = [{
      marketplace: 'github/awesome-plugins',
      plugins: [
        { name: 'plugin-a', version: '1.0', description: 'A desc', author: 'Author A' },
        { name: 'plugin-b', version: '2.0', description: 'B desc', author: 'Author B' },
      ]
    }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-section');
    expect(container.innerHTML).toContain('plugin-grid');
    expect(container.innerHTML).toContain('plugin-a');
    expect(container.innerHTML).toContain('plugin-b');
  });

  test('Suchfilter zeigt nur passende Plugins', () => {
    marketplaces = [{
      marketplace: 'github/test',
      plugins: [
        { name: 'alpha-tool', version: '1.0', description: '', author: '' },
        { name: 'beta-helper', version: '1.0', description: '', author: '' },
        { name: 'gamma-tool', version: '1.0', description: '', author: '' },
      ]
    }];

    const searchEl = mockDoc.getElementById('pluginSearch');
    searchEl.value = 'tool';
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('alpha-tool');
    expect(container.innerHTML).toContain('gamma-tool');
    expect(container.innerHTML).not.toContain('beta-helper');
  });

  test('Suchfilter filtert auch nach Beschreibung', () => {
    marketplaces = [{
      marketplace: 'github/test',
      plugins: [
        { name: 'plugin-x', version: '1.0', description: 'Code Formatter', author: '' },
        { name: 'plugin-y', version: '1.0', description: 'Linter', author: '' },
      ]
    }];

    const searchEl = mockDoc.getElementById('pluginSearch');
    searchEl.value = 'formatter';
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-x');
    expect(container.innerHTML).not.toContain('plugin-y');
  });

  test('Suchfilter filtert auch nach Author', () => {
    marketplaces = [{
      marketplace: 'github/test',
      plugins: [
        { name: 'plugin-1', version: '1.0', description: '', author: 'Alice' },
        { name: 'plugin-2', version: '1.0', description: '', author: 'Bob' },
      ]
    }];

    const searchEl = mockDoc.getElementById('pluginSearch');
    searchEl.value = 'alice';
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-1');
    expect(container.innerHTML).not.toContain('plugin-2');
  });

  test('Sidebar wird pro Marketplace befüllt', () => {
    marketplaces = [
      { marketplace: 'github/mp-one', plugins: [{ name: 'p1', version: '1.0', description: '', author: '' }] },
      { marketplace: 'github/mp-two', plugins: [{ name: 'p2', version: '1.0', description: '', author: '' }] },
    ];
    renderPlugins();

    const sidebar = mockDoc.getElementById('pluginSidebar');
    expect(sidebar.innerHTML).toContain('plugins-sidebar__item');
    expect(sidebar.innerHTML).toContain('mp-one');
    expect(sidebar.innerHTML).toContain('mp-two');
    // Installed sidebar item is always present
    expect(sidebar.innerHTML).toContain('Installiert');
  });

  test('Marketplace-Fehler zeigt plugin-section__error', () => {
    marketplaces = [{
      marketplace: 'github/broken',
      plugins: [],
      error: 'Netzwerk-Timeout'
    }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-section__error');
    expect(container.innerHTML).toContain('Netzwerk-Timeout');
  });

  test('installierte Plugins Sektion zeigt "Installierte Plugins"', () => {
    installedPlugins = [{ name: 'installed-one', version: '1.0.0' }];
    marketplaces = [{ marketplace: 'github/test', plugins: [] }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('Installierte Plugins');
    expect(container.innerHTML).toContain('installed-one');
  });

  test('leere installierte Plugins zeigt Hinweistext', () => {
    installedPlugins = [];
    marketplaces = [{ marketplace: 'github/test', plugins: [] }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('Noch keine Plugins installiert');
  });

  test('Plugin-Tile in Marketplace zeigt korrekten Status für installiertes Plugin', () => {
    installedPlugins = [{ name: 'shared-plugin', version: '1.0.0' }];
    marketplaces = [{
      marketplace: 'github/mp',
      plugins: [
        { name: 'shared-plugin', version: '1.0.0', description: '', author: '' },
        { name: 'other-plugin', version: '1.0.0', description: '', author: '' },
      ]
    }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    // shared-plugin should show as installed
    expect(container.innerHTML).toContain('plugin-tile--installed');
    // other-plugin should show as not-installed
    expect(container.innerHTML).toContain('plugin-tile--not-installed');
  });

  test('leerer Marketplace ohne Fehler zeigt "Keine Plugins" Text', () => {
    marketplaces = [{ marketplace: 'github/empty', plugins: [] }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('Keine Plugins in diesem Marketplace');
  });
});

// ── XSS-Schutz ───────────────────────────────────────────────

describe('XSS-Schutz in Plugin-Rendering', () => {

  test('Plugin-Name mit Script-Tag wird escaped', () => {
    const html = renderPluginTile(
      { name: '<script>alert(1)</script>', version: '1.0', description: '', author: '' },
      'not-installed',
      'xss@test'
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('Beschreibung mit HTML wird escaped', () => {
    const html = renderPluginTile(
      { name: 'safe-plugin', version: '1.0', description: '<img src=x onerror=alert(1)>', author: '' },
      'not-installed',
      'safe-plugin@test'
    );

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('Author mit Anführungszeichen wird escaped', () => {
    const html = renderPluginTile(
      { name: 'safe', version: '1.0', description: 'Desc', author: 'O"Brien' },
      'not-installed',
      'safe@test'
    );

    expect(html).toContain('&quot;');
    expect(html).not.toContain('O"Brien');
  });

  test('Marketplace-Fehler wird escaped in renderPlugins', () => {
    marketplaces = [{
      marketplace: 'github/evil',
      plugins: [],
      error: '<script>steal()</script>'
    }];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    // Script-Tag darf NICHT unescaped im HTML auftauchen
    expect(container.innerHTML).not.toContain('<script>steal()');
    // Escaped Version muss vorhanden sein
    expect(container.innerHTML).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(container.innerHTML).toContain('plugin-section__error');
  });

  test('Plugin-Name im data-plugin Attribut wird escaped', () => {
    const html = renderPluginTile(
      { name: 'test" onmouseover="alert(1)', version: '1.0', description: '', author: '' },
      'not-installed',
      'xss@test'
    );

    expect(html).toContain('data-plugin="test&quot; onmouseover=&quot;alert(1)');
    expect(html).not.toContain('onmouseover="alert');
  });
});

// ── Marketplace Remove-Button in renderPlugins ───────────────

describe('Marketplace Remove-Button in renderPlugins', () => {

  test('jede Marketplace-Sektion enthält einen Remove-Button', () => {
    marketplaces = [
      { marketplace: 'github/mp-one', name: 'mp-one', plugins: [{ name: 'p1', version: '1.0', description: '', author: '' }] },
    ];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain('plugin-section__remove-btn');
    expect(container.innerHTML).toContain('removeMarketplace');
  });

  test('Remove-Button enthält den Marketplace-Name', () => {
    marketplaces = [
      { marketplace: 'github/my-mp', name: 'my-marketplace', plugins: [] },
    ];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain("removeMarketplace('my-marketplace')");
  });

  test('Remove-Button nutzt mp.marketplace als Fallback wenn name fehlt', () => {
    marketplaces = [
      { marketplace: 'github/fallback-mp', plugins: [] },
    ];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain("removeMarketplace('github/fallback-mp')");
  });

  test('mehrere Marketplaces haben jeweils einen Remove-Button', () => {
    marketplaces = [
      { marketplace: 'github/first', name: 'first', plugins: [] },
      { marketplace: 'github/second', name: 'second', plugins: [] },
    ];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    expect(container.innerHTML).toContain("removeMarketplace('first')");
    expect(container.innerHTML).toContain("removeMarketplace('second')");
  });

  test('Marketplace-Reihenfolge: erster im Array erscheint als erstes im HTML', () => {
    marketplaces = [
      { marketplace: 'github/newest', name: 'newest', plugins: [{ name: 'pn', version: '1', description: '', author: '' }] },
      { marketplace: 'github/oldest', name: 'oldest', plugins: [{ name: 'po', version: '1', description: '', author: '' }] },
    ];
    renderPlugins();

    const container = mockDoc.getElementById('pluginList');
    const newestPos = container.innerHTML.indexOf('newest');
    const oldestPos = container.innerHTML.indexOf('oldest');
    // newest (Index 0) kommt vor oldest (Index 1) im HTML
    expect(newestPos).toBeLessThan(oldestPos);
  });
});

// ── Plugins Module ────────────────────────────────────────────
// Extracted from app.js — plugin/marketplace manager and the
// plugins/costs/chat main-view switching.
// Relies on globals provided elsewhere: escapeHtml/escapeAttr/showNotification
// (modules/utils.js), reloadSkills (app.js skills), renderCostsPanel
// (modules/costs.js), window.costsViewActive (modules/costs.js).
'use strict';

/** @type {Array<{success: boolean, marketplace: string, name: string, plugins: Array, error?: string}>} Marketplace browse results. */
let marketplaces = [];
/** @type {Array<{name: string, version: string, updateAvailable?: boolean}>} Currently installed plugins. */
let installedPlugins = [];

/**
 * Load installed plugins and all configured marketplace catalogues.
 * Fetches plugin lists in parallel, updates counts, and re-renders.
 * @returns {Promise<void>}
 */
async function loadPlugins() {
  console.log('[plugins] Lade Plugin-Liste und Marketplaces…');
  try {
    const result = await desktop.plugins.list();
    installedPlugins = (result && result.success) ? result.plugins : [];
    console.log(`[plugins] Installierte Plugins: ${installedPlugins.length}`, installedPlugins.map(p => p.name));
  } catch (e) {
    console.warn('[plugins] Liste laden fehlgeschlagen:', e.message);
    installedPlugins = [];
  }

  let mpList = [];
  try {
    const listResult = await desktop.plugins.listMarketplaces();
    mpList = (listResult && listResult.success) ? listResult.marketplaces : [];
    console.log('[plugins] Marketplaces:', mpList.map(m => m.name));
  } catch (e) {
    console.warn('[plugins] Marketplace-Liste fehlgeschlagen:', e.message);
  }

  const results = await Promise.allSettled(
    mpList.map(mp => desktop.plugins.browseMarketplace(mp.name))
  );

  marketplaces = results.map((r, i) => {
    const mpInfo = mpList[i];
    if (r.status === 'fulfilled' && r.value && r.value.success) {
      console.log(`[plugins] "${mpInfo.name}": ${r.value.plugins.length} Plugins`);
      return {
        success: true,
        marketplace: mpInfo.source || mpInfo.name,
        name: mpInfo.name,
        plugins: r.value.plugins,
      };
    }
    const err = r.status === 'rejected' ? r.reason?.message : (r.value?.error || 'Unbekannter Fehler');
    console.warn(`[plugins] "${mpInfo.name}" fehlgeschlagen:`, err);
    return {
      success: false,
      marketplace: mpInfo.source || mpInfo.name,
      name: mpInfo.name,
      plugins: [],
      error: err,
    };
  });

  const countEl = document.getElementById('pluginCount');
  if (countEl) countEl.textContent = String(installedPlugins.length);

  renderPlugins();
}

/**
 * Determine the installation status of a plugin by name.
 * @param {string} pluginName
 * @returns {'installed'|'update-available'|'not-installed'}
 */
function getPluginStatus(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  if (!installed) return 'not-installed';
  return installed.updateAvailable ? 'update-available' : 'installed';
}

function getInstalledVersion(pluginName) {
  const installed = installedPlugins.find(p => p.name.toLowerCase() === pluginName.toLowerCase());
  return installed ? installed.version : '';
}

/**
 * Render the full plugins view: installed plugins section followed by
 * marketplace sections with search filtering and sidebar navigation.
 */
function renderPlugins() {
  const container = document.getElementById('pluginList');
  const sidebar = document.getElementById('pluginSidebar');
  if (!container) return;

  const searchEl = document.getElementById('pluginSearch');
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
        <button class="plugin-btn plugin-btn--install" data-click-target="btnAddPlugin">+ Marketplace hinzufügen</button>
      </div>`;
    if (sidebar) sidebar.innerHTML = '';
    return;
  }

  let html = '';
  let sidebarHtml = '';

  const visibleInstalled = installedPlugins.filter(matchesQuery);
  const installedSectionId = 'plugin-section-installed';
  sidebarHtml += `<div class="plugins-sidebar__item ${visibleInstalled.length > 0 ? '' : 'plugins-sidebar__item--empty'}" data-scroll-to="${installedSectionId}">
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

    sidebarHtml += `<div class="plugins-sidebar__item" data-scroll-to="${sectionId}">
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
    html += `<button class="plugin-section__remove-btn" data-remove-marketplace="${escapeAttr(mp.name || mp.marketplace)}" title="Marketplace entfernen">✕</button>`;
    html += `</div>`;

    if (mp.error) {
      html += `<div class="plugin-section__error">⚠️ ${escapeHtml(mp.error)}</div>`;
    }

    if (filteredPlugins.length > 0) {
      html += `<div class="plugin-grid">`;
      for (const plugin of filteredPlugins) {
        const status = getPluginStatus(plugin.name);
        const target = `${escapeAttr(plugin.name)}@${escapeAttr(mp.name || mp.marketplace)}`;
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

/**
 * Render a single plugin tile card with status badge and action buttons.
 * @param {{name: string, version?: string, description?: string, author?: string}} plugin
 * @param {'installed'|'update-available'|'not-installed'} status
 * @param {string} target - Install target string (name@marketplace).
 * @returns {string} HTML string for the plugin tile.
 */
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
    actionsHtml = `<button class="plugin-btn plugin-btn--install" data-install-plugin="${escapeAttr(target)}">Installieren</button>`;
  } else if (status === 'installed') {
    actionsHtml = `<button class="plugin-btn plugin-btn--remove" data-uninstall-plugin="${escapeAttr(name)}">Entfernen</button>`;
  } else if (status === 'update-available') {
    actionsHtml = `<button class="plugin-btn plugin-btn--update-available" data-update-plugin="${escapeAttr(name)}">Updaten</button>`;
    actionsHtml += `<button class="plugin-btn plugin-btn--remove" data-uninstall-plugin="${escapeAttr(name)}">✕</button>`;
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

window.installPlugin = async function(target) {
  const pluginName = target.split('@')[0];
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(pluginName)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await desktop.plugins.install(target);
    if (result && result.success) {
      showNotification('Plugin installiert', 'success');
    } else {
      showNotification(result?.error || 'Installation fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Installation fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
  await reloadSkills();
};

window.uninstallPlugin = async function(name) {
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(name)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await desktop.plugins.uninstall(name);
    if (result && result.success) {
      showNotification('Plugin deinstalliert', 'success');
    } else {
      showNotification(result?.error || 'Deinstallation fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Deinstallation fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
  await reloadSkills();
};

window.updatePlugin = async function(name) {
  const card = document.querySelector(`.plugin-tile[data-plugin="${CSS.escape(name)}"]`);
  if (card) {
    const actions = card.querySelector('.plugin-tile__actions');
    if (actions) actions.innerHTML = '<span class="plugin-btn plugin-btn--loading">⏳</span>';
  }
  try {
    const result = await desktop.plugins.update(name);
    if (result && result.success) {
      showNotification('Plugin aktualisiert', 'success');
    } else {
      showNotification(result?.error || 'Update fehlgeschlagen', 'error');
    }
  } catch (e) {
    showNotification('Update fehlgeschlagen: ' + e.message, 'error');
  }
  await loadPlugins();
  await reloadSkills();
};

/**
 * Show an inline dialog to add a new marketplace URL or install a plugin.
 */
function showAddPluginDialog() {
  const container = document.getElementById('pluginList');
  if (!container) return;

  const existing = container.querySelector('.plugin-add-dialog');
  if (existing) { existing.remove(); return; }

  const dialog = document.createElement('div');
  dialog.className = 'plugin-add-dialog';
  dialog.innerHTML = `
    <div class="plugin-add-dialog__fields">
      <input type="text" class="plugin-add-dialog__input" placeholder="Marketplace-URL oder Plugin-Name…" />
    </div>
    <div class="plugin-add-dialog__buttons">
      <button class="plugin-btn plugin-btn--install" id="pluginDialogAdd">Hinzufügen</button>
      <button class="plugin-btn plugin-btn--remove" id="pluginDialogCancel">Abbrechen</button>
    </div>
  `;
  container.prepend(dialog);

  const input = dialog.querySelector('.plugin-add-dialog__input');
  input.focus();

  dialog.querySelector('#pluginDialogAdd').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return;

    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    const isOwnerRepo = !isUrl && value.includes('/');

    if (isUrl || isOwnerRepo) {
      // Show spinner inside dialog
      const addBtn = dialog.querySelector('#pluginDialogAdd');
      const cancelBtn = dialog.querySelector('#pluginDialogCancel');
      addBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      addBtn.innerHTML = '<span class="plugin-spinner"></span> Wird hinzugefügt…';
      try {
        const result = await desktop.plugins.addMarketplace(value);
        dialog.remove();
        if (result && result.success) {
          showNotification('Marketplace hinzugefügt', 'success');
        } else {
          showNotification(result?.error || 'Marketplace hinzufügen fehlgeschlagen', 'error');
        }
      } catch (e) {
        dialog.remove();
        showNotification('Marketplace hinzufügen fehlgeschlagen: ' + e.message, 'error');
      }
      await loadPlugins();
    } else {
      dialog.remove();
      await installPlugin(value);
    }
  });

  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dialog.querySelector('#pluginDialogAdd').click();
    }
    if (e.key === 'Escape') {
      dialog.remove();
    }
  };
  input.addEventListener('keydown', handleKeydown);

  dialog.querySelector('#pluginDialogCancel').addEventListener('click', () => {
    dialog.remove();
  });
}

function initPluginButtons() {
  const btnAdd = document.getElementById('btnAddPlugin');
  if (btnAdd) btnAdd.addEventListener('click', () => showAddPluginDialog());

  const btnRefresh = document.getElementById('btnRefreshPlugins');
  if (btnRefresh) btnRefresh.addEventListener('click', () => loadPlugins());

  const searchEl = document.getElementById('pluginSearch');
  if (searchEl) searchEl.addEventListener('input', () => renderPlugins());
}

// ── Plugin View Switching ────────────────────────────────────
window.pluginsViewActive = false;

window.removeMarketplace = async function(name) {
  console.log(`[plugins] removeMarketplace: "${name}"`);

  // Show spinner on the clicked remove button
  const btn = document.querySelector(`.plugin-section__remove-btn[onclick*="${CSS.escape(name)}"]`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="plugin-spinner plugin-spinner--sm"></span>';
  }

  try {
    const result = await desktop.plugins.removeMarketplace(name);
    console.log('[plugins] removeMarketplace result:', result);
    if (result && result.success) {
      showNotification('Marketplace entfernt', 'success');
    } else {
      showNotification(result?.error || 'Marketplace entfernen fehlgeschlagen', 'error');
    }
  } catch (e) {
    console.error('[plugins] removeMarketplace error:', e);
    showNotification('Marketplace entfernen fehlgeschlagen: ' + (e?.message || JSON.stringify(e)), 'error');
  }
  loadPlugins().catch(e => console.error('[plugins] loadPlugins nach removeMarketplace:', e));
};

/**
 * Switch the main content area from chat to the plugins marketplace view.
 */
window.switchToPluginsView = function() {
  // Leave the costs view if it happens to be open.
  window.costsViewActive = false;
  const costsView = document.getElementById('costsView');
  if (costsView) costsView.style.display = 'none';

  window.pluginsViewActive = true;
  const pluginsView = document.getElementById('pluginsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const tabPlugins = document.getElementById('tabPlugins');

  // Hide chat content, show plugin view (both inside terminal-container)
  if (sessionActions) sessionActions.style.display = 'none';
  if (streamArea) streamArea.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';
  if (pluginsView) pluginsView.style.display = 'flex';

  // Deactivate all chat tabs, activate plugin tab
  document.querySelectorAll('#tabBar .tab:not(.tab--fixed)').forEach(el => {
    el.classList.remove('tab--active');
  });
  if (tabPlugins) tabPlugins.classList.add('tab--active');

  renderPlugins();
};

/**
 * Switch the main content area from chat to the costs view (own page,
 * like the plugin marketplace — not a modal).
 */
window.switchToCostsView = function() {
  // Leave the plugins view if it happens to be open.
  window.pluginsViewActive = false;
  const pluginsView = document.getElementById('pluginsView');
  const tabPlugins = document.getElementById('tabPlugins');
  if (pluginsView) pluginsView.style.display = 'none';
  if (tabPlugins) tabPlugins.classList.remove('tab--active');

  window.costsViewActive = true;
  const costsView = document.getElementById('costsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');

  if (sessionActions) sessionActions.style.display = 'none';
  if (streamArea) streamArea.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';
  if (costsView) costsView.style.display = 'flex';

  // Render after layout so the canvas has its final width.
  requestAnimationFrame(renderCostsPanel);
};

/**
 * Switch the main content area back from plugins/costs to chat view.
 */
function switchToChatView() {
  if (!window.pluginsViewActive && !window.costsViewActive) return;
  window.pluginsViewActive = false;
  window.costsViewActive = false;
  const pluginsView = document.getElementById('pluginsView');
  const costsView = document.getElementById('costsView');
  const sessionActions = document.getElementById('sessionActions');
  const streamArea = document.getElementById('streamArea');
  const chatInputBar = document.querySelector('.chat-input-bar');
  const tabPlugins = document.getElementById('tabPlugins');

  if (pluginsView) pluginsView.style.display = 'none';
  if (costsView) costsView.style.display = 'none';
  if (sessionActions) sessionActions.style.display = '';
  if (streamArea) streamArea.style.display = '';
  if (chatInputBar) chatInputBar.style.display = '';

  if (tabPlugins) tabPlugins.classList.remove('tab--active');
}

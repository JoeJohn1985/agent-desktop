// ── Keyboard Shortcuts Module ─────────────────────────────────
// Extracted from app.js — configurable shortcut definitions, the settings
// panel for rebinding them, and the global keydown dispatcher.
// Relies on globals provided elsewhere: escapeHtml (modules/utils.js),
// getSettings/saveSetting (app.js), initCostsPanel (modules/costs.js),
// tabs/activeTabId/switchTab/createTab/closeTab (app.js tab management),
// closeTestRunner (modules/test-runner.js).
'use strict';

/**
 * @type {Array<{id: string, label: string, category: string, default: {ctrl: boolean, shift: boolean, alt: boolean, key: string}}>}
 * Configurable keyboard shortcut definitions with default bindings.
 */
const SHORTCUT_DEFS = [
  { id: 'newTab',        label: 'Neuer Tab',              category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 't' } },
  { id: 'closeTab',      label: 'Tab schließen',          category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'w' } },
  { id: 'nextTab',       label: 'Nächster Tab',           category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'Tab' } },
  { id: 'prevTab',       label: 'Vorheriger Tab',         category: 'Tabs', default: { ctrl: true,  shift: true,  alt: false, key: 'Tab' } },
  { id: 'focusInput',    label: 'Eingabe fokussieren',    category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'l' } },
  { id: 'search',        label: 'Suche',                  category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'f' } },
  { id: 'showShortcuts', label: 'Tastenkürzel anzeigen',  category: 'UI',   default: { ctrl: true,  shift: false, alt: false, key: '/' } },
];

const FIXED_SHORTCUTS = [
  { label: 'Tab 1–8 direkt',   binding: { ctrl: true,  shift: false, alt: false, key: '1–8' },    category: 'Tabs' },
  { label: 'Letzter Tab',      binding: { ctrl: true,  shift: false, alt: false, key: '9' },       category: 'Tabs' },
  { label: 'Aktion abbrechen', binding: { ctrl: false, shift: false, alt: false, key: 'Escape' },  category: 'Chat' },
];

function _getShortcutPrefs() { return getSettings().shortcuts || {}; }

/**
 * Get the effective keybinding for a shortcut (user override or default).
 * @param {string} id - Shortcut definition ID.
 * @returns {{ctrl: boolean, shift: boolean, alt: boolean, key: string}|null}
 */
function getShortcut(id) {
  const def = SHORTCUT_DEFS.find(d => d.id === id);
  if (!def) return null;
  return _getShortcutPrefs()[id] || def.default;
}

function saveShortcut(id, binding) {
  const prefs = _getShortcutPrefs();
  prefs[id] = binding;
  saveSetting('shortcuts', prefs);
}

function resetAllShortcuts() { saveSetting('shortcuts', {}); }

/**
 * Test whether a keyboard event matches a shortcut binding.
 * @param {KeyboardEvent} e
 * @param {{ctrl: boolean, shift: boolean, alt: boolean, key: string}} binding
 * @returns {boolean}
 */
function matchShortcut(e, binding) {
  return e.key === binding.key
    && !!e.ctrlKey  === !!binding.ctrl
    && !!e.shiftKey === !!binding.shift
    && !!e.altKey   === !!binding.alt;
}

/**
 * Format a shortcut binding as a human-readable label (e.g. "Ctrl+Shift+T").
 * @param {{ctrl: boolean, shift: boolean, alt: boolean, key: string}} binding
 * @returns {string}
 */
function shortcutLabel(binding) {
  const parts = [];
  if (binding.ctrl)  parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt)   parts.push('Alt');
  parts.push(binding.key === ' ' ? 'Space' : binding.key);
  return parts.join('+');
}

/**
 * Render the keyboard shortcuts help overlay content, grouped by category.
 */
function renderShortcutsHelp() {
  const container = document.getElementById('shortcutsHelpContent');
  if (!container) return;
  const byCategory = {};
  for (const def of SHORTCUT_DEFS) {
    (byCategory[def.category] ??= []).push({ label: def.label, binding: getShortcut(def.id) });
  }
  for (const sc of FIXED_SHORTCUTS) {
    (byCategory[sc.category] ??= []).push({ label: sc.label, binding: sc.binding });
  }
  container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div class="shortcuts-group">
      <div class="shortcuts-group__title">${escapeHtml(cat)}</div>
      <table class="shortcuts-table">
        ${items.map(it => `
          <tr>
            <td class="shortcuts-table__label">${escapeHtml(it.label)}</td>
            <td class="shortcuts-table__binding"><kbd class="shortcut-kbd">${escapeHtml(shortcutLabel(it.binding))}</kbd></td>
          </tr>`).join('')}
      </table>
    </div>
  `).join('');
}

/**
 * Initialize the shortcuts settings panel with per-shortcut recording
 * and reset functionality.
 */
function initShortcutsSettings() {
  let _recordingId = null;

  function renderShortcutsSettings() {
    const list = document.getElementById('settShortcutsList');
    if (!list) return;
    const byCategory = {};
    for (const def of SHORTCUT_DEFS) {
      (byCategory[def.category] ??= []).push(def);
    }
    list.innerHTML = Object.entries(byCategory).map(([cat, defs]) => `
      <div class="settings__group">
        <label class="settings__label">${escapeHtml(cat)}</label>
        ${defs.map(def => {
          const binding = getShortcut(def.id);
          const isCustom = !!_getShortcutPrefs()[def.id];
          const isRecording = _recordingId === def.id;
          return `
            <div class="shortcut-row" data-id="${def.id}">
              <span class="shortcut-row__label">${escapeHtml(def.label)}</span>
              <div class="shortcut-row__right">
                <kbd class="shortcut-kbd${isCustom ? ' shortcut-kbd--custom' : ''}">${escapeHtml(shortcutLabel(binding))}</kbd>
                <button class="action-btn shortcut-record-btn${isRecording ? ' shortcut-record-btn--active' : ''}" data-id="${def.id}">${isRecording ? 'Drücken…' : 'Ändern'}</button>
                ${isCustom ? `<button class="action-btn shortcut-reset-btn" data-id="${def.id}" data-tooltip="Zurücksetzen">↩</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    `).join('');

    list.querySelectorAll('.shortcut-record-btn').forEach(btn => {
      btn.addEventListener('click', () => startRecording(btn.dataset.id));
    });
    list.querySelectorAll('.shortcut-reset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prefs = _getShortcutPrefs();
        delete prefs[btn.dataset.id];
        saveSetting('shortcuts', prefs);
        renderShortcutsSettings();
        renderShortcutsHelp();
      });
    });
  }

  function startRecording(id) {
    if (_recordingId) { _recordingId = null; }
    _recordingId = id;
    renderShortcutsSettings();

    function onKeydown(e) {
      if (e.key === 'Escape') { _recordingId = null; renderShortcutsSettings(); document.removeEventListener('keydown', onKeydown, true); return; }
      e.preventDefault();
      e.stopPropagation();
      saveShortcut(id, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key });
      _recordingId = null;
      document.removeEventListener('keydown', onKeydown, true);
      renderShortcutsSettings();
      renderShortcutsHelp();
    }
    document.addEventListener('keydown', onKeydown, true);
  }

  document.getElementById('btnResetShortcuts')?.addEventListener('click', () => {
    resetAllShortcuts();
    renderShortcutsSettings();
    renderShortcutsHelp();
  });
  document.querySelector('.settings__tab[data-tab="shortcuts"]')?.addEventListener('click', renderShortcutsSettings);
  renderShortcutsSettings();

  initCostsPanel();
}

/**
 * Register the global keydown handler that dispatches all configurable
 * shortcuts (tab cycling, new/close tab, search, export, etc.).
 */
function initKeyboardShortcuts() {
  const searchBar = document.getElementById('chatSearchBar');
  const sc = (id, e) => matchShortcut(e, getShortcut(id));

  document.addEventListener('keydown', (e) => {
    // Tab cycling (Ctrl+Tab / Ctrl+Shift+Tab)
    if (sc('nextTab', e)) {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (tabIds.length > 0) switchTab(tabIds[(tabIds.indexOf(activeTabId) + 1) % tabIds.length]);
      return;
    }
    if (sc('prevTab', e)) {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (tabIds.length > 0) switchTab(tabIds[(tabIds.indexOf(activeTabId) - 1 + tabIds.length) % tabIds.length]);
      return;
    }

    if (sc('newTab', e))   { e.preventDefault(); createTab('🤖 Chat'); return; }
    if (sc('closeTab', e)) { e.preventDefault(); if (activeTabId != null) closeTab(activeTabId); return; }

    // Ctrl+1–8: go to tab by index; Ctrl+9: always last tab
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const tabIds = [...tabs.keys()];
      if (e.key === '9') {
        if (tabIds.length > 0) switchTab(tabIds[tabIds.length - 1]);
      } else {
        const idx = parseInt(e.key) - 1;
        if (idx < tabIds.length) switchTab(tabIds[idx]);
      }
      return;
    }

    // Ctrl+/ — show shortcuts (always works, no typing check needed)
    if (sc('showShortcuts', e)) {
      e.preventDefault();
      renderShortcutsHelp();
      document.getElementById('shortcutsOverlay').classList.add('overlay--visible');
      return;
    }

    if (sc('focusInput', e))    { e.preventDefault(); document.getElementById('chatInput')?.focus(); return; }
    if (sc('search', e))        { e.preventDefault(); if (window._openSearch) window._openSearch(); return; }

    if (e.key === 'Escape') {
      // Close model dropdown first (highest priority)
      const modelDd = document.querySelector('.model-dropdown--below');
      if (modelDd) { modelDd.remove(); return; }
      const testPopup = document.getElementById('testRunnerPopup');
      if (testPopup && testPopup.style.display !== 'none') { closeTestRunner(); return; }
      const shortcutsOverlay = document.getElementById('shortcutsOverlay');
      if (shortcutsOverlay.classList.contains('overlay--visible')) { shortcutsOverlay.classList.remove('overlay--visible'); return; }
      const lb = document.getElementById('imageLightbox');
      if (lb.classList.contains('image-lightbox--visible')) {
        lb.classList.remove('image-lightbox--visible');
      } else if (searchBar.classList.contains('chat-search--visible')) {
        if (window._openSearch) {
          document.getElementById('chatSearchBar').classList.remove('chat-search--visible');
          document.getElementById('chatSearchInput').value = '';
        }
      } else if (activeTabId != null) {
        const tab = tabs.get(activeTabId);
        if (tab && tab.isProcessing) {
          try { desktop.chat.stop(activeTabId); } catch (_) {}
        }
      }
    }
  });

  // ⌨️ button in sidebar footer
  document.getElementById('btnShortcutsHelp')?.addEventListener('click', () => {
    renderShortcutsHelp();
    document.getElementById('shortcutsOverlay').classList.add('overlay--visible');
  });

  // Shortcuts help overlay controls
  document.getElementById('btnShortcutsClose').addEventListener('click', () => {
    document.getElementById('shortcutsOverlay').classList.remove('overlay--visible');
  });
  document.getElementById('shortcutsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcutsOverlay'))
      document.getElementById('shortcutsOverlay').classList.remove('overlay--visible');
  });

  renderShortcutsHelp();
}

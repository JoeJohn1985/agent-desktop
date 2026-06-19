// ── Session Tools Module ──────────────────────────────────────
// Extracted from app.js — Session tools popup and pinned tools UI
'use strict';

/**
 * Restarts the ACP process for the active tab with the current merged
 * denied-tools list (admin + global + session). Required because ACP
 * only accepts --deny-tool flags at process spawn time.
 */
function restartWithUpdatedDeniedTools() {
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.sessionId || tab.isProcessing) return;
  const sessionDenied = (tab.sessionDeniedTools || []).filter(t => t.enabled).map(t => t.name);
  const merged = [...new Set([...getAdminDeniedTools(), ...getDeniedTools(), ...sessionDenied])];
  window.copilot.chat.restartWithDeniedTools(activeTabId, merged).then(result => {
    if (!result.success) console.warn('[session-tools] restart failed:', result.error);
  }).catch(err => {
    console.warn('[session-tools] restart error:', err.message);
  });
}

function initSessionTools() {
  const btn = document.getElementById('btnSessionTools');
  const popup = document.getElementById('sessionToolsPopup');
  const input = document.getElementById('sessionToolInput');
  const addBtn = document.getElementById('btnAddSessionTool');
  const list = document.getElementById('sessionToolsList');

  btn.addEventListener('click', () => {
    const isOpen = popup.style.display !== 'none';
    popup.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      renderSessionTools();
      setTimeout(() => input.focus(), 50);
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.style.display = 'none';
    }
  });

  function addTool() {
    const val = input.value.trim();
    if (!val) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    const wrapped = val.startsWith('shell(') ? val : `shell(${val})`;
    if (!tab.sessionDeniedTools.find(t => t.name === wrapped)) {
      tab.sessionDeniedTools.push({ name: wrapped, enabled: true });
      saveOpenTabs();
    }
    input.value = '';
    renderSessionTools();
    restartWithUpdatedDeniedTools();
  }

  addBtn.addEventListener('click', addTool);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTool(); }
  });
}

function renderSessionTools() {
  const list = document.getElementById('sessionToolsList');
  const tab = tabs.get(activeTabId);
  if (!list || !tab) return;
  const tools = tab.sessionDeniedTools || [];
  if (tools.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:6px 0;">Keine Session-Tools konfiguriert</div>';
    return;
  }
  list.innerHTML = tools.map((t, i) => `
    <div class="session-tools-popup__item">
      <span class="session-tools-popup__item-name" title="${escapeAttr(stripShellWrapper(t.name))}">${escapeHtml(stripShellWrapper(t.name))}</span>
      <div class="session-tools-popup__toggle ${t.enabled ? 'active' : ''}" data-idx="${i}" title="${t.enabled ? 'Tool ist blockiert (klicken zum Erlauben)' : 'Tool ist erlaubt (klicken zum Blockieren)'}"></div>
      <button class="session-tools-popup__delete" data-idx="${i}" title="Remove">🗑️</button>
    </div>
  `).join('');

  // Toggle handlers
  list.querySelectorAll('.session-tools-popup__toggle').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      tab.sessionDeniedTools[idx].enabled = !tab.sessionDeniedTools[idx].enabled;
      saveOpenTabs();
      renderSessionTools();
      restartWithUpdatedDeniedTools();
    });
  });

  // Delete handlers
  list.querySelectorAll('.session-tools-popup__delete').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      tab.sessionDeniedTools.splice(idx, 1);
      saveOpenTabs();
      renderSessionTools();
      restartWithUpdatedDeniedTools();
    });
  });
}

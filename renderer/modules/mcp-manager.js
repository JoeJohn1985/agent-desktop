'use strict';

const _mcpBusy = new Set();
let _closeMcpMenu = null;
const MCP_STATUS_LABELS = {
  configured: 'konfiguriert', connecting: 'Verbindung wird hergestellt',
  authenticating: 'Anmeldung im Browser', connected: 'verbunden',
  disconnected: 'getrennt', 'auth-required': 'Anmeldung erforderlich',
  error: 'Fehler', disabled: 'deaktiviert',
};

function applyAppMcpServers(servers) {
  _closeMcpMenu?.();
  const bridgeNames = new Set([...globalMcpServers, ...servers].filter(s => s.managed).map(s => s.bridgeName));
  globalMcpServers = [...servers, ...globalMcpServers.filter(s => !s.managed)];
  mcpServers = [...servers, ...mcpServers.filter(s => !s.managed && !bridgeNames.has(s.name))];
  renderMcpServers();
  renderManagedMcpServers();
}

function renderManagedMcpServers() {
  const list = document.getElementById('mcpManagedList');
  if (!list) return;
  const servers = globalMcpServers.filter(s => s.managed);
  list.innerHTML = servers.length ? servers.map(s => `
    <div class="mcp-manager__server" data-mcp-id="${escapeAttr(s.id)}">
      <strong>${escapeHtml(s.name)}</strong>
      <span>${escapeHtml(MCP_STATUS_LABELS[s.status] || s.status)}</span>
      ${mcpMenuButtonHtml(s)}
      <div>${escapeHtml(s.url)}</div>
      ${s.error ? `<div class="mcp-manager__error">${escapeHtml(s.error)}</div>` : ''}
    </div>`).join('') : emptyStateHtml('🔌', 'Noch keine app-eigenen MCP-Server.');
}

function mcpMenuButtonHtml(server) {
  return `<button class="mcp-menu-btn" data-mcp-menu="${escapeAttr(server.id)}"
    aria-label="${escapeAttr('Optionen für ' + server.name)}" aria-haspopup="menu" aria-expanded="false">⋮</button>`;
}

function openMcpManager() {
  renderManagedMcpServers();
  document.getElementById('mcpManagerOverlay').style.display = 'flex';
  document.getElementById('mcpServerName').focus();
}

async function performMcpAction(id, action) {
  const server = globalMcpServers.find(s => s.managed && s.id === id);
  if (!server) return;
  if (action === 'edit') {
    openMcpManager();
    document.getElementById('mcpServerId').value = id;
    document.getElementById('mcpServerName').value = server.name;
    document.getElementById('mcpServerUrl').value = server.url;
    document.getElementById('mcpServerType').value = server.type;
    document.getElementById('mcpServerEnabled').checked = server.enabled;
    return;
  }
  if (action === 'remove' && !window.confirm(`MCP-Server "${server.name}" und seine App-Anmeldedaten entfernen?`)) return;
  if (action === 'connect') _mcpBusy.add(id);
  renderMcpServers();
  renderManagedMcpServers();
  try {
    await runMcpAction(() => {
      if (action === 'connect') return desktop.mcp.connect(id);
      if (action === 'remove') return desktop.mcp.remove(id);
      if (action === 'toggle') return desktop.mcp.save({ ...server, enabled: !server.enabled });
      return desktop.mcp.disconnect(id, action === 'logout');
    });
  } finally {
    _mcpBusy.delete(id);
    renderMcpServers();
    renderManagedMcpServers();
  }
}

function openMcpServerMenu(id, button) {
  const same = document.querySelector('.mcp-server-menu')?.dataset.mcpId === id;
  _closeMcpMenu?.();
  if (same) return;
  const server = globalMcpServers.find(s => s.managed && s.id === id);
  if (!server) return;
  const menu = document.createElement('div');
  menu.className = 'section-menu mcp-server-menu';
  menu.dataset.mcpId = id;
  menu.setAttribute('role', 'menu');
  const connectDisabled = !server.enabled || _mcpBusy.has(id) || ['connected', 'connecting', 'authenticating'].includes(server.status);
  menu.innerHTML = `
    <button class="section-menu__item" role="menuitem" data-mcp-action="connect" ${connectDisabled ? 'disabled' : ''}>🔌 Verbinden</button>
    <button class="section-menu__item" role="menuitem" data-mcp-action="disconnect">⏹ Trennen / Anmeldung abbrechen</button>
    <button class="section-menu__item" role="menuitem" data-mcp-action="edit">✏️ Bearbeiten</button>
    <button class="section-menu__item" role="menuitem" data-mcp-action="toggle">${server.enabled ? '⏸ Deaktivieren' : '▶️ Aktivieren'}</button>
    <button class="section-menu__item" role="menuitem" data-mcp-action="logout">🚪 Abmelden</button>
    <button class="section-menu__item section-menu__item--danger" role="menuitem" data-mcp-action="remove">🗑️ Entfernen</button>`;
  const rect = button.getBoundingClientRect();
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  document.body.appendChild(menu);
  clampMenuToViewportLeft(menu);
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
  button.setAttribute('aria-expanded', 'true');
  const close = () => {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', scroll, true);
    _closeMcpMenu = null;
  };
  const outside = e => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
  const scroll = e => { if (!menu.contains(e.target)) close(); };
  const keyboard = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); button.focus(); return; }
    if (e.key === 'Tab') { close(); button.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    let index = items.indexOf(document.activeElement);
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = items.length - 1;
    else index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  };
  _closeMcpMenu = close;
  document.addEventListener('click', outside, true);
  document.addEventListener('keydown', keyboard, true);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', close);
  menu.addEventListener('click', e => {
    const action = e.target.closest('[data-mcp-action]');
    if (!action || action.disabled) return;
    close();
    performMcpAction(id, action.dataset.mcpAction);
  });
  menu.querySelector('button:not(:disabled)')?.focus();
}

function resetMcpForm() {
  document.getElementById('mcpServerForm').reset();
  document.getElementById('mcpServerId').value = '';
}

function showMcpError(message) {
  document.getElementById('mcpManagerError').textContent = message || '';
}

async function runMcpAction(action) {
  try {
    const result = await action();
    if (!result.success) throw new Error(result.error || 'MCP-Aktion fehlgeschlagen.');
    applyAppMcpServers(result.servers);
    showMcpError('');
    return true;
  } catch (e) {
    showMcpError(e.message);
    showNotification(e.message, 'error');
    return false;
  }
}

function initMcpManager() {
  const overlay = document.getElementById('mcpManagerOverlay');
  const close = () => { _closeMcpMenu?.(); overlay.style.display = 'none'; };
  document.getElementById('btnMcpManager').addEventListener('click', openMcpManager);
  document.getElementById('btnMcpManagerClose').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.getElementById('btnMcpNew').addEventListener('click', resetMcpForm);
  document.getElementById('mcpServerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const saved = await runMcpAction(() => desktop.mcp.save({
        id: document.getElementById('mcpServerId').value || undefined,
        name: document.getElementById('mcpServerName').value.trim(),
        url: document.getElementById('mcpServerUrl').value.trim(),
        type: document.getElementById('mcpServerType').value,
        enabled: document.getElementById('mcpServerEnabled').checked,
      }));
      if (saved) resetMcpForm();
    } finally { button.disabled = false; }
  });
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-mcp-menu]');
    if (button) openMcpServerMenu(button.dataset.mcpMenu, button);
  });
  desktop.mcp.onChanged(applyAppMcpServers);
}

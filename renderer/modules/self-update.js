// ── Self-Update Module ────────────────────────────────────────
// Extracted from app.js — the git-based app self-updater and the Claude
// Code ACP adapter update checker (same idea, different target).
// Relies on globals provided elsewhere: escapeHtml/showNotification
// (modules/utils.js), getSettings (app.js), _prefs (app.js preferences
// cache — see applyClaudeAdapterUpdateFromBanner for why it's written
// directly instead of via setPref).
'use strict';

/** True while an update check or apply is in flight (prevents double-clicks). */
let _updateBusy = false;
/** Version the user dismissed — suppresses re-nagging for the same version on silent checks. */
let _dismissedUpdateVersion = null;
/** Interval between background update checks while the app runs (6 h). */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Check for a newer release. On startup this runs silently (only surfaces a
 * banner if an update exists); the settings button passes silent=false to also
 * report "up to date" / errors.
 * @param {{silent?: boolean}} [opts]
 */
async function checkForUpdates({ silent = true } = {}) {
  if (_updateBusy) return;
  if (!window.desktop?.updates) return;
  _updateBusy = true;
  const statusEl = document.getElementById('updateCheckStatus');
  if (!silent && statusEl) statusEl.textContent = 'Suche…';
  try {
    const res = await desktop.updates.check();
    if (res.updateAvailable) {
      // On silent (background) checks, don't re-show a banner the user already
      // dismissed for this exact version; the settings button (silent=false)
      // always shows it again.
      if (silent && res.latestVersion === _dismissedUpdateVersion) {
        if (statusEl) statusEl.textContent = `Neue Version v${res.latestVersion} verfügbar.`;
      } else {
        showUpdateBanner(res.currentVersion, res.latestVersion);
        if (statusEl) statusEl.textContent = `Neue Version v${res.latestVersion} verfügbar.`;
      }
    } else if (!silent) {
      if (res.ok) {
        if (statusEl) statusEl.textContent = `Aktuell (v${res.currentVersion}).`;
        showNotification(`Du nutzt bereits die neueste Version (v${res.currentVersion}).`, 'success');
      } else {
        const msg = updateReasonText(res.reason, res.error);
        if (statusEl) statusEl.textContent = msg;
        showNotification('Update-Prüfung fehlgeschlagen: ' + msg, 'warning');
      }
    }
  } catch (e) {
    if (!silent) showNotification('Update-Prüfung fehlgeschlagen: ' + (e?.message || e), 'error');
  } finally {
    _updateBusy = false;
  }
}

/** Human-readable explanation for a non-ok check/apply reason. */
function updateReasonText(reason, error) {
  switch (reason) {
    case 'not-a-git-checkout': return 'App läuft nicht aus einem Git-Checkout.';
    case 'git-failed': return 'Git-Abfrage fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    case 'dirty-working-tree': return 'Lokale, nicht gespeicherte Änderungen vorhanden — bitte committen oder verwerfen.';
    case 'pull-failed': return 'git pull fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    case 'npm-install-failed': return 'npm install fehlgeschlagen' + (error ? ` (${error})` : '') + '.';
    default: return error || 'Unbekannter Fehler.';
  }
}

// ── Shared: banner auto-collapse into a sidebar icon ─────────
// A banner (app-update or adapter-update) no longer just vanishes when
// dismissed or ignored — it collapses into a small icon next to the version
// label (bottom-left), so the update isn't forgotten but also isn't
// blocking anything. Clicking the icon re-opens the full banner.
const BANNER_AUTO_COLLAPSE_MS = 8000;

/**
 * Creates/replaces a small persistent icon in the sidebar footer, next to
 * the version label. Clicking it removes itself and re-opens the banner.
 * @param {string} iconId - Fixed id so re-collapsing replaces rather than stacks.
 * @param {string} tooltipText
 * @param {() => void} reopen
 */
function collapseToUpdateIcon(iconId, tooltipText, reopen) {
  document.getElementById(iconId)?.remove();
  const icon = document.createElement('button');
  icon.id = iconId;
  icon.className = 'sidebar__footer-btn sidebar__footer-btn--sm update-pending-icon';
  // Deliberately not 🔄 — that's already "check for updates now" right next
  // to it (#btnCheckUpdatesQuick). This means "a known update is waiting,
  // click to see it again", a different action entirely.
  icon.textContent = '🔔';
  icon.setAttribute('data-tooltip', tooltipText);
  icon.addEventListener('click', () => { icon.remove(); reopen(); });
  document.getElementById('sidebarUpdateIcons')?.appendChild(icon);
}

/**
 * Wires a banner's dismiss (✕) button and an auto-collapse timeout to both
 * do the same thing: collapse into a sidebar icon instead of disappearing
 * outright. No-ops if the banner is already gone for another reason (e.g.
 * the update was applied) by the time either fires.
 * @param {HTMLElement} bar
 * @param {string} dismissBtnId
 * @param {string} iconId
 * @param {string} tooltipText
 * @param {() => void} reopen
 * @param {() => void} [onCollapse] - e.g. record the dismissed version.
 */
function wireBannerAutoCollapse(bar, dismissBtnId, iconId, tooltipText, reopen, onCollapse) {
  const collapse = () => {
    if (!document.body.contains(bar)) return;
    bar.remove();
    onCollapse?.();
    collapseToUpdateIcon(iconId, tooltipText, reopen);
  };
  const timer = setTimeout(collapse, BANNER_AUTO_COLLAPSE_MS);
  document.getElementById(dismissBtnId)?.addEventListener('click', () => {
    clearTimeout(timer);
    collapse();
  });
}

/** Show the top update banner (idempotent — replaces any existing one). */
function showUpdateBanner(currentVersion, latestVersion) {
  document.getElementById('updateBanner')?.remove();
  document.getElementById('updateBannerIcon')?.remove();
  const bar = document.createElement('div');
  bar.id = 'updateBanner';
  bar.className = 'update-banner';
  bar.innerHTML = `
    <span class="update-banner__text">🔄 Neue Version <strong>v${escapeHtml(latestVersion)}</strong> verfügbar (aktuell v${escapeHtml(currentVersion)}).</span>
    <button class="update-banner__btn" id="btnApplyUpdate">Herunterladen & Neustarten</button>
    <button class="update-banner__close" id="btnDismissUpdate" aria-label="Schließen">✕</button>`;
  document.body.appendChild(bar);
  document.getElementById('btnApplyUpdate').addEventListener('click', () => applyUpdate(bar));
  wireBannerAutoCollapse(
    bar, 'btnDismissUpdate', 'updateBannerIcon',
    `App-Update verfügbar: v${latestVersion} (aktuell v${currentVersion})`,
    () => showUpdateBanner(currentVersion, latestVersion),
    () => { _dismissedUpdateVersion = latestVersion; }, // don't re-nag on background checks
  );
}

/** Apply the update: confirm, run via main, handle failure reasons. */
async function applyUpdate(bar) {
  if (_updateBusy) return;
  const btn = document.getElementById('btnApplyUpdate');
  _updateBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Wird aktualisiert…'; }
  try {
    const res = await desktop.updates.apply();
    if (res.ok) {
      if (btn) btn.textContent = 'Neustart…';
      showNotification('Update geladen' + (res.depsInstalled ? ' (inkl. Abhängigkeiten)' : '') + ' — App startet neu.', 'success');
      // Main process relaunches shortly; nothing else to do here.
    } else {
      const msg = updateReasonText(res.reason, res.error);
      showNotification('Update fehlgeschlagen: ' + msg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Herunterladen & Neustarten'; }
    }
  } catch (e) {
    showNotification('Update fehlgeschlagen: ' + (e?.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Herunterladen & Neustarten'; }
  } finally {
    _updateBusy = false;
  }
}

/** Wire the settings "check for updates" button and run the silent startup check. */
function initUpdateChecker() {
  document.getElementById('btnCheckUpdates')?.addEventListener('click', () => checkForUpdates({ silent: false }));
  document.getElementById('btnCheckUpdatesQuick')?.addEventListener('click', () => checkForUpdates({ silent: false }));
  // Silent check shortly after startup so it never blocks the UI, then
  // periodically while the app stays open.
  setTimeout(() => checkForUpdates({ silent: true }), 3000);
  setInterval(() => checkForUpdates({ silent: true }), UPDATE_CHECK_INTERVAL_MS);
}

// ── Claude Code ACP Adapter Update (auto-check + banner) ─────
// Same idea as the self-updater above, but for the pinned
// @agentclientprotocol/claude-agent-acp npm package (see claudeCodeClientOptions
// in main.js): checked in the background; a banner with an "Aktualisieren"
// button appears only when a newer version is actually found.
//
// Developer-mode only, on purpose. The adapter ships frequently and its
// releases have broken the app before — 0.75.0 switched `/usage` from prose to
// markdown, which silently emptied the subscription display (see
// parseUsageWindows in src/renderer-logic.js). Updating it is therefore not a
// routine action a normal user should be nudged into: the pinned version is
// the one verified to work, and moving off it is a deliberate, developer-side
// decision.

let _claudeAdapterUpdateBusy = false;
/** Version the user dismissed — suppresses re-nagging for the same version. */
let _dismissedClaudeAdapterVersion = null;
const CLAUDE_ADAPTER_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Checks npm for a newer adapter version and shows a banner if one is found. */
async function checkClaudeAdapterUpdate() {
  // Guard first: skips the npm request and the CLI probe entirely when the
  // banner couldn't be shown anyway.
  if (getSettings().devMode !== true) return;
  if (_claudeAdapterUpdateBusy) return;
  if (!window.desktop?.chat?.checkAdapterUpdate) return;
  // Only relevant if the Claude Code CLI (and thus the adapter) is actually used.
  try {
    const cc = await window.desktop.chat.claudeCodeStatus();
    if (!cc.installed) return;
  } catch (_) { return; }
  _claudeAdapterUpdateBusy = true;
  try {
    const res = await window.desktop.chat.checkAdapterUpdate();
    if (res.ok && res.updateAvailable && res.latestVersion !== _dismissedClaudeAdapterVersion) {
      showClaudeAdapterUpdateBanner(res.currentVersion, res.latestVersion);
    }
  } catch (_) {
    // Silent background check — no error UI, matches self-update's silent mode.
  } finally {
    _claudeAdapterUpdateBusy = false;
  }
}

/** Shows the "Claude Code adapter update available" banner (idempotent). */
function showClaudeAdapterUpdateBanner(currentVersion, latestVersion) {
  document.getElementById('claudeAdapterUpdateBanner')?.remove();
  document.getElementById('claudeAdapterUpdateBannerIcon')?.remove();
  const bar = document.createElement('div');
  bar.id = 'claudeAdapterUpdateBanner';
  bar.className = 'update-banner';
  // Stack above the app self-update banner if that one is showing too (both
  // are bottom-anchored — read its actual resolved offset rather than
  // assuming the CSS default, in case that ever changes).
  const other = document.getElementById('updateBanner');
  if (other) {
    const otherBottom = parseFloat(getComputedStyle(other).bottom) || 0;
    bar.style.bottom = (otherBottom + other.offsetHeight + 8) + 'px';
  }
  bar.innerHTML = `
    <span class="update-banner__text">🔄 Claude-Code-Adapter <strong>v${escapeHtml(latestVersion)}</strong> verfügbar (aktuell v${escapeHtml(currentVersion)}).</span>
    <button class="update-banner__btn" id="btnApplyClaudeAdapterUpdate">Aktualisieren</button>
    <button class="update-banner__close" id="btnDismissClaudeAdapterUpdate" aria-label="Schließen">✕</button>`;
  document.body.appendChild(bar);
  document.getElementById('btnApplyClaudeAdapterUpdate').addEventListener('click', () => applyClaudeAdapterUpdateFromBanner(bar, latestVersion));
  wireBannerAutoCollapse(
    bar, 'btnDismissClaudeAdapterUpdate', 'claudeAdapterUpdateBannerIcon',
    `Claude-Code-Adapter-Update verfügbar: v${latestVersion} (aktuell v${currentVersion})`,
    () => showClaudeAdapterUpdateBanner(currentVersion, latestVersion),
    () => { _dismissedClaudeAdapterVersion = latestVersion; }, // don't re-nag on background checks
  );
}

/** "Aktualisieren" button handler on the banner: applies + verifies the pinned version. */
async function applyClaudeAdapterUpdateFromBanner(bar, targetVersion) {
  const btn = document.getElementById('btnApplyClaudeAdapterUpdate');
  if (btn) { btn.disabled = true; btn.textContent = 'Aktualisiere…'; }
  try {
    const res = await window.desktop.chat.applyAdapterUpdate(targetVersion);
    if (res.ok) {
      // main.js wrote this directly to disk, bypassing the renderer's own
      // prefs cache. Without this, the next unrelated setPref() elsewhere
      // flushes the stale in-memory copy and silently reverts the pin —
      // the banner would then reappear despite a successful update.
      _prefs.claudeCodeAdapterVersion = res.newVersion;
      showNotification(`Claude-Code-Adapter aktualisiert auf v${res.newVersion}.`, 'success');
      bar.remove();
    } else {
      showNotification('Adapter-Update fehlgeschlagen: ' + (res.error || 'unbekannter Fehler'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Aktualisieren'; }
    }
  } catch (e) {
    showNotification('Adapter-Update fehlgeschlagen: ' + (e?.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Aktualisieren'; }
  }
}

/** Silent check shortly after startup, then periodically while the app stays open. */
function initClaudeAdapterUpdateChecker() {
  setTimeout(() => checkClaudeAdapterUpdate(), 5000); // after the self-update check's 3s
  setInterval(() => checkClaudeAdapterUpdate(), CLAUDE_ADAPTER_CHECK_INTERVAL_MS);
}

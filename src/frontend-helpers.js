// ── Testable Frontend Helpers ────────────────────────────────
// Testable versions of pure functions from renderer/app.js.
// Keep in sync with app.js.
// These are CommonJS exports for Jest; app.js keeps its own
// inline copies (browser context, no require()).

/**
 * Default HTML-escape used when no escapeHtmlFn is provided.
 */
function defaultEscapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shortens an absolute path by replacing the user home directory with ~\.
 * @param {string} p            – the path to shorten
 * @param {string} userHomeDir  – the user's home directory
 */
function shortenPath(p, userHomeDir) {
  if (!p || !userHomeDir) return p || '';
  const homeEscaped = userHomeDir.replace(/[\\\/]+/g, '\\\\');
  return p.replace(new RegExp(homeEscaped, 'gi'), '~\\');
}

/**
 * Returns a hex colour based on token-usage percentage.
 * Red (#f38ba8) > 80 %, orange (#fab387) > 60 %, green (#a6e3a1) otherwise.
 */
function contextColor(percent) {
  return percent > 80 ? '#f38ba8' : percent > 60 ? '#fab387' : '#a6e3a1';
}

/**
 * Builds HTML markup for context-window category bars.
 * @param {Array}    categories    – [{name, tokens, percent}, …]
 * @param {Function} [escapeHtmlFn] – HTML-escape function (DI for testability)
 */
function buildContextCategoryHtml(categories, escapeHtmlFn) {
  if (!categories || !categories.length) return '';
  const esc = typeof escapeHtmlFn === 'function' ? escapeHtmlFn : defaultEscapeHtml;

  let html = '<div style="border-top:1px solid var(--border-color,#45475a);padding-top:10px;">';
  for (const cat of categories) {
    const catColor = cat.name === 'Free Space' ? '#a6e3a1'
      : cat.name === 'Messages' ? '#89b4fa'
      : cat.name === 'Buffer'   ? '#a6adc8'
      : '#f5c2e7';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px;">
      <span style="color:var(--text-secondary,#a6adc8);">${esc(cat.name)}</span>
      <span style="font-weight:600;">${cat.tokens} <span style="color:${catColor};">(${cat.percent}%)</span></span>
    </div>
    <div style="background:var(--bg-tertiary,#313244);border-radius:3px;height:4px;overflow:hidden;margin-bottom:8px;">
      <div style="width:${cat.percent}%;height:100%;background:${catColor};border-radius:3px;"></div>
    </div>`;
  }
  html += '</div>';
  return html;
}

module.exports = {
  shortenPath,
  contextColor,
  buildContextCategoryHtml,
  defaultEscapeHtml,
};

'use strict';

// Pure shortcut logic extracted from renderer/app.js for testability.
// No DOM, no Electron, no side-effects — just data + transformations.
// The renderer keeps its own copy in app.js (same pattern as renderer-logic.js).
// When changing definitions or behaviour here, mirror the change in renderer/app.js.

// ── Shortcut Definitions ─────────────────────────────────────
// User-configurable shortcuts.
const SHORTCUT_DEFS = [
  { id: 'newTab',        label: 'Neuer Tab',              category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 't' } },
  { id: 'closeTab',      label: 'Tab schließen',          category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'w' } },
  { id: 'nextTab',       label: 'Nächster Tab',           category: 'Tabs', default: { ctrl: true,  shift: false, alt: false, key: 'Tab' } },
  { id: 'prevTab',       label: 'Vorheriger Tab',         category: 'Tabs', default: { ctrl: true,  shift: true,  alt: false, key: 'Tab' } },
  { id: 'focusInput',    label: 'Eingabe fokussieren',    category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'l' } },
  { id: 'search',        label: 'Suche',                  category: 'Chat', default: { ctrl: true,  shift: false, alt: false, key: 'f' } },
  { id: 'showShortcuts', label: 'Tastenkürzel anzeigen',  category: 'UI',   default: { ctrl: true,  shift: false, alt: false, key: '/' } },
];

// Hard-coded shortcuts shown in help only — not user-configurable.
const FIXED_SHORTCUTS = [
  { label: 'Tab 1–8 direkt',   binding: { ctrl: true,  shift: false, alt: false, key: '1–8' },    category: 'Tabs' },
  { label: 'Letzter Tab',      binding: { ctrl: true,  shift: false, alt: false, key: '9' },       category: 'Tabs' },
  { label: 'Aktion abbrechen', binding: { ctrl: false, shift: false, alt: false, key: 'Escape' },  category: 'Chat' },
];

/**
 * Returns the active binding for a shortcut id, taking user prefs into account.
 * Falls back to the default binding when no override exists.
 * Returns null for unknown ids.
 */
function resolveShortcut(prefs, id) {
  const def = SHORTCUT_DEFS.find(d => d.id === id);
  if (!def) return null;
  return (prefs && prefs[id]) || def.default;
}

/**
 * Strict comparison of a KeyboardEvent-like object with a binding.
 * Boolean modifier flags must match exactly.
 */
function matchShortcut(e, binding) {
  if (!e || !binding) return false;
  return e.key === binding.key
    && !!e.ctrlKey  === !!binding.ctrl
    && !!e.shiftKey === !!binding.shift
    && !!e.altKey   === !!binding.alt;
}

/**
 * Renders a binding as a human-readable label, e.g. "Ctrl+Shift+Tab".
 * Space is rendered as "Space" for clarity.
 */
function shortcutLabel(binding) {
  if (!binding) return '';
  const parts = [];
  if (binding.ctrl)  parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt)   parts.push('Alt');
  parts.push(binding.key === ' ' ? 'Space' : binding.key);
  return parts.join('+');
}

module.exports = {
  SHORTCUT_DEFS,
  FIXED_SHORTCUTS,
  resolveShortcut,
  matchShortcut,
  shortcutLabel,
};

// ── Shared Utilities ──────────────────────────────────────────
// Loaded before all other modules — provides common helpers
'use strict';

// ── UI Constants (shared across all modules) ─────────────────
const SCROLL_BOTTOM_THRESHOLD = 60;
const NOTIFICATION_FREQUENCY_HZ = 880;
const NOTIFICATION_DURATION_S = 0.3;
const TOAST_DISPLAY_MS = 3000;
const TOAST_FADE_MS = 300;
const CHAT_INPUT_MAX_HEIGHT = 150;
const TERMINAL_SCROLLBACK = 1000;
const TERMINAL_FIT_DELAY_MS = 150;
const RESIZE_FIT_DELAY_MS = 100;
const SESSION_REFRESH_DELAY_MS = 400;

// truncatePath/escapeHtml/escapeAttr/escapeAttrJs/toolIcon/toolDisplayName/
// formatToolArgs/toolArgFullText/formatToolResultPreview and their length
// constants live in src/renderer-logic.js (the single tested source — see
// its own comment on why it's IIFE-wrapped) and are pulled in here as bare
// names so the rest of the renderer can keep calling them unprefixed.
const {
  truncatePath, escapeHtml, escapeAttr, escapeAttrJs,
  toolIcon, toolDisplayName, formatToolArgs, toolArgFullText, formatToolResultPreview,
  buildAgentPrefix, formatSubscriptionUsage, mergeRateLimitWindows, parseUsageWindows,
  TOOL_ARGS_MAX_LENGTH, TOOL_PREVIEW_MAX_LENGTH,
} = window.RendererLogic;

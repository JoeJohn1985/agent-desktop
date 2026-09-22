# Agent Desktop

Electron desktop app embedding multiple LLM providers (Copilot CLI, Claude
Code, Anthropic, Gemini, OpenAI, GLM, Ollama) in one chat UI. Full
architecture (arc42): `docs/ARCHITECTURE.md`. User-facing docs:
`docs/USER-GUIDE.md`. Known issues: `docs/known-issues.md`. Read this file
first — it's the fast orientation; the docs above are the deep dive.

## Renderer structure — read before editing `renderer/*.js`

The renderer runs with `nodeIntegration: false` and no bundler → **no
`require()`, no ES modules.** Every file below is a flat classic `<script>`
tag (`renderer/index.html`), sharing one global scope: top-level
`function`/`const`/`let` become implicit globals via load order, not via
imports. The only real namespace is `window.RendererLogic` (see below).
Load order only matters for values read at a file's own top-level (parse
time) — cross-file *function calls* work regardless of order, since every
script has finished loading before `DOMContentLoaded` fires.

`renderer/app.js` (~4.7k lines) hosts what hasn't been extracted yet: tab
management (`switchTab`/`closeTab`/`createTab`), the central agent-IPC event
dispatcher (`initAgentIPC`), the model/provider catalog, `initSettings`, and
usage/cost display glue. These are intentionally **not** split further — see
`plans/app-js-modularization.md` (Phase 2) for why: high fan-out, tightly
coupled, needs a slower, more careful pass than the mechanical Phase 1 move.

`renderer/modules/*.js` — one file per concern, loaded before `app.js`:

| Module | Purpose |
|---|---|
| `utils.js` | Shared UI constants, generic helpers (tags, button-busy, empty-state, toasts, notification sound, date formatting, tooltips) — loads first among the modules |
| `dev-console.js` | In-app dev console (log capture, filter, copy) |
| `todos.js` | Per-session task list |
| `images.js` | Image thumbnails, lightbox, drag&drop into chat |
| `test-runner.js` | Jest/Playwright/coverage frontend |
| `session-tools.js` | Session-specific denied-tools popup |
| `costs.js` | Cost-log persistence + the Costs page (chart, Claude token-history) |
| `skills-mcp.js` | Skills/Agents/MCP sidebar rendering + per-tab context loading |
| `sessions-sidebar.js` | Named-session list, search, rename, resume, delete, history-bubble rendering |
| `keyboard-shortcuts.js` | Configurable shortcut defs, settings panel, global keydown dispatch |
| `drag-drop.js` | Whole-window file drop handling |
| `self-update.js` | Git-based app self-update + Claude Code adapter update checker |
| `provider-settings.js` | API-provider key/base-URL settings, per-provider config tabs, SSH remote-folder picker |
| `chat-search.js` | In-chat search bar (Ctrl+F) |
| `plugins.js` | Plugin/marketplace manager + chat/plugins/costs view switching |
| `onboarding.js` | First-run wizard + post-onboarding tutorial popups |

A module's own state (e.g. `sessions`, `mcpServers`, `activeAgents`) is
sometimes read or mutated from `app.js` too — same cross-file bare-global
pattern as `tabs`/`activeTabId`. If you add a `let` that another file
reassigns, ESLint's `prefer-const` won't see the cross-file write and will
wrongly suggest `const`; don't take that suggestion — add a one-line
`// eslint-disable-line prefer-const` explaining where the real reassignment
lives instead.

## Where does logic go?

Pure, side-effect-free logic (parsing, formatting, pricing tables, window
bucketing, model-list filtering) belongs in `src/renderer-logic.js` — a UMD
module (`window.RendererLogic` in the browser, `module.exports` under Jest).
**This is the only renderer-side code directly unit-tested.** DOM glue in
`renderer/app.js` and `renderer/modules/*.js` is not unit-tested by
convention — if you're adding non-trivial logic there, extract the pure part
into `renderer-logic.js` first, write a test for it, then call it from the
glue code.

## Plans

Multi-step or resumable work goes in `plans/<slug>.md` (Ziel /
Ausgangslage / Design-Entscheidungen / Tasks / Status — copy the shape of an
existing file in `plans/`). Check `plans/` before starting non-trivial work;
update the relevant plan as you go so another session can pick it up.

## Conventions

- Languages: code & tests use English identifiers; UI strings and comments
  are German; docs (like this one) are English.
- Every meaningful change: version bump in `package.json` + a `CHANGELOG.md`
  entry + a commit ending `Co-Authored-By: Claude <noreply@anthropic.com>`
  (model name varies). The pre-commit hook runs ESLint + the full Jest suite.
- Never push without being explicitly asked.

# Changelog

## [1.2.6] - 2026-07-09

### Added
- **Abo-Limits mit echten Prozentwerten.** Der `rate_limit_event`-Stream liefert
  zwar Fenster + Status + Reset, aber meist keinen Prozentwert. Die konkrete
  Auslastung steht im `/usage`-Output, den die App nach jedem Turn ohnehin
  abruft. Neuer reiner, unit-getesteter Parser `parseUsageWindows()` liest die
  Zeilen `Current session: … % used` und `Current week (all models): … % used`
  (inkl. modellspezifischer Wochen-Buckets) und speist sie in die Anzeige. Die
  Session-Leiste zeigt jetzt z. B. `Abo · 5 Std. 35 % · Woche 3 %` — dieselben
  Werte wie die offizielle Claude-App. Reset-Zeitpunkte je Fenster stehen im
  Tooltip; modellspezifische Buckets erscheinen dort ebenfalls.
  Die Resets werden als **Live-Countdown** angezeigt (z. B. „Reset in 3 Std.
  59 Min." bzw. „Reset in 6 Tagen 16 Std.") statt als absolutes Datum — der
  `/usage`-Zeitstempel wird dafür geparst (`parseResetTextToMs`) und über
  `formatDurationDe()` formatiert.

### Fixed (behebt, dass die %-Anzeige gar nicht erschien)
- Für Subscription-Provider (Claude Code) wurde `/usage` nach einem Turn bewusst
  **nicht** abgefragt (Annahme: „Quota kommt live via `usage_update`"). Da der
  Stream aber keinen Prozentwert liefert, blieb die Anzeige bei „Abo". Neue
  `refreshSubscriptionUsage()` holt `/usage` jetzt auch für Claude-Code-Tabs.

### Fixed
- **`utilization` wurde als Bruch fehlinterpretiert.** SDK und `/usage` liefern
  die Auslastung als 0–100; die vorherige „≤1 → ×100"-Heuristik hätte „1 %
  genutzt" fälschlich als „100 %" angezeigt. `normalizeUtilizationPct()` rundet
  und klemmt den Wert jetzt korrekt auf 0–100.

## [1.2.5] - 2026-07-09

### Fixed
- **Abo-Nutzungsanzeige (Claude Code) war ungenau**: Die Session-Leiste warf
  `allowed_warning` und `rejected` in einen Topf und zeigte in beiden Fällen
  „⚠️ Abo · Limit erreicht", obwohl `allowed_warning` nur „fast erreicht"
  bedeutet (noch nicht geblockt).

### Changed
- **Abo-Limits: 5-Stunden- und Wochen-Fenster gemeinsam.** Jedes
  `rate_limit_event` des Claude-Adapters trägt nur das gerade *bindende*
  Fenster (`rateLimitType`); die Anzeige sammelt die Events jetzt pro
  Fenster-Familie (`mergeRateLimitWindows()`), sodass 5-Stunden- **und**
  Wochen-Limit nebeneinander erscheinen. Neue reine, unit-getestete Funktionen
  in `src/renderer-logic.js`: `rateLimitFamily()`, `mergeRateLimitWindows()`
  und ein überarbeitetes `formatSubscriptionUsage()`. Die Leiste bleibt ruhig,
  solange alles im grünen Bereich ist, und zeigt bei Annäherung das dringlichste
  Fenster zuerst mit sauber getrenntem Status (`allowed_warning` → „fast
  erreicht" vs. `rejected` → „erreicht"). Reset-Zeit, Overage-Status und
  Token-Äquivalent stehen (je Fenster) im Tooltip.
  Hinweis: Der Live-Stream liefert `utilization` (den Prozentwert) meist nicht
  mit — die konkrete %-Anzeige folgt separat über die `/usage`-Abfrage.

## [1.2.4] - 2026-07-08

### Fixed
- **Settings "Features" matrix was stale**: `PROVIDER_CAPABILITIES` still
  listed `skills`/`agents` as unsupported for Claude Code, Anthropic, OpenAI,
  GLM and Ollama from before those providers got the lazy-loaded per-provider
  Skills/Agents index. Since the same table also drives
  `updateSidebarForProvider()`, this was hiding the Skills/Agents sidebar
  sections for those providers' tabs, not just mislabeling the matrix.
  Gemini stays `false` (deliberately excluded, kept context-light).

## [1.2.3] - 2026-07-08

### Changed
- Extracted the `agentPrefix` builder (Copilot's `/agent Name` syntax vs. the
  plain-language persona hint for every other provider) out of `app.js` into
  a pure, unit-tested `buildAgentPrefix()` in `src/renderer-logic.js`. This
  logic previously had no automated test coverage, despite a prior real bug
  in the same code path.
- Added `docs/CODE-REVIEW-PLAN.md` and `docs/QUALITY-AUDIT-PLAN.md`: chunked,
  multi-day plans for a full-codebase code review and quality audit.

## [1.2.2] - 2026-07-08

### Changed
- `AGENTS.md`: the commit-message rule now documents the Conventional Commits
  style (`type(scope): description`) actually in use, replacing the stale
  `vX.Y.Z: description` prefix convention.

## [1.2.1] - 2026-07-08

### Fixed
- **Path traversal in `sessions:readClaudeCodeTranscript`**: `sessionId` was
  joined into the transcript file path unchecked; now validated against a
  strict `[a-zA-Z0-9-]+` allow-list (Claude Code session IDs are UUIDs)
  before the path is built.
- **Path traversal in `skills:listProvider`/`agents:listProvider`**: the
  `provider` IPC argument reached `path.join` unchecked; both handlers now
  validate against the known provider allow-list.

### Changed
- Documentation (`README.md`, `docs/ARCHITECTURE.md`, `docs/USER-GUIDE.md`)
  updated for 1.2.0's per-provider Skills/Agents, the Claude Code history
  restore, and the tool-call rendering change; a few pre-existing gaps fixed
  along the way (missing IPC channels, `src/agents.js` mislabeled as
  "sub-agent directory").

## [1.2.0] - 2026-07-08

### Added
- **Skills for every provider**: provider-scoped folders under
  `~/.agent-desktop/<provider>/skills` (Claude Code, Anthropic, OpenAI, GLM,
  Ollama — Copilot keeps its native `~/.copilot/skills`; Gemini stays
  context-light on purpose). Exposed as a lazy index (name + description +
  file path) instead of inlining full content — the model reads a skill's
  `SKILL.md` itself via its file tool only once it judges it relevant.
  Sidebar's Skills section now follows the active tab's provider.
- **Agents for every provider**, same shape as Skills:
  `~/.agent-desktop/<provider>/agents`, lazy index, provider-aware sidebar.
  Unlike Skills, agents are a persona switch — if a task matches an agent's
  description, the model reads its `.agent.md` and adopts that
  approach for the rest of the task (real sub-agent delegation is a separate,
  later effort). The manual "activate" toggle still works everywhere as an
  explicit override on top of the automatic selection.
- **Claude Code session history on reopen**: tabs resumed from the sidebar (or
  restored after an app restart) now restore the full prior conversation for
  Claude Code too, read from its own native transcript
  (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) — previously the tab
  came back empty because it was wrongly routed through the direct-API
  history store.
- Tool-call rendering: the always-visible summary line (both the pending call
  and its result) is now length-capped instead of growing without bound; the
  full untruncated text stays one click away in an expandable block, so
  nothing is lost — just not dumped as a wall of text by default.

### Fixed
- Claude Code's own permission modes (default/acceptEdits/plan/
  bypassPermissions) are now the sole authority over approvals — the
  app-level "Auto" toggle no longer fights with them (hidden for Claude Code
  tabs; Copilot is unaffected).
- Sidebar tab icon (`.tab__provider-icon`) is properly vertically centered.
- Several silently-dropped/duplicated code paths cleaned up along the way:
  `formatToolArgs`/`toolIcon`/`escapeHtml`/… existed twice (an untested copy
  in `renderer/modules/utils.js` was silently shadowing the tested
  `src/renderer-logic.js` versions) — consolidated onto the single tested
  source.

### Changed
- `.chat-input-bar` padding tightened (`12px 16px` → `6px 16px`).

### Added
- **New provider: Claude Code (Beta)** — use Claude Code via the ACP adapter
  (`@agentclientprotocol/claude-agent-acp`, launched through `npx`), billed
  through your **Claude subscription** (no API key; `ANTHROPIC_API_KEY` is
  stripped from the child process). Fully integrated:
  - **Explicit ProviderID per tab** (`tab.provider`) as the authoritative
    discriminator — Claude Code and the Anthropic API share model ids, so the
    provider now comes from the tab/session, not the model.
  - **Model & mode selection** via `session/set_config_option` (the adapter's
    config-options API); models (Sonnet 5, Opus 4.8, Haiku 4.5, Fable) and the
    permission modes (default/auto/acceptEdits/plan/dontAsk/bypassPermissions)
    are discovered and persisted.
  - **Live context %** and **subscription quota display** (rate-limit reset,
    out-of-credits warning) from `usage_update`; no USD billing.
  - **Named sessions in the sidebar** like Copilot (provider-tagged), resumed
    with the right backend.
  - **Live CLI status** in the API-providers settings.
- **Interactive permission handling (ACP `session/request_permission`)** for
  Copilot **and** Claude Code — a dropup above the chat input shows the agent's
  offered options (allow once/always, reject), queued if several arrive. New
  per-tab approval toggle; a global "manual approval" setting drops Copilot's
  `--allow-all` so it asks per action (default off = unchanged).
- **Setup: auto-install Node.js via winget** when missing (best-effort, refreshes
  the session PATH), with a clear manual fallback.

### Fixed
- Default model per provider is validated against the provider's actual (incl.
  discovered) model list, so a Copilot/Claude Code default is applied and saved.
- `setup.ps1` no longer aborts with a raw "node not recognized" error when Node
  is missing (uses `Get-Command`); rebranded to "Agent Desktop".
- Model button shows the version (e.g. "Sonnet 5", not "Sonnet") for Claude Code.
- ACP `#ensureReady` waits for a starting backend instead of failing fast (npx
  adapter spawn race).

### Changed
- Copilot-only controls (tools deny-list, skill/agent prompt prefixes) are hidden
  for Claude Code tabs; the mode dropdown shows Claude Code's own modes.

## [1.0.1] - 2026-07-03

### Fixed
- **Default model per provider not applied/saved for Copilot**: the configured
  default was validated only against the hardcoded `DEFAULT_MODELS` list, so a
  Copilot (or any dynamically discovered) model chosen as default was rejected
  and fell back to Sonnet 4.6 — which also made the settings dropdown look as if
  the selection wasn't saved. `getDefaultModelForProvider` now validates against
  the provider's actual model list (incl. discovered models).

## [1.0.0] - 2026-07-02

First stable release. The core feature (GitHub Copilot CLI) is fully tested; the
direct-API providers are labelled by maturity as **Beta** (Gemini) or **Alpha**
(Anthropic, OpenAI, GLM, Ollama).

### Added
- **Dynamic model discovery for all providers** — models are discovered live via
  the `/models` endpoint (Anthropic, Gemini, OpenAI, GLM, Ollama) or via ACP
  (Copilot) and persisted. When a new model appears, an info message is shown.
  (`src/model-discovery.js`, IPC `providers:listModels`)
- **Alpha/Beta maturity labels** per provider with a tooltip (Beta: "tested, not
  final", Alpha: "untested"); Copilot has no label.
- **Diagnostic logging** (full unknown ACP events + raw `/usage` text) to
  investigate sub-agent / usage signals.

### Changed
- **Internal rename `copilot-desktop` → `agent-desktop`** (app identity,
  `app.name`, data directory `~/.agent-desktop`, Electron `userData`). On first
  start the app automatically migrates existing data (preferences, encrypted
  API keys, sessions, logs) from the old identity — on Windows the keys stay
  valid (DPAPI). The provider id `copilot` and the IPC channels are intentionally
  kept unchanged (they reference the real Copilot integration). (`src/data-dir.js`)
- **Optimized tab bar**: active tab large (full label + actions), the rest
  compact (3-char short label, separator borders, actions on hover only); app
  icon removed; close ✕ in the right corner.

### Fixed
- **Cost billed per message using the model actually used** (frozen at send time)
  — switching models between two prompts no longer re-prices earlier tokens at
  the new price.
- **Tool calls visible for Copilot (ACP)**: `kind` is now remembered across
  `tool_call_update` (correct icon instead of hidden); the tool call is rendered
  centrally in `tool.execution_start`.
- **MCP tool calls** (e.g. Playwright) are no longer hidden (generic 🔧 icon +
  meaningful argument display).
- **Tool result no longer shown three times** (ACP status updates are deduplicated
  by `toolCallId` and updated in place).
- **Missing paragraph break between sentences** at `report_intent` boundaries fixed.
- **After loading a session** the view scrolls to the bottom (latest message).

<!-- The following entries were previously under [Unreleased] and are part of 1.0.0. -->

### Added
- **Three new providers: OpenAI, Ollama, GLM (Zhipu)** — fully agentic via a shared OpenAI-compatible core (chat completions + function calling, SSE streaming, dependency-free). Ollama is local & keyless; the base URL is overridable per provider in the settings. (`src/providers/openai-compatible-provider.js` + `openai/ollama/glm-provider.js`)
- **Default provider + default model per provider** in the settings; also fixes the bug where Copilot always started with Haiku instead of the selected model
- **Model labelling** in the dropdown: 💲 paid / 🆓 free / AIC (Copilot subscription)
- **Context usage** updates automatically after every message (all providers)
- **Quota / rate-limit errors** are shown as a readable message instead of raw JSON (Gemini/Anthropic/OpenAI)

### Changed
- **Cost in real USD** instead of mixed AI Credits (Copilot 100 AIC = $1); **cost window groupable by provider** (provider/session toggle)
- **Git-based self-update**: on start, periodically (every 6h), and via a button in *Settings → UI*, the app checks via `git ls-remote --tags origin` whether a newer release tag (`vX.Y.Z`) exists (compared against the local `package.json` version, stable tags only). When an update is available a "New version available" banner appears with "Download & restart": given a clean working tree → `git pull --ff-only origin main`, automatic `npm install` if dependencies changed, then restart. No embedded token — uses the user's Git credentials (works with the private repo too). (`src/updater.js`, IPC `updates:check`/`updates:apply`)
- **Gemini 3.5 Flash** added to the model selection (pricing provisionally like 2.5 Flash until officially confirmed)
- **Info tooltip per provider** in the API-provider settings (ⓘ): lists available tools and specifics per provider on hover
- **Auth hint with login + restart**: on "sign-in required", a button opens a visible terminal running `copilot login`; afterwards a "Restart app" button (needed because auth is picked up at main-process start)

### Changed
- **Todos are now project- instead of session-scoped**: stored as a markdown checklist under `<cwd>/todo/todos.md` (with invisible ID comments for lossless round-trips) instead of `<session>/todos.json`. This way the todo list survives session deletion and is shared by all sessions in the same directory. (`src/todos.js`, IPC `todos:*` now cwd-based)
- **Gemini: live search and file tools togglable per tab** instead of combined — Gemini 2.5 forbids both in the same request (400 `INVALID_ARGUMENT`). The "🔍 Research" (default) or "📁 Files" mode can be switched per tab at any time
- **Session deletion to the recycle bin** (`shell.trashItem`) instead of irreversible `fs.rmSync`; additionally a non-empty `todos.json` is backed up to `~/.agent-desktop/deleted-todos/` before deletion
- **Multi-line tooltips**: `.js-tooltip` now uses `white-space: pre-line` (line breaks are rendered)

## [0.32.0] - 2026-06-24

### Added
- **Multi-LLM provider: Anthropic API (fully agentic)** — alongside the Copilot CLI, the Anthropic API can now be used directly per tab. Own agent loop with local tool execution (`shell`, `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`), streaming, adaptive thinking, and token-accurate cost accounting. (`src/providers/*`, `src/secure-store.js`)
- **Multi-LLM provider: Google Gemini (research-oriented)** — Gemini 2.5 Pro/Flash as a direct API. **Live Google search** (grounding) with automatic source citations + file tools (read/write/edit), but no shell and no skills/agents/instructions. (`src/providers/gemini-provider.js`, `@google/genai`)
- **Provider selection on new tab**: clicking "+" opens a provider dropdown (Copilot, Gemini, Anthropic, OpenAI); the provider is fixed per tab. The session bar shows the provider as a read-only indicator next to the cost
- **Secure API-key storage** via the OS keychain (Electron `safeStorage`); new "API providers" settings tab. Keys never leave the main process
- **Skills, agents, and `copilot-instructions.md`** are injected as (cached) system-prompt context for the direct API
- **Prompt caching** for the Anthropic API (the growing system/tool/history prefix is cached)
- **Context management for direct providers**: `📊 %` display + **automatic compaction** above 80% usage
- **Session persistence + redisplay** for direct-API sessions (history under `~/.agent-desktop/api-sessions/`)
- **Cache-write tokens** (1.25× input) are accounted for in the cost calculation

### Changed
- The direct-API `shell` tool runs on Windows via **PowerShell** instead of cmd.exe (platform-dependent via `spawn`)

### Fixed
- **ACP `session/prompt` timeout (critical)**: longer Copilot turns (> 60s) hit a fixed 60-second timeout → "[process exited with code 1]" while the CLI kept running and the response streamed on forever (the UI stayed stuck on "Running"). `session/prompt` no longer has a timeout (bounded by cancel/process exit); silent slash commands use 180s
- **Merged messages**: consecutive response segments around tool calls ("… calling:Now …") were rendered into one bubble. A tool call now closes the response bubble → separate, readable messages (Copilot and direct API)
- **Provider dropdown**: fixed missing panel background / wrong position on the "+" provider menu (dedicated panel class, fixed positioning)

## [0.31.0] - 2026-06-19

### Added
- **Credit estimation from token usage**: `/usage` returns input/output/cache tokens, from which the app computes estimated AI Credits (`~12.5C`) via a model-price table (Sonnet 4.6: 300/30/1500C, Opus 4.8: 500/50/2500C per 1M tokens)
- **Cost history in settings**: new "Cost" settings tab with a stacked bar chart (day/week view), breakdown by session, grand total, and a clear-history button
- **Cost log**: delta cost per prompt is persisted in `preferences.json` (key `costLog`); max 5,000 entries
- `buildCostBuckets`, `aggregateCostBySession`, `trimCostLog` as testable pure functions in `src/renderer-logic.js`
- **Haiku 4.5 pricing** in the model-price table (input 100C, cache 10C, output 500C per 1M tokens)

### Changed
- **Cost as its own page instead of a settings tab**: the cost listing now opens as a dedicated full-screen page like the plugin marketplace (more room for growing data) — reachable via a 📈 icon in the session bar. The "Cost" settings tab is removed
- **AIC display always visible**: the credit display shows `~0C` before the first prompt instead of being empty
- The session bar now shows `~X.XC` instead of AIU (falls back to AIU/AIC when the model price table doesn't apply)
- `parseUsageTokens`, `parseUsageRequests`, `estimateCredits`, `MODEL_PRICING` moved from `renderer/app.js` to `src/renderer-logic.js` (testable)
- **Cost panel moved to `renderer/modules/costs.js`** — `renderer/app.js` slimmed down, cost log and chart logic in their own module
- **Cost tracking for background tabs too**: `refreshUsageDisplay` now runs after every completed prompt, not only for the active tab

### Fixed
- **Cost calculation on model switch**: per prompt, only the **token increment** since the last reading is now priced at the current model's rate (`estimateCreditsDelta`). Previously the cumulative token total was priced entirely at the current rate, so a model switch retroactively re-priced tokens consumed under the old model (too-high/low deltas, sometimes 0 when switching to a cheaper model). Negative deltas (after `/clear`/`/compact`) are clamped to 0
- **`require is not defined` in the renderer (critical)**: `renderer/app.js` used `require('../src/renderer-logic')`, which threw a `ReferenceError` in the renderer (nodeIntegration: false, no bundler) and aborted all of app.js (e.g. `toggleSection is not defined`). `renderer-logic.js` is now UMD-wrapped (IIFE) and exposes `window.RendererLogic`; app.js reads from that instead of via `require`
- **Cost panel showed no data**: 3 mis-named CSS variables (`--bg-secondary`/`--bg-primary`/`--border-color` → `--bg-hover`/`--bg-surface`/`--border`) — canvas background and separators were invisible
- **Y-axis grid lines barely visible in the light theme**: `drawCostsChart` read the non-existent CSS variable `--border-color` instead of `--border`
- **Silent errors in `refreshUsageDisplay`**: `catch (_) {}` replaced with logging
- `niceStep(0)` guarded (avoided a potential `NaN` on an empty chart)

## [0.29.1] - 2026-06-18

### Fixed
- **Model IDs in the pricing map**: dots instead of hyphens (`claude-sonnet-4.6` not `claude-sonnet-4-6`) — credits weren't computed, AIU was shown instead

## [0.29.0] - 2026-06-18

### Added
- **Context button as a dropdown**: the `📊 Context` button now shows the current usage in % directly in the button (`📊 18%`) and opens a dropdown with three actions on click:
  - **Show context**: detail panel with token usage (categories, percentage, color-coded)
  - **Compact**: summarizes the conversation and updates the % display
  - **Clear**: clears the context, then re-queries `/context`
- **Tools button**: `🔧 Tools` button next to the context button — opens a popup for session-specific denied tools
- **AIU/credit display in the bar**: on the right of the session action bar, the current session's usage is shown as text
- **Session-specific tool denial with process restart**: changes to the session deny list (add, toggle, delete) automatically restart the ACP process and reload the session via `session/load`
- IPC handler `copilot:restartWithDeniedTools` in `main.js`
- Preload bridge `copilot.chat.restartWithDeniedTools`

### Changed
- Session action bar restructured: Model → Agent → Context (dropdown) → Tools | Usage
- Pin function for session tools removed

### Fixed
- **Mode dropdown opened upwards**: wrong CSS class name (`mode-dropdown--below` instead of `model-dropdown--below`) — the dropdown now opens correctly downwards

## [0.28.0] - 2026-06-xx

### Added
- **ACP backend migration**: all communication with the Copilot CLI now runs over `copilot --acp` (Agent Communication Protocol, JSON-RPC over NDJSON stdio)
- `AcpClient` (`src/acp-client.js`): encapsulates session management, prompt streaming, event mapping, and `silentCommand()`
- **`silentCommand(command)`**: slash commands (`/context`, `/usage`, `/compact`, `/clear`) run as silent ACP requests — the result does not go into the chat
- IPC handler `copilot:silentCommand` in `main.js`
- Preload bridge `copilot.chat.silentCommand`
- `acpClients` map in `main.js` (tabId → AcpClient)

### Removed
- **PTY terminal fully removed**: no `node-pty`, no `xterm.js`, no terminal panel
- `renderer/modules/terminal.js` deleted
- `src/ipc/terminal-ipc.js` deleted
- `src/main-helpers.js`: `collectPtyOutput`, `waitForReady`, `isCopilotTuiReady`, `detectCopilotPrompt`, `cleanupPty` removed

### Changed
- Slash commands no longer run via PTY bracketed paste but via `silentCommand()`
- Process management: one long-lived ACP process per tab (instead of spawn-per-message)

## [0.25.0] - 2026-05-21

### Added
- **CWD per session**: the working directory can be chosen per tab/session by clicking 📂 in the statusbar
- CWD is persisted for named sessions and restored on resume
- `saveSessionCwd` / `getSessionCwd` in `src/named-sessions.js`

## [0.24.6] - 2026-05-28

### Added
- **Application icon**: `assets/icon.png` (512×512 RGBA) for window, titlebar, tab bar, and dock
- **Linux desktop integration**: `assets/copilot-desktop.desktop` with `StartupWMClass=copilot-desktop`
- **WM_CLASS fix**: `--class copilot-desktop` via Chromium switch on Linux

## [0.24.0] - 2026-05-21

### Added
- **Disable skills in the CLI**: toggle button per skill — skills can be disabled in `~/.copilot/settings.json`
- IPC handlers `skills:getDisabled` and `skills:setDisabled`
- **Persist sidebar collapse state**: collapsed sections are saved
- **Content sync plain↔rich**: content is transferred on mode switch

### Fixed
- Rich-text list rendering, skill-card button order, content sync on empty content

### Removed
- Strikethrough button from the rich-text toolbar

## [0.23.0] - 2026-05-29

### Added
- **Rich-text editor toggle**: ✏️/📝 button — plaintext or rich-text mode. Toolbar with Bold, Italic, UL, OL. HTML→Markdown on send.
- **Model dropdown redesign**: accent bar on the left + background instead of a checkmark
- **Model order**: Haiku → Sonnet → Opus 4.6 → Opus 4.7

### Fixed
- Model persistence after app restart, model persistence for new sessions

## [0.21.0] - 2026-05-14

### Added
- Full JSDoc comments for all main files (main.js, preload.js, renderer/app.js, todos.js, scanners.js)

## [0.20.5] - 2026-05-14

### Added
- Tutorial flags in `folders.json` (key whitelist: `tutorialSkillsShown`, `tutorialRenameShown`)
- IPC handlers `tutorial:getFlags` / `tutorial:setFlag`
- Tutorial popups auto-close after 30s (closed guard)
- `tab:renamed` CustomEvent on tab rename

## [0.18.2] - 2026-05-12

### Added
- First-run onboarding wizard (4 steps: auth, folders, agents/skills, feature intro)
- Tab-unlock fallback after 180s inactivity

## [0.16.1] - 2025-06-17

### Added
- Tab-unlock fallback for hanging sub-agents (30s manual, 180s automatic)
- Activity tracking (`lastActivityAt`)

## [0.16.0] - 2025-06-16

### Added
- Plugin manager, session resume (plan + last messages as chat messages)

## [0.15.0] - 2025-06-15

### Added
- Agents panel in the sidebar — scans `~/.copilot/agents/*.agent.md`
- `src/agents.js`: `scanAgentsDirectory()`

## [0.14.4] - 2025-06-15

### Security
- XSS fix in `openInstructionsEditor`

### Fixed
- Model rollback on switch error, event-listener leak on window close

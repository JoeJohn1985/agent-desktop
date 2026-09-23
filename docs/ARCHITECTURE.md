# Agent Desktop — Architecture (arc42)

> **Version:** 1.0.0 · **Date:** July 2026 · **Stack:** Electron 35, ACP (JSON-RPC/NDJSON), @anthropic-ai/sdk, @google/genai, marked, highlight.js, jest
>
> Note: internally the app was called `copilot-desktop` until 1.0. With 1.0 the
> app identity was renamed to `agent-desktop` (data path `~/.agent-desktop`,
> Electron `userData`), including automatic migration. The provider id `copilot`
> and the IPC channels `copilot:*` remain (they reference the Copilot integration).

---

## 1. Introduction and goals

### 1.1 Requirements overview

**Agent Desktop** is an Electron desktop app that embeds multiple LLM providers (primarily the `copilot` CLI / GitHub Copilot CLI, plus Anthropic, Gemini, OpenAI, GLM, Ollama) into a polished chat interface. Instead of working on the command line, the user gets:

- Markdown rendering with syntax highlighting
- Multi-tab sessions that talk to the CLI in parallel (via the **ACP protocol**)
- Persistent sessions, skills, tools, and permissions
- Drag & drop for files and images
- Context monitoring (`/context`) and management (`/compact`, `/clear`) directly from the UI
- Themes (Light, Dark), settings, sub-agent routing, test runner
- Cost tracking based on token usage and model prices

### 1.2 Quality goals

| Priority | Quality goal | Rationale |
|---|---|---|
| 1 | **Reliable CLI integration** | The app is useless if the ACP process breaks or events are lost. |
| 2 | **Cross-platform operation** | Primary target Windows 11; Linux & macOS must work. |
| 3 | **UI responsiveness** | Streaming responses without frame drops, even for long markdown output. |
| 4 | **Security** | Renderer without Node integration; everything via `contextBridge`. DOMPurify against XSS in CLI output. |
| 5 | **Testability** | Any logic that doesn't strictly need Electron lives in `src/` with unit tests (>500 tests). |

### 1.3 Stakeholders

| Role | Expectations |
|---|---|
| **End user (developer)** | Fast, stable GUI access to Copilot with everything the CLI can do + UI comfort |
| **Maintaining developers** | Clear module boundaries, thorough tests, readable docs |
| **Security review** | Clean renderer/main separation, no direct `eval`/Node access in the renderer, sanitized HTML output |
| **Ops / setup** | `setup.ps1` / manual instructions must work on fresh machines — see README |

---

## 2. Constraints

### 2.1 Technical

- **Electron 35.x** as the runtime (Chromium + Node.js).
- **GitHub Copilot CLI** (the `copilot` binary from `gh extension install github/gh-copilot`) must be findable in the process PATH (only for the Copilot provider).
- **ACP (Agent Communication Protocol):** the app communicates with the CLI exclusively via `copilot --acp` (JSON-RPC over NDJSON on stdio). No direct CLI spawning with `--output-format json`, no PTY anymore.
- **No own cloud component** — Copilot roundtrips go through the locally installed Copilot CLI; the direct-API providers call their respective APIs directly.

### 2.2 Organizational

- License: Apache-2.0
- Branch workflow: no direct push to `main`. Feature/fix branches with conventional commits.
- Versioning: SemVer; patch or minor bump in `package.json` before every commit.

### 2.3 Conventions

- **Languages:** code & tests use English identifiers; comments/UI in German, docs in English.
- **Linter:** ESLint flat config (`eslint.config.mjs`).
- **Tests:** Jest (unit) + Playwright (E2E under `e2e/`).

---

## 3. Context and scope

### 3.1 Business context

```
                ┌──────────────────────────┐
                │   User (developer)       │
                │   mouse, keyboard,       │
                │   drag&drop, clipboard   │
                └────────────┬─────────────┘
                             │ GUI (Electron window)
                             ▼
   ┌─────────────────────────────────────────────────┐
   │               Agent Desktop (App)               │
   └──┬──────────────┬────────────────┬──────────────┘
      │              │                │
      │ ACP          │ reads/         │ reads/writes
      │ (JSON-RPC)   │ writes         │ (theme, tabs,
      ▼              ▼                ▼   permissions)
 ┌──────────┐  ┌────────────┐  ┌───────────────────────┐
 │ copilot  │  │ ~/.copilot │  │ userData/             │
 │   CLI    │  │ /sessions, │  │   preferences.json    │
 │  --acp   │  │   skills,  │  │ ~/.agent-desktop/     │
 │ (gh ext) │  │ instructns │  │   logs, folders.json  │
 └────┬─────┘  └────────────┘  └───────────────────────┘
      │
      ▼
 GitHub Copilot Cloud  (via CLI; not directly from the app)
```

### 3.2 Technical context

| Interface | Direction | Description |
|---|---|---|
| **Copilot CLI (ACP)** | App ↔ CLI | `copilot --acp` — JSON-RPC over NDJSON on stdin/stdout. Methods: `initialize`, `session/new`, `session/load`, `session/prompt`. Events: `session/update` notifications |
| **Filesystem** | App ↔ Disk | Sessions (`~/.copilot/session-state/`, Claude Code's own `~/.claude/projects/<cwd>/<sessionId>.jsonl`), skills/agents (Copilot's native `~/.copilot/{skills,agents}/`; every other provider's own `~/.agent-desktop/<provider>/{skills,agents}/`), logs (`~/.agent-desktop/logs/`), preferences (`app.getPath('userData')/preferences.json`), folders config |
| **Shell** | App → Shell | Test runner spawns `npm test`, `npm run test:coverage`, Playwright |
| **OS window manager** | App ↔ OS | Native frame disabled; custom titlebar with min/max/close via IPC |

---

## 4. Solution strategy

| Decision | Why |
|---|---|
| **Electron** instead of a web app | Native filesystem and CLI access — impossible in the browser |
| **Renderer without Node integration** | XSS in CLI output must never become RCE. Everything via `contextBridge` in `preload.js`. |
| **ACP instead of JSONL spawn + PTY** | A single long-lived process per tab (instead of spawn-per-message + PTY); slash commands via `silentCommand()` instead of PTY bracketed paste. More robust, easier to test, no more node-pty. |
| **`src/` for pure logic, `src/ipc/` for IPC handlers** | Separates domain logic from Electron bindings → testable without Electron mock hell |
| **`silentCommand(command)`** | Slash commands (`/context`, `/usage`, `/compact`, `/clear`) are issued as silent `session/prompt` requests; the response chunks are collected internally and not forwarded to the UI |
| **`--deny-tool` only at spawn** | ACP has no runtime API for tool denial → process restart (`stop → updateOptions → start → loadSession`) when the session-specific deny list changes |
| **`buildEnv()` for child processes** | On Linux/macOS Electron doesn't source the shell RC → `~/.local/bin` etc. are missing → the `copilot` binary isn't findable. Fixed centrally. |
| **Markdown rendering in the preload** | Marked + Highlight.js + DOMPurify initialized once, exposed to the renderer as a pure function `window.markdown.render` |

---

## 5. Building block view

### 5.1 Whitebox overall system (level 1)

```
┌────────────────────────────── Renderer process ──────────────────────────────┐
│                                                                              │
│  renderer/index.html  ─►  renderer/app.js  (chat, tab, settings logic)      │
│                                                                              │
│           ┌──────────────────── renderer/modules/ ──────────────────┐        │
│           │  16 files, one per concern — see §5.5 for the full list │        │
│           └─────────────────────────────────────────────────────────┘        │
│                              │                                               │
│                              ▼ window.copilot.* / window.markdown.render     │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │  contextBridge (preload.js, sandboxed)
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                                Main process                                  │
│                                                                              │
│  main.js (bootstrap + window + AcpClient management + IPC glue)             │
│     │                                                                        │
│     ├── src/acp-client.js             — AcpClient (JSON-RPC over NDJSON)    │
│     ├── src/ipc/images-ipc.js         — images/videos IPC                   │
│     ├── src/ipc/tests-ipc.js          — test-runner IPC                     │
│     │                                                                        │
│     ├── src/main-helpers.js           — buildEnv, sendToRenderer             │
│     ├── src/renderer-logic.js         — pure logic (parseTokens, pricing, …)│
│     ├── src/preferences.js            — read/write/migrate preferences       │
│     ├── src/sessions.js               — checkpoints, plan, todos, message history │
│     ├── src/claude-code-transcript.js — reads Claude Code's own session transcript │
│     ├── src/named-sessions.js         — user labels for session IDs          │
│     ├── src/data-dir.js               — app data dir; per-provider skills/agents dirs │
│     ├── src/scanners.js               — skills scanner + lazy skills index    │
│     ├── src/agents.js                 — agents scanner + lazy agents index (persona switch, not sub-agent delegation) │
│     ├── src/file-processing.js        — drag&drop pipeline                   │
│     ├── src/logger.js                 — file logger ~/.agent-desktop/logs  │
│     └── src/utils.js                  — stripAnsi, safeSessionPath, …       │
└──────────────────────────────────────────────────────────────────────────────┘
                               │  ACP (JSON-RPC / NDJSON stdio)
                               ▼
                    ┌─────────────────────┐
                    │  copilot --acp      │
                    │  (one process/tab)  │
                    └─────────────────────┘
```

### 5.2 Process separation

| Process | Responsibility |
|---|---|
| **Main process** | Window creation, AcpClient management, file I/O, all IPC handlers |
| **Renderer process** | UI rendering, chat logic, tab state, theme management |
| **preload.js** | Secure bridge between main and renderer via `contextBridge` |

### 5.3 File structure

| File / folder | Description |
|---|---|
| `main.js` | **Electron main process** — window creation, AcpClient management, IPC glue |
| `preload.js` | **Context bridge** — exposes `window.copilot` and `window.markdown` |
| `renderer/index.html` | **App shell** — custom titlebar, sidebar, chat area, settings overlay |
| `renderer/app.js` | **Frontend logic** — tab management, agent-IPC event dispatch, model/provider catalog, settings init, usage/cost display glue (what hasn't been extracted into `renderer/modules/` yet — see §5.5 and `plans/app-js-modularization.md`) |
| `renderer/styles.css` | **All styles** — CSS variables, 2 themes (Light/Dark) |
| `renderer/modules/*.js` | **UI modules**, one per concern — see §5.5 for the full list |
| `src/acp-client.js` | **AcpClient** (Copilot backend) — JSON-RPC over NDJSON stdio, session management, silentCommand |
| `src/providers/*.js` | **Direct-API backends** — registry, `ApiAgentClient` (agent loop), Anthropic adapter, tool runtime, session store, system context |
| `src/secure-store.js` | **Encrypted API-key storage** (Electron `safeStorage`) |
| `src/data-dir.js` | **App data directory + one-shot legacy-data migration** |
| `src/model-discovery.js` | **Dynamic per-provider model discovery** |
| `src/renderer-logic.js` | **Pure logic** — token parser, credit calculation, provider resolution, cost-log helpers |
| `src/ipc/*.js` | **IPC handler modules** — images, tests |
| `src/*.js` | **Pure logic modules** — testable without Electron |
| `__tests__/` | **Jest unit tests** |
| `e2e/` | **Playwright E2E tests** |

### 5.4 AcpClient (`src/acp-client.js`)

The `AcpClient` encapsulates all communication with one `copilot --acp` process.

**State machine:**
```
dead → starting → ready ⇄ busy → dead
```

**Key methods:**

| Method | Description |
|---|---|
| `start()` | Spawns `copilot --acp`, performs the `initialize` handshake |
| `stop()` | Terminates the process cleanly |
| `newSession(sessionId, opts)` | Creates a new ACP session |
| `loadSession(sessionId)` | Loads an existing session (after process restart) |
| `prompt(text, opts)` | Sends a message, streams events to the renderer |
| `silentCommand(command)` | Sends a slash command (`/context`, `/usage`, …) and returns the text without forwarding anything to the UI |
| `updateOptions(opts)` | Updates options (e.g. `deniedTools`) for the next start |

**`silentCommand` flow:**
1. Sets `#contextQueryCollector = []`
2. Sends `session/prompt` with the command text
3. `agent_message_chunk` events are written into the collector instead of to the renderer
4. `agent_turn_start/end` events are suppressed
5. After the response: returns `collector.join('')`, sets the collector to `null`

**Process restart for session-specific tool denial:**
Since `--deny-tool` flags are only accepted at spawn, the process must be restarted when the session-specific deny list changes:
```
stop() → updateOptions({ deniedTools }) → start() → loadSession(sessionId)
```

### 5.4a Multi-provider backends (`src/providers/`)

A different backend can be used per tab. **The key contract:** every backend emits the same renderer event vocabulary (`copilot:event` / `copilot:done`) as the `AcpClient`, so the renderer stays backend-agnostic. `main.js` keeps a `backends` map (tabId → backend) and selects the backend via `getModelProvider(modelId)`.

| File | Purpose |
|---|---|
| `providers/index.js` | Registry — model→provider, `createApiBackend()` |
| `providers/api-agent-client.js` | Base class: agent tool loop, token/context accounting, persistence, `/context`/`/compact`/`/usage` locally |
| `providers/anthropic-provider.js` | Anthropic adapter: streaming, tools, adaptive thinking, prompt caching, compact |
| `providers/openai-compatible-provider.js` | Shared OpenAI-compatible core (chat completions + function calling, SSE) for OpenAI/GLM/Ollama |
| `providers/gemini-provider.js` | Gemini adapter: live search (grounding) + file tools, togglable per tab |
| `providers/agent-tools.js` | Provider-agnostic tools (`shell` via PowerShell on Windows, file/search tools) + deny gating |
| `providers/session-store.js` | History persistence under `~/.agent-desktop/api-sessions/` |
| `providers/system-context.js` | Composes `copilot-instructions.md` + every provider-scoped instruction set present under `~/.agent-desktop/<provider>/instructions/` (eager, full content, no toggle — see `INSTRUCTIONS_PROVIDERS` in `main.js`) + lazy skills/agents indexes (name+description+path — no eager inlining; the model reads a file itself via `read_file` when relevant) → cached system prompt |

API keys are stored encrypted in the OS keychain (`src/secure-store.js`); the plaintext key never leaves the main process. The direct providers' slash commands are local equivalents (`/usage` returns the Copilot token line → the existing cost pipeline applies unchanged).

### 5.5 Renderer modules

All flat classic scripts, no bundler — see the renderer-structure note at
the top of the project's `CLAUDE.md` for the load-order/global-scope
mechanics. Loaded before `app.js`, in this order:

| Module | Purpose |
|---|---|
| `utils.js` | Shared UI constants + generic helpers (tags, button-busy, empty-state, toasts, notification sound, date formatting, tooltips) |
| `dev-console.js` | UI counterpart to the browser dev console (log capture, filter, copy) |
| `todos.js` | Per-session task list with IPC backend |
| `images.js` | Image thumbnails, lightbox, drag&drop into the chat |
| `test-runner.js` | Frontend for Jest/Playwright/coverage |
| `session-tools.js` | UI for session-specific denied tools (popup, toggle, process restart) |
| `costs.js` | Cost-log persistence and the "Cost" page (stacked bar chart + breakdown + Claude token-history) |
| `skills-mcp.js` | Skills/Agents/MCP sidebar rendering, per-tab context loading, MCP status probing |
| `sessions-sidebar.js` | Named-session list: search, rename, resume, delete, history-bubble rendering on resume |
| `keyboard-shortcuts.js` | Configurable shortcut definitions, rebind settings panel, global keydown dispatch |
| `drag-drop.js` | Whole-window file-drop handling |
| `self-update.js` | Git-based app self-update + Claude Code ACP adapter update checker |
| `provider-settings.js` | API-provider key/base-URL settings, dynamically-generated per-provider config tabs, Claude Code (SSH) remote-folder picker |
| `chat-search.js` | In-chat search bar (Ctrl+F) |
| `plugins.js` | Plugin/marketplace manager + chat/plugins/costs main-view switching |
| `onboarding.js` | First-run wizard (cwd/provider/folders/role) + post-onboarding tutorial popups |

The last nine were extracted from `renderer/app.js` in one pass (see
`plans/app-js-modularization.md`); tab management, the agent-IPC event
dispatcher, and the model/provider catalog remain in `app.js` on purpose —
too tightly coupled for a mechanical split.

### 5.6 `src/renderer-logic.js` — pure logic

Contains all functions with no DOM or Electron dependencies:

- **Token parsing:** `parseTokenK`, `parseUsageTokens`, `parseUsageRequests`
- **Credit calculation:** `estimateCredits(tokens, modelId)`, `MODEL_PRICING`
- **Cost-log helpers:** `buildCostBuckets`, `aggregateCostBySession`, `trimCostLog`
- **Display helpers:** `shortenPath`, `truncatePath`, `formatDate`, `escapeHtml`, `toolIcon`, …

### 5.7 First-run onboarding wizard

A multi-step wizard that guides the user through authentication, folder configuration, and a feature intro on the very first app start.

| Step | Description |
|---|---|
| 1. Auth | Check/guidance for `gh auth login` |
| 2. Folder setup | Choose the working directory |
| 3. Category selection | Choose skill categories to pre-install |
| 4. Feature intro | Overview of app features |

---

## 6. Runtime view

### 6.1 Chat request (happy path, ACP)

```
User              Renderer            Preload          Main            AcpClient         copilot --acp
 │ types + Enter    │                    │                │                │                    │
 │─────────────────▶│                    │                │                │                    │
 │                  │ copilot.chat       │ ipcRenderer    │                │                    │
 │                  │ .send(tabId, ...)  │ .invoke(       │                │                    │
 │                  │───────────────────▶│  'copilot:send'│                │                    │
 │                  │                    │───────────────▶│ client.prompt()│                    │
 │                  │                    │                │───────────────▶│ session/prompt     │
 │                  │                    │                │                │───────────────────▶│
 │                  │                    │                │                │◄── session/update ─┤
 │                  │ ◄── copilot:event ─┼────────────────┤ emitToRenderer │  (chunks, tools,…) │
 │                  │ render delta       │                │                │                    │
 │                  │                    │                │                │◄── done (result) ──┤
 │                  │ ◄── copilot:done ──┼────────────────┤                │                    │
```

**Detailed flow:**
1. `sendMessage()` in the renderer collects: text (force-activated skills/agents prepended as a hint, if any), model, the model's Copilot reasoning effort, session ID, denied tools, CWD, autopilot flag
2. IPC call `copilot:send` → `main.js` → `client.prompt(text, opts)`
3. AcpClient sends `session/prompt` to the running `copilot --acp` process
4. `session/update` notifications come back as an NDJSON stream
5. Events are mapped and sent to the renderer via `sendToRenderer('copilot:event', tabId, event)`
6. On completion: `copilot:done` event → the tab status is reset
7. `refreshUsageDisplay()` calls `silentCommand('/usage')` and computes the cost delta

### 6.2 Slash command (`/context`, `/compact`, `/clear`, `/usage`)

```
Renderer
  │  window.copilot.chat.silentCommand(tabId, '/context')
  │
  ▼  IPC: copilot:silentCommand
Main
  │  client.silentCommand('/context')
  │
  ▼  AcpClient
     #contextQueryCollector = []
     session/prompt → { type: text, text: '/context' }
     │
     ├── agent_message_chunk → collector.push(text)   [not to the renderer]
     ├── agent_turn_start/end → suppressed
     │
     ▼  Response
     return collector.join('')   → e.g. "Context: 18% (36k/200k tokens)\n..."
```

**No more PTY:** all slash commands run via `silentCommand()` as silent ACP requests. This is more reliable than PTY bracketed paste and needs no `node-pty`.

### 6.3 Process restart (session-specific tool denial)

```
User disables a tool in the session-tools popup
  │
  ▼  restartWithUpdatedDeniedTools()  [renderer/modules/session-tools.js]
     IPC: copilot:restartWithDeniedTools(tabId, mergedDeniedTools)
  │
  ▼  main.js
     client.stop()                    → terminate the process
     client.updateOptions(deniedTools)→ set the new deny list
     client.start()                   → spawn a new process
     client.loadSession(sessionId)    → restore the session
```

### 6.3.1 Process restart (Copilot reasoning effort)

Each tab stores a `reasoningByModel` map alongside its selected model. The
renderer passes the selected model's effort as `options.effort` only for the
Copilot provider. `AcpClient` validates the value and adds
`--reasoning-effort <value>` only when a non-standard level is selected.

Because the flag is a process-start option, changing the effort does not
interrupt the current turn. `updateOptions()` marks the change, and immediately
before the next prompt the client:

1. stops the current ACP process,
2. starts a new process with the selected effort,
3. loads the existing session with `session/load`,
4. reapplies the selected model and mode,
5. sends the prompt.

An unchanged effort keeps the existing process and sends only the normal
`session/prompt`. A model-only change continues to use `session/set_model`
without a restart. The map is persisted in `openTabs` and in the
`sessionReasoningByModel` preference so both open-tab restore and sidebar
resume preserve each model's choice.

### 6.3.2 Live config option (Claude Code reasoning effort)

Claude Code has no `--reasoning-effort` spawn flag — instead, the ACP adapter
(`@agentclientprotocol/claude-agent-acp` ≥ 0.72.0) exposes reasoning effort the
same way it already exposes `model` and `mode`: as a `configOptions` entry on
`session/new`/`session/load`, settable live via
`session/set_config_option({ configId: 'effort', value })`, with **no process
restart**. `#restartForReasoningIfNeeded()` (6.3.1) is Copilot-only and does
not apply here.

The legal values are the same fixed `low/medium/high/xhigh/max` set Copilot
uses — Anthropic's effort parameter turned out not to be gated per model in
practice (confirmed: Haiku offers the same levels as Sonnet, and the same
fixed list shows up across current model documentation generally). An earlier
version of this feature tried to discover the legal values per model/session
from the adapter's `configOptions` response (mirroring how `mode` genuinely
does vary); that added complexity for no real benefit and was removed —
Claude Code now validates against the same fixed set as Copilot, upfront, no
live discovery.

`AcpClient#applyEffort()` runs in `prompt()` right after `#applyModel()`/
`#applyMode()`. It no-ops when the value matches what's already applied —
otherwise it sends `session/set_config_option({ configId: 'effort', value })`.
Reverting to Standard (`null`) is a real state change too, not just "nothing
to do": the adapter pins an explicitly-applied level server-side and keeps it
across model switches, so un-pinning requires sending `value: 'default'` —
silently skipping it would leave the session running at the old level while
the UI already shows Standard.

In the renderer, Claude Code tabs use the same `REASONING_EFFORTS` constant
and `tab.reasoningByModel` map as Copilot — no separate per-tab discovery
state. The 🧠-button badge and the model dropdown's reasoning submenu render
identically for both providers, on every model row, without needing a
session or a sent message first.

### 6.4 App start

```
1. main.js loaded
2. migrateLegacyData()  (copilot-desktop → agent-desktop, one-shot)
3. initLogger()
4. console.log/warn/error hooked (→ file + dev console)
5. folderConfig = readFolderConfig()
6. _prefsManager = createPreferencesManager(...)
7. app.whenReady() → BrowserWindow
8. IPC handlers registered
9. renderer loads index.html → app.js
10. preferences:read → persistent state
11. tabs restored from openTabs
12. for each tab: AcpClient created + started (session/new or session/load)
13. check onboarding → wizard if needed
```

`app.whenReady()` also kicks off `syncPlansConvention()` (fire-and-forget, see
6.4.1) — it spawns `--version` probes, so it must not delay the window.

### 6.4.1 Cross-provider plans

Plans are plain markdown under `plans/` in a project. Every provider can already
read and write files there, so nothing has to be transported between sessions —
what's missing is that the model *knows* the convention without being told in
every chat. So the app mirrors that convention into the instruction files the
ACP CLIs read by themselves:

```
~/.agent-desktop/plans.md          ← source of truth
        │  content copied (one-way)
        ├──► ~/.claude/CLAUDE.md                 (if `claude` is installed)
        └──► ~/.copilot/copilot-instructions.md  (if `copilot` is installed)
```

- The source file is created with a default text if missing and **never
  overwritten** — the user's edits are the point.
- Only installed providers are touched (`isCliAvailable()`), so a Claude-Code-only
  user doesn't get a Copilot instruction file created for them.
- Copilot's `config.instructionsFile` preference is **ignored**: it's a leftover
  from an older feature, and the file always lives in `~/.copilot/`.
- The changes are confined to a marked block
  (`<!-- agent-desktop:plans:start … end -->`), so the rest of those files stays
  untouched. Content inside the block is overwritten on each sync; edits belong
  in the source file.
- `syncToTarget()` writes only when the content actually changes, so a normal
  start doesn't keep touching files that editors and git are watching.

The block logic lives in `src/plans-convention.js` as a pure function
(`applyBlock`) rather than inline in main.js, because it edits files that belong
to the user and are read by tools outside this app — getting the boundaries
wrong would silently eat someone's instructions. With a broken or half-present
marker pair it deliberately appends instead of guessing where the block ends: a
duplicated block is recoverable, swallowed instructions are not.

Deliberately out of scope for now: the direct-API providers (their system prompt
composition/caching is being reworked first) and `claude-code-ssh` (its
instruction file lives on the remote host, which needs SSH rather than `fs`).
See `plans/cross-provider-plans.md`.

### 6.5 IPC communication

#### Namespace: `copilot` (chat / ACP)

| Channel | Type | Description |
|---|---|---|
| `copilot:send` | handle | Sends a chat message via ACP |
| `copilot:stop` | on | Stop the ACP process for a tab |
| `copilot:silentCommand` | handle | Run a slash command silently, return the text |
| `copilot:restartWithDeniedTools` | handle | Restart the process with a new deny list |
| `copilot:getCwd` | handle | Current working directory |
| `copilot:openCwd` | handle | Open the CWD in the file explorer |
| `copilot:getVersions` | handle | Versions (app, CLI, Node, Electron) |
| `copilot:getInstructions` | handle | Read `copilot-instructions.md` |
| `copilot:openLogDir` | handle | Open the log directory |

#### Namespace: `providers` (direct APIs)

| Channel | Description |
|---|---|
| `providers:status` | OS encryption available + which providers have a stored key |
| `providers:setKey/deleteKey` | Store/remove an encrypted API key (never returns the key) |
| `providers:listModels` | Dynamic model discovery per provider |
| `providers:loadSessionHistory` | Persisted direct-API conversation history, plus provider-specific extras needed to resume correctly (e.g. Gemini's search/files mode, via `ApiAgentClient#_persistedExtras()`) |

Provider-scoped instructions (`~/.agent-desktop/<provider>/instructions/*.instructions.md`, direct-API providers only — see `INSTRUCTIONS_PROVIDERS`) have **no dedicated IPC channel**: `resolveInstructions()` in `main.js` reads every file present in the folder server-side, on each `sendApiPrompt` call, with no renderer round-trip and no active/inactive selection to synchronize.

#### Namespace: `sessions`

| Channel | Type | Description |
|---|---|---|
| `sessions:create` | handle | Create a new named session |
| `sessions:delete` | handle | Delete the session folder |
| `sessions:readCheckpoints` | handle | Read checkpoint files |
| `sessions:readPlan` | handle | Read `plan.md` |
| `sessions:readRecentMessages` | handle | Last 5 messages from a Copilot session's `events.jsonl` |
| `sessions:readAllMessages` | handle | Full history from a Copilot session's `events.jsonl` |
| `sessions:readClaudeCodeTranscript` | handle | Full history from a Claude Code session's own transcript (`~/.claude/projects/<cwd>/<sessionId>.jsonl`) |

#### Namespace: `todos` / `images` / `videos`

| Channel | Description |
|---|---|
| `todos:list/add/update/delete/reorder` | CRUD + reorder for session todos |
| `images:list/open/delete/openFolder` | Image management |
| `videos:extractFrames` | Video frame extraction |

#### Namespace: `preferences` / `instructions` / `folders` / `skills` / `agents` / `files` / `tests` / `window` / `log`

| Channel | Description |
|---|---|
| `preferences:read/write` | Preferences I/O |
| `instructions:read/write` | `copilot-instructions.md` I/O (Copilot's single native instructions file — an editor convenience, the Copilot CLI reads this itself) |
| `instructions:readClaudeCode/writeClaudeCode` | `~/.claude/CLAUDE.md` I/O — same idea as `instructions:read/write` but for Claude Code's own native global instructions file (fixed path, unlike Copilot's configurable one) |
| `folders:read/save/reset/browse/browse-file` | Folder configuration (Copilot's own native paths + CWD/images). `save` merges the given keys into the existing config (each Settings field auto-saves individually on change); `reset` is the one action that wipes back to hardcoded defaults |
| `folders:openPath` | Opens an arbitrary absolute path in the OS file explorer (creates it first if missing) — used by the per-provider settings tabs' Skills/Agents/Instructions folder links |
| `folders:providerPaths` | Absolute skills/agents/instructions folder paths for a given provider, for read-only display in that provider's settings tab |
| `skills:list/listProject/listProvider/getDisabled/setDisabled` | Skill management (`list` = Copilot's native `~/.copilot/skills`; `listProvider` = every other provider's own `~/.agent-desktop/<provider>/skills`). `list` first calls `syncMarketplaceSkills()` (`src/plugin-skill-mirror.js`), which mirrors installed marketplace/plugin skills (`~/.copilot/installed-plugins/…/skills/`) into `~/.copilot/skills/` — `copilot --acp` (the mode this app always runs Copilot in) never exposes plugin skills to the model on its own, only builtin + user ones, unlike the CLI's interactive/-p modes. The mirror is tracked in a manifest so re-syncs can refresh/remove entries without ever touching a same-named skill the user created themselves. |
| `agents:list/listProject/listProvider` | Agents (persona presets — same Copilot-native-vs-per-provider split as skills) |
| `mcp:listProject` | MCP servers from `mcp.json` |
| `files:processDropped` | Drag&drop processing |
| `tests:run/coverage/e2e` | Test runner |
| `window:minimize/maximize/close` | Window control |
| `log:write` | Log entry from the renderer |

#### Namespace: `onboarding` / `tutorial` / `dev`

| Channel | Description |
|---|---|
| `onboarding:getStatus/setComplete/getCategories/installCategory` | First-run wizard |
| `tutorial:getFlags/setFlag` | Tutorial flags (key whitelist: `tutorialSkillsShown`, `tutorialRenameShown`) |
| `dev:setOnboardingComplete` | Reset onboarding |

---

## 7. Deployment view

| Environment | Components | Persistence |
|---|---|---|
| **End-user desktop** (Win 11, Linux, macOS) | Electron app, `copilot` CLI (external) | `app.getPath('userData')` (theme, tabs, permissions, cost log); `~/.agent-desktop/` (logs, folders); `~/.copilot/` (sessions, skills — CLI-managed) |
| **CI** | `node`, `npm test`, `npm run lint` | nothing persistent |
| **Development** | `npm run dev` (Electron + DevTools), Jest watch | `preferences.test.json` separately |

### 7.1 Path conventions

| Purpose | Windows | Linux/macOS |
|---|---|---|
| Preferences | `%APPDATA%\agent-desktop\preferences.json` | `~/.config/agent-desktop/preferences.json` |
| Logs | `~/.agent-desktop/logs/` | `~/.agent-desktop/logs/` |
| Folders config | `~/.agent-desktop/folders.json` | `~/.agent-desktop/folders.json` |
| Copilot sessions | `%USERPROFILE%\.copilot\session-state\` | `~/.copilot/session-state/` |

### 7.2 Persistence in detail

| Data | Location | Owner |
|---|---|---|
| Preferences (theme, tabs, settings, cost log) | `userData/preferences.json` (+ `.bak`) | `src/preferences.js` |
| Folders config, onboarding, tutorial flags | `~/.agent-desktop/folders.json` | `src/scanners.js`, `main.js` |
| Sessions | `~/.copilot/session-state/<uuid>/` | CLI (read-only) |
| Todos | `<cwd>/todo/todos.md` | `src/todos.js` |
| Logs | `~/.agent-desktop/logs/agent-desktop-<YYYY-MM-DD>.log` | `src/logger.js` |
| Cost log | `userData/preferences.json` (key: `costLog`) | `renderer/app.js` |
| Encrypted API keys | `userData/provider-keys.enc` | `src/secure-store.js` |

---

## 8. Cross-cutting concepts

### 8.1 Security

| Setting | Value | Meaning |
|---|---|---|
| `contextIsolation` | `true` | The renderer has no direct Node.js access |
| `nodeIntegration` | `false` | The safest Electron configuration |

- **DOMPurify** sanitizes every rendered CLI output before DOM injection.
- **`safeSessionPath()`** protects against path traversal in session IDs.
- All IPC calls go exclusively through `contextBridge.exposeInMainWorld`.
- **API keys** are encrypted via the OS keychain (`safeStorage`) and never returned to the renderer.

### 8.2 Tool permissions

- **Per-provider deny list** (`settings.deniedToolsByProvider[provider]`): fully independent per provider — configured in each provider's own settings tab. Only providers with our own enforced shell tool get one (see `DENYLIST_PROVIDERS`/the `denylist` flag in `PROVIDER_CAPABILITIES`): Copilot, Anthropic, OpenAI, GLM, Ollama. Gemini has no shell tool at all; Claude Code has its own approval mechanism and isn't affected. One-shot migration (`migrateDeniedToolsToPerProvider`) seeds every one of those providers with a copy of the old flat `settings.deniedTools` list the first time the app runs post-upgrade.
- **Session deny list** (`tab.sessionDeniedTools`): per session; changes trigger a process restart
- Both lists (for that tab's provider) are merged into `--deny-tool=<name>` flags at spawn

### 8.3 Cost tracking

The app estimates the cost from token usage:

```javascript
cost = (input * priceInput + cache * priceCache + cacheWrite * priceCacheWrite + output * priceOutput) / 1_000_000
```

Copilot prices are read from GitHub's official pricing data table
(`data/tables/copilot/models-and-pricing.yml`) once a day and converted from USD
to AI Credits (100 AI Credits = $1). The static `MODEL_PRICING` entries are the
offline fallback and retain prices for older models. Direct-API models use their
hardcoded prices first, then the weekly LiteLLM fallback.

The Copilot model list itself is discovered from the CLI over ACP. Pricing is
matched against model IDs and official display names after normalization. GitHub's
`Auto` selection has no single rate; the estimate is unavailable until a
billable model ID is known. For long-context tiers, the estimate uses the
per-prompt input-token delta reported by `/usage`; ACP does not provide
per-request tier attribution, so this remains an estimate.

Token data comes from `/usage` (via `silentCommand`). The delta per prompt is stored (`recordCostEntry`), priced at the model actually used for that prompt. The cost history is visualized on the cost page as a stacked bar chart (day/week, broken down by session). Direct-API providers return real token counts and are billed in USD; Copilot is billed in AI Credits (100 AIC = $1).

### 8.4 Logging & diagnostics

- `src/logger.js` writes to `~/.agent-desktop/logs/` (daily rotation, 7 days).
- `console.log/warn/error` in the main process are monkey-patched: logs additionally go to the file and the dev-console panel.

### 8.5 Theme system

Two themes via CSS custom properties (`:root`, `[data-theme="dark"]`).

### 8.6 Per-tab state

```javascript
{
  id: "tab-uuid",
  sessionId: "copilot-session-uuid",
  selectedModel: "claude-sonnet-4.6",
  mode: "agent",
  sessionDeniedTools: [{ name: "shell(git push)", enabled: true }],
  _lastUsageTokens: { input: 17500, output: 13, cache: 0 },
  _billingModel: "claude-sonnet-4.6",
  _sessionName: "My project",
  inputText: "",
  inputRichHtml: "",
}
```

---

## 9. Architecture decisions (ADR-light)

| # | Decision | Alternative | Consequence |
|---|---|---|---|
| 1 | Electron instead of Tauri/Wails | Tauri | Faster development, JS everywhere, larger binary |
| 2 | **ACP instead of JSONL spawn + PTY** | Keep `--output-format json --stream on` + PTY | One long-lived process/tab, slash commands via `silentCommand()`, no PTY/node-pty, session persistence via `session/load` |
| 3 | **`silentCommand()` instead of PTY for slash commands** | PTY with bracketed paste | Deterministic, testable, no fragile string matching on TUI output |
| 4 | **Process restart for `--deny-tool` changes** | Runtime API (doesn't exist in ACP) | Clean, but a short interruption; the session is restored via `session/load` |
| 5 | Preferences in `app.getPath('userData')` | `__dirname` (was a bug) | Works in packaged builds; a one-time migration was needed |
| 6 | PATH augmentation for Linux/macOS | User must edit `.bashrc` | Pragmatic, covers 95% of cases |
| 7 | Markdown init in the preload | In the renderer | `marked`/`hljs`/`DOMPurify` loaded once |
| 8 | Cost log in `preferences.json` (key `costLog`) | Own file | No extra file I/O; reuses existing persistence infrastructure |
| 9 | Tutorial flags in `folders.json` | `preferences.json` | `folders.json` already exists; flags should *not* travel with a preferences export |
| 10 | Onboarding wizard with tab locking | Separate window | Single-window UX; auto-unlock after 180s as a safety net |
| 11 | **Multi-provider via a shared event vocabulary** | Provider-specific renderer paths | The renderer stays backend-agnostic; new providers only re-emit the same events |
| 12 | **Rename `copilot-desktop` → `agent-desktop` with data migration** | Keep the internal name | Provider-neutral identity; one-shot Windows-safe migration (DPAPI keeps keys) |

---

## 10. Risks and technical debt

| # | Risk / debt | Impact | Mitigation |
|---|---|---|---|
| R-1 | **`renderer/app.js` is ~4.7k lines, procedural** (was ~8.5k before the Phase-1 modularization pass) | Hard to navigate | Phase 1 done — 9 self-contained clusters moved to `renderer/modules/`. Remaining: tab management, `initAgentIPC`, model/provider catalog, `initSettings` — deferred (Phase 2) as too tightly coupled for a mechanical split. See `plans/app-js-modularization.md`. |
| R-2 | **ACP is an unofficial API** | A CLI update can change the protocol | `acp-client.js` encapsulates all ACP details; changes stay localized |
| R-3 | **`/usage` reports "AI Units" instead of "AI Credits"** | The credit display is based on token calculation, not the official number | Track whether ACP will provide credits in the future; token calculation as fallback |
| R-4 | **No automated E2E smoke test for the chat roundtrip** | Regressions surface only manually | Playwright stub present in `e2e/` |
| R-5 | **`--deny-tool` restart visible to the user** | Short interruption when changing session tools | Improvable via a loading indicator; acceptable trade-off |
| R-6 | **No CI pipeline** | Tests must run locally | TODO: GitHub Actions workflow |
| R-7 | **Direct-API providers not runtime-tested** | Alpha/Beta labelled; possible runtime bugs | Manual E2E with real keys pending |
| R-8 | **No cost attribution for Copilot sub-agent calls** | `/usage` only reports one aggregate total for the whole session — ACP exposes no per-sub-agent model or token count, so delegated work (e.g. via `task-router`) is silently priced as if it ran on the main session's model | Would need GitHub to expose real AI-Credit accounting (and ideally a per-call breakdown) via ACP; no client-side fix possible today |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Main process** | Electron main process with Node.js access |
| **Renderer process** | Chromium-based UI process without Node.js access |
| **IPC** | Inter-process communication between main and renderer |
| **Context bridge** | Electron mechanism to safely expose APIs to the renderer |
| **Copilot CLI** | The `copilot` binary from `gh extension install github/gh-copilot` |
| **ACP** | Agent Communication Protocol — JSON-RPC over NDJSON on stdio (`copilot --acp`) |
| **NDJSON** | Newline-delimited JSON: one JSON object per line, streaming-friendly |
| **AcpClient** | Class in `src/acp-client.js` that manages one `copilot --acp` process per tab |
| **silentCommand** | AcpClient method for slash commands (`/context`, `/usage`, …) that sends nothing to the UI |
| **session/load** | ACP method to restore a session after a process restart |
| **Skill** | YAML/Markdown description in `~/.copilot/skills/` |
| **Sub-agent** | Specialized agent in `~/.copilot/agents/` |
| **Cost log** | List of credit-delta entries per prompt stored in `preferences.json` |
| **userData** | Electron app-specific write location: `app.getPath('userData')` |
| **buildEnv** | Helper in `src/main-helpers.js` for PATH augmentation on Linux/macOS |

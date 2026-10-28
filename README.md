# Agent Desktop

## Updates und Reparatur

Explizite App-Updates installieren Abhängigkeiten immer neu – auch ohne neue
Commits. Erst nach erfolgreichem npm install, Dependencygraph-Prüfung und
seiteneffektfreier Auflösung statischer Runtime-Imports wird neu gestartet.
Ein manueller Updatecheck bietet bei aktuellem Code „Reparieren“ an.
Bei Installationsfehlern liegt der gepullte Code bereits vor: nicht neu starten,
bis die Reparatur erfolgreich war. Kein automatischer Git-Rollback.
Siehe [Recovery-Anleitung](docs/USER-GUIDE.md#update-recovery).

> Electron desktop app for multiple LLM providers (GitHub Copilot CLI, Anthropic, Gemini, OpenAI, GLM, Ollama) in one polished chat UI — named sessions, skills & agents, markdown, drag & drop, dynamic model discovery, USD cost tracking.

> **Version 1.0** — first stable release.

**Agent Desktop** (package: `agent-desktop`) is an Electron-based desktop app for working with multiple LLM providers through one polished chat interface. Its fully-tested core wraps the **GitHub Copilot CLI**; in addition, several **direct-API providers** can be used per tab:

| Provider | Maturity | Notes |
|---|---|---|
| GitHub Copilot (CLI/ACP) | stable | Primary provider, no badge |
| Google Gemini | **Beta** | "Tested, not final" — research-oriented (live search / grounding) |
| Anthropic · OpenAI · GLM (Zhipu) · Ollama | **Alpha** | "Untested" — fully agentic; Ollama is local & keyless |

Every provider emits the same internal event vocabulary, so chat, cost tracking, tools and UI work identically across providers. Other highlights: multiple named sessions, toggleable skills/agents, a plugin marketplace, todos, markdown rendering, file drag & drop, per-tab model switching, dynamic model discovery, and USD-accurate cost tracking — all in a clean, themeable UI.

## Claude Code runtime

Claude ACP **0.97.0**, Agent SDK **0.3.310** and native CLI **2.1.310**
ship with the app. Local startup uses those files without npx or a system
Claude install. Only developer mode permits explicit alternate adapter versions.
SSH runs the exact selected version remotely and may need a download.
See [runtime validation and limits](specs/changes/claude-runtime-im-app-release/validation.md).

## Features

### Core Chat
- 💬 **Multi-Session Management** — Create, rename, and switch between named sessions; only named sessions are shown in the session list
- 📂 **Per-Session CWD** — Choose a working directory per session via the statusbar; persisted across app restarts
- 📝 **Markdown Rendering** — Full markdown support including code blocks with syntax highlighting
- 📂 **File Drag & Drop** — Drop files directly into the chat
- 🔎 **Chat Search** — Search through conversation history
- 📋 **Session Resume** — Reopening a session restores user/assistant text in normal live-message styling, without historical tool calls, results, or reasoning blocks. Mixed messages retain their text; native session data/model context and live tool displays remain unchanged. Older messages load lazily. Applies to saved app tabs, Copilot, local Claude Code previews, and direct-API histories; Claude Code over SSH still has no history preview.

### Providers & Models
- 🔌 **Multiple Providers per Tab** — GitHub Copilot CLI plus direct APIs (Anthropic, Gemini, OpenAI, GLM, Ollama); the provider is fixed per tab and chosen when creating it
- 🔑 **Secure API Keys** — Keys are encrypted via the OS keychain (`safeStorage`) and never leave the main process
- 🔀 **Model Switcher** — Switch between models per tab; the selection persists across app restarts
- 🆕 **Dynamic Model Discovery** — Models are discovered live per provider (via `/models` or ACP); newly appearing models are announced
- 💲 **USD Cost Tracking** — Today's costs per session (local calendar day, DST-aware), with cumulative totals retained; Copilot uses confirmed CLI AI Credits (100 AIC = $1), direct APIs use recorded token-price estimates. Missing daily timing is explicit, never guessed.

### Skills & Agents
- 🧠 **Skills, per provider** — Copilot keeps its native `~/.copilot/skills/`; every other provider (Claude Code, Anthropic, OpenAI, GLM, Ollama) has its own `~/.agent-desktop/<provider>/skills/`. Exposed to the model as a lazy index (name + description + file path) — it reads a skill's `SKILL.md` itself only when it judges it relevant, instead of everything being inlined eagerly.
- ⊘ **Native CLI skill configuration** — Funktionen / Skills runs Copilot's native `skill enable/disable` and reads `skill list --json`. Name-scoped across sources; disabled names are excluded from app prompt overrides. Native ACP runtime exclusion is **not confirmed**, even for new sessions (see `docs/NATIVE-SKILLS-LIVE-TEST.md`). Other providers have no native activation controls.
- 🤖 **Agents, per provider** — same folder structure as Skills (`~/.agent-desktop/<provider>/agents/`), but agents are a **persona switch**: once the model judges a task matches an agent's description, it reads that agent's `.agent.md` and adopts its approach for the rest of the task.
- 🔘 **Manual toggle (override)** — Skills/Agents can still be force-activated per session on top of the automatic selection; for Copilot this uses its native `/agent <name>` prefix, for every other provider a plain-language hint.
- 🔍 **Skill & Agent Tags** — Visual indicators under each message showing which skills/agents were force-activated
- 📋 **Instructions, direct-API providers only** — Anthropic/OpenAI/GLM/Ollama get a provider-scoped `~/.agent-desktop/<provider>/instructions/`; every `.instructions.md` file placed there is always inlined in full into the system prompt (not a lazy index like Skills/Agents — instructions are meant to apply unconditionally, no toggle needed). Copilot and Claude Code already have their own native instructions discovery and don't use this.

### Direct startup
- The app opens directly in chat, including on first launch. Provider login,
  API keys and folder configuration remain available in the regular settings.

### Productivity
- ✅ **Todos** — Project/CWD-scoped task list (stored as a markdown checklist under `<cwd>/todo/todos.md`); survives session deletion
- 🤖 **Autopilot Toggle** — Per-tab toggle that passes `--autopilot` to the Copilot CLI; state persists across tab switches
- ✏️ **Rich-Text Editor** — Optional contenteditable input with a formatting toolbar (Bold, Italic, UL, OL); converted to Markdown on send
- 📝 **Per-Tab Chat Input** — Draft text, rich HTML, and editor mode are saved per tab and restored on switch; nothing is lost when changing tabs
- 🔌 **Plugin Manager** — Browse and manage skill/agent marketplaces; install, update, and remove plugins
- ⌨️ **Keyboard Shortcuts** — Configurable shortcuts with a built-in shortcut overlay
- ⏱️ **Tab-Unlock Fallback** — Manual unlock button after 30s inactivity; automatic unlock after 180s for hanging sub-agent tabs
- 📦 **Provider-specific automatic compaction** — Visible provider settings beside model/reasoning: 1–95% utilization, or per-model Copilot token thresholds. New Copilot policies use 240,000 tokens at the official 272,000-token price boundary; saved percentages remain unchanged. Higher user thresholds are allowed with cost warnings, never a hidden cap. Copilot sessions always request the largest context window (`--context long_context`, CLI ≥1.0.95); the effective window comes from `/context`. Checks only after successful complete responses, including background/scheduled sessions. Native CLI compaction remains independent; no cost guarantee.

### Customisation
- 🎨 **Themes** — Multiple built-in color themes
- 🔒 **Permission System** — Configurable tool permissions (read, write, shell, etc.)
- ⚙️ **Settings Dialog** — Model selection, API-provider keys, permissions, folder paths (including a custom agents directory), and preferences

## Skills

Copilot loads skills from its own installation (`~/.copilot/skills/`); Claude Code discovers its own native `~/.claude/skills/` (confirmed empirically — no app-side injection, would just load the same skills twice); every other provider gets its own app-managed `~/.agent-desktop/<provider>/skills/`. Each provider's Skills folder is shown (read-only, "open in explorer") in its own Settings tab. Skill files follow the `SKILL.md` format with YAML frontmatter (`name`, `description`). Rather than inlining every skill's full content, the app exposes a lazy index (name + description + file path) to the model — it reads a specific `SKILL.md` itself, via its file tool, only once it decides that skill is relevant to the current task. The sidebar's Skills section always reflects the active tab's provider. A manual toggle still exists to force a skill regardless of the model's own judgment.

## Agents

Same folder structure as Skills — Copilot's own `~/.copilot/agents/`, every other provider its `~/.agent-desktop/<provider>/agents/`. Agent files follow the `*.agent.md` format with YAML frontmatter (`name`, `description`, `tools`). Unlike skills, agents represent a **persona/approach switch**: once the model judges that a task matches an agent's description (from the same lazy index mechanism as Skills), it reads that agent's file and adopts its instructions for the rest of the task — this is a switch within the same conversation, not a delegated, isolated sub-agent run (that's a separate, not-yet-built feature). A manual toggle still exists to force-activate an agent: for Copilot this uses its native `/agent <name>` slash command, for every other provider a plain-language hint that points at the same lazy index.

## Instructions

Direct-API providers only (Anthropic, OpenAI, GLM, Ollama) — Copilot and Claude Code already have their own native instructions discovery (`.github/copilot-instructions.md` / `CLAUDE.md`, read by the CLI itself) and don't need this. Each provider gets its own `~/.agent-desktop/<provider>/instructions/` with flat `*.instructions.md` files (YAML frontmatter `name`/`description` + a markdown body). Unlike Skills/Agents, every file present is always inlined in full into the system prompt for every message — there's no "the model decides whether to read it" step and no on/off toggle: dropping a file into the folder activates it, removing it deactivates it. This is additive to the existing global `copilot-instructions.md`/`AGENTS.md` base layer. There's no dedicated sidebar UI — Settings → Features shows which providers support it.

## Requirements

- **Windows 11** (other platforms and versions not tested)
- **Node.js 22+** (source checkout / remote SSH) — [nodejs.org](https://nodejs.org/)
- **Optional — GitHub Copilot CLI** — only needed for the Copilot provider (`gh extension install github/gh-copilot`, requires a GitHub Copilot license). The direct-API providers (Anthropic, Gemini, OpenAI, GLM, Ollama) work without it — just add an API key in the settings.

## Getting Started

### Setup (one-time)

```powershell
git clone https://github.com/JoeJohn1985/agent-desktop.git
cd agent-desktop
pwsh setup.ps1
```

The script does two things:
1. `npm install` — installs all dependencies
2. Creates a desktop shortcut **"Agent Desktop"** with the app icon

Then: **double-click the shortcut** or pin it to the taskbar — done.

### Manual start (alternative)

```powershell
npm start
```

## Project Structure

```
agent-desktop/
├── main.js              # Electron main process, IPC handlers, skill/agent scanner
├── src/
│   ├── data-dir.js      # App data directory + one-shot legacy-data migration; per-provider skills/agents dirs
│   ├── providers/       # Provider backends (Anthropic, Gemini, OpenAI-compatible, agent loop)
│   ├── secure-store.js  # Encrypted API-key storage (safeStorage)
│   ├── model-discovery.js # Dynamic per-provider model discovery
│   ├── agents.js        # Agent directory scanner (*.agent.md) + lazy agents index
│   ├── scanners.js      # Skill directory scanner + lazy skills index
│   ├── claude-code-transcript.js # Reads Claude Code's own session transcript (history restore)
│   └── ipc/             # IPC handler modules
├── renderer/
│   ├── app.js           # Frontend logic, startup, chat UI, skill/agent toggles
│   ├── modules/         # Renderer modules (costs, todos, images, …)
│   ├── index.html       # App shell
│   └── styles.css       # Styles, themes, shortcuts overlay
├── preload.js           # Electron preload script (IPC bridge)
├── __tests__/           # Jest test suites (1300+ tests)
├── CHANGELOG.md         # Version history
└── package.json
```

## Documentation

- 🏛️ **[Architecture (arc42)](docs/ARCHITECTURE.md)** — full arc42 view: context, building blocks, runtime, IPC channels, deployment, risks, ADRs
- 📘 **[User Guide](docs/USER-GUIDE.md)** — UI overview, features, getting started, keyboard shortcuts
- 🐞 **[Known Issues](docs/known-issues.md)** — open items and resolved problems

## License

Apache 2.0
# Antwortoptionen im Chat

Explizite Modellfragen können nach Abschluss der Antwort als Single-Select-Buttons
erscheinen. Ein Klick sendet den Antworttext über den normalen Chat-Sendeweg;
Freitext bleibt möglich. Jede folgende Nutzerantwort sperrt die alten Optionen,
eine passende Auswahl wird markiert. Normale Listen werden nicht umgewandelt.
Siehe [Ausgabevertrag und Providerwirkung](docs/USER-GUIDE.md#chat-antwortoptionen).

# Agent Desktop

> Electron desktop app for multiple LLM providers (GitHub Copilot CLI, Anthropic, Gemini, OpenAI, GLM, Ollama) in one polished chat UI — named sessions, skills & agents, markdown, drag & drop, dynamic model discovery, USD cost tracking.

> **Version 1.0** — first stable release.

**Agent Desktop** (package: `agent-desktop`) is an Electron-based desktop app for working with multiple LLM providers through one polished chat interface. Its fully-tested core wraps the **GitHub Copilot CLI**; in addition, several **direct-API providers** can be used per tab:

| Provider | Maturity | Notes |
|---|---|---|
| GitHub Copilot (CLI/ACP) | stable | Primary provider, no badge |
| Google Gemini | **Beta** | "Tested, not final" — research-oriented (live search / grounding) |
| Anthropic · OpenAI · GLM (Zhipu) · Ollama | **Alpha** | "Untested" — fully agentic; Ollama is local & keyless |

Every provider emits the same internal event vocabulary, so chat, cost tracking, tools and UI work identically across providers. Other highlights: multiple named sessions, toggleable skills/agents, an onboarding wizard, a plugin marketplace, todos, markdown rendering, file drag & drop, per-tab model switching, dynamic model discovery, and USD-accurate cost tracking — all in a clean, themeable UI.

## Features

### Core Chat
- 💬 **Multi-Session Management** — Create, rename, and switch between named sessions; only named sessions are shown in the session list
- 📂 **Per-Session CWD** — Choose a working directory per session via the statusbar; persisted across app restarts
- 📝 **Markdown Rendering** — Full markdown support including code blocks with syntax highlighting
- 📂 **File Drag & Drop** — Drop files directly into the chat
- 🔎 **Chat Search** — Search through conversation history
- 📋 **Session Resume** — Reopening a session restores its full history in the tab

### Providers & Models
- 🔌 **Multiple Providers per Tab** — GitHub Copilot CLI plus direct APIs (Anthropic, Gemini, OpenAI, GLM, Ollama); the provider is fixed per tab and chosen when creating it
- 🔑 **Secure API Keys** — Keys are encrypted via the OS keychain (`safeStorage`) and never leave the main process
- 🔀 **Model Switcher** — Switch between models per tab; the selection persists across app restarts
- 🆕 **Dynamic Model Discovery** — Models are discovered live per provider (via `/models` or ACP); newly appearing models are announced
- 💲 **USD Cost Tracking** — Real per-token cost in USD, grouped by provider or session (Copilot billed via AI Credits, 100 AIC = $1)

### Skills & Agents
- 🧠 **Skill Toggles** — Enable/disable AI skills per session; active skills are injected into prompts automatically
- ⊘ **CLI Skill Disable** — Globally disable skills in the Copilot CLI via `~/.copilot/settings.json` (persisted across sessions)
- 🤖 **Agent Toggles** — Enable/disable custom agents per session; active agents are injected as an `/agent <name>` prefix automatically
- 🔍 **Skill & Agent Tags** — Visual indicators under each message showing which skills/agents were active

### Onboarding & Tutorials
- 🚀 **First-Run Onboarding Wizard** — Guided setup on first launch:
  1. GitHub authentication check (`gh auth login`)
  2. Folder structure setup (`~/.agent-desktop/`)
  3. Starter agents & skills selection (6 categories, individually toggleable)
  4. Feature introduction via a 3-slide carousel
- 💡 **Tutorial Popups** — Contextual hints for Skills reload and Tab rename; auto-close on action or after 30 seconds

### Productivity
- ✅ **Todos** — Project/CWD-scoped task list (stored as a markdown checklist under `<cwd>/todo/todos.md`); survives session deletion
- 🤖 **Autopilot Toggle** — Per-tab toggle that passes `--autopilot` to the Copilot CLI; state persists across tab switches
- ✏️ **Rich-Text Editor** — Optional contenteditable input with a formatting toolbar (Bold, Italic, UL, OL); converted to Markdown on send
- 📝 **Per-Tab Chat Input** — Draft text, rich HTML, and editor mode are saved per tab and restored on switch; nothing is lost when changing tabs
- 🔌 **Plugin Manager** — Browse and manage skill/agent marketplaces; install, update, and remove plugins
- ⌨️ **Keyboard Shortcuts** — Configurable shortcuts with a built-in shortcut overlay
- ⏱️ **Tab-Unlock Fallback** — Manual unlock button after 30s inactivity; automatic unlock after 180s for hanging sub-agent tabs

### Customisation
- 🎨 **Themes** — Multiple built-in color themes
- 🔒 **Permission System** — Configurable tool permissions (read, write, shell, etc.)
- ⚙️ **Settings Dialog** — Model selection, API-provider keys, permissions, folder paths (including a custom agents directory), and preferences

## Skills

The app dynamically loads skills from your local Copilot installation (`~/.copilot/skills/`). Skills can be toggled on/off per session — active skills are automatically injected into prompts and shown as tags below each message.

## Agents

The app dynamically loads custom agents from `~/.copilot/agents/` (configurable in Settings → Folders). Agent files follow the `*.agent.md` format with YAML frontmatter (`name`, `description`, `tools`). Active agents are injected as an `/agent <name>` prefix per message.

## Requirements

- **Windows 11** (other platforms and versions not tested)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **Optional — GitHub Copilot CLI** — only needed for the Copilot provider (`gh extension install github/gh-copilot`, requires a GitHub Copilot license). The direct-API providers (Anthropic, Gemini, OpenAI, GLM, Ollama) work without it — just add an API key in the settings.

## Getting Started

### Setup (one-time)

```powershell
git clone https://github.com/matthias-schneider_gebit/github-copilot-desktop.git
cd github-copilot-desktop
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
├── main.js              # Electron main process, IPC handlers, skill/agent/tutorial scanner
├── src/
│   ├── data-dir.js      # App data directory + one-shot legacy-data migration
│   ├── providers/       # Provider backends (Anthropic, Gemini, OpenAI-compatible, agent loop)
│   ├── secure-store.js  # Encrypted API-key storage (safeStorage)
│   ├── model-discovery.js # Dynamic per-provider model discovery
│   ├── agents.js        # Agent directory scanner (*.agent.md)
│   ├── scanners.js      # Skill directory scanner
│   └── ipc/             # IPC handler modules
├── renderer/
│   ├── app.js           # Frontend logic, chat UI, skill/agent toggles, onboarding, tutorials
│   ├── modules/         # Renderer modules (costs, todos, images, …)
│   ├── index.html       # App shell, onboarding wizard markup
│   └── styles.css       # Styles, themes, onboarding, shortcuts overlay
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

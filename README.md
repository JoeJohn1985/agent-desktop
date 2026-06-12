# Copilot Desktop

**Copilot Desktop** is an Electron-based desktop app that wraps the GitHub Copilot CLI in a polished chat interface. It supports multiple named sessions, toggleable AI skills and agents, a first-run onboarding wizard, plugin marketplace, todos, markdown rendering, file drag & drop, model switching, and automatic task routing to sub-agents based on complexity — all in a clean, themeable UI.

## Features

### Core Chat
- 💬 **Multi-Session Management** — Create, rename, and switch between named sessions; only named sessions are shown in the session list
- 📂 **Per-Session CWD** — Choose a working directory per session via the statusbar; persisted across app restarts
- 📝 **Markdown Rendering** — Full markdown support including code blocks with syntax highlighting
- 📂 **File Drag & Drop** — Drop files directly into the chat
- 🔎 **Chat Search** — Search through conversation history
- 📋 **Session Resume** — Loading a session into a tab shows the last few messages as context

### Skills & Agents
- 🧠 **Skill Toggles** — Enable/disable AI skills per session; active skills are injected into prompts automatically
- ⊘ **CLI Skill Disable** — Globally disable skills in the Copilot CLI via `~/.copilot/settings.json` (persisted across sessions)
- 🤖 **Agent Toggles** — Enable/disable custom agents per session; active agents are injected as `/agent <name>` prefix automatically
- 🔍 **Skill & Agent Tags** — Visual indicators under each message showing which skills/agents were active

### Onboarding & Tutorials
- 🚀 **First-Run Onboarding Wizard** — Four-step guided setup on first launch:
  1. GitHub authentication check (`gh auth login`)
  2. Folder structure setup (`~/.copilot-desktop/`)
  3. Starter agents & skills selection (6 categories, individually toggleable)
  4. Feature introduction via 3-slide carousel
- 💡 **Tutorial Popups** — Contextual hints for Skills reload and Tab rename; auto-close on action or after 30 seconds

### Productivity
- ✅ **Todos** — Per-session task list with add, complete, and delete (🗑️) actions
- 🤖 **Autopilot Toggle** — Per-tab toggle that passes `--autopilot` to the Copilot CLI; state persists across tab switches
- ✏️ **Rich-Text Editor** — Optional contenteditable input with formatting toolbar (Bold, Italic, UL, OL); converted to Markdown on send
- 📝 **Per-Tab Chat Input** — Draft text, rich HTML, and editor mode are saved per tab and restored on switch; nothing is lost when changing tabs
- 🔌 **Plugin Manager** — Browse and manage skill/agent marketplaces; install, update, and remove plugins
- ⌨️ **Keyboard Shortcuts** — Configurable shortcuts with a built-in shortcut overlay
- ⏱️ **Tab-Unlock Fallback** — Manual unlock button after 30s inactivity; automatic unlock after 180s for hanging sub-agent tabs

### Customisation
- 🎨 **Themes** — Multiple built-in color themes
- 🔀 **Model Switcher** — Switch between AI models per tab; selection persists across app restarts for all sessions
- 🔒 **Permission System** — Configurable tool permissions (read, write, shell, etc.)
- ⚙️ **Settings Dialog** — Model selection, permissions, folder paths (including custom agents directory), and preferences

## Skills

The app dynamically loads skills from your local Copilot installation (`~/.copilot/skills/`). Skills can be toggled on/off per session — active skills are automatically injected into prompts and shown as tags below each message.

## Agents

The app dynamically loads custom agents from `~/.copilot/agents/` (configurable in Settings → Folders). Agent files follow the `*.agent.md` format with YAML frontmatter (`name`, `description`, `tools`). Active agents are injected as `/agent <name>` prefix per message.

## Requirements

- **Windows 11** (other platforms and versions not tested)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **GitHub Copilot CLI** — `gh extension install github/gh-copilot` (requires GitHub Copilot license)

## Getting Started

### Setup (einmalig)

```powershell
git clone https://github.com/matthias-schneider_gebit/github-copilot-desktop.git
cd github-copilot-desktop
pwsh setup.ps1
```

Das Script macht zwei Dinge:
1. `npm install` — installiert alle Dependencies
2. Erstellt eine Desktop-Verknüpfung **"Copilot Desktop"** mit App-Icon

Danach: **Verknüpfung doppelklicken** oder an die Taskleiste pinnen — fertig.

### Manueller Start (alternativ)

```powershell
cd github-copilot-desktop
npm start
```

## Project Structure

```
copilot-desktop/
├── main.js              # Electron main process, IPC handlers, skill/agent/tutorial scanner
├── src/
│   ├── agents.js        # Agent directory scanner (*.agent.md)
│   ├── scanners.js      # Skill directory scanner
│   └── ipc/             # IPC handler modules
├── renderer/
│   ├── app.js           # Frontend logic, chat UI, skill/agent toggles, onboarding, tutorials
│   ├── modules/
│   │   └── todos.js     # Per-session todos module
│   ├── index.html       # App shell, onboarding wizard markup
│   └── styles.css       # Styles, themes, onboarding, shortcuts overlay
├── preload.js           # Electron preload script (IPC bridge incl. tutorial namespace)
├── __tests__/           # Jest test suites (939+ tests)
├── CHANGELOG.md         # Version history
└── package.json
```

## Documentation

- 🏛️ **[Architektur (arc42)](docs/ARCHITECTURE.md)** — vollständige arc42-Sicht: Kontext, Bausteine, Laufzeit, IPC-Channels, Verteilung, Risiken, ADRs
- 📘 **[Benutzerhandbuch](docs/USER-GUIDE.md)** — UI-Übersicht, Features, Erste Schritte, Tastenkombinationen
- 🐞 **[Known Issues](docs/known-issues.md)** — offene Punkte und gefixte Probleme

## License

MIT

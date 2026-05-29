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
- **GitHub Copilot** license (individual or business)

## Getting Started

### Option A — Automated Setup (recommended)

```powershell
git clone https://github.com/matthias-schneider_gebit/github-copilot-desktop.git
cd github-copilot-desktop
.\setup.ps1
```

The setup script automatically installs everything **without administrator rights**:
- Node.js (via winget, user scope)
- Python 3.12 (via winget, user scope — required for native module compilation)
- GitHub CLI + Copilot extension (via winget, user scope)
- All npm dependencies (native modules compiled via Python/node-gyp)

If not yet authenticated, the script will guide you to run `gh auth login`.

### Option B — Manual Setup

<details>
<summary>Click to expand</summary>

**Step 1 — Install Node.js 18+**
Download and install from [nodejs.org](https://nodejs.org/) (LTS recommended).
Verify: `node --version` should print `v18.x` or higher.

**Step 2 — Install Python 3.12+**
Required for native module compilation (node-gyp).
Download from [python.org](https://www.python.org/) or via winget:
```powershell
winget install Python.Python.3.12 --scope user
```
Verify: `python --version`

**Step 3 — Install GitHub CLI**
Download from [cli.github.com](https://cli.github.com/) or via winget:
```powershell
winget install GitHub.cli --scope user
```
Verify: `gh --version`

**Step 4 — Authenticate with GitHub**
```powershell
gh auth login
```
Follow the prompts (browser-based login). Make sure your account has a GitHub Copilot license.

**Step 5 — Install the Copilot CLI extension**
```powershell
gh extension install github/gh-copilot
```
Verify: `gh copilot --version`

**Step 6 — Clone and install the app**
```powershell
git clone https://github.com/matthias-schneider_gebit/github-copilot-desktop.git
cd github-copilot-desktop
npm install
```
`npm install` uses prebuilt native binaries — no compiler required in most cases.

**Step 7 — Start the app**
```powershell
npm start
```

</details>

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
- 📦 **[Portable Distribution](docs/PORTABLE-DISTRIBUTION.md)** — Maintainer-Doku zu Bundle-Layout, Build-Pipeline und Auto-Update-Mechanismus für die GEBIT-interne ZIP-Distribution
- 🐞 **[Known Issues](docs/known-issues.md)** — offene Punkte und gefixte Probleme

## Portable Distribution (GEBIT-internal)

For internal distribution we ship Copilot Desktop as a signature-free
portable ZIP — no installer, no admin rights, no certificate cost.
Build locally:

```powershell
npm install
npm run dist:portable
# → dist-portable\copilot-desktop-vX.Y.Z-portable.zip
```

Or trigger the CI release workflow by pushing a tag:

```powershell
npm version minor
git push origin main --follow-tags
# → ZIP attached to https://github.com/<owner>/<repo>/releases/latest
```

End-users extract the ZIP and double-click `start.bat`. The app
auto-detects new releases in the background and presents a
Firefox-style "Restart to apply" notification. See
[`docs/PORTABLE-DISTRIBUTION.md`](docs/PORTABLE-DISTRIBUTION.md)
for the full Bundle-Layout, Update-Mechanismus, and Test-Procedure.

## License

MIT

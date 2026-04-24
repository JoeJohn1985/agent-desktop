# Copilot Desktop

**Copilot Desktop** is an Electron-based desktop app that wraps the GitHub Copilot CLI in a polished chat interface. It supports multiple named sessions, toggleable AI skills with unique icons, markdown rendering, file drag & drop, and automatic task routing to sub-agents based on complexity — all in a clean, themeable UI.

## Features

- 💬 **Multi-Session Management** — Create, rename, and switch between named sessions
- 🧠 **Skill Toggles** — Enable/disable AI skills per session; active skills are injected into prompts automatically
- 🔍 **Skill Tags** — Visual indicators under each message showing which skills were active
- 📝 **Markdown Rendering** — Full markdown support including code blocks with syntax highlighting
- 🎨 **Themes** — Multiple built-in color themes
- 🔒 **Permission System** — Configurable tool permissions (read, write, shell, etc.)
- 📂 **File Drag & Drop** — Drop files directly into the chat
- 🔎 **Chat Search** — Search through conversation history
- ⚙️ **Settings Dialog** — Model selection, permissions, and preferences
- 🤖 **Sub-Agent Routing** — Automatic task complexity classification and delegation to specialized sub-agents

## Skills

The app dynamically loads skills from your local Copilot installation (`~/.copilot/skills/`). Skills can be toggled on/off per session — active skills are automatically injected into prompts and shown as tags below each message.

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
- GitHub CLI + Copilot extension (via winget, user scope)
- All npm dependencies (using prebuilt native binaries — no compiler needed)

If not yet authenticated, the script will guide you to run `gh auth login`.

### Option B — Manual Setup

<details>
<summary>Click to expand</summary>

1. Install [Node.js 18+](https://nodejs.org/)
2. Install [GitHub CLI](https://cli.github.com/) and authenticate: `gh auth login`
3. Install the Copilot extension: `gh extension install github/gh-copilot`
4. Install dependencies: `npm install`
5. Start the app: `npm start`

> If `npm install` fails due to native module compilation errors, [Windows Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) may be required (needs administrator rights).

</details>

## Project Structure

```
copilot-desktop/
├── main.js              # Electron main process, skill scanner, session management
├── renderer/
│   ├── app.js           # Frontend logic, chat UI, skill toggles
│   └── styles.css       # Styles and themes
├── preload.js           # Electron preload script
└── package.json
```

## License

MIT

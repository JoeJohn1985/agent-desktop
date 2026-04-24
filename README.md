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
├── main.js              # Electron main process, skill scanner, session management
├── renderer/
│   ├── app.js           # Frontend logic, chat UI, skill toggles
│   └── styles.css       # Styles and themes
├── preload.js           # Electron preload script
└── package.json
```

## License

MIT

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

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line) installed and authenticated
- [Node.js](https://nodejs.org/) 18+
- Windows (currently tested on Windows 10/11)

## Getting Started

```bash
# Install dependencies
npm install

# Start the app
npm start
```

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

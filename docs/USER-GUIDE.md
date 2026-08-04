# 📘 Agent Desktop – User Guide

**Version 1.0.0** · Electron-based desktop app for multiple LLM providers

---

## Table of contents

1. [Overview](#overview)
2. [Getting started](#getting-started)
   - [Requirements](#requirements)
   - [Installation](#installation)
   - [Onboarding wizard](#onboarding-wizard)
   - [First chat](#first-chat)
3. [User interface](#user-interface)
   - [Titlebar](#titlebar)
   - [Sidebar](#sidebar)
   - [Main area](#main-area)
   - [Session statusbar](#session-statusbar)
4. [Features in detail](#features-in-detail)
   - [Multi-session management](#multi-session-management)
   - [Chat](#chat)
   - [Tutorial popups](#tutorial-popups)
   - [File drag & drop](#file-drag--drop)
   - [Skills](#skills)
   - [Agents](#agents)
   - [MCP servers](#mcp-servers-sidebar)
   - [Todos](#todos)
   - [Session actions](#session-actions)
   - [Session resume](#session-resume)
   - [Settings](#settings)
   - [Themes](#themes)
5. [Keyboard shortcuts](#keyboard-shortcuts)

---

## Overview

Agent Desktop wraps multiple LLM providers (primarily the GitHub Copilot CLI, plus Anthropic, Gemini, OpenAI, GLM, Ollama) in a modern chat interface. Instead of working on the command line, you interact through a graphical application — including multi-session tabs, a sidebar for sessions, skills and todos, context monitoring, and cost tracking.

---

## Getting started

### Requirements

| Requirement | Details |
|---|---|
| Operating system | Windows 11 (primary), Linux, macOS |
| License | GitHub Copilot (active subscription) — only for the Copilot provider |
| Runtime | Node.js 18 or higher |
| CLI | GitHub CLI with the Copilot extension installed (optional; only for Copilot) |

### Installation

```powershell
git clone https://github.com/JoeJohn1985/agent-desktop.git
cd agent-desktop
.\setup.ps1    # or manually: npm install
npm start
```

> **Tip:** the setup script `setup.ps1` installs all dependencies automatically.

### Onboarding wizard

On the **first app start**, a 4-step onboarding wizard guides you through setup:

| Step | Content |
|---|---|
| **1. GitHub auth check** | Checks `gh auth status` and initiates `gh auth login` if needed |
| **2. Folder setup** | Creates the `~/.agent-desktop/` directory with all required subfolders |
| **3. Starter agents & skills** | Choice from 6 categories — each togglable on/off |
| **4. Feature intro** | 3-slide carousel of the most important app features |

> **Tab-unlock fallback:** if a step doesn't complete automatically, a manual unlock button appears after 30 seconds. After 180 seconds the next step is unlocked automatically.

> **Reset onboarding:** in developer mode (Settings) the wizard can be restarted at any time.

### First chat

1. **Start the app** — an empty "New chat" tab opens automatically.
2. **Type a message** and send it with **Enter**.
3. The provider responds in streaming mode — you see the answer appear in real time.
4. The session is created automatically and appears in the sidebar.

---

## User interface

The interface consists of four main areas: titlebar, sidebar, main area, and statusbar.

```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Agent Desktop                    v1.0.0         _ □ ✕     │  ← Titlebar
├────────────┬────────────────────────────────────────────────────┤
│            │  Tab 1 │ Tab 2 │ ➕                                │  ← Tab bar
│  Sessions  ├────────────────────────────────────────────────────┤
│            │  🧠 Sonnet  🤖 Agent  📊 18%  🔧 Tools   ~12.5C  │  ← Session actions
│  Skills    ├────────────────────────────────────────────────────┤
│            │                                                    │
│  Todos     │                  Chat area                         │
│            │                                                    │
│  Images    ├────────────────────────────────────────────────────┤
│            │  📤 [  Type a message…                        ] ➤  │  ← Chat input
│  ⚙️        ├────────────────────────────────────────────────────┤
│            │  🔌 3  🛠 5  📂 ~/Projects                        │  ← Statusbar
└────────────┴────────────────────────────────────────────────────┘
```

### Titlebar

The app uses a custom, frameless titlebar:

- **Left:** app icon and title "Agent Desktop"
- **Center:** version badge
- **Right:** window controls — minimize, maximize, close

### Sidebar

The sidebar is on the left edge. It contains six sections. Section header badges were removed in favor of a per-section **⋮ menu** (always visible in the header) that holds whichever secondary actions that section has — search, reload, manage, add, sync, etc. — so the header itself stays uncluttered.

#### 📂 Sessions

- **Session cards** show the provider icon and name. Hover a card to reveal its **⋮ menu**: **✏️ Umbenennen** (rename in place), **📁 Ordner festlegen/ändern**, **🗑️ Session löschen**.
- **Click** a card to open the session in a new tab.
- The header's **⋮ menu** holds the **search field** — opens with the input already focused, filters the list live while typing, and resets back to the full list once the menu is closed (it's a "find & open" tool, not a persistent filter).

> **Note:** only named sessions are shown in the sidebar. Unnamed sessions exist only as open tabs.

#### 🧠 Skills

- List of all available AI skills with icon, name, and description — follows the active tab's provider (Copilot's native `~/.copilot/skills/`, or the tab provider's own `~/.agent-desktop/<provider>/skills/`).
- The model decides on its own whether a skill is relevant and reads it via its file tool — nothing is force-fed into every prompt by default.
- **Toggle switch** force-activates a skill for the next message as an explicit override, on top of the automatic selection.
- **⊘ button** disables a skill globally in the Copilot CLI (`~/.copilot/settings.json`) — Copilot only.
- The header's **⋮ menu** holds **↻ Skills neu laden** and **⚙️ Skills verwalten** (opens the Skill Manager).

#### 🤖 Agents

- List of all available agents (persona/approach presets) with icon, name, and description — same provider-follows-active-tab behavior as Skills.
- Agents are a **persona switch**: if the model judges a task matches an agent's description, it reads that agent's `.agent.md` and adopts its approach for the rest of the task — still the same conversation, not a separate delegated sub-agent run.
- **Toggle switch** force-activates an agent for the next message, same override semantics as Skills.
- The header's **⋮ menu** holds **↻ Agents neu laden**.

#### 🔌 MCP-Server

- Shows configured MCP servers and their live connection status (🟢 connected / ⚪ configured / 🔴 disconnected) — Copilot only; direct-API providers have no MCP connection by design.

#### ✅ Todos

> This section is only visible when a session is loaded.

- **Todo list** with checkboxes and drag & drop to reorder.
- The header's **⋮ menu** holds the **"New todo…" input** (press `Enter` to add — no separate button) and **🔄 Nächste 5 Todos an Chat senden** (sends the next 5 open todos as a prompt).

#### 🖼️ Images

- **Thumbnail gallery** of images from the configured images folder.
- **Click** opens the lightbox view.
- 🗑️ **Delete** and an **"Open folder"** button.

#### Footer

- ⚙️ **Settings button** — opens the settings.

### Main area

#### Tab bar

- Each tab corresponds to its own chat session.
- ➕ **New tab** — creates a new, empty session.
- **Double-click** a tab title to rename it.
- ✕ **Close button** per tab.
- **Status badge** "Working" while the provider is responding.

#### Session actions bar

Directly below the tab bar you control the active session:

| Element | Description |
|---|---|
| **🔌 Provider** | Selects the backend per tab: *GitHub Copilot* or a direct API (Anthropic, Gemini, OpenAI, GLM, Ollama). API providers need a key (Settings → API providers) |
| **🧠 Model name** | Opens the model dropdown (shows only the selected provider's models; per tab, persistent) |
| **🤖 Mode** | Opens the mode/agent selection dropdown |
| **📊 XX%** | Context dropdown — shows usage, opens a detail panel, or runs compact/clear |
| **🔧 Tools** | Opens a popup for session-specific tool denials |
| **📈** | Opens the cost page (cost listing as a dedicated full-screen page) |
| **~XX.XC** | Estimated AI Credits for this session (always visible, `~0C` before the first prompt) |

#### Chat area

- **User messages** appear on the right, **assistant responses** on the left.
- Messages are rendered as **Markdown** with syntax highlighting.
- **"Thinking" sections** show the AI's reasoning (collapsible).
- **Tool calls** show a short, length-capped summary line (both the call and its result); click to expand the full, untruncated text — nothing is lost, just not dumped as a wall of text by default.
- **Skill/Agent tags** show which skills/agents were force-activated via the sidebar toggle when sending (automatic, model-chosen skills/agents don't show a tag).
- **Chat search** via `Ctrl+F`.
- A **scroll-to-bottom button** jumps to the end of the chat.

#### Chat input

- **Textarea** with the placeholder "Type a message…"
- **Rich-text toggle** (✏️) — switches to the rich-text editor.
- **Send button** (or `Enter`).
- `Shift+Enter` for a line break (textarea mode).

##### Rich-text editor

Clicking the ✏️ button enables rich-text mode:

- **Formatting toolbar**: **B**old, *I*talic, bullet list (UL), numbered list (OL).
- **Send:** `Ctrl+Enter` (Enter = line break).
- Formatting is automatically converted to Markdown on send.

### Session statusbar

At the bottom, the statusbar shows contextual information about the active session:

| Icon | Information |
|---|---|
| 🔌 | Number of connected MCP servers |
| 🛠 | Number of active skills |
| 📂 | Current working directory (CWD) — click to change |

---

## Features in detail

### Multi-session management

| Action | How to |
|---|---|
| **New session** | Click the ➕ tab → send a message → the session is created automatically |
| **Resume session** | Click the session card in the sidebar |
| **Rename session** | Double-click the tab title, or hover a session card → ⋮ → ✏️ Umbenennen |
| **Delete session** | Hover the session card → ⋮ → 🗑️ Session löschen → confirmation dialog |
| **Choose CWD** | Click 📂 in the statusbar, or hover a session card → ⋮ → 📁 Ordner festlegen/ändern |

### Chat

- Messages are rendered as **Markdown** with full syntax highlighting.
- **"Thinking" blocks** — collapsible for more transparency.
- **Tool calls** as collapsible cards.
- **Search:** `Ctrl+F` opens the chat search.

### Tutorial popups

Certain actions show one-time tutorial popups:

| Popup | Trigger | Auto-close |
|---|---|---|
| **"Reload skills"** | First click on the reload button | On another reload or after 30 seconds |
| **"Rename tab"** | First double-click on a tab title | After renaming or after 30 seconds |

### File drag & drop

Drag files directly into the chat area — the file paths are sent as context to the provider.

### Skills

- Skills are `SKILL.md` files. Copilot reads its own `~/.copilot/skills/`;
  Claude Code reads its own native `~/.claude/skills/` (Claude Code discovers
  these itself — we don't inject an index for it, that would just load the
  same skills twice). Anthropic, OpenAI, GLM and Ollama each have their own
  app-managed `~/.agent-desktop/<provider>/skills/` — created automatically on
  first launch.
- Exposed to the model as a lazy index (name + description + file path), not
  inlined eagerly. The model reads a specific `SKILL.md` itself, via its file
  tool, only once it judges it relevant to the current task.
- The sidebar list always shows the active tab's provider's skills.
- **Toggle switch** in the sidebar force-activates a skill for the next
  message — an explicit override on top of the automatic, model-driven
  selection.
- The **⊘ button** disables skills CLI-wide (`~/.copilot/settings.json`) — Copilot only.
- **Project skills** (`Project` badge): from `.github/skills/` in the active CWD.

### Agents

- Same folder structure as Skills — Copilot's own `~/.copilot/agents/`, every
  other provider's own `~/.agent-desktop/<provider>/agents/`. Files follow the
  `*.agent.md` format with YAML frontmatter (`name`, `description`, `tools`).
- Unlike Skills, agents are a **persona switch**: once the model judges a task
  matches an agent's description (from the same lazy index as Skills), it
  reads that agent's file and adopts its approach for the rest of the task —
  within the same conversation, not a delegated, isolated sub-agent run (that
  is a separate, not-yet-built feature).
- **Toggle switch** force-activates an agent for the next message. For
  Copilot this sends its native `/agent <name>` slash command; for every
  other provider a plain-language hint pointing at the same lazy index.
- The **sidebar badge** shows the total number of loaded agents for the active tab's provider.
- **Project agents** (`Project` badge): from `.github/agents/` in the active CWD.

### Instructions

- Direct-API providers only (Anthropic, OpenAI, GLM, Ollama) — Copilot and
  Claude Code already have their own native instructions discovery
  (`.github/copilot-instructions.md` / `CLAUDE.md`, read by the CLI itself)
  and don't need this.
- Each provider gets its own `~/.agent-desktop/<provider>/instructions/` with
  flat `*.instructions.md` files (YAML frontmatter `name`/`description` + a
  markdown body).
- **No sidebar UI and no on/off toggle**: every file present is always
  inlined in full into the system prompt for every message — unlike
  Skills/Agents, there's no "the model decides whether to read it" step,
  since instructions are meant to apply unconditionally. Dropping a file into
  the folder activates it; removing it deactivates it.
- **Not** additive to Copilot's global `copilot-instructions.md` — each
  direct-API provider uses only its own instructions folder, kept separate so
  it's clear which instructions apply to which provider. Settings → Features
  shows which providers support it.

### MCP servers (sidebar)

- The **badge** shows `connected/total`.
- **Project MCP** (`Project` badge): from `.github/mcp.json` in the active CWD.

### Todos

| Action | How to |
|---|---|
| **New todo** | Type text → ➕ or `Enter` |
| **Check off** | Click the checkbox |
| **Delete** | 🗑️ button |
| **Reorder** | Drag & drop |
| **Sync** | 🔄 button → first 5 open todos as a prompt |

### Session actions

#### 🧠 Model selection

Opens a dropdown for tab-specific model selection. Passed as the `--model` argument.

- Per tab; persistent across app restarts
- Default: `claude-sonnet-4.6`

#### 🤖 Mode

Selects the mode/agent for the active tab (e.g. Agent, Autopilot).

#### 📊 Context dropdown

Clicking the button (`📊 18%`) opens a dropdown with three actions:

**Show context**
- Detail panel with token usage, categories, and percentage
- Color coding: 🟢 green (≤ 60%), 🟡 yellow (61–80%), 🔴 red (> 80%)

**Compact**
- Summarizes the conversation so far and frees up context
- The % display updates automatically afterwards

**Clear**
- Clears the entire session context
- After clearing, `/context` is queried automatically — if the value drops to 0%, the button shows `📊 0%`

> **Tip:** when usage is red, use **Compact** or **Clear** to make room.

#### 🔧 Session tools

Opens a popup for session-specific tool denials:

- **Add tool:** enter a shell command (without `shell(...)`) and click ➕
- **Toggle:** turn a denial on/off
- **Delete:** 🗑️ button

> **Note:** every change restarts the ACP process automatically. The session is preserved — no data loss.

#### Cost display (`~XX.XC`) and cost page (📈)

On the right of the session bar you always see the estimated credit total of the current session (`~0C` before the first prompt). Computed from token usage × model price after each prompt; a tooltip shows the full `/usage` output.

The **📈 icon** next to it opens the **cost page** — a dedicated full-screen page (like the plugin marketplace, not a modal) with:

- **Day/week view** (toggle in the header)
- **Stacked bar chart**: each session has its own color
- **Breakdown**: cost per session + grand total
- **🗑️ Clear history** and **✕ Close** in the header

### Session resume

Reopening a saved session restores its full history in the tab and scrolls to the latest message — for every provider, each reading from that provider's own history store (Copilot's `events.jsonl`, Claude Code's own transcript, or the direct-API session store).

### Settings

Open the settings via the ⚙️ icon in the sidebar footer. Settings are organized by scope — app-wide, then one tab per actually-connected provider — rather than one grab-bag of mixed global/provider-specific options:

#### App tab

Everything that applies across every provider, not to one specific backend.

| Setting | Options |
|---|---|
| **Theme** | Light, Dark, GEBIT |
| **Chat font size** | 12–24 px (slider) |
| **Notification sound** | On / Off |
| **Default provider** | Provider new tabs and "+" start with |
| **CWD** | Working directory every provider uses by default (requires an app restart) |
| **Images folder** | Gallery folder, provider-independent (requires an app restart) |
| **Developer mode** | Enables the test runner (🧪) and developer console (🖥️) in the sidebar |

Every setting here auto-saves the moment you change it — no separate "Save" button. CWD/Images folder still need a full app restart to actually take effect (shown via a toast), since those are read once at startup.

#### Provider tab

Here you store API keys for the direct LLM providers (e.g. Anthropic). The keys are stored **encrypted via the OS keychain** and never leave the main process.

- One masked key field per provider with **Save**/**Delete** and status (set/empty).
- Once a key is set, the provider can be selected in the session bar (🔌) — and gets its own settings tab, see below.
- Direct-API tabs run fully agentic (own tool loop) with exact token cost accounting, prompt caching, and automatic context compaction. Every direct-API provider persists its conversation history under the hood, but session resume (rename → sidebar list → reopen) is currently only exposed for **Gemini**, alongside Copilot and Claude Code.

#### Per-provider tabs

A dedicated tab per provider that's actually usable right now: **Copilot** is always present (static, its native CLI configuration); **Claude Code** appears once its CLI is installed; the direct-API providers appear once a key is stored. Ollama needs no key, so its equivalent signal is a saved base URL on the Provider tab (defaults to `http://localhost:11434/v1`) — the tab appears once you've saved one. Each tab only shows what applies to that provider:

| Tab | Contains |
|---|---|
| **Copilot** | Default model, its native Sessions/Skills/Agents folders (browse, auto-saves), its own `copilot-instructions.md` editor, "allow all paths", additional directories, manual-approval default, its own **Verbotene Shell-Tools** deny list |
| **Claude Code** | Default model, its native `~/.claude/skills/` (read-only, opens in the file explorer — Claude discovers this on its own), its app-managed Agents folder, and its own `~/.claude/CLAUDE.md` editor (same idea as Copilot's) |
| **Anthropic / OpenAI / GLM / Ollama** | Default model, its Skills/Agents/Instructions folders (auto-created under `~/.agent-desktop/<provider>/`, read-only, opens in the file explorer), and its own **Verbotene Shell-Tools** deny list |
| **Gemini** | Default model, session resume (rename a tab to save it, reopen from the sidebar) — kept context-light otherwise, no Skills/Agents/Instructions/deny list (no shell tool) |

Each provider's shell-tool deny list is fully independent — blocking `git push` for Anthropic doesn't affect Copilot or any other provider. Claude Code has its own approval mechanism instead and isn't part of this at all.

#### Features tab

A comparison matrix of which core features each provider currently supports — unsupported ones are automatically hidden in that provider's active tab.

#### Shortcuts tab

Allows customizing all configurable shortcuts. Click **"Change"**, press the new combination (`Esc` cancels). **"🔄 Reset all"** restores all defaults.

> **Note:** the cost history is no longer a settings item but a dedicated page — see [Cost display and cost page](#cost-display-xxxc-and-cost-page-) under session actions.

### Shortcut help

The ⌨️ icon in the sidebar footer (or `Ctrl+/`) opens an overlay with all currently active shortcuts, grouped by category. Changed shortcuts are highlighted.

### Themes

| Theme | Description |
|---|---|
| **Light** | Light default theme |
| **Dark** | Dark theme |
| **GEBIT** | Corporate theme by GEBIT Solutions |

Switch via: **Settings → App → Theme**.

---

## Keyboard shortcuts

Configurable shortcuts can be customized via **Settings → Shortcuts**.

### Configurable

| Shortcut (default) | Action | Category |
|---|---|---|
| `Ctrl+T` | New tab | Tabs |
| `Ctrl+W` | Close tab | Tabs |
| `Ctrl+Tab` | Next tab | Tabs |
| `Ctrl+Shift+Tab` | Previous tab | Tabs |
| `Ctrl+L` | Focus input | Chat |
| `Ctrl+F` | Search chat | Chat |
| `Ctrl+/` | Shortcut help | UI |

### Hard-wired

| Shortcut | Action |
|---|---|
| `Ctrl+1` … `Ctrl+8` | Jump directly to tab 1–8 |
| `Ctrl+9` | Last tab |
| `Enter` | Send message |
| `Shift+Enter` | Line break in the message |
| `Escape` | Cancel action / close overlay |

---

> **Agent Desktop v1.0.0** · Built for GEBIT Solutions

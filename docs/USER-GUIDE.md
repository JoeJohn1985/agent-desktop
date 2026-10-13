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
   - [MCP servers](#mcp-servers-anbindungen)
   - [Backlog](#backlog)
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

The interface consists of a sidebar, main area with tabs, and statusbar. There is no separate titlebar.

```
┌─────────────────────────────────────────────────────────────────┐
│            │  Tab 1 │ Tab 2 │ ➕                     _ □ ✕      │  ← Tabs / window controls
│ Funktionen ├────────────────────────────────────────────────────┤
│            │  🧠 Sonnet  🤖 Agent  📊 18%             ~12.5C  │  ← Session actions
│  Project   ├────────────────────────────────────────────────────┤
│            │                                                    │
│  Backlog   │                  Chat area                         │
│            │                                                    │
│  Images    ├────────────────────────────────────────────────────┤
│            │  📤 [  Type a message…                        ] ➤  │  ← Chat input
│  ⚙️        ├────────────────────────────────────────────────────┤
│            │  🔌 3  🛠 5  📂 ~/Projects                        │  ← Statusbar
└────────────┴────────────────────────────────────────────────────┘
```

### Tabs and window controls

The frameless window places minimize, maximize/restore and close controls at the right of the tab row. They remain visible while overflowing tabs scroll independently. Drag the free area between tabs and controls to move the window. The separate app-name/icon titlebar has been removed; the version remains in the sidebar footer.

The settings gear is in the tab row, immediately left of the right-sidebar toggle.

### Sidebar

The sidebar starts with the app icon and **Agent Desktop**. Below it, **Neuer Chat** and **Funktionen** form a compact vertical icon-and-text navigation list. The window controls remain in the tab row; there is no separate titlebar.

**+ Neuer Chat**, above **Funktionen**, opens the same provider chooser as the tab-row plus button. Choosing a provider opens a new chat, including when a functions page is active. Existing chats remain unchanged; the tab-row plus button and `Ctrl+T` remain available.

The sidebar is on the left edge. **Funktionen**, above **Project**, opens a full-page area with four subpages: **Skills**, **Anbindungen**, **Plugins**, and **Kostenübersicht**. The sidebar remains available. The last visited subpage is remembered until the app closes. Close the page or select a chat tab to return without losing the draft or stopping the session. Skills and MCP lists are no longer separate sidebar sections; Plugins no longer has a fixed chat tab.

#### 📂 Project

- **Session cards** show the provider icon and name. Hover a card to reveal its **⋮ menu**: **✏️ Umbenennen** (rename in place), **📁 Ordner festlegen/ändern**, **🗑️ Session löschen**.
- **Click** a card to open the session in a new tab.
- The header's **⋮ menu** holds the **search field** — opens with the input already focused, filters the list live while typing, and resets back to the full list once the menu is closed (it's a "find & open" tool, not a persistent filter).

> **Note:** only named sessions are shown in the sidebar. Unnamed sessions exist only as open tabs.

#### 🧠 Skills (Funktionen)

- List of all available AI skills with icon, name, and description — follows the active tab's provider (Copilot's native `~/.copilot/skills/`, or the tab provider's own `~/.agent-desktop/<provider>/skills/`).
- The model decides on its own whether a skill is relevant and reads it via its file tool — nothing is force-fed into every prompt by default.
- **Toggle switch** force-activates a skill for the next message as an explicit override, on top of the automatic selection.
- The page shows the active chat's provider/project and each skill's description and source. Activation remains per chat tab, not global.
- The header's **⋮ menu** holds **↻ Skills neu laden**. Skill files are managed in the provider's folders.

#### 🔌 Anbindungen (Funktionen)

- Shows app-managed and native MCP servers with their source and live status. Central management is available regardless of the active chat provider; using the connections in a chat remains Copilot-only.
- **Server verwalten / hinzufügen** opens the existing server editor. Per-server menus retain connection, editing, enable/disable, logout and removal actions.

#### ✅ Backlog

Backlog is in the right sidebar, not the left navigation. The icon immediately left of minimize toggles this sidebar. It starts closed; its state is not saved across app restarts. It sits beside the chat or functions page without covering the content.

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
| **📈** | Opens the cost page (cost listing as a dedicated full-screen page) |
| **XX.XX AIC · $X.XX** | Copilot: total CLI-recorded session consumption and its USD equivalent (100 AIC = $1). Other API providers retain their token-based estimates. |

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
- Agents are no longer listed or toggled in the sidebar. Agent files and
  provider-native discovery remain available.
- **Project agents**: from `.github/agents/` in the active CWD.

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

### MCP servers (Anbindungen)

- **App-managed servers:** Open **Funktionen → Anbindungen → Server verwalten / hinzufügen**.
  Enter a unique name, the HTTPS endpoint and its transport (**HTTP** for
  Streamable HTTP, or **SSE** for legacy SSE), then save and click **Verbinden**.
  Complete the authorization in your browser if the server requires OAuth.
  The app stores credentials with OS encryption and refreshes tokens itself.
  Plain HTTP is supported only for local endpoints.
- **Automatic startup:** Enabled servers connect in the background when the app
  starts, using saved credentials and token refresh. Disabled servers are skipped.
  Startup never opens an authorization browser; if a new login is required, the
  status shows **Anmeldung erforderlich**.
- **Server actions:** Use the **⋮** menu directly next to the server in the sidebar
  or management dialog to connect, disconnect, edit, enable/disable, log out or
  remove it. **Bearbeiten** opens the form; ⚙ remains available for adding servers.
- **Trennen / Anmeldung abbrechen** closes the connection or cancels a pending
  login; **Abmelden** additionally clears saved credentials. Disabling a server
  removes its tools from subsequent Copilot sessions. Changes apply before the
  next message, preserving the existing native session.
- The `(App)` badge and status describe the remote connection, not merely
  Copilot's connection to the local bridge. Empty Copilot MCP sections remain
  visible so the management button stays accessible.
- App-managed connections are currently **Copilot-only** and support anonymous
  servers or OAuth with dynamic client registration. Static client credentials,
  custom authentication headers, sampling, elicitation, resource subscriptions,
  logging control and experimental tasks are not supported.
- The **badge** shows `connected/total`.
- **Project MCP** (`Project` badge): from `.github/mcp.json` in the active CWD.
- **Copilot connection:** Copilot CLI loads its user, workspace, and plugin MCP
  configuration itself. Agent Desktop does not resend those servers through
  ACP; the sidebar still reads the CLI configuration. This avoids duplicate
  configuration conflicts. For app-managed servers, Copilot receives only local
  stdio bridges through an app-owned startup configuration
  (`--additional-mcp-config`), not through ACP's server list; the app performs
  remote OAuth. Remove duplicate native remote
  entries yourself if necessary; the app never edits the CLI configuration.
  Compatibility with your particular remote server must still be verified.
- An empty native server list must remain valid JSON: `{"mcpServers":{}}`.
  Leaving `~/.copilot/mcp-config.json` as a zero-byte file causes the CLI to
  reject its MCP configuration, including startup loading.

### Backlog

| Action | How to |
|---|---|
| **New todo** | Type text → ➕ or `Enter` |
| **Check off** | Click the checkbox |
| **Delete** | 🗑️ button |
| **Reorder** | Drag & drop |
| **Sync** | 🔄 button → first 5 open todos as a prompt |

### Plans (across providers)

Plans are ordinary markdown files under `plans/` in your project — one file per
plan, e.g. `plans/reasoning-effort.md`. They exist so you can work something out
in one provider's session and continue it in another's: ask one agent to write a
plan, then in a session with a different provider ask it to carry that plan out.

There is nothing to click. The agents know the convention because Agent Desktop
keeps it in their own global instruction files:

| File | Written when |
|---|---|
| `~/.claude/CLAUDE.md` | the `claude` CLI is installed |
| `~/.copilot/copilot-instructions.md` | the `copilot` CLI is installed |

The app only ever touches a marked block in those files
(`<!-- agent-desktop:plans:start … end -->`) — everything else you have written
there stays untouched. The text itself comes from `~/.agent-desktop/plans.md`,
which is created on first start and never overwritten afterwards: **edit that
file if you want to change the wording or the rules.** Changes inside the block
in the target files are replaced on the next start, so make them in the source.

The `plans/` folder is not created up front — the agent creates it when it
writes the first plan.

Two current limits: the direct API providers (Anthropic, OpenAI, GLM, Ollama,
Gemini) don't get the convention yet, and for Claude Code over SSH the
instruction file lives on the remote host, which the app can't write to.

### Session actions

#### 🧠 Model selection

Opens the tab-specific model dropdown. Every model entry also shows its saved
reasoning level (`Standard`, `low`, `medium`, `high`, `xhigh` or `max`). Hover
over an entry or focus it with the keyboard to open its reasoning submenu.
Selecting a level selects the model and reasoning combination together.

This works identically for GitHub Copilot and Claude Code (both the local and
the SSH variant) — the reasoning levels are the same fixed set for every
model, no per-model or per-session lookup needed.

- Per tab; persistent across app restarts
- Default: `claude-sonnet-4.6`
- Each model keeps its own reasoning level within the tab/session
- `Standard` uses the backend's own default and does not add an override
- Changing reasoning takes effect before the next prompt; the current prompt is
  not interrupted
- On Copilot, a reasoning change transparently restarts the ACP process (a
  spawn-time flag); a model-only change does not. On Claude Code, reasoning is
  applied as a live session setting — no restart either way.

Direct API providers (Anthropic, OpenAI, GLM, Ollama, Gemini) keep their
existing model selection without a reasoning submenu.

**Defaults per provider.** Settings → the provider's own tab has both a
*Standard-Modell* and a *Standard-Reasoning*. A newly opened tab of that
provider starts on that combination; the 🧠 menu still overrides it per tab and
model at any time. `Standard` means no override is sent at all, leaving the
choice to the backend. Reopened or resumed tabs are unaffected — the levels
they already carry per model are the more specific answer and keep priority.

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

#### Cost display and cost page (📈)

For Copilot, the session bar shows the **entire session's CLI-recorded AIC
consumption** and its USD equivalent, including use before an app restart.
The source is `session.usage_checkpoint.data.totalNanoAiu` in that session's
`events.jsonl`, not a token-price estimate. The tooltip includes the checkpoint
time. This is recorded consumption, not proof of a GitHub account charge.
Missing or unsupported data displays **Verbrauch nicht verfügbar**; the app
does not fall back to an estimate or silently show zero.

After a session's CLI data is loaded, the cost page uses checkpoint increments
at their original timestamps. Older estimates for that session are excluded
from the chart but retained in storage. Repeated reads do not duplicate costs.
Clearing history removes stored entries; loading a Copilot session again
reimports its CLI-recorded history. Direct-API and Claude subscription accounting
are unchanged.

The **📈 icon** next to it opens the **cost page** — a dedicated full-screen page (like the plugin marketplace, not a modal) with:

- **Day/week view** (toggle in the header)
- **Stacked bar chart**: each session has its own color
- **Breakdown**: cost per session + grand total
- **🗑️ Clear history** and **✕ Close** in the header

### Session resume

Reopening a saved session restores its full history in the tab and scrolls to the latest message — for every provider, each reading from that provider's own history store (Copilot's `events.jsonl`, Claude Code's own transcript, or the direct-API session store).

### Costs and token usage

The costs page (💰 in the session-actions bar) charts spend in USD per period,
broken down by provider or by session.

Below that, **Claude tokens per 5-hour window** lists how many tokens were
consumed in each of Claude's subscription limit windows. Hover a row for the
split into input, output, cache read and cache write.

Two things worth knowing about that list:

- **It only covers usage since this feature was installed.** Claude's `/usage`
  reports the *current* window and the running session's totals — there is no
  history to fetch, so the app builds one by recording what it observes after
  each turn. It starts empty.
- **Windows are grouped by the reset time Claude reported**, not by counting
  back in 5-hour blocks. Claude's windows start with your first message and so
  don't tile the clock without gaps; computing boundaries would invent windows
  that never existed.

Clearing the cost log (🗑️) clears this list too.

### Settings

Open the settings via the ⚙️ icon in the sidebar footer. Settings are organized by scope — app-wide, then one tab per actually-connected provider — rather than one grab-bag of mixed global/provider-specific options:

#### App tab

Everything that applies across every provider, not to one specific backend.

| Setting | Options |
|---|---|
| **Theme** | Light, Dark |
| **Chat font size** | 12–24 px (slider) |
| **Notification sound** | On / Off |
| **Default provider** | Provider new tabs and "+" start with |
| **CWD** | Working directory every provider uses by default (requires an app restart) |
| **Images folder** | Gallery folder, provider-independent (requires an app restart) |
| **Developer mode** | Enables the test runner (🧪) and developer console (🖥️) in the sidebar, and the update notice for the Claude Code ACP adapter (see below) |

Every setting here auto-saves the moment you change it — no separate "Save" button. CWD/Images folder still need a full app restart to actually take effect (shown via a toast), since those are read once at startup.

**On the Claude Code adapter update notice:** the app pins one exact version of
the `@agentclientprotocol/claude-agent-acp` package — the one verified to work.
That package releases often, and its releases have broken things here before
(0.75.0 changed the `/usage` output format, which silently emptied the
subscription display). Updating it is therefore not a routine action, and the
notice only appears in developer mode. Without developer mode the app simply
stays on its pinned, working version — no check runs and nothing is shown.

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

Tool blocking is configured only in the provider settings, not separately for
individual chat tabs. Previously saved session-specific tool blocks are ignored;
the per-tab approval toggle and native permission requests remain available.

#### Features tab

A comparison matrix of which core features each provider currently supports — unsupported ones are automatically hidden in that provider's active tab.

#### Shortcuts tab

Allows customizing all configurable shortcuts. Click **"Change"**, press the new combination (`Esc` cancels). **"🔄 Reset all"** restores all defaults.

> **Note:** the cost history is no longer a settings item but a dedicated page — see [Cost display and cost page](#cost-display-and-cost-page-) under session actions.

### Shortcut help

The ⌨️ icon in the sidebar footer (or `Ctrl+/`) opens an overlay with all currently active shortcuts, grouped by category. Changed shortcuts are highlighted.

### Themes

| Theme | Description |
|---|---|
| **Light** | Light default theme |
| **Dark** | Dark theme |

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

> **Agent Desktop**
# Geplante Aufgaben

Unter **Funktionen → Geplante Aufgaben** lassen sich Copilot-Aufgaben anlegen,
bearbeiten, pausieren und löschen. Name, Prompt, Projektordner, Copilot-Modell
und erste lokale Datum/Uhrzeit sind Pflichtfelder. **0 Wochen** bedeutet
einmalig, **1–520 Wochen** eine Wiederholung am ursprünglichen Raster.
Die bei Anlage gespeicherte lokale Zeitzone bleibt auch nach einem Ortswechsel
maßgeblich. Bei Sommerzeitwechsel bleibt die lokale Uhrzeit gleich; eine nicht
existierende Wiederholungsstunde wird für diesen Termin um eine Stunde verschoben.

Die App muss laufen (minimiert genügt). Bei Start oder Aufwachen verpasste
Termine erscheinen als Erinnerung in der Funktionen-Navigation und als Anzahl
bei der Aufgabe. **Nachholen** verlangt eine ausdrückliche Bestätigung und
startet genau einen gebündelten Lauf, ohne das Wiederholungsraster zu ändern.
Pausierte fällige Termine zählen ebenfalls als verpasst.

Jeder Lauf verwendet eine frische Copilot-Sitzung im Hintergrund. Chat und
Entwurf bleiben unangetastet. Werkzeugfreigaben sind immer manuell. Bei
Anmeldung, Fehlern, Freigaben oder erkannten Rückfragen wird die Sitzung
geöffnet und das Fenster fordert Aufmerksamkeit an. Ein Fragezeichen oder
eine typische Bestätigungsaufforderung in der Antwort wird vorsichtshalber
als Rückfrage behandelt; das kann auch bei rein informativen Antworten passieren.

Der Verlauf enthält Prompt, Projekt, Modell, Sitzung und Antwort. Dort lässt
sich die Sitzung öffnen. **Beendet (fachlich ungeprüft)** bestätigt nur das Ende
der Agentenantwort, nicht beispielsweise eine erfolgreiche Wiki-Veröffentlichung.
Unterbrochene Läufe werden nach App-Neustart nicht erneut gestartet. Das Löschen
einer Aufgabe löscht nicht ihren Verlauf und stoppt keinen bereits laufenden Chat.

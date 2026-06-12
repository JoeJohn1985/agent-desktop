# Architektur — Copilot Desktop

## Überblick

Copilot Desktop ist eine Electron-basierte Desktop-Anwendung, die als grafisches Frontend für die GitHub Copilot CLI (`copilot`) dient. Die App spawnt für jede Chat-Nachricht einen CLI-Prozess mit `--output-format json --stream on` und streamt die JSONL-Antworten zeilenweise zurück an den Renderer, wo sie in Echtzeit als Markdown gerendert werden.

Die Architektur folgt dem Electron-Standardmuster: Ein **Main Process** (Node.js) verwaltet Fenster, Prozesse und Dateisystem-Zugriff. Ein **Renderer Process** (Browser-Kontext) zeigt die UI an. Dazwischen liegt ein **Preload-Script** als IPC-Bridge mit strikter `contextIsolation`.

## Technischer Stack

| Komponente | Bibliothek | Zweck |
|---|---|---|
| Runtime | Electron 35+ | Desktop-Shell, IPC, BrowserWindow |
| Terminal | @homebridge/node-pty-prebuilt-multiarch | Interaktive PTY-Sessions für Copilot TUI |
| Markdown | marked 18+ | Markdown → HTML Konvertierung |
| Syntax | highlight.js 11+ | Code-Highlighting in Chat-Antworten |
| Sanitizer | DOMPurify | XSS-Schutz bei gerenderten Antworten |
| Terminal UI | xterm.js 5 + xterm-addon-fit | Eingebettetes Terminal-Panel |
| Config | yaml | workspace.yaml Parsing (Sessions) |

## Prozess-Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron Main Process                      │
│  main.js + src/                                               │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ spawn()     │  │ node-pty     │  │ IPC Handlers       │  │
│  │ copilot CLI │  │ Terminal PTY │  │ (ipcMain.handle)   │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                 │                    │              │
└─────────┼─────────────────┼────────────────────┼──────────────┘
          │ JSONL stdout    │ PTY data           │ IPC channels
          ▼                 ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│                     Preload (preload.js)                       │
│  contextBridge.exposeInMainWorld('copilot', {...})            │
│  contextBridge.exposeInMainWorld('markdown', {...})           │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│                     Renderer Process                           │
│  renderer/app.js + renderer/index.html + renderer/styles.css │
│  Zugriff nur über window.copilot.* und window.markdown.*     │
└──────────────────────────────────────────────────────────────┘
```

### IPC-Kommunikation

- **invoke/handle** (Request/Response): `copilot:send`, `copilot:newTab`, `sessions:*`, `preferences:*`, etc.
- **send/on** (Fire-and-Forget): `copilot:stop`, `terminal:input`, `window:*`, `log:write`
- **Event-Streams** (Main → Renderer): `copilot:event`, `copilot:done`, `terminal:data`, `terminal:exit`

## Datenfluss

### Nachricht senden (Chat)

```
User tippt Nachricht
    → renderer/app.js: copilot.chat.send(tabId, prompt, options)
        → IPC invoke 'copilot:send'
            → main.js: spawnCopilot(tabId, prompt, options)
                → spawn('copilot', ['-p', prompt, '--output-format', 'json', '--stream', 'on', '-s', ...])
                    → stdout: JSONL-Zeilen werden geparsed
                    → sendToRenderer('copilot:event', tabId, parsedEvent)
                        → renderer empfängt via copilot.chat.onEvent(cb)
                            → Event-Handler rendert je nach event.type
    → Bei Prozess-Ende: sendToRenderer('copilot:done', tabId, exitCode)
```

### JSONL-Event-Format

Jede Zeile auf stdout ist ein JSON-Objekt. Wichtige Event-Typen:

```jsonl
{"type":"models.message.start","data":{"role":"assistant"}}
{"type":"models.message.delta","data":{"delta":{"type":"text","text":"Hallo..."}}}
{"type":"models.message.tool_use.start","data":{"tool_call_id":"abc","name":"shell","arguments":{}}}
{"type":"models.message.tool_use.delta","data":{"delta":{"arguments_delta":"{\"command\":\"ls\"}"}}}
{"type":"models.message.tool_result","data":{"tool_call_id":"abc","content":"..."}}
{"type":"models.message.end","data":{"stop_reason":"end_turn"}}
```

### Fehlerbehandlung

- `stderr`-Output wird als `{type: "error", data: {message: ...}}` Event an den Renderer gesendet.
- Unvollständige JSONL-Zeilen werden im Buffer gehalten bis `\n` eintrifft.
- Bei Prozess-Ende wird der Buffer geflusht.

## Dateistruktur

```
copilot-desktop/
├── main.js                    # Electron Main Process — Window, IPC, Prozess-Spawn
├── preload.js                 # IPC-Bridge — exposeInMainWorld('copilot', {...})
├── renderer/
│   ├── index.html             # App Shell (HTML-Grundgerüst)
│   ├── app.js                 # Gesamte Frontend-Logik (Tabs, Chat, UI)
│   └── styles.css             # Themes (light/dark/gebit), Layout
├── src/
│   ├── main-helpers.js        # sendToRenderer, waitForReady, collectPtyOutput, buildEnv
│   ├── sessions.js            # readCheckpoints, readPlan, readTodos, readRecentMessages
│   ├── scanners.js            # Skill-Verzeichnis Scanner, Folder-Config I/O
│   ├── agents.js              # Agent-Verzeichnis Scanner (.agent.md Dateien)
│   ├── preferences.js         # Preferences Manager (JSON, Backup, Migration)
│   ├── logger.js              # File-basiertes Logging (Rotation)
│   ├── utils.js               # stripAnsi, safeSessionPath, Icon-Helfer
│   ├── file-processing.js     # Drag&Drop File-Verarbeitung
│   ├── named-sessions.js      # Named-Sessions Verwaltung
│   ├── shortcuts.js           # Keyboard-Shortcuts
│   ├── frontend-helpers.js    # Shared Frontend-Utilities
│   ├── renderer-logic.js      # Ausgelagerte Renderer-Logik
│   └── ipc/
│       └── images-ipc.js      # Images IPC Handler (File Watcher)
├── assets/                    # Icons, App-Logo
├── vendor/                    # Bundled PowerShell (Windows)
├── __tests__/                 # Jest Unit-Tests
├── e2e/                       # Playwright E2E-Tests
├── .github/
│   ├── copilot-instructions.md
│   └── CONTRIBUTING.md
├── AGENTS.md                  # KI-Agent-Regeln (Versioning, Git-Workflow)
├── package.json               # Dependencies, Scripts
└── eslint.config.mjs          # Linting-Konfiguration
```

## Key Konzepte

### Tabs

Jeder Tab ist eine unabhängige Chat-Session. State pro Tab:

- `tabId` (numerisch, auto-increment vom Main Process)
- `sessionId` (UUID, CLI-kompatibel für `--resume`)
- `streamEl` / `statusEl` (DOM-Referenzen)
- `isProcessing`, `lastActivityAt`, `autopilot`
- `selectedModel`, `cwd`, `sessionDeniedTools`
- `terminal` (optionale PTY-Instanz)

Tabs werden in einer `Map<string, TabObject>` im Renderer verwaltet. `activeTabId` zeigt auf den sichtbar aktiven Tab.

### Sessions

Sessions sind persistente Copilot-CLI-Verzeichnisse unter `~/.copilot/session-state/<uuid>/`. Sie enthalten:
- `workspace.yaml` — Metadaten (Name, CWD, Timestamps)
- `checkpoints/` — Zusammenfassungen der Konversation
- `plan.md` — Agent-Plan
- `todos.json` — Task-Liste

Die App kann Sessions fortsetzen (`--resume=<sessionId>`), umbenennen und löschen.

### Skills

Skills sind wiederverwendbare Prompt-Erweiterungen (ähnlich Plugins). Quellen:
- **Builtin**: `~/.copilot/skills/<dirName>/`
- **User**: Konfigurierbar via `folders.json`
- **Project**: `<cwd>/.github/skills/<dirName>/`

Skills können aktiviert/deaktiviert/versteckt werden. Aktive Skills werden als Set verwaltet (`activeSkills`).

### Agents

Agents sind `.agent.md` Dateien die System-Prompts definieren. Quellen:
- `~/.copilot/agents/`
- `<cwd>/.github/agents/`

### MCP-Server

MCP (Model Context Protocol) Server werden aus `<cwd>/.github/mcp.json` gelesen. Die App zeigt deren Status an und leitet die Konfiguration an die CLI weiter.

### Model-Selection

Modell-Auswahl pro Session (`tab.selectedModel`). Wird als `--model` Flag an die CLI übergeben und in `sessionModels` Preferences persistiert.

### CWD-Management

- Globaler CWD: `COPILOT_CWD` (aus `folders.json` oder `process.cwd()`)
- Per-Session CWD: `tab.cwd` (überschreibt global für `spawn()`)
- Globaler CWD wird immer als `--add-dir` mitgegeben, auch wenn Session-CWD abweicht

### Tool-Approval

Die App nutzt `--allow-all-tools` und steuert Einschränkungen über Deny-Listen:
- **Globale Deny-List**: `settings.deniedTools` (gilt für alle Sessions)
- **Admin Deny-List**: `settings.adminDeniedTools` (nicht vom User änderbar)
- **Per-Session Deny-List**: `tab.sessionDeniedTools`

Jeder denied Tool-Name wird als `--deny-tool=<name>` an die CLI übergeben.

## State Management

Der Renderer verwaltet State als Module-Level-Variablen in `app.js`:

```javascript
// Primärer Tab-State
const tabs = new Map();           // tabId → TabObject
let activeTabId = null;           // Aktuell sichtbarer Tab

// Session-State
let activeSessionId = null;       // Session des aktiven Tabs
let sessions = [];                // Sidebar-Liste

// Feature-State
let skills = [];                  // Geladene Skill-Definitionen
let agents = [];                  // Geladene Agent-Definitionen
let mcpServers = [];              // MCP-Server des aktiven Tabs
let activeSkills = new Set();     // Aktivierte Skills
let activeAgents = new Set();     // Aktivierte Agents

// UI-State
let _prefs = {};                  // Preferences-Cache (file-backed)
const inputHistory = [];          // Chat-Input-History
let richTextMode = false;         // Editor-Modus Toggle
```

Persistenz erfolgt über das `preferences`-System (JSON-Datei in `app.getPath('userData')`). Änderungen werden sofort geschrieben (`setPref()`).

## Konfiguration

### Preferences (`preferences.json`)

Gespeichert in:
- **Produktion**: `%APPDATA%/copilot-desktop/preferences.json` (Windows)
- **Test**: `./preferences.test.json`

Enthält: Theme, offene Tabs, Named Sessions, Session-Modelle, Settings, Tutorial-Flags.

### Folder Config (`~/.copilot-desktop/folders.json`)

Konfiguriert Pfade:
- `cwd` — Standard-Arbeitsverzeichnis
- `sessionsDir` — Session-State Verzeichnis
- `skillsDir` — Skill-Verzeichnis
- `agentsDir` — Agents-Verzeichnis
- `imagesDir` — Bilder-Verzeichnis
- `instructionsFile` — Pfad zur Instructions-Datei

### Instructions Files

Copilot-Instructions werden aus mehreren Quellen geladen (Prioritätsreihenfolge):
1. Konfigurierter Pfad (`folders.json → instructionsFile`)
2. `<cwd>/copilot-instructions.md`
3. `<cwd>/.github/copilot-instructions.md`
4. `~/.github/copilot-instructions.md`

### Settings (in Preferences)

Unter `_prefs.settings` gespeichert:
- `deniedTools` — Globale Tool-Deny-Liste
- `adminDeniedTools` — Admin-geschützte Deny-Liste
- `extraDirs` — Zusätzliche `--add-dir` Pfade

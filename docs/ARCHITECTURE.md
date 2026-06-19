# Copilot Desktop — Architektur (arc42)

> **Version:** 0.31.0 · **Stand:** Juni 2026 · **Stack:** Electron 35, ACP (JSON-RPC/NDJSON), marked, highlight.js, jest

---

## 1. Einführung und Ziele

### 1.1 Aufgabenstellung

**Copilot Desktop** ist eine Electron-Desktop-App, die das CLI `copilot` (GitHub Copilot CLI) in eine polierte Chat-Oberfläche einbettet. Statt auf der Kommandozeile zu arbeiten, bekommt der User:

- Markdown-Rendering mit Syntax-Highlighting
- Multi-Tab-Sessions, die parallel mit der CLI sprechen (via **ACP-Protokoll**)
- Persistente Sessions, Skills, Tools und Permissions
- Drag-&-Drop für Dateien und Bilder
- Kontext-Überwachung (`/context`) und -Management (`/compact`, `/clear`) direkt aus der UI
- Themes (Light, Dark, GEBIT), Settings, Sub-Agent-Routing, Test-Runner
- Kosten-Tracking auf Basis von Token-Verbrauch und Modellpreisen

### 1.2 Qualitätsziele

| Priorität | Qualitätsziel | Begründung |
|---|---|---|
| 1 | **Zuverlässige CLI-Integration** | Die App ist nutzlos, wenn der ACP-Prozess bricht oder Events verloren gehen. |
| 2 | **Cross-Platform-Lauffähigkeit** | Primärziel Windows 11; Linux & macOS müssen funktionieren. |
| 3 | **UI-Responsiveness** | Streaming-Antworten ohne Frame-Drops auch bei langen Markdown-Outputs. |
| 4 | **Sicherheit** | Renderer ohne Node-Integration; alles via `contextBridge`. DOMPurify gegen XSS in CLI-Output. |
| 5 | **Testbarkeit** | Jede Logik, die nicht zwingend Electron braucht, lebt in `src/` mit Unit-Tests (>500 Tests). |

### 1.3 Stakeholder

| Rolle | Erwartungen |
|---|---|
| **Endnutzer (Entwickler)** | Schneller, stabiler GUI-Zugang zu Copilot mit allem, was die CLI kann + UI-Komfort |
| **Wartende Entwickler** | Klare Modul-Grenzen, ausführliche Tests, lesbare Doku |
| **Security-Review** | Saubere Renderer/Main-Trennung, kein direkter `eval`/Node-Zugriff im Renderer, sanitisierter HTML-Output |
| **Betrieb / Setup** | `setup.ps1` / manuelle Anleitung muss auf frischen Maschinen funktionieren — siehe README |

---

## 2. Randbedingungen

### 2.1 Technisch

- **Electron 35.x** als Runtime (Chromium + Node.js).
- **GitHub Copilot CLI** (`copilot`-Binary aus `gh extension install github/gh-copilot`) muss im PATH des Prozesses auffindbar sein.
- **ACP (Agent Communication Protocol):** Die App kommuniziert mit der CLI ausschließlich über `copilot --acp` (JSON-RPC über NDJSON auf stdio). Kein direktes CLI-Spawning mit `--output-format json`, kein PTY mehr.
- **Keine eigene Cloud-Komponente** — alle KI-Roundtrips laufen über den lokal installierten Copilot CLI.

### 2.2 Organisatorisch

- Lizenz: MIT
- Branch-Workflow: kein direkter Push auf `main`. Feature-/Fix-Branches mit Conventional Commits.
- Versionierung: SemVer; vor jedem Commit Patch- oder Minor-Bump in `package.json`.

### 2.3 Konventionen

- **Sprachen:** Code & Tests in englischen Bezeichnern, Kommentare/UI/Doku überwiegend Deutsch.
- **Linter:** ESLint flat-config (`eslint.config.mjs`).
- **Tests:** Jest (Unit) + Playwright (E2E unter `e2e/`).

---

## 3. Kontextabgrenzung

### 3.1 Fachlicher Kontext

```
                ┌──────────────────────────┐
                │   User (Entwickler)      │
                │   Maus, Tastatur,        │
                │   Drag&Drop, Clipboard   │
                └────────────┬─────────────┘
                             │ GUI (Electron Window)
                             ▼
   ┌─────────────────────────────────────────────────┐
   │              Copilot Desktop (App)              │
   └──┬──────────────┬────────────────┬──────────────┘
      │              │                │
      │ ACP          │ liest/         │ liest/schreibt
      │ (JSON-RPC)   │ schreibt       │ (Theme, Tabs,
      ▼              ▼                ▼   Permissions)
 ┌──────────┐  ┌────────────┐  ┌───────────────────────┐
 │ copilot  │  │ ~/.copilot │  │ userData/             │
 │   CLI    │  │ /sessions, │  │   preferences.json    │
 │  --acp   │  │   skills,  │  │ ~/.copilot-desktop/   │
 │ (gh ext) │  │ instructns │  │   logs, folders.json  │
 └────┬─────┘  └────────────┘  └───────────────────────┘
      │
      ▼
 GitHub Copilot Cloud  (über CLI; nicht direkt aus der App)
```

### 3.2 Technischer Kontext

| Schnittstelle | Richtung | Beschreibung |
|---|---|---|
| **Copilot CLI (ACP)** | App ↔ CLI | `copilot --acp` — JSON-RPC über NDJSON auf stdin/stdout. Methoden: `initialize`, `session/new`, `session/load`, `session/prompt`. Events: `session/update`-Notifications |
| **Filesystem** | App ↔ Disk | Sessions (`~/.copilot/session-state/`), Skills (`~/.copilot/skills/`), Logs (`~/.copilot-desktop/logs/`), Preferences (`app.getPath('userData')/preferences.json`), Folders-Config |
| **Shell** | App → Shell | Test-Runner spawnt `npm test`, `npm run test:coverage`, Playwright |
| **OS Window-Manager** | App ↔ OS | Native Frame deaktiviert; Custom Titlebar mit min/max/close via IPC |

---

## 4. Lösungsstrategie

| Entscheidung | Warum |
|---|---|
| **Electron** statt Web-App | Nativer Filesystem- und CLI-Zugriff — undenkbar im Browser |
| **Renderer ohne Node-Integration** | XSS in CLI-Output darf nie zum RCE werden. Alles über `contextBridge` in `preload.js`. |
| **ACP statt JSONL-Spawn + PTY** | Ein einziger langlebiger Prozess pro Tab (statt Spawn-per-Message + PTY); Slash-Commands via `silentCommand()` statt PTY-Bracketed-Paste. Robuster, einfacher zu testen, kein node-pty mehr. |
| **`src/` für reine Logik, `src/ipc/` für IPC-Handler** | Trennung Domänenlogik vs. Electron-Bindings → testbar ohne Electron-Mock-Hölle |
| **`silentCommand(command)`** | Slash-Commands (`/context`, `/usage`, `/compact`, `/clear`) werden als stille `session/prompt`-Requests abgesetzt; die Response-Chunks werden intern gesammelt und nicht an die UI weitergeleitet |
| **`--deny-tool` nur beim Spawn** | ACP hat keine Runtime-API für Tool-Denial → Prozess-Neustart (`stop → updateOptions → start → loadSession`) bei Änderung der Session-spezifischen Deny-Liste |
| **`buildEnv()` für Child-Prozesse** | Electron sourct unter Linux/macOS keine Shell-RC → `~/.local/bin` etc. fehlen → `copilot`-Binary nicht auffindbar. Wird zentral gefixt. |
| **Markdown-Rendering im Preload** | Marked + Highlight.js + DOMPurify einmal initialisiert, im Renderer als reine Funktion `window.markdown.render` |

---

## 5. Bausteinsicht

### 5.1 Whitebox Gesamtsystem (Level 1)

```
┌────────────────────────────── Renderer Process ──────────────────────────────┐
│                                                                              │
│  renderer/index.html  ─►  renderer/app.js  (Chat-, Tab-, Settings-Logik)    │
│                                                                              │
│           ┌──────────────────── renderer/modules/ ──────────────────┐        │
│           │ session-tools.js  images.js  todos.js  test-runner.js   │        │
│           │ dev-console.js  costs.js  utils.js                      │        │
│           └─────────────────────────────────────────────────────────┘        │
│                              │                                               │
│                              ▼ window.copilot.* / window.markdown.render     │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │  contextBridge (preload.js, sandboxed)
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                                Main Process                                  │
│                                                                              │
│  main.js (~500 LoC, Bootstrap + Window + AcpClient-Verwaltung + IPC-Glue)   │
│     │                                                                        │
│     ├── src/acp-client.js             — AcpClient (JSON-RPC über NDJSON)    │
│     ├── src/ipc/images-ipc.js         — Bilder/Videos IPC                   │
│     ├── src/ipc/tests-ipc.js          — Test-Runner IPC                     │
│     │                                                                        │
│     ├── src/main-helpers.js           — buildEnv, sendToRenderer             │
│     ├── src/renderer-logic.js         — Pure Logik (parseTokens, pricing, …)│
│     ├── src/preferences.js            — read/write/migrate Preferences       │
│     ├── src/sessions.js               — Checkpoints, Plan, Todos             │
│     ├── src/named-sessions.js         — User-Bezeichner für Session-IDs      │
│     ├── src/scanners.js               — Skills, Folder-Config                │
│     ├── src/agents.js                 — Sub-Agent-Verzeichnis                │
│     ├── src/file-processing.js        — Drag&Drop-Pipeline                   │
│     ├── src/logger.js                 — File-Logger ~/.copilot-desktop/logs  │
│     └── src/utils.js                  — stripAnsi, safeSessionPath, …       │
└──────────────────────────────────────────────────────────────────────────────┘
                               │  ACP (JSON-RPC / NDJSON stdio)
                               ▼
                    ┌─────────────────────┐
                    │  copilot --acp      │
                    │  (ein Prozess/Tab)  │
                    └─────────────────────┘
```

### 5.2 Prozess-Trennung

| Prozess | Verantwortung |
|---|---|
| **Main Process** | Window-Erstellung, AcpClient-Management, File-I/O, alle IPC-Handler |
| **Renderer Process** | UI-Rendering, Chat-Logik, Tab-State, Theme-Verwaltung |
| **preload.js** | Sichere Brücke zwischen Main und Renderer via `contextBridge` |

### 5.3 Dateistruktur

| Datei / Ordner | Beschreibung |
|---|---|
| `main.js` | **Electron Main Process** — Window-Erstellung, AcpClient-Verwaltung, IPC-Glue |
| `preload.js` | **Context Bridge** — exponiert `window.copilot` und `window.markdown` |
| `renderer/index.html` | **App-Shell** — Custom Titlebar, Sidebar, Chat-Area, Settings-Overlay |
| `renderer/app.js` | **Frontend-Logik** — Chat-UI, Tab-Management, Settings, Kosten-Visualisierung |
| `renderer/styles.css` | **Alle Styles** — CSS-Variablen, 3 Themes (Light/Dark/GEBIT) |
| `renderer/modules/*.js` | **UI-Module** — Bilder, Todos, Test-Runner, Session-Tools, Dev-Console, Kosten-Panel |
| `src/acp-client.js` | **AcpClient** — JSON-RPC über NDJSON stdio, Session-Management, silentCommand |
| `src/renderer-logic.js` | **Pure Logik** — Token-Parser, Credit-Berechnung, Cost-Log-Helfer |
| `src/ipc/*.js` | **IPC-Handler-Module** — Bilder, Tests |
| `src/*.js` | **Reine Logik-Module** — testbar ohne Electron |
| `__tests__/` | **Jest Unit-Tests** |
| `e2e/` | **Playwright E2E-Tests** |

### 5.4 AcpClient (`src/acp-client.js`)

Der `AcpClient` kapselt die gesamte Kommunikation mit einem `copilot --acp`-Prozess.

**State-Machine:**
```
dead → starting → ready ⇄ busy → dead
```

**Wichtige Methoden:**

| Methode | Beschreibung |
|---|---|
| `start()` | Spawnt `copilot --acp`, führt `initialize`-Handshake durch |
| `stop()` | Beendet den Prozess sauber |
| `newSession(sessionId, opts)` | Erstellt eine neue ACP-Session |
| `loadSession(sessionId)` | Lädt eine bestehende Session (nach Prozess-Neustart) |
| `prompt(text, opts)` | Sendet eine Nachricht, streamt Events an den Renderer |
| `silentCommand(command)` | Sendet einen Slash-Command (`/context`, `/usage`, …) und gibt den Text zurück, ohne etwas an die UI weiterzuleiten |
| `updateOptions(opts)` | Aktualisiert Options (z. B. `deniedTools`) für den nächsten Start |

**`silentCommand`-Ablauf:**
1. Setzt `#contextQueryCollector = []`
2. Sendet `session/prompt` mit dem Command-Text
3. `agent_message_chunk`-Events werden in den Collector geschrieben statt an den Renderer
4. `agent_turn_start/end`-Events werden unterdrückt
5. Nach Response: gibt `collector.join('')` zurück, setzt Collector auf `null`

**Prozess-Neustart für Session-spezifische Tool-Denial:**
Da `--deny-tool`-Flags nur beim Spawn akzeptiert werden, muss bei Änderung der Session-spezifischen Deny-Liste der Prozess neu gestartet werden:
```
stop() → updateOptions({ deniedTools }) → start() → loadSession(sessionId)
```

### 5.5 Renderer-Module

| Modul | Aufgabe |
|---|---|
| `session-tools.js` | UI für Session-spezifische Denied-Tools (Popup, Toggle, Prozess-Neustart) |
| `costs.js` | Kosten-Log-Persistenz und „Kosten"-Settings-Tab (gestapeltes Balkendiagramm + Aufschlüsselung) |
| `images.js` | Bild-Thumbnails, Lightbox, Drag&Drop in den Chat |
| `todos.js` | Per-Session-Aufgabenliste mit IPC-Backend |
| `test-runner.js` | Frontend für Jest/Playwright/Coverage |
| `dev-console.js` | UI-Pendant zur Browser-DevConsole |
| `utils.js` | DOM-Hilfen |

### 5.6 `src/renderer-logic.js` — Pure Logik

Enthält alle Funktionen, die keine DOM- oder Electron-Abhängigkeiten haben:

- **Token-Parsing:** `parseTokenK`, `parseUsageTokens`, `parseUsageRequests`
- **Credit-Berechnung:** `estimateCredits(tokens, modelId)`, `MODEL_PRICING`
- **Cost-Log-Helfer:** `buildCostBuckets`, `aggregateCostBySession`, `trimCostLog`
- **Display-Helfer:** `shortenPath`, `truncatePath`, `formatDate`, `escapeHtml`, `toolIcon`, …

### 5.7 First-Run Onboarding Wizard

Ein mehrstufiger Wizard, der beim allerersten App-Start den User durch Authentifizierung, Ordner-Konfiguration und Feature-Einführung leitet.

| Schritt | Beschreibung |
|---|---|
| 1. Auth | Prüfung/Anleitung für `gh auth login` |
| 2. Folder Setup | Auswahl des Arbeitsverzeichnisses |
| 3. Category Selection | Skill-Kategorien zur Vorinstallation auswählen |
| 4. Feature Intro | Überblick über App-Features |

---

## 6. Laufzeitsicht

### 6.1 Chat-Anfrage (Happy Path, ACP)

```
User              Renderer            Preload          Main            AcpClient         copilot --acp
 │ tippt + Enter    │                    │                │                │                    │
 │─────────────────▶│                    │                │                │                    │
 │                  │ copilot.chat       │ ipcRenderer    │                │                    │
 │                  │ .send(tabId, ...)  │ .invoke(       │                │                    │
 │                  │───────────────────▶│  'copilot:send'│                │                    │
 │                  │                    │───────────────▶│ client.prompt()│                    │
 │                  │                    │                │───────────────▶│ session/prompt     │
 │                  │                    │                │                │───────────────────▶│
 │                  │                    │                │                │◄── session/update ─┤
 │                  │ ◄── copilot:event ─┼────────────────┤ emitToRenderer │  (chunks, tools,…) │
 │                  │ render delta       │                │                │                    │
 │                  │                    │                │                │◄── done (result) ──┤
 │                  │ ◄── copilot:done ──┼────────────────┤                │                    │
```

**Detaillierter Ablauf:**
1. `sendMessage()` im Renderer sammelt: Text, aktive Skills, Modell, Session-ID, Deny-Tools, CWD, Autopilot-Flag
2. IPC-Call `copilot:send` → `main.js` → `client.prompt(text, opts)`
3. AcpClient sendet `session/prompt` an den laufenden `copilot --acp`-Prozess
4. `session/update`-Notifications kommen als NDJSON-Stream zurück
5. Events werden gemappt und via `sendToRenderer('copilot:event', tabId, event)` an den Renderer gesendet
6. Bei Abschluss: `copilot:done`-Event → Tab-Status wird zurückgesetzt
7. `refreshUsageDisplay()` ruft `silentCommand('/usage')` auf und berechnet Kosten-Delta

### 6.2 Slash-Command (`/context`, `/compact`, `/clear`, `/usage`)

```
Renderer
  │  window.copilot.chat.silentCommand(tabId, '/context')
  │
  ▼  IPC: copilot:silentCommand
Main
  │  client.silentCommand('/context')
  │
  ▼  AcpClient
     #contextQueryCollector = []
     session/prompt → { type: text, text: '/context' }
     │
     ├── agent_message_chunk → collector.push(text)   [nicht an Renderer]
     ├── agent_turn_start/end → unterdrückt
     │
     ▼  Response
     return collector.join('')   → z.B. "Context: 18% (36k/200k tokens)\n..."
```

**Kein PTY mehr:** Alle Slash-Commands laufen über `silentCommand()` als stille ACP-Requests. Das ist zuverlässiger als PTY-Bracketed-Paste und braucht kein `node-pty`.

### 6.3 Prozess-Neustart (Session-spezifische Tool-Denial)

```
User deaktiviert Tool in Session-Tools-Popup
  │
  ▼  restartWithUpdatedDeniedTools()  [renderer/modules/session-tools.js]
     IPC: copilot:restartWithDeniedTools(tabId, mergedDeniedTools)
  │
  ▼  main.js
     client.stop()                    → Prozess beenden
     client.updateOptions(deniedTools)→ neue Deny-Liste setzen
     client.start()                   → neuen Prozess spawnen
     client.loadSession(sessionId)    → Session wiederherstellen
```

### 6.4 App-Start

```
1. main.js geladen
2. initLogger()
3. console.log/warn/error gehookt (→ Datei + DevConsole)
4. folderConfig = readFolderConfig()
5. _prefsManager = createPreferencesManager(...)
6. app.whenReady() → BrowserWindow
7. IPC-Handler registriert
8. Renderer lädt index.html → app.js
9. preferences:read → persistenter State
10. Tabs aus openTabs wiederhergestellt
11. Für jeden Tab: AcpClient erstellt + gestartet (session/new oder session/load)
12. Onboarding prüfen → ggf. Wizard
```

### 6.5 IPC-Kommunikation

#### Namespace: `copilot` (Chat / ACP)

| Channel | Typ | Beschreibung |
|---|---|---|
| `copilot:send` | handle | Sendet Chat-Nachricht via ACP |
| `copilot:stop` | on | ACP-Prozess für Tab stoppen |
| `copilot:silentCommand` | handle | Slash-Command still ausführen, Text zurückgeben |
| `copilot:restartWithDeniedTools` | handle | Prozess neu starten mit neuer Deny-Liste |
| `copilot:getCwd` | handle | Aktuelles Arbeitsverzeichnis |
| `copilot:openCwd` | handle | CWD im Explorer öffnen |
| `copilot:getVersions` | handle | Versionen (App, CLI, Node, Electron) |
| `copilot:getInstructions` | handle | `copilot-instructions.md` lesen |
| `copilot:openLogDir` | handle | Log-Verzeichnis öffnen |

#### Namespace: `sessions`

| Channel | Typ | Beschreibung |
|---|---|---|
| `sessions:create` | handle | Neue benannte Session erstellen |
| `sessions:delete` | handle | Session-Ordner löschen |
| `sessions:readCheckpoints` | handle | Checkpoint-Dateien lesen |
| `sessions:readPlan` | handle | `plan.md` lesen |

#### Namespace: `todos` / `images` / `videos`

| Channel | Beschreibung |
|---|---|
| `todos:list/add/update/delete/reorder` | CRUD + Reorder für Session-Todos |
| `images:list/open/delete/openFolder` | Bilder-Management |
| `videos:extractFrames` | Video-Frame-Extraktion |

#### Namespace: `preferences` / `instructions` / `folders` / `skills` / `agents` / `files` / `tests` / `window` / `log`

| Channel | Beschreibung |
|---|---|
| `preferences:read/write` | Preferences I/O |
| `instructions:read/write` | `copilot-instructions.md` I/O |
| `folders:read/save/browse/browse-file` | Ordner-Konfiguration |
| `skills:list/listProject/getDisabled/setDisabled` | Skills-Verwaltung |
| `agents:list/listProject` | Sub-Agents |
| `mcp:listProject` | MCP-Server aus `mcp.json` |
| `files:processDropped` | Drag&Drop-Verarbeitung |
| `tests:run/coverage/e2e` | Test-Runner |
| `window:minimize/maximize/close` | Fenstersteuerung |
| `log:write` | Log-Eintrag aus Renderer |

#### Namespace: `onboarding` / `tutorial` / `dev`

| Channel | Beschreibung |
|---|---|
| `onboarding:getStatus/setComplete/getCategories/installCategory` | First-Run-Wizard |
| `tutorial:getFlags/setFlag` | Tutorial-Flags (Key-Whitelist: `tutorialSkillsShown`, `tutorialRenameShown`) |
| `dev:setOnboardingComplete` | Onboarding zurücksetzen |

---

## 7. Verteilungssicht

| Umgebung | Komponenten | Persistenz |
|---|---|---|
| **End-User-Desktop** (Win 11, Linux, macOS) | Electron-App, `copilot`-CLI (extern) | `app.getPath('userData')` (Theme, Tabs, Permissions, Cost-Log); `~/.copilot-desktop/` (Logs, Folders); `~/.copilot/` (Sessions, Skills — CLI-verwaltet) |
| **CI** | `node`, `npm test`, `npm run lint` | nichts persistent |
| **Entwicklung** | `npm run dev` (Electron + DevTools), Jest-Watch | `preferences.test.json` separat |

### 7.1 Pfad-Konventionen

| Zweck | Windows | Linux/macOS |
|---|---|---|
| Preferences | `%APPDATA%\copilot-desktop\preferences.json` | `~/.config/copilot-desktop/preferences.json` |
| Logs | `~/.copilot-desktop/logs/` | `~/.copilot-desktop/logs/` |
| Folders-Config | `~/.copilot-desktop/folders.json` | `~/.copilot-desktop/folders.json` |
| Copilot Sessions | `%USERPROFILE%\.copilot\session-state\` | `~/.copilot/session-state/` |

### 7.2 Persistenz im Detail

| Daten | Speicherort | Verantwortlich |
|---|---|---|
| Preferences (Theme, Tabs, Settings, Cost-Log) | `userData/preferences.json` (+ `.bak`) | `src/preferences.js` |
| Folders-Config, Onboarding, Tutorial-Flags | `~/.copilot-desktop/folders.json` | `src/scanners.js`, `main.js` |
| Sessions | `~/.copilot/session-state/<uuid>/` | CLI (Read-only) |
| Todos | `~/.copilot/session-state/<uuid>/todos.json` | `src/sessions.js` |
| Logs | `~/.copilot-desktop/logs/copilot-desktop-<YYYY-MM-DD>.log` | `src/logger.js` |
| Cost-Log | `userData/preferences.json` (Key: `costLog`) | `renderer/app.js` |

---

## 8. Querschnittliche Konzepte

### 8.1 Sicherheit

| Einstellung | Wert | Bedeutung |
|---|---|---|
| `contextIsolation` | `true` | Renderer hat keinen direkten Node.js-Zugriff |
| `nodeIntegration` | `false` | Sicherste Electron-Konfiguration |

- **DOMPurify** sanitisiert jeden gerenderten CLI-Output vor DOM-Injection.
- **`safeSessionPath()`** schützt gegen Path-Traversal bei Session-IDs.
- Alle IPC-Calls gehen ausschließlich über `contextBridge.exposeInMainWorld`.

### 8.2 Tool-Permissions

- **Globale Deny-List** (`settings.deniedTools`): gilt für alle Sessions
- **Admin Deny-List** (`settings.adminDeniedTools`): nicht vom User änderbar
- **Session Deny-List** (`tab.sessionDeniedTools`): per Session; Änderungen triggern Prozess-Neustart
- Alle Listen werden beim Spawn zu `--deny-tool=<name>`-Flags zusammengeführt

### 8.3 Kosten-Tracking

Die App berechnet geschätzte AI Credits aus dem Token-Verbrauch:

```javascript
credits = (input * priceInput + cache * priceCache + output * priceOutput) / 1_000_000
```

**Modellpreise (Credits pro 1M Tokens):**

| Modell | Input | Cache | Output |
|---|---|---|---|
| claude-sonnet-4.6 | 300C | 30C | 1500C |
| claude-opus-4.6 / 4.8 | 500C | 50C | 2500C |

Token-Daten kommen aus `/usage` (via `silentCommand`). Pro Prompt wird das Delta gespeichert (`recordCostEntry`). Die Kosten-Historie ist im Settings-Tab „Kosten" als gestapeltes Balkendiagramm visualisiert (Tag/Woche, aufgeschlüsselt nach Session).

### 8.4 Logging & Diagnose

- `src/logger.js` schreibt nach `~/.copilot-desktop/logs/` (tägliche Rotation, 7 Tage).
- `console.log/warn/error` im Main-Prozess sind monkey-gepatched: Logs gehen zusätzlich in Datei und DevConsole-Panel.

### 8.5 Theme-System

Drei Themes über CSS Custom Properties (`:root`, `[data-theme="dark"]`, `[data-theme="gebit"]`).

### 8.6 Per-Tab State

```javascript
{
  id: "tab-uuid",
  sessionId: "copilot-session-uuid",
  selectedModel: "claude-sonnet-4.6",
  mode: "agent",
  sessionDeniedTools: [{ name: "shell(git push)", enabled: true }],
  _lastUsageTokens: { input: 17500, output: 13, cache: 0 },
  _lastCreditTotal: 5.2,
  _sessionName: "Mein Projekt",
  inputText: "",
  inputRichHtml: "",
}
```

---

## 9. Architekturentscheidungen (ADR-Light)

| # | Entscheidung | Alternative | Konsequenz |
|---|---|---|---|
| 1 | Electron statt Tauri/Wails | Tauri | Schnellere Entwicklung, JS überall, größeres Binary |
| 2 | **ACP statt JSONL-Spawn + PTY** | Weiter `--output-format json --stream on` + PTY | Ein langlebiger Prozess/Tab, Slash-Commands via `silentCommand()`, kein PTY/node-pty, Session-Persistenz durch `session/load` |
| 3 | **`silentCommand()` statt PTY für Slash-Commands** | PTY mit Bracketed-Paste | Deterministisch, testbar, kein fragiles String-Matching auf TUI-Output |
| 4 | **Prozess-Neustart für `--deny-tool`-Änderungen** | Runtime-API (existiert nicht in ACP) | Sauber, aber kurze Unterbrechung; Session wird via `session/load` wiederhergestellt |
| 5 | Preferences in `app.getPath('userData')` | `__dirname` (war Bug) | Funktioniert in gepackten Builds; einmalige Migration war nötig |
| 6 | PATH-Augmentation für Linux/macOS | User muss `.bashrc` anpassen | Pragmatisch, deckt 95% der Fälle ab |
| 7 | Markdown-Init im Preload | Im Renderer | `marked`/`hljs`/`DOMPurify` einmal geladen |
| 8 | Cost-Log in `preferences.json` (Key `costLog`) | Eigene Datei | Kein zusätzliches File-I/O; bereits vorhandene Persistenz-Infrastruktur genutzt |
| 9 | Tutorial-Flags in `folders.json` | `preferences.json` | `folders.json` existiert bereits; Flags sollen bei Preferences-Export *nicht* mitgehen |
| 10 | Onboarding-Wizard mit Tab-Locking | Separate Window | Single-Window-UX; Auto-Unlock nach 180 s als Safety-Net |

---

## 10. Risiken und technische Schulden

| # | Risiko / Schuld | Auswirkung | Mitigation |
|---|---|---|---|
| R-1 | **`renderer/app.js` ist ~2.5k Zeilen prozedural** | Schwer zu navigieren | Schrittweise Modularisierung in `renderer/modules/` begonnen |
| R-2 | **ACP ist eine inoffizielle API** | CLI-Update kann Protokoll ändern | `acp-client.js` kapselt alle ACP-Details; Änderungen lokalisiert |
| R-3 | **`/usage` gibt „AI Units" statt „AI Credits"** | Credit-Anzeige basiert auf Token-Berechnung, nicht auf offizieller Zahl | Tracking ob ACP künftig Credits liefert; Token-Berechnung als Fallback |
| R-4 | **Kein automatisierter E2E-Smoke-Test für Chat-Roundtrip** | Regressionen fallen erst manuell auf | Playwright-Stub in `e2e/` vorhanden |
| R-5 | **`--deny-tool`-Neustart sichtbar für User** | Kurze Unterbrechung beim Ändern der Session-Tools | Verbesserbar durch Loading-Indicator; akzeptabler Trade-off |
| R-6 | **Keine CI-Pipeline** | Tests müssen lokal laufen | TODO: GitHub-Actions-Workflow |

---

## 11. Glossar

| Begriff | Bedeutung |
|---|---|
| **Main Process** | Electron-Hauptprozess mit Node.js-Zugriff |
| **Renderer Process** | Chromium-basierter UI-Prozess ohne Node.js-Zugriff |
| **IPC** | Inter-Process Communication zwischen Main und Renderer |
| **Context Bridge** | Electron-Mechanismus zum sicheren Exponieren von APIs an den Renderer |
| **Copilot CLI** | Das `copilot`-Binary aus `gh extension install github/gh-copilot` |
| **ACP** | Agent Communication Protocol — JSON-RPC über NDJSON auf stdio (`copilot --acp`) |
| **NDJSON** | Newline-Delimited JSON: ein JSON-Objekt pro Zeile, streamingfreundlich |
| **AcpClient** | Klasse in `src/acp-client.js`, die einen `copilot --acp`-Prozess pro Tab verwaltet |
| **silentCommand** | AcpClient-Methode für Slash-Commands (`/context`, `/usage`, …), die nichts an die UI schickt |
| **session/load** | ACP-Methode zum Wiederherstellen einer Session nach Prozess-Neustart |
| **Skill** | YAML-/Markdown-Beschreibung in `~/.copilot/skills/` |
| **Sub-Agent** | Spezialisierter Agent in `~/.copilot/agents/` |
| **Cost-Log** | In `preferences.json` gespeicherte Liste von Credits-Delta-Einträgen pro Prompt |
| **userData** | Electron-App-spezifischer Schreibort: `app.getPath('userData')` |
| **buildEnv** | Helper in `src/main-helpers.js` für PATH-Augmentation auf Linux/macOS |

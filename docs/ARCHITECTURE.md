# Copilot Desktop — Architektur (arc42)

> **Version:** 0.20.5 · **Stand:** Juni 2026 · **Stack:** Electron 35, node-pty, marked, highlight.js, xterm.js, jest
>
> Diese Dokumentation folgt dem [arc42-Template](https://arc42.org/) (12 Kapitel) und ist **die** Architektur-Referenz für Copilot Desktop. Die frühere Aufteilung in `ARCHITECTURE.md` (technisch-detailliert) und `arc42.md` (strategisch) wurde in dieses Dokument zusammengeführt.

---

## 1. Einführung und Ziele

### 1.1 Aufgabenstellung

**Copilot Desktop** ist eine Electron-Desktop-App, die das CLI `copilot` (GitHub Copilot CLI) in eine polierte Chat-Oberfläche einbettet. Statt eines reinen Terminal-Chats bekommt der User:

- Markdown-Rendering mit Syntax-Highlighting
- Multi-Tab-Sessions, die parallel mit der CLI sprechen
- Persistente Sessions, Skills, Tools und Permissions
- Drag-&-Drop für Dateien und Bilder
- Integriertes Terminal (xterm.js + PTY) für Slash-Commands wie `/context`, `/compact`
- Themes (Light, Dark, GEBIT), Settings, Sub-Agent-Routing, Test-Runner

### 1.2 Qualitätsziele

| Priorität | Qualitätsziel | Begründung |
|---|---|---|
| 1 | **Zuverlässige CLI-Integration** | Die App ist nutzlos, wenn der Spawn der `copilot`-CLI bricht oder JSONL-Events verloren gehen. PATH-Fixes (v0.15.4), Folder-Trust (v0.15.5) und Preferences-Persistenz (v0.15.6) sind Konsequenzen daraus. |
| 2 | **Cross-Platform-Lauffähigkeit** | Primärziel Windows 11; Linux & macOS müssen aber funktionieren (interne Entwicklerumgebungen). |
| 3 | **UI-Responsiveness** | Streaming-Antworten ohne Frame-Drops auch bei langen Markdown-Outputs. |
| 4 | **Sicherheit** | Renderer ohne Node-Integration; alles via `contextBridge`. DOMPurify gegen XSS in CLI-Output. |
| 5 | **Testbarkeit** | Jede Logik, die nicht zwingend Electron oder PTY braucht, lebt in `src/` mit Unit-Tests (>500 Tests). |

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
- **Node-Module mit nativem Code:** `@homebridge/node-pty-prebuilt-multiarch` (PTY für das integrierte Terminal). Prebuilds vorhanden, Fallback `npx electron-rebuild`.
- **GitHub Copilot CLI** (`copilot`-Binary aus `gh extension install github/gh-copilot`) muss im PATH des Prozesses auffindbar sein.
- **Keine eigene Cloud-Komponente** — alle KI-Roundtrips laufen über den lokal installierten Copilot CLI.

### 2.2 Organisatorisch

- Lizenz: MIT
- Branch-Workflow: kein direkter Push auf `main`. Feature-/Fix-Branches mit Conventional Commits, `Co-authored-by: Copilot ...` Trailer.
- Versionierung: SemVer; vor jedem Commit Patch- oder Minor-Bump in `package.json`.

### 2.3 Konventionen

- **Sprachen:** Code & Tests in englischen Bezeichnern, Kommentare/UI/Doku überwiegend Deutsch.
- **Linter:** ESLint flat-config (`eslint.config.mjs`).
- **Tests:** Jest (Unit, >500 Tests) + Playwright (E2E unter `e2e/`).

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
      │ spawn        │ liest/         │ liest/schreibt
      │ (JSONL)      │ schreibt       │ (Theme, Tabs,
      ▼              ▼                ▼   Permissions)
 ┌──────────┐  ┌────────────┐  ┌───────────────────────┐
 │ copilot  │  │ ~/.copilot │  │ userData/             │
 │   CLI    │  │ /sessions, │  │   preferences.json    │
 │          │  │   skills,  │  │ ~/.copilot-desktop/   │
 │ (gh ext) │  │ instructns │  │   logs, folders.json  │
 └────┬─────┘  └────────────┘  └───────────────────────┘
      │
      ▼
 GitHub Copilot Cloud  (über CLI; nicht direkt aus der App)
```

### 3.2 Technischer Kontext

| Schnittstelle | Richtung | Beschreibung |
|---|---|---|
| **Copilot CLI (`spawn`)** | App → CLI | Argument-Liste; `stdin` ungenutzt, `stdout` JSONL-Stream, `stderr` für Fehler |
| **Copilot CLI (PTY)** | App ↔ CLI | xterm.js + node-pty für interaktive Slash-Commands (`/context`, `/compact`, …) |
| **Filesystem** | App ↔ Disk | Sessions (`~/.copilot/session-state/`), Skills (`~/.copilot/skills/`), Logs (`~/.copilot-desktop/logs/`), Preferences (`app.getPath('userData')/preferences.json`), Folders-Config |
| **Shell** | App → Shell | Test-Runner spawnt `npm test`, `npm run test:coverage`, Playwright |
| **OS Window-Manager** | App ↔ OS | Native Frame deaktiviert; Custom Titlebar mit min/max/close via IPC |

---

## 4. Lösungsstrategie

| Entscheidung | Warum |
|---|---|
| **Electron** statt Web-App | Nativer Filesystem-, PTY- und CLI-Zugriff — undenkbar im Browser |
| **Renderer ohne Node-Integration** | XSS in CLI-Output darf nie zum RCE werden. Alles über `contextBridge` in `preload.js`. |
| **Zwei parallele CLI-Pfade** | (a) `spawnCopilot` mit `--output-format json --stream on` für Chat-Antworten (deterministisch, parsbar). (b) PTY-Spawn der vollen TUI für Slash-Commands, weil die CLI dort nur als interaktives TUI antwortet |
| **`src/` für reine Logik, `src/ipc/` für IPC-Handler** | Trennung Domänenlogik vs. Electron-Bindings → testbar ohne Electron-Mock-Hölle |
| **JSONL als Wire-Format** | Streaming-fähig, zeilenweise parsbar, robust gegen Teil-Reads |
| **Markdown-Rendering im Preload** | Marked + Highlight.js + DOMPurify einmal initialisiert, im Renderer als reine Funktion `window.markdown.render` |
| **`buildEnv()` für Child-Prozesse** | Electron sourct unter Linux/macOS keine Shell-RC → `~/.local/bin` etc. fehlen → `copilot`-Binary nicht auffindbar. Wird zentral gefixt. |
| **`detectCopilotPrompt()` als reine Funktion** | Trust- und Resume-Conflict-Prompts der CLI sind testbar als Pure-Function ohne PTY-Mocks |

---

## 5. Bausteinsicht

### 5.1 Whitebox Gesamtsystem (Level 1)

```
┌────────────────────────────── Renderer Process ──────────────────────────────┐
│                                                                              │
│  renderer/index.html  ─►  renderer/app.js  (2.4k LoC, Chat-, Tab-,           │
│                                              Settings-, Theme-Logik)         │
│                                                                              │
│           ┌──────────────────── renderer/modules/ ──────────────────┐        │
│           │ terminal.js  images.js  todos.js  test-runner.js        │        │
│           │ session-tools.js  dev-console.js  utils.js              │        │
│           └─────────────────────────────────────────────────────────┘        │
│                              │                                               │
│                              ▼ window.copilot.* / window.markdown.render     │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │  contextBridge (preload.js, sandboxed)
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                                Main Process                                  │
│                                                                              │
│  main.js (~650 LoC, Bootstrap + Window + spawnCopilot + IPC-Glue)            │
│     │                                                                        │
│     ├── src/ipc/terminal-ipc.js       — PTY/Terminal IPC (~250 LoC)          │
│     ├── src/ipc/images-ipc.js         — Bilder/Videos IPC                    │
│     ├── src/ipc/tests-ipc.js          — Test-Runner IPC                      │
│     │                                                                        │
│     ├── src/main-helpers.js           — buildEnv, detectCopilotPrompt,       │
│     │                                   isCopilotTuiReady, sendToRenderer,   │
│     │                                   waitForReady, collectPtyOutput       │
│     ├── src/preferences.js            — read/write/migrate Preferences       │
│     ├── src/sessions.js               — Checkpoints, Plan, Todos             │
│     ├── src/named-sessions.js         — User-Bezeichner für Session-IDs      │
│     ├── src/scanners.js               — Skills, Folder-Config                │
│     ├── src/agents.js                 — Sub-Agent-Verzeichnis                │
│     ├── src/file-processing.js        — Drag&Drop-Pipeline                   │
│     ├── src/logger.js                 — File-Logger ~/.copilot-desktop/logs  │
│     └── src/utils.js                  — stripAnsi, safeSessionPath, …        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Prozess-Trennung

| Prozess | Verantwortung |
|---|---|
| **Main Process** | Window-Erstellung, CLI-Spawning, File-I/O, PTY-Management, alle IPC-Handler |
| **Renderer Process** | UI-Rendering, Chat-Logik, Tab-State, Theme-Verwaltung, Terminal-Frontend |
| **preload.js** | Sichere Brücke zwischen Main und Renderer via `contextBridge` |

### 5.3 Dateistruktur

| Datei / Ordner | Größe | Beschreibung |
|---|---|---|
| `main.js` | ~650 LoC | **Electron Main Process** — Window-Erstellung, Copilot CLI Spawning, Session/Todo/Image/Skill-Management, IPC-Glue |
| `preload.js` | 170 LoC | **Context Bridge** — exponiert `window.copilot` (mehrere Namespaces) und `window.markdown` |
| `renderer/index.html` | 428 LoC | **App-Shell** — Custom Titlebar, Sidebar, Chat-Area, Terminal-Panel, Settings/Delete-Overlays, Lightbox |
| `renderer/app.js` | ~2.4k LoC | **Frontend-Logik** — Chat-UI, Tab-Management, Settings, Search, Themes |
| `renderer/styles.css` | ~41 KB | **Alle Styles** — CSS-Variablen, 3 Themes (Light/Dark/GEBIT), 30+ Komponentensektionen |
| `renderer/modules/*.js` | siehe 5.4 | **UI-Module** — Terminal, Bilder, Todos, Test-Runner, Session-Tools, Dev-Console |
| `src/*.js` | siehe 5.5 | **Reine Logik-Module** — testbar ohne Electron |
| `src/ipc/*.js` | 3 Dateien | **IPC-Handler-Module** — Terminal, Bilder, Tests |
| `__tests__/` | 24 Suiten | **Jest Unit-Tests** (>790 Tests) |
| `e2e/` | — | **Playwright E2E-Tests** |
| `assets/` | — | Logo-SVGs |
| `setup.ps1`, `setup.bat` | — | Automatisierte Setup-Scripts (Windows) |

### 5.4 Wichtige Bausteine (Level 2)

#### main.js (Application Bootstrap & IPC-Glue)
- Erzeugt `BrowserWindow` (frameless, contextIsolation, preload).
- Initialisiert Logger (`initLogger`) und überschreibt `console.log/warn/error`, sodass Logs auch in Datei und an die DevConsole im UI gehen.
- Lädt `pty` lazy mit Fallback (`@homebridge/node-pty-prebuilt-multiarch` → `node-pty`).
- Hält Globals: `copilotProcesses` (Map tabId→ChildProcess), `terminalProcesses`, `terminalBuffers`, `terminalReady`, `terminalBusy`, `mainWindow`, `nextTabId`.
- `spawnCopilot(tabId, prompt, options)` — Kern-Funktion: baut Argliste (`-p`, `--output-format json --stream on`, optional `--resume`, `--model`, `--reasoning-effort`, `--allow-all-tools`, `--deny-tool=…`), spawnt `copilot` mit `buildEnv({ NO_COLOR: '1' })`, parst JSONL-Stream zeilenweise, schickt `copilot:event` / `copilot:done` an Renderer.
- Registriert ~30 IPC-Handler (siehe Kapitel 6) und delegiert PTY-/Terminal-/Image-/Test-IPC an `src/ipc/*`.

#### preload.js (Context Bridge)
- Initialisiert `marked` + `highlight.js` + `DOMPurify` einmal, exposet `window.markdown.render(text)`.
- Exposet `window.copilot.*` mit Namespaces `chat`, `sessions`, `folders`, `preferences`, `instructions`, `skills`, `agents`, `terminal`, `images`, `videos`, `files`, `tests`, `window`, `log`, `tutorial`.
- Streaming-Events (`copilot:event`, `copilot:done`, `terminal:data`, `images:changed`, `dev-console:log`) werden über `onX(cb) → unsubscribe` gewrappt, damit der Renderer Listener sauber aufräumen kann.

#### src/main-helpers.js
- **`buildEnv(extraEnv)`** — fügt unter Linux/macOS Standard-User-Pfade (`~/.local/bin`, `~/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`) am Anfang von `PATH` ein. Auf Windows passthrough.
- **`detectCopilotPrompt(buffer, alreadyHandled)`** — pure: erkennt Folder-Trust-Prompt (`'2\r'`) und Resume-Conflict (`'1\r'`).
- **`isCopilotTuiReady(buffer)`** — pure: prüft auf `'/ commands'` oder `'? help'`.
- **`waitForReady(readyMap, tabId, opts)`** — Promise-Wrapper, der periodisch das `terminalReady`-Map abfragt.
- **`collectPtyOutput(ptyProcess, opts)`** — sammelt Output bis Quiet-Period oder Timeout.
- **`cleanupPty(tabId, exitCode, extraDispose)`** — räumt alle Maps auf, schickt `terminal:exit`.

#### src/ipc/terminal-ipc.js
- Stellt `attachReadyDetection(...)` bereit, die Folder-Trust und Conflict-Prompts auto-bestätigt und Ready-Marker erkennt; Fallback nach `PTY_READY_TIMEOUT_MS`.
- Handler: `terminal:available`, `terminal:spawn-background` (unsichtbares PTY für Slash-Commands), `terminal:spawn` (sichtbares Terminal mit xterm.js-Mirror), `terminal:input/resize/get-buffer/send-command/fetch-context/send-slash/close`.

#### src/preferences.js
- `createPreferencesManager(prefsPath)` mit `read()`, `write(prefs)`, `migrateFromIfExists(oldPath)`.
- Schreibt atomar mit `.bak`-Backup; `read()` versucht bei korruptem JSON automatisch das `.bak` wiederherzustellen.
- `ensureDir()` legt Zielverzeichnis rekursiv an (für `app.getPath('userData')`-Migration in v0.15.6).
- `write()` wirft jetzt aussagekräftigen Fehler statt stillem `false` — `main.js` loggt ihn.

#### src/shortcuts.js
- Reine Logik-Modul für das Tastenkürzel-System (eingeführt in v0.18.x).
- Exportiert `SHORTCUT_DEFS` (alle konfigurierbaren Shortcuts: newTab, closeTab, nextTab,
  prevTab, focusInput, search, exportChat, toggleSidebar, showShortcuts) und `FIXED_SHORTCUTS`
  (Tab 1–9, Escape).
- `resolveShortcut(prefs, id)` — liefert User-Override oder Default-Binding.
- `matchShortcut(event, binding)` — strenger Vergleich eines KeyboardEvents mit einer Bindung;
  Modifier-Flags müssen exakt übereinstimmen.
- `shortcutLabel(binding)` — rendert eine Bindung als `Ctrl+Shift+Tab`-String (Space wird zu „Space").
- `renderer/app.js` hält eine 1:1-Spiegelung dieser Konstanten/Funktionen für den DOM-Layer; ein
  Integritätstest stellt sicher, dass die IDs übereinstimmen.

#### renderer/app.js
- Ein langer prozeduraler Layer (~2.4k Zeilen), zerlegt in Sektionen für Chat, Tabs, Settings, Theme, Search, Skills, Agents, Folders, Instructions.
- Empfängt `copilot:event` (assistant-text-delta, tool-use, tool-result, …) und rendert sie inkrementell mit `window.markdown.render`.
- Verwaltet Tabs als Array; Persistenz über `preferences.openTabs`.
- **Rich-Text-Editor:** Globales Flag `richTextMode` steuert, ob Eingabe über `<textarea>` oder `contenteditable`-div erfolgt. `convertHtmlToMarkdown()` wandelt `execCommand`-formatiertes HTML vor dem Senden in Markdown um. Der Modus wird pro Tab gespeichert (`inputRichMode`) und bei Tab-Wechsel mit der globalen Variable synchronisiert.
- **Modell-Persistenz:** `getSessionModel(sessionId)` / `saveSessionModel(sessionId, modelId)` nutzen den dedizierten Pref-Key `sessionModels` (flache Map `{sessionId → modelId}`) — unabhängig von `namedSessions`, damit die Auswahl auch für unbenannte Sessions erhalten bleibt.

### 5.5 Renderer-Module

| Modul | LoC | Aufgabe |
|---|---|---|
| `terminal.js` | 240 | xterm.js-Init, FitAddon, Mirror der `terminal:data`-Streams |
| `images.js` | 148 | Bild-Thumbnails, Lightbox, Drag&Drop in den Chat |
| `todos.js` | 149 | Per-Session-Aufgabenliste mit IPC-Backend (CRUD + Drag&Drop-Reordering) |
| `session-tools.js` | 129 | UI für Checkpoints / Plan / Named-Sessions |
| `test-runner.js` | 129 | Frontend für Jest/Playwright/Coverage |
| `dev-console.js` | 56 | UI-Pendant zur Browser-DevConsole |
| `utils.js` | 62 | DOM-Hilfen |

### 5.6 First-Run Onboarding Wizard (v0.18.2)

Ein mehrstufiger Wizard, der beim allerersten App-Start den User durch Authentifizierung, Ordner-Konfiguration und Feature-Einführung leitet.

| Schritt | Beschreibung |
|---|---|
| 1. Auth | Prüfung/Anleitung für `gh auth login` |
| 2. Folder Setup | Auswahl des Arbeitsverzeichnisses (via `folders:setup`) |
| 3. Category Selection | Skill-Kategorien zur Vorinstallation auswählen |
| 4. Feature Intro | Überblick über App-Features |

**Architektur-Details:**
- Steuerung über IPC-Handler: `onboarding:getStatus`, `onboarding:setComplete`, `folders:setup`, `onboarding:getCategories`, `onboarding:installCategory`
- Onboarding-Status wird in `~/.copilot-desktop/folders.json` persistiert
- Während des Onboardings sind Tabs gesperrt (Tab-Locking); ein Auto-Unlock greift nach 180 s Inaktivität als Safety-Net
- Reset via `dev:setOnboardingComplete(false)` — löscht auch `tutorialSkillsShown` und `tutorialRenameShown`

### 5.7 Tutorial-Flags System (v0.20.5)

Ein leichtgewichtiges System für kontextsensitive Tutorial-Popups, die einmalig bei relevanten User-Aktionen eingeblendet werden.

**Speicherort:** `~/.copilot-desktop/folders.json` (als zusätzliche Keys neben der Ordner-Konfiguration — bewusst *nicht* in `preferences.json`, da die Flags ordnerunabhängig und nicht exportierbar sein sollen).

**Registrierte Tutorial-Flags (Key-Whitelist):**
- `tutorialSkillsShown` — wurde die Skills-Einführung angezeigt?
- `tutorialRenameShown` — wurde das Tab-Umbenennen-Tutorial angezeigt?

**Architektur:**
- **IPC-Handler:** `tutorial:getFlags` (liest alle Flags), `tutorial:setFlag` (setzt einen Flag; validiert Key gegen Whitelist)
- **Preload-Bridge:** `window.copilot.tutorial.getFlags()` / `window.copilot.tutorial.setFlag(key, value)`
- **Renderer:** `showTutorialPopup()` (Skills) und `showTutorialRenamePopup()` (Rename) sind async-Funktionen, die erst den Flag via IPC prüfen
- **Auto-Close:** Beide Popups schließen automatisch bei Nutzeraktion ODER nach 30 s Timeout; ein `closed`-Guard verhindert Doppel-Aufrufe des IPC-Setters
- **CustomEvent `tab:renamed`:** Wird in `commit()` von `startTabRename` gefeuert (`document.dispatchEvent(new CustomEvent('tab:renamed'))`); das Rename-Tutorial lauscht auf dieses Event als Trigger zum Schließen

---

## 6. Laufzeitsicht

### 6.1 Chat-Anfrage (Happy Path)

```
User              Renderer            Preload          Main              Copilot CLI
 │ tippt + Enter    │                    │                │                    │
 │─────────────────▶│                    │                │                    │
 │                  │ window.copilot     │ ipcRenderer    │                    │
 │                  │ .chat.send(...)    │ .invoke(       │                    │
 │                  │───────────────────▶│   'copilot:    │                    │
 │                  │                    │   send', ...)  │                    │
 │                  │                    │───────────────▶│ spawnCopilot()     │
 │                  │                    │                │ child_process.     │
 │                  │                    │                │ spawn('copilot')   │
 │                  │                    │                │───────────────────▶│
 │                  │                    │                │                    │
 │                  │                    │                │  ◄── JSONL chunks ─┤
 │                  │      ◄── 'copilot:event' (n×) ─────┤  parse line by line│
 │                  │ render delta       │                │                    │
 │                  │ (marked → DOM)     │                │                    │
 │                  │                    │                │                    │
 │                  │      ◄── 'copilot:done' (exit code)┤  proc.on('close')  │
```

**Detaillierter Ablauf:**

1. User tippt Nachricht in `<textarea>` (`renderer/app.js`)
2. `sendMessage()` sammelt: `text`, `activeSkills`, `model`, `sessionId`, `allowedTools`, `deniedTools`, `extraDirs`, `resume`-Flag, `autopilot`-Flag
3. IPC-Call `copilot:send` → `main.js`
4. `spawnCopilot(tabId, prompt, options)` spawnt `copilot` CLI-Prozess mit `--output-format json --stream on`
5. JSONL-Events (`text`, `tool_call`, `thinking`, `confirmation`, `model`, `mcp_servers`, `active_skills`, `active_instructions`, `session_id`, `cwd`) werden zeilenweise geparst
6. Jedes Event → `event.sender.send('copilot:event', {tabId, ...data})` → Renderer
7. Renderer rendert in die Stream-Area
8. Bei `copilot:done` → Tab-Status wird zurückgesetzt

### 6.2 Slash-Command (`/context`) — kritischster Pfad

```
Renderer ─► terminal:fetch-context (IPC)
         │
         │   (PTY existiert pro tabId; wurde lazy bei erstem Spawn erzeugt)
         ▼
Main: terminal:spawn-background       (falls noch nicht da)
         │
         ▼
attachReadyDetection läuft mit:
   • erkennt 'Confirm folder trust' → schickt '2\r'   ────┐
   • erkennt 'already be in use'    → schickt '1\r'   ────┤  Auto-Confirm
   • Fallback nach 20 s = ready                       ────┘
         │
         ▼  Ready-Marker '/ commands' / '? help' im Buffer
terminalReady.set(tabId, true)
         │
         ▼
Main schickt '\x1b[200~/context\x1b[201~\r' ans PTY  (bracketed paste)
         │
         ▼
collectPtyOutput sammelt bis PTY_QUIET_MS Stille  ──► Renderer (Popup)
```

**Wichtig:** Bracketed Paste Mode (`\x1b[200~ … \x1b[201~`) ist erforderlich, sonst interpretiert das TUI die Slash-Commands als zeichenweises Tippen.

### 6.3 App-Start (mit Migration)

```
1. main.js geladen
2. initLogger()                       (Datei-Logger startet, alte Logs rotieren)
3. console.log/warn/error gehookt    (→ Datei + DevConsole)
4. PTY lazy require                  (Fallback-Kette)
5. folderConfig = readFolderConfig() (~/.copilot-desktop/folders.json)
6. _prefsManager = createPreferencesManager(app.getPath('userData')/preferences.json)
7. migrateFromIfExists(legacy)        (einmalig bei Upgrade von <0.15.6)
8. app.whenReady() → BrowserWindow
9. IPC-Handler werden registriert
10. Renderer lädt index.html → app.js
11. Renderer ruft preferences:read → bekommt persistenten State
12. Tabs werden aus openTabs wiederhergestellt
13. Onboarding-Status prüfen → ggf. Wizard anzeigen (v0.18.2)
14. Nach Onboarding: Tutorial-Flags prüfen → ggf. Skills-Tutorial-Popup (v0.20.5)
```

### 6.3.1 Tutorial-Popup Eventflow (v0.20.5)

```
Renderer                          Main (IPC)               folders.json
   │                                │                          │
   │ showTutorialPopup()            │                          │
   │─── tutorial:getFlags ─────────▶│── read ────────────────▶│
   │◄── { tutorialSkillsShown: … } ─┤                          │
   │                                │                          │
   │  [Flag == false → Popup zeigen]│                          │
   │                                │                          │
   │  (User klickt ODER 30s Timer)  │                          │
   │─── tutorial:setFlag ──────────▶│── write ───────────────▶│
   │    ('tutorialSkillsShown',true) │                          │
   │                                │                          │
   │  [closed-Guard verhindert      │                          │
   │   doppelten setFlag-Call]       │                          │
```

**CustomEvent `tab:renamed`:**
- Quelle: `commit()` in `startTabRename` (renderer/app.js)
- Event: `document.dispatchEvent(new CustomEvent('tab:renamed'))`
- Listener: `showTutorialRenamePopup()` registriert einen `once`-Listener auf `tab:renamed`; bei Empfang wird das Popup geschlossen und der Flag gesetzt

### 6.4 IPC-Kommunikation

Die Kommunikation zwischen Main und Renderer Process erfolgt über IPC-Channels, organisiert in Namespaces. Alle Channels sind über `contextBridge.exposeInMainWorld` exponiert.

#### 6.4.1 Namespace: `copilot` (Chat)

| Channel | Typ | Beschreibung |
|---|---|---|
| `copilot:send` | handle | Sendet Chat-Nachricht an Copilot CLI |
| `copilot:newTab` | handle | Erstellt neuen Tab (spawnt Copilot-Prozess) |
| `copilot:getCwd` | handle | Aktuelles Arbeitsverzeichnis abfragen |
| `copilot:openCwd` | handle | CWD im Explorer öffnen |
| `copilot:getVersions` | handle | Versionen (App, CLI, Node, Electron) |
| `copilot:getInstructions` | handle | `copilot-instructions.md` lesen |
| `copilot:openLogDir` | handle | Log-Verzeichnis im Explorer öffnen |
| `copilot:stop` | on | Copilot-Prozess für Tab stoppen |

#### 6.4.2 Namespace: `sessions`

| Channel | Typ | Beschreibung |
|---|---|---|
| `sessions:create` | handle | Neue benannte Session erstellen |
| `sessions:delete` | handle | Session-Ordner löschen |
| `sessions:readCheckpoints` | handle | Checkpoint-Dateien einer Session lesen |
| `sessions:readPlan` | handle | `plan.md` einer Session lesen |

#### 6.4.3 Namespace: `todos`

| Channel | Typ | Beschreibung |
|---|---|---|
| `todos:list` | handle | Todos einer Session laden |
| `todos:add` | handle | Todo hinzufügen |
| `todos:update` | handle | Todo-Status ändern |
| `todos:delete` | handle | Todo löschen |
| `todos:reorder` | handle | Todo-Reihenfolge ändern (Drag & Drop) |

#### 6.4.4 Namespace: `images` / `videos`

| Channel | Typ | Beschreibung |
|---|---|---|
| `images:list` | handle | Bilder aus `images/`-Ordner auflisten |
| `images:open` | handle | Bild im System-Viewer öffnen |
| `images:delete` | handle | Bild löschen |
| `images:openFolder` | handle | `images/`-Ordner im Explorer öffnen |
| `videos:extractFrames` | handle | Frames aus Video extrahieren |

#### 6.4.5 Namespace: `terminal` (PTY)

| Channel | Typ | Beschreibung |
|---|---|---|
| `terminal:available` | handle | Prüft ob node-pty verfügbar ist |
| `terminal:spawn` | handle | Interaktives (sichtbares) Terminal spawnen |
| `terminal:spawn-background` | handle | Hintergrund-PTY für Tab spawnen |
| `terminal:get-buffer` | handle | Terminal-Buffer auslesen |
| `terminal:send-command` | handle | Befehl an PTY senden |
| `terminal:fetch-context` | handle | `/context` ausführen und parsen |
| `terminal:send-slash` | handle | Generischen Slash-Command senden |
| `terminal:input` | on | Terminal-Eingabe weiterleiten |
| `terminal:resize` | on | Terminal-Größe anpassen |
| `terminal:close` | on | Terminal schließen |

#### 6.4.6 Namespace: `preferences` / `instructions` / `folders` / `skills` / `agents` / `files` / `tests` / `window` / `log`

| Channel | Typ | Beschreibung |
|---|---|---|
| `preferences:read` | handle | Preferences aus `userData/` lesen |
| `preferences:write` | handle | Preferences nach `userData/` schreiben |
| `instructions:read` | handle | `copilot-instructions.md` aus CWD lesen |
| `instructions:write` | handle | `copilot-instructions.md` schreiben |
| `folders:read` | handle | `folders.json` lesen |
| `folders:save` | handle | `folders.json` schreiben |
| `folders:browse` | handle | Verzeichnis-Auswahl-Dialog |
| `folders:browse-file` | handle | Datei-Auswahl-Dialog |
| `skills:list` | handle | Skills aus `~/.copilot/skills/` scannen |
| `skills:listProject` | handle | Projekt-Skills aus `<cwd>/.github/skills/` scannen |
| `skills:getDisabled` | handle | Liest `disabledSkills` aus `~/.copilot/settings.json` |
| `skills:setDisabled` | handle | Schreibt `disabledSkills` in `~/.copilot/settings.json` |
| `agents:list` | handle | Sub-Agents aus `~/.copilot/agents/` scannen |
| `agents:listProject` | handle | Projekt-Agents aus `<cwd>/.github/agents/` scannen |
| `mcp:listProject` | handle | Projekt-MCP-Server aus `<cwd>/.github/mcp.json` lesen |
| `files:processDropped` | handle | Drag&Drop-Dateien verarbeiten |
| `tests:run` | handle | Jest-Suite spawnen |
| `tests:coverage` | handle | Coverage-Run spawnen |
| `tests:e2e` | handle | Playwright-Suite spawnen |
| `window:minimize` | on | Fenster minimieren |
| `window:maximize` | on | Fenster maximieren/wiederherstellen |
| `window:close` | on | Fenster schließen |
| `log:write` | on | Log-Eintrag aus Renderer in Datei-Logger |

#### 6.4.7 Namespace: `onboarding` (First-Run Wizard, v0.18.2)

| Channel | Typ | Beschreibung |
|---|---|---|
| `onboarding:getStatus` | handle | Prüft ob Onboarding abgeschlossen ist |
| `onboarding:setComplete` | handle | Markiert Onboarding als abgeschlossen |
| `onboarding:getCategories` | handle | Verfügbare Skill-Kategorien für Vorinstallation |
| `onboarding:installCategory` | handle | Installiert eine Skill-Kategorie |
| `folders:setup` | handle | Initialer Ordner-Setup (Teil des Onboarding-Flows) |

#### 6.4.8 Namespace: `tutorial` (Tutorial-Flags, v0.20.5)

| Channel | Typ | Beschreibung |
|---|---|---|
| `tutorial:getFlags` | handle | Alle Tutorial-Flags aus `folders.json` lesen |
| `tutorial:setFlag` | handle | Einzelnen Tutorial-Flag setzen (Key-Whitelist: `tutorialSkillsShown`, `tutorialRenameShown`) |

#### 6.4.9 Namespace: `dev` (Entwickler-Helfer)

| Channel | Typ | Beschreibung |
|---|---|---|
| `dev:setOnboardingComplete` | handle | Onboarding-Status setzen/zurücksetzen (Reset löscht auch Tutorial-Flags) |

---

## 7. Verteilungssicht

| Umgebung | Komponenten | Persistenz |
|---|---|---|
| **End-User-Desktop** (Win 11, Linux, macOS) | Electron-App (gepackt oder via `npm start`), `copilot`-CLI (extern installiert), `gh`-CLI | `app.getPath('userData')` (Theme, Tabs, Permissions); `~/.copilot-desktop/` (Logs, Folders); `~/.copilot/` (Sessions, Skills, Instructions — verwaltet von der CLI selbst, von uns nur gelesen/geschrieben) |
| **CI** (GitHub Actions, optional) | `node`, `npm test`, `npm run lint` | nichts persistent |
| **Entwicklung** | `npm run dev` (Electron + DevTools), Jest-Watch | `preferences.test.json` separat, damit echte Prefs nicht verschmutzt werden |

### 7.1 Pfad-Konventionen

| Zweck | Linux | Windows | macOS |
|---|---|---|---|
| Preferences | `~/.config/copilot-desktop/preferences.json` | `%APPDATA%\copilot-desktop\preferences.json` | `~/Library/Application Support/copilot-desktop/preferences.json` |
| Logs | `~/.copilot-desktop/logs/` | `~/.copilot-desktop/logs/` | `~/.copilot-desktop/logs/` |
| Folders-Config | `~/.copilot-desktop/folders.json` | `~/.copilot-desktop/folders.json` | `~/.copilot-desktop/folders.json` |
| Copilot Sessions | `~/.copilot/session-state/` | `%USERPROFILE%\.copilot\session-state\` | `~/.copilot/session-state/` |

### 7.2 Persistenz im Detail

| Daten | Speicherort | Format | Verantwortlich |
|---|---|---|---|
| Sessions | `~/.copilot/session-state/<uuid>/` | von Copilot CLI verwaltet | CLI (Read-only-Zugriff) |
| Checkpoints | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown | nur Read |
| Plan | `~/.copilot/session-state/<uuid>/plan.md` | Markdown | nur Read |
| Todos | `~/.copilot/session-state/<uuid>/todos.json` | JSON: `[{id, text, status, createdAt}]` | `src/sessions.js` |
| Preferences | `userData/preferences.json` (+ `.bak`) | JSON | `src/preferences.js` |
| Folders-Config | `~/.copilot-desktop/folders.json` | JSON | `src/scanners.js` |
| Tutorial-Flags | `~/.copilot-desktop/folders.json` (Keys: `tutorialSkillsShown`, `tutorialRenameShown`) | JSON (boolean-Werte) | `main.js` (IPC `tutorial:*`) |
| Onboarding-Status | `~/.copilot-desktop/folders.json` (Key: `onboardingComplete`) | JSON (boolean) | `main.js` (IPC `onboarding:*`) |
| Logs | `~/.copilot-desktop/logs/copilot-desktop-<YYYY-MM-DD>.log` | Plaintext, tagesrotiert | `src/logger.js` |
| Skills | `~/.copilot/skills/<name>/SKILL.md` | YAML-Frontmatter + Markdown | nur Read |
| Sub-Agents | `~/.copilot/agents/` | Markdown | nur Read |
| Bilder | `<cwd>/images/` (über `folders.json` konfigurierbar) | PNG/JPG + `fs.watch` | `src/ipc/images-ipc.js` |

---

## 8. Querschnittliche Konzepte

### 8.1 Sicherheit

#### Electron-Konfiguration

| Einstellung | Wert | Bedeutung |
|---|---|---|
| `contextIsolation` | `true` | Renderer hat keinen direkten Zugriff auf Node.js APIs |
| `nodeIntegration` | `false` | Sicherste Electron-Konfiguration — kein `require()` im Renderer |
| `sandbox` | implizit (preload nur via `contextBridge`) | Renderer ist sandboxed |

#### IPC-Sicherheit

- Alle IPC-Kommunikation erfolgt ausschließlich über `contextBridge.exposeInMainWorld`.
- Der Renderer hat nur Zugriff auf explizit exponierte APIs (`window.copilot`, `window.markdown`).
- Kein direkter Zugriff auf `ipcRenderer` oder Node.js-Module im Renderer.
- **DOMPurify** sanitisiert jeden gerenderten CLI-Output, bevor er ins DOM geht — wichtig, weil das Modell beliebige Strings produziert.
- **`safeSessionPath()`** wirft, wenn ein Session-ID-Pfad das `SESSIONS_DIR` verlässt (Path-Traversal-Schutz).

#### Tool-Permissions

- **Allowed Tools** — Liste erlaubter CLI-Tools (konfigurierbar)
- **Denied Tools** — Liste verbotener CLI-Tools (`--deny-tool=…` an die CLI)
- **Shell Exceptions** — Befehle, die ohne Bestätigung ausgeführt werden dürfen
- Die Copilot CLI sendet `confirmation`-Events; die App reagiert je nach Konfiguration mit Auto-Approve, manueller Bestätigung oder Ablehnung.

### 8.2 Logging & Diagnose

- `src/logger.js` schreibt nach `~/.copilot-desktop/logs/copilot-desktop-<YYYY-MM-DD>.log` (tägliche Rotation, Auto-Cleanup nach 7 Tagen).
- `console.log/warn/error` im Main-Prozess sind monkey-gepatched: jeder Aufruf landet zusätzlich (a) im Log-File und (b) als `dev-console:log`-IPC-Event im Renderer (DevConsole-Panel).
- IPC-Handler `copilot:openLogDir` öffnet das Log-Verzeichnis im Datei-Explorer.

### 8.3 Internationalisierung

Aktuell: UI-Strings überwiegend Deutsch, Code/Tests Englisch. Keine i18n-Library — Änderungen erfolgen direkt im DOM/HTML.

### 8.4 Fehlerbehandlung

- IPC-Handler liefern `{ success: false, error }`-Tupel zurück; Exceptions werden zentral gefangen und geloggt.
- Spawn-Fehler im PTY → `terminal:exit`-Event mit Exit-Code an Renderer.
- Korrupte Preferences → Restore aus `.bak` → Defaults.
- Schreibfehler bei Preferences werfen jetzt eine `Error` mit `prefsPath`, statt stumm zu schlucken (v0.15.6).

### 8.5 Cross-Plattform-Strategie

- `process.platform === 'win32'` Verzweigungen sind explizit & getestet.
- `getShell()` wählt PowerShell/cmd auf Win, `$SHELL || /bin/bash` sonst.
- `buildEnv()` macht PATH-Augmentation nur außerhalb Windows.
- E2E-Tests laufen unter Linux (CI) ebenso wie unter Windows manuell.

### 8.6 Build & Packaging

Aktuell wird nicht regelmäßig gepackt — `npm start` ist der Primärfluss. Beim Packen (z.B. via `electron-builder`) ist zu beachten:
- Native PTY-Module müssen für die Zielplattform vorgebaut sein.
- `app.getPath('userData')` weicht von `__dirname` ab → Migration aus v0.15.6 deckt das ab.
- ASAR-Archiv ist read-only — alle Schreibzugriffe gehen zwingend an `userData` oder `~/.copilot-desktop`.

### 8.7 Theme-System

Drei Themes über CSS Custom Properties:

| Theme | Selektor | Beschreibung |
|---|---|---|
| Light | `:root` | Helles Standard-Theme |
| Dark | `[data-theme="dark"]` | Dunkles Theme |
| GEBIT | `[data-theme="gebit"]` | Corporate-Theme |

Alle Farben sind in `:root` definiert und werden in den jeweiligen `[data-theme]`-Selektoren überschrieben.

### 8.8 Wiederkehrende Patterns

#### Per-Tab State

Jedes Tab-Objekt im Renderer speichert:

```javascript
{
  id: "tab-uuid",
  label: "Session Name",
  sessionId: "copilot-session-uuid",
  status: "idle" | "streaming" | "waiting",
  chatHistory: [],
  contextPercent: 6,
  terminalReady: true,
  inputText: "",           // gespeicherter Plain-Text-Inhalt des Chat-Inputs
  inputRichHtml: "",       // gespeicherter Rich-Text-HTML des Chat-Inputs
  inputRichMode: false     // ob dieser Tab im Rich-Text-Modus war
}
```

Beim Tab-Wechsel wird der aktuelle Input-State (Text, Rich-HTML, Modus) im vorherigen Tab gespeichert und aus dem neuen Tab wiederhergestellt. Nach `sendMessage()` werden `inputText` und `inputRichHtml` geleert.

#### Skill Injection

Aktive Skills werden gesammelt und als Prompt-Prefix serialisiert:

```
Verwende folgende Skills für diese Aufgabe:
- **skill-name**: description
```

Skills werden aus `~/.copilot/skills/` gescannt. Jeder Skill besteht aus einer `SKILL.md`-Datei mit YAML-Frontmatter (Name, Beschreibung) und Markdown-Body (Instruktionen).

#### Context Parser (`parseContextOutput`)

Parst die TUI-Ausgabe des `/context`-Befehls in strukturierte Daten:

```javascript
// Header-Regex
/([A-Za-z\s.]+\d[\w.]*)\s*[·]\s*([\d.]+k)\/([\d.]+k)\s*tokens?\s*\((\d+)%\)/

// Kategorie-Regex
/(System\/Tools|Messages|Free Space|Buffer):\s*([\d.]+k)\s*\((\d+)%\)/gi
```

**Rückgabewert:**
```javascript
{
  model: "claude-sonnet-4-20250514",
  used: "12.5k",
  total: "200k",
  percent: 6,
  categories: [
    { name: "System/Tools", tokens: "8.2k", percent: 4 },
    { name: "Messages", tokens: "4.3k", percent: 2 },
  ]
}
```

---

## 9. Architekturentscheidungen (ADR-Light)

| # | Entscheidung | Alternative | Konsequenz |
|---|---|---|---|
| 1 | Electron statt Tauri/Wails | Tauri (kleiner, Rust-Backend) | Schnellere Entwicklung, JS überall, größeres Binary |
| 2 | JSONL als CLI-Wire-Format (`--output-format json --stream on`) | Plaintext parsen | Robustes Streaming, klare Event-Typen, abhängig von CLI-Vertrag |
| 3 | Zwei CLI-Pfade (Spawn + PTY) | Nur PTY (alles per TUI parsen) | Saubere Trennung Chat ↔ Slash-Commands; mehr Code, aber je Pfad einfach |
| 4 | Preferences in `app.getPath('userData')` (v0.15.6) | weiter `__dirname` (war Bug) | Funktioniert in gepackten Builds; einmalige Migration nötig |
| 5 | Folder-Trust auto-confirm mit `'2\r'` (v0.15.5) | User bittet manuell zu bestätigen | Slash-Commands funktionieren ohne Extra-UX; minimaler Verlust an User-Awareness, dafür kein Stuck-State |
| 6 | PATH-Augmentation für Linux/macOS (v0.15.4) | User muss `.bashrc` so anpassen, dass Electron es sourct (geht nicht) | Pragmatisch, deckt 95% der Fälle ab; injection vorhersagbar |
| 7 | Markdown-Init im Preload, nicht im Renderer | Rendering im Renderer | `marked`/`hljs`/`DOMPurify` einmal geladen, kein Bundling im Renderer nötig |
| 8 | Logger-Hook auf `console.*` | strukturiertes Logger-Objekt überall durchreichen | Existierende `console.log`-Aufrufe „just work“; etwas magisch, aber praktisch |
| 9 | Tutorial-Flags in `folders.json` statt `preferences.json` (v0.20.5) | Eigene Datei oder `preferences.json` | `folders.json` existiert bereits in `~/.copilot-desktop/`; Flags sind applikationsweit (nicht per Workspace) und sollen bei Preferences-Export *nicht* mitgehen. Zusätzliche Datei wäre Overhead — `folders.json` ist der pragmatische Kompromiss. |
| 10 | Onboarding-Wizard mit Tab-Locking (v0.18.2) | Separate Onboarding-Window oder First-Launch-Detektion im Renderer | Single-Window-UX; Tabs werden während Onboarding gesperrt → User kann nicht versehentlich ins leere UI interagieren. Auto-Unlock nach 180 s als Safety-Net. |
| 11 | Tutorial-Popups mit 30 s Auto-Close + closed-Guard (v0.20.5) | Popups bleiben bis User schließt | Nicht-invasiv: User wird nicht blockiert; closed-Guard verhindert Race-Conditions bei gleichzeitigem User-Klick und Timer-Ablauf |

---

## 10. Qualitätsanforderungen

### 10.1 Quality-Tree (Auszug)

```
Qualität
├── Zuverlässigkeit
│   ├── CLI-Spawn überlebt PATH-Defizite              ← Szenario Q-R-1
│   ├── Slash-Commands funktionieren auch beim Erststart ← Szenario Q-R-2
│   └── Preferences gehen niemals verloren            ← Szenario Q-R-3
├── Performance
│   ├── Streaming-Render <16 ms / Chunk
│   └── App-Start < 2 s bis Window sichtbar
├── Wartbarkeit
│   ├── Reine Funktionen in src/ unit-getestet
│   └── IPC-Handler dünn, Logik in src/
├── Sicherheit
│   ├── Renderer ohne Node-Zugriff
│   └── Sanitisierter Markdown-Output
└── Cross-Plattform
    └── Win/Linux/macOS getestet
```

### 10.2 Quality-Szenarien

| ID | Stimulus | Reaktion |
|---|---|---|
| **Q-R-1** | User installiert App auf frischem Linux, `copilot` liegt in `~/.local/bin`, Electron startet ohne Login-Shell | App muss `copilot` finden (`buildEnv()` augmentiert PATH) |
| **Q-R-2** | Erstes Senden eines Slash-Commands in unbekanntem Ordner | Trust-Prompt wird auto-bestätigt, Slash-Command erreicht das TUI |
| **Q-R-3** | App wird als gepacktes Build installiert; User ändert Theme | Theme-Änderung persistiert in `userData/preferences.json` und überlebt Neustart |
| **Q-S-1** | CLI streamt `<script>alert(1)</script>` als Markdown | Wird durch DOMPurify entschärft, kein Script-Eval |
| **Q-P-1** | Antwort mit 5000 Markdown-Zeilen | Inkrementelles Rendering, keine UI-Freezes |

---

## 11. Risiken und technische Schulden

| # | Risiko / Schuld | Auswirkung | Mitigation |
|---|---|---|---|
| R-1 | **`renderer/app.js` ist ~2.4k Zeilen prozedural** | Schwer zu navigieren, Refactoring-Risiko | Schrittweise Modularisierung wie in `renderer/modules/` begonnen |
| R-2 | **PTY-Ready-Detection ist heuristisch** (Stringmatching auf `'/ commands'`) | Bei CLI-Update brechen Slash-Commands plötzlich | Reine Funktion `isCopilotTuiReady` zentralisiert; Tests dokumentieren erwartete Marker |
| R-3 | **`@homebridge/node-pty-prebuilt-multiarch` als Native-Dep** | Keine Prebuilds für exotische Plattformen → User braucht Python/node-gyp | Fallback-Require auf `node-pty`; Setup-Doku weist auf Python hin |
| R-4 | **Kein automatisierter E2E-Smoke-Test für Chat-Roundtrip** | Regressionen wie das v0.15.5-Problem fallen erst manuell auf | TODO: Playwright-Test, der eine echte Nachricht sendet und Antwort erwartet (in `e2e/` Stub vorhanden) |
| R-5 | **Globale Maps (`copilotProcesses` etc.) im Main-Modul** | Kein Cleanup bei Window-Reload, Memory-Leak möglich | `cleanupPty` + `app.on('window-all-closed')` decken Standard-Fall ab; Reload während Spawn nicht getestet |
| R-6 | **`console.log` Monkey-Patching** | Schlecht serialisierbare Argumente können Logging brechen | `try/catch` um Serialisierung; abnormale Fälle landen nur in der echten Console |
| R-7 | **Keine eigene CI-Pipeline definiert** im Repo (Stand v0.15.7) | Tests müssen lokal laufen; Regressionen nicht garantiert geblockt | TODO: GitHub-Actions-Workflow für `npm test` + `npm run lint` |
| R-8 | **Native PowerShell unter Win optional bundled** (`vendor/pwsh/pwsh.exe`) | Wenn nicht vorhanden, Fallback auf `cmd.exe` mit eingeschränkten Features | Setup-Script behandelt das, Doku erklärt den Fallback |

---

## 12. Glossar

| Begriff | Bedeutung |
|---|---|
| **Main Process** | Electron-Hauptprozess mit Node.js-Zugriff — verwaltet Fenster, I/O und CLI-Prozesse |
| **Renderer Process** | Chromium-basierter UI-Prozess — rendert HTML/CSS/JS ohne Node.js-Zugriff |
| **IPC** | Inter-Process Communication — Kommunikation zwischen Main und Renderer |
| **Context Bridge** | Electron-Mechanismus zum sicheren Exponieren von APIs an den Renderer |
| **Copilot CLI** | Das `copilot`-Binary aus `gh extension install github/gh-copilot`. Wird von dieser App gespawnt — die App spricht *nicht* direkt mit GitHub. |
| **JSONL** | JSON Lines: ein JSON-Objekt pro Zeile, streamingfreundlich. Ausgabeformat der CLI mit `--output-format json --stream on`. |
| **PTY** | Pseudo-Terminal. Erlaubt es, ein Programm so zu starten, als säße ein User vor einem Terminal — nötig für Slash-Commands, weil die TUI sonst „nicht interaktiv“ erkennt und die Marker `/ commands` / `? help` nicht zeigt. |
| **Folder-Trust** | Sicherheitsdialog der Copilot CLI beim Erststart in einem Ordner. Blockiert das TUI bis bestätigt — wir auto-bestätigen mit `'2\r'`. |
| **Slash-Command** | TUI-Befehl wie `/context`, `/compact`, `/init`. Wird über das PTY mittels Bracketed-Paste-Mode gesendet. |
| **Skill** | YAML-/Markdown-Beschreibung in `~/.copilot/skills/`, die Copilot zusätzliches Wissen gibt. Wir lesen sie nur und erlauben Toggles per Session. |
| **Sub-Agent** | Spezialisierter Agent (in `~/.copilot/agents/`), an den Copilot komplexe Tasks delegiert. |
| **Bracketed-Paste** | Terminal-Modus (`\x1b[200~ … \x1b[201~`), in dem das TUI weiß, dass eine Eingabe als geblockte Paste behandelt werden soll — wichtig, damit Slash-Commands nicht zeichenweise als Tipp-Eingabe interpretiert werden. |
| **userData** | Electron-App-spezifischer Schreibort: `app.getPath('userData')`. Plattformabhängig. |
| **buildEnv** | Helper in `src/main-helpers.js`, der das Environment für gespawnte Child-Prozesse zusammenbaut (PATH-Augmentation auf Linux/macOS). |

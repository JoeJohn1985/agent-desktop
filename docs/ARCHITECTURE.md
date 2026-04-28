# Copilot Desktop — Technische Architektur

> **Version:** 0.10.1 · **Stand:** Juli 2025 · **Stack:** Electron 35, node-pty, marked, highlight.js, xterm.js, yaml

---

## 1. Überblick

**Copilot Desktop** ist eine Electron-basierte Desktop-Anwendung, die als polierte Chat-Oberfläche für die GitHub Copilot CLI dient. Die App bietet Multi-Session-Management, Skill-Toggles, ein integriertes Terminal, Todo-Verwaltung, Bildvorschau und ein konfigurierbares Theme-System.

### Kernfunktionen

- **Chat-Interface** mit Markdown-Streaming und Syntax-Highlighting
- **Multi-Tab-Management** — mehrere Copilot-Sessions parallel
- **Integriertes Terminal** via xterm.js + node-pty (PTY)
- **Todo-Management** mit Drag & Drop
- **Session-Persistenz** über `~/.copilot/session-state/`
- **Skill-System** — dynamisches Laden und Aktivieren von Skills
- **Tool-Approval** — konfigurierbares Genehmigungssystem für Shell-Befehle
- **3 Themes** — Light, Dark, GEBIT (Corporate)

---

## 2. Architektur-Diagramm

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│  ┌─────────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌─────────────┐ │
│  │ Chat UI │ │ Tabs │ │Todos │ │Settings│ │ xterm.js    │ │
│  │(Markdown│ │(Multi│ │(CRUD │ │(Theme, │ │ (Terminal)  │ │
│  │ Stream) │ │ Tab) │ │ DnD) │ │ Perms) │ │             │ │
│  └────┬────┘ └──┬───┘ └──┬───┘ └───┬────┘ └──────┬──────┘ │
│       └─────────┴────────┴─────────┴──────────────┘        │
│                         │                                    │
│              preload.js (contextBridge)                      │
│              window.copilot / window.markdown                │
├─────────────────────────┼────────────────────────────────────┤
│                    Main Process                              │
│  ┌──────────────┐ ┌────┴───────┐ ┌──────────────┐          │
│  │ spawnCopilot │ │ Session &  │ │ PTY Terminal │          │
│  │ (JSONL CLI)  │ │ File Mgmt  │ │ (node-pty)   │          │
│  └──────┬───────┘ └────────────┘ └──────┬───────┘          │
│         │                                │                   │
│    copilot CLI                    Shell / Bash               │
│    (gh copilot)                                              │
│         │                                                    │
│    ~/.copilot/session-state/                                 │
└─────────────────────────────────────────────────────────────┘
```

### Prozess-Trennung

| Prozess | Verantwortung |
|---|---|
| **Main Process** | Window-Erstellung, CLI-Spawning, File-I/O, PTY-Management, alle IPC-Handler |
| **Renderer Process** | UI-Rendering, Chat-Logik, Tab-State, Theme-Verwaltung, Terminal-Frontend |
| **preload.js** | Sichere Brücke zwischen Main und Renderer via `contextBridge` |

---

## 3. Dateistruktur

| Datei | Größe | Beschreibung |
|---|---|---|
| `main.js` | ~34 KB | **Electron Main Process** — Window-Erstellung, Copilot CLI Spawning, Session/Todo/Image/Skill-Management, PTY-Terminal, alle IPC-Handler |
| `preload.js` | 114 Zeilen | **Context Bridge** — exponiert `window.copilot` (9 Namespaces) und `window.markdown` APIs |
| `renderer/app.js` | ~72 KB | **Frontend-Logik** — Chat-UI, Tab-Management, Settings, Todos, Images, Terminal, Search, Themes |
| `renderer/index.html` | 301 Zeilen | **App-Shell** — Custom Titlebar, Sidebar, Chat-Area, Terminal-Panel, Settings/Delete-Overlays, Lightbox |
| `renderer/styles.css` | ~41 KB | **Alle Styles** — CSS-Variablen, 3 Themes (Light/Dark/GEBIT), 30+ Komponentensektionen |
| `package.json` | — | Konfiguration, Dependencies, Scripts |
| `setup.ps1` | — | Automatisiertes Setup-Script |
| `assets/` | — | Logo-SVGs |

---

## 4. IPC-Kommunikation

Die Kommunikation zwischen Main und Renderer Process erfolgt über **42 IPC-Channels**, organisiert in **10 Namespaces**. Alle Channels sind über `contextBridge.exposeInMainWorld` exponiert.

### 4.1 Namespace: `copilot` (Chat)

| Channel | Typ | Beschreibung |
|---|---|---|
| `copilot:send` | handle | Sendet Chat-Nachricht an Copilot CLI |
| `copilot:newTab` | handle | Erstellt neuen Tab (spawnt Copilot-Prozess) |
| `copilot:getCwd` | handle | Aktuelles Arbeitsverzeichnis abfragen |
| `copilot:openCwd` | handle | CWD im Explorer öffnen |
| `copilot:getVersions` | handle | Versionen (App, CLI, Node, Electron) |
| `copilot:getInstructions` | handle | `copilot-instructions.md` lesen |
| `copilot:stop` | on | Copilot-Prozess für Tab stoppen |

### 4.2 Namespace: `sessions`

| Channel | Typ | Beschreibung |
|---|---|---|
| `sessions:list` | handle | Alle Sessions aus `~/.copilot/session-state/` auflisten |
| `sessions:readCheckpoints` | handle | Checkpoint-Dateien einer Session lesen |
| `sessions:readPlan` | handle | `plan.md` einer Session lesen |
| `sessions:delete` | handle | Session-Ordner löschen |
| `sessions:rename` | handle | Session umbenennen |
| `sessions:create` | handle | Neue benannte Session erstellen |

### 4.3 Namespace: `todos`

| Channel | Typ | Beschreibung |
|---|---|---|
| `todos:list` | handle | Todos einer Session laden |
| `todos:add` | handle | Todo hinzufügen |
| `todos:update` | handle | Todo-Status ändern |
| `todos:delete` | handle | Todo löschen |
| `todos:reorder` | handle | Todo-Reihenfolge ändern (Drag & Drop) |

### 4.4 Namespace: `images`

| Channel | Typ | Beschreibung |
|---|---|---|
| `images:list` | handle | Bilder aus `images/`-Ordner auflisten |
| `images:open` | handle | Bild im System-Viewer öffnen |
| `images:delete` | handle | Bild löschen |
| `images:openFolder` | handle | `images/`-Ordner im Explorer öffnen |

### 4.5 Namespace: `terminal` (PTY)

| Channel | Typ | Beschreibung |
|---|---|---|
| `terminal:available` | handle | Prüft ob node-pty verfügbar ist |
| `terminal:spawn-background` | handle | Hintergrund-PTY für Tab spawnen |
| `terminal:get-buffer` | handle | Terminal-Buffer auslesen |
| `terminal:send-command` | handle | Befehl an PTY senden |
| `terminal:fetch-context` | handle | `/context` ausführen und parsen |
| `terminal:send-slash` | handle | Generischen Slash-Command senden |
| `terminal:spawn` | handle | Interaktives Terminal spawnen |
| `terminal:input` | on | Terminal-Eingabe weiterleiten |
| `terminal:resize` | on | Terminal-Größe anpassen |
| `terminal:close` | on | Terminal schließen |

### 4.6 Weitere Namespaces

| Channel | Typ | Beschreibung |
|---|---|---|
| `config:read` | handle | Copilot-Konfiguration (`config.yaml`) lesen |
| `instructions:getShellExceptions` | handle | Shell-Ausnahmen laden |
| `instructions:setShellExceptions` | handle | Shell-Ausnahmen speichern |
| `skills:list` | handle | Skills aus `~/.copilot/skills/` scannen |
| `files:processDropped` | handle | Drag & Drop-Dateien verarbeiten |
| `window:minimize` | on | Fenster minimieren |
| `window:maximize` | on | Fenster maximieren/wiederherstellen |
| `window:close` | on | Fenster schließen |

---

## 5. Datenflüsse

### 5.1 Chat-Nachricht senden

```
User → textarea → sendMessage() → IPC copilot:send → main.js
                                                         │
                                          spawnCopilot(tabId, prompt, options)
                                                         │
                                          gh copilot --output-format json --stream on
                                                         │
                                              ┌──────────┴──────────┐
                                              │   JSONL-Events      │
                                              │   (stdout stream)   │
                                              └──────────┬──────────┘
                                                         │
                                          event.sender.send('copilot:event', data)
                                                         │
                                          Renderer: initCopilotIPC()
                                                         │
                                          Stream-Area rendern → copilot:done
```

**Detaillierter Ablauf:**

1. User tippt Nachricht in `<textarea>` (`renderer/app.js`)
2. `sendMessage()` sammelt: `text`, `activeSkills`, `model`, `sessionId`, `allowedTools`, `deniedTools`, `extraDirs`, `resume`-Flag
3. IPC-Call `copilot:send` → `main.js`
4. `spawnCopilot(tabId, prompt, options)` spawnt `gh copilot` CLI-Prozess mit `--output-format json --stream on`
5. JSONL-Events werden empfangen: `text`, `tool_call`, `thinking`, `confirmation`, `model`, `mcp_servers`, `active_skills`, `active_instructions`, `session_id`, `cwd`
6. Jedes Event → `event.sender.send('copilot:event', {tabId, ...data})` → Renderer
7. Renderer (`initCopilotIPC()`) empfängt Events und rendert in die Stream-Area
8. Bei `copilot:done` → Tab-Status wird zurückgesetzt

### 5.2 Slash Commands via Background PTY

```
Tab-Erstellung → terminal:spawn-background → PTY (gh copilot)
                                                  │
                                     Wartet auf Resume-Prompt
                                     Sendet automatisch "1"
                                                  │
Slash-Command ─→ terminal:send-command ──────→ PTY stdin
                 (Bracketed Paste Mode)           │
                 \x1b[200~...\x1b[201~           │
                                                  │
                 terminal:get-buffer ←──────── PTY stdout
                                                  │
                 Parsing (bei /context) ──→ Strukturierte Daten
```

**Detaillierter Ablauf:**

1. Pro Tab wird ein Hintergrund-PTY gespawnt (`terminal:spawn-background`)
2. PTY startet `gh copilot` CLI, wartet auf Resume-Prompt, sendet automatisch `1`
3. Slash-Befehle werden via `terminal:send-command`, `terminal:fetch-context` oder `terminal:send-slash` gesendet
4. **Wichtig:** Bracketed Paste Mode erforderlich — Befehle werden mit `\x1b[200~...\x1b[201~` gewrappt
5. Output wird aus dem PTY-Buffer gelesen; bei `/context` zusätzlich geparst

---

## 6. Persistenz & Speicherorte

| Daten | Speicherort | Format |
|---|---|---|
| Sessions | `~/.copilot/session-state/<uuid>/` | Von Copilot CLI verwaltet |
| Checkpoints | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown-Dateien |
| Plan | `~/.copilot/session-state/<uuid>/plan.md` | Markdown |
| Todos | `~/.copilot/session-state/<uuid>/todos.json` | JSON: `[{id, text, status, createdAt}]` |
| Einstellungen | `localStorage` im Renderer | JSON (Theme, Font-Größe etc.) |
| Skills | `~/.copilot/skills/<name>/SKILL.md` | YAML-Frontmatter + Markdown |
| Konfiguration | `~/.copilot/config.yaml` | YAML |
| Bilder | `~/Copilot/images/` | PNG/JPG-Dateien + `fs.watch` |
| Tab-State | `localStorage` → `openTabs` | JSON-Array mit Tab-Konfigurationen |

---

## 7. Zentrale Patterns

### 7.1 Context Parser (`parseContextOutput`)

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
    // ...
  ]
}
```

### 7.2 Per-Tab State

Jedes Tab-Objekt speichert:

```javascript
{
  id: "tab-uuid",
  label: "Session Name",
  sessionId: "copilot-session-uuid",
  status: "idle" | "streaming" | "waiting",
  chatHistory: [],
  contextPercent: 6,
  terminalReady: true
}
```

### 7.3 Skill Injection

Aktive Skills werden gesammelt und als Prompt-Prefix serialisiert:

```
Verwende folgende Skills für diese Aufgabe:
- **skill-name**: description
```

Skills werden aus `~/.copilot/skills/` gescannt. Jeder Skill besteht aus einer `SKILL.md`-Datei mit YAML-Frontmatter (Name, Beschreibung) und Markdown-Body (Instruktionen).

### 7.4 Theme-System

Drei Themes über CSS Custom Properties:

| Theme | Klasse | Beschreibung |
|---|---|---|
| Light | Standard (`:root`) | Helles Standard-Theme |
| Dark | `[data-theme="dark"]` | Dunkles Theme |
| GEBIT | `[data-theme="gebit"]` | Corporate-Theme |

Alle Farben sind in `:root` definiert und werden in den jeweiligen `[data-theme]`-Selektoren überschrieben.

### 7.5 Tool Approval

Die Copilot CLI sendet `confirmation`-Events für Shell-Befehle. Die App reagiert je nach Konfiguration:

- **`autoApprove: true`** → Automatische Genehmigung aller Befehle
- **`autoApprove: false`** → Bestätigungs-UI wird angezeigt, User muss genehmigen oder ablehnen
- **Shell-Ausnahmen** — bestimmte Befehle können vorab als erlaubt oder verboten konfiguriert werden

---

## 8. Dependencies

| Paket | Version | Zweck |
|---|---|---|
| `electron` | ^35.0.0 | Desktop-Framework |
| `@homebridge/node-pty-prebuilt-multiarch` | latest | Native PTY für Terminal-Integration |
| `marked` | latest | Markdown → HTML Konvertierung |
| `highlight.js` | latest | Syntax-Highlighting für Code-Blöcke |
| `xterm` | latest | Terminal-Emulator (Renderer) |
| `xterm-addon-fit` | latest | Automatische Größenanpassung des Terminals |
| `yaml` | latest | YAML-Parsing für Konfiguration und Skills |

---

## 9. Sicherheit

### Electron-Konfiguration

| Einstellung | Wert | Bedeutung |
|---|---|---|
| `contextIsolation` | `true` | Renderer hat keinen direkten Zugriff auf Node.js APIs |
| `nodeIntegration` | `false` | Sicherste Electron-Konfiguration — kein `require()` im Renderer |

### IPC-Sicherheit

- Alle IPC-Kommunikation erfolgt ausschließlich über `contextBridge.exposeInMainWorld`
- Der Renderer hat nur Zugriff auf explizit exponierte APIs (`window.copilot`, `window.markdown`)
- Kein direkter Zugriff auf `ipcRenderer` oder Node.js-Module im Renderer

### Tool-Permissions

- **Allowed Tools** — Liste erlaubter CLI-Tools (konfigurierbar)
- **Denied Tools** — Liste verbotener CLI-Tools (konfigurierbar)
- **Shell Exceptions** — Befehle, die ohne Bestätigung ausgeführt werden dürfen (`instructions:getShellExceptions` / `setShellExceptions`)

---

## 10. Glossar

| Begriff | Bedeutung |
|---|---|
| **Main Process** | Electron-Hauptprozess mit Node.js-Zugriff — verwaltet Fenster, I/O und CLI-Prozesse |
| **Renderer Process** | Chromium-basierter UI-Prozess — rendert HTML/CSS/JS ohne Node.js-Zugriff |
| **IPC** | Inter-Process Communication — Kommunikation zwischen Main und Renderer |
| **PTY** | Pseudo-Terminal — emuliert ein Terminal für CLI-Interaktion |
| **JSONL** | JSON Lines — zeilenbasiertes JSON-Streaming-Format |
| **Context Bridge** | Electron-Mechanismus zum sicheren Exponieren von APIs an den Renderer |
| **Bracketed Paste Mode** | Terminal-Modus, der eingefügten Text mit Escape-Sequenzen umschließt |
| **Skill** | Wiederverwendbare Instruktions-Datei, die Copilot zusätzlichen Kontext gibt |

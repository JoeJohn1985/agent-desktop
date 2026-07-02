# Changelog

## [1.0.0] - 2026-07-02

Erstes stabiles Release. Die Kernfunktion (GitHub Copilot CLI) ist vollständig
getestet; die Direkt-API-Provider sind je nach Reifegrad als **Beta** (Gemini)
bzw. **Alpha** (Anthropic, OpenAI, GLM, Ollama) gekennzeichnet.

### Added
- **Dynamische Modell-Ermittlung für alle Provider** — Modelle werden per
  `/models`-Endpoint (Anthropic, Gemini, OpenAI, GLM, Ollama) bzw. via ACP
  (Copilot) live erkannt und persistiert. Taucht ein neues Modell auf, erscheint
  eine Info. (`src/model-discovery.js`, IPC `providers:listModels`)
- **Alpha-/Beta-Reifegrad-Labels** je Provider mit Tooltip (Beta: „Getestet
  nicht final", Alpha: „Nicht getestet"); Copilot ohne Label.
- **Diagnose-Logging** (unbekannte ACP-Events vollständig + roher `/usage`-Text)
  zur Untersuchung von Subagent-/Usage-Signalen.

### Changed
- **Tab-Leiste optimiert**: aktiver Tab groß (volles Label + Aktionen), übrige
  kompakt (3-Zeichen-Kürzel, Trenn-Ränder, Aktionen nur bei Hover); App-Icon
  entfernt; Schließen-✕ in der rechten Ecke.

### Fixed
- **Kosten je Nachricht mit dem tatsächlich verwendeten Modell** abgerechnet
  (eingefroren beim Senden) — ein Modellwechsel zwischen zwei Prompts verrechnet
  frühere Tokens nicht mehr zum neuen Preis.
- **Tool-Aufrufe bei Copilot (ACP) sichtbar**: `kind` wird über
  `tool_call_update` hinweg gemerkt (korrektes Icon statt versteckt); der
  Tool-Aufruf wird zentral in `tool.execution_start` gerendert.
- **MCP-Tool-Aufrufe** (z. B. Playwright) werden nicht mehr ausgeblendet
  (generisches 🔧-Icon + sinnvolle Argument-Anzeige).
- **Tool-Ergebnis nicht mehr dreifach** angezeigt (ACP-Status-Updates werden per
  `toolCallId` dedupliziert und in-place aktualisiert).
- **Fehlender Absatz zwischen Sätzen** an `report_intent`-Grenzen behoben.
- **Nach dem Laden einer Session** wird ans Ende (letzter Dialogstand) gescrollt.

<!-- Die folgenden Einträge waren zuvor unter [Unreleased] und sind Teil von 1.0.0. -->

### Added
- **Drei neue Provider: OpenAI, Ollama, GLM (Zhipu)** — voll agentisch über einen gemeinsamen OpenAI-kompatiblen Kern (Chat Completions + Function Calling, SSE-Streaming, dependency-frei). Ollama ist lokal & keyless; Base-URL pro Provider in den Einstellungen überschreibbar. (`src/providers/openai-compatible-provider.js` + `openai/ollama/glm-provider.js`)
- **Standard-Provider + Standard-Modell pro Provider** in den Einstellungen; behebt zugleich den Bug, dass Copilot immer mit Haiku statt dem gewählten Modell startete
- **Modell-Kennzeichnung** im Dropdown: 💲 kostenpflichtig / 🆓 kostenlos / AIC (Copilot-Abo)
- **Kontext-Auslastung** aktualisiert sich nach jeder Nachricht automatisch (alle Provider)
- **Kontingent-/Rate-Limit-Fehler** werden als verständliche Info statt rohem JSON angezeigt (Gemini/Anthropic/OpenAI)

### Changed
- **Kosten in echtem USD** statt gemischter AI-Credits (Copilot 100 AIC = 1 $); **Kosten-Window nach Provider gruppierbar** (Umschalter Provider/Session)
- **Git-basiertes Self-Update**: Die App prüft beim Start, periodisch (alle 6 h) und per Button in *Einstellungen → UI* über `git ls-remote --tags origin`, ob ein neuerer Release-Tag (`vX.Y.Z`) existiert (Vergleich mit lokaler `package.json`-Version, nur stabile Tags). Bei verfügbarem Update erscheint ein Banner „Neue Version verfügbar" mit „Herunterladen & Neustarten": sauberer Working Tree vorausgesetzt → `git pull --ff-only origin main`, bei geänderten Abhängigkeiten automatisch `npm install`, danach Neustart. Kein eingebettetes Token — nutzt die Git-Credentials des Nutzers (funktioniert auch beim privaten Repo). (`src/updater.js`, IPC `updates:check`/`updates:apply`)
- **Gemini 3.5 Flash** zur Modellauswahl hinzugefügt (Preise vorläufig wie 2.5 Flash, bis offiziell bestätigt)
- **Info-Tooltip je Provider** in den API-Provider-Einstellungen (ⓘ): listet verfügbare Tools und Besonderheiten pro Provider beim Hover
- **Auth-Hinweis mit Login + Neustart**: Bei „Anmeldung erforderlich" öffnet ein Button ein sichtbares Terminal mit `copilot login`; danach „App neu starten"-Button (nötig, da die Auth beim Main-Prozess-Start übernommen wird)

### Changed
- **Todos sind jetzt projekt- statt session-gebunden**: Sie werden als Markdown-Checkliste unter `<cwd>/todo/todos.md` gespeichert (mit unsichtbaren ID-Kommentaren für verlustfreie Round-Trips) statt in `<session>/todos.json`. Dadurch überlebt die Todo-Liste das Löschen einer Session und wird von allen Sessions im selben Verzeichnis geteilt. (`src/todos.js`, IPC `todos:*` nun cwd-basiert)
- **Gemini: Live-Suche und Datei-Tools per Tab umschaltbar** statt kombiniert — Gemini 2.5 verbietet beides im selben Request (400 `INVALID_ARGUMENT`). Modus „🔍 Recherche" (Default) bzw. „📁 Dateien" ist jederzeit pro Tab wechselbar
- **Session-Löschung in den Papierkorb** (`shell.trashItem`) statt unwiderruflichem `fs.rmSync`; zusätzlich wird eine nicht-leere `todos.json` vor dem Löschen nach `~/.copilot-desktop/deleted-todos/` gesichert
- **Mehrzeilige Tooltips**: `.js-tooltip` nutzt jetzt `white-space: pre-line` (Zeilenumbrüche werden dargestellt)

## [0.32.0] - 2026-06-24

### Added
- **Multi-LLM-Provider: Anthropic API (voll agentisch)** — neben der Copilot CLI kann pro Tab jetzt die Anthropic-API direkt genutzt werden. Eigene Agent-Schleife mit lokaler Tool-Ausführung (`shell`, `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`), Streaming, adaptivem Thinking und Token-genauer Kostenabrechnung. (`src/providers/*`, `src/secure-store.js`)
- **Multi-LLM-Provider: Google Gemini (recherche-orientiert)** — Gemini 2.5 Pro/Flash als Direkt-API. **Live-Google-Suche** (Grounding) mit automatischen Quellenangaben + Datei-Tools (lesen/schreiben/bearbeiten), aber ohne Shell und ohne Skills/Agents/Instructions. (`src/providers/gemini-provider.js`, `@google/genai`)
- **Provider-Auswahl beim neuen Tab**: Klick auf „+" öffnet ein Provider-Dropdown (Copilot, Gemini, Anthropic, OpenAI); der Provider ist pro Tab fix. In der Session-Leiste wird der Provider als reine Anzeige neben den Kosten gezeigt
- **Sichere API-Key-Speicherung** über den OS-Schlüsselbund (Electron `safeStorage`); neuer Einstellungen-Tab „API-Provider". Keys verlassen den Hauptprozess nicht
- **Skills, Agents und `copilot-instructions.md`** werden für die Direkt-API als (gecachter) System-Prompt-Kontext injiziert
- **Prompt-Caching** für die Anthropic-API (wachsender System-/Tool-/Historien-Präfix wird gecacht)
- **Kontext-Management für Direkt-Provider**: `📊 %`-Anzeige + **automatisches Compact** ab 80 % Auslastung
- **Session-Persistenz + Wiederanzeige** für Direkt-API-Sessions (Historie unter `~/.copilot-desktop/api-sessions/`)
- **Cache-Write-Tokens** (1,25× Input) werden in der Kostenrechnung berücksichtigt

### Changed
- `shell`-Tool der Direkt-API läuft unter Windows über **PowerShell** statt cmd.exe (plattformabhängig via `spawn`)

### Fixed
- **ACP `session/prompt`-Timeout (kritisch)**: Längere Copilot-Turns (> 60 s) liefen in ein festes 60-Sekunden-Timeout → „[Prozess beendet mit Code 1]", während die CLI weiterlief und die Antwort endlos weiterstreamte (Anzeige blieb auf „Running" hängen). `session/prompt` hat jetzt kein Timeout mehr (begrenzt durch Cancel/Prozess-Ende); stille Slash-Commands nutzen 180 s
- **Verschmolzene Nachrichten**: Aufeinanderfolgende Antwort-Segmente um Tool-Aufrufe herum („… aufrufen:Jetzt …") wurden in eine Blase gerendert. Ein Tool-Aufruf schließt jetzt die Antwort-Blase → getrennte, lesbare Nachrichten (Copilot und Direkt-API)
- **Provider-Dropdown**: fehlender Panel-Hintergrund/falsche Position beim „+"-Provider-Menü behoben (eigene Panel-Klasse, fixe Positionierung)

## [0.31.0] - 2026-06-19

### Added
- **Credit-Schätzung aus Token-Verbrauch**: `/usage` liefert Input/Output/Cache-Tokens, die App berechnet daraus geschätzte AI Credits (`~12.5C`) per Modellpreistabelle (Sonnet 4.6: 300/30/1500C, Opus 4.8: 500/50/2500C pro 1M Tokens)
- **Kosten-Verlauf in Einstellungen**: Neuer Settings-Tab „Kosten" mit gestapeltem Balkendiagramm (Tages-/Wochenansicht), Aufschlüsselung nach Session, Gesamtsumme und Verlauf-Löschen-Button
- **Cost-Log**: Delta-Kosten werden pro Prompt in `preferences.json` (Key `costLog`) persistiert; max. 5.000 Einträge
- `buildCostBuckets`, `aggregateCostBySession`, `trimCostLog` als testbare Pure-Funktionen in `src/renderer-logic.js`
- **Haiku 4.5 Preise** in der Modellpreistabelle (Input 100C, Cache 10C, Output 500C pro 1M Tokens)

### Changed
- **Kosten als eigene Page statt Settings-Tab**: Die Kostenauflistung öffnet sich jetzt wie der Plugin-Marketplace als eigene Vollbild-Page (mehr Platz für wachsende Daten) — erreichbar über ein 📈-Icon in der Session-Leiste. Der „Kosten"-Tab in den Einstellungen entfällt
- **AIC-Anzeige immer sichtbar**: Die Credit-Anzeige zeigt vor dem ersten Prompt `~0C` statt leer zu sein
- Session-Leiste zeigt jetzt `~X.XC` statt AIU (Fallback auf AIU/AIC wenn Modell-Preistabelle nicht greift)
- `parseUsageTokens`, `parseUsageRequests`, `estimateCredits`, `MODEL_PRICING` aus `renderer/app.js` nach `src/renderer-logic.js` ausgelagert (testbar)
- **Kosten-Panel nach `renderer/modules/costs.js` ausgelagert** — `renderer/app.js` verschlankt, Kosten-Log und Diagramm-Logik in eigenem Modul
- **Cost-Tracking auch für Hintergrund-Tabs**: `refreshUsageDisplay` läuft jetzt nach jedem abgeschlossenen Prompt, nicht nur für den aktiven Tab

### Fixed
- **Kostenberechnung bei Modellwechsel**: Pro Prompt wird jetzt nur der **Token-Zuwachs** seit der letzten Messung mit dem aktuellen Modellpreis verrechnet (`estimateCreditsDelta`). Vorher wurde die kumulierte Token-Summe komplett mit dem aktuellen Preis bewertet, wodurch ein Modellwechsel die unter dem alten Modell verbrauchten Tokens rückwirkend umpreiste (zu hohe/niedrige Deltas, bei Wechsel auf günstigeres Modell teils 0). Negative Deltas (nach `/clear`/`/compact`) werden auf 0 geklemmt
- **`require is not defined` im Renderer (kritisch)**: `renderer/app.js` nutzte `require('../src/renderer-logic')`, was im Renderer (nodeIntegration: false, kein Bundler) eine `ReferenceError` warf und die gesamte app.js-Ausführung abbrach (u.a. `toggleSection is not defined`). `renderer-logic.js` ist jetzt UMD-gewrappt (IIFE) und stellt `window.RendererLogic` bereit; app.js liest daraus statt via `require`
- **Kosten-Panel zeigte keine Daten**: 3 falsch benannte CSS-Variablen (`--bg-secondary`/`--bg-primary`/`--border-color` → `--bg-hover`/`--bg-surface`/`--border`) — Canvas-Hintergrund und Trennlinien waren unsichtbar
- **Y-Achsen-Gitterlinien im Light-Theme kaum sichtbar**: `drawCostsChart` las die nicht existente CSS-Variable `--border-color` statt `--border`
- **Stille Fehler in `refreshUsageDisplay`**: `catch (_) {}` ersetzt durch Logging
- `niceStep(0)` mit Guard abgesichert (vermied potenzielles `NaN` bei leerem Diagramm)

## [0.29.1] - 2026-06-18

### Fixed
- **Modell-IDs in Pricing-Map**: Punkte statt Bindestriche (`claude-sonnet-4.6` nicht `claude-sonnet-4-6`) — Credits wurden nicht berechnet, stattdessen AIU angezeigt

## [0.29.0] - 2026-06-18

### Added
- **Kontext-Button als Dropdown**: Der `📊 Kontext`-Button zeigt jetzt die aktuelle Auslastung in % direkt im Button (`📊 18%`) und öffnet per Klick ein Dropdown mit drei Aktionen:
  - **Kontext anzeigen**: Detail-Panel mit Token-Auslastung (Kategorien, Prozent, farbcodiert)
  - **Compact**: Fasst die Konversation zusammen und aktualisiert die %-Anzeige
  - **Clear**: Löscht den Kontext, fragt danach erneut `/context` ab
- **Tools-Button**: `🔧 Tools`-Button neben dem Kontext-Button — öffnet Popup für Session-spezifische Denied-Tools
- **AIU-/Credit-Anzeige in der Leiste**: Rechts in der Session-Aktionsleiste wird der Verbrauch der aktuellen Session als Text angezeigt
- **Session-spezifische Tool-Denial mit Prozess-Neustart**: Änderungen an der Session-Deny-Liste (Hinzufügen, Toggle, Löschen) starten den ACP-Prozess automatisch neu und laden die Session via `session/load` wieder
- IPC-Handler `copilot:restartWithDeniedTools` in `main.js`
- Preload-Bridge `copilot.chat.restartWithDeniedTools`

### Changed
- Session-Aktionsleiste umstrukturiert: Model → Agent → Kontext (Dropdown) → Tools | Verbrauch
- Pin-Funktion für Session-Tools entfernt

### Fixed
- **Mode-Dropdown öffnete sich nach oben**: Falscher CSS-Klassenname (`mode-dropdown--below` statt `model-dropdown--below`) — Dropdown öffnet jetzt korrekt nach unten

## [0.28.0] - 2026-06-xx

### Added
- **ACP-Backend-Migration**: Die gesamte Kommunikation mit der Copilot CLI läuft jetzt über `copilot --acp` (Agent Communication Protocol, JSON-RPC über NDJSON stdio)
- `AcpClient` (`src/acp-client.js`): kapselt Session-Management, Prompt-Streaming, Event-Mapping und `silentCommand()`
- **`silentCommand(command)`**: Slash-Commands (`/context`, `/usage`, `/compact`, `/clear`) werden als stille ACP-Requests ausgeführt — Ergebnis geht nicht in den Chat
- IPC-Handler `copilot:silentCommand` in `main.js`
- Preload-Bridge `copilot.chat.silentCommand`
- `acpClients` Map in `main.js` (tabId → AcpClient)

### Removed
- **PTY-Terminal komplett entfernt**: Kein `node-pty`, kein `xterm.js`, kein Terminal-Panel mehr
- `renderer/modules/terminal.js` gelöscht
- `src/ipc/terminal-ipc.js` gelöscht
- `src/main-helpers.js`: `collectPtyOutput`, `waitForReady`, `isCopilotTuiReady`, `detectCopilotPrompt`, `cleanupPty` entfernt

### Changed
- Slash-Commands laufen nicht mehr über PTY-Bracketed-Paste, sondern über `silentCommand()`
- Prozess-Management: ein langlebiger ACP-Prozess pro Tab (statt Spawn-per-Message)

## [0.25.0] - 2026-05-21

### Added
- **CWD pro Session**: Arbeitsverzeichnis kann per Klick auf 📂 in der Statusbar pro Tab/Session gewählt werden
- CWD wird für benannte Sessions persistiert und beim Restore wiederhergestellt
- `saveSessionCwd` / `getSessionCwd` in `src/named-sessions.js`

## [0.24.6] - 2026-05-28

### Added
- **Application Icon**: `assets/icon.png` (512×512 RGBA) für Fenster, Titlebar, Tab-Bar und Dock
- **Linux Desktop Integration**: `assets/copilot-desktop.desktop` mit `StartupWMClass=copilot-desktop`
- **WM_CLASS fix**: `--class copilot-desktop` via Chromium switch auf Linux

## [0.24.0] - 2026-05-21

### Added
- **Skills in CLI deaktivieren**: Toggle-Button pro Skill — Skills können in `~/.copilot/settings.json` deaktiviert werden
- IPC-Handler `skills:getDisabled` und `skills:setDisabled`
- **Sidebar-Collapse-State persistieren**: Eingeklappte Bereiche werden gespeichert
- **Content-Sync Plain↔Rich**: Inhalt wird beim Modus-Wechsel übertragen

### Fixed
- Rich-Text Listen-Darstellung, Button-Reihenfolge Skill-Card, Content-Sync bei leerem Inhalt

### Removed
- Durchgestrichen-Button aus Rich-Text-Toolbar

## [0.23.0] - 2026-05-29

### Added
- **Rich-Text-Editor Toggle**: ✏️/📝-Button — Plaintext oder Rich-Text-Modus. Toolbar mit Bold, Italic, UL, OL. HTML→Markdown beim Senden.
- **Model-Dropdown Redesign**: Accent-Balken links + Hintergrund statt Häkchen
- **Model-Reihenfolge**: Haiku → Sonnet → Opus 4.6 → Opus 4.7

### Fixed
- Model-Persistenz nach App-Restart, Model-Persistenz für neue Sessions

## [0.21.0] - 2026-05-14

### Added
- JSDoc-Kommentare vollständig für alle Hauptdateien (main.js, preload.js, renderer/app.js, todos.js, scanners.js)

## [0.20.5] - 2026-05-14

### Added
- Tutorial-Flags in `folders.json` (Key-Whitelist: `tutorialSkillsShown`, `tutorialRenameShown`)
- IPC-Handler `tutorial:getFlags` / `tutorial:setFlag`
- Tutorial-Popups schließen automatisch nach 30 s (closed-Guard)
- `tab:renamed` CustomEvent bei Tab-Umbenennung

## [0.18.2] - 2026-05-12

### Added
- First-Run Onboarding Wizard (4 Schritte: Auth, Ordner, Agents/Skills, Feature-Intro)
- Tab-Unlock Fallback nach 180 s Inaktivität

## [0.16.1] - 2025-06-17

### Added
- Tab-Unlock Fallback bei hängenden Sub-Agents (30 s manuell, 180 s automatisch)
- Activity-Tracking (`lastActivityAt`)

## [0.16.0] - 2025-06-16

### Added
- Plugin-Manager, Session-Wiederaufnahme (Plan + letzte Nachrichten als Chat-Nachrichten)

## [0.15.0] - 2025-06-15

### Added
- Agents-Panel in Sidebar — scannt `~/.copilot/agents/*.agent.md`
- `src/agents.js`: `scanAgentsDirectory()`

## [0.14.4] - 2025-06-15

### Security
- XSS-Fix in `openInstructionsEditor`

### Fixed
- Model rollback bei Switch-Fehler, Event-Listener-Leak bei Window-Close

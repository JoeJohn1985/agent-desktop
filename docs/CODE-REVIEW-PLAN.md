# Vollumfängliche Code Review — Plan

Dieser Plan zerlegt die komplette Codebasis von Agent Desktop in überschaubare
Häppchen ("Chunks"), damit die Review Stück für Stück über mehrere Tage/Sessions
durchgeführt werden kann, ohne den Kontext einer einzelnen Session zu sprengen.
Jeder Chunk ist so geschnitten, dass er (Code + zugehörige Tests) bequem in
eine Session passt.

Siehe auch [`QUALITY-AUDIT-PLAN.md`](./QUALITY-AUDIT-PLAN.md) für die parallele
Qualitäts-Audit-Planung — beide Pläne nutzen dieselbe Chunk-Einteilung, damit
ein Chunk bei Bedarf in einem Rutsch aus beiden Blickwinkeln geprüft werden kann.

## Wie dieser Plan benutzt wird

1. Einen Chunk auswählen (Reihenfolge unten ist ein Vorschlag, keine Pflicht).
2. Alle Dateien des Chunks vollständig lesen (nicht nur grep-Treffer).
3. Die Checkliste unter "Review-Kriterien" durchgehen.
4. Gefundene Probleme direkt unter dem Chunk in den Abschnitt **Funde**
   eintragen (Datei:Zeile, kurze Beschreibung, Schwere: 🔴 Kritisch /
   🟠 Hoch / 🟡 Mittel / 🔵 Niedrig).
5. Checkbox des Chunks abhaken, wenn Review + offensichtliche Fixes erledigt sind.
6. Bei echten Bugs: sofort fixen (kleine, lokale Fixes) oder als eigenen Punkt
   in `todo/todos.md` aufnehmen, wenn der Fix größer ist.

## Review-Kriterien (pro Chunk anzuwenden)

- **Korrektheit:** Logikfehler, Off-by-one, falsche Bedingungen, Race
  Conditions, unbehandelte Promise-Rejections, falsche Annahmen über
  Rückgabewerte externer APIs/Provider.
- **Sicherheit:** Path Traversal (insb. bei allem, was `path.join` mit
  User-/IPC-Input kombiniert), ungeprüfte IPC-Parameter (Renderer ist nicht
  vertrauenswürdig), Command Injection bei `spawn`/`exec`, unsichere Ablage
  von Keys/Secrets, `innerHTML` mit ungesäuberten Daten (XSS) im Renderer.
- **Konsistenz:** Folgen gleichartige Module demselben Muster (z. B. sollten
  alle `providers/*-provider.js` ähnliche Fehlerbehandlung/Streaming-Semantik
  haben; alle `scanXIndex`/`buildXIndex`-Paare sollten sich spiegeln)?
- **Vereinfachung/Duplikation:** Redundanter Code, tote Codepfade, veraltete
  Kommentare, Funktionen, die nur noch von Tests aufgerufen werden.
- **Testabdeckung am Fundort:** Gibt es für kritische Logik in diesem Chunk
  überhaupt einen Test? Wird ein hier gefundener Bug durch einen Regressionstest
  abgesichert, sobald er gefixt ist?

## Bekannte Risikobereiche (aus vorherigen Reviews)

Diese Stellen waren in der Vergangenheit bereits Quelle realer Bugs — bei der
Review mit besonderer Aufmerksamkeit behandeln:

- Path-Traversal-Handling rund um `safeSessionPath`, `providerSkillsDir`/
  `providerAgentsDir`, `fileSlug`-Validierung (`/^[a-zA-Z0-9_-]+$/`) — Muster
  muss überall konsequent angewendet sein, wo IPC-Parameter in Dateipfade
  einfließen.
- Provider-spezifische Verzweigungen, die versehentlich Copilot-spezifische
  Syntax (z. B. `/agent Name`) an andere Provider durchreichen.
- Duplizierte Hilfsfunktionen zwischen `src/renderer-logic.js` und
  `renderer/modules/*.js` (Load-Order in `index.html` entscheidet, welche
  Kopie gewinnt — Falle für stille Bugs).

---

## Chunk-Übersicht

### Backend (Hauptprozess & `src/`)

- [ ] **B1 — Bootstrap & Prozess-Lifecycle**
  `main.js` (Zeilen 1–444, App-Start/Fenster/Backends-Map), `preload.js`,
  `src/shortcuts.js`, `src/main-helpers.js`, `src/logger.js`
  _Fokus: Fenster-/Prozess-Handling, Preload-Bridge-Oberfläche (jede
  exponierte Methode ist eine potenzielle Angriffsfläche vom Renderer aus)._

- [ ] **B2 — ACP-Client & Copilot/Claude-Code-Backend**
  `src/acp-client.js` (1176 Zeilen — größte Einzeldatei im Backend),
  `main.js` Copilot-/Claude-Code-IPC (`copilot:*`, `claudecode:status`,
  `auth:*`, ca. Zeilen 445–537 und 1833–1923)
  _Fokus: JSON-RPC/NDJSON-Parsing, Event-Handling, Fehlerpfade bei
  Backend-Absturz/Timeout._

- [ ] **B3 — API-Provider-Backends**
  `src/providers/anthropic-provider.js`, `openai-provider.js`,
  `openai-compatible-provider.js`, `glm-provider.js`, `ollama-provider.js`,
  `gemini-provider.js`, `api-agent-client.js`, `agent-tools.js`,
  `session-store.js`, `index.js`, `main.js` `sendApiPrompt` + `providers:*`
  IPC (ca. Zeilen 541–598)
  _Fokus: Konsistenz zwischen den 6 Provider-Implementierungen (Streaming,
  Tool-Calls, Fehlerbehandlung, Token-Zählung); `agent-tools.js` insb. auf
  Sandbox-/Pfad-Sicherheit prüfen (Datei-Tools laufen ungefiltert im
  Nutzerkontext)._

- [ ] **B4 — Lazy-Context-Architektur: Skills & Agents (Backend)**
  `src/scanners.js`, `src/agents.js`, `src/data-dir.js`,
  `src/providers/system-context.js`, `main.js` `skills:*`/`agents:*`/`mcp:*`
  IPC (ca. Zeilen 1010–1373)
  _Fokus: Provider-Allowlist (`LAZY_CONTEXT_PROVIDERS`) konsequent vor jeder
  Dateisystem-Operation geprüft? `fileSlug`/`dirName`-Validierung an jeder
  Stelle, die einen Pfad zusammenbaut?_

- [ ] **B5 — Sessions & Verlauf (Backend)**
  `src/sessions.js`, `src/claude-code-transcript.js`,
  `src/named-sessions.js`, `main.js` `sessions:*` IPC (ca. Zeilen 779–878)
  _Fokus: `sessionId`-Validierung vor Pfadkonstruktion (siehe bekannte
  Path-Traversal-Historie), Konsistenz der drei Historien-Quellen
  (Copilot/Claude-Code/API-Provider)._

- [ ] **B6 — Preferences, Todos, Pricing, Model-Discovery, Secrets**
  `src/preferences.js`, `src/todos.js`, `src/pricing-source.js`,
  `src/model-discovery.js`, `src/secure-store.js`, `main.js`
  `todos:*`/`preferences:*`/`folders:*`/`instructions:*` IPC
  _Fokus: `secure-store.js` — wie werden API-Keys tatsächlich verschlüsselt/
  abgelegt, Plattform-Fallbacks (kein DPAPI unter Linux/Mac?)._

- [ ] **B7 — Onboarding, Setup & Updater (Backend)**
  `main.js` Onboarding-/Setup-/Auth-IPC (ca. Zeilen 1452–1833),
  `src/updater.js`, `main.js` `updates:*` IPC (ca. Zeilen 655–688)
  _Fokus: Update-Mechanismus (Quelle/Signatur-Prüfung der Updates?),
  Erststart-Flow._

### Renderer (`renderer/`)

- [ ] **R1 — Tabs, Zustand & Sidebar**
  `renderer/app.js` Zeilen 1–1101 (Preferences/Settings-Getter, Tab-Erzeugung,
  `renderTabs`, `switchTab`, `closeTab`, Inaktivitäts-Monitor),
  `initSidebar` (ca. Zeile 5246)
  _Fokus: Tab-State-Konsistenz beim schnellen Wechsel/Schließen, Memory-Leaks
  durch nicht aufgeräumte Intervalle/Listener beim Tab-Close._

- [ ] **R2 — Chat-Stream & ACP-Event-Rendering**
  `renderer/app.js` Zeilen 1101–1937 (`sendMessage`, `handleSendResult`,
  `initCopilotIPC` — das Herzstück des Event-Handlings)
  _Fokus: Werden alle ACP-Event-Typen behandelt oder still verworfen (siehe
  offenes Todo zu `config_option_update`)? `innerHTML`-Stellen mit
  Modell-Output auf XSS-Sicherheit (DOMPurify-Einsatz konsistent?) prüfen._

- [ ] **R3 — Provider/Modell/Modus/Kosten-Steuerung**
  `renderer/app.js` Zeilen 1937–2963 (Modell-Auswahl, Mode-Umschaltung,
  Kontext-/Usage-Anzeige, Pricing)
  _Fokus: Konsistenz der Kostenberechnung pro Provider (bekanntes Todo:
  "Provider und Gesamtkosten weichen voneinander ab")._

- [ ] **R4 — Sessions-UI & Verlaufsdarstellung**
  `renderer/app.js` Zeilen 3018–3523 (`loadSessions`, `renderSessions`,
  `resumeSession`, `displaySessionContext`, `renderSimpleHistory`,
  `renderApiHistory`)
  _Fokus: Korrekte Provider-Verzweigung beim Laden der Historie (erst kürzlich
  gefixter Bereich — auf Regressionsrisiko bei künftigen Änderungen achten)._

- [ ] **R5 — Skills/Agents/MCP/Plugins-UI**
  `renderer/app.js` Zeilen 3523–4571 (`renderSkills`, `renderAgents`,
  `renderMcpServers`, Skill-/Agent-Manager, Plugin-Verwaltung)
  _Fokus: Lösch-Buttons nur bei tatsächlich löschbaren (nicht Provider-/
  Built-in-)Einträgen sichtbar (bekannter Bug-Typ)._

- [ ] **R6 — Settings, DevConsole, Shortcuts, Drag&Drop, Tooltips**
  `renderer/app.js` Zeilen 4571–6057 (ohne Onboarding/Updates)
  _Fokus: Shortcut-Konflikte, Drag&Drop-Dateivalidierung vor Verarbeitung._

- [ ] **R7 — Onboarding & Update-Banner-UI**
  `renderer/app.js` Zeilen 6057–6952
  _Fokus: Abbruch-/Zurück-Pfade im Wizard, ob Onboarding-State konsistent
  mit `dev:*`-Flags bleibt._

- [ ] **R8 — Gemeinsame Renderer-Logic & Utils**
  `src/renderer-logic.js`, `src/utils.js`, `src/frontend-helpers.js`,
  `src/file-processing.js`, `renderer/modules/*.js`,
  `renderer/provider-icons.js`
  _Fokus: Keine erneute Duplikation zwischen `renderer-logic.js` und
  `modules/*.js` (Ursache des letzten großen Bugs in diesem Bereich)._

- [ ] **R9 — Markup & Styles**
  `renderer/index.html`, `renderer/styles.css`
  _Fokus: Inline-Event-Handler vs. CSP, konsistente CSS-Variablen-Nutzung,
  a11y-Basics (Labels, Kontraste, Fokus-Reihenfolge)._

### Übergreifend

- [ ] **X1 — Testsuite auf Korrektheit**
  `__tests__/*` (45 Dateien), `e2e/*`
  _Fokus (Code-Review-Perspektive, nicht Abdeckungsanalyse — die läuft im
  Quality-Audit-Plan): Testen Tests tatsächliches Verhalten oder nur
  Implementierungsdetails? Gibt es flaky/zeitabhängige Tests? Gibt es
  Tests, die durch Copy-Paste kaputte Assertions geerbt haben?_

---

## Funde (laufend ergänzen)

> Format je Fund: `Chunk — Datei:Zeile — Schwere — Kurzbeschreibung`

_(noch keine Einträge)_

## Fortschritt

| Chunks gesamt | Erledigt | Offen |
|---|---|---|
| 17 | 0 | 17 |

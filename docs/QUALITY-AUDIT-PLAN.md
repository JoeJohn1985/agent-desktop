# Vollumfängliches Quality Audit — Plan

Dieser Plan zerlegt ein vollständiges Quality Audit der Agent-Desktop-Codebasis
in dieselben Chunks wie [`CODE-REVIEW-PLAN.md`](./CODE-REVIEW-PLAN.md), damit
beide Prüfungen bei Bedarf parallel oder nacheinander Stück für Stück über
mehrere Tage durchgeführt werden können.

Methodik orientiert sich an `.github/skills/quality-audit/SKILL.md`
(Projekt-eigener Audit-Skill), angepasst auf eine chunk-weise Durchführung
statt eines einzelnen Durchgangs.

## Wie dieser Plan benutzt wird

1. Beim ersten Mal: **Phase 1 (Architektur)** einmalig für das Gesamtprojekt
   durchführen (siehe unten, vor den Chunks).
2. Danach Chunk für Chunk: **Phasen 2–4** (Code-Qualität, Fehlerbehandlung,
   Testing) auf die Dateien des jeweiligen Chunks anwenden.
3. Am Ende (nach allen Chunks): **Phase 5 (Dokumentation)** und
   **Phase 6 (Wartbarkeit/Tech-Debt)** einmalig für das Gesamtprojekt.
4. Funde direkt unter dem jeweiligen Chunk eintragen, im Format aus
   `SKILL.md` (Schwere/Bereich/Datei/Beschreibung/Empfehlung).
5. Nach Abschluss aller Chunks + Phase 5/6: finalen Bericht nach dem
   Namensschema `Quality-Audit_Copilot-Desktop-App_<DATUM>_vollumfaenglich.md`
   in `C:\DEV\copilot\Copilot Desktop App\QA Berichte\` ablegen (Konsolidierung
   der hier gesammelten Funde), analog zu den bisherigen Audit-Berichten.

## Bewertungsmaßstab pro Chunk

Wie im Skill vorgegeben: konstruktiv bleiben, Stärken benennen, konkret mit
Datei:Zeile arbeiten, pragmatisch nach Aufwand/Nutzen priorisieren. Am Ende
jedes Chunks eine kurze Sterne-Bewertung (⭐–⭐⭐⭐⭐⭐) für Code-Qualität,
Fehlerbehandlung und Testabdeckung vergeben (fließt in die
Metriken-Übersicht des Abschlussberichts ein).

---

## Phase 1 — Architektur (einmalig, zu Beginn)

- [ ] Ordnerstruktur/Schichtentrennung bewerten (Main-Prozess vs. `src/`
  vs. `renderer/` vs. `renderer/modules/`) — ist die Trennung noch konsistent
  nach den Skills-/Agents-Erweiterungen dieser Session?
- [ ] Abgleich mit `docs/ARCHITECTURE.md` — ist die Dokumentation noch
  akkurat oder architektonisch bereits weitergezogen?
- [ ] Modul-Grenzen prüfen: Gibt es zirkuläre Abhängigkeiten zwischen
  `src/providers/*` und `main.js`? Zwischen `renderer/app.js` und
  `renderer/modules/*`?
- [ ] Bewertung: ⭐ bis ⭐⭐⭐⭐⭐

**Funde:** _(noch keine Einträge)_

---

## Chunks (Phasen 2–4 je Chunk)

### Backend (Hauptprozess & `src/`)

- [ ] **B1 — Bootstrap & Prozess-Lifecycle**
  `main.js` (Zeilen 1–444), `preload.js`, `src/shortcuts.js`,
  `src/main-helpers.js`, `src/logger.js`

- [ ] **B2 — ACP-Client & Copilot/Claude-Code-Backend**
  `src/acp-client.js` (1176 Zeilen), `main.js` Copilot-/Claude-Code-IPC
  (ca. Zeilen 445–537, 1833–1923)
  _Größte Einzeldatei im Backend — besonders auf Komplexität/God-Function
  achten (Phase 2: zyklomatische Komplexität, Verschachtelungstiefe)._

- [ ] **B3 — API-Provider-Backends**
  `src/providers/anthropic-provider.js`, `openai-provider.js`,
  `openai-compatible-provider.js`, `glm-provider.js`, `ollama-provider.js`,
  `gemini-provider.js`, `api-agent-client.js`, `agent-tools.js`,
  `session-store.js`, `index.js`, `main.js` `sendApiPrompt` + `providers:*`
  IPC

- [ ] **B4 — Lazy-Context-Architektur: Skills & Agents (Backend)**
  `src/scanners.js`, `src/agents.js`, `src/data-dir.js`,
  `src/providers/system-context.js`, `main.js` `skills:*`/`agents:*`/`mcp:*`
  IPC

- [ ] **B5 — Sessions & Verlauf (Backend)**
  `src/sessions.js`, `src/claude-code-transcript.js`,
  `src/named-sessions.js`, `main.js` `sessions:*` IPC

- [ ] **B6 — Preferences, Todos, Pricing, Model-Discovery, Secrets**
  `src/preferences.js`, `src/todos.js`, `src/pricing-source.js`,
  `src/model-discovery.js`, `src/secure-store.js`, `main.js`
  `todos:*`/`preferences:*`/`folders:*`/`instructions:*` IPC

- [ ] **B7 — Onboarding, Setup & Updater (Backend)**
  `main.js` Onboarding-/Setup-/Auth-IPC (ca. Zeilen 1452–1833),
  `src/updater.js`, `main.js` `updates:*` IPC

### Renderer (`renderer/`)

- [ ] **R1 — Tabs, Zustand & Sidebar**
  `renderer/app.js` Zeilen 1–1101, `initSidebar`

- [ ] **R2 — Chat-Stream & ACP-Event-Rendering**
  `renderer/app.js` Zeilen 1101–1937 (`sendMessage`, `handleSendResult`,
  `initCopilotIPC`)
  _Sehr lange Funktionen zu erwarten (Phase 2: Funktionslänge/
  Verschachtelung) — konkrete Refactoring-Vorschläge hier besonders wertvoll._

- [ ] **R3 — Provider/Modell/Modus/Kosten-Steuerung**
  `renderer/app.js` Zeilen 1937–2963

- [ ] **R4 — Sessions-UI & Verlaufsdarstellung**
  `renderer/app.js` Zeilen 3018–3523

- [ ] **R5 — Skills/Agents/MCP/Plugins-UI**
  `renderer/app.js` Zeilen 3523–4571

- [ ] **R6 — Settings, DevConsole, Shortcuts, Drag&Drop, Tooltips**
  `renderer/app.js` Zeilen 4571–6057

- [ ] **R7 — Onboarding & Update-Banner-UI**
  `renderer/app.js` Zeilen 6057–6952

- [ ] **R8 — Gemeinsame Renderer-Logic & Utils**
  `src/renderer-logic.js`, `src/utils.js`, `src/frontend-helpers.js`,
  `src/file-processing.js`, `renderer/modules/*.js`,
  `renderer/provider-icons.js`

- [ ] **R9 — Markup & Styles**
  `renderer/index.html`, `renderer/styles.css`
  _Phase 2 hier eher auf CSS-Wartbarkeit (Variablen-Nutzung, Duplikation,
  Spezifitäts-Kämpfe) und HTML-Semantik als auf klassische Code-Metriken
  anwenden._

### Übergreifend

- [ ] **X1 — Testsuite (volle Phase 4)**
  `__tests__/*` (45 Dateien), `e2e/*`, `jest.config.js`,
  `playwright.config.js`
  _Hier die vollständige Phase-4-Checkliste anwenden: Testarten, kritische
  Pfade ohne Abdeckung, Testqualität (aussagekräftige Assertions, AAA-Muster),
  konkrete Vorschläge für fehlende Testfälle. Ergänzt die chunk-weise
  Mini-Testbewertung um eine Gesamtsicht._
  _Ausgangspunkt: der Coverage-Screenshot des Nutzers zeigte spürbare Lücken
  bei den (damals neuen) Skills-/Agents-Features — prüfen, ob das inzwischen
  auch für die direkten API-Provider-Backends gilt (siehe Todo
  "Provider Testuabdeckung")._

---

## Phase 5 — Dokumentation (einmalig, am Ende)

- [ ] `README.md`, `docs/ARCHITECTURE.md`, `docs/USER-GUIDE.md`,
  `docs/KONZEPT_provider-angleichung.md`, `docs/known-issues.md`,
  `CHANGELOG.md`, `RELEASE_NOTES.md`, `AGENTS.md`,
  `.github/copilot-instructions.md`, `.github/CONTRIBUTING.md`
- [ ] Stichprobenartig: JSDoc-Kommentare in 2–3 Kern-Dateien pro Bereich
  (Backend/Renderer) auf Aktualität prüfen (veraltete/irreführende
  Kommentare sind schlimmer als keine)
- [ ] TODO/FIXME/HACK-Kommentare im Code sammeln und mit
  `todo/todos.md` abgleichen (Dopplungen vermeiden)
- [ ] Bewertung: ⭐ bis ⭐⭐⭐⭐⭐

**Funde:** _(noch keine Einträge)_

## Phase 6 — Wartbarkeit & Technische Schulden (einmalig, am Ende)

- [ ] `package.json`-Dependencies auf veraltete/ungenutzte Pakete prüfen
  (`npm outdated`, `depcheck` o. ä.)
- [ ] Build-/Lint-Tooling (`eslint.config.mjs`, `jest.config.js`,
  `playwright.config.js`) auf Vollständigkeit/Warnungen prüfen
- [ ] Bekannte Workarounds/Altlasten aus `docs/known-issues.md` und
  `todo/todos.md` gegen den tatsächlichen Code-Stand verifizieren (noch
  aktuell? bereits gelöst, aber Todo nicht abgehakt?)
- [ ] Dead Code identifizieren (unreferenzierte Exports, ungenutzte
  Funktionen — `eslint` mit `no-unused-vars` plus manuelle Grep-Stichprobe)
- [ ] Bewertung: ⭐ bis ⭐⭐⭐⭐⭐

**Funde:** _(noch keine Einträge)_

---

## Metriken-Übersicht (nach Abschluss aller Phasen ausfüllen)

| Metrik | Bewertung | Anmerkung |
|--------|-----------|-----------|
| Architektur | | |
| Code-Qualität | | |
| Testabdeckung | | |
| Dokumentation | | |
| Fehlerbehandlung | | |
| Wartbarkeit | | |

## Fortschritt

| Bereich | Erledigt | Offen |
|---|---|---|
| Phase 1 (Architektur) | 0/1 | 1 |
| Chunks (Phase 2–4) | 0/17 | 17 |
| Phase 5 (Dokumentation) | 0/1 | 1 |
| Phase 6 (Wartbarkeit) | 0/1 | 1 |

# Plan: Provider-Instructions (Direkt-API-Provider)

## Ziel

Eine Instructions-Funktionalität simultan zu Skills/Agents für die
**vier Direkt-API-Provider** (Anthropic, OpenAI, GLM, Ollama): ein
provider-eigener Ordner mit mehreren, benannten Instructions-Dateien, deren
Inhalt **vollständig** (nicht als lazy Index) in den System-Kontext eingebettet
wird.

Copilot und Claude Code sind **explizit nicht im Scope** — beide haben bereits
eine native, hierarchische Instructions-Discovery (`.github/copilot-instructions.md`
bzw. `CLAUDE.md`), die die jeweilige CLI selbst liest. Ein Duplikat hier würde
nur Verwirrung stiften.

## ⚠️ Revision nach Nutzer-Feedback (nach dem ersten Finisher-Durchgang)

Die erste Umsetzung hatte eine **Sidebar-Sektion mit Ein/Aus-Toggle pro
Instructions-Datei** (analog zu Skills/Agents' „aktiv/inaktiv"-Karten). Der
Nutzer wies das zurück: „Der Case, dass man eine Instruction ausschalten
möchte, gibt es quasi nicht — unnötiges UI-Element in einer eh schon vollen
Sidebar." Konsequenz — **kein Toggle, keine Sidebar-Sektion mehr**:

- Jede `.instructions.md`-Datei im Provider-Ordner ist **immer** aktiv. Eine
  Datei dort ablegen = aktivieren, entfernen = deaktivieren. Kein UI-Zustand,
  keine Persistenz eines „aktiv"-Sets nötig.
- Entfernt: Sidebar-Sektion (HTML), `renderInstructions`/`toggleInstruction`/
  `reloadInstructions`/`loadGlobalInstructionsForProvider` (app.js), die IPC
  `instructionSets:listProvider` (main.js + preload.js) — nichts davon wird
  noch gebraucht, da der Renderer die Instructions gar nicht mehr auflisten
  muss (rein serverseitig in `main.js` aufgelöst).
- Neue Funktion `readAllInstructions(dir, yamlParse)` in `src/instructions.js`
  ersetzt den alten ID-basierten `resolveActiveInstructions` — liest einfach
  **alle** Dateien im Ordner.
- `PROVIDER_CAPABILITIES.instructions`/die Settings-Feature-Matrix-Zeile
  **bleiben** (informativ in den Einstellungen, nicht in der Sidebar) — das
  ist die einzige verbleibende Stelle, an der ein Nutzer entdeckt, welche
  Provider das Feature unterstützen.

## Design-Entscheidungen (aktueller Stand)

- **Eager, nicht lazy**: anders als Skills/Agents (Index, Modell liest Datei
  selbst bei Bedarf) werden alle Instructions-Dateien im Provider-Ordner
  **komplett** in den System-Prompt eingebettet — ihr Sinn ist unbedingte
  Anwendung, keine Modell-Entscheidung.
- **Kein Toggle, keine Sidebar-UI** (siehe Revision oben) — die Datei-Präsenz
  im Ordner *ist* der Aktivierungszustand.
- **Dateiformat**: flache `<name>.instructions.md`-Dateien (wie
  `*.agent.md`, kein Ordner pro Datei wie bei Skills), YAML-Frontmatter
  (`name`, `description`) + Markdown-Body als Inhalt.
- **Scope-Konstante**: neue `INSTRUCTIONS_PROVIDERS = ['anthropic', 'openai',
  'glm', 'ollama']` (bewusst **ohne** `'claude-code'`, anders als
  `LAZY_CONTEXT_PROVIDERS`).

## Tasks

### Task 1: Backend — Datenpfad + Scanner

- [x] `src/data-dir.js`: `providerInstructionsDir(provider)` →
  `~/.agent-desktop/<provider>/instructions/` (analog `providerSkillsDir`).
- [x] Neue Datei `src/instructions.js` (analog `src/agents.js`):
  `scanInstructionsDirectory(dir, yamlParse)` → `{id, fileSlug, name,
  description}[]` sowie `readInstructionsContent(filePath)` (liest den vollen
  Markdown-Body **ohne** Frontmatter — für die Einbettung). **QA-Korrektur:**
  ein ursprünglich geplantes `scanInstructionsIndex(dirs, …)` (Mehrverzeichnis-
  Dedupe, analog `scanAgentsIndex`) wurde beim Finisher-Durchgang wieder
  entfernt — es hatte keinen produktiven Aufrufer (`resolveActiveInstructions`
  in main.js nutzt direkt `scanInstructionsDirectory` mit einem einzelnen
  Provider-Verzeichnis; anders als Skills/Agents gibt es aktuell keine
  Projekt-Ebene für Instructions). Bei Bedarf für eine spätere
  Projekt-Instructions-Erweiterung leicht nachrüstbar.

**Contract:**
```js
// src/instructions.js
function scanInstructionsDirectory(dir: string, yamlParse: Function): Array<{id, fileSlug, name, description}>
function readInstructionsContent(filePath: string): string  // body only, '' on error/missing
```
Fehlerbehandlung: fehlendes Verzeichnis → `[]`, kaputtes Frontmatter →
Eintrag überspringen + `console.warn` (exakt wie `scanAgentsDirectory`).

### Task 2: Backend — main.js Auto-Anlage (finaler Stand nach Revision)

- [x] Neue Konstante `INSTRUCTIONS_PROVIDERS` (siehe oben) neben
  `LAZY_CONTEXT_PROVIDERS`.
- [x] `ensureProviderContextDirs()` erweitert: `providerInstructionsDir(p)`
  für `p` in `INSTRUCTIONS_PROVIDERS` wird mit angelegt.
- ~~IPC-Handler `instructionSets:listProvider`~~ — **entfernt** (siehe
  Revision): ohne Sidebar-Liste braucht der Renderer keinen Weg mehr, die
  Instructions-Dateien aufzulisten. Alles läuft rein serverseitig in
  `main.js` über `resolveInstructions()`.

### Task 3: Backend — Einbettung in `composeSystemContext`

- [x] `src/providers/system-context.js`: `buildInstructionsBlock(
  instructions: Array<{name, content}>)` — verkettet die vollen Inhalte
  (Trenner `\n\n`, mit `## <name>`-Überschrift je Datei); Parametername
  nach der Revision von `activeInstructions` → `instructions` umbenannt
  (kein „aktiv"-Konzept mehr).
- [x] `composeSystemContext(opts)`: Parameter `opts.instructions` (bereits
  aufgelöste `{name, content}[]`, **alle** Dateien im Provider-Ordner) — wird
  **nach** dem bestehenden einzelnen `instr`-Block eingefügt (additiv,
  Basis-Layer bleibt bestehen), Überschrift `# Provider-Instructions`.
- [x] `main.js` `sendApiPrompt()`: `resolveInstructions(provider)` (liest via
  `readAllInstructions()` **alle** Dateien im Provider-Ordner, kein
  ID-Parameter mehr nötig) und übergibt sie an `composeSystemContext`.

**Contract (final):**
```js
buildInstructionsBlock(instructions: Array<{name: string, content: string}>): string  // '' wenn leer
```

### Task 4: Frontend — entfällt (siehe Revision)

Ursprünglich geplant: Sidebar-Sektion mit Card-Liste + Toggle (analog
Agents). **Auf Nutzer-Wunsch wieder entfernt** — kein Sidebar-Element, kein
`activeInstructionIds`-Feld in `copilot.chat.send(...)`, keine
`renderInstructions`/`toggleInstruction`/`reloadInstructions`/
`loadGlobalInstructionsForProvider`-Funktionen. Einzige verbleibende
Frontend-Spur: `PROVIDER_CAPABILITIES.instructions` +
`PROVIDER_FEATURE_META`-Zeile für die Settings-„Features"-Vergleichsmatrix
(informativ, kein interaktives Element).

### Task 5: Tests

- [x] `__tests__/instructions.test.js` (neu, analog `agents.test.js`):
  `scanInstructionsDirectory`, `readInstructionsContent`,
  `readAllInstructions` — 23 Tests, happy path, leeres/fehlendes Verzeichnis,
  kaputtes Frontmatter, BOM, CRLF, Größenlimit.
- [x] `__tests__/data-dir.test.js` erweitert: `providerInstructionsDir`.
- [x] `__tests__/providers.test.js` erweitert:
  `composeSystemContext({ instructions: [...] })` — mehrere Sets, additiv zur
  Basis-Instructions.md (Reihenfolge geprüft), leer → kein Block, Einträge
  ohne Inhalt gefiltert.
- Entscheidung: `buildInstructionsBlock` bleibt in `system-context.js` (wie
  geplant) — nutzt dieselbe Test-Infrastruktur wie `buildSkillsIndex`/
  `buildAgentsIndex`, kein Umzug nach `renderer-logic.js` nötig.

**Ergebnis (nach Revision):** 46 Suites, 1432 Tests grün. Lint: 0 Errors, nur
vorbestehende Warnungen (nicht aus dieser Änderung).

### Task 6: Doku

- [x] `docs/ARCHITECTURE.md`: `system-context.js`-Beschreibung aktualisiert;
  Hinweis ergänzt, dass Instructions **kein** eigenes IPC hat
  (`resolveInstructions()` läuft rein serverseitig).
- [x] `docs/USER-GUIDE.md`: eigener Abschnitt „### Instructions" unter
  „Features in detail" (nicht mehr unter „Sidebar", da kein Sidebar-Element
  mehr existiert).
- [x] `CHANGELOG.md` [1.3.0] + `package.json` Minor-Bump (1.2.15 → 1.3.0,
  neues Feature).
- [x] `RELEASE_NOTES.md` aktualisiert (war seit v1.0.0/v0.32.0 nicht
  gepflegt — Zwischenversionen bewusst nicht rückwirkend nachgetragen,
  vollständig im CHANGELOG dokumentiert).
- [x] `README.md`: Bullet in „Skills & Agents"-Liste + eigener
  `## Instructions`-Abschnitt.

## Finisher Report

### Gefundene Issues (1. Durchgang, vor der Revision)
- [🔵 Simplification] `scanInstructionsIndex` war spezifiziert (Task 1), hatte
  aber keinen produktiven Aufrufer — entfernt ✅.
- [🟡 Doku-Lücke] `README.md` dokumentierte Skills/Agents ausführlich, aber
  keine Instructions — ergänzt ✅.
- Path-Traversal-Check für die (inzwischen entfernte) `activeInstructionIds`:
  **kein Fund** — der Dateipfad wurde ausschließlich aus einem echten
  `fs.readdirSync`-Scan abgeleitet, nie direkt aus ungeprüftem Renderer-Input.
  Nach der Revision entfällt dieser Angriffsvektor ohnehin komplett — es gibt
  keinen Renderer-Input mehr, der in main.js ankommt.

### Revision (2. Durchgang, nach Nutzer-Feedback)
Kompletter Rückbau von Sidebar-UI + Toggle (siehe „⚠️ Revision" oben) —
Vereinfachung auf „Datei im Ordner = aktiv". Dabei mitgezogen:
- `buildInstructionsBlock`-Parameter umbenannt (`activeInstructions` →
  `instructions`), Heading `# Aktive Instructions` → `# Provider-Instructions`.
- `docs/ARCHITECTURE.md`/`README.md`/`docs/USER-GUIDE.md`/`CHANGELOG.md`/
  `RELEASE_NOTES.md` durchgehend auf den neuen, toggle-freien Stand gebracht.
- Test-Suite entsprechend angepasst (Heading-Text, Funktionsnamen).

### JSDoc-Qualität
- ✅ @param-Typen korrekt (stichprobenartig gegen echte Signaturen geprüft)
- ✅ @returns korrekt (`Promise<...>` bei den verbleibenden async Funktionen)
- ✅ Keine Merge-Marker

### ESLint
- ✅ Keine Errors (Syntax, undeclared vars) — `npm run lint`: 0 errors, nur
  vorbestehende Warnungen (keine aus dieser Änderung)

### Test-Ergebnis
- 1432 von 1432 Tests bestanden, 46/46 Suiten grün (`npm test -- --forceExit`)

### Status
✅ Feature bereit für Release (finaler, vereinfachter Stand) —
**Commit/Push weiterhin nicht durchgeführt**: der Nutzer hat explizit
Planner/Developer/Tester/QA-Finisher benannt, nicht den Release-Agent.
Freigabe zum Committen steht noch aus.

## Nicht im Scope

- Kein „neue Instructions-Datei anlegen"-Dialog in der App — der Nutzer legt
  die Datei manuell im Provider-Ordner an; sie ist damit automatisch aktiv.
- Kein Support für Copilot oder Claude Code (native Mechanismen ausreichend).
- Keine Lazy-Index-Variante für Instructions (bewusste Design-Entscheidung).
- **Kein Ein/Aus-Toggle, keine Sidebar-UI** (nach Revision — siehe oben).
- Keine Rückwirkung auf die bestehende einzelne `copilot-instructions.md`
  (bleibt als globaler Basis-Layer für alle Provider bestehen, additiv zu
  den neuen provider-scoped Instructions).

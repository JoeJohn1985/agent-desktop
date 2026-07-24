# Changelog

## [1.7.1] - 2026-07-25

### Removed
- **Reverted the global `:focus-visible` ring** added in 1.7.0's polish pass
  — on reflection it made keyboard/programmatic focus (e.g. the chat input
  auto-focusing on tab switch) stand out more than wanted. Back to relying
  on each element's own existing `:focus` styling (or lack thereof).

## [1.7.0] - 2026-07-24

### Added
- **Visual polish pass** across the renderer:
  - **Keyboard focus rings**: a global `:focus-visible` rule (box-shadow, so
    it can't be beaten by the ~15 scattered `outline: none` rules on
    individual `:focus` selectors) gives every interactive element visible
    keyboard-focus feedback — previously only 13 `:focus` rules existed
    against 111 `:hover` ones.
  - **Sidebar section collapse/expand now animates** (`max-height`/`opacity`
    transition) instead of an instant `display` toggle.
  - **Toast notifications now stack** in a dedicated fixed container
    (`#toastStack`, flex column) instead of rendering on top of each other at
    the same fixed position when several fire in quick succession.
  - **Unified empty-state markup** (`emptyStateHtml()`: icon + text, shared
    `.sidebar__empty` styling) for Todos, Sessions, Images, and the
    session-tools popup, replacing each spot's own hand-rolled inline-styled
    placeholder.
  - **Generic button-busy spinner** (`withButtonBusy()`) applied to the
    provider API key Save/Delete buttons, so slow IPC calls show visible
    feedback instead of looking unresponsive.
  - Deliberately did *not* add a skeleton-loading state for manual list
    reloads: the splash screen (1.6.7) already covers the first load, and
    reloads already keep the previous list visible (with the reload button's
    existing spin) rather than flashing empty — a skeleton would have
    addressed a gap that no longer exists.
  - Deliberately did *not* attempt a tab-switch content crossfade: the
    stream-output panes toggle via `display: none`/`block`, which can't be
    smoothly transitioned without restructuring every open tab's pane to
    stay mounted (absolute-positioned) simultaneously — too much risk
    (scroll position, per-tab state) for a cosmetic gain.

## [1.6.7] - 2026-07-24

### Added
- **App loading splash screen.** Startup used to visibly stagger — Skills,
  Agents, MCP, Sessions, and Images each popped into the sidebar one by one
  as their individual IPC round trips resolved (`initDataLoad()` awaits them
  sequentially). A full-window splash (icon + spinner, matching the current
  theme) now covers the app from first paint and only fades out once the
  entire startup sequence — including tab restore/creation and all `initXxx()`
  wiring — has finished, so everything appears at once instead of piecemeal.
  Wrapped in `try/finally` so the splash always gets dismissed even if a
  startup step throws.

## [1.6.6] - 2026-07-24

### Changed
- **Ollama's settings tab now only appears once a base URL is saved**,
  instead of always. Ollama is keyless, so `getConnectedProviderConfigs()`
  used to treat it as unconditionally "connected" — the tab showed up
  regardless of whether Ollama was even installed. A saved base URL (Provider
  tab, defaults to `http://localhost:11434/v1`) is now the equivalent signal
  a stored API key is for the other direct-API providers.

## [1.6.5] - 2026-07-24

### Fixed
- **"Nach Updates suchen" reported "up to date" even when `origin/main` had
  newer commits to pull.** Root cause: it compared the local `package.json`
  version against the newest *release tag* on the remote — but this repo's
  version has been bumped on nearly every commit without a matching tag ever
  being created (only `v1.0.0`/`v1.1.0` exist while `package.json` was
  already at 1.6.4), so "no newer tag" kept reporting no update regardless of
  how many commits actually landed on `main`. Rewrote `checkForUpdate`
  (`src/updater.js`) to fetch and compare `HEAD` against `origin/main`
  directly (`git merge-base --is-ancestor`) — the same fast-forward condition
  `applyUpdate`'s `pull --ff-only` actually needs, so it can't go stale the
  same way tags did. `latestVersion` is still shown for display, now read
  straight from the remote's `package.json` instead of a tag.
  Also fixed a second, previously untested bug this surfaced: applying an
  update whose commits touch `package.json`/`package-lock.json` triggers an
  `npm install` — on Windows that shells out to `npm.cmd`, a batch file Node
  refuses to spawn without `shell: true` (throws `EINVAL`), so every real
  update with changed dependencies would have failed at the apply step.
  Replaced the release-tag pure-function tests with real-git-repo tests
  (`__tests__/updater.test.js`) covering both the "newer commits, no tag"
  scenario and a full apply/pull round trip.

## [1.6.4] - 2026-07-23

### Changed
- **Sidebar Todos section always visible**, even with no active
  working directory or zero todos (shows its existing empty state
  instead of disappearing entirely). Previously it was hidden whenever
  `loadTodos()` ran with no cwd.

## [1.6.3] - 2026-07-23

### Changed
- **Features matrix now shows Copilot and Claude Code as supporting
  Instructions.** Previously both showed unchecked even though Copilot always
  had an editable `copilot-instructions.md` and Claude Code just got its own
  `CLAUDE.md` editor — the flag had specifically tracked the direct-API
  providers' multi-file toggle system, not native single-file editors, which
  read as "doesn't have instructions" at a glance. Flipped both to `true` and
  reworded the matrix hint to cover both mechanisms.
  Fixed a bug this surfaced: `buildProviderConfigPanelHtml` used the same
  `instructions` flag to decide whether to render the direct-API providers'
  multi-file `instructionsDir` folder row — Claude Code would now have
  incorrectly gotten that row too (it only has the single native file, added
  as its own dedicated block). Excluded `claude-code` from that specific
  check.

## [1.6.2] - 2026-07-23

### Fixed
- **Settings dialog too narrow** after the new per-provider tabs/panels
  (denylists, Claude Code instructions editor, …) added more content —
  the fixed 720px width from the previous tab-overflow fix was already
  cramped again. Made the dialog scale with the app window instead of
  staying fixed: `width: 80vw` (`min-width: 720px`, `max-width: 1100px`
  so it neither shrinks below the tab bar's needs on a small window nor
  grows absurdly wide on a huge one).

## [1.6.1] - 2026-07-23

### Added
- **Claude Code Instructions editor**, matching Copilot's. Claude Code has its
  own native global instructions file (`~/.claude/CLAUDE.md`, analogous to
  Copilot's `copilot-instructions.md`) but previously had no in-app editor for
  it — added `instructions:readClaudeCode`/`writeClaudeCode` IPC handlers and
  a "📝 Instructions" editor in the Claude Code settings tab, reusing the same
  editor modal as Copilot's (`openInstructionsEditor` now takes an optional
  title/write-function so both share the one component). Unlike Copilot's,
  the path is fixed (not user-configurable), matching how Claude Code's own
  `~/.claude/skills/` folder is already presented as read-only in that tab.
  Also fixed a stale doc claim that direct-API providers' instructions folder
  is "additive" to Copilot's global instructions file — it isn't, since the
  1.4.0 provider-scoped instructions rework (`docs/USER-GUIDE.md`).

## [1.6.0] - 2026-07-23

### Changed
- **Settings auto-save**: removed the big "💾 Speichern (Neustart erforderlich)"
  buttons on the App and Copilot tabs. CWD/Bilder/Sessions/Skills/Agents/
  Instructions-file now save individually the moment they're picked (each
  `folders:save` call merges just that one key), showing a toast instead of
  requiring an explicit click. Fixed a latent bug this surfaced along the
  way: `folders:save` used to **replace** the whole folder config with
  whatever the caller sent instead of merging — saving on the App tab
  silently wiped out whatever the Copilot tab had saved, and vice versa.
  "🔄 Auf Standard zurücksetzen" now goes through a dedicated `folders:reset`
  IPC handler (the one action that intentionally does NOT merge).
- **Tool-Verbote (Shell-Tool deny lists) are now fully independent per
  provider** instead of one shared global list. Each of Copilot/Anthropic/
  OpenAI/GLM/Ollama gets its own list in its own settings tab (Gemini has no
  shell tool; Claude Code has its own approval mechanism — neither gets one,
  same as before). A one-shot migration seeds every one of those providers
  with a copy of the old global list the first time the app runs post-upgrade.
  New `denylist` flag in `PROVIDER_CAPABILITIES`, surfaced in the Features
  comparison matrix.

## [1.5.2] - 2026-07-23

### Fixed
- **Settings tab bar overflowed the dialog** — the last tab ("Tastenkürzel")
  was cut off, and several labels ("Claude Code", "Google Gemini", "Ollama
  (lokal)") wrapped to two lines, because the dialog kept its original fixed
  620px width from before the settings restructuring added several new,
  longer-named tabs (one per connected provider). Widened the dialog
  (`renderer/styles.css`, `.overlay__dialog--settings`) to 720px, switched the
  tab bar to `flex-wrap` so any future growth in provider count degrades to a
  second row instead of ever cutting text off again, and shortened the
  dynamically-generated provider tab labels specifically (`Google Gemini` →
  `Gemini`, `Ollama (lokal)` → `Ollama`, etc. — a new `SETTINGS_TAB_LABELS`
  map in `renderer/app.js`, scoped to the tab bar only; the model
  dropdown/provider list keep their full descriptive `PROVIDER_LABELS`).

## [1.5.1] - 2026-07-22

### Fixed
- **`src/providers/session-store.js` still hardcoded the pre-rename
  `~/.copilot-desktop/api-sessions/` path** instead of `~/.agent-desktop/`
  — a leftover the "copilot-desktop → agent-desktop" identity rename missed
  (`docs/ARCHITECTURE.md` already documented the *intended* new-name path,
  making this a docs/code mismatch, not just a stale comment). Added
  `apiSessionsDir()`/`migrateApiSessions()` in `src/data-dir.js` (mirroring
  the existing `migrateClaudeCodeSkills()` pattern) and switched
  `session-store.js` to the new path; the migration runs once at startup,
  merge-only (never overwrites), so any direct-API session history saved
  under the old path keeps working.

## [1.5.0] - 2026-07-22

### Added
- **Gemini session save/resume**, matching Copilot and Claude Code. The
  underlying persistence (`ApiAgentClient`'s `newSession`/`loadSession`/
  `#persist()` round-tripping full conversation history through
  `session-store.js`, plus `renderApiHistory()`'s Gemini-shape branch) already
  existed for every direct-API provider but was hidden behind
  `PROVIDER_CAPABILITIES.<provider>.sessions = false`; flipped it on for
  `gemini` specifically (`renderer/app.js`). This unlocks the tab-rename (✎) →
  sidebar "Sessions" list → reopen flow already used by the other providers.
  Also fixed a rough edge surfaced while wiring this up: Gemini's per-tab
  search/files tool-mode toggle lived only on the in-memory tab object, so
  resuming a session in a fresh tab would silently reset to "Recherche"-mode
  even mid-conversation. Added `ApiAgentClient#_persistedExtras()` (overridden
  by `GeminiProvider` to return `{ geminiMode }`), merged into the
  session-store payload on every persist and round-tripped back through
  `providers:loadSessionHistory` (now returns `{ messages, geminiMode }`
  instead of a bare array) so the resumed tab's mode toggle matches what was
  active when the session was last used.

## [1.4.2] - 2026-07-22

### Fixed
- **Marketplace-/Plugin-Skills wurden von Copilot im laufenden Gespräch
  nicht mehr erkannt.** Ursache empirisch verifiziert (per direktem
  ACP-Probe-Vergleich gegen `copilot -p`): `copilot --acp` — der Modus, in
  dem diese App Copilot immer betreibt — gibt Skills aus installierten
  Marketplace-Plugins (`~/.copilot/installed-plugins/…/skills/`) nie an das
  Modell weiter, sondern nur Builtin- und User-Skills. Der normale
  interaktive/`-p`-Modus der CLI hat diese Lücke nicht.
  Workaround (Vorschlag des Users): `syncMarketplaceSkills()`
  (`src/plugin-skill-mirror.js`) spiegelt installierte Plugin-Skills bei
  jedem `skills:list` in Copilots eigenen `~/.copilot/skills/`-Ordner —
  genau den Ordner, den `--acp` bereits korrekt liest. Ein Manifest merkt
  sich, welche Ordnernamen die App selbst angelegt hat, damit spätere
  Syncs veraltete Spiegel (deinstalliertes Plugin) wieder entfernen und
  aktuelle (Plugin-Update) auffrischen können, ohne je einen gleichnamigen,
  selbst angelegten User-Skill zu überschreiben oder zu löschen. Zusätzlich
  lädt die Marketplace-UI nach Install/Uninstall/Update jetzt automatisch
  die Skill-Liste neu, damit neue Plugin-Skills ohne App-Neustart sofort
  wirken.

## [1.4.1] - 2026-07-21

### Removed
- **Admin-Tool-Verbote komplett entfernt.** Diese Funktion (ein zweites,
  angeblich "unveränderbares" Deny-Tool-Set neben der normalen globalen
  Deny-Liste, nur im Entwicklermodus sichtbar) hatte keinen praktischen
  Nutzen mehr für eine Desktop-App ohne Mehrbenutzer-/Admin-Kontext und
  wurde auf expliziten Wunsch entfernt: `getAdminDeniedTools()`/
  `addAdminDeniedTool()`/`removeAdminDeniedTool()`/`renderAdminDeniedTools()`
  in `renderer/app.js`, der `#settAdminToolsGroup`-Block in
  `renderer/index.html`, der `adminDeniedTools`-Default in
  `src/preferences.js` sowie die Doku-Erwähnung in `docs/ARCHITECTURE.md`.
  Die Merge-Logik für den effektiv angewendeten Deny-Tool-Set
  (`renderer/app.js`, `renderer/modules/session-tools.js`) berücksichtigt
  jetzt nur noch globale Deny-Liste + Session-Deny-Liste.

## [1.4.0] - 2026-07-21

### Changed
- **Einstellungen grundlegend umgebaut**, um die Multi-Provider-Architektur
  abzubilden statt der ursprünglichen, Copilot-only gewachsenen Struktur.
  Vorher waren „Konfiguration"/„Ordner" ein Sammelsurium aus global gedachten,
  tatsächlich aber inkonsistent providerabhängigen Einstellungen (z. B. galt
  „Alle Pfade erlauben" nur für Copilot, „Manuelle Bestätigung" hatte für
  Claude Code und Direkt-API-Provider gar keine Wirkung) — ohne dass das
  irgendwo sichtbar war.
  - **Neue Reiter-Struktur**: „App" (Theme/Sound/CWD/Bilder/Standard-Provider/
    globale Deny-Liste/Updates/Entwicklermodus), „Provider" (API-Keys,
    unverändert), **„Copilot"** (eigener, immer vorhandener Reiter mit allem
    Copilot-Spezifischen: Sessions-/Skills-/Agents-Ordner, Instructions-Editor,
    „Alle Pfade erlauben", Zusätzliche Ordner, Manuelle Bestätigung), **ein
    Reiter pro tatsächlich verbundenem weiteren Provider** (Claude Code, sobald
    die CLI installiert ist; Anthropic/OpenAI/GLM/Ollama/Gemini, sobald ein Key
    hinterlegt ist), „Features" (Matrix, unverändert), „Tastenkürzel"
    (unverändert). Der „Ordner"-Reiter entfällt komplett.
  - Jeder Provider-Reiter zeigt nur, was für diesen Provider tatsächlich gilt:
    Standard-Modell überall; Skills-/Agents-/Instructions-Ordner nur wo
    unterstützt (`providerSupports()`) — z. B. Gemini zeigt nur das
    Standard-Modell, Claude Code zeigt seinen **nativen** `~/.claude/skills/`
    (read-only, „Ordner öffnen"-Button) statt eines app-eigenen Pfads.
  - **Instructions für Direkt-API-Provider getrennt**: `sendApiPrompt()`
    übergibt die globale `copilot-instructions.md` nicht mehr additiv an
    `composeSystemContext()` — Anthropic/OpenAI/GLM/Ollama nutzen jetzt
    ausschließlich ihren eigenen `~/.agent-desktop/<provider>/instructions/`-
    Ordner. Die globale Datei bleibt Copilots eigene, native Instructions-Datei.
  - Neue IPC `folders:openPath` (öffnet einen beliebigen Pfad im Explorer,
    legt ihn bei Bedarf an) und `folders:providerPaths` (liefert die
    Skills-/Agents-/Instructions-Pfade eines Providers für die Anzeige).
  - Tab-Umschaltung auf Event-Delegation umgestellt, damit die dynamisch
    erzeugten Provider-Reiter ohne zusätzliche Verdrahtung funktionieren.
  - Bekannte, bewusst nicht in diesem Zug behobene Inkonsistenz (siehe Doku):
    Direkt-API-Provider haben weiterhin keinen echten Freigabe-Mechanismus für
    Tool-Aufrufe (der „Manuelle Bestätigung"-Schalter existiert nur bei
    Copilot) — als eigenes Folgeprojekt vorgemerkt.

## [1.3.4] - 2026-07-21

### Fixed
- **Skills wurden für Claude Code doppelt geladen.** Claude Code entdeckt
  `SKILL.md`-Dateien unter `~/.claude/skills/` **selbst** — empirisch
  bestätigt (ein dort abgelegter Test-Skill wurde aus einem völlig
  unbeteiligten Arbeitsverzeichnis erkannt, also user-weit, nicht nur
  projektlokal). Unsere App injizierte parallel dazu einen eigenen Lazy-Index
  aus `~/.agent-desktop/claude-code/skills/` — ein zweiter, verwirrender
  Ablageort für dieselbe Funktion, der zudem doppelt in den Kontext geladen
  wurde.
  - `providerSkillsDir('claude-code')` löst jetzt direkt zu Claudes nativem
    `~/.claude/skills/` auf (`claudeCodeNativeSkillsDir()` in
    `src/data-dir.js`) — betrifft automatisch auch die Sidebar-Skill-Liste
    (`skills:listProvider`).
  - Die Skills-Injektion in den ersten Prompt einer neuen Claude-Code-Session
    (`main.js`) entfällt komplett — nur die Agents-Injektion (echtes,
    verschiedenes Feature, siehe unten) bleibt bestehen; projektlokales
    `.github/skills/` wird weiterhin injiziert (kein Claude-natives Äquivalent).
  - Einmalige, nicht-destruktive Migration (`migrateClaudeCodeSkills()`):
    bereits vorhandene Skills aus dem alten `~/.agent-desktop/claude-code/skills/`
    werden beim Start automatisch nach `~/.claude/skills/` kopiert, damit
    nichts Bestehendes verloren geht.
  - **Agents bleiben unverändert** — Claude Codes natives „Agent"-Konzept
    (isolierte, delegierte Unteraufträge über das Agent-/Task-Tool) ist ein
    anderes Feature als unser App-eigener Persona-Wechsel innerhalb derselben
    Konversation; keine Dopplung.
  - `docs/USER-GUIDE.md` korrigiert (nannte fälschlich `~/.agent-desktop/…`
    auch für Claude Code). 5 neue/angepasste Tests.

## [1.3.3] - 2026-07-20

### Fixed
- **Abo-Reset-Countdown im Tooltip war eingefroren.** `formatSubscriptionUsage()`
  berechnet „Reset in …" relativ zum Aufrufzeitpunkt, aber
  `updateSubscriptionUsageDisplay()` wurde nur bei neuen Nutzungsdaten (nach
  jedem Turn) aufgerufen — dazwischen blieb die Anzeige stehen und stimmte
  nach wenigen Minuten nicht mehr. Neuer `initSubscriptionUsageTicker()`
  rendert die Anzeige alle 30 s aus den bereits vorhandenen Daten neu (kein
  zusätzlicher `/usage`-Aufruf) — der Countdown zählt jetzt sichtbar runter.

## [1.3.2] - 2026-07-18

### Fixed
- **Claude-Code-Tool-Aufrufe (z. B. `edit`) zeigten trotz des `file_path`-Fixes
  (1.3.1) weiterhin keine Argumente.** Tieferliegende Ursache: Claude Codes
  ACP-Adapter streamt große Tool-Inputs (z. B. Edits `old_string`/
  `new_string`) inkrementell und schickt dafür **zwei** `tool_call_update`-
  Events — eines, um den ausstehenden Aufruf zu „verfeinern", sobald der
  Input fertig gestreamt ist (noch **kein** `status`-Feld, Tool ist noch
  nicht gelaufen), und eines für den echten Abschluss (`status: 'completed'`/
  `'failed'`). Unser Code behandelte **beide** identisch als „fertig" und
  übernahm dabei nur die (oft noch unvollständigen) Argumente vom allerersten
  `tool_call`-Moment — der eigentliche vollständige Input aus dem Verfeinerungs-
  Event wurde nie an den Renderer weitergereicht.
  - `src/acp-client.js`: neue `#toolArgs`-Map hält den jeweils aktuellsten
    Input pro Tool-Aufruf nach; ein `tool_call_update` **ohne** `status` löst
    jetzt ein neues `tool.execution_update`-Event aus (aktualisiert nur die
    Anzeige, ohne den Aufruf als abgeschlossen zu markieren); der echte
    Abschluss (`status` vorhanden) trägt jetzt die verfeinerten Argumente.
  - `renderer/app.js`: neuer `tool.execution_update`-Fall aktualisiert die
    ausstehende Zeile in-place; `tool.execution_complete` bevorzugt jetzt die
    direkt am Event mitgelieferten Argumente.
  - Betrifft nur Claude Code — Copilot und die Direkt-API-Provider streamen
    ihre Tool-Inputs nicht inkrementell und waren nicht betroffen.
  - 2 neue Tests in `__tests__/acp-client.test.js` (Refine-ohne-Status,
    Refine-gefolgt-von-Abschluss).

## [1.3.1] - 2026-07-17

### Fixed
- **Tool-Aufrufe der Direkt-API-Provider (Anthropic/OpenAI/GLM/Ollama/Gemini)
  zeigten ein generisches 🔧-Icon und den rohen Tool-Namen** statt Icon +
  verständlichem Label. Ursache: Deren eigenes Tool-Set
  (`src/providers/agent-tools.js`: `shell`, `read_file`, `write_file`,
  `edit_file`, `list_dir`) wird — anders als bei Copilot/Claude Code, deren
  ACP-`kind`-Werte über `AcpClient.#mapToolKind()` übersetzt werden —
  unverändert durchgereicht und matchte die Icon-/Label-Tabelle nicht (nur
  `glob`/`grep` trafen zufällig zu). `TOOL_ICONS`/`TOOL_DISPLAY_NAMES` um die
  fünf fehlenden Namen ergänzt. 6 neue Tests in `renderer-logic.test.js`.

## [1.3.0] - 2026-07-17

### Added
- **Provider-Instructions** — Instructions-Funktionalität simultan zu
  Skills/Agents, aber **nur für die vier Direkt-API-Provider** (Anthropic,
  OpenAI, GLM, Ollama). Copilot und Claude Code bleiben bewusst außen vor:
  beide haben bereits eine eigene, native, hierarchische Instructions-
  Discovery (`.github/copilot-instructions.md` bzw. `CLAUDE.md`), die die
  jeweilige CLI selbst liest — ein App-verwalteter Zweitmechanismus würde nur
  Verwirrung stiften.
  - Neuer provider-eigener Ordner `~/.agent-desktop/<provider>/instructions/`
    mit flachen `*.instructions.md`-Dateien (YAML-Frontmatter `name`/
    `description` + Markdown-Body), analog `*.agent.md`.
  - **Anders als Skills/Agents (Lazy-Index — das Modell liest die Datei nur
    bei Bedarf selbst) wird der Inhalt jeder Datei im Ordner bei jeder
    Nachricht vollständig in den System-Prompt eingebettet** — ihr Sinn ist
    unbedingte Anwendung, keine Modell-Entscheidung. Ergänzt (additiv) die
    bestehende globale `copilot-instructions.md`/`AGENTS.md`-Basisebene.
  - **Kein Ein/Aus-Toggle, keine Sidebar-Sektion**: Eine Datei im Ordner
    abzulegen aktiviert sie, sie zu entfernen deaktiviert sie — das ist der
    gesamte Aktivierungsmechanismus. Alles rein serverseitig in `main.js`
    aufgelöst, ohne Renderer-Roundtrip; die Settings-„Features"-Matrix zeigt
    weiterhin an, welche Provider das unterstützen.
  - Neue Module: `src/instructions.js` (Scanner, Content-Reader,
    `readAllInstructions()`), `buildInstructionsBlock()` in
    `src/providers/system-context.js`, `resolveInstructions()` in `main.js`.
  - 23 neue Tests in `__tests__/instructions.test.js` + Erweiterungen in
    `data-dir.test.js`/`providers.test.js` — 46 Suiten, 1432 Tests grün.

### Fixed
- **Tool-Aufrufe von Claude Code zeigten keine Argumente** (z. B. `edit` ohne
  erkennbaren Dateipfad in der Session-Leiste). Ursache: Claude Codes eigene
  Read/Edit/Write/NotebookEdit-Tools melden den Pfad als `file_path`, unser
  `toolArgFullText()`/`formatToolArgs()` kannten aber nur `path` (Copilots
  Schema). `Bash` (`command`) und `Glob`/`Grep` (`pattern`) waren bereits
  korrekt abgedeckt — betroffen war ausschließlich die Pfad-basierten Tools.
  4 neue Tests in `__tests__/renderer-logic.test.js`.

## [1.2.15] - 2026-07-13

### Fixed
- **Chat-Export (Markdown) verlor stillschweigend alle Tool-Aufrufe.**
  `exportChat()` suchte noch nach der Klasse `stream-tool-call`, die die
  Tool-Aufruf-Konsolidierung (1.2.11) durch `stream-tool-result` ersetzt hat —
  seitdem fehlten Tool-Zeilen im exportierten `.md` ohne Fehlermeldung. Fund
  aus der Code Review über die letzten Entwicklungen. Export liest die
  Argumente jetzt aus `.stream-tool-result__preview`.
- Verwaiste `.stream-tool-call*`-CSS-Regeln entfernt (keine Erzeuger mehr seit
  1.2.11).

### Changed
- Tests: `costPeriod()`s ISO-Kalenderwochen-Berechnung wird jetzt an zwei
  Jahreswechsel-Grenzfällen exakt geprüft (KW 53 vs. KW 1), statt nur lose per
  Regex auf das Label-Format.

## [1.2.14] - 2026-07-13

### Added
- **Kostenübersicht: Monat-Ansicht + Vergangenheits-Navigation.** Die
  Kostenseite bot bisher nur ein rollierendes „letzte 7 Tage"/„letzte 24h"-
  Fenster ohne Möglichkeit, in die Vergangenheit zu blättern. Neu:
  - Dritter Umschalter **Monat** (neben Tag/Woche), als Tages-Balken über den
    Kalendermonat.
  - **◀ / ▶-Navigation** mit Perioden-Label (z. B. „KW 29 · 13.–19. Juli",
    „Juli 2026", „Gestern"); ▶ ist deaktiviert auf der aktuellen Periode.
  - Alle drei Bereiche sind jetzt **kalender-ausgerichtet** statt rollierend:
    Tag = lokale Mitternacht bis Mitternacht, Woche = Montag–Sonntag, Monat =
    1. bis Letzter.
  - Neue reine, unit-getestete Funktion `costPeriod()` in
    `src/renderer-logic.js` berechnet Fenstergrenzen, Bucket-Größe/-Anzahl und
    das deutsche Label für Tag/Woche/Monat + Offset.
- `costLog`-Cap von 5.000 auf **50.000 Einträge** angehoben (≈ 1 Jahr bei
  aktueller Nutzung), damit Vergangenheits-/Monatsansichten nicht vorzeitig
  an fehlenden Altdaten scheitern.

## [1.2.13] - 2026-07-13

### Fixed
- **Code-Coverage-Abfrage schlug mit „Unterminated string in JSON" fehl.**
  `tests:coverage` (und `tests:run`/`tests:e2e`) riefen `execFile` ohne
  `maxBuffer`-Option auf — Node begrenzt `stdout` dabei standardmäßig auf 1 MB.
  Der Coverage-Report (volle `coverageMap` über alle Testdateien) sprengt das
  bei der aktuellen Suitengröße, wodurch `stdout` mitten im JSON-String
  abgeschnitten wurde. `maxBuffer` ist jetzt für alle drei IPC-Handler auf
  64 MB gesetzt.

## [1.2.12] - 2026-07-09

### Added
- **Zuletzt gewählter Modus wird pro Provider gemerkt.** Bei Providern mit
  Modus-Auswahl (Copilot, Claude Code, Anthropic) wird der zuletzt gewählte
  Modus in den Preferences gespeichert (`lastModes` je Provider) und für neue
  Tabs wiederhergestellt. Die Validierung (`pickSavedMode()`, unit-getestet)
  verwirft einen nicht mehr angebotenen Modus; bei ACP-Providern, deren Modi
  erst nach dem Verbinden entdeckt werden, wird der gespeicherte Modus vertraut
  und ggf. durch `modes_available` korrigiert.

## [1.2.11] - 2026-07-09

### Fixed
- **Tool-Aufrufe wurden doppelt angezeigt** — einmal kurz beim Start
  (`.stream-tool-call`) und einmal im Detail beim Abschluss
  (`.stream-tool-result`). Beide sind jetzt zu **einem** Element pro
  `toolCallId` zusammengefasst: Beim Start rendert eine „läuft"-Zeile
  (⏳ + Name + Argumente), die `tool.execution_complete` an Ort und Stelle zu
  ✓/✗ finalisiert; das Ergebnis bleibt zum Aufklappen darunter. Die
  eingeklappte Zeile zeigt jetzt die Argumente (identifiziert den Aufruf), nicht
  mehr die Ergebnis-Vorschau. Bei „keine Berechtigung" wird die Pending-Zeile
  entfernt und durch die 🔐-Meldung ersetzt.

## [1.2.10] - 2026-07-09

### Changed
- Tests: Reset-Countdown-Fallbacks abgedeckt (kein Zeitzonen-Zusatz → Lokalzeit;
  unbekannte Zeitzone → `Intl` wirft → Lokalzeit). Damit ist die neue
  Abo-Nutzungslogik in `renderer-logic.js` ~99 % zeilenabgedeckt.

## [1.2.9] - 2026-07-09

### Changed
- Aufräumen: `refreshSubscriptionUsage()` setzte `tab._lastUsageText`, das für
  Subscription-Tabs (Claude Code) nie gelesen wird (der einzige Leser ist der
  Nicht-Abo-Zweig der Anzeige-Aktualisierung). Der tote Schreibzugriff wurde
  entfernt. (Fund 4 aus der Code Review.)

## [1.2.8] - 2026-07-09

### Fixed
- **Reset-Countdown ist jetzt zeitzonenrichtig.** Der `/usage`-Reset nennt seine
  Zeitzone (z. B. `(Europe/Berlin)`); bisher wurde die Wanduhrzeit in der
  Maschinen-Zeitzone interpretiert, was den Countdown um den Offset verschoben
  hätte, wenn System- und Account-Zone auseinanderfallen. `parseResetTextToMs()`
  wertet die genannte Zeitzone jetzt via `Intl.DateTimeFormat` aus (inkl.
  Sommer-/Winterzeit, mit Fallback auf Lokalzeit bei fehlender/unbekannter Zone).
  (Fund 2 aus der Code Review.)

## [1.2.7] - 2026-07-09

### Fixed
- **Reset-Countdown funktionierte nicht bei vollen Stunden.** `/usage` gibt
  Resets auf der vollen Stunde ohne Minuten aus (z. B. `resets Jul 10, 3pm`
  statt `3:29am`); `parseResetTextToMs()` verlangte aber `H:MM` und fiel dann
  auf das absolute Datum zurück. Minuten sind jetzt optional (Default `:00`), so
  dass der Countdown auch für volle Stunden greift. (Fund aus der Code Review.)

## [1.2.6] - 2026-07-09

### Added
- **Abo-Limits mit echten Prozentwerten.** Der `rate_limit_event`-Stream liefert
  zwar Fenster + Status + Reset, aber meist keinen Prozentwert. Die konkrete
  Auslastung steht im `/usage`-Output, den die App nach jedem Turn ohnehin
  abruft. Neuer reiner, unit-getesteter Parser `parseUsageWindows()` liest die
  Zeilen `Current session: … % used` und `Current week (all models): … % used`
  (inkl. modellspezifischer Wochen-Buckets) und speist sie in die Anzeige. Die
  Session-Leiste zeigt jetzt z. B. `Abo · 5 Std. 35 % · Woche 3 %` — dieselben
  Werte wie die offizielle Claude-App. Reset-Zeitpunkte je Fenster stehen im
  Tooltip; modellspezifische Buckets erscheinen dort ebenfalls.
  Die Resets werden als **Live-Countdown** angezeigt (z. B. „Reset in 3 Std.
  59 Min." bzw. „Reset in 6 Tagen 16 Std.") statt als absolutes Datum — der
  `/usage`-Zeitstempel wird dafür geparst (`parseResetTextToMs`) und über
  `formatDurationDe()` formatiert.

### Fixed (behebt, dass die %-Anzeige gar nicht erschien)
- Für Subscription-Provider (Claude Code) wurde `/usage` nach einem Turn bewusst
  **nicht** abgefragt (Annahme: „Quota kommt live via `usage_update`"). Da der
  Stream aber keinen Prozentwert liefert, blieb die Anzeige bei „Abo". Neue
  `refreshSubscriptionUsage()` holt `/usage` jetzt auch für Claude-Code-Tabs.

### Fixed
- **`utilization` wurde als Bruch fehlinterpretiert.** SDK und `/usage` liefern
  die Auslastung als 0–100; die vorherige „≤1 → ×100"-Heuristik hätte „1 %
  genutzt" fälschlich als „100 %" angezeigt. `normalizeUtilizationPct()` rundet
  und klemmt den Wert jetzt korrekt auf 0–100.

## [1.2.5] - 2026-07-09

### Fixed
- **Abo-Nutzungsanzeige (Claude Code) war ungenau**: Die Session-Leiste warf
  `allowed_warning` und `rejected` in einen Topf und zeigte in beiden Fällen
  „⚠️ Abo · Limit erreicht", obwohl `allowed_warning` nur „fast erreicht"
  bedeutet (noch nicht geblockt).

### Changed
- **Abo-Limits: 5-Stunden- und Wochen-Fenster gemeinsam.** Jedes
  `rate_limit_event` des Claude-Adapters trägt nur das gerade *bindende*
  Fenster (`rateLimitType`); die Anzeige sammelt die Events jetzt pro
  Fenster-Familie (`mergeRateLimitWindows()`), sodass 5-Stunden- **und**
  Wochen-Limit nebeneinander erscheinen. Neue reine, unit-getestete Funktionen
  in `src/renderer-logic.js`: `rateLimitFamily()`, `mergeRateLimitWindows()`
  und ein überarbeitetes `formatSubscriptionUsage()`. Die Leiste bleibt ruhig,
  solange alles im grünen Bereich ist, und zeigt bei Annäherung das dringlichste
  Fenster zuerst mit sauber getrenntem Status (`allowed_warning` → „fast
  erreicht" vs. `rejected` → „erreicht"). Reset-Zeit, Overage-Status und
  Token-Äquivalent stehen (je Fenster) im Tooltip.
  Hinweis: Der Live-Stream liefert `utilization` (den Prozentwert) meist nicht
  mit — die konkrete %-Anzeige folgt separat über die `/usage`-Abfrage.

## [1.2.4] - 2026-07-08

### Fixed
- **Settings "Features" matrix was stale**: `PROVIDER_CAPABILITIES` still
  listed `skills`/`agents` as unsupported for Claude Code, Anthropic, OpenAI,
  GLM and Ollama from before those providers got the lazy-loaded per-provider
  Skills/Agents index. Since the same table also drives
  `updateSidebarForProvider()`, this was hiding the Skills/Agents sidebar
  sections for those providers' tabs, not just mislabeling the matrix.
  Gemini stays `false` (deliberately excluded, kept context-light).

## [1.2.3] - 2026-07-08

### Changed
- Extracted the `agentPrefix` builder (Copilot's `/agent Name` syntax vs. the
  plain-language persona hint for every other provider) out of `app.js` into
  a pure, unit-tested `buildAgentPrefix()` in `src/renderer-logic.js`. This
  logic previously had no automated test coverage, despite a prior real bug
  in the same code path.
- Added `docs/CODE-REVIEW-PLAN.md` and `docs/QUALITY-AUDIT-PLAN.md`: chunked,
  multi-day plans for a full-codebase code review and quality audit.

## [1.2.2] - 2026-07-08

### Changed
- `AGENTS.md`: the commit-message rule now documents the Conventional Commits
  style (`type(scope): description`) actually in use, replacing the stale
  `vX.Y.Z: description` prefix convention.

## [1.2.1] - 2026-07-08

### Fixed
- **Path traversal in `sessions:readClaudeCodeTranscript`**: `sessionId` was
  joined into the transcript file path unchecked; now validated against a
  strict `[a-zA-Z0-9-]+` allow-list (Claude Code session IDs are UUIDs)
  before the path is built.
- **Path traversal in `skills:listProvider`/`agents:listProvider`**: the
  `provider` IPC argument reached `path.join` unchecked; both handlers now
  validate against the known provider allow-list.

### Changed
- Documentation (`README.md`, `docs/ARCHITECTURE.md`, `docs/USER-GUIDE.md`)
  updated for 1.2.0's per-provider Skills/Agents, the Claude Code history
  restore, and the tool-call rendering change; a few pre-existing gaps fixed
  along the way (missing IPC channels, `src/agents.js` mislabeled as
  "sub-agent directory").

## [1.2.0] - 2026-07-08

### Added
- **Skills for every provider**: provider-scoped folders under
  `~/.agent-desktop/<provider>/skills` (Claude Code, Anthropic, OpenAI, GLM,
  Ollama — Copilot keeps its native `~/.copilot/skills`; Gemini stays
  context-light on purpose). Exposed as a lazy index (name + description +
  file path) instead of inlining full content — the model reads a skill's
  `SKILL.md` itself via its file tool only once it judges it relevant.
  Sidebar's Skills section now follows the active tab's provider.
- **Agents for every provider**, same shape as Skills:
  `~/.agent-desktop/<provider>/agents`, lazy index, provider-aware sidebar.
  Unlike Skills, agents are a persona switch — if a task matches an agent's
  description, the model reads its `.agent.md` and adopts that
  approach for the rest of the task (real sub-agent delegation is a separate,
  later effort). The manual "activate" toggle still works everywhere as an
  explicit override on top of the automatic selection.
- **Claude Code session history on reopen**: tabs resumed from the sidebar (or
  restored after an app restart) now restore the full prior conversation for
  Claude Code too, read from its own native transcript
  (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) — previously the tab
  came back empty because it was wrongly routed through the direct-API
  history store.
- Tool-call rendering: the always-visible summary line (both the pending call
  and its result) is now length-capped instead of growing without bound; the
  full untruncated text stays one click away in an expandable block, so
  nothing is lost — just not dumped as a wall of text by default.

### Fixed
- Claude Code's own permission modes (default/acceptEdits/plan/
  bypassPermissions) are now the sole authority over approvals — the
  app-level "Auto" toggle no longer fights with them (hidden for Claude Code
  tabs; Copilot is unaffected).
- Sidebar tab icon (`.tab__provider-icon`) is properly vertically centered.
- Several silently-dropped/duplicated code paths cleaned up along the way:
  `formatToolArgs`/`toolIcon`/`escapeHtml`/… existed twice (an untested copy
  in `renderer/modules/utils.js` was silently shadowing the tested
  `src/renderer-logic.js` versions) — consolidated onto the single tested
  source.

### Changed
- `.chat-input-bar` padding tightened (`12px 16px` → `6px 16px`).

### Added
- **New provider: Claude Code (Beta)** — use Claude Code via the ACP adapter
  (`@agentclientprotocol/claude-agent-acp`, launched through `npx`), billed
  through your **Claude subscription** (no API key; `ANTHROPIC_API_KEY` is
  stripped from the child process). Fully integrated:
  - **Explicit ProviderID per tab** (`tab.provider`) as the authoritative
    discriminator — Claude Code and the Anthropic API share model ids, so the
    provider now comes from the tab/session, not the model.
  - **Model & mode selection** via `session/set_config_option` (the adapter's
    config-options API); models (Sonnet 5, Opus 4.8, Haiku 4.5, Fable) and the
    permission modes (default/auto/acceptEdits/plan/dontAsk/bypassPermissions)
    are discovered and persisted.
  - **Live context %** and **subscription quota display** (rate-limit reset,
    out-of-credits warning) from `usage_update`; no USD billing.
  - **Named sessions in the sidebar** like Copilot (provider-tagged), resumed
    with the right backend.
  - **Live CLI status** in the API-providers settings.
- **Interactive permission handling (ACP `session/request_permission`)** for
  Copilot **and** Claude Code — a dropup above the chat input shows the agent's
  offered options (allow once/always, reject), queued if several arrive. New
  per-tab approval toggle; a global "manual approval" setting drops Copilot's
  `--allow-all` so it asks per action (default off = unchanged).
- **Setup: auto-install Node.js via winget** when missing (best-effort, refreshes
  the session PATH), with a clear manual fallback.

### Fixed
- Default model per provider is validated against the provider's actual (incl.
  discovered) model list, so a Copilot/Claude Code default is applied and saved.
- `setup.ps1` no longer aborts with a raw "node not recognized" error when Node
  is missing (uses `Get-Command`); rebranded to "Agent Desktop".
- Model button shows the version (e.g. "Sonnet 5", not "Sonnet") for Claude Code.
- ACP `#ensureReady` waits for a starting backend instead of failing fast (npx
  adapter spawn race).

### Changed
- Copilot-only controls (tools deny-list, skill/agent prompt prefixes) are hidden
  for Claude Code tabs; the mode dropdown shows Claude Code's own modes.

## [1.0.1] - 2026-07-03

### Fixed
- **Default model per provider not applied/saved for Copilot**: the configured
  default was validated only against the hardcoded `DEFAULT_MODELS` list, so a
  Copilot (or any dynamically discovered) model chosen as default was rejected
  and fell back to Sonnet 4.6 — which also made the settings dropdown look as if
  the selection wasn't saved. `getDefaultModelForProvider` now validates against
  the provider's actual model list (incl. discovered models).

## [1.0.0] - 2026-07-02

First stable release. The core feature (GitHub Copilot CLI) is fully tested; the
direct-API providers are labelled by maturity as **Beta** (Gemini) or **Alpha**
(Anthropic, OpenAI, GLM, Ollama).

### Added
- **Dynamic model discovery for all providers** — models are discovered live via
  the `/models` endpoint (Anthropic, Gemini, OpenAI, GLM, Ollama) or via ACP
  (Copilot) and persisted. When a new model appears, an info message is shown.
  (`src/model-discovery.js`, IPC `providers:listModels`)
- **Alpha/Beta maturity labels** per provider with a tooltip (Beta: "tested, not
  final", Alpha: "untested"); Copilot has no label.
- **Diagnostic logging** (full unknown ACP events + raw `/usage` text) to
  investigate sub-agent / usage signals.

### Changed
- **Internal rename `copilot-desktop` → `agent-desktop`** (app identity,
  `app.name`, data directory `~/.agent-desktop`, Electron `userData`). On first
  start the app automatically migrates existing data (preferences, encrypted
  API keys, sessions, logs) from the old identity — on Windows the keys stay
  valid (DPAPI). The provider id `copilot` and the IPC channels are intentionally
  kept unchanged (they reference the real Copilot integration). (`src/data-dir.js`)
- **Optimized tab bar**: active tab large (full label + actions), the rest
  compact (3-char short label, separator borders, actions on hover only); app
  icon removed; close ✕ in the right corner.

### Fixed
- **Cost billed per message using the model actually used** (frozen at send time)
  — switching models between two prompts no longer re-prices earlier tokens at
  the new price.
- **Tool calls visible for Copilot (ACP)**: `kind` is now remembered across
  `tool_call_update` (correct icon instead of hidden); the tool call is rendered
  centrally in `tool.execution_start`.
- **MCP tool calls** (e.g. Playwright) are no longer hidden (generic 🔧 icon +
  meaningful argument display).
- **Tool result no longer shown three times** (ACP status updates are deduplicated
  by `toolCallId` and updated in place).
- **Missing paragraph break between sentences** at `report_intent` boundaries fixed.
- **After loading a session** the view scrolls to the bottom (latest message).

<!-- The following entries were previously under [Unreleased] and are part of 1.0.0. -->

### Added
- **Three new providers: OpenAI, Ollama, GLM (Zhipu)** — fully agentic via a shared OpenAI-compatible core (chat completions + function calling, SSE streaming, dependency-free). Ollama is local & keyless; the base URL is overridable per provider in the settings. (`src/providers/openai-compatible-provider.js` + `openai/ollama/glm-provider.js`)
- **Default provider + default model per provider** in the settings; also fixes the bug where Copilot always started with Haiku instead of the selected model
- **Model labelling** in the dropdown: 💲 paid / 🆓 free / AIC (Copilot subscription)
- **Context usage** updates automatically after every message (all providers)
- **Quota / rate-limit errors** are shown as a readable message instead of raw JSON (Gemini/Anthropic/OpenAI)

### Changed
- **Cost in real USD** instead of mixed AI Credits (Copilot 100 AIC = $1); **cost window groupable by provider** (provider/session toggle)
- **Git-based self-update**: on start, periodically (every 6h), and via a button in *Settings → UI*, the app checks via `git ls-remote --tags origin` whether a newer release tag (`vX.Y.Z`) exists (compared against the local `package.json` version, stable tags only). When an update is available a "New version available" banner appears with "Download & restart": given a clean working tree → `git pull --ff-only origin main`, automatic `npm install` if dependencies changed, then restart. No embedded token — uses the user's Git credentials (works with the private repo too). (`src/updater.js`, IPC `updates:check`/`updates:apply`)
- **Gemini 3.5 Flash** added to the model selection (pricing provisionally like 2.5 Flash until officially confirmed)
- **Info tooltip per provider** in the API-provider settings (ⓘ): lists available tools and specifics per provider on hover
- **Auth hint with login + restart**: on "sign-in required", a button opens a visible terminal running `copilot login`; afterwards a "Restart app" button (needed because auth is picked up at main-process start)

### Changed
- **Todos are now project- instead of session-scoped**: stored as a markdown checklist under `<cwd>/todo/todos.md` (with invisible ID comments for lossless round-trips) instead of `<session>/todos.json`. This way the todo list survives session deletion and is shared by all sessions in the same directory. (`src/todos.js`, IPC `todos:*` now cwd-based)
- **Gemini: live search and file tools togglable per tab** instead of combined — Gemini 2.5 forbids both in the same request (400 `INVALID_ARGUMENT`). The "🔍 Research" (default) or "📁 Files" mode can be switched per tab at any time
- **Session deletion to the recycle bin** (`shell.trashItem`) instead of irreversible `fs.rmSync`; additionally a non-empty `todos.json` is backed up to `~/.agent-desktop/deleted-todos/` before deletion
- **Multi-line tooltips**: `.js-tooltip` now uses `white-space: pre-line` (line breaks are rendered)

## [0.32.0] - 2026-06-24

### Added
- **Multi-LLM provider: Anthropic API (fully agentic)** — alongside the Copilot CLI, the Anthropic API can now be used directly per tab. Own agent loop with local tool execution (`shell`, `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`), streaming, adaptive thinking, and token-accurate cost accounting. (`src/providers/*`, `src/secure-store.js`)
- **Multi-LLM provider: Google Gemini (research-oriented)** — Gemini 2.5 Pro/Flash as a direct API. **Live Google search** (grounding) with automatic source citations + file tools (read/write/edit), but no shell and no skills/agents/instructions. (`src/providers/gemini-provider.js`, `@google/genai`)
- **Provider selection on new tab**: clicking "+" opens a provider dropdown (Copilot, Gemini, Anthropic, OpenAI); the provider is fixed per tab. The session bar shows the provider as a read-only indicator next to the cost
- **Secure API-key storage** via the OS keychain (Electron `safeStorage`); new "API providers" settings tab. Keys never leave the main process
- **Skills, agents, and `copilot-instructions.md`** are injected as (cached) system-prompt context for the direct API
- **Prompt caching** for the Anthropic API (the growing system/tool/history prefix is cached)
- **Context management for direct providers**: `📊 %` display + **automatic compaction** above 80% usage
- **Session persistence + redisplay** for direct-API sessions (history under `~/.agent-desktop/api-sessions/`)
- **Cache-write tokens** (1.25× input) are accounted for in the cost calculation

### Changed
- The direct-API `shell` tool runs on Windows via **PowerShell** instead of cmd.exe (platform-dependent via `spawn`)

### Fixed
- **ACP `session/prompt` timeout (critical)**: longer Copilot turns (> 60s) hit a fixed 60-second timeout → "[process exited with code 1]" while the CLI kept running and the response streamed on forever (the UI stayed stuck on "Running"). `session/prompt` no longer has a timeout (bounded by cancel/process exit); silent slash commands use 180s
- **Merged messages**: consecutive response segments around tool calls ("… calling:Now …") were rendered into one bubble. A tool call now closes the response bubble → separate, readable messages (Copilot and direct API)
- **Provider dropdown**: fixed missing panel background / wrong position on the "+" provider menu (dedicated panel class, fixed positioning)

## [0.31.0] - 2026-06-19

### Added
- **Credit estimation from token usage**: `/usage` returns input/output/cache tokens, from which the app computes estimated AI Credits (`~12.5C`) via a model-price table (Sonnet 4.6: 300/30/1500C, Opus 4.8: 500/50/2500C per 1M tokens)
- **Cost history in settings**: new "Cost" settings tab with a stacked bar chart (day/week view), breakdown by session, grand total, and a clear-history button
- **Cost log**: delta cost per prompt is persisted in `preferences.json` (key `costLog`); max 5,000 entries
- `buildCostBuckets`, `aggregateCostBySession`, `trimCostLog` as testable pure functions in `src/renderer-logic.js`
- **Haiku 4.5 pricing** in the model-price table (input 100C, cache 10C, output 500C per 1M tokens)

### Changed
- **Cost as its own page instead of a settings tab**: the cost listing now opens as a dedicated full-screen page like the plugin marketplace (more room for growing data) — reachable via a 📈 icon in the session bar. The "Cost" settings tab is removed
- **AIC display always visible**: the credit display shows `~0C` before the first prompt instead of being empty
- The session bar now shows `~X.XC` instead of AIU (falls back to AIU/AIC when the model price table doesn't apply)
- `parseUsageTokens`, `parseUsageRequests`, `estimateCredits`, `MODEL_PRICING` moved from `renderer/app.js` to `src/renderer-logic.js` (testable)
- **Cost panel moved to `renderer/modules/costs.js`** — `renderer/app.js` slimmed down, cost log and chart logic in their own module
- **Cost tracking for background tabs too**: `refreshUsageDisplay` now runs after every completed prompt, not only for the active tab

### Fixed
- **Cost calculation on model switch**: per prompt, only the **token increment** since the last reading is now priced at the current model's rate (`estimateCreditsDelta`). Previously the cumulative token total was priced entirely at the current rate, so a model switch retroactively re-priced tokens consumed under the old model (too-high/low deltas, sometimes 0 when switching to a cheaper model). Negative deltas (after `/clear`/`/compact`) are clamped to 0
- **`require is not defined` in the renderer (critical)**: `renderer/app.js` used `require('../src/renderer-logic')`, which threw a `ReferenceError` in the renderer (nodeIntegration: false, no bundler) and aborted all of app.js (e.g. `toggleSection is not defined`). `renderer-logic.js` is now UMD-wrapped (IIFE) and exposes `window.RendererLogic`; app.js reads from that instead of via `require`
- **Cost panel showed no data**: 3 mis-named CSS variables (`--bg-secondary`/`--bg-primary`/`--border-color` → `--bg-hover`/`--bg-surface`/`--border`) — canvas background and separators were invisible
- **Y-axis grid lines barely visible in the light theme**: `drawCostsChart` read the non-existent CSS variable `--border-color` instead of `--border`
- **Silent errors in `refreshUsageDisplay`**: `catch (_) {}` replaced with logging
- `niceStep(0)` guarded (avoided a potential `NaN` on an empty chart)

## [0.29.1] - 2026-06-18

### Fixed
- **Model IDs in the pricing map**: dots instead of hyphens (`claude-sonnet-4.6` not `claude-sonnet-4-6`) — credits weren't computed, AIU was shown instead

## [0.29.0] - 2026-06-18

### Added
- **Context button as a dropdown**: the `📊 Context` button now shows the current usage in % directly in the button (`📊 18%`) and opens a dropdown with three actions on click:
  - **Show context**: detail panel with token usage (categories, percentage, color-coded)
  - **Compact**: summarizes the conversation and updates the % display
  - **Clear**: clears the context, then re-queries `/context`
- **Tools button**: `🔧 Tools` button next to the context button — opens a popup for session-specific denied tools
- **AIU/credit display in the bar**: on the right of the session action bar, the current session's usage is shown as text
- **Session-specific tool denial with process restart**: changes to the session deny list (add, toggle, delete) automatically restart the ACP process and reload the session via `session/load`
- IPC handler `copilot:restartWithDeniedTools` in `main.js`
- Preload bridge `copilot.chat.restartWithDeniedTools`

### Changed
- Session action bar restructured: Model → Agent → Context (dropdown) → Tools | Usage
- Pin function for session tools removed

### Fixed
- **Mode dropdown opened upwards**: wrong CSS class name (`mode-dropdown--below` instead of `model-dropdown--below`) — the dropdown now opens correctly downwards

## [0.28.0] - 2026-06-xx

### Added
- **ACP backend migration**: all communication with the Copilot CLI now runs over `copilot --acp` (Agent Communication Protocol, JSON-RPC over NDJSON stdio)
- `AcpClient` (`src/acp-client.js`): encapsulates session management, prompt streaming, event mapping, and `silentCommand()`
- **`silentCommand(command)`**: slash commands (`/context`, `/usage`, `/compact`, `/clear`) run as silent ACP requests — the result does not go into the chat
- IPC handler `copilot:silentCommand` in `main.js`
- Preload bridge `copilot.chat.silentCommand`
- `acpClients` map in `main.js` (tabId → AcpClient)

### Removed
- **PTY terminal fully removed**: no `node-pty`, no `xterm.js`, no terminal panel
- `renderer/modules/terminal.js` deleted
- `src/ipc/terminal-ipc.js` deleted
- `src/main-helpers.js`: `collectPtyOutput`, `waitForReady`, `isCopilotTuiReady`, `detectCopilotPrompt`, `cleanupPty` removed

### Changed
- Slash commands no longer run via PTY bracketed paste but via `silentCommand()`
- Process management: one long-lived ACP process per tab (instead of spawn-per-message)

## [0.25.0] - 2026-05-21

### Added
- **CWD per session**: the working directory can be chosen per tab/session by clicking 📂 in the statusbar
- CWD is persisted for named sessions and restored on resume
- `saveSessionCwd` / `getSessionCwd` in `src/named-sessions.js`

## [0.24.6] - 2026-05-28

### Added
- **Application icon**: `assets/icon.png` (512×512 RGBA) for window, titlebar, tab bar, and dock
- **Linux desktop integration**: `assets/copilot-desktop.desktop` with `StartupWMClass=copilot-desktop`
- **WM_CLASS fix**: `--class copilot-desktop` via Chromium switch on Linux

## [0.24.0] - 2026-05-21

### Added
- **Disable skills in the CLI**: toggle button per skill — skills can be disabled in `~/.copilot/settings.json`
- IPC handlers `skills:getDisabled` and `skills:setDisabled`
- **Persist sidebar collapse state**: collapsed sections are saved
- **Content sync plain↔rich**: content is transferred on mode switch

### Fixed
- Rich-text list rendering, skill-card button order, content sync on empty content

### Removed
- Strikethrough button from the rich-text toolbar

## [0.23.0] - 2026-05-29

### Added
- **Rich-text editor toggle**: ✏️/📝 button — plaintext or rich-text mode. Toolbar with Bold, Italic, UL, OL. HTML→Markdown on send.
- **Model dropdown redesign**: accent bar on the left + background instead of a checkmark
- **Model order**: Haiku → Sonnet → Opus 4.6 → Opus 4.7

### Fixed
- Model persistence after app restart, model persistence for new sessions

## [0.21.0] - 2026-05-14

### Added
- Full JSDoc comments for all main files (main.js, preload.js, renderer/app.js, todos.js, scanners.js)

## [0.20.5] - 2026-05-14

### Added
- Tutorial flags in `folders.json` (key whitelist: `tutorialSkillsShown`, `tutorialRenameShown`)
- IPC handlers `tutorial:getFlags` / `tutorial:setFlag`
- Tutorial popups auto-close after 30s (closed guard)
- `tab:renamed` CustomEvent on tab rename

## [0.18.2] - 2026-05-12

### Added
- First-run onboarding wizard (4 steps: auth, folders, agents/skills, feature intro)
- Tab-unlock fallback after 180s inactivity

## [0.16.1] - 2025-06-17

### Added
- Tab-unlock fallback for hanging sub-agents (30s manual, 180s automatic)
- Activity tracking (`lastActivityAt`)

## [0.16.0] - 2025-06-16

### Added
- Plugin manager, session resume (plan + last messages as chat messages)

## [0.15.0] - 2025-06-15

### Added
- Agents panel in the sidebar — scans `~/.copilot/agents/*.agent.md`
- `src/agents.js`: `scanAgentsDirectory()`

## [0.14.4] - 2025-06-15

### Security
- XSS fix in `openInstructionsEditor`

### Fixed
- Model rollback on switch error, event-listener leak on window close

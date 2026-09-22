# Plan: renderer/app.js modularisieren

## Ziel

Token-Verbrauch beim Bearbeiten der App senken: `renderer/app.js` (8457
Zeilen, 255 Top-Level-Funktionen) in kleinere, thematisch geschlossene Module
unter `renderer/modules/` aufteilen, nach dem bereits etablierten Muster.
Gezielte Edits sollen dann nur noch den relevanten Modul-Ausschnitt statt des
gesamten Monolithen in den Kontext ziehen.

## Ausgangslage (per Code-Analyse geprüft, nicht geraten)

- Teilmodularisierung existiert bereits: `modules/{utils,dev-console,todos,
  images,test-runner,session-tools,costs}.js`, zusammen ~1050 Zeilen bereits
  draußen. Muster: flache klassische `<script>`-Tags, **kein IIFE, kein
  `window.X`-Namespace** — Top-Level-`function`/`const` werden über die
  Ladereihenfolge in `renderer/index.html` als implizite Globals sichtbar.
  Einzige echte Namespace-Fassade ist `window.RendererLogic`
  (`src/renderer-logic.js`, IIFE, lädt zuerst).
- `app.js` selbst exportiert nur eine Handvoll Funktionen explizit auf
  `window.*` (`switchTab`, `closeTab`, `resumeSession`,
  `confirmDeleteSession`, `toggleTodo`, `deleteTodo`, `installPlugin`,
  `uninstallPlugin`, `updatePlugin`, `removeMarketplace`,
  `switchToPluginsView`, `switchToCostsView`, `toggleSection`,
  `pluginsViewActive`) — diese exakten Namen müssen nach Extraktion erhalten
  bleiben.
- Zwei Migrationen sind nur halb fertig: Die Banner
  `"→ modules/dev-console.js"` und `"→ modules/test-runner.js"` behaupten
  Vollständigkeit, aber `initDevConsole()` (43 Z.) und das
  `initTestRunner()`-Wiring sind noch in `app.js` liegen geblieben.
- Mehrere Banner-Kommentare sind irreführend/veraltet (z. B. "Session Export"
  für reine Cwd/Provider/Approval-Persistenz) — keine verlässliche Grundlage
  für Modulgrenzen, nur die tatsächliche Struktur zählt.
- Größter geteilter Zustand: `tabs` (Map) + `activeTabId`, von praktisch
  jedem Cluster gelesen. Das macht Tab-Verwaltung (469 Z.), `initAgentIPC`
  (605 Z., eine einzige Funktion, zentraler Event-Dispatch) und den
  Modell-/Provider-Katalog (991 Z., eng an `initSettings` gekoppelt) am
  risikoreichsten für eine automatisierte Extraktion.

## Design-Entscheidungen

- Gleiches Muster wie bisher fortsetzen: flache globale Funktionen/consts,
  kein IIFE, keine neue `window.X`-Fassade.
- Zwei Phasen: **Phase 1** = in sich geschlossene Cluster mit eigenem,
  nicht (oder kaum) geteiltem Zustand — sicher, mechanisch, automatisierbar.
  **Phase 2** = Tab-Verwaltung, Agent-IPC, Modell-/Provider-Katalog,
  Settings-Modal-Init — hoher Vernetzungsgrad, verdient einen eigenen,
  langsameren Durchgang, nicht Teil dieses ersten Anlaufs.
- `index.html`-Ladereihenfolge bleibt strikt: neues Modul lädt vor `app.js`,
  nach allem, wovon es liest.
- Nach jedem Batch: `node -c` Syntaxcheck, volle Jest-Suite, ESLint. UI-
  Verhalten selbst ist laut Projektkonvention nicht automatisiert geprüft
  (`renderer/app.js`-DOM-Glue ist bewusst ungetestet) — deshalb nach
  Abschluss von Phase 1 den Nutzer bitten, in der laufenden App kurz
  gegenzuprüfen, statt selbst eine Testinstanz zu starten.
- Angefangene Migrationen (dev-console, test-runner) zuerst fertigstellen,
  bevor neue Module begonnen werden.

## Tasks (Phase 1 — sicher, in sich geschlossen)

- [x] Angefangene Migrationen fertigstellen: `initDevConsole` →
  `modules/dev-console.js`, `initTestRunner`-Wiring → `modules/test-runner.js`
  (dabei nebenbei einen echten Bug gefixt: `devConsoleFilter` war `const`,
  obwohl `initDevConsole` es neu zuweist — hätte bei Klick auf einen
  Konsolen-Filter eine `TypeError` geworfen)
- [x] Generische UI-Helfer + Audio + Datum + Tooltips in `modules/utils.js`
  gefaltet: `_audioCtx`/`playNotificationSound`, `stripShellWrapper`,
  `renderTagList`, `initTagInput`, `withButtonBusy`, `emptyStateHtml`,
  `showNotification`, `formatDate`, `initTooltips`
- [x] `modules/onboarding.js`: Onboarding-Assistent + Tutorial-Popups
  (`initOnboarding` … `hideAppLoadingSplash`), eigener Zustand
  (`_onboardingStep`, `_onboardingSlide`, `_introSlides`). Hinweis:
  `_pendingOnboardingTabs`/`_cachedFolders` sind NICHT hierher gewandert —
  ersteres wird auch von `setTabStatus` (Tab-Cluster, Phase 2) gelesen und
  bleibt bewusst globaler Zustand in `app.js`, zweiteres gehört zu einem in
  dieser Phase nicht bewegten Cluster. `renderIntroStep`/`renderIntroSlide`
  mitgezogen, obwohl aktuell ohne erkennbaren Aufrufer (vorgefundener
  toter Code, unverändert mitverschoben, nicht entfernt).
- [x] `modules/plugins.js`: Plugin-Manager + View-Umschaltung
  (`getPluginStatus` … `switchToCostsView`), eigener Zustand (`marketplaces`,
  `installedPlugins`, `pluginsViewActive`)
- [x] `modules/skills-mcp.js`: Skills/Agents/MCP-Rendering (`renderSkills` …
  `loadProjectMcpServers`), Zustand (`skills`, `agents`, `activeAgents`,
  `mcpServers`, `globalMcpServers`, `_liveMcpStatus`, `_lastContextKey`,
  `_contextRequestGen`). Anders als Onboarding/Plugins ist dieser Zustand
  NICHT vollständig gekapselt — Tab-Verwaltung, Send-Message und
  `initAgentIPC` (alle Phase 2, bleiben in `app.js`) lesen/schreiben ihn
  ebenfalls, nach demselben bereits etablierten Cross-File-Bare-Global-Muster
  wie bei `tabs`/`activeTabId`. **Lehre für die restlichen Module:**
  `activeAgents`/`globalMcpServers` werden nur in `app.js`s `initDataLoad`
  neu zugewiesen, nie innerhalb der eigenen Moduldatei — ESLint sieht das
  nicht und schlägt fälschlich `prefer-const` vor; **NICHT** zu `const`
  ändern (bricht `initDataLoad` zur Laufzeit), sondern
  `// eslint-disable-line prefer-const` mit Begründung setzen. Bei jeder
  weiteren Extraktion mit ähnlichem Muster erneut prüfen.
- [x] `modules/sessions-sidebar.js`: Sessionliste, Umbenennen, Verlauf,
  Fortsetzen, Löschen (`renderSessions` … `executeDeleteSession`), Zustand
  (`sessions`, `activeSessionId`, `pendingDeleteId`). Zusätzlich
  `filterSessions`/`isSessionIdLike` (ursprünglich als eigener
  "Search & Filter"-Cluster physisch getrennt) mit reingezogen — werden
  direkt von `renderSessions`/`SECTION_MENUS.sessions` genutzt, gehören
  fachlich klar dazu. **Lehre bestätigt:** `eslint-disable-line
  prefer-const` vorschnell für `activeSessionId` gesetzt, dann per Lint-Lauf
  als überflüssig erkannt (wird im selben Modul reassignt) und wieder
  entfernt — vor dem Setzen einer Disable-Zeile erst prüfen, ob die
  Reassignment nicht doch im selben File liegt.
- [x] `modules/keyboard-shortcuts.js`: Shortcut-System
  (`_getShortcutPrefs` … `initKeyboardShortcuts`), Zustand (`SHORTCUT_DEFS`,
  `FIXED_SHORTCUTS`). `modules/drag-drop.js` (`initDragDrop`) im selben
  Batch mitgezogen (physisch direkt danebengelegen, aber fachlich separat).
  **Einzige echte Testabhängigkeit vom Dateipfad in dieser ganzen Phase:**
  `__tests__/integrity.test.js` las `renderer/app.js` roh per
  `fs.readFileSync` ein, um dessen `SHORTCUT_DEFS`-IDs gegen die
  Hauptprozess-Kopie in `src/shortcuts.js` abzugleichen — schlug nach der
  Verschiebung zu Recht fehl (Testsuite hat das korrekt aufgefangen). Fix:
  Pfad in dem Test auf `renderer/modules/keyboard-shortcuts.js` umgestellt,
  Variable umbenannt. Vorher per
  `grep -rn "readFileSync.*app\.js" __tests__/*.js` geprüft, dass das die
  EINZIGE Stelle im gesamten Testverzeichnis ist, die rohen App.js-Text
  einliest — für Onboarding/Plugins/Skills-MCP/Sessions-Sidebar gab es keine
  vergleichbare Altlast. **Für jedes weitere Modul in dieser Phase erneut
  mit diesem Grep prüfen, bevor der Batch als abgeschlossen gilt.**
- [x] `modules/self-update.js`: App-Selbstupdate + Claude-Adapter-Update-
  Checker (`updateReasonText` … `applyClaudeAdapterUpdateFromBanner`).
  Vollständig in sich geschlossener Zustand, kein Lint-/Test-Nachtrag nötig.
- [x] `modules/provider-settings.js`: API-Provider-Einstellungen
  (`PROVIDER_SETTINGS`, `buildProviderConfigPanelHtml` …
  `saveProviderBaseUrl`) — größter Einzelblock (~690 Z.), aber ohne eigenen
  Zustand. Dabei aus Versehen einen kaputten Zwischenschritt produziert
  (Duplikat mit `_UNUSED`-Suffix statt sauberer Entfernung) — sofort beim
  nächsten Blick bemerkt und vor jedem Test-/Lint-Lauf korrigiert, siehe
  Status unten.
- [x] `modules/chat-search.js`: Chat-Suchleiste (`initChatSearch`) — im
  selben Batch wie provider-settings.js erledigt (beide stranded neben dem
  ursprünglichen `initDevConsole`-Platzhalter)
- [x] `modules/drag-drop.js`: Datei-Drag&Drop (`initDragDrop`) — im
  keyboard-shortcuts-Batch erledigt
- [x] `index.html`-Ladereihenfolge nach jedem neuen Modul nachgezogen
- [x] Irreführende Banner-Kommentare korrigiert, wo der betroffene Code in
  dieser Phase bewegt wurde (die verbliebenen Banner außerhalb bewegter
  Bereiche — z. B. die "Session Export"-Fehlbenennung, jetzt Teil von
  sessions-sidebar.js — wurden beim Verschieben implizit mit entfernt, da
  der komplette Blockinhalt inkl. Banner umgezogen ist)

## Phase 1 — Ergebnis

`renderer/app.js`: 8457 → 4720 Zeilen (44 % kleiner). 12 neue/erweiterte
Module unter `renderer/modules/`: `utils.js`, `dev-console.js`,
`test-runner.js` (Migrationen fertiggestellt), `onboarding.js`, `plugins.js`,
`skills-mcp.js`, `sessions-sidebar.js`, `keyboard-shortcuts.js`,
`drag-drop.js`, `self-update.js`, `provider-settings.js`, `chat-search.js`.
50/50 Testsuiten, 1816/1816 Tests grün, ESLint 0 Fehler (37 Warnungen,
identisch zur Baseline vor Phase 1). Ein echter Bug nebenbei gefixt
(`devConsoleFilter` war `const`, wurde aber neu zugewiesen). Eine
Testdatei musste inhaltlich angepasst werden (`integrity.test.js` las
`renderer/app.js` hart codiert für den Shortcuts-Abgleich).

## Phase 2 (hoher Vernetzungsgrad, eigener Durchgang)

- [x] `modules/agent-ipc.js`: `initAgentIPC` (605 Z., eine Funktion, zentraler
  Event-Dispatch) + `finalizeResponseBubble`/`appendStreamError` (physisch
  direkt davor, fachlich auch Event-Rendering) + `pendingToolCalls`-Zustand
  (nur hier verwendet, sauber mitgezogen). `tabs`/`activeTabId` bewusst NICHT
  mitverschoben — zu viele andere Cluster lesen/schreiben sie, ein Umzug
  hätte nichts eingespart (die Deklaration ist 2 Zeilen), nur zusätzliche
  Cross-File-Verweise erzeugt. **Technische Lehre:** ein einzelnes Edit über
  den kompletten ~550-Zeilen-Funktionskörper schlug wiederholt mit einem
  Zeichen-Mismatch fehl (vermutlich Unicode-Emoji/Sonderzeichen-Encoding bei
  so einer langen `old_string`) — Aufteilung in 3 kleinere, frisch
  gelesene Chunks (per Marker-Kommentar dazwischen) hat funktioniert. Bei
  den noch ausstehenden großen Blöcken (Tab-Verwaltung, Modell-Katalog)
  gleich in Chunks von max. ~150–200 Zeilen arbeiten statt einen Riesenblock
  zu versuchen.
- [x] `modules/tabs.js`: `createTab`/`switchTab`/`closeTab`/`renderTabs`/
  `_draggedTabId`/`reorderTabs`/`startTabRename` (469 Z., höchster Fan-out
  im ganzen File) — `tabs`/`activeTabId`/`richTextMode` bleiben in `app.js`
  (siehe Design-Entscheidungen), nur die Funktionskörper + das rein lokale
  `_draggedTabId` wandern. Wie erwartet: `activeTabId` bekam nach dem Umzug
  eine `prefer-const`-Falschmeldung (wird nur noch in `tabs.js` reassignt,
  nicht mehr in `app.js` selbst) — mit `eslint-disable-line` + Begründung
  behoben, exakt das in `skills-mcp.js` dokumentierte Muster.
  **Technische Bestätigung:** Chunks von ~150–210 Zeilen ließen sich
  durchgehend per Edit entfernen, keine weiteren Mismatch-Fehler.
- [x] `modules/model-catalog.js`: Reasoning-Helfer (`REASONING_EFFORTS` …
  `reasoningEffortLabel`, ~52 Z., ursprünglich lose vor `getCurrentTheme`
  ohne eigenes Banner) + Modell-/Provider-Katalog (672 Z.) + Modus-Umschaltung
  (319 Z.) — größtes Modul (~1040 Z.), aber ein einziges kohärentes Thema
  ("welche Modelle/Provider/Modi/Reasoning-Stufen gibt es, wie wählt man
  sie"). Dabei einen Dokumentationsfehler aus dem tabs.js-Batch korrigiert:
  `normalizeReasoningByModel` war dort fälschlich als "RendererLogic via
  utils.js" beschrieben, lebt aber in `app.js` (jetzt hier). **Technische
  Bestätigung:** Rückwärts entfernt (erst Session Modes, dann Model
  Switcher, dann Reasoning-Helfer) hält Zeilennummern der noch nicht
  bearbeiteten Blöcke stabil — spart Re-Greps zwischen Chunks.
- [x] `initSettings` **bewusst in `app.js` belassen** (Entscheidung
  getroffen, nicht vergessen): 205 Zeilen reine Verdrahtung — verkabelt
  statische Settings-DOM-Elemente mit bereits ausgelagerten render-/save-
  Funktionen aus ~6 verschiedenen Modulen, besitzt selbst keinen nennenswerten
  eigenen Zustand (nur lokale Closures). Fachlich derselben Kategorie wie der
  `DOMContentLoaded`-Bootstrap, der ebenfalls in `app.js` bleibt — eine
  Extraktion hätte nur ein weiteres Modul mit hohem Fan-out in beide
  Richtungen erzeugt, ohne echten Konzentrationsgewinn.
## Bewusst nicht angefasst

- Usage-/Kosten-Anzeige (256 Z.) — erst kürzlich Bugfix hier
  (Token-Historie), bewusst nicht direkt danach nochmal anfassen
- `DOMContentLoaded`-Bootstrap bleibt in `app.js` (reine Orchestrierung)
- `initSettings` bleibt in `app.js` (siehe Begründung oben)

## Status

**Phase 1 und Phase 2 abgeschlossen.** `renderer/app.js`: 8457 → 2640 Zeilen
(69 % kleiner). 13 neue/erweiterte Module unter `renderer/modules/`:
`utils.js`, `dev-console.js`, `test-runner.js`, `onboarding.js`, `plugins.js`,
`skills-mcp.js`, `sessions-sidebar.js`, `keyboard-shortcuts.js`,
`drag-drop.js`, `self-update.js`, `provider-settings.js`, `chat-search.js`,
`agent-ipc.js`, `tabs.js`, `model-catalog.js` (15 insgesamt inkl. der drei
fertiggestellten Alt-Migrationen). 50/50 Testsuiten, 1822/1822 Tests grün,
ESLint 0 Fehler (37 Warnungen, identisch zur Baseline vor Beginn). Zwei
echte Bugs nebenbei gefixt (`devConsoleFilter` war `const` trotz
Neuzuweisung; ein Dokumentationsfehler in `tabs.js` zu
`normalizeReasoningByModel` korrigiert). Ein Test musste inhaltlich angepasst
werden (`integrity.test.js`, Shortcuts-Pfad). Ein projektweiter Scan über
alle Top-Level-Deklarationen in `app.js` + allen Modulen bestätigt 0
dateiübergreifende Namenskollisionen.

**Noch nicht in der laufenden App selbst gegengeprüft** — nur automatisiert
verifiziert (Syntax, Tests, Lint, Duplikat-Scan). `renderer/app.js`-DOM-Glue
ist laut Projektkonvention nicht unit-getestet; vor dem Commit sollte der
Nutzer die App einmal starten und die stark betroffenen Bereiche
durchklicken: Tabs anlegen/wechseln/schließen/umbenennen/Drag&Drop,
Modell-/Reasoning-/Modus-Auswahl (🧠-Menü), Provider wechseln, laufende
Chat-Antworten (Streaming, Tool-Aufrufe, Fehleranzeige), Sessions
fortsetzen. Nichts committet.

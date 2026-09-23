# Changelog

## [1.21.3] - 2026-09-23

### Changed
- Copilot-Modellpreise werden täglich aus GitHubs offizieller Preistabelle
  geladen; die verfügbaren CLI-Modelle erhalten damit aktuelle Input-,
  Cache-Write-, Cache-Read- und Output-Raten. Feste Werte bleiben als
  Offline-Fallback erhalten, inklusive Long-Context-Preisen für GPT-6 Luna
  und GPT-6 Sol. LiteLLM bleibt Fallback für Direkt-API-Modelle.
- Die veraltete Sonnet-5-Einführungspreisstaffel wurde durch den aktuell
  offiziellen Preis ersetzt.

## [1.21.2] - 2026-09-23

### Changed
- **SSH-Ziel für Claude Code (SSH) wird jetzt in der Provider-Zeile
  eingegeben** (Settings → Provider), genau wie API-Key/Base-URL bei den
  anderen Anbietern — statt in einem eigenen Tab, der vorher fälschlich
  immer sichtbar war. Der "CC (SSH)"-Tab (Arbeitsverzeichnis, Passwort,
  Verbindungstest) erscheint wieder erst, sobald dort ein Host gespeichert
  ist.
- Eingabefelder in den Provider-Einstellungen nutzten teils eine nicht
  existierende CSS-Klasse (reines Browser-Default-Styling, weiße Boxen statt
  dunklem Theme) — behoben, plus eine Absicherung gegen Chromiums
  Autofill-Heuristik, die benachbarte Host-/Passwort-Felder fälschlich als
  Login-Formular erkennen und neu einfärben kann.

### Fixed
- **`spawn ssh ENOENT` beim Start eines Claude-Code-(SSH)-Chats.** Ursache:
  `spawn('ssh', …, { shell: false })` verlässt sich auf die PATH-Auflösung
  des aufrufenden Prozesses — bei einem über Startmenü/Taskleiste
  gestarteten Prozess kann das ein älterer Stand sein als in einem frisch
  geöffneten Terminal. Der absolute Pfad zu `ssh.exe` wird jetzt einmalig
  aufgelöst (`where`/`which`, mit Fallback auf den Windows-Standardpfad)
  und wiederverwendet.
- **Derselbe Fehler hatte noch eine zweite, eigentliche Ursache:** Der
  Remote-Arbeitsverzeichnis-Pfad (z.B. `/home/pi/projekt`) wurde
  fälschlich auch als *lokales* Arbeitsverzeichnis für den `ssh`-Prozess
  selbst verwendet — kein gültiger Windows-Pfad, wodurch `spawn()`
  irreführend mit `ENOENT` auf `ssh.exe` statt auf das Verzeichnis
  fehlschlug. ACP-Protokoll-cwd (bleibt der Remote-Pfad) und
  Spawn-cwd (jetzt ein echtes lokales Verzeichnis) sind jetzt getrennt.
- **`Process exited (code=127)` beim Start.** Node.js/`npx` waren über
  einen einzelnen SSH-Befehl nicht auffindbar, obwohl in einer normalen
  interaktiven SSH-Sitzung erreichbar — typisch bei `nvm`-Installationen,
  deren PATH-Eintrag nur in `~/.bashrc` steht (die bash für
  nicht-interaktive Befehle überspringt). Die App lädt `~/.nvm/nvm.sh`
  jetzt still nach, falls vorhanden, bevor der eigentliche Befehl läuft.

## [1.21.1] - 2026-09-23

### Fixed
- **Die „Standard-Modell"-Auswahl in den Provider-Einstellungen reagierte
  nicht auf neu entdeckte Modelle.** Das Select wurde nur einmal befüllt —
  bei Copilots eigenem (statischem) Settings-Tab beim App-Start, bei den
  dynamisch erzeugten Provider-Tabs (Anthropic, Gemini, …) beim letzten
  Tab-Aufbau — und blieb danach eingefroren: neu von der CLI/API gemeldete
  Modelle tauchten dort nicht auf, obwohl das Modell-Dropdown im Tab selbst
  (🧠-Menü) sie sofort zeigte, weil es bei jedem Öffnen neu aufgebaut wird.
  `applyDynamicModels()` aktualisiert jetzt zusätzlich das passende
  Settings-Select, sobald neue Modelle eintreffen.

## [1.21.0] - 2026-09-22

### Added
- **Passwort-Anmeldung für Claude Code (SSH)**, als Alternative zum
  SSH-Key. Bisher verlangte dieser Provider zwingend einen passwortlos
  funktionierenden SSH-Zugang — auf Rechnern ohne Admin-Rechte für den
  `ssh-agent`-Dienst (typisch auf verwalteten Arbeitsrechnern) war das ohne
  Zweckentfremdung fremder Tools nicht einrichtbar. Neu im Settings-Tab
  „CC (SSH)": ein Passwortfeld, verschlüsselt gespeichert über dieselbe
  `safeStorage`-Infrastruktur wie die API-Keys der anderen Anbieter (an das
  Windows-Benutzerkonto gebunden) und nur beim Verbindungsaufbau kurz im
  Speicher der App entschlüsselt — landet nie unverschlüsselt auf der
  Platte. Technisch über einen lokalen `SSH_ASKPASS`-Helfer (`assets/
  ssh-askpass.cmd`), den `ssh.exe` selbst aufruft; kein neuer Dependency,
  keine Änderung an der bestehenden Verbindungsarchitektur. Key- und
  Passwort-Auth können gleichzeitig konfiguriert sein — SSH probiert Pubkey
  zuerst, fällt erst bei Fehlschlag auf das Passwort zurück.

### Fixed
- **Die SSH-Einstellungen für Claude Code (SSH) waren beim allerersten
  Einrichten unerreichbar.** Der zugehörige Settings-Tab (mit den Feldern
  für Host/Arbeitsverzeichnis) erschien erst, nachdem bereits ein Host
  gespeichert war — ein Henne-Ei-Problem. Die Provider-Zeile in der
  allgemeinen Liste fiel mangels eigener Behandlung zusätzlich auf eine
  irreführende Copilot-Login-Anzeige zurück. Der Tab existiert jetzt immer;
  die Provider-Zeile zeigt einen korrekten Status.
- **Erster Verbindungsaufbau zu einem neuen SSH-Host konnte hängen
  bleiben**, weil die Bestätigung eines unbekannten Host-Fingerprints eine
  TTY voraussetzt, die keiner der SSH-Aufrufe der App bereitstellt. Alle
  drei SSH-Spawn-Stellen nutzen jetzt `StrictHostKeyChecking=accept-new`
  (vertraut einem neuen Host beim ersten Kontakt, verweigert aber weiterhin
  bei einem später geänderten Schlüssel).

## [1.20.0] - 2026-09-22

### Changed
- **`renderer/app.js` in 15 Module aufgeteilt** (8457 → 2640 Zeilen, -69 %),
  damit Änderungen an der App mit weniger Kontext pro Session möglich sind.
  Zwölf neue Dateien unter `renderer/modules/` (u.a. Tab-Verwaltung, der
  zentrale Agent-IPC-Dispatcher, Modell-/Provider-Katalog, Onboarding,
  Plugins/Marketplace, Sessions-Sidebar, Skills/Agents/MCP,
  Provider-Settings, Keyboard-Shortcuts, Drag&Drop, Self-Update, Chat-Suche)
  plus drei bereits bestehende Module vervollständigt (`dev-console.js`,
  `test-runner.js`, `utils.js`). Verhalten unverändert — reine
  Umstrukturierung, nach jedem einzelnen Extraktionsschritt gegen die volle
  Test-Suite verifiziert.
- **Neue `CLAUDE.md`** im Projekt-Root: kompakte Orientierung für neue
  Sessions (Renderer-Modulmuster, wo welche Logik hingehört, Plan-Workflow,
  Commit-Konventionen) — Ergänzung zum ausführlichen `docs/ARCHITECTURE.md`.
- `docs/ARCHITECTURE.md` an die neue Modulstruktur angepasst (Diagramm,
  Dateitabelle, Modulübersicht).

### Fixed
- Ein Regressionstest in `integrity.test.js` verwies noch per Datei-Pfad auf
  `app.js` für Inhalte, die jetzt in `modules/keyboard-shortcuts.js` liegen.

## [1.19.1] - 2026-09-17

### Fixed
- **Claude-Token-Historie blieb dauerhaft leer.** Die Neustart-Erkennung
  verwarf die komplette Messrunde und setzte die Basislinie zurück, sobald
  auch nur einer der vier Zähler (Eingabe/Ausgabe/Cache-Read/Cache-Write)
  gegenüber der letzten Lesung nicht gestiegen war. Da `/usage` große Werte
  gerundet mit K/M-Suffix anzeigt, kippt so ein Einzelwert bei normaler
  Nutzung ständig scheinbar nach unten — in der Praxis wurde dadurch fast
  jede Runde verworfen. Jetzt gilt nur eine sinkende **Gesamtsumme** aller
  vier Zähler als echter Neustart; ein einzeln gesunkener Wert wird auf 0
  geklemmt statt die ganze Runde ungültig zu machen. Die Logik steckt jetzt
  in der eigenständig testbaren Funktion `computeClaudeTokenDelta()`
  (`src/renderer-logic.js`), inklusive Regressionstest für das
  Rundungsszenario.

## [1.19.0] - 2026-09-17

### Added
- **Claude-Token-Historie je 5-Stunden-Limitfenster**, integriert in die
  bestehende Kostenübersicht. Claude liefert keinen Verbrauch aus der
  Vergangenheit — die Historie wird aus den Deltas aufeinanderfolgender
  `/usage`-Lesungen aufgebaut und beginnt deshalb leer. Fenster werden nicht
  in festen 5-Stunden-Schritten zurückgerechnet (Claudes Fenster starten mit
  der ersten Nachricht und liegen dadurch nicht lückenlos aneinander),
  sondern über den bei jeder Messung mitgemeldeten Reset-Zeitpunkt
  identifiziert. Zeigt nur die Tokenmenge; Aufschlüsselung nach
  Eingabe/Ausgabe/Cache im Tooltip.
- **Standard-Reasoning pro Provider.** Neben dem bestehenden Standard-Modell
  gibt es jetzt in den Provider-Einstellungen (Copilot, Claude Code lokal und
  SSH) eine Standard-Reasoning-Stufe. Ein neuer Tab startet mit dieser
  Kombination; das 🧠-Menü überschreibt sie weiterhin pro Tab und Modell.
  Wiederhergestellte oder fortgesetzte Sessions bringen ihre eigene,
  speziellere Zuordnung mit und werden nie überschrieben.

### Fixed
- **Gemini 3.x lehnte jede Anfrage mit HTTP 400 ab**
  (`Please enable tool_config.include_server_side_tool_invocations`), sobald
  Websuche und Datei-Tools kombiniert wurden — eine Regression aus der
  letzten Version. Das nötige `toolConfig`-Flag wird jetzt gesetzt. Da die
  Antwort damit auch die serverseitigen Tool-Aufrufe des Modells (die
  Google-Suche selbst) enthält und das SDK sie nicht von eigenen Aufrufen
  trennt, werden nur die selbst deklarierten Tools ausgeführt — die übrigen
  landen weder in der Ausführung noch in der Historie. 5 Regressionstests
  über eine neue Injektionsstelle für den API-Client ergänzt, da dieser Pfad
  zuvor komplett ungetestet war.

### Changed
- Adapter-Standardversion auf **0.77.0** angehoben (war 0.76.0) — gegen einen
  echten Adapter verifiziert, keine der Änderungen betrifft diese App (Fokus
  auf einer entfernten `agent`-Konfigurationsoption, die hier nie genutzt
  wurde, und einem Permissions-Fix für ein Flag, das diese App nicht setzt).
  Gilt nur für Neuinstallationen.
- Ein weiterer Plan unter `plans/` ergänzt (Token-Verbrauchshistorie).

## [1.18.0] - 2026-09-15

### Added
- **Schalter „Kostenpflichtige Modelle anzeigen"** in den Gemini-Einstellungen.
  Aus bedeutet: kostenpflichtige Modelle verschwinden aus der Auswahl.
  Unabhängig davon — und immer aktiv — zeigt jede Modell-Familie nur noch ihre
  neueste Version: Google bringt alle paar Wochen eine neue Flash-Version
  heraus, ohne die alte zurückzuziehen, sodass sonst 3.5/3.6/3.7/3.8-Flash
  gleichzeitig in der Liste stehen.
- **Gemini 3.x nutzt Websuche und Datei-Tools gleichzeitig.** Bisher erzwang
  die App ein Entweder-oder („Recherche-" vs. „Datei-Modus"), weil Gemini 2.5
  die Kombination von `googleSearch` mit eigenen Funktionsdeklarationen
  ablehnt. Für Gemini 3 hat Google diese Einschränkung aufgehoben; bei diesen
  Modellen sind jetzt beide Werkzeugsätze in derselben Anfrage aktiv und der
  Modus-Umschalter entfällt. Für 2.5 und älter bleibt die Trennung bestehen.

### Fixed
- **Ein Bild auf die App zu ziehen konnte die gesamte Oberfläche ersetzen.**
  Die Drop-Zone war nur die Nachrichtenliste; außerhalb davon griff Electrons
  Standardverhalten, und da der `will-navigate`-Schutz `file://` bewusst
  durchlässt, navigierte das Fenster zur Bilddatei. Jetzt ist das gesamte
  Fenster Drop-Zone — ein Drop direkt auf das Eingabefeld funktioniert also
  ebenso — und im Rich-Text-Modus landet der Pfad im sichtbaren Feld statt im
  ausgeblendeten Textarea.
- **Gemini-Modellauswahl enthielt Dutzende unbrauchbarer Einträge.** Der
  Discovery-Filter prüfte nur auf `generateContent`-Unterstützung, die Googles
  Bild-, Video-, Musik-, Robotik- und Agent-Modelle ebenfalls melden (sie
  teilen sich denselben Endpunkt). Diese werden jetzt wie bei den
  OpenAI-kompatiblen Anbietern herausgefiltert.
- **Jedes neu entdeckte Gemini-Modell war als „kostenpflichtig" markiert**,
  auch Flash und Flash-Lite, die im kostenlosen Kontingent laufen — die
  Einstufung kam pauschal pro Anbieter statt pro Modell. Die hartkodierte
  Modell-Liste machte diese Unterscheidung längst.
- **Falsche Gemini-Preise korrigiert** (bestätigt gegen Googles Preisseite):
  Der Cache-Preis von `gemini-2.5-pro` stand auf 0.31 statt 0.125, und
  `gemini-3.5-flash` war mit dem Preis von 2.5-Flash geraten (per Kommentar als
  unbestätigt markiert) — tatsächlich kostet es rund das Fünffache.

### Changed
- **Aktualisierte Gemini-Modell-Liste** als Rückfallebene vor der ersten
  Discovery: `gemini-3.8-flash` und `gemini-3.5-flash-lite` statt der
  überholten Einträge; `gemini-2.5-pro` bleibt als stabile Pro-Variante.
- **Der Bilder-Bereich in der Seitenleiste blendet sich aus**, solange der
  Bilderordner leer ist. Sobald eine Datei dort liegt, erscheint er wieder —
  der vorhandene Ordner-Watcher erledigt das ohne Neustart.
- Zwei Pläne unter `plans/` ergänzt (Historie-Vorschau und
  Skills/Agents-Discovery für Claude Code über SSH) — noch nicht umgesetzt.

## [1.17.0] - 2026-09-11

### Added
- **Reasoning-Stufe pro Modell** (`Standard`/`low`/`medium`/`high`/`xhigh`/`max`)
  im 🧠-Modell-Dropdown, für GitHub Copilot und Claude Code (lokal wie SSH).
  Jedes Modell merkt sich seine eigene Stufe pro Tab bzw. Session; ein
  Modellwechsel aktiviert die dort hinterlegte Kombination.

  Die Werteliste ist für alle Provider dieselbe feste Menge — Anthropics
  Effort-Parameter ist in der Praxis nicht pro Modell eingeschränkt (Haiku
  bietet dieselben Stufen wie Sonnet). Eine erste Fassung hatte die Stufen
  pro Modell live beim Adapter abgefragt; das war unnötig komplex und wurde
  wieder entfernt.

  Technisch unterscheiden sich die beiden Wege deutlich: Copilot nimmt die
  Stufe als Startargument (`--reasoning-effort`), weshalb eine Änderung den
  ACP-Prozess vor dem nächsten Prompt transparent neu startet und die Session
  per `session/load` zurückholt. Claude Code setzt sie live über
  `session/set_config_option` — ohne Neustart. Ein Rücksprung auf `Standard`
  wird dabei explizit als `value: "default"` gesendet: Der Adapter merkt sich
  eine einmal gesetzte Stufe serverseitig und behält sie über Modellwechsel
  hinweg, „einfach nichts senden" hätte den alten Wert stillschweigend
  weiterlaufen lassen, während die Oberfläche schon `Standard` anzeigt.

- **Providerübergreifende Pläne.** Pläne liegen als Markdown unter `plans/`
  im Projekt und lassen sich in einer Session eines Providers ausarbeiten und
  in der eines anderen fortsetzen — jeder Provider kann diese Dateien ohnehin
  lesen und schreiben.

  Dafür braucht es keine Übertragungsmechanik, sondern nur, dass die Modelle
  die Konvention kennen. Die App pflegt den Text deshalb aus einer einzigen
  Quelle (`~/.agent-desktop/plans.md`) in die globalen Instruction-Dateien der
  installierten ACP-Provider ein (`~/.claude/CLAUDE.md`,
  `~/.copilot/copilot-instructions.md`). Geschrieben wird ausschließlich
  innerhalb eines markierten Blocks, alles andere in diesen Dateien bleibt
  unangetastet; die Quelldatei wird beim ersten Start angelegt und danach nie
  überschrieben. Kein Bedienelement, keine Sidebar-Sektion.

  Noch nicht abgedeckt: die Direkt-API-Provider (deren Systemprompt-Aufbau
  wird zuerst grundsätzlich überarbeitet) und `claude-code-ssh`, dessen
  Instruction-Datei auf dem entfernten Rechner liegt.

### Fixed
- **Abo-Auslastung wurde nicht mehr angezeigt.** Adapter 0.75.0 hat die
  Ausgabe von `/usage` von Fließtext auf Markdown umgestellt
  (`**5-hour limit** — **34%** · Resets …` statt
  `Current session: 34% used · resets …`). Der Parser fand nichts mehr und
  lieferte eine leere Liste — ohne Fehler und ohne Logeintrag, weshalb die
  Anzeige einfach stumm blieb. Beide Formate werden jetzt unterstützt, da die
  Adapter-Version pro Installation gepinnt ist und ältere weiter im Umlauf
  sein können. Zusätzlich wird die Zeitzonenangabe `GMT+2` verstanden (vorher
  nur Klammerform wie `(Europe/Berlin)`), und es gibt eine Warnung im Log,
  wenn `/usage` zwar Text liefert, darin aber kein bekanntes Limit-Format
  steckt — genau diese stille Lücke hatte den Fehler unsichtbar gemacht.

- **Adapter-Update wurde bei jedem Start erneut angeboten.** Die neue Version
  wurde im Hauptprozess direkt auf die Platte geschrieben, während der
  Renderer weiter mit seiner alten Kopie der Einstellungen arbeitete — die
  nächste beliebige Einstellungsänderung schrieb den Pin wieder zurück. Der
  Renderer aktualisiert seine Kopie jetzt mit.

### Changed
- **Die Adapter-Update-Meldung erscheint nur noch im Entwicklermodus.** Das
  Paket erscheint häufig und hat die Anwendung schon gebrochen (siehe den
  `/usage`-Fehler oben), weshalb ein Update keine beiläufige Bestätigung sein
  sollte. Ohne Entwicklermodus entfällt auch die npm-Abfrage samt CLI-Probe;
  beim Einschalten wird sofort geprüft, beim Ausschalten verschwindet ein
  bereits sichtbares Banner.
- **Vorgabeversion des Adapters auf 0.76.0** angehoben (war 0.73.0). Gilt nur
  für Neuinstallationen; eine vorhandene Pin-Einstellung behält Vorrang.
  Gegen einen echten Adapter geprüft: Prozessstart, `session/new`, 5 Modi und
  5 Modelle, `/usage` und `/context` auswertbar.
- Der Entwicklungsplan des Projekts liegt jetzt unter `plans/` statt als
  `plan.md` im Wurzelverzeichnis.

## [1.16.0] - 2026-09-03

### Added
- **New provider: Claude Code (SSH)** — runs the same ACP adapter on a remote
  machine instead of locally, alongside the existing local Claude Code (both
  can be used at the same time, one per tab).

  The point isn't remote compute, it's *where the session lives*: Claude Code
  stores a session next to the process running it and binds it to that
  process's working directory. Running it on e.g. a home server means that
  machine holds the conversation, so any terminal there can pick it up later
  with `claude --resume <id>` — including from a phone over SSH, hours after
  the desktop was shut down.

  - Configured under Settings → Provider → Claude Code (SSH): SSH target
    (`user@host` or a `~/.ssh/config` alias), a default remote working
    directory, and a connection test that reports node/claude versions and
    whether the directory exists — so a misconfiguration surfaces there
    rather than as an opaque failure on the first prompt.
  - **Remote folder picker**, since the OS dialog can only browse this
    machine. Typing remote paths by hand fails silently in a nasty way here:
    a wrong-but-existing path doesn't error, it just binds the session to a
    different directory (and therefore a different `--resume` list).
  - Requires on the remote host: Node.js/npx, the `claude` CLI logged into
    the subscription, and password-less SSH (key-based) — the app has no way
    to show a password prompt.
  - Skills/agents/instructions are not listed for this provider: those folders
    live on the remote host, and showing this machine's would be actively
    misleading. Claude Code still discovers its own over there.
  - No history preview when reopening such a tab yet, for the same reason —
    the transcript is on the remote disk. The session itself is unaffected.

### Security
- SSH command construction lives in `src/ssh-remote.js` and is quoted with a
  POSIX single-quote escape. SSH doesn't pass an argv through — it joins its
  arguments into one string that a shell on the *other* machine executes, so
  an unquoted path containing `;` or `$(…)` would be remote code execution
  rather than a display bug. Covered by tests aimed specifically at escape
  attempts (embedded quotes, command chaining, substitution).

### Changed
- Renamed the last Copilot-only naming left over from before the app went
  multi-provider — none of it changed behavior, purely internal naming that
  no longer matched what the code actually does:
  - The entire preload IPC bridge, `window.copilot` → `window.desktop`. Every
    provider (Claude Code, Anthropic, OpenAI, GLM, Ollama, …) has gone
    through this bridge for a long time; keeping the original name implied
    it was still Copilot-specific.
  - ~15 IPC channels renamed `copilot:*` → `agent:*` (`copilot:send` →
    `agent:send`, `copilot:status` → `agent:status`, etc.), kept in lockstep
    across `main.js`, `preload.js`, `src/acp-client.js`, and
    `src/providers/api-agent-client.js` — these channels already carried
    every provider's traffic, not just Copilot's.
  - `sendCopilotPrompt` → `sendAgentPrompt` (main.js) and `initCopilotIPC` →
    `initAgentIPC` (renderer): both are the generic per-provider dispatch/
    event-wiring functions, not Copilot-specific despite the old name.
  - `COPILOT_BIN`/`COPILOT_CWD`, `readCopilotConfig`, and
    `scanBuiltinCopilotSkills` were deliberately left unchanged — those are
    genuinely Copilot-only (the real CLI binary path, Copilot's own native
    settings file, skills bundled inside Copilot's own CLI package).

No functional change. Verified via a full cross-check that every renamed IPC
channel string still matches exactly between its `main.js` registration and
its `preload.js`/`src/*.js` call sites, plus the full test suite (1624/1624
passing) and lint (0 errors).

### Known issue found (not fixed)
- `agent:openLogDir` (main.js) is registered but never called from the
  renderer — a pre-existing dead handler, unrelated to this rename, noticed
  while cross-checking channel names.


### Added
- Chat messages now show the time they were sent/received, in small muted
  text below each bubble. Only for messages sent or received during the
  current session — the app never persisted a real per-message timestamp
  (only an internal "when did this enter the DOM" value used purely for
  auto-pruning old messages), so restored chat history after a restart shows
  no time rather than a misleading "just now" for messages that could be
  days old.

## [1.13.2] - 2026-08-07

### Fixed
- The "+" new-tab provider dropdown opened right-aligned to its button, so it
  always grew leftward over the chat content — easy to miss, and backwards
  when there was clearly room to the right. Now left-aligned (grows toward
  where the eye already is after clicking "+"), falling back to right-aligned
  only if that would overflow the window edge (mirrors the existing
  `clampMenuToViewportLeft` used elsewhere, via a new `clampMenuToViewportRight`).
- `setup.ps1` trusted `npm install`'s exit code to mean Electron's binary was
  actually downloaded. It isn't the same thing: `npm install` only installs
  Electron's JS wrapper — a postinstall script then separately downloads a
  ~100+ MB binary from GitHub Releases, and that download can fail (e.g. a
  corporate firewall/proxy blocking GitHub) without `npm install` itself
  reporting a non-zero exit code. The script now explicitly checks for
  `electron.exe` after install, retries with `npm install electron --force`
  once, and — if that still doesn't produce the binary — prints an actionable
  explanation instead of just "not found" (including the `ELECTRON_MIRROR` /
  `ELECTRON_GET_USE_PROXY` environment variables relevant on restricted
  networks).

## [1.13.1] - 2026-08-07

### Changed
- Extracted the inline logic behind `context:listSkills`/`context:listAgents`/
  `context:paths` (previously three `ipcMain.handle()` bodies in `main.js`)
  into `src/context-list.js`. The only prior test coverage was a regex
  checking that certain strings appeared in `main.js`'s source — it couldn't
  catch a behavioral regression. The extracted `validateContextTarget`,
  `dedupeFirstWins`, `buildSkillsList`, `buildAgentsList`, and
  `buildContextPaths` are now covered by real, dependency-injected tests in
  `__tests__/context-list.test.js`.
- `context-paths.js`'s `skillDirs`/`agentDirs` now validate the provider id
  against a `[a-z0-9-]+` pattern before joining it into a path, instead of
  relying entirely on the caller's allow-list. Not currently exploitable
  (`validateContextTarget` already blocks unknown providers upstream), but
  the module itself wasn't self-defending — and the existing test claiming
  to prove that (`context-paths.test.js`) only checked that no literal `..`
  remained in the *normalized* output, which `path.join` guarantees anyway
  regardless of whether the resolved path actually escaped the data
  directory. Both the guard and the test are fixed now.
- `loadContextForTab()` (renderer) no longer risks a slower, superseded
  request overwriting a faster, newer one when switching tabs quickly — a
  generation counter discards responses that arrive after a more recent
  request for a different tab/project has already started.

Found via a self-review of the previous two releases' skill-management
rework (quality + security audit), not a user-facing bug.


### Removed
- **The Skill Manager (hide/disable/its dedicated overlay) is gone.** It never
  fit the provider-aware model from 1.12.0: "disabled" and "hidden" were
  stored in Copilot's own `~/.copilot/settings.json`, yet filtered the sidebar
  for *every* provider — disabling a skill for Copilot silently hid it from
  Anthropic/Ollama tabs too, where the setting has no meaning at all. Rather
  than patch that cross-contamination, the mechanism is removed entirely:
  skills and agents are now managed where they live, in each provider's own
  folder (see 1.12.0's `src/context-paths.js`). The sidebar shows exactly what
  a provider can see — nothing to hide, nothing to disable on top of that.
- Deleting a user skill/agent from the sidebar is gone with it — same reason:
  the old handlers assumed a single Copilot-shaped layout and would have
  needed the same per-provider rework the rest of this area just got.
- Four test files that only exercised the removed feature
  (`skill-manager(-renderer)`, `skills-disabled(-renderer)`).

### Changed
- `renderSkills()`/`renderAgents()` no longer filter their input — the list
  from `context:listSkills`/`context:listAgents` already *is* exactly what the
  active tab's provider can see, so filtering again could only ever hide
  something that should be visible.

## [1.12.0] - 2026-08-03

### Changed
- **Skills and agents are now resolved per (provider, project) instead of being
  merged from three provider-agnostic lists.** Which skills exist depends on
  *both* the provider and the open project — each provider reads different
  folders — so there is no provider-neutral answer, and pretending otherwise
  is what made the sidebar unreliable. A new `src/context-paths.js` is the
  single place that answers "which folders does this provider read?", and both
  the sidebar and the prompt injection go through it, so the UI can't drift
  from what the model actually sees.

  | Provider | Global | Project |
  |---|---|---|
  | Copilot | `~/.copilot/skills` + builtin + marketplace mirror | `.github/skills` |
  | Claude Code | `~/.claude/skills` | `<cwd>/.claude/skills` |
  | Direct-API | `~/.agent-desktop/<provider>/skills` | `<cwd>/.agent-desktop/skills` |

  Agents follow the same pattern. Direct-API providers moved off `.github/`
  deliberately: that's GitHub Copilot's convention, not a cross-vendor
  standard, and reusing it made app-managed files look like Copilot's.

- **Three IPC handler pairs collapsed into `context:listSkills` /
  `context:listAgents`** (plus `context:paths` so the UI can tell the user
  where to put a file). The renderer no longer merges `list` +
  `listProvider` + `listProject` results and guesses which apply where.

- **Scanners are fully async** (`fs/promises`, files read in parallel). They
  run in the main process, which is the bottleneck for every window and all
  IPC — with sync `fs`, a project with many skills on a slow drive (network
  share, OneDrive sync, virus scanner) stalled the whole app on every tab
  switch. Also skips redundant work entirely when provider *and* project are
  unchanged, the common case when switching between two tabs of one project.

### Fixed
- **Sidebar ⋮ menus stopped opening** — clicking one only collapsed the
  section. Regression from moving the inline handlers to delegated listeners:
  the ⋮ button sits inside the section header, so `closest()` matched the
  header first and returned before reaching the menu branch. A single
  delegated listener can't `stopPropagation()` against itself, which is what
  the old inline `event.stopPropagation()` had handled.
- **Claude Code lost its project skills on resumed sessions.** The app
  injected a `.github/skills` index into the prompt, but only for *newly
  created* sessions — resuming silently dropped them. The injection is gone
  entirely: Claude Code discovers `.claude/skills` itself, in both new and
  resumed sessions, and the sidebar now shows that folder instead of the
  `.github` one it never read on its own.
- Skills a provider cannot see are no longer listed in the sidebar, and ones
  it can see (Claude Code's `<cwd>/.claude/skills`) are no longer hidden.

## [1.11.0] - 2026-08-03

### Security
- **Removed every inline event handler** (`onclick`/`onchange` in static markup
  and in dynamically rendered list items — Skills, Agents, Sessions, Skill
  Manager, Plugins, Todos, tag lists, the test runner's suite toggle) in favor
  of delegated listeners reading `data-*` attributes. HTML-attribute escaping
  doesn't protect an inline handler: the browser decodes entities before the
  JS parser sees them, so a crafted skill/agent name (including from an
  auto-mirrored marketplace plugin) or a todo id (parsed from a project's
  `todo/todos.md`) could have broken out of the string and run arbitrary code
  with full access to the `window.copilot` bridge.
- **Tightened the CSP**: `script-src` is now `'self'` only (dropped
  `'unsafe-inline'`), now that nothing depends on it.
- **`npm audit fix`**: patched a DOMPurify XSS (hit on every markdown render —
  the app's main render path) and a protobufjs DoS.
- **Electron 35.7.5 → 43.2.0**, closing a high-severity advisory in Electron
  itself. Every documented breaking change for v36–43 was checked against this
  app's actual API surface (`app`, `BrowserWindow`, `ipcMain`, `shell`,
  `dialog`, `nativeImage`, `contextBridge`, `ipcRenderer`, `webUtils`,
  `safeStorage`) — none apply; no native modules to rebuild. `npm audit` now
  reports 0 vulnerabilities.
- **Versioned the pre-commit hook** (`.githooks/pre-commit`, wired via a new
  `prepare` script setting `core.hooksPath`) — it previously lived only in
  the local `.git/hooks/`, so a fresh clone got no lint/test gate at all.
  Added a matching minimal CI workflow (lint + tests on push/PR).

### Fixed
- **Auto-scroll stopped following new messages.** Batching `scrollToBottom()`
  into one call per animation frame (perf work, see below) introduced a race:
  content appended in the gap between insertion and the deferred scroll made
  the view look "scrolled away", which permanently latched auto-scroll off.
  It's now driven by actual upward scroll intent instead of position alone.
- **Tab-switch could hang for ~1-2s.** Root cause was twofold: `readMcpConfig()`
  shelled out to `copilot mcp list --json` *synchronously* on every session
  start/load (blocking the entire main process, all windows, for up to the
  CLI's cold-start time), and resuming a session rendered its *entire* history
  into the DOM immediately, making the subsequent `display:none → block`
  toggle a full-tree forced layout. Both fixed (see Performance).
- **`playNotificationSound` cost 170+ ms the first time it fired** — profiling
  showed this was `new AudioContext()`'s first-time construction cost, which
  happened to land on whichever tab-switch/background-completion triggered
  the first notification. Now pre-warmed at startup where the cost is
  invisible.
- **MCP server status could get stuck showing "disconnected"** even once a
  session was actively using it — the background reachability probe (a raw
  unauthenticated request) could false-negative on an OAuth-protected server
  and then permanently overwrite the correct live status reported by the
  session itself. Live-confirmed status now wins and is never downgraded by
  the probe.
- **Model-select button could show a stale label** (e.g. "Opus 4.8" after the
  account moved to "Opus 5") for Claude Code's alias-based model ids
  (`opus`/`sonnet`/`haiku`) — it looked up the hardcoded fallback list before
  the live-discovered one instead of after.
- Removed the unused `exportChat` feature (button, shortcut, docs), the
  "Beta" badge on Claude Code, and filtered the new-tab provider menu down to
  providers with an actual working connection.

### Changed / Performance
- **Streaming responses no longer re-run syntax highlighting on every delta.**
  `hljs.highlightAuto()` recompiles a language's grammar into fresh
  RegExp/mode objects on *every* call with no cross-call caching — re-running
  it, on the whole accumulated response, every ~100ms while text streamed in
  was the dominant cause of jank and memory churn on long responses. A fast
  render mode now skips highlighting during streaming (still fully formatted:
  bold/lists/headers/code blocks, just without color) and the real one runs
  once the message settles.
- **Chat history is no longer unbounded in the DOM.** Content older than 30
  minutes is detached and kept in memory, reloading in on scroll-to-top like
  reverse infinite scroll. Resuming a session now renders only the most
  recent 20 messages live; older ones load the same way — a long-lived
  session used to dump its *entire* history into the DOM the instant it was
  reopened.
- `readMcpConfig()`/CLI version checks moved off the main-thread-blocking
  `execSync` onto async `spawn`, with a 5-minute per-cwd cache.
- `scrollToBottom()` batched to one real scroll per animation frame instead of
  one forced layout per streamed event.
- `renderer/app.js` now has a lightweight `[perf]` logging hook around
  `switchTab()` for future diagnosis via the in-app Developer Console.

### Added
- Drag-and-drop tab reordering.
- A DevTools button in the sidebar's dev-mode row.
- A small update-check button next to the version label.
- Nested lists in the rich-text editor (Tab/Shift+Tab to indent/outdent).
- Tab-dependent skill toggles — a skill force-activated in one tab no longer
  silently applied to every other open tab.

### Testing
- Provider-layer coverage: `src/providers/agent-tools.js` (25% → 99%),
  `src/providers/api-agent-client.js` (28% → 99%), `src/model-discovery.js`
  (48% → 98%), `src/pricing-source.js` (56% → 98%) — the deny-list
  enforcement and the agentic tool loop were previously the least-covered,
  most security-relevant code in the app.
- Project-wide: 73.95% → 83.32% statements, 63.04% → 71.44% branches,
  1444 → 1617 tests.

## [1.10.1] - 2026-07-28

### Changed
- **Applied the rest of the `docs/redesign-mockup.html` direction** that the
  earlier flattening pass (1.9.0) hadn't covered yet: structural area
  dividers (tab bar, session-actions bar, and the faint separators between
  collapsed tabs) now use the soft `--border-subtle` instead of the harder
  `--border`, matching the mockup's less "boxed-in" look. Chat messages
  moved to the mockup's finer typography — 14px instead of 16px, tighter
  line-height, more generous outer padding — and the user message bubble
  dropped its bold weight and got the same rounder corners as the mockup
  (`14px 14px 3px 14px`); the assistant bubble got matching corners. Tab
  labels shrank from 16px to 13px to match.

## [1.10.0] - 2026-07-28

### Removed
- **Chat export feature** (`btnExportChat`, `exportChat()`, the `Ctrl+E`
  shortcut and its docs) — the Markdown export was unused and not worth the
  UI real estate.
- **"Beta" badge for Claude Code** in the provider selector/labels; Claude
  Code is now treated as stable like Copilot. Gemini keeps its Beta badge.

### Changed
- **New-tab provider menu now only lists providers with an actual working
  connection** (Copilot always, Claude Code once its CLI is installed,
  direct-API providers once a key/base URL is stored) instead of showing all
  providers with "Key nötig"/"in Vorbereitung" hint badges. Extracted the
  connectivity check into a shared `getConnectedProviders()` helper, reused
  by both the new-tab menu and the Settings dialog's dynamic provider tabs
  (`getConnectedProviderConfigs()` now builds on top of it). Removed the
  now-dead, redundant `PROVIDERS` array that predated `PROVIDER_SETTINGS`.

## [1.9.1] - 2026-07-28

### Fixed
- **Startup crash: `initChatInput` threw on `document.getElementById('sessionSearch').addEventListener(...)`**,
  aborting the rest of `DOMContentLoaded` (window controls, session tools
  popup, settings wiring, keyboard shortcuts, tooltips, … — everything
  queued after the failing call never ran). Leftover from the sidebar ⋮-menu
  redesign: `#sessionSearch` moved from a static, always-present element to
  one created only while the Sessions section's menu is open (its real input
  listener already lives in `openSectionMenu`'s `SECTION_MENUS.sessions.wire`)
  — this one static registration at startup was missed. Removed it, and
  hardened a second, non-crashing but equally stale reference in
  `resumeSessionById` with a null-check.

## [1.9.0] - 2026-07-28

### Changed
- **Flattened the app's "loud" secondary buttons**, implementing the design
  direction agreed on in `docs/redesign-mockup.html` (design discussion via
  `/grill-me`: filled-background + 1px-border + 36px-height buttons
  everywhere read as boxy/cramped). Scope matches exactly what the mockup
  showed — this does **not** touch `.action-btn` (Settings/dialog buttons),
  which wasn't part of it:
  - **Sidebar footer** (Tests/DevConsole/Settings): new dedicated
    `.sidebar__footer-btn` class — transparent background, no border, 32px,
    background only on hover. Settings pushed to the right via a new
    `.sidebar__footer-spacer`.
  - **Session-actions bar** (Model/Mode/Context/Tools pills): `.session-actions__btn`
    dropped its border and filled background for a transparent pill
    (`border-radius: 20px`) that only gets a background on hover; the
    `--active` state keeps its accent fill (a deliberate "this is selected"
    signal, not decoration).
  - **Chat input row**: `.chat-terminal-btn` (rich-text toggle, export)
    flattened the same way; `.chat-send` is now the sole filled/colored
    button in the whole row — the one primary action, slightly reduced to
    34px/10px radius.
  - Increased padding on the sidebar footer and chat input bar for more
    breathing room; softened their separator lines from `var(--border)` to
    `var(--border-subtle)`.
- **Documented the redesign mockup** (`docs/redesign-mockup.html`) —
  self-contained HTML, real dark-theme CSS variables, used to align on the
  direction before implementing. Left intentionally unstyled in scope:
  native emoji icons (kept as-is, matching the app's existing icon choice —
  not part of this pass) and the Settings dialog / Plugin Manager (their
  entry points are shown, not their full UI).

## [1.8.1] - 2026-07-25

### Removed
- **Sidebar collapse-to-icon-bar feature removed entirely** (◀ footer
  button, `Ctrl+B` shortcut, `.sidebar--collapsed` hover-to-expand CSS
  behavior, `sidebarCollapsed` pref). First step of a larger visual
  cleanup pass (design discussion via `/grill-me`) — a mockup for the
  rest (footer/send/rich-text button redesign) follows separately.

### Changed
- **Session-card provider icon shrunk** to 13×13px with a `-3px` top
  nudge, scoped to `.session-card__provider .provider-icon` only — the
  tab bar's own provider icon (`.tab__provider-icon`) is untouched.

## [1.8.0] - 2026-07-25

### Changed
- **Sidebar redesign**: decluttered session cards and section headers by
  moving secondary actions behind ⋮ menus (design pass via `/grill-me`).
  - **Session cards**: the always-two-icon 📁/🗑️ row is gone, replaced by a
    single hover-revealed **⋮** button (`openSessionCardMenu`) with
    **✏️ Umbenennen** (new — sessions could never be renamed before, only
    tabs could), **📁 Ordner festlegen/ändern**, and **🗑️ Session löschen**.
    Rename uses the same in-place-input pattern as tab rename
    (`startSessionRename`).
  - **Section header badges removed entirely** (Sessions/Skills/Agents/MCP/
    Todos/Images count/status pills) — no replacement, per explicit
    decision to keep it clean rather than move the info elsewhere.
  - **Section header ⋮ menus** (`openSectionMenu`, always visible — unlike
    the per-card ⋮, there's only one per section so hover-hiding it serves
    less purpose): Skills gets ↻ Reload + ⚙️ Skill-Manager; Agents gets ↻
    Reload; Todos gets its "New todo…" input (Enter-to-add, the old ➕
    button is gone) + 🔄 "next 5 todos to chat"; Sessions gets the search
    field. MCP/Images keep their header as just chevron + label (no ⋮ menu)
    since neither has anything to put in one.
  - **Sessions search moved into its section's ⋮ menu**: auto-focuses on
    open, filters the list live while typing, and — since it's a "find &
    open" tool rather than a persistent view filter — resets back to the
    full list the moment the menu closes (whichever way: picking a result,
    outside click, or Escape).
  - All three menu types (section header, session card, and the pre-existing
    "+" new-tab provider chooser) share the same fixed-positioned,
    outside-click-closing dropdown pattern, so none of them are ever
    clipped by the sidebar's scrollable lists.

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

# Sessionuebergreifende Skills-Verwaltung

## Ziel
Sessionbezogene Skill-Auswahl findet ausschliesslich in den Session Actions
statt. Funktionen / Skills wird zur sessionunabhaengigen Verwaltung.

## Genehmigte Anforderungen
- Funktionen SHALL keine Toggles fuer aktive Skills eines Tabs mehr enthalten.
- Funktionen SHALL ausschliesslich benutzerweit verfuegbare Skills anzeigen,
  keine aus dem Projekt der aktuell ausgewaehlten Session.
- Provider-spezifische Skills SHALL nach Provider getrennt gelistet werden.
  Providersektionen stehen in voller Breite untereinander: Copilot zuerst,
  Claude Code danach, übrige in bestehender Reihenfolge. Nur verbundene
  Provider gemäß `getConnectedProviders()` erscheinen, unabhängig vom Tab.
  Gemeinsame Quellen erscheinen innerhalb der relevanten verbundenen Provider.
  Keine Gleichsetzung allein anhand gleicher Namen.
- Die Verwaltung SHALL unabhaengig vom aktiven Tab sein und auch ohne
  geoeffnete Session funktionieren.
- Bestehende Verwaltungsaktionen SHALL soweit fuer die jeweilige Quelle
  unterstuetzt erhalten bleiben. Keine globale Aktivierung als Ersatz fuer
  entfernte Tab-Toggles. Ergänzung 2026-10-27: ausdrücklich genehmigte native
  globale Copilot-Konfiguration, semantisch getrennt von Tab-Toggles.
- Das Dropdown in den Session Actions SHALL weiterhin alle fuer den aktiven
  Tab verfuegbaren Skills inklusive Projektskills und deren Auswahl zeigen.
- Verwaltungsaktionen SHALL betroffene Sessionlisten aktualisieren, ohne
  die Auswahl anderer, weiterhin verfuegbarer Skills zu verlieren.

## Aufgaben nach Freigabe
- [x] Globale und projektbezogene Skill-Quellen sowie Providerzuordnung pruefen.
- [x] Tabunabhaengiges Laden und providergruppierte Verwaltungsansicht umsetzen.
- [x] Tab-Toggles aus Funktionen entfernen, Session-Dropdown erhalten.
- [x] Quellenabgrenzung, Tabwechsel und Verwaltungsaktionen testen.
- [x] Benutzerhandbuch und Projektnotiz aktualisieren.

## Status
Genehmigt und implementiert am 2026-10-26.

## Quellen und Grenzen
- `context:listGlobalSkills` akzeptiert keine Renderer-Pfade; globale Quellen
  werden mit `skillDirs(provider, null)` und bestehendem Copilot-Override aufgeloest.
- Copilot: `.copilot/skills`; Claude Code: `.claude/skills`; direkte API-Provider:
  bestehende appverwaltete Providerordner aus `context-paths.js`.
- Gemini hat keine unterstuetzte Quelle, Claude Code SSH keine lokal lesbare.
  CLI-Builtins und Projekte werden in der Verwaltung nicht gescannt.
- Keine neue Editor-/Dateischreib-API: bestehende Verwaltung erfolgt in den
  Providerordnern; Neu laden und Pluginaktionen aktualisieren globale und
  aktive Sessionliste. Inaktive Tabs laden beim Wechsel neu; ihre Auswahl bleibt.
- Fehlende Ordner sind leer, echte Lese-/Parsefehler werden pro Quelle angezeigt.

## Validierung
- 92 gezielte Jest-Tests bestanden (Discovery, Quellen, Renderer, Scanner).
- Browser-UI: globale Ansicht ohne Tab/Tabwechsel und bestehendes
  Session-Skills-Dropdown mit Tastaturbedienung bestanden (Playwright, Edge).
- Gezieltes ESLint: keine Fehler; drei bereits vorhandene Warnungen in main.js.
- `git diff --check`: keine Whitespace-Fehler.

## Genehmigte Erweiterung 2026-10-27: native Copilot-Aktivierung

- [x] Globale Copilot-Quellen und Aktivstatus aus `skill list --json`.
- [x] `skill enable/disable <name>` ohne Shell, mit aktueller
  backendseitiger Provider-/Katalogidentitätsprüfung und Status-Nachprüfung.
- [x] Namensgleiche Quellen gemeinsam berücksichtigen, keine Fake-Schalter
  für andere Provider, keine zweite App-Konfiguration.
- [x] Aktive Sessionliste nach Mutation neu laden; Tabauswahl unabhängig erhalten.
  Deaktivierte Namen vor App-Promptanreicherung erneut nativ prüfen (fail closed).
- [x] Ohne Tab bedienbar, Lade-/Mutationsfehler sichtbar, Neu laden weiterhin möglich.
- [x] Isolierter Live-Test: Fortsetzung, neuer Prozess mit `session/load`
  derselben eigenen ID und frische Session. Keine vorhandene Nutzersession verändert.
- [x] Keine unbewiesene Zusage, dass Neustart/Resume/neue Session genügt:
  native Konfiguration bestätigt, ACP-Laufzeitwirkung nicht nachgewiesen.
- [x] Gezielte Jest-/Browserregressionen, Dokumentation und Vault-Pflege.

Die frühere Beschreibung der Copilot-Verzeichnis-Discovery ist für die
globale Copilot-Verwaltung durch den nativen Katalog ersetzt. Projekt/Builtin-
Filter gelten weiterhin für die Verwaltung, nicht für namensweite CLI-Wirkung.
Live-Evidenz, tatsächliche CLI-Version, Prompts und Grenzen:
`docs/NATIVE-SKILLS-LIVE-TEST.md`.

## Genehmigte Darstellung 2026-10-27

- Provider werden mit dem vorhandenen `getConnectedProviders()`-Datenfluss
  gefiltert, nicht anhand von Tabs oder Skillordnern. Dessen bestehende
  Verbindungsdefinition (einschließlich Copilot als immer verfügbar) bleibt
  unverändert; es wird keine zusätzliche Login-Definition eingeführt.
- Globale Quellen und Verbindungsstatus laden parallel; Generationenschutz
  verwirft veraltete Antworten. Seitenöffnung, Neu laden, Fensterfokus und
  Providerkonfigurationsänderungen aktualisieren die Darstellung.
- Jede Providersektion belegt die volle Breite; geteilte Quellen stehen
  innerhalb ihrer verbundenen Provider, nicht als zusätzlicher Provider.
- Innerhalb jeder Quelle stehen Skills als Kacheln in drei Spalten ab 840px
  Providerbreite, zwei ab 540px und sonst einer Spalte; Provider bleiben
  untereinander, ohne horizontalen Überlauf.
- Standardtoggles bleiben erhalten; unsupported bleibt disabled/indeterminate,
  Tooltip und Aria nennen nur „Status unbekannt“.
- Validiert: 43 gezielte Jest-Tests, drei isolierte Edge-Browsertests inklusive
  vertikalem Layout, vollständiger ESLint ohne Fehler, `git diff --check`.
  Keine Nutzer-App gestartet, keine echten Login-/Skilländerungen.

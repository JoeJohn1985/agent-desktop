# Native Copilot-Skill-Konfiguration: Live-Evidenz, 2026-10-27

## Verfahren und Schutz

Ein eindeutig benannter harmloser Testskill
`agent-desktop-native-probe-20261027` lag ausschließlich in einem eigenen
`COPILOT_HOME` unter dem Repository. Eigenes leeres Arbeitsverzeichnis,
eigene Logs, keine Projektdateien, Hooks oder MCP-Konfiguration übernommen;
`--no-custom-instructions --disable-builtin-mcps --sync-session=off`.
Keine vorhandene App gestartet/gestoppt, keine vorhandenen Sessions geladen,
keine echten Skills deaktiviert. Konfigurationsänderungen nur im isolierten Home.
Lokale Accountselektoren (keine Tokens) erlaubten die bestehende
Credential-Verwaltung zu verwenden. Keine privaten Projektinhalte als Prompt.

Die erste vollständig isolierte ACP-Initialisierung ohne Accountselektoren
scheiterte an `Authentication required`. Ein Metadata-only-Durchlauf erzeugte
eine neue Session, persistierte diese aber nicht ausreichend: `session/load`
meldete `Resource not found`. Deshalb folgten zwei kontrollierte Durchläufe
mit je vier minimalen harmlosen Prompts und jeweils eigenen Sessions.

## Version und unbeabsichtigter Nebeneffekt

Die erste Versionsauskunft war **1.0.103**. Bei einer frühen Hilfe-/Katalogabfrage
ohne `--no-auto-update` griff der native Auto-Updater ein; die späteren
Live-Proben liefen nachweislich mit **1.0.104**. Es wurde kein Update bewusst
installiert und keine bestehende App oder CLI-Session neu gestartet.
Alle eigentlichen Proben und die neue App-Verwaltung verwenden
`--no-auto-update`. Die folgenden Ergebnisse sind **kein 1.0.103-Nachweis**.
Die gemeinsam verwendete Installation wurde nicht blind zurückgeschrieben.

## Ergebnis

- `skill list --json`: Testskill vor Mutation `enabled: true`,
  nach `skill disable <testname>` **`enabled: false`**.
  Native persistente Konfiguration damit direkt bestätigt.
- Bereits geladene ACP-`available_commands_update`-Kataloge enthielten den
  Namen vor Disable und wurden durch die externe Mutation nicht entfernt.
- Neue Prozesse: `session/load` der eigenen, durch den ersten Prompt
  persistierten ID gelang; ebenso `session/new` mit anderer ID.
  **Beide Metadatenkataloge enthielten weiterhin das Testskill-Kommando.**
- ACP lieferte in diesen Proben keine `skills_loaded`-Ereignisse. Daher ist
  der Kommandokatalog nicht als Beweis für automatische Skill-Nutzung geeignet.
- Im zweiten Durchlauf wurde ausschließlich nach Vorkommen des Testnamens
  im aktuellen System-Skillkatalog gefragt, ohne Werkzeuge oder Skills zu
  benutzen. Antwort vor Disable, bei Fortsetzung, nach Resume und in frischer
  Session jeweils **YES**. Das ist Modellselbstauskunft, kein belastbarer
  Nachweis der wirksamen Tool-/Skill-Sperre.
- Beispiel erfolgreicher Resume: eigene ID
  `5ed931f6-7e3e-4682-9158-fd442eeb2c3b`, danach frische eigene ID
  `7e6a7d09-4c9c-4ffa-a0a3-2bec667523c3` (erster Prompt-Durchlauf).

**Fazit:** Native Konfiguration funktioniert. Dass deaktivierte Skills aus
dem effektiven ACP-Kontext verschwinden, ist nicht nachgewiesen; weder
Prozessneustart/Resume noch neue Session darf als gesicherte Lösung genannt
werden. Bereits im Gespräch enthaltene Skillanweisungen werden ohnehin nicht
rückwirkend entfernt. Die App verhindert unabhängig davon eigene explizite
Promptanreicherung deaktivierter Namen.

## Prompts, Modell und Kosten

Insgesamt **acht erfolgreiche Minimalprompts**, keine Skill-/Werkzeugaufrufe:
viermal „Reply exactly TEST. Do not use any tools or skills.“ und viermal
YES/NO-Abfrage des ausschließlich künstlichen Skillnamens im Systemkatalog.
Angefordert war `claude-haiku-4.5`; die CLI meldete, dass dieses Modell nicht
mehr verfügbar sei, und verwendete **`claude-sonnet-5.5`**.
Es wurden also kostenrelevante Modellanfragen ausgeführt. Ein genauer
Geldbetrag wurde von der Probe nicht erhoben und wird nicht behauptet.

ACP-Usage (Input/Output pro Antwort; einige Werte sind kumulativ und dürfen
nicht als unabhängige Request-Kosten summiert werden):

| Durchlauf | Initial | Fortsetzung | Resume | Neue Session |
|---|---|---|---|---|
| TEST | 23917 / 5 | 47895 / 10 | 24039 / 5 | 23919 / 5 |
| Katalogfrage | 23981 / 4 | 48087 / 8 | 24231 / 4 | 23982 / 4 |

## Cleanup und Grenzen

Alle eigenen ACP-Kinder beendet; eigenes `COPILOT_HOME`, Sessions, Fixture,
Konfiguration und Logs rekursiv entfernt und Nichtexistenz geprüft.
Keine ganze gemeinsame Benutzerkonfiguration zurückgeschrieben.
Probe-Skript und rohe Ergebnisdateien nach Auswertung entfernt.
Die einzige bekannte gemeinsame Zustandsänderung ist das oben genannte
native CLI-Auto-Update. Keine Commits, Releases oder Pushes.

Eine definitive Tool-Sperre beziehungsweise automatische Skillaktivierung
wurde nicht getestet: keine echten Skills/privaten Inhalte verwendet und keine
weiteren kostenpflichtigen Versuchsreihen gestartet. Ein zusätzlicher
CLI-/ACP-seitiger Fix oder eine gesonderte Ursachenanalyse kann erforderlich sein.

## App-Regressionen

322 gezielte Jest-Tests in acht Suites bestanden (native CLI-Ausführung,
Identitätsprüfung, Fehler, Quellen, Prompt-Fail-Closed, Kontext, Scanner,
Renderer und Integrität). 13 isolierte Playwright-Prüfungen mit Edge bestanden,
einschließlich Bedienung ohne Chat, namensgleicher Quellen, Statuswechsel,
Fehlerdarstellung und bestehender Session-Actions.
Gezielter ESLint ohne Fehler (drei bestehende Warnungen in `main.js`);
`git diff --check` ohne Whitespace-Fehler.

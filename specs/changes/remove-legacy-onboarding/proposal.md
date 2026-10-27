# Veraltetes Onboarding entfernen

## Freigegebener Umfang

Der Erststart führt direkt in die bestehende Chat-Oberfläche. Wizard,
Tutorial-Popups, Reset-Einstellung und ausschließlich dafür verwendete
Setup-/Status-IPC werden entfernt. Der Lade-Splash wird weiterhin auch bei
Startup-Fehlern geschlossen. Authentifizierung, Provider-Konfiguration,
normale Einstellungen und vorhandene SessionActions-/Skills-Änderungen bleiben.
Bestehende Konfigurationsdateien, Skills, Agents und alte Flags werden nicht
gelöscht oder migriert; ungenutzte Flags bleiben wirkungslos.

## Abnahme

- Kein Wizard-Markup, -Modul, -CSS oder Reset-Listener mehr.
- Kein Erststart-Gate, keine automatisch erzeugten Setup-Sessions.
- Login und Provider-Einrichtung weiterhin regulär erreichbar.
- Gezielte Regressionen, Integrity-Test, ESLint und Diff-Check erfolgreich.
- Keine App starten/stoppen, kein Commit/Push.

## Aufgaben

- [x] Gesamte Runtime-Verkabelung und exklusive Setup-Abhängigkeiten untersuchen.
- [x] Runtime, UI und veraltete Dokumentation bereinigen.
- [x] Tests aktualisieren, Startup ohne Wizard prüfen und Checks ausführen.
- [x] Projektstand im Vault minimal aktualisieren.

## Verifiziert

342 Tests in acht gezielten Jest-Suites erfolgreich, darunter tatsächliche
Startup-Callback- und Auth-Handler-Ausführung im VM-Kontext ohne App-/Terminalstart.
Normale Auth- und Todo-Testfälle aus gemischten Altsuites sind erhalten.
Die bestehende Integrity-Fixture wurde um den fehlenden Mock für die bereits
vorhandene Session-Skills-Auswahl ergänzt. Globaler ESLint: keine Fehler,
20 bestehende Warnungen außerhalb der neuen Tests. `git diff --check` erfolgreich.
Keine visuelle App-Abnahme und kein Paketbau durchgeführt.

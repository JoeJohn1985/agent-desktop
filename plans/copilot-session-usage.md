# Copilot-Sitzungsverbrauch

## Ziel

Den gesamten CLI-protokollierten AIC-Verbrauch der Sitzung und sein
Dollaräquivalent anzeigen, ohne Aufgabenabrechnung oder Tokenpreis-Schätzung.

## Design-Entscheidungen

- `session.usage_checkpoint.data.totalNanoAiu` aus `events.jsonl` ist die Quelle.
- 1.000.000.000 Nano-AIC entsprechen einem AIC; 100 AIC entsprechen einem USD.
- Keine Schätzung bei fehlenden oder ungültigen Verbrauchsdaten.
- Historische Schätzungen bleiben gespeichert, werden für Sitzungen mit
  bestätigten CLI-Daten aber aus der Kostenansicht ausgeblendet.
- Andere Provider bleiben unverändert.

## Tasks / Status

- [x] Fehler und tatsächliche CLI-Verbrauchsfelder untersucht.
- [x] Reader, IPC, Sitzungsanzeige und Kostenansicht verdrahten.
- [x] Wiederherstellung und Fehlerfälle absichern.
- [x] Gezielte Tests, Dokumentation und Vault aktualisieren.

## Ergebnis

458 gezielte Tests erfolgreich. Reader an der betroffenen realen Sitzung
verifiziert: 56,927473 AIC beziehungsweise 0,56927473 USD insgesamt.
Version 1.26.1. App nicht neu gestartet; Darstellung im laufenden Fenster
nach Laden des neuen Quellstands noch offen. Kein Commit und kein Push.

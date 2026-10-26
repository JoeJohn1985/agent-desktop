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

## Erweiterung 2026-10-13: Sessionkosten heute

Freigegebene Definition und Contracts: `specs/changes/sessionkosten-heute/spec.md`.

- [x] CLI-Checkpoint- und Usage-Record-Quellen verfolgt; gemeldete Nano-AIC
  nur bei exakter Reconciliation zeitlich feiner zugeordnet.
- [x] Tageslogik (lokale Kalendergrenzen/DST), persistente Einträge, Tooltip
  mit Gesamtkosten und explizit unvollständige Tageszuordnung integriert.
- [x] Restore/Resume, Modellwechsel, Tabwechsel, Mitternacht/Fokus abgesichert.
- [x] Gezielte Unit-/IPC-/Logik-/Provider-/Restoretests: 434 Tests in 7 Suites erfolgreich.
- [x] Vollständiger Lint erfolgreich: 0 Fehler, 36 bestehende Warnungen;
  `git diff --check` erfolgreich.
- Visuelle Abnahme ausschließlich durch Nutzer; App nicht starten.
- Vault-Pflege durch Elternagent; kein Commit/Push.

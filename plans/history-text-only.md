# Geladener Verlauf: reine Nachrichtenanzeige

## Freigegebener Umfang
- Restore und History-Preview zeigen ausschließlich Nutzer-/Assistententext.
- Native Toolaufrufe, Ergebnisse und Reasoning erzeugen keine Anzeigeelemente;
  Text gemischter Nachrichten bleibt erhalten.
- Nachrichten verwenden das Live-Markup ohne Historien-Abdunklung.
- Native Sessiondaten, Modellkontext, Live-Tools und Reasoning bleiben unverändert.
- Lazy Loading, Reihenfolge und vorhandene Timestamp-Behandlung bleiben erhalten.
- Kein Versionswechsel, Commit/Push oder Eingriff in die laufende Nutzer-App.

## Umsetzung und Prüfung
- [x] Restorepfade und Live-Markup prüfen; Historienrenderer/CSS anpassen.
- [x] Regressionstests für Providerformate, leere Toolnachrichten und Lazy Loading.
- [x] Gezielte Tests, ESLint und Diffprüfung; Dokumentation/Vault aktualisieren.

## Ergebnis
37 gezielte Jest-Tests erfolgreich, vollständiger ESLint ohne Fehler
(20 bestehende Warnungen), `git diff --check` erfolgreich.
Das Live-Markup verwendet bereits direkten Markdown-Inhalt in
`stream-response markdown-body`, keine Header-/Body-Wrapper.
Gespeicherte App-Tabs durchlaufen denselben `displaySessionContext`-Restore.
Copilot- und Claude-Textprojektion erzeugen keine künstlichen Toolplatzhalter;
leere Copilot-Toolturns werden erst im Renderer verworfen, ohne Datenänderung.

## Grenzen
Claude-Code-SSH hat bisher keine lokale History-Preview; dies bleibt unverändert.

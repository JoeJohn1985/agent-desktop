# Tasks: Geplante Aufgaben

- [x] Vorhandenen Automationsentwurf lesen und Nutzerfestlegungen erfassen.
- [x] Konkreten Umfang bestätigen lassen (2026-10-12).
- [x] ACP-Lifecycle, Hintergrundsitzungen, Fragen/Freigaben und Persistenz prüfen.
- [x] Datenmodell, Scheduler und sichere IPC-Verwaltung implementieren.
- [x] Hintergrundläufe und sichtbare Eskalation mit vorhandener Agentenlogik integrieren.
- [x] Unterseite mit Formular, Erinnerungen und Ausführungsverlauf erstellen.
- [x] Isolierte Tests für Fälligkeit, Wiederholung, Zeitzone, verpasste Termine,
      explizites Nachholen, Doppelstartschutz, Fehler und Unterbrechung ergänzen.
- [x] Lint und passende Tests ohne App-Start oder Electron-/UI-Tests ausführen.
- [x] Nutzerdokumentation und vorhandenen Planstatus aktualisieren.
- [x] Vault-Projektnotiz aktualisieren.
- [ ] Visuelle Abnahme durch den Nutzer.

## Visuelle Angleichung (freigegeben am 2026-10-13)

- [x] Aktuelles HTML/CSS, Renderer und freigegebene Spezifikation lesen.
- [x] Bestätigte Anforderungen und Grenzen ergänzen.
- [x] Formular in Aufgabe & Prompt, Zeitplan, Copilot-Einstellungen gliedern.
- [x] Kompakte App-Styles für Formular, Aufgabenliste und Verlauf übernehmen.
- [x] Dynamische Buttons, Hinweise, Titel und Leerzustände angleichen.
- [x] Responsive Umbrüche und Fokuszustände ergänzen; Logik unverändert lassen.
- [x] Isolierte Logiktests, Lint und Diff-Check ohne App-/UI-Start durchführen.
- [ ] Visuelle Abnahme durch den Nutzer (keine Screenshots/UI-Tests freigegeben).

Prüfung der visuellen Angleichung: `scheduled-tasks`, `scheduled-integration`
und `functions-view`: **21 Tests bestanden, 3 Suites**. Gezielter ESLint für
`scheduled-tasks.js`, `functions.js` und `functions-view.test.js` sowie
`git diff --check` erfolgreich. Keine App, Screenshots oder Electron-/UI-Tests.
Die Prüfergebnisse oben beziehen sich ausschließlich auf die Folgearbeit;
die nachstehenden 338 Tests dokumentieren die ursprüngliche Implementierung.

## Validierung und Grenzen

Gezielte Jest-Suites: scheduled-tasks, scheduled-integration, functions-view,
acp-client, main-helpers, integrity: **338 Tests bestanden, 6 Suites**.
Projektweiter ESLint: keine Fehler,
36 bestehende Warnungen. Keine App gestartet, keine Electron-/UI-Tests.
Rückfragen in unstrukturierten ACP-Antworten werden konservativ anhand von
Fragezeichen und typischen Bestätigungsaufforderungen erkannt; fachlicher
Erfolg wird nicht aus dem normalen Turn-Ende abgeleitet.

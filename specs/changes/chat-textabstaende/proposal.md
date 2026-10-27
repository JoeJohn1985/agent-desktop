# Lesbarere Chatformatierung

## Ziel
Textdarstellung anhand der Screenshotreferenz vom 27.10.2026 verbessern:
ruhiger Zeilenfluss, klar getrennte Absaetze und konsistente Listeneinrueckung.

## Vorgeschlagener Umfang
- Zeilenhoehe fuer normalen Nachrichtentext etwa 1.4.
- Absatzabstand etwa eine halbe bis dreiviertel Textzeile.
- Listen mit moderater Einrueckung und haengendem Umbruch;
  kompakte Einzelpunkte, klarer Abstand zum umgebenden Absatz.
- Ueberschriften, Zitate und Codebloecke mit konsistenten Blockabstaenden.
- Gleiche Formatierung fuer Live- und wiederhergestellte Nachrichten,
  in hellen/dunklen Themes und schmalen/breiten Fenstern.
- Keine Aenderung an Nachrichtentext, Markdownsemantik, Farben oder App-Layout.

## Abnahme
Visueller Vergleich mit Screenshot sowie repräsentativen Absaetzen,
verschachtelten Listen und Code. Zahlen sind Startwerte, keine aus dem
Screenshot exakt gemessenen CSS-Werte.

## Aufgaben nach Freigabe
- [x] Bestehende Nachrichten- und Markdownstile abgleichen und gezielt anpassen.
- [x] Darstellung isoliert im Browser pruefen, ohne Nutzer-App zu starten.
- [x] Relevante Regressionen und Projektdokumentation aktualisieren.

## Umsetzung und Prüfung (2026-10-27)
- Freigabe: „ja mach mal“. Nachrichtenzeilenhöhe 1.5, Blockabstand 0.9em
  (anfangs 0.6 Textzeilen), Listeneinrückung weiterhin 1.5em, Punkte 0.15em.
- Nach Nutzerwunsch „Kannst du den zeilenabstand noch etwas verringern“
  normale Nutzer-/Assistentennachrichten auf Zeilenhöhe 1.4 verdichtet.
  Absatz-/Listenabstände und Schriftgrößeneinstellungen unverändert;
  Code bleibt bei Zeilenhöhe 1.5. Gilt gemeinsam für Live und History.
- Live und beide History-Renderer setzen Markdown direkt in
  `.stream-response.markdown-body`; kein innerer Content-Wrapper vorhanden.
  Dort greifen die Regeln unmittelbar. Nutzertext bleibt `pre-wrap`,
  Markdown explizit `normal`, Codeblöcke `pre`.
- Kein nachgewiesenes `pre-wrap`-Problem im bisherigen Antwortpfad:
  bisher normaler Whitespace und `marked` mit `breaks: true`. Diese
  Markdownsemantik bleibt unverändert. Kein Entfernen von Leerzeilen im Text.
  Absatzränder werden nicht mehr pauschal für alle first-/last-child-p
  entfernt, sondern an tatsächlichen Blockcontainern begrenzt.
- Isolierte Playwright-Prüfung mit vorhandenem Edge, ohne Electron:
  vier Theme-/Breitenkombinationen (390/1200px), echte Live-IPC- und
  beide History-Pfade, Preload-Markdownkonfiguration, DOMPurify im Browser.
  Computed Styles/Geometrie und 16-/20px-Schriftvererbung geprüft.
  Referenz und erzeugte Screenshots visuell betrachtet, kein pixelgenauer
  Vergleich und kein Test in der laufenden Nutzer-App.
- Sieben History-Jest-Tests, gezieltes ESLint und `git diff --check` erfolgreich.
  Standard-Playwright-Chromium fehlt lokal; Edge ohne Installation genutzt.
  Screenshots ausschließlich im vorgegebenen Sessionordner.

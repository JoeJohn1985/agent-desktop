# Session-Aktionen am Messagefeld

## Ziel und Umfang
Die bestehende `sessionActions`-Leiste wandert vom oberen Chatrand an den
oberen Rand des Nachrichteneingabebereichs. Alle bestehenden Funktionen
und tab-/providerbezogenen Anzeigen bleiben erhalten.

## Anforderungen
- Die Leiste SHALL direkt oberhalb der Nachrichteneingabe angedockt sein
  und mit ihr einen optisch zusammenhaengenden Bereich bilden.
  Klarstellung der Freigabe: Die gesamte `#sessionActions`-Leiste steht
  unmittelbar OBERHALB der gesamten `.chat-input-bar`, nicht innerhalb
  des Textfelds oder dessen Wrappers.
- Modell/Reasoning, Modus, Kontext, Freigaben, providerabhaengige Aktionen,
  Provider und Tageskosten SHALL unveraendert erreichbar bleiben.
- Explizite Nutzerkorrektur vom 2026-10-26: Links SHALL Providerangabe,
  Model, Agent/Modus und Auto/Freigaben in dieser Reihenfolge stehen.
  Die Gemini-Aktion SHALL danach im linken Aktionsblock erhalten bleiben.
  Kontext und Tageskosten SHALL rechts nach dem flexiblen Abstand stehen.
- Der Kostenbetrag SHALL selbst ein nativer Button mit Anzeige-ID
  `sessionUsage` sein und per Klick, Enter oder Leertaste die bestehende
  Kostenansicht oeffnen. Das separate Kosten-Icon und dessen alte
  `btnOpenCosts`-Verdrahtung SHALL entfallen; Verbrauchsanzeige und
  Detail-Tooltips SHALL erhalten bleiben.
- Der Verlauf SHALL unabhaengig scrollen; Leiste und Eingabe bleiben unten.
- Menues SHALL am neuen Ort innerhalb des sichtbaren Fensters oeffnen,
  bei Bedarf nach oben. Keine Abschneidung durch Eingabecontainer.
- Schmale Fenster, helle/dunkle Darstellung und Funktionen-Ansicht SHALL
  weiterhin funktionieren. Keine doppelte Leiste am bisherigen Ort.

## Ansatz und Aufgaben nach Freigabe
- [x] DOM-Anordnung, gemeinsame Umrandung/Abstaende und responsive Darstellung anpassen.
- [x] Menuepositionierung, Sichtbarkeit und eventuelle Strukturabhaengigkeiten pruefen.
- [x] Zugehoerige Tests und Dokumentation aktualisieren.
- [x] Nutzerkorrektur direkt umgesetzt: Reihenfolge, Kontext rechts,
  Kostenbetrag als Button; alten Icon-Listener und E2E-Selektor ersetzt.
- [x] Regressionen fuer Reihenfolge, Kosten-Event und native
  Tastaturbedienung sowie Gemini im schmalen/hellen/dunklen Layout ergaenzt.

## Status
Am 2026-10-26 ausdruecklich freigegeben und implementiert. Bestehende IDs
und Funktionsverdrahtung bleiben erhalten. Modell-, Modus- und Kontextmenues
oeffnen viewportbegrenzt bevorzugt nach oben; Reasoning oeffnet als separates
Panel daneben, bei Platzmangel rechts nach links. Beide Panels bleiben ohne
Ueberlappung viewportbegrenzt oberhalb des Composers und scrollen bei Bedarf
unabhaengig. Funktionen-Ansicht blendet Leiste und
Eingabe weiterhin gemeinsam aus. Visuelle Abnahme in der Nutzer-App offen;
keine Nutzer-App gestartet oder gestoppt.

## Validierung
- Dropdown-Regressionsfix: 10 isolierte Edge-Geometriepruefungen erfolgreich:
  getrennte Panels ohne Ueberlappung, Rechts-/Linkspositionierung sowie
  gemeinsames Einpassen bei 360 Pixeln, 360 Pixel Fensterhoehe, hell/dunkel,
  Maus-/Fokus-Erreichbarkeit und unabhaengiges Scrollen. 103 gezielte
  Jest-Tests erfolgreich; gezielter ESLint und `git diff --check` ohne Fehler.
  Keine Nutzer-App gestartet/gestoppt und kein Commit/Push.
- Nach Nutzerkorrektur erneut: 103 gezielte Jest-Tests und vier isolierte
  Edge-Layouttests erfolgreich, einschliesslich Kosten-Klick, Enter,
  Leertaste, Fokus und eingeblendeter Gemini-Aktion bei 760/1200 Pixeln
  in hell/dunkel. ESLint fuer alle vier geaenderten JS-/Testdateien
  ohne Fehler oder Warnungen; `git diff --check` ohne Fehler.
- 102 gezielte Jest-Tests erfolgreich (Struktur, Menuekoordinaten,
  Funktionen-Sichtbarkeit und bestehende Modellauswahl).
- Vier isolierte Browser-Layouttests mit Edge/Playwright: 760 und 1200 Pixel,
  jeweils hell/dunkel; unabhaengiges Scrollen, Menuegrenzen und Reasoning.
  Statisches Renderer-HTML/CSS mit synthetischen Menueintraegen, keine
  Electron-Instanz oder Provider-Verbindung.
- Gezielter ESLint ohne Fehler; eine bestehende `prefer-const`-Warnung in
  `renderer/app.js`. `git diff --check` ohne Fehler.
- Wiederholung: `npx jest --runInBand session-actions-layout functions-view model-selection`
  und `npx playwright test session-actions-layout.spec.js --workers=1`.
  Ohne installierten Playwright-Browser unter Windows alternativ zuvor
  `$env:PLAYWRIGHT_CHANNEL='msedge'` setzen (installierter Edge erforderlich).

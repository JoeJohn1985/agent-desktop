# Tasks: Modellbezogene Reasoning-Auswahl pro Tab

## Implementierung

- [x] 1. Modellbezogene Reasoning-Konstanten, Metadaten und Tab-State in
  `renderer/app.js` ergaenzen.
- [x] 2. Modell-Dropdown um kompakte Reasoning-Anzeige und Hover-/Fokus-
  Untermenue in `renderer/app.js` und `renderer/styles.css` erweitern.
- [x] 3. Modellwechsel so verdrahten, dass die gespeicherte
  Modell-Reasoning-Kombination gemeinsam aktiviert wird.
- [x] 4. Modell-Reasoning-State in Prompt-Optionen und Copilot-ACP-Optionen
  verdrahten: `renderer/app.js` und `main.js`.
- [x] 5. `src/acp-client.js` um validiertes
  `--reasoning-effort`-Argument und einen Restart nur bei geaenderter
  effektiver Reasoning-Stufe erweitern.
- [x] 6. Tab- und Session-Persistenz fuer die Modell-Reasoning-Map ergaenzen
  und alte Preferences ohne Map unterstuetzen.

## Tests

- [x] Modellbezogenen Tab-State, Untermenue-Auswahl, Anzeige und Tab-Isolation
  in `__tests__/model-selection.test.js` testen.
- [x] Prompt-Optionen, Modellwechsel und Provider-Sichtbarkeit testen.
- [x] Spawn-Argument, fehlendes Argument und Restart-/Session-load-Reihenfolge
  in `__tests__/acp-client.test.js` testen.
- [x] Persistenz der Modell-Reasoning-Map und Rueckwaertskompatibilitaet mit
  den bestehenden Renderer-/Session-Tests abdecken.

## Dokumentation

- [x] `docs/ARCHITECTURE.md` um den Reasoning-Optionenfluss und den ACP-Restart
  ergaenzen.
- [x] `docs/USER-GUIDE.md` um die Copilot-Reasoning-Auswahl im
  Modell-Dropdown ergaenzen.

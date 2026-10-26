# Aufgaben

## Formular-Bugfix 16.10.2026
- [x] Auto-Komprimierungsfelder einzeln kapseln: Die globale Simple-Group-
  `:has(label + select)`-Regel hatte die gesamte Gruppe horizontal angeordnet.
- [x] Modellregel klar beschriften, Labels mit IDs verbinden, vorhandene
  Theme-Controls verwenden und Zahleneingabe responsiv begrenzen.
- [x] Hinweise in Automatik, Kostengrenzen, Zeitpunkt und Long context gliedern;
  Data-Hooks, Persistenz und dynamische Preis-/Kostenwarnungen unveraendert.
- [x] Isolierte Formular-Tests, gezieltes Lint und Diff pruefen; keine App/UI.

## Bestaetigte Erweiterung 15.10.2026
- [x] CLI-Flag und ACP-Konfigurationsmoeglichkeiten ohne Modellaufruf pruefen.
- [x] Sichtbare modellbezogene Tokens/%-Policy, Defaults und Bestandserhaltung.
- [x] Token-Ausloeser und Preiswarnung ohne interne Cap integrieren.
- [x] Reserve-Flag fuer belegte Modelle und Sitzungsgrenzen dokumentieren.
- [x] Settings nach oben verschieben und vorhandene Styles nutzen.
- [x] Gezielte Tests, Lint, Diff und Repo-Dokumentation.

Ergebnis Erweiterung: 11 gezielte Jest-Suites, 550 Tests erfolgreich;
gezieltes ESLint 0 Fehler/9 bestehende Warnungen; git diff --check erfolgreich.
Keine App/Electron/UI, keine Screenshots, keine Live-Modellaufrufe, kein
Commit/Push/Subagent/Vault. Details und Quellen: verification.md.

Technische Restgrenze: Die aktuelle ACP-Modellliste meldet keine
Long-context-Capabilities. Fuer nicht bereits gemessene Modelle kann eine
vollstaendige Reserve-Unterstuetzung ohne weitere belastbare Metadaten nicht
zugesichert werden. Deshalb kein blindes Flag fuer diese Modelle; sie behalten
ihre nativen Einstellungen. Change bleibt als lebende Spec unarchiviert.

- [x] Anforderungen und vorgeschlagene Defaults festhalten.
- [x] Nutzerbestaetigung erhalten: alle Provider aktiviert mit 50 Prozent.
- [x] Provider-Settings, Validierung und Persistenz erweitern.
- [x] Abschlusswege und Sitzungskoordination untersuchen und vereinheitlichen.
- [x] Automatischen Ausloeser fuer interaktive und geplante Sitzungen anbinden.
- [x] Schwellen, deaktivierte Policy, Fehler, Aufmerksamkeit, Hintergrundbetrieb,
  konkurrierende Prompts und Doppelereignisse isoliert testen.
- [x] Gezielte Tests und Lint ohne App-/UI-Start ausfuehren.
- [x] Nutzerdokumentation aktualisieren. Vault ausdruecklich ausgenommen.

## Umsetzung und Grenzen

Main-seitige Queue fuer alle Prompt-Aufrufer und stille Befehle; Ausloeser
erst nach vollstaendigem Prompt-Promise, nicht bei Zwischen-/Tool-Enden.
Alle acht Provider, echte API-Zusammenfassungen statt No-op, unbekannte
Auslastung explizit uebersprungen. Keine Kontextfenster-Auswahl/configOptions
und keine festen Copilot-Fensterannahmen. Freigabe-/Frage-/Auth-Signale
blockieren konservativ den aktuellen Lauf, unstrukturierte Rueckfragen
werden heuristisch erkannt. Native CLI-Komprimierung bleibt unbeeinflusst.

Validierung: gezielte isolierte Jest-Suites (Koordinator, Settings/Persistenz,
Provider-Verdichtung, Session-Store, API-/ACP-Lebenszyklus, Planung,
Main-/Renderer-Integration und strukturelle Integritaet). Kein Electron-/
App-/UI-Start, keine Screenshots, kein Commit/Push und keine Subagents/Vault.

Ergebnis: 10 gezielte Jest-Suites, 510 Tests erfolgreich. Gezieltes ESLint:
0 Fehler, 10 bereits vorhandene Warnungen in main.js, renderer/app.js und
__tests__/acp-client.test.js. git diff --check ohne Whitespacefehler.

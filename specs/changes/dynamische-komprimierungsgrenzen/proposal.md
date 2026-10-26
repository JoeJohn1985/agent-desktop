# Dynamische Komprimierungsgrenzen

## Ziel
Neue Copilot-Modelle erhalten automatisch einen sichtbaren Vorschlagswert
aus aktuellen offiziellen Preisdaten, ohne modellbezogene Sonderfaelle.
Status: Bestaetigt am 16.10.2026; implementiert und gezielt validiert.

## Verbindliche Klaerung
- Offizieller Eintrag mit erhoehter Preisstufe: 88 Prozent der Grenze,
  einheitlich auf zwei signifikante Dezimalstellen gerundet (272000 -> 240000).
- Offizieller Eintrag ohne erhoehte Preisstufe, auch ohne tier-Feld:
  bekannter einheitlicher Tarif, 50-Prozentregel aus realem /context,
  keine Preis-unbekannt-Warnung.
- Ohne offiziellen Modelleintrag: Prozentregel mit Kennzeichnung Preis unbekannt.
- Automatische Defaults folgen Modell/Preisupdates; individuelle und Legacy-Werte
  bleiben bestehen. Modellbezogenes Zurueck-zur-Automatik ist explizit moeglich.
- Preisstufen aktivieren keine Longcontext-Unterstuetzung. Gemeinsamer bestehender
  Koordinator bleibt fuer Tabs und geplante Hintergrundsessionen verantwortlich.

## Anforderungen
- Nachbesserung vom 16.10.2026: Die Einheit folgt zwingend dem Preismodell
  (Tokens bei Preisgrenze, sonst Prozent); kein Einheiten-Auswahlfeld.
  Gespeicherte Regeln einer anderen Einheit bleiben gespeichert, sind aber nicht
  wirksam: Statt einer geratenen Umrechnung gilt sichtbar der Automatikvorschlag.
  Der Reset verwendet den bestehenden action-btn-Stil.
- Die App SHALL den vorhandenen Pricing-Loader verwenden, Modellzuordnung
  und Aktualisierungsweg pruefen und neue Modelle ohne Codeaenderung erfassen.
- Bei belegter erhoehter Preisstufe SHALL der Vorschlag aus deren Tokengrenze
  mit dem bisherigen Sicherheitsabstand abgeleitet werden. Eine einheitliche
  Rundungsregel SHALL den bisherigen Vorschlag 240000 bei 272000 erhalten.
- Die App SHALL Vorschlagswert, Einheit, Preisgrenze und Herkunft sichtbar
  machen. Der wirksame Wert bleibt editierbar, keine versteckte Preis-Cap.
- Individuell gespeicherte Werte SHALL bei Datenupdates erhalten bleiben.
  Automatische Vorschlaege SHALL von individuellen Overrides unterscheidbar sein.
- Fehlende Preisdaten SHALL nicht als nachgewiesen fehlender Aufpreis gelten.
  Unbekannte Preisgrenzen SHALL sichtbar markiert werden; als Fallback gilt
  die sichtbare Prozentregel, standardmaessig 50 Prozent.
- Preisgrenzen-Warnung und Ausfuehrung nur zwischen Antwortlaeufen SHALL
  erhalten bleiben.
- Preisstufen SHALL nicht als Nachweis fuer Long-Context-Unterstuetzung oder
  konkrete Fenstergroessen verwendet werden.

## Aufgaben
- [x] Anforderungen bestaetigen.
- [x] Pricing-Aktualisierung, Zuordnung und Policy-/UI-Pfade untersuchen.
- [x] Einheitliche Berechnung ohne Modellsonderfaelle implementieren.
- [x] Automatische Vorschlaege und gespeicherte Overrides korrekt aktualisieren.
- [x] Neue unbekannte Modelle, Preisupdates, fehlende Daten und Overrides testen.
- [x] Dokumentation aktualisieren; keine App-/UI-Starts oder Live-Modellaufrufe.

## Validierung
- 6 isolierte Jest-Suiten, 124 Tests erfolgreich: dynamic-compaction-policy,
  auto-compaction-settings, auto-compaction, pricing-source,
  scheduled-integration, provider-compaction.
- Gezieltes ESLint: keine Fehler, drei bestehende unbenutzte Variablen in main.js.
- git diff --check erfolgreich. Kein App-/Electron-/UI-Start, keine Screenshots,
  keine Live-Modellaufrufe, kein Commit/Push. Pricing-Netzwerk in Tests gemockt.
- Grenzen: kein visueller UI-Test; keine Kostengarantie innerhalb eines laufenden
  Antwortlaufs. Offline verbleibt der letzte erfolgreich geladene Preisstand.

# Design: Zentraler Funktionsbereich

## Ansatz

Eine gemeinsame Hauptansicht ersetzt die bisher getrennte Navigation zu
Plugins und Kosten. Eine interne Seitennavigation wählt Skills, Anbindungen,
Plugins oder Kostenübersicht. Vorhandene Datenquellen und Aktionen werden
wiederverwendet, nicht parallel neu implementiert.

## Architektur

- `renderer\index.html`: Einstieg vor Project, gemeinsame Seitenhülle,
  vier Seiteninhalte; bisherige Sidebar-Listen und Plugins-Tab ablösen.
- `renderer\modules\functions.js`: gemeinsamer Ansichtswechsel und ausgewählte
  Unterseite; bisherige View-Wechsel in `plugins.js` hier zusammenführen.
- `skills-mcp.js`: Skill- und MCP-Anzeigen für die neuen Seiten anpassen;
  keine Änderung der Kontextauflösung oder aktiven Skills.
- `mcp-manager.js`: bestehende Serververwaltung in die Anbindungen-Seite
  integrieren, Statusaktualisierung und delegierte Aktionen erhalten.
  Die Übersicht und Servermenüs liegen auf der Seite; das bestehende
  Eingabemodal bleibt für Hinzufügen und Bearbeiten erhalten.
- `plugins.js` und `costs.js`: Renderer und Datenhaltung erhalten; ihre
  bisherigen Einstiegspunkte an die gemeinsame Navigation anbinden.
- `app.js` und `tabs.js`: Chat-/Funktionsansicht konsistent wechseln und
  vorhandene Event-Delegation weiterverwenden.
- `styles.css`: bestehende Pluginseiten-Muster und Theme-Variablen verwenden;
  Seiteninhalte scrollbar, Navigation bei schmalen Fenstern nutzbar.

## Schnittstellen

Vorgesehene Renderer-Funktionen:

- `openFunctionsView(page)`: page ist `skills`, `connections`, `plugins` oder
  `costs`; ohne Parameter zuletzt gewählte Seite, initial Skills.
- `closeFunctionsView()`: kehrt ohne Sitzungsänderung zum aktiven Chat zurück.

Vorhandene Plugin-/Kosten-Einstiegsfunktionen können als dünne Weiterleitungen
erhalten bleiben, soweit bestehende Aufrufer oder Tests dies erfordern.
Es werden keine neuen Main-Prozess- oder IPC-APIs benötigt.

## Alternativen

- Vier getrennte Sidebar-Einstiege: verworfen, da kein gemeinsamer Bereich.
- Ein Modal: verworfen, da eine volle Seite gewünscht ist.
- Globale Skill-Aktivierung: nicht Teil des Auftrags; würde bestehende
  Sitzungssemantik verändern.

## Risiken

- Entfernte DOM-Container: alle Render-, Menü-, Provider- und Initialisierungspfade
  auf neue Ziele umstellen, statt fehlende Anzeigen lediglich zu ignorieren.
- Laufende Antworten: Ansichtswechsel darf Streaming und Sitzung nicht stoppen.
- Kontextabhängige Skills/native MCP: aktive Provider-/Projektzuordnung sichtbar
  halten; zentraler Zugang darf keine globale Verfügbarkeit vortäuschen.
- Bestehender Arbeitsbaum enthält uncommittete MCP- und Kostenänderungen:
  integrieren und nicht zurücksetzen.

## Belegte Ausgangslage

Der Quellcode enthält bereits Vollseiten für Plugins und Kosten,
tabbezogene Skill-Aktivierung sowie ein MCP-Verwaltungsmodal.
Der Vault dokumentiert app-eigene MCP-Verbindungen über eine lokale Brücke
und Copilot-Kosten aus CLI-Sitzungsverbrauch. Beides bleibt unverändert.

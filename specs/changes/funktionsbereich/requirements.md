# Requirements: Zentraler Funktionsbereich

## REQ-1: Zentraler Einstieg

Die Sidebar **SHALL** oberhalb von „Project“ einen Einstieg „Funktionen“ zeigen.
Er **SHALL** eine Hauptansicht in der Größe der bisherigen Pluginseite öffnen,
nicht ein Modal. Die Sidebar **SHALL** sichtbar bleiben.

### Szenario: Öffnen und Zurückkehren

- GIVEN ein offener Chat mit Entwurf und bestehendem Sitzungszustand
- WHEN Funktionen geöffnet und anschließend geschlossen oder ein Chat-Tab gewählt wird
- THEN bleiben Chat, Entwurf und Sitzung erhalten.

## REQ-2: Vier Unterseiten

Die Hauptansicht **SHALL** eine dauerhaft sichtbare Navigation für
Skills, Anbindungen, Plugins und Kostenübersicht besitzen.
Genau eine Unterseite **SHALL** sichtbar und als ausgewählt gekennzeichnet sein.
Navigation und Rückkehr zum Chat **SHALL** per Tastatur bedienbar sein.

### Szenario: Unterseitenwechsel

- GIVEN die geöffnete Funktionsansicht
- WHEN eine andere Unterseite gewählt wird
- THEN wechselt nur der Seiteninhalt; es wird keine Sitzung gestartet.

## REQ-3: Skills

Die Skills-Unterseite **SHALL** verfügbare Skills mit Name, Beschreibung,
Herkunft und bestehender Aktivierungsmöglichkeit anzeigen.
Provider und Projekt des zugrunde liegenden Chat-Tabs **SHALL** erkennbar sein.
Die bestehende tabbezogene Aktivierung und vorhandene Verwaltungsaktionen
**SHALL** erhalten bleiben.

### Szenario: Unterschiedliche Projekte

- GIVEN zwei Chat-Tabs mit unterschiedlichen Projekten oder Providern
- WHEN der aktive Chat-Tab wechselt und Skills geöffnet wird
- THEN entspricht die Liste weiterhin dem Kontext dieses Tabs.

### Szenario: Keine Skills

- GIVEN keine verfügbaren Skills
- WHEN die Unterseite geöffnet wird
- THEN erscheint ein expliziter Leerzustand statt einer verschwundenen Seite.

## REQ-4: Anbindungen

Die Anbindungen-Unterseite **SHALL** app-eigene und vorhandene native
MCP-Server mit Herkunft, Status und verfügbaren Aktionen anzeigen.
Bestehende Aktionen für app-eigene Server **SHALL** erhalten bleiben:
Hinzufügen, Bearbeiten, Verbinden, Trennen, Aktivieren/Deaktivieren,
Abmelden und Entfernen mit Bestätigung.
Native Server **SHALL** von app-verwalteten Servern unterscheidbar bleiben.
Fehler und erforderliche Anmeldung **SHALL** sichtbar sein.

### Szenario: Live-Status

- GIVEN eine geöffnete Anbindungen-Unterseite
- WHEN sich der Serverstatus ändert
- THEN wird die Anzeige ohne erneutes Öffnen aktualisiert.

## REQ-5: Plugins und Kosten

Die Plugins-Unterseite **SHALL** bestehende Suche, Marketplace-Navigation und
Installations-/Verwaltungsaktionen erhalten.
Die Kostenübersicht **SHALL** vorhandene Zeiträume, Filter, Diagramme und
Sitzungsaufstellungen erhalten, ohne die Datengrundlage zu verändern.
Copilot-Kosten **SHALL** weiterhin auf CLI-Sitzungsverbrauch basieren;
fehlende Daten **SHALL** nicht durch Tokenpreisschätzungen ersetzt werden.

## REQ-6: Aufgeräumte Sidebar

Die bisherigen Skills- und MCP-Sidebar-Listen sowie der feste Plugins-Tab
**SHALL** durch den zentralen Einstieg ersetzt werden.
Project, Backlog und Bilder **SHALL** unverändert erreichbar bleiben.
Bestehende Kosten- oder Plugin-Verknüpfungen **SHALL** die passende Unterseite öffnen.
Der zentrale Einstieg **SHALL** auch ohne geladene Sitzung erreichbar bleiben;
kontextabhängige Aktionen **SHALL** ihren fehlenden Kontext explizit anzeigen.

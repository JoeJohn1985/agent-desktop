# Requirements: Modellbezogene Reasoning-Auswahl pro Tab

## Anforderungen

### REQ-1: Gemeinsame Modell- und Reasoning-Auswahl

Die Renderer-Komponente **SHALL** die Reasoning-Auswahl als Teil des
bestehenden Modell-Dropdowns anbieten, sofern der aktive Tab den Provider
`copilot` verwendet.

#### Szenario: Standardzustand

- **GIVEN** ein neuer Copilot-Tab wird erstellt
- **WHEN** fuer das aktive Modell noch keine Zuordnung existiert
- **THEN** wird `Standard` angezeigt und kein Reasoning-Override an den
  Backend-Aufruf uebergeben

#### Szenario: Modellliste zeigt Reasoning

- **GIVEN** ein Copilot-Tab mit gespeicherten Modell-Reasoning-Zuordnungen
- **WHEN** der Benutzer das Modell-Dropdown oeffnet
- **THEN** zeigt jeder Modell-Eintrag die zugeordnete Reasoning-Stufe in
  kompakter Form an; fehlt eine Zuordnung, wird `Standard` angezeigt

#### Szenario: Reasoning im Modell-Untermenue auswaehlen

- **GIVEN** ein aktiver Copilot-Tab
- **WHEN** der Benutzer ueber einem Modell-Eintrag schwebt oder ihn fokussiert
  und `low`, `medium`, `high`, `xhigh` oder `max` auswaehlt
- **THEN** werden das Modell und die Reasoning-Stufe gemeinsam aktiviert und
  die Zuordnung wird nur im aktiven Tab gespeichert

#### Szenario: Standard wiederherstellen

- **GIVEN** ein Modell mit einer gesetzten Reasoning-Stufe
- **WHEN** der Benutzer fuer dieses Modell `Standard` auswaehlt
- **THEN** wird die modellbezogene Zuordnung auf `Standard` bzw. `null`
  gesetzt und der Copilot-Standard wieder verwendet

#### Szenario: Modellwechsel

- **GIVEN** ein Tab mit Zuordnungen fuer mehrere Modelle
- **WHEN** der Benutzer ein anderes Modell auswaehlt
- **THEN** wird die fuer dieses Modell gespeicherte Reasoning-Stufe aktiviert;
  ohne Zuordnung gilt `Standard`, und die Zuordnung des vorherigen Modells
  bleibt unveraendert

#### Szenario: Tab-Wechsel

- **GIVEN** zwei Tabs mit unterschiedlichen Modell-Reasoning-Zuordnungen
- **WHEN** der Benutzer zwischen den Tabs wechselt
- **THEN** zeigt das Modell-Dropdown jeweils die Zuordnung des aktiven Tabs,
  ohne den Zustand des anderen Tabs zu veraendern

#### Szenario: Nicht unterstuetzter Provider

- **GIVEN** ein Tab mit Claude Code oder einem direkten API-Provider
- **WHEN** der Tab aktiv ist
- **THEN** zeigt das Modell-Dropdown keine Copilot-Reasoning-Untermenues und
  es wird kein `--reasoning-effort` an diesen Provider weitergereicht

### REQ-2: Persistenz der Modell-Reasoning-Zuordnung

Die App **SHALL** die Zuordnung pro Tab bzw. Session speichern und
wiederherstellen.

#### Szenario: Offene Tabs wiederherstellen

- **GIVEN** ein offener Tab mit mehreren gespeicherten
  Modell-Reasoning-Zuordnungen
- **WHEN** die App neu gestartet wird
- **THEN** werden das aktive Modell und alle Zuordnungen mit dem Tab
  wiederhergestellt

#### Szenario: Session aus der Sidebar wiederaufnehmen

- **GIVEN** eine gespeicherte Session mit Modell-Reasoning-Zuordnungen
- **WHEN** die Session als Tab geoeffnet wird
- **THEN** werden das gespeicherte Modell und die zugehoerigen Zuordnungen
  fuer diesen Tab verwendet

#### Szenario: Alte Persistenzdaten

- **GIVEN** Persistenzdaten aus einer Version ohne
  Modell-Reasoning-Zuordnung
- **WHEN** diese Daten geladen werden
- **THEN** wird fuer jedes Modell `Standard` verwendet, ohne dass der
  Tab-Restore fehlschlaegt

### REQ-3: Uebergabe an Copilot ACP

Der Backend-Datenfluss **SHALL** die ausgewaehlte Reasoning-Stufe als sichere,
validierte Option bis zum Copilot-ACP-Prozess transportieren.

#### Szenario: Explizite Stufe beim Prozessstart

- **GIVEN** ein Copilot-Tab mit einer gueltigen Reasoning-Stufe
- **WHEN** der zugehoerige ACP-Prozess gestartet wird
- **THEN** enthaelt der Startaufruf genau
  `--reasoning-effort <stufe>`

#### Szenario: Kein Override

- **GIVEN** `Standard` oder ein fehlender Reasoning-Wert
- **WHEN** der ACP-Prozess gestartet wird
- **THEN** wird kein `--reasoning-effort`-Argument gesetzt

#### Szenario: Aenderung bei laufendem Prozess

- **GIVEN** ein bereits laufender Copilot-ACP-Prozess und eine geaenderte
  Modell-Reasoning-Kombination
- **WHEN** der Benutzer den naechsten Prompt sendet
- **THEN** wird der Prozess nur dann vor diesem Prompt transparent neu
  gestartet, wenn sich die Reasoning-Stufe gegenueber dem laufenden Prozess
  geaendert hat; anschliessend wird die bestehende Session geladen, das
  ausgewaehlte Modell angewendet und der Prompt ausgefuehrt

#### Szenario: Laufender Prompt

- **GIVEN** ein Prompt wird gerade verarbeitet
- **WHEN** der Benutzer Modell oder Reasoning im Dropdown aendert
- **THEN** wird der laufende Prompt nicht unterbrochen; die neue
  Modell-Reasoning-Kombination gilt ab dem naechsten Prompt

#### Szenario: Unveraenderte Kombination

- **GIVEN** Modell und Reasoning sind gegenueber dem laufenden Prozess
  unveraendert
- **WHEN** ein weiterer Prompt gesendet wird
- **THEN** bleibt der ACP-Prozess bestehen, es wird kein `session/load`
  ausgefuehrt und nur der normale `session/prompt` gesendet

### REQ-4: Bestehendes Verhalten erhalten

Die Erweiterung **SHALL** die bestehende Mode-, Approval- und
Provider-Auswahl unveraendert lassen. Ein Modellwechsel mit gleicher
Reasoning-Stufe darf weiterhin ohne Prozessneustart funktionieren.

### REQ-5: Testbarkeit und Dokumentation

Die Implementierung **SHALL** Tests fuer Tab-State, Auswahl, Prompt-Option,
CLI-Argument, Prozess-Neustart und Persistenzpfade enthalten sowie die
Benutzer- und Architektur-Dokumentation um die neue Copilot-Funktion
ergaenzen.

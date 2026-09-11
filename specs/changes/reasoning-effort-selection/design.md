# Design: Modellbezogene Reasoning-Auswahl pro Tab

## Ansatz

Die bestehende Modell-Auswahl wird um eine modellbezogene Reasoning-Auswahl
erweitert. Es gibt keinen separaten Reasoning-Button. Jeder Tab verwaltet neben
dem aktiven Modell eine Map `reasoningByModel`, deren Schluessel die exakte
Modell-ID und deren Wert `null`, `low`, `medium`, `high`, `xhigh` oder `max`
ist. `null` bedeutet `Standard`.

Der Modell-Eintrag zeigt seine gespeicherte Reasoning-Stufe kompakt an. Beim
Hover oder Tastaturfokus oeffnet sich ein Untermenue mit den sechs moeglichen
Stufen. Die Auswahl einer Stufe aktiviert das zugehoerige Modell und speichert
die Kombination im aktiven Tab.

Da Copilot ACP als langlebiger Prozess pro Tab betrieben wird und
`--reasoning-effort` ein Startargument ist, erkennt `AcpClient` eine Aenderung
der effektiven Reasoning-Stufe. Nur wenn sich diese Stufe gegenueber dem
laufenden Prozess aendert, wird vor dem naechsten Prompt neu gestartet. Die
gemerkte Session-ID bleibt erhalten; der bestehende Self-Heal-/
`session/load`-Pfad laedt die Session im neuen Prozess wieder. Ein reiner
Modellwechsel verwendet weiterhin `session/set_model` ohne Prozessneustart.

## Architektur

- `renderer/index.html`: kein neuer Session-Action-Button; das bestehende
  Modell-Dropdown wird als Container fuer die Reasoning-Untermenues verwendet.
- `renderer/styles.css`: kompakte Reasoning-Anzeige pro Modell und
  verschachteltes Dropdown.
- `renderer/app.js`:
  - `REASONING_EFFORTS` und Anzeige-Metadaten
  - `reasoningByModel` sowie `selectedModel` im Tab-Objekt
  - Modell-Dropdown mit Hover-/Fokus-Untermenue
  - Weitergabe von `model` und dem daraus abgeleiteten `effort` in
    `desktop.chat.send()`
  - Speicherung in `openTabs` sowie einer sessionbezogenen Map
    `sessionReasoningByModel`
  - keine Reasoning-Untermenues fuer Nicht-Copilot-Provider
- `main.js`: `options.effort` wird nur in den Copilot-`clientOptions`
  weitergereicht; Claude Code und direkte API-Backends erhalten die Option
  nicht.
- `src/acp-client.js`:
  - validiertes `effort`-Feld in den Optionen
  - `--reasoning-effort` beim Copilot-Spawn
  - Restart-Markierung bei einer geaenderten effektiven Reasoning-Stufe
  - Restart vor `prompt()` und anschliessendes Laden der Session
- Tests: bestehende Model-Selection-Tests werden um
  Modell-Reasoning-State und Optionsfluss erweitert; ACP-Tests pruefen
  Argumente und Restart-Reihenfolge.

## Datenmodell

```js
{
  selectedModel: 'claude-sonnet-4.6',
  reasoningByModel: {
    'claude-sonnet-4.6': 'high',
    'claude-opus-4.8': 'max',
    'gpt-5.3-codex': 'medium',
  },
}
```

Die offene-Tab-Persistenz speichert `reasoningByModel` zusammen mit dem
Tab-State. Fuer Sessions wird die Map unter der jeweiligen Session-ID
gespeichert. Fehlende oder ungueltige Eintraege werden als `null` behandelt.

## Schnittstellen

```js
// Renderer -> preload -> main
desktop.chat.send(tabId, prompt, {
  provider: 'copilot',
  model: 'claude-sonnet-4.6',
  effort: 'high',
});
```

Gueltige Werte fuer `effort` sind:

```js
null | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
```

`effort` wird aus `reasoningByModel[model]` gelesen. Bei `null`, einem
fehlenden Eintrag oder einem Nicht-Copilot-Provider wird kein CLI-Argument
erzeugt.

## Alternativen

- **Separater Reasoning-Button:** verworfen, weil Modell und Reasoning fachlich
  zusammengehoeren und beim Modellwechsel gemeinsam aktiviert werden sollen.
- **Globale Zuordnung pro Modell:** verworfen, weil Tabs bzw. Sessions
  unterschiedliche Modell-Reasoning-Kombinationen behalten koennen sollen.
- **Session-seitige ACP-Konfiguration:** nicht verwendet, weil die aktuelle
  Copilot-ACP-Integration die Reasoning-Stufe ueber den Prozessstart setzt und
  keine belastbare Session-Option dafuer besitzt.
- **Reasoning fuer alle Provider erzwingen:** verworfen, weil die Provider
  unterschiedliche API-Parameter und Semantiken besitzen; eine gemeinsame
  Einstellung waere ohne provider-spezifische Vertraege irrefuehrend.

## Risiken

- Ein Wechsel der Reasoning-Stufe kann einen ACP-Prozessneustart benoetigen.
  Die bestehende Session-ID und der vorhandene `session/load`-Self-Heal-Pfad
  minimieren den sichtbaren Effekt.
- Nicht jede Reasoning-Stufe muss fuer jedes Copilot-Modell fachlich gleich
  sinnvoll sein. Die erste Version zeigt die CLI-Stufen ohne dynamische
  Modellfilterung; Fehlermeldungen des CLI bleiben sichtbar.
- Alte Preferences enthalten keine Modell-Reasoning-Map. Der Default `null`
  stellt die Rueckwaertskompatibilitaet sicher.

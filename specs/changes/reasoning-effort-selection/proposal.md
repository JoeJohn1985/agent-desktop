# Modellbezogene Reasoning-Auswahl pro Tab

## Problem

Die App erlaubt bereits die Auswahl eines Modells pro Tab. Die vom Copilot CLI
angebotene Steuerung der Reasoning-Intensitaet ist jedoch nicht erreichbar.
Eine separate Reasoning-Auswahl waere dabei fachlich vom gewaehlten Modell
getrennt, obwohl beides fuer den Benutzer eine gemeinsame Modellkonfiguration
bildet.

## Ziel

Die Modell-Auswahl soll gleichzeitig die zum Modell gehoerende
Reasoning-Einstellung verwalten. In jedem Copilot-Tab kann der Benutzer fuer
jedes Modell eine eigene Reasoning-Stufe speichern. Beim Modellwechsel werden
Modell und zugeordnete Reasoning-Stufe automatisch gemeinsam aktiviert.

## Scope

- In Scope: Reasoning-Untermenue innerhalb des Modell-Dropdowns fuer
  Copilot-ACP-Tabs
- In Scope: `Standard`, `low`, `medium`, `high`, `xhigh` und `max`
- In Scope: Anzeige der gespeicherten Reasoning-Stufe neben jedem Modell
- In Scope: Zuordnung pro Modell innerhalb eines Tabs bzw. einer Session
- In Scope: Uebergabe an den Copilot-Prozess ueber
  `--reasoning-effort <wert>`
- In Scope: transparente Anwendung bei einem bereits laufenden ACP-Prozess
- In Scope: tab- und sessionbezogene Persistenz
- In Scope: Tests und kurze Aktualisierung der relevanten Dokumentation
- Out of Scope: provider-spezifische Reasoning-Parameter fuer Anthropic,
  OpenAI, Gemini, GLM oder Ollama
- Out of Scope: eine globale Standard-Reasoning-Einstellung
- Out of Scope: dynamische, modellabhaengige Filterung der verfuegbaren
  Reasoning-Stufen

## Betroffene Bereiche

- `renderer/index.html` und `renderer/styles.css` — Modell-Dropdown und
  verschachteltes Reasoning-Untermenue
- `renderer/app.js` — Tab-State, Modell-Reasoning-Zuordnung, Persistenz und
  Prompt-Option
- `main.js` — Weitergabe der Option an Copilot-ACP
- `src/acp-client.js` — CLI-Argument und Neustart bei geaenderter Auswahl
- `__tests__/model-selection.test.js` und `__tests__/acp-client.test.js`
- `docs/ARCHITECTURE.md` und `docs/USER-GUIDE.md`

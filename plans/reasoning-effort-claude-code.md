# Plan: Reasoning-Effort-Steuerung für Claude Code (ACP `configOptions`)

## Ziel

Der Claude-Code-ACP-Adapter (`@agentclientprotocol/claude-agent-acp`, aktuell
gepinnt auf `0.74.0`) unterstützt seit `0.72.0` ("Adopt per-model effort
settings") einen generischen Session-Konfigurationsmechanismus, über den ein
ACP-Client die Reasoning-Effort-Stufe eines Modells live setzen kann — ohne
Prozessneustart. Agent Desktop nutzt diesen Mechanismus für `model` und `mode`
bereits (`session/set_config_option`), aber noch nicht für `effort`. Dieses
Feature schließt genau diese Lücke: eine Reasoning-Auswahl im Modell-Dropdown
für **beide** Claude-Code-Varianten (`claude-code`, `claude-code-ssh`),
analog zu der bereits umgesetzten Copilot-Reasoning-Auswahl
(`feature/reasoning-selection`, `specs/changes/reasoning-effort-selection/`),
aber mit einem grundlegend anderen Backend-Mechanismus.

## Kontext / Recherche-Ergebnis (verifiziert am installierten Adapter-Paket)

- `session/new` und `session/load` liefern ein `configOptions`-Array. Wenn das
  aktuell gewählte Modell `supportsEffort: true` meldet, enthält es einen
  Eintrag `{ id: "effort", type: "select", category: "thought_level",
  currentValue, options: [{value, name}, ...] }`. Die Werte kommen dynamisch
  vom Modell (`supportedEffortLevels`) — **keine feste Liste** wie bei Copilot
  (dort: `low/medium/high/xhigh/max`, hart im Renderer kodiert).
- Setzen erfolgt über die ACP-Methode `session/set_config_option` mit
  `{ sessionId, configId: "effort", value }` — wirkt sofort auf die laufende
  Session, kein Restart nötig (anders als Copilots `--reasoning-effort`, das
  ein Startargument ist und einen Prozessneustart erfordert).
- Agent Desktop nutzt exakt dieselbe Methode bereits für `model`
  (`src/acp-client.js` `#applyModel()`, Zeile ~386) und `mode` (`#applyMode()`,
  Zeile ~458) über das Flag `options.useConfigOptions` (für Claude Code
  gesetzt, für Copilot nicht — Copilot beantwortet `session/set_config_option`
  nicht, siehe `#effectiveReasoningEffort()`-Kommentar aus der
  Copilot-Reasoning-Änderung). `#captureModes()`/`#emitAvailableModes()`
  parsen bereits einen `configOptions`-Eintrag (`id === 'mode'`) nach exakt
  diesem Muster — die Effort-Ergänzung ist eine Erweiterung eines
  bestehenden, bewährten Musters, keine neue Architektur.
- Modellwechsel verändert die verfügbaren Effort-Stufen (andere Modelle =
  andere `supportedEffortLevels`). Der Adapter baut `configOptions` deshalb
  nach jedem `session/set_config_option`-Aufruf für `model` neu auf und gibt
  sie in der Antwort zurück (`{ configOptions }`). `#applyModel()` liest diese
  Antwort aktuell gar nicht aus — das muss ergänzt werden, sonst bleiben nach
  einem Modellwechsel die alten Effort-Optionen im UI stehen.
- GitHub-Issue #297 im Adapter-Repo (weiterhin offen) bezieht sich auf die
  native CLI-Oberfläche, nicht auf diesen ACP-Mechanismus — daher kein
  Blocker für dieses Feature.

## Design-Entscheidungen

- **Live, kein Restart**: `#applyEffort()` läuft wie `#applyModel()`/
  `#applyMode()` in `prompt()` vor dem Senden — keine Restart-Logik wie bei
  Copilot nötig. `#restartForReasoningIfNeeded()` (Copilot-spezifisch) bleibt
  unverändert und betrifft Claude Code nicht (`#effectiveReasoningEffort()`
  gibt für Claude-Code-Clients bereits `null` zurück, da `#baseArgs` gesetzt
  ist).
- **Dynamische statt fester Werteliste**: anders als bei Copilot kommt die
  Liste möglicher Effort-Stufen aus der Adapter-Antwort, nicht aus einer
  Konstante im Renderer. Vor dem ersten `session/new`/`session/load` einer
  Session sind sie unbekannt — genau wie die Claude-Code-Modellliste heute
  bereits erst nach `agent.models_available` bekannt ist. Gleiches,
  akzeptiertes Verhalten, kein neuer UX-Sonderfall.
- **Nicht jedes Modell unterstützt Effort**: das Dropdown-Untermenü erscheint
  nur, wenn die aktuelle Adapter-Antwort einen `effort`-Eintrag für das
  gewählte Modell enthält — kein hartkodiertes "gilt für alle Modelle" wie
  aktuell bei Copilot.
- **Datenmodell-Wiederverwendung**: `tab.reasoningByModel` (bereits für
  Copilot eingeführt, `Object<modelId, string|null>`) wird auch für Claude
  Code verwendet — gleiche Form, gleiche Persistenz-Helper
  (`saveSessionReasoningByModel` etc.). Die Gültigkeitsprüfung unterscheidet
  sich pro Provider (Copilot: feste Menge; Claude Code: die zuletzt vom
  Adapter gemeldete Optionsliste für das jeweilige Modell) — das bleibt in
  provider-spezifischen Normalisierungsfunktionen, die Datenstruktur selbst
  wird nicht verdoppelt.
- **Scope**: `claude-code` und `claude-code-ssh` über `isClaudeCodeProvider()`
  gemeinsam behandelt (gleicher Adapter, nur der Prozessort unterscheidet
  sich — wie bei allen anderen Claude-Code-Gemeinsamkeiten im Code).
- **Out of Scope**: Anthropic/OpenAI/GLM/Ollama (bewusst zurückgestellt, siehe
  Copilot-Reasoning-Plan); Änderungen an Copilots Restart-Mechanismus;
  Änderungen am Adapter-Pinning selbst.

## Betroffene Bereiche

### Task 1: `src/acp-client.js` — Effort-Discovery und -Anwendung

- [x] `#captureEffortOptions(result)`: liest `result.configOptions.find(o =>
  o.id === 'effort')`, analog zu `#captureModes()`. Speichert
  `#availableEffortLevels` (Array `{value, name}`) und `#currentEffort`
  (String oder `null`, aus `option.currentValue`, `"default"` → `null`).
  Fehlt der Eintrag (Modell ohne Effort-Support) → beide auf leer/`null`
  zurücksetzen, damit ein Modellwechsel zu einem nicht unterstützenden Modell
  das UI korrekt leert.
- [x] `#emitAvailableEffort(result)`: emittiert `session.effort_available`
  mit `{ levels: [{id, name}], currentEffort }` an den Renderer — nur wenn
  `levels.length` (analog `#emitAvailableModes`, das ebenfalls nur bei
  Treffern emittiert).
- [x] Aufruf von `#captureEffortOptions()`/`#emitAvailableEffort()` überall
  dort, wo aktuell `#captureModes()` aufgerufen wird (`newSession`,
  `loadSession`, Zeilen ~284/335) **und zusätzlich** direkt nach einem
  erfolgreichen `#applyModel()`-Aufruf (dessen Response bisher verworfen
  wird) — siehe Kontext oben: Modellwechsel ändert die Effort-Optionen.
- [x] `#appliedEffort` (State, analog `#appliedModel`/`#appliedMode`).
- [x] `#applyEffort()`: liest `this.#options.effort`; no-op wenn kein Wert,
  Wert unbekannt (nicht in `#availableEffortLevels`) oder bereits
  `=== #appliedEffort`. Sonst `session/set_config_option` mit
  `configId: 'effort'`. Nur aufrufen, wenn `this.#options.useConfigOptions`
  (Copilot bleibt unberührt — dort validiert bereits die bestehende
  `normalizeReasoningEffort`/Restart-Logik).
- [x] Aufruf `await this.#applyEffort();` in `prompt()` direkt nach
  `await this.#applyMode();` (Zeile ~531).
- [x] Reset von `#appliedEffort`/`#availableEffortLevels` bei Prozess-Restart/
  -Exit, analog zu `#appliedModel`/`#appliedMode` in `start()`.

**Contract:**
```js
// Neues Event an den Renderer, analog session.modes_available:
{ type: 'session.effort_available',
  data: { levels: [{ id: string, name: string }], currentEffort: string|null } }
```

### Task 2: `main.js` — Optionsfluss

- [x] `sendAgentPrompt()`: `effort: options.effort` **zusätzlich** im
  Claude-Code-Zweig (`claude-code`/`claude-code-ssh`, aktuell Zeile ~411-419)
  weiterreichen — dort bisher bewusst nicht gesetzt (Kommentar an Zeile ~426
  "Claude Code has no equivalent flag" ist durch dieses Feature überholt und
  muss präzisiert werden: *kein CLI-Flag*, aber sehr wohl ein
  Live-Config-Option-Weg).
- [x] Kein neuer IPC-Handler nötig — Effort läuft wie Modell/Modus über
  `options.effort` bei `agent:sendMessage`/`copilot:send` und
  `client.updateOptions(clientOptions)` vor `client.prompt()`.

### Task 3: `renderer/app.js` — UI-Wiederverwendung

- [x] Neuer State pro Tab: `tab.availableEffortLevels` (aus
  `session.effort_available`, nicht persistiert — kommt bei jeder Session
  frisch vom Adapter) statt der Copilot-Konstante `REASONING_EFFORTS`.
- [x] Neuer Event-Case `session.effort_available` (Vorbild:
  `session.modes_available`, Zeile ~2119): speichert Levels + aktuellen Wert
  am Tab, ruft `updateModelSelectBtn(tabId)`.
- [x] `initTabModelSelector()`: die Bedingung `isCopilot` (steuert aktuell,
  ob das Untermenü gebaut wird) um Claude Code erweitern — aber nur wenn
  `tab.availableEffortLevels?.length` für das jeweils angeklickte Modell
  vorliegt. Optionsliste im Untermenü kommt für Claude Code aus
  `tab.availableEffortLevels` statt aus `REASONING_EFFORTS`.
- [x] `selectModelForTab()`/`getReasoningForModel()`: Normalisierung für
  Claude-Code-Tabs gegen `tab.availableEffortLevels` statt gegen die
  Copilot-Konstante `VALID_REASONING_EFFORTS`.
- [x] `sendMessage()`: `effort`-Berechnung (aktuell auf `tabProvider ===
  'copilot'` beschränkt) um `isClaudeCodeProvider(tabProvider)` erweitern.
- [x] `updateModelSelectBtn()`: Anzeige-Badge (`🧠 Modell · Stufe`) für Claude
  Code **identisch zur Copilot-Darstellung** (Entscheidung des Nutzers) —
  gleiche Badge-Logik, nur wenn Effort-Optionen für das aktuelle Modell
  bekannt sind; ohne bekannte Optionen wie bisher ohne Badge (kein
  Unterschied zu Copilots eigenem Verhalten bei fehlender Zuordnung).
- [x] Persistenz: `reasoningByModel`/`sessionReasoningByModel` unverändert
  (gleiche Helper wie bei Copilot) — beim Wiederherstellen eines Claude-Code-
  Tabs ist der gespeicherte Wert erst nach dem nächsten `session/new|load`
  wieder gegen die dann bekannten `availableEffortLevels` zu validieren
  (kann ungültig sein, wenn sich die Adapter-Version/Modellinfo geändert
  hat). **Entscheidung:** ungültige Werte fallen auf `null`/Standard zurück
  UND lösen eine Notification aus ("Reasoning-Stufe für Modell „X" nicht
  mehr verfügbar, auf Standard zurückgesetzt.") — analog `showNotification`,
  wie an anderen Stellen der App bereits für nicht mehr verfügbare Modelle
  verwendet (`isCopilotModelAvailable`-Meldung in `sendMessage()`).

### Task 4: Tests

- [x] `__tests__/acp-client.test.js`: `#captureEffortOptions`/
  `#emitAvailableEffort` (Eintrag vorhanden/fehlend, Modellwechsel ändert
  Optionen), `#applyEffort()` (kein Aufruf ohne Wert, kein Aufruf bei
  unbekanntem Wert, kein doppelter Aufruf bei unverändertem Wert, korrekter
  `session/set_config_option`-Request), Reset bei Restart.
- [x] `__tests__/model-selection.test.js`: Untermenü für Claude-Code-Tabs nur
  bei vorhandenen Effort-Optionen, Tab-Isolation, Persistenz/Restore mit
  nachträglicher Revalidierung gegen neue `availableEffortLevels`.
- [x] Bestehende Copilot-Reasoning-Tests dürfen sich nicht ändern (reiner
  Additiv-Fall) — als Regressionscheck mitlaufen lassen.

### Task 5: Doku

- [x] `docs/ARCHITECTURE.md`: neuer Abschnitt neben "6.3.1 Process restart
  (Copilot reasoning effort)" — Gegenstück ohne Restart, mit Verweis auf den
  bestehenden `configOptions`-Mechanismus für `model`/`mode`.
- [x] `docs/USER-GUIDE.md`: Ergänzung im 🧠-Model-Abschnitt — Claude Code
  zeigt die Reasoning-Stufe nur für Modelle, die der Adapter dafür meldet;
  kein Prozessneustart, Wechsel gilt ab der nächsten Nachricht (wie
  Modell/Modus).
- [x] `CHANGELOG.md` + `package.json` Versions-Bump (Minor, neues Feature) —
  erst im Release-Schritt, nicht Teil der Implementierung.

## Nicht im Scope

- Anthropic/OpenAI/GLM/Ollama (siehe `reasoning-effort-copilot-first`-Notiz —
  weiterhin bewusst zurückgestellt).
- Änderungen an Copilots `--reasoning-effort`-Restart-Mechanismus.
- Skills/Agents-Discovery für `claude-code-ssh` (separates, bereits
  zurückgestelltes Thema).
- Ein Adapter-Update über `0.74.0` hinaus, falls eine neuere Version die
  `configOptions`-Struktur ändert — Plan geht vom aktuell verifizierten
  Stand aus.

## Entscheidungen des Nutzers (vor Umsetzung geklärt)

1. Anzeige im 🧠-Button: identisch zu Copilot (Badge neben dem Modellnamen).
2. Ungültig gewordener gespeicherter Effort-Wert: auf Standard zurücksetzen
   **und** den Nutzer per Notification informieren (nicht still).

## Umsetzung

Developer- und Tester-Agent liefen parallel (Tasks 1/2/3/5 bzw. Task 4).
Danach eigene Review-Runde (Diff komplett gelesen, nicht nur Testergebnis
geprüft):

- **Gefundener und gefixter Bug** (nicht durch die parallel geschriebenen
  Tests abgedeckt): `#applyEffort()` hat einen Rücksprung auf `Standard`
  (`effort === null`) grundsätzlich übersprungen, weil der Guard `if (!effort
  || ...) return;` lautete. Der Adapter pinnt eine einmal explizit gesetzte
  Stufe serverseitig (`effortPinnedByUser`) und behält sie über Modellwechsel
  hinweg bei — ein reines "nichts senden" hätte den Pin nie aufgehoben. Die
  UI hätte "Standard" gezeigt, während die Session weiter mit der zuletzt
  gesetzten Stufe gelaufen wäre. Fix: `#applyEffort()` sendet jetzt bei einer
  Änderung IMMER (auch Richtung Standard), mit `value: 'default'` statt
  `value: null`. Zwei Regressionstests ergänzt (`__tests__/acp-client.test.js`,
  Sektion „Effort-Anwendung"): Rücksprung auf Standard sendet `default`;
  niemals konfiguriert sendet weiterhin gar nichts (kein Standard→Standard-
  Rauschen).
- Nebenbei behoben: `#currentEffort` war gesetzt, aber nie gelesen
  (`#emitAvailableEffort` hat `result` unabhängig neu geparst statt die
  bereits gesetzten Felder zu nutzen) — ESLint-Fehler
  (`no-unused-private-class-members`). Refactored: `#emitAvailableEffort()`
  liest jetzt `#availableEffortLevels`/`#currentEffort` statt zu duplizieren.
- `docs/ARCHITECTURE.md` Abschnitt 6.3.2 an den korrigierten
  `#applyEffort()`-Wortlaut angepasst.

**Ergebnis (vor der Korrektur unten):** 49/49 Suiten, 1719/1719 Tests grün.
ESLint: 0 Fehler.

## Korrektur: dynamische Discovery war eine Fehlannahme

Nach dem ersten Durchgang stellte der Nutzer die Kernannahme des Plans infrage
und hatte recht: Anthropics Reasoning-Effort-Parameter ist **nicht** pro
Modell gegated. Beleg: Haiku (kein Extended-Thinking-Modell) bietet in der
Praxis dieselben Effort-Stufen wie Sonnet; auch online findet sich für
praktisch alle reasoning-fähigen Modelle dieselbe feste Liste. Der Plan hatte
sich auf die generische Gating-*Möglichkeit* im Adapter-Code gestützt
(`supportsEffort`/`supportedEffortLevels` als optionale Felder in der
zugrundeliegenden `@anthropic-ai/claude-agent-sdk`), ohne zu verifizieren, ob
diese in der Praxis tatsächlich modellabhängig unterschiedlich ausfallen —
das war der Fehler.

**Konsequenz:** Die gesamte Live-Discovery-Schicht wurde wieder entfernt:

- `src/acp-client.js`: `#captureEffortOptions`, `#emitAvailableEffort`,
  `#availableEffortLevels`, `#currentEffort` sowie das `session.effort_available`-
  Event komplett gestrichen. `#applyEffort()` validiert nicht mehr gegen eine
  entdeckte Liste, sondern nutzt dieselbe feste `normalizeReasoningEffort()`
  (low/medium/high/xhigh/max) wie Copilot — Konstruktor und `updateOptions()`
  brauchen dafür keine Provider-Fallunterscheidung mehr. Der Fix vom ersten
  Durchgang (Rücksprung auf Standard sendet `value:'default'`) bleibt
  unverändert gültig und ist weiterhin regressionsgetestet.
- `renderer/app.js`: `tab.availableEffortLevels` entfernt, `REASONING_EFFORTS`
  (bisher Copilot-only) gilt jetzt für beide Provider. `initTabModelSelector()`
  zeigt das Untermenü für **jede** Claude-Code-Modell-Zeile sofort, nicht mehr
  nur für die aktive nach einer gesendeten Nachricht — behebt gleichzeitig die
  vom Nutzer beobachtete Notwendigkeit, "pro Modell einmal eine Nachricht zu
  senden". `normalizeCopilotReasoningEffort` → `normalizeKnownReasoningEffort`
  (provider-neutral), `getReasoningForModel()`/`selectModelForTab()` ohne
  Provider-Verzweigung.
- `docs/ARCHITECTURE.md` (6.3.2) und `docs/USER-GUIDE.md`: auf den korrigierten,
  einfacheren Stand gebracht.
- Tests: `__tests__/acp-client.test.js` — "Effort-Discovery"-Block entfernt
  (testete gestrichene Methoden), ein Test von "unbekannter Wert" auf
  "ungültiger Wert" umbenannt/angepasst (`xhigh` ist jetzt gültig).
  `__tests__/model-selection.test.js` Sektion 8 komplett neu geschrieben (feste
  Liste statt Discovery-Mock); ein vorbestehender Test
  ("Nicht-Copilot-Provider erhalten keine Reasoning-Option") war durch das
  Feature selbst überholt und wurde korrigiert (Claude Code bekommt Reasoning,
  echte Direkt-API-Provider weiterhin nicht).

**Ergebnis (nach der Korrektur):** 49/49 Suiten, 1709/1709 Tests grün. ESLint:
0 Fehler, nur vorbestehende Warnungen.

## Status

Fertig implementiert und reviewt (inkl. Korrekturrunde) — **noch nicht
committet, noch nicht gepusht**. CHANGELOG/package.json-Versionsbump bewusst
offen gelassen (Task 5, letzter Punkt) — das ist der separate Release-Schritt.

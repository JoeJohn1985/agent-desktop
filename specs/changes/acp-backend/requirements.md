# Requirements: ACP-Backend-Migration

## Status
- **Erstellt:** 2026-06-16
- **Phase:** Draft

---

## 1. ACP-Prozess Lifecycle

### REQ-01: Prozess-Start
- **SHALL** beim Öffnen eines Tabs `copilot --acp` als Child-Prozess starten
- **SHALL** nach Spawn `initialize` senden und auf Bestätigung warten
- **SHOULD** Timeout von 10s für Initialize haben, danach Retry

### REQ-02: Prozess-Stop
- **SHALL** beim Schließen eines Tabs den ACP-Prozess sauber beenden (SIGTERM)
- **SHALL** nach 5s ohne Exit den Prozess forciert killen (SIGKILL)
- **SHALL** beim App-Close alle ACP-Prozesse beenden

### REQ-03: Crash-Recovery
- **SHALL** bei unerwartetem Prozess-Exit automatisch neustarten
- **SHALL** nach Neustart die aktive Session via `session/load` wiederherstellen
- **SHOULD** maximal 3 Restart-Versuche innerhalb von 60s erlauben
- **MAY** den User bei wiederholtem Crash informieren

#### Szenario: Crash während Streaming
```gherkin
Given ein ACP-Prozess streamt eine Antwort
When der Prozess unerwartet terminiert
Then wird ein neuer ACP-Prozess gestartet
And die Session wird via session/load wiederhergestellt
And der User sieht eine Fehlermeldung "Verbindung unterbrochen, Session wiederhergestellt"
```

---

## 2. Session-Management

### REQ-04: Neue Session
- **SHALL** beim ersten Prompt in einem Tab `session/new` aufrufen
- **SHALL** die zurückgegebene Session-ID persistent speichern

### REQ-05: Session laden
- **SHALL** bei Tab-Wiederöffnung oder Crash-Recovery `session/load` mit gespeicherter ID aufrufen
- **SHALL** bei fehlgeschlagenem Load auf `session/new` fallbacken

### REQ-06: Session-Liste
- **SHALL** via `session/list` verfügbare Sessions für den Session-Switcher abrufen
- **SHOULD** Sessions nach letzter Aktivität sortieren

#### Szenario: Bestehende Session weiternutzen
```gherkin
Given eine Session mit ID "abc-123" existiert
When der User den Tab öffnet
Then wird session/load mit ID "abc-123" aufgerufen
And der Chat-Verlauf ist sofort verfügbar
And neue Nachrichten werden an dieselbe Session angehängt
```

---

## 3. Nachricht senden + Streaming

### REQ-07: Prompt senden
- **SHALL** User-Nachrichten via `session/prompt` an den ACP-Prozess senden
- **SHALL** die Request-ID für Cancel-Zuordnung speichern

### REQ-08: Streaming-Empfang
- **SHALL** `session/update` Events in Echtzeit an den Renderer weiterleiten
- **SHALL** Partial-Updates (Chunks) inkrementell im Chat anzeigen

#### Szenario: Nachricht mit Streaming
```gherkin
Given eine aktive ACP-Session
When der User "Erkläre Rust" eingibt
Then wird session/prompt mit dem Text gesendet
And agent_message_chunk Events werden als Live-Text angezeigt
And nach dem letzten Chunk ist die Nachricht komplett
```

---

## 4. Event-Mapping

### REQ-09: Event-Typen
- **SHALL** folgende ACP-Events verarbeiten:

| ACP-Event | Renderer-Aktion |
|-----------|----------------|
| `agent_message_chunk` | Text-Chunk an Chat-Bubble anhängen |
| `agent_thought_chunk` | Thinking-Block aktualisieren |
| `tool_call` | Tool-Aufruf-UI anzeigen |
| `tool_call_update` | Tool-Status aktualisieren |
| `config_option_update` | Konfiguration im State aktualisieren |
| `available_commands_update` | Command-Palette aktualisieren |

### REQ-10: Event-Integrität
- **SHALL** Events in Reihenfolge verarbeiten (kein Reordering)
- **SHOULD** bei unbekannten Event-Typen eine Warning loggen, nicht crashen

#### Szenario: Tool-Call Event
```gherkin
Given der Agent führt einen Tool-Call aus
When ein tool_call Event empfangen wird
Then wird die Tool-Aufruf-UI mit Name und Parametern angezeigt
And bei tool_call_update wird der Fortschritt aktualisiert
```

---

## 5. Model-Wechsel

### REQ-11: Model-Wechsel mid-Session
- **SHALL** `/model X` als normalen Prompt via `session/prompt` senden
- **SHALL** `config_option_update` Event verarbeiten und UI aktualisieren
- **SHOULD** den aktiven Model-Namen im Tab-Header anzeigen

#### Szenario: Model wechseln
```gherkin
Given eine aktive Session mit Model "gpt-4o"
When der User "/model claude-sonnet" eingibt
Then wird der Text als session/prompt gesendet
And ein config_option_update Event bestätigt den Wechsel
And der Tab-Header zeigt "claude-sonnet"
```

---

## 6. Cancel/Stop

### REQ-12: Laufende Antwort abbrechen
- **SHALL** Cancel durch Killen des ACP-Prozesses implementieren
- **SHALL** nach Kill sofort einen neuen Prozess starten
- **SHALL** die Session via `session/load` wiederherstellen
- **SHOULD** dem User den bisherigen Output bis zum Cancel-Zeitpunkt anzeigen

#### Szenario: User bricht ab
```gherkin
Given eine Antwort wird gestreamt
When der User "Stop" klickt
Then wird der ACP-Prozess gekillt
And ein neuer Prozess wird gestartet
And die Session wird via session/load geladen
And der bisherige Partial-Output bleibt sichtbar
```

---

## 7. Nicht-funktionale Anforderungen

### REQ-13: Performance
- **SHALL** Latenz zwischen Prompt-Absenden und erstem Chunk < 100ms (netto, ohne API)
- **SHALL** Speicherverbrauch pro ACP-Prozess < 200MB

### REQ-14: Kompatibilität
- **SHALL** mit bestehenden Session-Dateien kompatibel sein
- **SHALL** keine Änderungen am User-Interface erfordern (gleiche UX)

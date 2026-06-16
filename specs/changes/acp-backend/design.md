# Design: ACP-Backend-Migration

## Status
- **Erstellt:** 2026-06-16
- **Phase:** Draft

---

## Architektur-Überblick

```
┌─────────────────────────────────────────────────────┐
│  Renderer (app.js)                                  │
│  ┌───────────────┐     ┌────────────────────────┐  │
│  │ Chat UI       │     │ Event Handler          │  │
│  └───────┬───────┘     └────────────▲───────────┘  │
│          │ IPC invoke               │ IPC on       │
├──────────┼──────────────────────────┼──────────────┤
│  Preload (preload.js) — IPC Bridge                  │
├──────────┼──────────────────────────┼──────────────┤
│  Main Process (main.js)             │              │
│  ┌───────▼───────────────────────────┴───────────┐  │
│  │           AcpClient (pro Tab)                 │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │ Process │  │ JSON-RPC │  │ Event       │  │  │
│  │  │ Manager │  │ Protocol │  │ Dispatcher  │  │  │
│  │  └─────────┘  └──────────┘  └─────────────┘  │  │
│  └───────────────────┬───────────────────────────┘  │
│                      │ stdin/stdout                  │
│  ┌───────────────────▼───────────────────────────┐  │
│  │         copilot --acp (Child Process)         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## AcpClient Klasse

### Verantwortlichkeiten
- Child-Prozess spawnen und am Leben halten
- JSON-RPC Requests senden und Responses korrelieren
- Events an den Renderer dispatchen
- Crash-Recovery mit Session-Wiederherstellung

### State

```javascript
class AcpClient {
  // Konfiguration
  #tabId;           // Zuordnung zum Tab
  #sessionId;       // Aktive ACP-Session-ID

  // Prozess
  #process;         // ChildProcess (copilot --acp)
  #state;           // 'starting' | 'ready' | 'busy' | 'dead'

  // Protokoll
  #requestId;       // Inkrementeller JSON-RPC Request Counter
  #pendingRequests; // Map<id, {resolve, reject, timeout}>

  // Recovery
  #restartCount;    // Anzahl Restarts in letzter Minute
  #lastRestartAt;   // Timestamp letzter Restart
}
```

### Methoden

| Methode | Beschreibung |
|---------|-------------|
| `constructor(tabId, win)` | Client erstellen, BrowserWindow-Ref für IPC |
| `start()` | Prozess spawnen + `initialize` senden |
| `stop()` | Graceful Shutdown (SIGTERM → timeout → SIGKILL) |
| `newSession()` | `session/new` aufrufen, sessionId speichern |
| `loadSession(id)` | `session/load` aufrufen |
| `listSessions()` | `session/list` aufrufen |
| `prompt(text)` | `session/prompt` senden |
| `cancel()` | Prozess killen + restart + session/load |
| `#sendRequest(method, params)` | JSON-RPC Request mit Promise |
| `#handleLine(line)` | Eingehende JSON-Zeile parsen + dispatchen |
| `#handleCrash(code)` | Restart-Logik + Recovery |
| `#emitToRenderer(event, data)` | Event via IPC an BrowserWindow senden |

---

## JSON-RPC Protokoll

### Request-Format
```json
{"jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": {"text": "Hallo"}}
```

### Response-Format
```json
{"jsonrpc": "2.0", "id": 1, "result": {"status": "ok"}}
```

### Event-Format (Notification, keine id)
```json
{"jsonrpc": "2.0", "method": "session/update", "params": {"type": "agent_message_chunk", "data": {"text": "Hi"}}}
```

### Linie-basiertes Framing
- Ein JSON-Objekt pro Zeile (NDJSON)
- Readline auf stdout für eingehende Daten
- Write + `\n` auf stdin für ausgehende Requests

---

## Event-Mapping: Alt → Neu

| Altes System (JSONL) | ACP-Event | Mapping-Logik |
|-----------------------|-----------|---------------|
| `type: "content"` | `agent_message_chunk` | `data.text` → Chat-Bubble append |
| `type: "thinking"` | `agent_thought_chunk` | `data.text` → Thinking-Block |
| `type: "tool_use"` | `tool_call` | `data.name`, `data.input` → Tool-UI |
| `type: "tool_result"` | `tool_call_update` | `data.output` → Tool-Result |
| *(neu)* | `config_option_update` | Model/Config UI aktualisieren |
| *(neu)* | `available_commands_update` | Command-Palette aktualisieren |

---

## Prozess-Lifecycle

```
┌──────────┐   start()   ┌──────────┐  initialize OK  ┌───────┐
│  DEAD    │────────────►│ STARTING │─────────────────►│ READY │
└──────────┘             └──────────┘                  └───┬───┘
     ▲                        │                            │
     │                   init timeout                  prompt()
     │                        │                            │
     │                        ▼                            ▼
     │                   ┌──────────┐               ┌──────────┐
     │                   │  DEAD    │               │   BUSY   │
     │                   └──────────┘               └────┬─────┘
     │                                                   │
     │         crash / cancel                     response complete
     │◄──────────────────────────────────────────────────┘
     │                                                   │
     │         auto-restart (max 3x/min)                 ▼
     └───────────────────────────────────────────── ┌───────┐
                                                    │ READY │
                                                    └───────┘
```

---

## IPC-Änderungen

### Neue IPC-Channels (Main ↔ Renderer)

| Channel | Richtung | Payload |
|---------|----------|---------|
| `acp:prompt` | Renderer → Main | `{tabId, text}` |
| `acp:cancel` | Renderer → Main | `{tabId}` |
| `acp:new-session` | Renderer → Main | `{tabId}` |
| `acp:load-session` | Renderer → Main | `{tabId, sessionId}` |
| `acp:list-sessions` | Renderer → Main | `{tabId}` |
| `acp:event` | Main → Renderer | `{tabId, type, data}` |
| `acp:state` | Main → Renderer | `{tabId, state}` |
| `acp:error` | Main → Renderer | `{tabId, error}` |

### Entfernte IPC-Channels (nach Migration)
- `copilot:spawn` (ersetzt durch `acp:prompt`)
- `copilot:kill` (ersetzt durch `acp:cancel`)
- `copilot:output` (ersetzt durch `acp:event`)

---

## Fehlerbehandlung

| Fehlerfall | Verhalten |
|-----------|-----------|
| `initialize` timeout | Prozess killen, neu starten |
| JSON-Parse-Fehler | Zeile loggen, ignorieren |
| Request timeout (30s) | Request rejecten, Error an UI |
| Prozess exit code ≠ 0 | Auto-Restart + session/load |
| session/load fehlgeschlagen | Fallback auf session/new |
| Max Restarts erreicht | State = DEAD, User informieren |

---

## Migration-Strategie

1. **Phase 1:** AcpClient parallel zum bestehenden System implementieren
2. **Phase 2:** Feature-Flag `useAcp: true` zum Umschalten
3. **Phase 3:** Altes System entfernen nach Validierung

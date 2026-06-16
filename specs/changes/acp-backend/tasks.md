# Tasks: ACP-Backend-Migration

## Status
- **Erstellt:** 2026-06-16
- **Phase:** Draft

---

## Phase 1: AcpClient Grundgerüst

- [ ] **T-01:** `src/acp-client.js` erstellen
  - AcpClient Klasse mit Constructor (tabId, BrowserWindow)
  - State-Machine: dead → starting → ready → busy
  - JSON-RPC Request/Response-Korrelation via requestId-Map
  - NDJSON-Parser für stdout (readline)

- [ ] **T-02:** Prozess-Management in AcpClient
  - `start()`: `child_process.spawn('copilot', ['--acp'])`
  - `stop()`: SIGTERM → 5s timeout → SIGKILL
  - Exit-Handler mit Auto-Restart-Logik
  - Restart-Counter (max 3 pro 60s)

- [ ] **T-03:** `initialize` Handshake
  - Nach Spawn `initialize` Request senden
  - Auf Response warten (timeout 10s)
  - State auf `ready` setzen bei Erfolg
  - Bei Timeout: kill + restart

---

## Phase 2: Session-Management

- [ ] **T-04:** Session-Methoden implementieren
  - `newSession()` → `session/new` → sessionId speichern
  - `loadSession(id)` → `session/load` → Fallback auf new
  - `listSessions()` → `session/list` → Array zurückgeben

- [ ] **T-05:** Session-Persistenz
  - SessionId pro Tab in `src/session-store.js` speichern
  - Beim App-Start: gespeicherte Sessions laden
  - Beim Tab-Close: Session-Zuordnung aufräumen

---

## Phase 3: Prompt + Event-Streaming

- [ ] **T-06:** `prompt(text)` implementieren
  - `session/prompt` Request senden
  - State auf `busy` setzen
  - Request-ID für Cancel-Zuordnung merken

- [ ] **T-07:** Event-Dispatcher
  - `session/update` Notifications parsen
  - Event-Type extrahieren (agent_message_chunk, etc.)
  - Via `#emitToRenderer()` an BrowserWindow senden
  - State auf `ready` nach finaler Response

- [ ] **T-08:** Event-Mapping implementieren
  - `agent_message_chunk` → Text-Chunk append
  - `agent_thought_chunk` → Thinking-Block update
  - `tool_call` → Tool-UI anzeigen
  - `tool_call_update` → Tool-Status update
  - `config_option_update` → Config-State update
  - `available_commands_update` → Commands update

---

## Phase 4: IPC-Bridge

- [ ] **T-09:** `preload.js` erweitern
  - Neue IPC-Channels registrieren: `acp:prompt`, `acp:cancel`, `acp:new-session`, `acp:load-session`, `acp:list-sessions`
  - Event-Listener für `acp:event`, `acp:state`, `acp:error`
  - contextBridge API erweitern

- [ ] **T-10:** `main.js` IPC-Handler
  - `ipcMain.handle('acp:prompt')` → AcpClient.prompt()
  - `ipcMain.handle('acp:cancel')` → AcpClient.cancel()
  - `ipcMain.handle('acp:new-session')` → AcpClient.newSession()
  - `ipcMain.handle('acp:load-session')` → AcpClient.loadSession()
  - `ipcMain.handle('acp:list-sessions')` → AcpClient.listSessions()
  - AcpClient-Instanzen pro Tab verwalten (Map<tabId, AcpClient>)

---

## Phase 5: Renderer-Integration

- [ ] **T-11:** `renderer/app.js` Event-Handling
  - `acp:event` Listener für Streaming-Updates
  - `agent_message_chunk` → Chat-Bubble inkrementell füllen
  - `agent_thought_chunk` → Thinking-Collapse aktualisieren
  - `tool_call` / `tool_call_update` → Tool-Anzeige

- [ ] **T-12:** Prompt-Senden umstellen
  - `sendMessage()` von `copilot:spawn` auf `acp:prompt` umstellen
  - Session-Start-Logik (new vs. load) integrieren
  - Loading-State an `acp:state` Events koppeln

- [ ] **T-13:** Cancel-Button
  - Stop-Button ruft `acp:cancel` statt `copilot:kill`
  - Partial-Output bleibt sichtbar
  - "Antwort abgebrochen" Indikator anzeigen

---

## Phase 6: Model-Wechsel + Spezialfälle

- [ ] **T-14:** Model-Wechsel
  - `/model X` als normalen Prompt via `acp:prompt` senden
  - `config_option_update` Event verarbeiten
  - Model-Anzeige im Tab-Header aktualisieren

- [ ] **T-15:** Crash-Recovery End-to-End
  - Bei AcpClient crash: neuen Prozess starten
  - `session/load` mit gespeicherter sessionId
  - User-Benachrichtigung: "Session wiederhergestellt"
  - Bisherigen Chat-Verlauf beibehalten (aus Renderer-State)

---

## Phase 7: Cleanup + Migration

- [ ] **T-16:** Altes System entfernen (Big-Bang, kein Feature-Flag)
  - `spawnCopilot()` Funktion entfernen
  - JSONL-Parser entfernen
  - Alte IPC-Channels entfernen (`copilot:spawn`, `copilot:kill`, `copilot:output`)
  - PTY-Dependency evaluieren (noch benötigt?)

- [ ] **T-18:** Tests + Dokumentation
  - Unit-Tests für AcpClient (Mock-Prozess)
  - Integration-Tests für IPC-Flow
  - ARCHITECTURE.md aktualisieren
  - CHANGELOG.md Eintrag

---

## Abhängigkeiten

```
T-01 → T-02 → T-03 → T-04 → T-06 → T-07 → T-08
                              T-05 ─┘
T-09 + T-10 (parallel zu Phase 1-3, benötigt für Phase 5)
T-11 + T-12 + T-13 (benötigt T-08 + T-10)
T-14 + T-15 (benötigt T-11)
T-16 → T-17 → T-18
```

---

## Geschätzter Aufwand

| Phase | Aufwand |
|-------|---------|
| Phase 1: Grundgerüst | 1 Tag |
| Phase 2: Sessions | 0.5 Tage |
| Phase 3: Streaming | 1 Tag |
| Phase 4: IPC-Bridge | 0.5 Tage |
| Phase 5: Renderer | 1 Tag |
| Phase 6: Spezialfälle | 0.5 Tage |
| Phase 7: Cleanup | 0.5 Tage |
| **Gesamt** | **~5 Tage** |

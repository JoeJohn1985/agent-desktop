# Proposal: ACP-Backend-Migration

## Status
- **Erstellt:** 2026-06-16
- **Phase:** Draft
- **Betrifft:** main.js, preload.js, renderer/app.js

---

## Problem

Die aktuelle Architektur spawnt **pro Nachricht** einen neuen CLI-Prozess:

```
copilot -p "..." --output-format json --stream on --resume=ID
```

### Nachteile

| Problem | Auswirkung |
|---------|-----------|
| Prozess-Spawn pro Nachricht | ~200-500ms Latenz pro Request |
| Kein In-Memory-Caching | Session-Kontext wird jedes Mal von Disk geladen |
| Token-Kosten | Kontext muss bei jedem Spawn neu aufgebaut werden |
| Keine echte Streaming-Kontrolle | Cancel = Kill des gesamten Prozesses |
| Race Conditions | Mehrere Spawns können sich überlappen |

---

## Ziel

Migration zu einem **persistenten ACP-Backend** (Agent Communication Protocol):

```
copilot --acp   →   JSON-RPC Server über stdin/stdout
```

### Vorteile

- **Ein Prozess pro Tab**, bleibt zwischen Nachrichten am Leben
- **In-Memory Session-Cache** — kein Neuladen von Disk
- **Echtes Streaming** via `session/update` Events
- **Sauberes Cancel** durch Prozess-Kill + Neustart + `session/load`
- **Protokoll-basiert** — klare Request/Response-Grenzen

---

## Scope

### In Scope
- AcpClient-Klasse im Main Process (JSON-RPC über stdin/stdout)
- Prozess-Lifecycle-Management (Start, Stop, Crash-Recovery)
- Session-Management via ACP-Methoden (new, load, list, prompt)
- Event-Mapping: ACP-Events → bestehende Renderer-Events
- Model-Wechsel mid-Session via `/model X`
- Bestehende Sessions nahtlos weiternutzen

### Out of Scope
- Änderungen am ACP-Protokoll selbst
- Multi-Agent-Support (future)
- Plugin/Tool-Registrierung über ACP
- UI-Redesign (bestehendes Chat-Interface bleibt)

---

## Risiken

| Risiko | Mitigation |
|--------|-----------|
| ACP-Prozess crasht | Auto-Restart + session/load |
| Protokoll-Inkompatibilität | Versionsprüfung bei `initialize` |
| Deadlock bei stdin/stdout | Timeout + Kill + Restart |
| Bestehende Sessions inkompatibel | Fallback auf session/new wenn load fehlschlägt |

---

## Erfolgsmetriken

- Latenz pro Nachricht < 50ms (statt 200-500ms)
- Kein Datenverlust bei Crash-Recovery
- Alle bestehenden Features funktionieren identisch
- Zero Breaking Changes für den User

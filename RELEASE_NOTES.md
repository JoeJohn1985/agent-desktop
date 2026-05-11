# Release Notes v0.16.1

## Was ist neu?

### Tab-Unlock Fallback ⏱️
Wenn ein Sub-Agent hängt und kein `onDone`-Event kommt, greift jetzt ein mehrstufiger Fallback:

- **Nach 30 Sekunden Inaktivität**: Ein manueller „⏱ Hängt? Entsperren"-Button erscheint — der Nutzer kann den Tab sofort freigeben.
- **Nach 180 Sekunden Inaktivität**: Der Tab wird **automatisch entsperrt** mit einer Info-Nachricht im Chat.
- **Activity-Tracking**: Alle Stream-Events aktualisieren `lastActivityAt` — echte Aktivität resettet den Timer.

## Bug Fixes
- **Backend-Stop bei Force-Unlock**: `copilot.chat.stop()` wird jetzt auch bei manuellem und automatischem Unlock aufgerufen. Das verhindert, dass Backend-Prozesse nach dem Entsperren weiterlaufen.
- **Markdown-Timer Leak**: `_mdTimer` wird in `forceUnlockTab` korrekt aufgeräumt — kein Memory-Leak mehr bei wiederholtem Unlock.

## Technische Details
- 51 neue Tests (`inactivity-monitor.test.js` + 2 QA-Fixes), 667 Tests total — alle grün
- Inactivity-Monitor als eigenständiges Modul mit konfigurierbaren Timeouts
- Electron + Node.js Architektur unverändert

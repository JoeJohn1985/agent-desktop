# Release Notes v0.16.0

## Was ist neu?

### Plugin-Manager 🔌
Der Plugin-Manager unterstützt jetzt das **Hinzufügen und Entfernen von Marketplaces** direkt in der UI — mit visuellem Spinner-Feedback während der Verarbeitung. Neue Marketplaces erscheinen automatisch oben in der Liste. Das Plugin-Panel lässt sich jetzt per erneutem Klick auf den Plugin-Button wieder schließen (Toggle-Verhalten).

### Session-Wiederaufnahme 🔄
Beim Fortsetzen einer Session werden Plan und letzte Nachrichten jetzt als **normale Chat-Nachrichten** angezeigt, statt in einem separaten Textblock. Checkpoints wurden entfernt — die Darstellung ist jetzt einheitlich und übersichtlich.

### Startup-Optimierung ⚡
`loadPlugins()` läuft jetzt non-blocking im Hintergrund. Die App startet sofort, Plugins werden asynchron nachgeladen.

## Bug Fixes
- **getInstructions**: Nutzt jetzt den konfigurierten Pfad aus `readFolderConfig()` — die Instructions-Anzeige im Footer funktioniert wieder korrekt
- **CSS Selector Injection**: `CSS.escape()` schützt vor Injection in `installPlugin`, `uninstallPlugin`, `updatePlugin` und `removeMarketplace`

## Technische Details
- sbInstructions-Anzeige aus Statusbar entfernt (redundant)
- Tote CSS-Klassen bereinigt
- 37 neue Tests (616 total, alle grün)
- Neues IPC-Modul: `src/ipc/plugins-ipc.js`
- Electron + Node.js Architektur unverändert

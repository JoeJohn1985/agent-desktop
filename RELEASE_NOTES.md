# Release Notes v0.15.1

## Was ist neu?

### Agents-System 🤖
Die Copilot Desktop App unterstützt jetzt **Agents** — spezialisierte Assistenten, die per `.agent.md`-Dateien definiert werden. Agents erscheinen im neuen Sidebar-Panel und können per Klick aktiviert/deaktiviert werden. Aktive Agents werden automatisch als `/agent <name>` Prefix in jede Nachricht injiziert.

### Konfigurierbarer Agents-Ordner 📁
Der Agents-Ordner (Standard: `~/.copilot/agents/`) kann jetzt in den Folder-Settings angepasst werden. Der konfigurierte Ordner wird automatisch zur Session-Allowlist hinzugefügt.

## Bug Fixes
- **XSS-Schutz**: `escapeAttr()` verhindert Code-Injection in onclick/data-tooltip Attributen (Agents & Skills)
- **Model Rollback**: Bei fehlgeschlagenem Model-Switch wird das vorherige Model wiederhergestellt
- **Event Listener Leak**: Korrekte Bereinigung bei Window-Close

## Technische Details
- Neues Modul: `src/agents.js` — scannt `*.agent.md`, parst YAML-Frontmatter
- IPC: `agents:list` Handler + `copilot.agents.list()` Bridge
- `folders:read` Response enthält jetzt `agentsDir`
- `getEffectiveExtraDirs()` inkludiert `agentsDir` automatisch
- 36 neue Tests (469 total, alle grün)
- Electron + Node.js Architektur unverändert

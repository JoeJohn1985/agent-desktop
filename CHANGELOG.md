# Changelog

## [0.16.1] - 2025-06-17

### Added
- Tab-Unlock Fallback bei hängenden Sub-Agents:
  - Nach 30s Inaktivität: Manueller „⏱ Hängt? Entsperren"-Button erscheint
  - Nach 180s Inaktivität: Tab wird automatisch entsperrt mit Info-Nachricht
  - Activity-Tracking bei allen Stream-Events (`lastActivityAt`)
- 51 neue Tests (`inactivity-monitor.test.js` + 2 QA-Fixes), 667 Tests total

### Fixed
- Backend-Stop bei Force-Unlock: `copilot.chat.stop()` wird jetzt auch bei manuellem/automatischem Unlock aufgerufen (verhindert weiterlaufende Backend-Prozesse)
- Markdown-Timer Leak: `_mdTimer` wird in `forceUnlockTab` korrekt aufgeräumt

## [0.16.0] - 2025-06-16

### Added
- Plugin-Manager: Marketplace hinzufügen/entfernen mit Spinner-Feedback
- Marketplace-Reihenfolge: Neueste Marketplaces erscheinen oben (unshift statt push)
- Plugin-Button Toggle: Plugin-Panel schließt bei erneutem Klick auf Plugin-Button
- Session-Wiederaufnahme: Plan + letzte Nachrichten werden als normale Chat-Nachrichten angezeigt (Checkpoints entfernt)
- Startup-Optimierung: `loadPlugins()` läuft non-blocking im Hintergrund — App startet sofort
- Neue Tests: `get-instructions.test.js`, `plugin-view-toggle.test.js`, erweiterte `plugin-ui.test.js` (+37 Tests)

### Fixed
- `getInstructions` Bug: Nutzt jetzt den konfigurierten Pfad aus `readFolderConfig()` — sbInstructions-Anzeige im Footer funktioniert wieder
- CSS Selector Injection: `CSS.escape()` in `installPlugin`, `uninstallPlugin`, `updatePlugin`, `removeMarketplace`

### Changed
- sbInstructions-Anzeige aus der Statusbar entfernt (war immer 1, keine relevante Information)
- AGENTS.md: Git-Workflow-Regel ergänzt (pull → commit → push → pull)
- Tote CSS-Klassen entfernt (QA-Fix)

## [0.15.1] - 2025-06-15

### Added
- Agents directory configurable in folder settings (agents-folder picker)
- `agentsDir` included in `folders:read` response with default fallback
- `getEffectiveExtraDirs()` includes `agentsDir` automatically per session
- 20 new tests for agents settings (`agents-settings.test.js`)

### Changed
- `loadFolderSettings()` and `btnFoldersSave` updated to handle `agentsDir`

## [0.15.0] - 2025-06-15

### Added
- Agents panel in sidebar — scans `~/.copilot/agents/*.agent.md` files
- `src/agents.js`: `scanAgentsDirectory()` with YAML frontmatter parsing
- `agents:list` IPC handler in main process
- `copilot.agents.list()` preload bridge
- `renderAgents()` and `toggleAgent()` in renderer
- Active agents injected as `/agent <name>` prefix per message
- `.agent-card` CSS styling (analogous to skills)
- 16 new tests for `scanAgentsDirectory()` (`agents.test.js`)

### Security
- XSS fix: `escapeAttr()` for onclick/data-tooltip in agents & skills rendering

## [0.14.4] - 2025-06-15

### Security
- XSS fix in `openInstructionsEditor` — user input now escaped

### Fixed
- Model rollback: restore previous model on switch failure
- Event listener leak: proper cleanup on window close

## [0.14.3] - 2025-06-14

### Added
- Model switcher UI
- Pinned tools fix
- `AGENTS.md` project documentation

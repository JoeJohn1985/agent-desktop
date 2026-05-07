# Changelog

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

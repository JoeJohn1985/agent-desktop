# Known Issues / TODO

List of known problems and open items. When fixing, please remove the entry or mark it with `~~strikethrough~~`.

## Current limitations (v0.20.5)

### Onboarding wizard: tab-unlock fallback

The onboarding wizard applies an automatic unlock after 180 seconds if a step hangs. In rare cases (e.g. a slow network connection during `gh auth login`) the auto-unlock can trigger before the step is actually complete. The manual unlock button (after 30s) is the better option in such cases.

---

### Tutorial popups: one-time display not resettable

The tutorial popups ("Reload skills", "Rename tab") are shown only once per user. There is currently no way to reset them via the settings — only the onboarding wizard can be restarted in developer mode.

---

### Session resume: older messages not visible

When loading a saved session, only the most recent messages are shown. The full chat history is still present in the session file but is not rendered in the UI. Manually scrolling to the older history is currently not possible.

---

## Linux

### ~~Verify preferences initialization on Linux~~ (fixed in v0.15.6)

The logic itself was correct: `read()` without a file returns `{ ...PREFS_DEFAULTS }`, and the renderer uses fallbacks everywhere. The actual problems — wrong storage path and an unversioned file in the repo — are covered under "First install" and "Repo hygiene" and were fixed in v0.15.6.

---

### ~~Slash commands unreliable on Linux~~ (fixed in v0.15.5)

`/context`, `/compact`, and other slash operations returned no or incorrect responses on Linux.

**Cause:** on first start in an untrusted folder, the Copilot CLI shows a "Confirm folder trust" dialog (1=Yes, 2=Yes+remember, 3=No) that blocks the TUI start. Only after confirmation do the ready markers `/ commands` / `? help` appear. Before that, slash input hit the dialog instead of the TUI.

**Fix (v0.15.5):**
- New helpers `detectCopilotPrompt` / `isCopilotTuiReady` in `src/main-helpers.js` (pure, testable).
- `src/ipc/terminal-ipc.js`: a shared `attachReadyDetection` function detects the trust prompt and sends `2\r` (Yes, remember). The existing resume-conflict auto-confirm now also correctly sends `1\r` instead of `1` without Enter.
- Both `terminal:spawn-background` and `terminal:spawn` use the new detection.
- 14 new unit tests in `__tests__/main-helpers.test.js`.

---

### ~~First install: `preferences.json` written next to `main.js`~~ (fixed in v0.15.6)

Previously `PREFS_PATH = path.join(__dirname, 'preferences.json')`. In packaged builds (Electron asar / system install under `/opt/...`) `__dirname` is read-only → the first `write()` failed **silently**. Result: defaults on first start, but **no preference was ever persisted** — theme, tab layout, sidebar width were lost on every restart.

**Fix (v0.15.6):**
- `PREFS_PATH` is now under `app.getPath('userData')` (Linux: `~/.config/agent-desktop/`, Windows: `%APPDATA%\agent-desktop\`, macOS: `~/Library/Application Support/agent-desktop/`).
- `createPreferencesManager` creates the target directory automatically with `mkdir -p`.
- Write errors now throw a meaningful error with `prefsPath` — `main.js` logs it via `writeLog('error', ...)` instead of swallowing it silently.
- Migration helper `migrateFromIfExists(legacyPath)` copies an old `__dirname/preferences.json` (incl. `.bak`) to the new location on first start after v0.15.6.
- 8 new unit tests (directory creation, error throwing, migration).

---

## Repo hygiene

### ~~Remove `preferences.json` from the repo~~ (fixed in v0.15.6)

`preferences.json` was user-specific runtime state (theme, open tabs, sidebar width, etc.) and should not live in the repo.

**Fix (v0.15.6):**
- `preferences.json` and `preferences.json.bak` have long been in `.gitignore`.
- File removed from the index with `git rm --cached preferences.json` (the local file is left untouched).
- Defaults come from `PREFS_DEFAULTS` in `src/preferences.js` — no example file needed.

**Background:** during a commit on `fix/linux-path`, local state (theme `gebit`, open tab) was briefly lost because `preferences.json` was versioned and accidentally reset on `git checkout -- preferences.json`. Recovery was only possible thanks to the automatic `.bak`.

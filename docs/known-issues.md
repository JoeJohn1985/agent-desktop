# Known Issues / TODO

Liste bekannter Probleme und offener Punkte. Bitte beim Beheben den Eintrag entfernen oder mit `~~Strikethrough~~` markieren.

## Linux

### ~~Preferences-Initialisierung auf Linux überprüfen~~ (gefixt in v0.15.6)

Logik selbst war korrekt: `read()` ohne Datei liefert `{ ...PREFS_DEFAULTS }`, Renderer nutzt überall Fallbacks. Die eigentlichen Probleme — falscher Speicherpfad und nicht-versionierte Datei im Repo — sind unter "Erstinstallation" und "Repo-Hygiene" behandelt und in v0.15.6 gefixt.

---

### ~~Slash-Befehle funktionieren auf Linux nicht zuverlässig~~ (gefixt in v0.15.5)

`/context`, `/compact` und andere Slash-Operationen lieferten auf Linux keine bzw. fehlerhafte Antworten.

**Ursache:** Beim Erststart in einem nicht-getrusteten Ordner zeigt die Copilot-CLI einen "Confirm folder trust"-Dialog (1=Yes, 2=Yes+remember, 3=No), der den TUI-Start blockiert. Erst nach Bestätigung erscheinen die Ready-Marker `/ commands` / `? help`. Vorher trafen Slash-Eingaben den Dialog statt das TUI.

**Fix (v0.15.5):**
- Neue Helfer `detectCopilotPrompt` / `isCopilotTuiReady` in `src/main-helpers.js` (rein, testbar).
- `src/ipc/terminal-ipc.js`: gemeinsame `attachReadyDetection`-Funktion erkennt Trust-Prompt und sendet `2\r` (Yes, remember). Auch der bestehende Resume-Conflict-Auto-Confirm sendet jetzt korrekt `1\r` statt `1` ohne Enter.
- Sowohl `terminal:spawn-background` als auch `terminal:spawn` verwenden die neue Detection.
- 14 neue Unit-Tests in `__tests__/main-helpers.test.js`.

---

### ~~Erstinstallation: `preferences.json` wird neben `main.js` abgelegt~~ (gefixt in v0.15.6)

Bisher war `PREFS_PATH = path.join(__dirname, 'preferences.json')`. In gepackten Builds (Electron asar / System-Install nach `/opt/...`) ist `__dirname` schreibgeschützt → der erste `write()` schlug **still** fehl. Folge: Defaults beim Erststart, aber **keine Preference wurde je persistiert** — Theme, Tab-Layout, Sidebar-Breite gingen bei jedem Neustart verloren.

**Fix (v0.15.6):**
- `PREFS_PATH` jetzt unter `app.getPath('userData')` (Linux: `~/.config/copilot-desktop/`, Windows: `%APPDATA%\copilot-desktop\`, macOS: `~/Library/Application Support/copilot-desktop/`).
- `createPreferencesManager` legt das Zielverzeichnis automatisch mit `mkdir -p` an.
- Schreibfehler werfen jetzt einen aussagekräftigen Error mit `prefsPath` — `main.js` loggt ihn via `writeLog('error', ...)` statt stumm zu schlucken.
- Migrations-Helfer `migrateFromIfExists(legacyPath)` kopiert eine alte `__dirname/preferences.json` (inkl. `.bak`) beim ersten Start nach v0.15.6 an den neuen Ort.
- 8 neue Unit-Tests (Verzeichnis-Anlage, Fehler-Werfen, Migration).

---

## Repo-Hygiene

### ~~`preferences.json` aus dem Repo entfernen~~ (gefixt in v0.15.6)

`preferences.json` war benutzerspezifischer Laufzeit-State (Theme, offene Tabs, Sidebar-Breite usw.) und sollte nicht im Repo liegen.

**Fix (v0.15.6):**
- `preferences.json` und `preferences.json.bak` sind seit längerem in `.gitignore`.
- Datei mit `git rm --cached preferences.json` aus dem Index entfernt (lokale Datei bleibt unangetastet).
- Defaults kommen aus `PREFS_DEFAULTS` in `src/preferences.js` — keine Beispieldatei nötig.

**Hintergrund:** Beim Commit auf `fix/linux-path` ging der lokale State (Theme `gebit`, offener Tab) kurzzeitig verloren, weil `preferences.json` versioniert war und sich beim `git checkout -- preferences.json` versehentlich resettete. Wiederherstellung war nur dank automatischem `.bak` möglich.


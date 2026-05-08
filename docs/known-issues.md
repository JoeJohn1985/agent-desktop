# Known Issues / TODO

Liste bekannter Probleme und offener Punkte. Bitte beim Beheben den Eintrag entfernen oder mit `~~Strikethrough~~` markieren.

## Linux

### Preferences-Initialisierung auf Linux überprüfen

Beim ersten Start auf Linux scheinen die Preferences nicht korrekt initialisiert zu werden.

**Untersuchen:**
- `preferences.json` Defaults (`PREFS_DEFAULTS` in `src/preferences.js`)
- Pfad-Auflösung der Preferences-Datei
- Ob beim ersten Start ein sauberer Default-Zustand entsteht

**Reproduktion:**
```bash
rm -rf ~/.copilot-desktop
rm preferences.json preferences.json.bak
npm start
```

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

### Erstinstallation: `preferences.json` wird neben `main.js` abgelegt

`PREFS_PATH` ist in `main.js` als `path.join(__dirname, 'preferences.json')` definiert.

**Problem:**
- In gepackten Builds (Electron asar / System-Install nach `/opt/...`) ist `__dirname` schreibgeschützt → der erste `write()` schlägt **still** fehl (Fehler wird nur in einem `try/catch` gefangen und ignoriert).
- Folge: Beim Erststart erhält der User korrekt die Defaults (`PREFS_DEFAULTS`), aber **keine Preference wird je persistiert**. Theme, Tab-Layout, Sidebar-Breite gehen bei jedem Neustart verloren.
- Kein Hinweis in der UI, dass das Speichern fehlschlägt.

**Lösung:**
- `PREFS_PATH` auf `app.getPath('userData')` umstellen (Standard-Ort für Electron-Apps, z.B. `~/.config/copilot-desktop/preferences.json` auf Linux)
- Beim Schreiben fehlende Verzeichnisse mit `mkdir -p` anlegen
- Schreibfehler wenigstens loggen (`writeLog('error', ...)`), nicht stumm verschlucken

**Logik selbst ist korrekt:**
- `read()` ohne Datei liefert `{ ...PREFS_DEFAULTS }` ✓
- Renderer nutzt überall Fallbacks (`getPref(key, default)`, `chatFontSize || 16`) ✓

---

## Repo-Hygiene

### `preferences.json` aus dem Repo entfernen

`preferences.json` ist benutzerspezifischer Laufzeit-State (Theme, offene Tabs, Sidebar-Breite usw.) und sollte nicht im Repo liegen.

**Zu tun:**
- `preferences.json` und `preferences.json.bak` in `.gitignore` aufnehmen
- Aktuelle Datei mit `git rm --cached preferences.json` aus dem Index entfernen
- Sinnvolle Default-Datei als `preferences.example.json` o.ä. mitliefern, falls Erstinstallation davon abhängt
- Dokumentieren, dass `PREFS_DEFAULTS` aus `src/preferences.js` greift, wenn die Datei fehlt

**Hintergrund:** Beim Commit auf `fix/linux-path` ging der lokale State (Theme `gebit`, offener Tab) kurzzeitig verloren, weil `preferences.json` versioniert ist und sich beim `git checkout -- preferences.json` versehentlich resettete. Wiederherstellung war nur dank automatischem `.bak` möglich.


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

### Slash-Befehle funktionieren auf Linux nicht zuverlässig

`/context`, `/compact` und andere Slash-Operationen liefern auf Linux keine bzw. fehlerhafte Antworten — auch nach dem PATH-Fix in v0.15.4.

**Mögliche Ursachen:**
- PTY-Ready-Erkennung greift nicht — die Pattern `/ commands` und `? help` in `src/ipc/terminal-ipc.js` (Zeile ~47) passen evtl. nicht zur aktuellen Copilot-CLI-Ausgabe auf Linux
- Bracketed-Paste-Modus (`\x1b[200~ ... \x1b[201~`) wird vom Terminal anders behandelt
- Timing der Eingabe (`PTY_WRITE_DELAY_MS`)
- `collectPtyOutput` erkennt das Ende der Antwort zu früh oder zu spät

**Relevante Stellen:**
- `src/ipc/terminal-ipc.js`: `terminal:fetch-context`, `terminal:send-slash`, `terminal:spawn-background`
- Logs in `~/.copilot-desktop/logs/copilot-desktop-<date>.log` prüfen

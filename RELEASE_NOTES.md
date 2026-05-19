# Release Notes v0.23.0

## Was ist neu?

### Rich-Text-Editor im Chat ✏️

Der Chat-Input unterstützt jetzt einen optionalen Rich-Text-Modus:

- **Toggle-Button** (✏️ / 📝) neben dem Eingabefeld — jederzeit zwischen Plaintext und Rich-Text wechseln
- **Toolbar** mit Bold, Italic, Strikethrough, ungeordneten und geordneten Listen
- **Tastatur-Shortcuts**: Enter = Zeilenumbruch im Rich-Text-Modus, Strg+Enter = Nachricht senden
- **Automatische Konvertierung**: HTML wird beim Senden transparent zu Markdown umgewandelt — das Backend erhält immer sauberes Markdown

### Model-Dropdown Redesign 🎨

Das aktive Model wird jetzt deutlicher hervorgehoben:

- **Accent-Balken** links vom aktiven Eintrag statt eines Häkchens
- **Hintergrund-Highlighting** für das gewählte Model
- **Neue Model-Reihenfolge**: Haiku → Sonnet → Opus 4.6 → Opus 4.7 → GPT-5.3 → GPT-4.1

### Button-Reihenfolge in Session-Actions

Die Buttons in der Session-Leiste folgen jetzt einer einheitlichen Logik:
**Model → Autopilot → Context → Compact → Clear**

## Bug Fixes
- **Model-Persistenz nach Restart**: Das zuletzt gewählte Model wird nach App-Neustart korrekt wiederhergestellt (beide Restore-Pfade: named Sessions und anonyme Sessions)
- **Model-Persistenz für neue Sessions**: Neuer dedizierter `sessionModels`-Pref-Key verhindert, dass neu erstellte Sessions ihr gewähltes Model nach Restart verlieren
- Dead Code in `updateModelSelectBtn` entfernt
- Integrity-Test bereinigt (`btnShortcutsHelp` entfernt)

## Technische Details
- Rich-Text-Editor auf Basis von `contenteditable` mit HTML→Markdown-Konvertierung beim Senden
- `sessionModels`-Pref-Key entkoppelt von `namedSessions` — unabhängige Persistenz
- `updateModelSelectBtn()` wird in beiden Session-Restore-Pfaden nach dem Setzen von `tab.selectedModel` aufgerufen
- Dokumentation aktualisiert: USER-GUIDE.md, ARCHITECTURE.md, README.md

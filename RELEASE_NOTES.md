# Release Notes v0.21.0

## Was ist neu?

### Vollständige JSDoc-Dokumentation 📚

Der gesamte Quellcode ist jetzt lückenlos mit JSDoc-Kommentaren dokumentiert:

- **`main.js`**: Alle IPC-Handler (`~30`), Modul-Variablen und Funktionen mit `@ipc`, `@param`, `@returns` vollständig beschrieben.
- **`preload.js`**: Alle 22 `copilot.*`-Namespaces dokumentiert — jede Methode und jeder Event-Subscriber mit Callback-Typen.
- **`renderer/app.js`**: 114 JSDoc-Blöcke — Tab-Management, Chat-Flow, Skills/Agents, Sessions, Plugins, Onboarding, Tutorial und Helpers vollständig abgedeckt.
- **`renderer/modules/todos.js`** und **`src/scanners.js`**: Verbleibende Lücken geschlossen.

### Merge-Konflikt-Fixes 🔧

Zwei Merge-Konflikte in der Renderer-Schicht wurden behoben:

- **`renderer/app.js`**: `initShortcutsSettings()` und der Onboarding-Toggle (Entwicklertools) werden jetzt beide korrekt in `initSettings()` initialisiert.
- **`renderer/index.html`**: Settings-Tabs „Tastenkürzel" und „Entwicklertools" erscheinen beide vollständig im UI.

### Dokumentation auf aktuellem Stand 📝

- **USER-GUIDE**: Onboarding-Wizard, Tutorial-Popups und Session Resume erklärt.
- **ARCHITECTURE**: Neue Architektur-Abschnitte für Onboarding (Sec 5.6) und Tutorial-Flags (Sec 5.7), 3 neue ADRs, erweiterte IPC-Tabellen.
- **known-issues**: Bekannte Einschränkungen für v0.20.5 dokumentiert.
- **README**: Feature-Liste neu strukturiert, Testanzahl auf 939+ aktualisiert.

## Bug Fixes
- Merge-Konflikt in `renderer/app.js` (`initShortcutsSettings` + Onboarding-Toggle) behoben
- Merge-Konflikt in `renderer/index.html` (Shortcuts-Tab + Devtools-Tab) behoben

## Technische Details
- 114 neue JSDoc-Blöcke in `app.js` (65 Funktionen, 49 Variablen)
- 441 Zeilen neue Dokumentation in `preload.js`
- 339 Zeilen neue Dokumentation in `main.js`
- 3 neue ADRs in `ARCHITECTURE.md` (#9 Flag-Speicherort, #10 Tab-Locking, #11 Auto-Close-Guard)

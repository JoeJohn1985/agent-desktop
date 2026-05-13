# Release Notes v0.20.5

## Was ist neu?

### Tutorial-System: Smarter und zuverlässiger 🎓

Die Tutorial-Popups wurden grundlegend überarbeitet:

- **Auto-close bei Nutzeraktion**: Das Tutorial-Popup schließt sich automatisch, wenn der Nutzer die beworbene Aktion ausführt (z. B. Reload-Button klicken oder Tab umbenennen) — kein manuelles Wegklicken mehr nötig.
- **30-Sekunden-Timeout**: Popups schließen sich nach 30 Sekunden automatisch, auch wenn keine Aktion erfolgt.
- **Tutorial-Flags in `folders.json`**: Die Flags `tutorialSkillsShown` und `tutorialRenameShown` werden jetzt in der zentralen `folders.json` gespeichert statt separat — sauberere Datenhaltung.

### `tab:renamed` Event 🏷️

Bei jeder erfolgreichen Tab-Umbenennung wird jetzt ein `tab:renamed` CustomEvent gefeuert. Andere Komponenten (z. B. Tutorial-Popups) können darauf reagieren.

### UI-Verbesserungen

- **Todo-Icon**: Das Lösch-Icon in der Todo-Liste ist jetzt durchgehend 🗑️ (Mülleimer-Emoji) — kein Mix aus verschiedenen Icons mehr.
- **Session-Context**: Der Context-Block zeigt nur noch die relevanten Nachrichten — der Plan wird nicht mehr angezeigt.

## Bug Fixes
- Event-Listener Leak in Tutorial-Popups behoben: Durch einen `closed`-Guard werden Event-Listener bei bereits geschlossenem Popup nicht mehr doppelt registriert.

## Technische Details
- Tutorial-Flags über neue IPC-Handler `tutorial:getFlags` / `tutorial:setFlag` (mit Key-Whitelist) verwaltbar
- `dev:setOnboardingComplete` setzt jetzt auch alle Tutorial-Flags zurück
- 2 neue Testdateien: `tutorial-flags.test.js` (327 Tests), erweitertes `onboarding-auth.test.js` (208 Tests)

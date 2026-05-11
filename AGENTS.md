# Agents.md — Projektregeln für KI-Agenten

## Versionierung

- Vor **jedem Commit** muss die Version in `package.json` hochgezählt werden.
- Patch-Version (z.B. 0.14.2 → 0.14.3) für Bugfixes und kleine Änderungen.
- Minor-Version (z.B. 0.14.x → 0.15.0) für neue Features oder größere Refactorings.
- Die Commit-Message beginnt immer mit dem Versions-Tag: `v0.14.3: Kurzbeschreibung`

## Git-Workflow

- Vor dem Commit immer `git pull --rebase` ausführen, um den lokalen Stand zu aktualisieren.
- Nach dem Push ebenfalls `git pull --rebase`, um etwaige Remote-Änderungen (z.B. CI) zurückzuholen.
- Reihenfolge: **pull → commit → push → pull**

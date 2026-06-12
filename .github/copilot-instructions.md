# Copilot Instructions — Copilot Desktop

## Pflichtlektüre vor Code-Änderungen

Lies vor jeder Code-Änderung die Datei `.github/CONTRIBUTING.md` und halte dich an die darin beschriebenen Regeln für Workflow, Branching und Versioning.

## Versioning

Dieses Projekt folgt [Semantic Versioning](https://semver.org/):

- `PATCH` (z.B. `0.9.0` → `0.9.1`) — Bugfix oder kleine Verbesserung
- `MINOR` (z.B. `0.9.0` → `0.10.0`) — Neues Feature (abwärtskompatibel)
- `MAJOR` (z.B. `0.9.x` → `1.0.0`) — Breaking Change oder bewusste Release-Entscheidung

**Vor jedem Push:** Beurteile ob die Version in `package.json` hochgesetzt werden soll und schlage es dem User vor. Bis `1.0.0` gilt: MAJOR bleibt bei 0, Breaking Changes kommen in MINOR.

## Git-Workflow

- **Kein direkter Push auf `main`** — außer der User erlaubt es explizit
- Arbeite auf Feature-Branches: `feature/`, `fix/`, `docs/`, `chore/`
- Commit-Messages nach [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Immer Co-authored-by Trailer anhängen:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```

## Technischer Stack

- **Electron** (Main Process: `main.js`, Renderer: `renderer/app.js`, `renderer/styles.css`)
- **Preload Bridge**: `preload.js` — IPC-Kommunikation zwischen Main und Renderer
- **Native Module**: `@homebridge/node-pty-prebuilt-multiarch` — benötigt Python für Kompilierung
- **Markdown**: `marked` + `highlight.js`

## Architektur-Referenz

Für eine vollständige Architektur-Dokumentation (Prozess-Architektur, Datenfluss, State Management, JSONL-Event-Format) siehe [`ARCHITECTURE.md`](../ARCHITECTURE.md) im Projekt-Root.

## Projektstruktur

```
copilot-desktop/
├── main.js                  # Electron Main Process
├── preload.js               # IPC Bridge
├── renderer/
│   ├── index.html           # App Shell
│   ├── app.js               # Frontend Logic
│   └── styles.css           # Styles & Themes
├── src/                     # Ausgelagerte Module (Helpers, IPC, Scanner)
├── .github/
│   ├── copilot-instructions.md  # Diese Datei
│   └── CONTRIBUTING.md          # Workflow & Versioning Regeln
├── ARCHITECTURE.md          # Architektur-Dokumentation
└── package.json
```

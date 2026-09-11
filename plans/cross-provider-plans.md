# Plan: Providerübergreifende Pläne (Plan-Konvention in ACP-Instructions)

## Ziel

In einer Session eines Providers etwas ausarbeiten und in der Session eines
anderen Providers daran weiterarbeiten. Der Übergabeweg ist eine Markdown-Datei
im Projekt (`plans/<slug>.md`) — die Modelle können sie alle lesen und
schreiben. Was fehlt, ist nicht Infrastruktur, sondern **Wissen**: Das Modell
muss die Konvention kennen, ohne dass der Nutzer sie in jedem Chat erklärt.

Deshalb pflegt Agent Desktop diese Konvention automatisch in die **globalen
Instruction-Dateien** der angebundenen ACP-Provider ein.

## Was NICHT gebaut wird (und warum)

- **Sessions anderer Provider lesen.** Ursprünglich mitgedacht, bewusst
  verworfen: drei inkompatible Formate (Copilots `events.jsonl`, Claude Codes
  `.jsonl`-Transkript, der eigene API-Session-Store) und im Ergebnis würde man
  einem Modell Zehntausende Token Fremdkontext hinkippen. Der kuratierte Plan
  ist das bessere Übergabeformat.
- **Direkt-API-Provider** (Anthropic, OpenAI, GLM, Ollama, Gemini). Bewusst
  zurückgestellt: Dort baut die App den Systemprompt selbst, und wie dessen
  Aufbau/Caching künftig aussehen soll, ist noch nicht grundsätzlich geklärt.
  Erst danach wird entschieden, wie die Plan-Konvention dort ankommt.
- **`claude-code-ssh`.** Dessen Instruction-Datei liegt auf dem Pi; die App
  hat dort keinen `fs`-Zugriff. Das ist eine spätere Erweiterung der
  SSH-Funktionalität (Dateien auf dem Remote-Host anpassen), kein Teil hiervon.
- **UI.** Kein Sidebar-Element, kein Button, keine Einstellung. Das Feature ist
  Kontextwissen, kein Bedienelement.
- **Kein Plan-Index, keine Metadaten, kein Status-Modell.** Jeder Provider hat
  `list_dir`/`glob` und kann selbst nachsehen, was in `plans/` liegt. Alles
  andere wäre Buchhaltung, die jemand pflegen müsste.

## Architektur

```
~/.agent-desktop/plans.md          ← Quelle der Wahrheit
        │  Inhalt wird kopiert (Einbahnstraße)
        ├──► ~/.claude/CLAUDE.md                  (wenn `claude` installiert)
        └──► ~/.copilot/copilot-instructions.md   (wenn `copilot` installiert)
```

- **Quelle**: `~/.agent-desktop/plans.md`. Wird beim App-Start angelegt, falls
  sie fehlt; danach **nie überschrieben** — der Nutzer kann den Text anpassen.
- **Ziele**: die globalen Instruction-Dateien der ACP-Provider. Nur die des
  jeweils tatsächlich installierten Providers wird angefasst.
- **Sync**: bei App-Start, Einbahnstraße Quelle → Ziel. Der Block wird über
  Marker gefunden und ersetzt; der übrige Inhalt der Zieldatei bleibt
  unangetastet. Manuelle Änderungen *innerhalb* des Blocks werden überschrieben
  — Anpassungen gehören in die Quelldatei.
- **`config.instructionsFile` wird ignoriert.** Das ist ein Überbleibsel eines
  alten Features; die Datei liegt immer unter `~/.copilot/`. Aufräumen dieses
  Altbestands ist ein separates Thema.

### Marker

```
<!-- agent-desktop:plans:start -->
… Inhalt …
<!-- agent-desktop:plans:end -->
```

Die Marker sind Teil der Quelldatei. Entfernt der Nutzer sie dort, umschließt
die App den Inhalt beim Sync wieder damit — sonst wäre der Block beim nächsten
Lauf nicht mehr auffindbar und würde dupliziert.

### Sync-Regeln (die eigentliche Logik)

| Zustand der Zieldatei | Verhalten |
|---|---|
| Existiert nicht | Anlegen, nur mit dem Block |
| Beide Marker vorhanden, korrekt geordnet | Bereich dazwischen (inkl. Marker) ersetzen |
| Marker fehlen oder sind kaputt | Block am Ende anhängen |
| Quelle leer/nur Whitespace | Block entfernen, falls vorhanden; sonst nichts tun |

Bei kaputten Markern wird bewusst **angehängt statt repariert**: Beim Raten,
wo der Block endet, würde man fremden Inhalt fressen. Ein doppelter Block ist
das kleinere Übel und beim nächsten Lauf wieder eindeutig auflösbar.

### Standardinhalt der Quelldatei

```markdown
<!-- agent-desktop:plans:start -->
## Pläne

Pläne liegen als Markdown-Dateien unter `plans/` im jeweiligen
Projektverzeichnis und sind providerübergreifend nutzbar.

- Plan erstellen: neue Datei `plans/<kurzer-slug>.md` anlegen
- Plan umsetzen/fortsetzen: in `plans/` nachsehen und die passende
  Datei lesen, bevor du mit der Arbeit beginnst
- Den Plan aktualisieren, während du ihn abarbeitest, damit eine
  andere Session daran anknüpfen kann
<!-- agent-desktop:plans:end -->
```

Bewusst kein Kapitelschema und keine Statusfelder: Je mehr Struktur
vorgeschrieben wird, desto mehr Formalismus produziert das Modell. Der Plan
ist ein lebendes Arbeitsdokument, kein Formular.

Der `plans/`-Ordner wird **nicht** vorab angelegt — leere Ordner sind in Git
unsichtbar, und das Modell legt ihn beim ersten Plan selbst an.

## Tasks

### Task 1: `src/plans-convention.js` (neu)

- [x] `MARKER_START` / `MARKER_END`, `DEFAULT_PLANS_MD` (Standardinhalt oben).
- [x] `ensureMarkers(content)` — umschließt den Inhalt mit Markern, falls sie
  fehlen; lässt ihn unverändert, wenn beide korrekt vorhanden sind.
- [x] `applyBlock(targetContent, blockContent)` → `string` — **pure function**,
  implementiert die Tabelle oben. Kein `fs`, damit direkt testbar.
- [x] `ensureSourceFile(sourcePath, fsImpl)` — legt die Quelldatei mit
  `DEFAULT_PLANS_MD` an, wenn sie fehlt; rührt sie sonst nicht an. Gibt den
  Inhalt zurück.
- [x] `syncToTarget(sourceContent, targetPath, fsImpl)` — liest Ziel (falls
  vorhanden), wendet `applyBlock` an, schreibt nur bei tatsächlicher Änderung
  zurück (kein unnötiges Anfassen fremder Dateien / mtime-Rauschen).

**Contract:**
```js
applyBlock(targetContent: string, blockContent: string): string
ensureSourceFile(sourcePath: string, fsImpl?): string
syncToTarget(sourceContent: string, targetPath: string, fsImpl?): boolean  // true = geschrieben
```

### Task 2: `main.js` — Verdrahtung beim App-Start

- [x] Zielpfade: `~/.claude/CLAUDE.md` (Claude Code), `~/.copilot/copilot-instructions.md`
  (Copilot). Fest, nicht konfigurierbar.
- [x] Angebunden-Erkennung wiederverwenden statt neu bauen: die gecachte
  `copilot --version`-Funktion (main.js ~917) und derselbe `claude --version`-
  Check wie in `claudecode:status` (main.js ~655).
- [x] Aufruf beim App-Start, asynchron und nicht blockierend — in Nachbarschaft
  zu `ensureProviderContextDirs()`. Fehler werden geloggt, nie geworfen: Wenn
  das Schreiben scheitert (Rechte, gesperrte Datei), darf die App trotzdem
  normal starten.

### Task 3: Tests — `__tests__/plans-convention.test.js` (neu)

- [x] `applyBlock`: Zieldatei leer/nicht vorhanden; Block vorhanden → ersetzen;
  Block fehlt → anhängen; Inhalt vor/nach dem Block bleibt unverändert;
  leerer Block → Block entfernen; leerer Block ohne vorhandenen Block → No-op;
  nur Start-Marker vorhanden → anhängen statt Inhalt fressen; Reihenfolge
  vertauscht (`end` vor `start`) → anhängen; CRLF-Zeilenenden.
- [x] `ensureMarkers`: fehlende Marker werden ergänzt; vorhandene nicht doppelt.
- [x] `ensureSourceFile`: legt an wenn fehlend, überschreibt nie.
- [x] `syncToTarget`: schreibt nicht, wenn sich nichts ändert (Idempotenz).

### Task 4: Doku

- [x] `docs/ARCHITECTURE.md`: kurzer Abschnitt — Quelle, Ziele, Sync-Zeitpunkt,
  bewusste Nicht-Ziele (Direkt-API, SSH).
- [x] `docs/USER-GUIDE.md`: wo Pläne liegen, dass die Konvention automatisch in
  den globalen Instruction-Dateien landet, und dass die App dort einen
  markierten Block pflegt.
- [ ] `CHANGELOG.md` + Versions-Bump: **bewusst offen** — separater Release-Schritt.

## Risiken

- Die App schreibt in `~/.claude/CLAUDE.md`, eine Datei, die **jede**
  Claude-Code-Session liest, auch außerhalb von Agent Desktop. Das ist
  beabsichtigt (die Konvention soll überall gelten), aber es ist eine Wirkung
  über die App hinaus. Der Marker-Block macht sie sichtbar und rückgängig
  machbar.
- Kein Abschalter — bewusste Entscheidung. Wer es loswerden will, leert die
  Quelldatei; dann entfernt der nächste Sync den Block aus den Zieldateien.
- Ob die Modelle die Konvention tatsächlich befolgen, ist eine Prompt-Frage,
  keine Code-Frage. Der Text ist deshalb kurz und imperativ gehalten und lässt
  sich ohne Code-Änderung nachschärfen.

## Status

Umgesetzt. 50/50 Suiten, 1739/1739 Tests grün (30 neue in
`__tests__/plans-convention.test.js`), ESLint 0 Fehler.

Trockenlauf gegen die echten Zieldateien vor dem Scharfschalten: beide
existieren, der bestehende Inhalt bleibt nachweislich vollständig erhalten, der
Block wird angehängt. Geschrieben wird erst beim nächsten App-Start.

Migration erledigt: der vorherige `plan.md` (Reasoning-Feature) liegt jetzt als
`plans/reasoning-effort-claude-code.md`.

**Noch nicht committet, nicht gepusht.** Achtung: Im Branch
`feature/reasoning-selection` liegen dadurch zwei unabhängige Features
gleichzeitig im Working Tree (Reasoning-Effort und diese Plan-Konvention) —
vor dem Commit trennen.

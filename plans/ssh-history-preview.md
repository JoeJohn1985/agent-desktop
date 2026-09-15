# Plan: Historie-Vorschau für Claude Code (SSH)

## Ziel

Beim Wiederöffnen eines `claude-code-ssh`-Tabs erscheint aktuell keine
Nachrichten-Vorschau — die Session selbst ist intakt (der Adapter auf dem
Remote-Host hat weiterhin den vollen Kontext), nur die App zeigt beim Öffnen
nichts an. Grund: `readClaudeCodeTranscript()` liest das Transkript über
lokales `fs`, aber bei SSH liegt die Datei auf dem Remote-Host.

Dieser Plan schließt genau diese eine Lücke — kein Redesign, eine zusätzliche
Datenquelle für einen bereits vorhandenen Mechanismus.

## Kontext (verifiziert im Code)

- Lokal liest `src/claude-code-transcript.js` die Datei
  `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl` — Claude Codes eigenes,
  undokumentiertes Transkriptformat (nicht Teil von ACP). Sanitizing der cwd:
  `:`, `\`, `/`, ` ` → `-`. Die Session-ID wird streng auf UUID-Zeichen geprüft
  (Pfad-Traversal-Schutz), bevor sie in den Pfad eingebaut wird.
- `readClaudeCodeTranscript()` macht Lesen (`fs.readFileSync`) und Parsen
  (JSONL → `{role, content, timestamp}[]`) in einer Funktion — für SSH muss
  das getrennt werden: Lesen wird zu einem SSH-`cat`, Parsen bleibt identisch.
- Der Aufrufer (`renderer/app.js`, ~Zeile 4197) hat den `claude-code-ssh`-Zweig
  bereits als bewussten No-op stehen, mit Kommentar, warum das aktuell so ist.
- `src/ssh-remote.js` ist das etablierte Muster für alles, was einen Remote-
  Shell-Befehl baut: reine, ungetestete-freie Funktionen (`buildX`/`parseX`),
  Quoting über `shellQuote()`, kein `fs`/`child_process` in der Modul-Logik
  selbst — nur in main.js, wo der Prozess tatsächlich gespawnt wird.

## Design-Entscheidungen

- **Parsing von Lesen trennen**: `readClaudeCodeTranscript()` wird in eine
  reine `parseClaudeCodeTranscriptContent(content, limit)` (JSONL-String →
  Nachrichten-Array) und die bestehende dünne fs-Hülle aufgeteilt. Lokaler und
  SSH-Pfad nutzen danach exakt dieselbe Parse-Logik — kein Format-Unterschied,
  nur eine andere Quelle für den rohen Text.
- **Kein bekannter Home-Pfad nötig**: Der Remote-Befehl baut den Pfad relativ
  zu `~` und lässt die Remote-Shell expandieren (`~/.claude/projects/...`),
  statt den absoluten Home-Pfad des Remote-Users zu kennen — das Konzept ist
  auf Server-Ebene unterschiedslos zu `buildListDirCommand()` in
  `ssh-remote.js`, das ebenfalls unquotiertes `~` für „Remote-Home" nutzt.
- **Fail-soft bleibt erhalten**: Fehlt die Datei remote (Session nie über
  diesen Host gelaufen, Pfad falsch, `cat` schlägt fehl) → leeres Array, keine
  Fehlermeldung im UI. Gleiche Philosophie wie der lokale Pfad.
- **Kein Caching nötig**: Die Historie wird nur beim Öffnen eines Tabs
  abgerufen (ein SSH-Roundtrip pro Öffnen), nicht wiederholt — anders als bei
  Skills/Agents (siehe Schwesterplan) gibt es hier keinen Aufruf-Sturm.

## Betroffene Bereiche

### Task 1: `src/claude-code-transcript.js` — Parsing extrahieren

- [ ] Neue Funktion `parseClaudeCodeTranscriptContent(content, limit = 1000)`:
  identischer Körper wie der Parse-Teil von `readClaudeCodeTranscript()`
  (Zeilen splitten, `isSidechain`/Nicht-Message-Zeilen überspringen,
  `extractMessageContent`, `limit`-Kürzung), aber nimmt einen bereits
  gelesenen String statt eines Pfads.
- [ ] `readClaudeCodeTranscript()` wird zur dünnen Hülle: Pfad bauen, `fs`
  lesen, an `parseClaudeCodeTranscriptContent()` weiterreichen. Verhalten
  bleibt bitgleich (bestehende Tests dürfen sich nicht ändern).

**Contract:**
```js
parseClaudeCodeTranscriptContent(content: string, limit?: number): Array<{role, content, timestamp}>
```

### Task 2: `src/ssh-remote.js` — Remote-Lesebefehl

- [ ] `buildReadTranscriptCommand(cwd, sessionId)`: baut
  `cat ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl 2>/dev/null`,
  quotet den vollständigen Pfad als ein Stück (nicht `cwd` isoliert — die
  Sanitize-Regel ersetzt ohnehin jedes Zeichen, das Quoting bräuchte). `2>/dev/null`
  statt `|| true`: der Exit-Code wird gebraucht, um „Datei fehlt" von „Datei
  leer" zu unterscheiden.
- [ ] Sanitize-Logik (`:`, `\`, `/`, ` ` → `-`) hierher verschieben oder aus
  `claude-code-transcript.js` importieren — **nicht duplizieren**. Session-ID
  wird vor dem Einbau in den Befehl gegen dasselbe `SAFE_SESSION_ID`-Muster
  geprüft wie lokal (Pfad-Traversal, jetzt auf der Remote-Seite relevant).
- [ ] Kein separater Parser nötig — die Ausgabe ist roher JSONL-Text, geht
  direkt an `parseClaudeCodeTranscriptContent()` (Task 1).

**Contract:**
```js
buildReadTranscriptCommand(cwd: string, sessionId: string): string | null  // null bei ungültiger sessionId
```

### Task 3: `main.js` — IPC-Handler

- [ ] Neuer Handler `claudecode:sshReadTranscript(host, cwd, sessionId)`:
  spawnt `ssh -T <host> <command>` (gleiches Muster wie `claudecode:sshListDir`),
  gibt bei Erfolg `{ ok: true, messages }` zurück (schon geparst — die
  Parse-Logik gehört ins Hauptprogramm, nicht in den Renderer), bei jedem
  Fehler `{ ok: true, messages: [] }` (fail-soft, kein Renderer-seitiges
  Fehlerhandling nötig — konsistent mit dem lokalen Pfad, der auch nie wirft).
- [ ] Timeout: gleiche Größenordnung wie `claudecode:sshListDir`
  (Sekunden, nicht die langen Adapter-Start-Timeouts).

### Task 4: `preload.js` + `renderer/app.js` — Verdrahtung

- [ ] `preload.js`: `sshReadTranscript: (host, cwd, sessionId) => ipcRenderer.invoke('claudecode:sshReadTranscript', host, cwd, sessionId)`
  im `sessions`- oder `chat`-Namespace (an bestehende Konvention angleichen —
  `sshListDir` liegt aktuell im `chat`-Namespace, wahrscheinlich dorthin).
- [ ] `renderer/app.js` ~Zeile 4197: den No-op-Zweig für `claude-code-ssh`
  ersetzen durch denselben Aufruf wie beim lokalen `claude-code`-Zweig
  (`renderSimpleHistory(…, insertBefore, tab)`), nur mit
  `desktop.chat.sshReadTranscript(getClaudeCodeSshHost(), tab.cwd, sessionId)`
  statt `desktop.sessions.readClaudeCodeTranscript(tab.cwd, sessionId)`.

### Task 5: Tests

- [ ] `parseClaudeCodeTranscriptContent()`: identische Fälle wie die
  bestehenden `readClaudeCodeTranscript()`-Tests (falls vorhanden), plus
  direkter Aufruf ohne `fs`-Fixture.
- [ ] `buildReadTranscriptCommand()`: korrektes Quoting, `null` bei
  ungültiger/fehlender sessionId, Sanitize-Verhalten für die cwd (Sonderzeichen,
  Leerzeichen, Backslashes — Windows-Pfade als cwd sind der Normalfall hier).
- [ ] `claudecode:sshReadTranscript`: Erfolg, fehlende Datei (Exit-Code ≠ 0),
  SSH-Verbindungsfehler — alle drei enden in `{ ok: true, messages: [] }` bzw.
  einem sauberen Fehlschlag, nie in einer im Renderer sichtbaren Exception.

## Nicht im Scope

- Keine Live-Aktualisierung der Historie während eine SSH-Session läuft — nur
  beim (Wieder-)Öffnen des Tabs, wie beim lokalen Pfad auch.
- Kein Caching des Transkripts.

## Status

Plan erstellt, Umsetzung noch offen.

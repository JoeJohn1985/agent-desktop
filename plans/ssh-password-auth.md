# Plan: Passwort-Authentifizierung für Claude Code (SSH)

## Ziel

`claude-code-ssh` verlangt aktuell zwingend passwortlosen (Key-basierten)
SSH-Zugang. Der Nutzer möchte das nicht einrichten (Arbeitsrechner, keine
Admin-Rechte für den `ssh-agent`-Dienst, will kein zweckentfremdetes Pageant
nutzen). Dieser Plan ergänzt eine zweite, optionale Auth-Variante: ein in der
App hinterlegtes Passwort (verschlüsselt über die bestehende
secure-store-Infrastruktur), automatisch eingespielt über `SSH_ASKPASS` —
ohne neue Abhängigkeit, ohne Wechsel der bestehenden Transport-Architektur.

**Abgestimmtes Sicherheitsmodell:** Das Passwort liegt verschlüsselt auf der
Platte (Electron `safeStorage`, an das Windows-Benutzerkonto gebunden). Beim
Verbindungsaufbau wird es im Hauptprozess kurz entschlüsselt und für die
Lebensdauer des jeweiligen `ssh.exe`-Kindprozesses als Env-Variable gesetzt —
exakt wie die App das heute schon für andere Provider-API-Keys macht. Nie im
Klartext auf der Platte, nie als Kommandozeilen-Argument.

## Kontext (verifiziert im Code)

- `src/acp-client.js` (Zeilen 172-183) baut den Kind-Prozess-Env bereits
  generisch aus `options.env` (→ `#extraEnv`) und `options.stripEnv` —
  keine Änderung dort nötig, nur `claudeCodeClientOptions()` in `main.js`
  muss zusätzliche Env-Einträge liefern.
- Zwei weitere Spawn-Stellen in `main.js` nutzen `-o BatchMode=yes`
  (`claudecode:testSsh` ~Z.742, `claudecode:sshListDir` ~Z.780). Laut
  `ssh_config(5)` deaktiviert das JEDE Passwort-/Passphrase-Abfrage —
  **auch `SSH_ASKPASS`**. Muss für den Passwort-Fall weggelassen werden.
- `src/secure-store.js` ist bereits generisch (`setKey`/`getKey`/`hasKey`/
  `deleteKey`, beliebiger String-Key, Electron-`safeStorage`-verschlüsselt).
  Wird direkt mit dem Schlüssel `'claude-code-ssh'` genutzt, ohne die
  `providers:setKey`-IPC-Route (die auf `KNOWN_PROVIDERS` prüft).
- Installierte OpenSSH-Version auf dem Windows-Rechner des Nutzers:
  `OpenSSH_for_Windows_9.5p2` — unterstützt `SSH_ASKPASS_REQUIRE=force`
  (seit OpenSSH 8.4), erzwingt Askpass auch ganz ohne TTY.
- `assets/` ist die bestehende Konvention für mitgelieferte Dateien
  (`assets/icon.png`, referenziert über `path.join(__dirname, 'assets', …)`
  — kein `extraResources`-Config nötig, electron-builder packt den ganzen
  Projektbaum).
- Host-Key-Verifikation ist aktuell nirgends behandelt
  (`StrictHostKeyChecking` ungesetzt) — bei einem noch nie kontaktierten
  Host hängt die erste Verbindung an der Bestätigungsfrage fest (keine TTY,
  um "yes" einzugeben). Unabhängig vom Passwort-Feature, aber wird hier
  mitgelöst, da sonst der erste echte Test des Nutzers genau daran scheitert.

## Design-Entscheidungen

- **Kein neuer Dependency, kein Transport-Wechsel.** `ssh.exe` wird weiter
  wie heute gespawnt (gepipte stdio, JSON-RPC); nur `SSH_ASKPASS`/
  `SSH_ASKPASS_REQUIRE=force` kommen als Env-Variablen hinzu, plus ein
  winziger lokaler Askpass-Helper. Kleinere, risikoärmere Änderung als ein
  Bibliothekswechsel (`ssh2`-npm wurde erwogen, verworfen).
- **Askpass-Helper**: `assets/ssh-askpass.cmd`, gibt nur
  `%AGENT_DESKTOP_SSH_PW%` auf stdout aus. `ssh.exe` ruft sie als eigenen
  Kindprozess auf, wenn eine Passwortabfrage ansteht; erbt die Env-Variable
  vom aufrufenden `ssh.exe`. Kein zusätzlicher IPC-Kanal, keine Datei mit
  Klartext-Inhalt.
- **Bestehender Key-Weg bleibt unangetastet.** Ohne hinterlegtes Passwort
  ändert sich nichts (inkl. `BatchMode=yes` bei den zwei Kurzbefehlen).
  Passwort und Key können gleichzeitig konfiguriert sein — SSH probiert
  Pubkey zuerst, fällt erst bei Fehlschlag auf Passwort/Askpass zurück.
- **Ein globales Passwort**, konsistent mit dem bestehenden Ein-Host-Modell
  (`claudeCodeSshHost` ist bereits global, nicht pro Tab).
- **`StrictHostKeyChecking=accept-new`** auf allen drei SSH-Spawn-Stellen:
  vertraut einem neuen Host beim ersten Kontakt automatisch (wie die meisten
  GUI-SSH-Tools), verweigert aber weiterhin bei einem späteren *geänderten*
  Schlüssel (die eigentliche Schutzfunktion bleibt erhalten).

## Betroffene Bereiche

### Task 1: Askpass-Helper

- [x] `assets/ssh-askpass.cmd`. **Wichtige Korrektur gegenüber dem
      ursprünglichen Plan**: `echo %AGENT_DESKTOP_SSH_PW%` funktioniert NICHT
      sicher — `cmd.exe` expandiert `%VAR%` auf jeder gelesenen Zeile (auch in
      `REM`-Kommentaren!) und parst das Ergebnis danach erneut auf
      `&`/`|`/`<`/`>`. Ein Passwort mit einem dieser Zeichen würde als
      zusätzlicher Befehl ausgeführt statt ausgegeben — mit einem Testpasswort
      (`te&st|pw>with"tricky` + Backtick) live reproduziert und verifiziert.
      Lösung: die `.cmd`-Datei ruft `powershell -NoProfile -NonInteractive
      -Command "Write-Output $env:AGENT_DESKTOP_SSH_PW"` auf — ein fixer,
      passwortunabhängiger Befehlstext; PowerShell liest die Variable als
      Wert, nicht als erneut zu parsenden Code. Mit demselben Testpasswort
      gegengeprüft: kommt jetzt byte-genau zurück.

### Task 2: `main.js` + `src/ssh-remote.js` — IPC-Handler + Spawn-Stellen

- [x] `claudecode:sshSetPassword(password)`, `claudecode:sshHasPassword()`,
      `claudecode:sshDeletePassword()` — analog zu `providers:setKey` etc.,
      ohne `KNOWN_PROVIDERS`-Check.
- [x] **Abweichung vom Plan (Testbarkeit):** Die reine Logik (welche Env-
      Variablen, welche Args) wanderte statt direkt in `main.js` nach
      `src/ssh-remote.js` (`buildPasswordEnv`, `buildOneShotSshArgs`,
      `STRICT_HOST_KEY_OPT`) — passend zum bestehenden Muster dieser Datei
      und zum Projekt-Grundsatz, dass `main.js` selbst ungetestet bleibt
      (kein Electron-Mock-Setup vorhanden) und daher nur dünne Wrapper
      (`sshPasswordEnv()`, `sshOneShotOptions()`) enthalten sollte.
- [x] `claudeCodeClientOptions()`: liefert bei hinterlegtem Passwort
      zusätzliche `env`-Einträge; sonst wie heute (unverändert für
      Key-only-Nutzer).
- [x] `claudecode:testSsh` / `claudecode:sshListDir`: `BatchMode=yes` nur
      ohne hinterlegtes Passwort; sonst Askpass-Env mitgeben.
- [x] Alle drei SSH-Spawn-Stellen: `-o StrictHostKeyChecking=accept-new` —
      unabhängig vom Passwort-Feature nötig, sonst hängt der allererste
      Verbindungsaufbau zu einem neuen Host an der Fingerprint-Bestätigung
      (keine TTY, um "yes" einzugeben).

### Task 3: `preload.js`

- [x] Drei neue `chat.*`-Methoden analog zu `testClaudeCodeSsh`/`sshListDir`.

### Task 4: `renderer/modules/provider-settings.js`

- [x] SSH-Settings-Tab: Passwort-Feld (`type="password"`) mit
      Speichern/Löschen, Status "hinterlegt/leer".
- [x] `wireClaudeCodeSshPanel()`: Wiring fürs neue Feld.
- [x] SSH-Ziel-Hinweistext aktualisiert (behauptete vorher fälschlich, ein
      SSH-Key sei zwingend).

### Task 5: Tests

- [x] `src/ssh-remote.js`: `buildPasswordEnv`/`buildOneShotSshArgs` — mit/ohne
      Passwort, BatchMode-Umschaltung, StrictHostKeyChecking in beiden
      Fällen (7 neue Tests in `__tests__/ssh-remote.test.js`).
- [x] **Zusätzlich zum Plan:** `__tests__/secure-store.test.js` neu angelegt
      (existierte vorher gar nicht, obwohl `secure-store.js` schon für die
      API-Keys der anderen Provider genutzt wird) — Set/Get/Has/Delete,
      Koexistenz mehrerer Keys, Klartext landet nie in der `.enc`-Datei,
      wirft statt still auf Klartext zurückzufallen wenn OS-Verschlüsselung
      fehlt. Electron über `jest.mock('electron', …)` gemockt, analog zu
      `__tests__/images-ipc.test.js`.
- [x] Volle Suite: 51/51 Suiten, 1840/1840 Tests grün. ESLint: 0 Fehler, 37
      Warnungen (exakt die bestehende Baseline, keine neuen).

## Nicht im Scope

- Kein Wechsel auf `ssh2` (npm) oder eine andere SSH-Bibliothek.
- Kein Pro-Host-Passwort (nur ein globaler Host existiert aktuell).
- Keine Änderung an der Key-basierten Auth (bleibt vollständig
  funktionsfähig, unverändert).

## Status

Umsetzung fertig, automatisiert verifiziert (Tests, Lint, plus ein manueller
Exploit-Test des Askpass-Helpers mit Sonderzeichen).

### Nachtrag: UI-Restrukturierung + Styling (nach erstem Screenshot-Feedback)

- SSH-Ziel wird jetzt in der Provider-Zeile "Claude Code (SSH)" eingegeben
  (wie API-Keys anderer Provider), nicht mehr im eigenen Tab. Der "CC (SSH)"-
  Tab erscheint wieder erst, sobald dort ein Host gespeichert ist (Rückbau
  des Force-Includes von vorhin — das eigentliche Henne-Ei-Problem ist durch
  die Zeile gelöst, nicht durch einen immer sichtbaren Tab).
- Styling-Bug behoben: `settings__input` existierte gar nicht in
  `styles.css` → Browser-Default (weiße Boxen). Neu definiert, plus
  `-webkit-autofill`-Override gegen Chromiums Login-Formular-Heuristik.
  Live in der laufenden App verifiziert (Playwright/`_electron`, isolierte
  `preferences.test.json` — nichts an echten Nutzereinstellungen verändert).

### Nachtrag: erster echter Test gegen den Pi — `spawn ssh ENOENT`

Erster Test des Nutzers (SSH manuell eingerichtet, Terminal-Login
funktioniert) schlug in der App fehl: `spawn ssh ENOENT`. Ursache:
`spawn('ssh', …, { shell: false })` verlässt sich auf Node/Windows'
PATH-Auflösung des *aufrufenden* Prozesses — bei einem über Explorer/
Startmenü gestarteten Prozess kann das ein anderer (älterer) PATH-Stand
sein als in einem frisch geöffneten Terminal, das PATH bei jedem Start neu
liest. Eigene Stichprobe bestätigt zusätzlich, dass der aufgelöste
`ssh`-Pfad je nach Prozess/Shell unterschiedlich ausfallen kann (Git's
eigenes `ssh.exe` vs. das von Windows) — reine PATH-Auflösung ist hier
grundsätzlich nicht robust genug.

**Fix:** `resolveSshExecutable()` (main.js, Zwilling von
`resolveClaudeExecutable()`) löst den absoluten Pfad einmalig über
`where`/`which` auf (das selbst über eine Shell läuft — sicher, da feste,
nicht nutzergesteuerte Argumente) und cacht ihn. Fällt `where` leer aus,
zusätzlicher Fallback auf den Standard-Installationspfad
`C:\Windows\System32\OpenSSH\ssh.exe` (Existenzprüfung). Der eigentliche
SSH-Aufruf bleibt bewusst `shell: false` — der schon POSIX-shell-quotierte
Remote-Befehl darf nicht noch einmal von einer lokalen `cmd.exe` geparst
werden (`&&` würde sonst als lokaler Verkettungsoperator gelesen).
Betrifft alle drei SSH-Spawn-Stellen (Adapter-Start, Verbindungstest,
Ordner-Browser) — `claudeCodeClientOptions()` und `sshOneShotOptions()`
mussten dafür async werden (ein Aufrufer je Funktion, beide bereits async).

**Diese Erklärung war unvollständig.** Der Nutzer fragte zurecht nach, wieso
der Ordner-Browser (derselbe `spawn('ssh', …)`) funktionierte, der
Chat-Start aber nicht — mit obigem Fix allein nicht erklärbar, da beide
denselben PATH sehen. Eigene Nachprüfung (zunächst mit einem eigenen
Bash-Escaping-Fehler in die falsche Richtung gelaufen, dann mit einem
sauberen Testskript korrekt reproduziert) fand die eigentliche Ursache:
`AcpClient` übergibt `cwd` sowohl als ACP-Protokoll-Parameter (`session/new`)
als auch **eins zu eins als lokale Node-`spawn()`-cwd**. Für
`claude-code-ssh` ist `cwd` aber ein Remote-Pfad (z.B. `/home/pi/projekt`)
— kein gültiges lokales Windows-Verzeichnis. Sauber reproduziert:
`spawn('ssh', ['-V'], { cwd: '/home/pi/projekt' })` scheitert exakt mit
`spawn ssh ENOENT`, Wort für Wort die Meldung des Nutzers; ohne diese cwd
oder mit einem echten lokalen Pfad läuft derselbe Aufruf sauber durch. Der
Ordner-Browser (`claudecode:sshListDir`) setzt gar kein `cwd` beim Spawn —
deshalb funktionierte er, während der Chat-Start (der `cwd` durchreicht)
scheiterte.

**Zweiter, eigentlicher Fix:** `AcpClient` (`src/acp-client.js`) trennt jetzt
`#cwd` (ACP-Protokoll-Wert, bleibt der Remote-Pfad) von `#spawnCwd` (lokales
Verzeichnis für den `spawn()`-Aufruf selbst, Default weiterhin `#cwd` —
unverändertes Verhalten für Copilot/lokales Claude Code). `main.js`s
`claudeCodeClientOptions()` setzt für die SSH-Variante explizit
`spawnCwd: process.cwd()`. Zwei neue Tests in `__tests__/acp-client.test.js`
sichern beide Fälle ab (mit/ohne `spawnCwd`).

`resolveSshExecutable()` bleibt trotzdem sinnvoll (adressiert ein reales,
wenn auch selteneres PATH-Problem bei Explorer-gestarteten Prozessen) — war
in diesem konkreten Fall aber nicht die eigentliche Ursache.

### Nachtrag: nach dem `spawnCwd`-Fix — `Process exited (code=127)`

Nächster Fehler nach dem `spawnCwd`-Fix: `code=127`, die Unix-Konvention für
"Befehl nicht gefunden" — diesmal auf dem **Pi**, nicht lokal. Mit dem
Nutzer eingegrenzt: `ssh <ziel> "npx --version"` lief zunächst unklar durch,
aber der exakte, von der App gebaute Befehl
(`ssh <ziel> "cd '<cwd>' && npx -y '<paket>'"`) lieferte reproduzierbar
`bash: line 1: npx: command not found`.

**Ursache:** SSH führt einen mitgegebenen Befehl standardmäßig in einer
nicht-interaktiven, nicht-Login-Shell aus. Viele Node-Installationen (allen
voran `nvm`, mit Abstand am häufigsten) tragen ihren PATH-Eintrag nur in
`~/.bashrc` ein — die aber von bash für nicht-interaktive Shells übersprungen
wird. Deshalb funktioniert `npx` beim normalen, interaktiven Einloggen
klaglos, aber nicht bei einem einzelnen SSH-Befehl wie diesem.

**Fix:** `SOURCE_NVM_PREFIX` (`src/ssh-remote.js`) — lädt `~/.nvm/nvm.sh`
still nach (`[ -s ... ] && . ... >/dev/null 2>&1`), falls vorhanden, bevor
der eigentliche Befehl läuft. Bewusst **nicht** über eine Login-/interaktive
Shell (`bash -lic`) gelöst, obwohl das Quoting dafür geprüft und funktional
bestätigt wurde (verschachteltes `shellQuote()` übersteht auch Pfade mit
eingebetteten Anführungszeichen, per echtem Bash-Test verifiziert) — das
Risiko, dass irgendein Login-Banner/`.bashrc`-Echo den JSON-RPC-Stream des
Adapters auf stdout verunreinigt, wog schwerer als der Vorteil, auch andere
Versionsmanager (asdf etc.) automatisch abzudecken. Betrifft
`buildAdapterCommand()` und `buildProbeCommand()` (der Verbindungstest nutzt
`node`/`claude` genauso) — `buildListDirCommand()` bewusst unverändert, da
`cd`/`pwd`/`ls` nie von `nvm` abhängen.

Fünf neue/angepasste Tests in `__tests__/ssh-remote.test.js`. Volle Suite:
51/51 Suiten, 1847/1847 Tests grün, ESLint unverändert.

**Falls das nicht reicht** (z.B. weil der Nutzer `asdf` statt `nvm` nutzt,
oder Node an einem ganz anderen Ort liegt): nächster Schritt wäre, den
Nutzer nach dem Ergebnis von `ssh <ziel> "which npx"` zu fragen und den
tatsächlichen Pfad direkt in `PATH` einzuhängen, statt zu raten.

### Nachtrag: eigentliche Ursache — Node.js war auf dem Pi gar nicht installiert

Der `SOURCE_NVM_PREFIX`-Fix lief ins Leere. Eingrenzung mit dem Nutzer:
interaktiver und nicht-interaktiver `PATH` waren identisch (keine
PATH-Diskrepanz), `which npx` blieb stumm, und `npx --version` direkt in
einer normalen interaktiven SSH-Sitzung ergab ebenfalls
`-bash: npx: command not found`. `node --version` bestätigte es endgültig:
`-bash: node: command not found`. `claude --version` lief trotzdem
(`2.1.280`) — die Claude-Code-CLI ist ein eigenständiges Binary ohne
Node.js-Laufzeitabhängigkeit, weshalb dieser eine Teilcheck fälschlich
"alles ok" suggerierte.

**Es war also nie ein App- oder Quoting-Bug** — auf dem Pi fehlte
Node.js/npm/npx schlicht komplett. Alle Code-Fixes dieser Session
(`resolveSshExecutable`, `spawnCwd`-Trennung, `SOURCE_NVM_PREFIX`) bleiben
sinnvolle, korrekte Härtungen für andere Fälle, waren aber für **dieses**
Problem nicht die Lösung.

Zusätzlich geprüft (npm-Registry): der ACP-Adapter
(`@agentclientprotocol/claude-agent-acp@0.79.0`) verlangt `engines.node:
">=22"` — eine bloße Nachinstallation hätte also nicht gereicht, es musste
mindestens Node 22 sein.

**Lösung (auf dem Pi, nicht im Code):** Node 22 via NodeSource-Setup-Skript
installiert (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E
bash -` gefolgt von `apt-get install -y nodejs`). Ein erster Versuch brach
mitten im `needrestart`-Dialog ab (Strg+C riss vermutlich den ganzen
`apt`-Vorgang mit ab), zweiter Versuch mit `apt-get install -f -y` zum
Reparieren plus sauberem Durchklicken des Dialogs war erfolgreich.
Verifiziert: `node --version` → `v22.23.2`, `npx --version` → `10.9.8`.

## Status

Erster echter End-to-End-Test (Tab öffnen, Nachricht senden über
`claude-code-ssh`) vom Nutzer bestätigt erfolgreich. Damit ist die gesamte
SSH-Passwort-Auth-Arbeit plus alle Nachtrags-Fixes (UI-Umbau, `spawnCwd`,
`resolveSshExecutable`, `SOURCE_NVM_PREFIX`) funktional abgeschlossen und
gegen den echten Pi verifiziert. Alles weiterhin uncommitted.

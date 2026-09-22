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
Exploit-Test des Askpass-Helpers mit Sonderzeichen). **Noch nicht gegen den
echten Pi getestet** — das ist der nächste Schritt mit dem Nutzer.

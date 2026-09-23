# Plan: Claude Code (lokal) trennen können

## Ziel

Die Provider-Zeile "Claude Code" in Settings → Provider zeigt aktuell nur,
ob die `claude`-CLI installiert ist (`claude --version`) — nicht, ob man
tatsächlich angemeldet ist, und es gibt keine Möglichkeit, sich innerhalb
der App abzumelden. Anmeldung geht heute nur manuell im Terminal; Abmeldung
geht aktuell gar nicht über die App.

## Kontext (verifiziert im Code / gegen die installierte CLI)

- `claude auth status` (ohne Flags) liefert sauberes JSON:
  `{loggedIn, authMethod, apiProvider, email, orgName, subscriptionType, ...}`
  — deutlich aussagekräftiger als der bisherige reine CLI-Präsenz-Check.
- `claude auth logout` existiert ("Log out from your Anthropic account").
  Kein `--yes`/`--force`-Flag in `--help` sichtbar — ob es interaktiv
  nachfragt, wurde bewusst **nicht** an der echten, gerade angemeldeten
  CLI-Session getestet (Risiko, die eigene laufende Session zu kappen).
  Deshalb: gleiches Muster wie `auth:login` (Copilot) — ein sichtbares
  Terminal-Fenster, kein stiller Hintergrund-Spawn.
- `auth:login` (main.js, ~Z.2330) ist exakt die Vorlage: öffnet auf Windows
  ein `powershell -NoExit`-Fenster via `start`, auf macOS `open -a Terminal`,
  auf Linux `x-terminal-emulator`. Die App treibt den eigentlichen
  Login/Logout-Dialog nie selbst — nur das Sichtbarmachen.
- `claudecode:status` (main.js ~Z.803) bleibt unverändert (Contract
  `{installed, version}`, mehrere Aufrufer: provider-settings.js,
  self-update.js) — neue Auth-Info kommt über einen **separaten** Handler,
  um bestehende Aufrufer nicht zu beeinflussen.

## Design-Entscheidungen

- **Kein stiller Logout-Spawn.** Analog zu `auth:login`: ein sichtbares
  Terminal-Fenster mit `claude auth logout`. Vermeidet jedes Risiko rund um
  eine eventuelle interaktive Bestätigung (kein TTY sonst, gleiche Klasse
  Problem wie bei SSH-Passwörtern) und ist konsistent mit dem einzigen
  bestehenden Auth-Flow dieser Art in der App.
- **Neuer, separater Status-Handler** (`claudecode:authStatus`) statt
  Erweiterung von `claudecode:status` — andere Aufrufer brauchen die
  Auth-Info nicht, und der bestehende Contract bleibt unangetastet.
- **"Trennen"-Button nur sichtbar/aktiv, wenn tatsächlich angemeldet**
  (nicht nur "CLI installiert") — verhindert einen sinnlosen Klick ohne
  aktive Session.

## Betroffene Bereiche

### Task 1: `main.js`

- [x] `claudecode:authStatus` — spawnt `claude auth status`, parst JSON,
      fail-soft `{loggedIn:false}` bei Fehler/Timeout/kaputtem JSON.
- [x] `claudecode:logout` — öffnet Terminal-Fenster mit `claude auth logout`,
      plattform-verzweigt exakt wie `auth:login`.

### Task 2: `preload.js`

- [x] `claudeCodeAuthStatus`, `claudeCodeLogout` im `chat`-Namespace,
      analog zu `claudeCodeStatus`.

### Task 3: `renderer/modules/provider-settings.js`

- [x] `renderCopilotProviderRow()`, `claude-code`-Zweig: Status-Text nutzt
      `claudeCodeAuthStatus()` (angemeldet als E-Mail + Abo-Typ, vs. nur
      "CLI installiert, nicht angemeldet"). "Trennen"-Button neben
      "Status prüfen", nur bei `loggedIn`.

### Task 4: Tests

- [x] Keine main.js-IPC-Tests (Konvention bestätigt: main.js selbst
      ungetestet). Volle Suite weiterhin grün (51/51, 1844/1844), ESLint
      unverändert bei 0 Fehlern/37 Warnungen.
- [x] Visuell in der laufenden App verifiziert (Playwright/`_electron`,
      isolierte `preferences.test.json`): Zeile zeigt korrekt "● angemeldet
      als joejohn1985@gmail.com (pro)" plus "Trennen"-Button. **"Trennen"
      selbst bewusst nicht angeklickt** — das würde die echte, gerade aktive
      CLI-Anmeldung wirklich beenden (ggf. dieselbe Session, über die diese
      Konversation läuft).

## Nicht im Scope

- Keine eigene Login-UI (Login bleibt manuell im Terminal, wie heute).
- Keine Änderung an `claudecode:status` selbst.
- Keine Erzwingung/Automatisierung der Logout-Bestätigung.

## Status

Umsetzung fertig, automatisiert + visuell verifiziert. Der eigentliche
Logout-Klick (öffnet Terminal, führt `claude auth logout` aus) ist absichtlich
nicht End-to-End getestet — siehe Task 4.

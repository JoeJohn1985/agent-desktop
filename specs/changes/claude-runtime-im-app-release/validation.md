# Claude-Release-Runtime: Validierung 2026-10-27

## Versionsentscheidung

`npm view @agentclientprotocol/claude-agent-acp version dependencies engines --json`
lieferte **0.97.0**, SDK **0.3.310**, ACP SDK **2.0.2**, Node **≥22**.
Das native SDK-Paket `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.310`
enthält Claude Code **2.1.310** (durch tatsächlichen `--version`-Aufruf bestätigt).
Alle SDK-Plattformpakete sind als optionale Abhängigkeiten exakt 0.3.310 gebunden.

Quelle: npm-Registry am Prüfungstag und
https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.97.0/CHANGELOG.md
(0.97.0: 2026-10-26, Modellnamen-Deduplizierung, zusätzlicher Ultracode-Schalter;
0.96.0: native CLI 2.1.310; 0.95.0: experimentelles ACP v2).
Die App verhandelt weiterhin ACP **v1**. Zusätzliche Config-Optionen werden nicht
ungefragt aktiviert. Bestehende model/mode/effort- und Permission-Verträge bleiben.

## Tatsächlich ausgeführte Prüfungen

- `npm install --ignore-scripts` erst nach Manifeständerungen; Lockfile aktualisiert.
- Windows x64 Unpacked-App über electron-builder 26.18.0 / Electron 43.2.0 gebaut.
  Produktionspakete und `claude.exe` liegen unter
  `dist\win-unpacked\resources\app.asar.unpacked\node_modules`.
  `afterPack` prüft exakte Adapter-/SDK-/Native-Versionen und Dateiexistenz.
- `npm run smoke:claude-runtime`: Entwicklungspfad, Electron-Node ohne GUI.
- `node src\claude-runtime-smoke.js dist\win-unpacked\resources\app.asar "<absoluter Pfad zu dist\win-unpacked\agent-desktop.exe>"`:
  reale paketierte EXE und reale unpacked Dependencies, keine Nutzer-App gestartet.
  Ein synchroner Node-Resolve-Hook verweigert Dateiimporte außerhalb des
  jeweiligen `node_modules`-Baums: Der Smoke kann nicht unbemerkt fehlende
  Dependencies aus dem übergeordneten Entwicklungscheckout ausleihen.
- Beide Metadatenproben mit isoliertem HOME/USERPROFILE/CLAUDE_CONFIG_DIR,
  entfernten Anbieter-Credentials, npm-offline und ungültigem HTTP(S)-Proxy:
  `initialize` (Adapter 0.97.0, ACP v1), `session/new`, fünf Modelle,
  fünf Modi, bestätigte Config-Wechsel mode→plan, model→sonnet, effort→medium.
  Laden einer nicht existierenden Fixture-Session wird kontrolliert abgewiesen;
  eine ausschließlich synthetische JSONL-Transkriptfixture wird erfolgreich
  über `session/load` geladen (keine echte Modellantwort erzeugt).
  Native CLI `--version` erfolgreich. Fixtures danach entfernt.
- Gezielte Jest-Prüfungen: Release/Alt-Prefs/Developer-Guard/Reset, lokale und
  SSH-Argumente, native Paketbindung und fehlendes Binary, asar-Pfade,
  Auth-Terminalbefehle ohne echten Login, kein Zugriff auf laufende Backends.
  Bestehende ACP-Permissions-, Model-/Mode-/Effort-, Context-/Usage-Tests.
  **490 Tests in neun Suites erfolgreich**; gezielter ESLint: keine Fehler,
  vier vorhandene Warnungen. `git diff --check` ohne Whitespacefehler.
- Usage-Regressionsprüfung verwendet den **echten Formatter aus 0.97.0** mit
  synthetischen Kontingenten. Dabei Dezimal-Prozentwerte im App-Parser ergänzt.
  `/context` bleibt ein lokales CLI-Kommando mit dem bisherigen Transport;
  dessen Parser sind durch bestehende Fixtures geprüft, nicht live abgefragt.

## Grenzen / kein weitergehender Nachweis

- Kein `session/prompt`, keine kostenpflichtigen Modellaufrufe und keine
  Nutzer-Tokens/-Sessions für Proben verwendet. Daher **kein** Nachweis für
  echte Toolausführung, interaktive Permission-Dialoge, live `/usage`/`/context`,
  erfolgreiche Wiederaufnahme einer bestehenden authentifizierten Konversation.
- Kein echter Login/Logout durchgeführt; nur Befehls-/IPC-Verträge getestet.
- Offline bedeutet hier: **lokaler Programmstart aus vorhandenen App-Dateien**.
  Modellkommunikation und Anmeldung benötigen selbstverständlich Netzwerk.
  Proxy-Abschirmung ist keine Betriebssystem-Firewall/Netzwerkaufzeichnung.
- Nur Windows x64 tatsächlich paketiert und ausgeführt; macOS/Linux/ARM64
  brauchen eigene CI-Packaging- und Native-Startprüfungen. Linux-Ziel ist glibc.
- Kein Remotehost kontaktiert. SSH-Pfade sind argument-/versionsseitig geprüft;
  Remote-npx-Download und Remote-Authentifizierung nicht live validiert.
- Unsigned Unpacked-Artefakt, kein Installer-/Signatur-/Update-Rollout-Test,
  kein Release und kein Versionsbump. Enthaltene Drittanbieter-Lizenzen bleiben
  in den Paketen; kommerzielle SDK-/CLI-Weitergabebedingungen vor Release prüfen.
- Bestehender App-Updater ist Git-basiert: Manifeständerung installiert die
  festgelegten Dependencies inklusive optionaler nativer Pakete. Dieser
  Installationsaufruf ist mit simulierten Git/npm-Ergebnissen geprüft, nicht
  durch ein echtes Self-Update des Nutzer-Checkouts. Für paketierte Apps gibt
  es in diesem Projekt noch keinen automatischen Installer-Updatekanal.
- `npm audit --omit=dev` meldet vier Befunde (darunter bestehende direkte
  DOMPurify-Abhängigkeit); keine pauschalen, sachfremden Dependency-Upgrades.

# Plan: Merkwürdige/duplizierte Modellnamen bei Claude Code (SSH)

## Ziel

Seit die SSH-Verbindung zum Pi tatsächlich funktioniert (Passwort-Auth,
`spawn ssh ENOENT`- und `code=127`-Fixes, alles bereits committet), zeigt
das 🧠-Modell-Dropdown für
`claude-code-ssh` generische, teils dreifach duplizierte Namen
("Most efficient for everyday tasks", "Best for everyday, complex tasks"
×3, …) statt echter Modellnamen wie "Sonnet 5" oder "Opus 5.5".

## Kontext (verifiziert im Code)

- `src/acp-client.js`, `#emitAvailableModels()`, Zweig "Shape B" (aktueller
  Claude-Code-Adapter, ~Z.1172-1189): liest eine `configOptions`-Option mit
  `id === 'model'`, deren `options[]` je `{value, name, description}`
  mitbringen. Der Code erwartet `description` im Format
  `"ModelName · Detail"` und nimmt den Teil vor dem `·` als angezeigten
  Namen. Enthält `description` kein `·`, ist `version` leer, und der Code
  fällt auf das generische `name`-Feld zurück — genau diese
  Marketing-Label, die der Nutzer sieht.
- Vermutete Ursache: Der Pi läuft `claude 2.1.280`, lokal ist `2.1.258`
  installiert — die neuere CLI hat vermutlich das `description`-Format des
  `model`-configOptions-Eintrags geändert.
- **Nicht verifiziert**: der tatsächliche rohe `configOptions`-Payload der
  neueren CLI. Bewusst noch kein Fix auf Verdacht — nach der
  `spawn ssh ENOENT`-Odyssee (mehrere falsche Fährten, bis die echte
  Ursache empirisch bestätigt war) gilt: erst Rohdaten sehen, dann fixen.

## Nächster Schritt (aktuell blockiert)

Der Adapter loggt die volle `session/new`-Antwort bereits, nur hinter einem
Debug-Flag:

```powershell
$env:ACP_DEBUG=1
npm start
```

Danach einen `claude-code-ssh`-Tab öffnen bzw. eine neue Session starten und
die Konsolenzeile `[acp:tab...] session/new models :: {...}` (main.js läuft
im Terminal mit, da `ACP_DEBUG` ein main-process-Env-Var ist) hierher
kopieren. Daraus lässt sich das neue `description`-Format ablesen und der
Fix gezielt (nicht geraten) umsetzen.

**Blockiert:** Nutzer ist am 2026-09-24 nicht zuhause, kein VPN zum
Heimnetz (Pi) auf diesem Windows-Rechner eingerichtet. Fortsetzung
voraussichtlich am Abend desselben Tages.

## Nicht im Scope

- Keine Änderung an der Shape-A-Logik (Copilot / alter Adapter) — nur
  Shape B ist betroffen.

## Status

Ursache eingegrenzt, nicht bestätigt. Kein Fix implementiert. Wartet auf
`ACP_DEBUG`-Rohdaten vom Nutzer.

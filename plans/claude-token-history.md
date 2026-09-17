# Plan: Token-Verbrauchshistorie je 5-Stunden-Fenster (Claude Code)

## Ziel

Eine Auflistung, wie viele Tokens pro 5-Stunden-Limitfenster verbraucht wurden
— statt nur des aktuellen Auslastungs-Prozentwerts, den die 🧠-Leiste heute
zeigt.

## Ausgangslage (im Code und an der echten `/usage`-Ausgabe geprüft)

- Claude Codes `/usage` liefert zwei getrennte Blöcke:
  - **Limits**: `**5-hour limit** — **34%** · Resets Sep 10, 6:20 AM GMT+2`
    → nur das *aktuelle* Fenster, als Prozentwert. Wird bereits von
    `parseUsageWindows()` ausgewertet (inkl. `resetsAt` als Epoch).
  - **This session**: eine Markdown-Tabelle mit
    `Input / Output / Cache read / Cache write` → Token-Summen der *laufenden*
    Session, kumulativ.
- **Es gibt keine Historie-Schnittstelle.** Weder vergangene Fenster noch deren
  Verbrauch sind abrufbar. Die Historie muss die App selbst mitschreiben —
  sie beginnt also leer und füllt sich ab Einbau.
- `parseUsageTokens()` versteht nur Copilots Prosa-Format
  (`Tokens: input 1.2k, output 3.4k, …`), nicht Claudes Markdown-Tabelle.
  Für Claude Code braucht es einen eigenen Parser (analog zu dem, was für
  `parseUsageWindows` beim 0.75.0-Formatwechsel nötig war).
- Es existiert bereits ein Verbrauchs-Log (`costLog`, `renderer/modules/costs.js`)
  mit `{ts, sessionId, sessionName, usd, provider}` — **ohne** Token-Zahlen, und
  für Abo-Provider wird bewusst nichts geschrieben (`deltaUsd = 0`).
- `refreshSubscriptionUsage()` ruft nach jeder Runde bereits `/usage` ab — der
  Aufhänger für die Aufzeichnung existiert also schon, es fehlt nur die
  Token-Auswertung daneben.

## Design-Entscheidungen

- **Fenster werden nicht gerechnet, sondern beobachtet.** Claudes
  5-Stunden-Fenster starten mit der ersten Nachricht und laufen dann 5 Stunden
  — sie liegen also *nicht* lückenlos aneinander. Ein Rückrechnen in
  5-Stunden-Schritten ab dem aktuellen Reset-Zeitpunkt würde für ältere
  Fenster falsche Grenzen erfinden. Stattdessen wird zu jedem Messpunkt der
  damals gemeldete `resetsAt`-Wert mitgespeichert; gleiche Reset-Zeit = gleiches
  Fenster. Das ist exakt und kommt ohne Annahme über Lückenlosigkeit aus.
- **Deltas statt Absolutwerten.** Die Token-Tabelle ist pro Session kumulativ,
  mehrere Tabs laufen parallel. Also pro Tab der Differenzbetrag zum letzten
  Lesen — dasselbe Muster, das `refreshUsageDisplay()` für Copilot schon nutzt
  (`_lastUsageTokens`). Beim Wiederaufnehmen einer Session wird der erste
  Messwert als Basislinie übernommen, ohne ihn zu verbuchen (sonst würde der
  gesamte Altbestand einmalig als frischer Verbrauch erscheinen).
- **Eigenes Log, nicht das `costLog` erweitern.** Das Kosten-Log ist auf
  USD-Beträge ausgelegt (`entryUsd`, Kosten-Panel, Migration). Token-Zahlen pro
  Fenster sind eine andere Dimension mit anderer Aufbewahrungslogik; sie dort
  hineinzumischen würde beide Auswertungen verkomplizieren.
- **Kein Rückwirkendes.** Die Liste startet leer. Das wird in der UI benannt,
  statt es als „0 Tokens" auszugeben, was wie ein Fehler aussähe.

## Entscheidung des Nutzers (vor Umsetzung geklärt)

**Nur die Tokenmenge**, kein Prozentwert und kein Kosten-Äquivalent. Die
Darstellung gehört in die bestehende **Kostenübersicht**, nicht auf eine
eigene Seite.

## Tasks

### Task 1: Token-Parser für Claudes `/usage`-Markdown

- [x] `parseClaudeSessionTokens(text)` in `src/renderer-logic.js`: liest die
  `| Breakdown | Tokens |`-Tabelle → `{input, output, cacheRead, cacheWrite}`.
  Liefert `null`, wenn der Block fehlt (alte Adapter-Version, anderes Format)
  — Aufrufer behandeln das wie „keine Daten", nie als Fehler.
- [x] Tests mit echtem Ausgabetext (inkl. Tausendertrennzeichen, fehlender
  Tabelle, leerer Ausgabe).

### Task 2: Aufzeichnung

- [x] Neues Log `claudeTokenLog` (Preference), Einträge
  `{ts, resetsAt, sessionId, input, output, cacheRead, cacheWrite}`.
- [x] In `refreshSubscriptionUsage()` neben `parseUsageWindows` auch
  `parseClaudeSessionTokens` auswerten, Delta zum letzten Stand des Tabs bilden
  und — nur bei positivem Delta — einen Eintrag schreiben.
- [x] Basislinie beim ersten Lesen einer wiederaufgenommenen Session (analog
  `_usageBaselinePending`).
- [x] Obergrenze für die Log-Länge (analog `trimCostLog`).

### Task 3: Auswertung

- [x] `buildTokenWindows(log)` in `src/renderer-logic.js`: gruppiert Einträge
  nach `resetsAt` → je Fenster `{resetsAt, startMs, endMs, input, output,
  cacheRead, cacheWrite, total, firstTs, lastTs}`, absteigend sortiert. Reine
  Funktion, direkt testbar.
- [x] Tests: mehrere Fenster, Einträge ohne `resetsAt`, gleiche Reset-Zeit aus
  verschiedenen Sessions (müssen zusammenfallen).

### Task 4: Anzeige

- [x] Eigener Abschnitt „Claude-Tokens je 5-Stunden-Fenster" auf der
  Kostenseite, unterhalb der Aufschlüsselung.
- [x] Je Zeile: Fensterzeitraum und Tokens gesamt; die Aufteilung nach
  Eingabe/Ausgabe/Cache liegt im Tooltip, um die Zeile schmal zu halten.
  Das laufende Fenster ist als „laufend" markiert.
- [x] Bewusst **nicht** an die Zeitraum-/Provider-Filter der Kostenseite
  gekoppelt: Die Limitfenster sind Claudes eigene 5-Stunden-Blöcke, keine
  Kalenderperioden — eine Überlagerung beider Achsen lädt nur zu Fehllesungen
  ein.
- [x] Leerzustand mit Hinweis, dass die Aufzeichnung erst ab Einbau läuft.
- [x] „Verlauf löschen" (🗑️) leert beide Logs, Beschriftung entsprechend
  angepasst.

### Task 5: Doku

- [x] `docs/USER-GUIDE.md`: kurzer Abschnitt inkl. der Einschränkung, dass
  vergangene Fenster nicht rückwirkend rekonstruierbar sind.

## Nicht im Scope

- Wochenfenster (`Weekly · all models`) — dieselbe Mechanik wäre später leicht
  zu ergänzen, aber gefragt waren die 5-Stunden-Fenster.
- Andere Provider. Copilot rechnet in AI Credits, die Direkt-API-Provider haben
  keine Limitfenster — für die ergibt die Gruppierung keinen Sinn.

## Status

Umgesetzt. 50/50 Suiten, 1789/1789 Tests grün (13 neue für
`parseTokenCount`/`parseClaudeSessionTokens`/`buildTokenWindows`), ESLint
0 Fehler.

**Nicht live gegengeprüft:** Die Aufzeichnung hängt an echten `/usage`-Antworten
einer laufenden Claude-Code-Session; die Parser sind gegen echten Ausgabetext
getestet, der Weg „Delta bilden → buchen → anzeigen" aber nur über die reinen
Funktionen. Erste echte Werte erscheinen nach der nächsten Runde in einem
Claude-Code-Tab.

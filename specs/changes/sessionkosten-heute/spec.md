# Sessionkosten heute

Nutzerfreigabe: 2026-10-13; kein weiteres Spec-Gate.

## Anforderungen

- Rechts oben zeigt jede Session ihre Kosten **heute**, nicht ihren Lebenszeitverbrauch.
- Heute bedeutet lokale 00:00 inklusive bis nächste lokale 00:00 exklusiv;
  Kalendertage dürfen wegen DST 23 oder 25 Stunden haben.
- Gesamtkosten bleiben im Tooltip und in der Kostenübersicht erhalten.
- Copilot verwendet ausschließlich bestätigte CLI-Nano-AIC; keine Tokenpreisschätzung.
- Fehlende zeitliche Zuordnung ist ausdrücklich nicht verfügbar/unvollständig;
  historische Gesamtbuchungen werden nicht als Tageskosten ausgegeben.
- Restore, Resume, Modellwechsel, Tabwechsel, Mitternacht und Aufwachen müssen
  dieselbe Session-/Tagesdefinition verwenden. Keine App-/UI-Tests; Nutzerabnahme.

## Contracts und Zuordnung

`readCopilotUsage(sessionDir)` behält `totalNanoAiu`, `aic`, `usd`, `asOf`
und `entries`. Einträge erhalten entweder `timing: reported` oder
`timing: interval` mit `fromTs` (vorheriger Checkpoint bzw. Sessionstart).
Das bestehende IPC überträgt nur diese Accountingdaten, keine Transkripte.
`pendingUsage` enthält ausschließlich Zeitpunkte noch nicht durch einen
Checkpoint bestätigter Records; solche heutigen Records verhindern eine
fälschliche vollständige Tagesanzeige, ohne Gesamtkosten zu erhöhen.
`incompleteTail` kennzeichnet eine noch nicht vollständig geschriebene letzte
Journalzeile ebenfalls als unvollständig; der bestätigte Gesamtstand bleibt erhalten.

Zeitgestempelte `session.usage_record.data.usage.copilotUsage.totalNanoAiu`
werden nur verwendet, wenn ihre validierte Summe exakt der nächsten
Checkpoint-Differenz entspricht. Accounting-IDs verhindern Dubletten.
`usage.cost`, Tokenzahlen und Preisdetails sind keine alternative Quelle.
Damit geht der erste Tagesverbrauch nach einem Checkpoint am Vortag nicht
verloren und muss auch nicht pauschal dem heutigen Tag zugeschlagen werden.

Fehlen passende Records, zählt eine Differenz nur bei einem vollständig
innerhalb des Tages liegenden Intervall. Positive grenzüberschreitende
Differenzen oder ein erster Gesamtcheckpoint ohne zeitliche Baseline bleiben
unzuordenbar; sicher zugeordnete Teilbeträge stehen dann im Tooltip.
Ein Mitternachtscheckpoint oder heutiger Sessionstart ist eine echte Baseline,
keine künstliche Nullsetzung beim ersten Tagesabruf.

`localCostDay(now)` und `sessionTodayCost(entries, sessionId, provider, now)`
sind gemeinsame reine Renderer-Logik. Andere USD-Provider verwenden ihre
persistierten, zeitgestempelten USD-Einträge für dieselbe Session; bestehende
API-Tokenpreisberechnung bleibt als Näherung gekennzeichnet. Claude-Abos
bleiben Quotenanzeigen, keine erfundene USD-Abrechnung.

Die Anzeige rechnet beim Rendern neu; ein Kalender-Mitternachtstimer und
Fensterfokus aktualisieren auch ohne neue Antwort. Copilot wird dabei neu
gelesen; nach einem Neustart ist das CLI-Journal die persistente Quelle.

## Tatsächliche Grenzen

Checkpoint-only-Intervalle über Mitternacht lassen sich ohne passende echte
Records nicht exakt teilen. Ein noch nicht geschriebener Checkpoint ist nicht
im bestätigten Betrag enthalten (Stand im Tooltip). Direkt-API-Kosten sind
erfasste USD-Schätzungen aus echten Tokenantworten, keine Kontoabbuchungen
und keine vor Installation rekonstruierte Rechnung.

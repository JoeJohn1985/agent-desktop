# Konzept: Claude-Code-Overage-Budget in der Kostenübersicht

Status: **wartet auf ein reales `/usage`-Sample im Overage-Zustand** — bis
dahin nicht umsetzbar, siehe „Blocker" unten. Dieses Dokument hält den
erarbeiteten Stand fest, damit die Umsetzung direkt starten kann, sobald das
Sample vorliegt.

## Ausgangslage

Wenn das Claude-Code-Abo (5-Std.- oder Wochenlimit) erschöpft ist, kann Claude
optional über ein zusätzliches, kostenpflichtiges Budget ("Extra Usage" /
Overage) weiterarbeiten, statt zu blockieren. Der Nutzer möchte diese
Overage-Ausgaben in der bestehenden Kostenübersicht (`renderer/modules/costs.js`,
Tag/Woche/Monat-Chart, siehe `docs/KONZEPT_*` — inzwischen umgesetzt in
1.2.13) sehen.

## Rechercheergebnis (Stand 2026-07-13)

- Das Claude-Agent-SDK kennt eine strukturierte `extra_usage`-Struktur
  (`@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `SDKControlGetUsageResponse.rate_limits.extra_usage`):
  ```ts
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
    currency?: string | null;
  } | null;
  ```
  Das enthält genau das Gewünschte: aktueller Ausgabestand, Limit, Währung.
- **Problem:** Diese strukturierte Antwort kommt nur über die interne
  `get_usage`-Steueranfrage des SDK. Der `@agentclientprotocol/claude-agent-acp`-
  Adapter, den unsere App über ACP anspricht, reicht diese Antwort **nicht**
  durch — wir haben nur Zugriff auf:
  - den Live-Stream (`rate_limit_event` → `_claude/rateLimit`,
    `SDKRateLimitInfo`): enthält `overageStatus`, `isUsingOverage`, aber
    **keinen Betrag**.
  - den Text-Output des `/usage`-Slash-Commands (den wir bereits für die
    Prozentanzeige parsen, siehe `parseUsageWindows()` in
    `src/renderer-logic.js`).
- Ein am 2026-07-13 abgerufenes `/usage`-Sample **ohne aktives Overage**
  enthielt keine Budget-/Overage-Zeile — nur die bekannten
  `Current session/week … % used`-Zeilen. Das exakte Textformat einer aktiven
  Overage-Zeile ist daher noch unbekannt.

## Blocker

Um den Parser zu bauen, brauchen wir ein **echtes `/usage`-Sample, aufgerufen
während das Extra-Budget aktiv genutzt wird** (Abo-Limit bei 100 % *und*
Claude Code arbeitet über das Budget weiter, statt zu blockieren). Ohne dieses
Sample würde der Parser raten müssen — das lehnen wir bewusst ab (gleiches
Vorgehen wie beim Reset-Text-Parser: erst das reale Format sammeln, dann
parsen).

**Wie das Sample zustande kommt:** Der Nutzer nutzt diese App im Alltag für
andere Aufgaben; sobald er regulär ins Abo-Limit läuft (nicht extra
provoziert) und das Extra-Budget aktiv ist, `/usage` ausführen und den
Volltext hier ergänzen bzw. in der Session teilen.

## Geplante Umsetzung (sobald das Sample vorliegt)

1. **Parser erweitern:** `USAGE_LINE_RE`/`parseUsageWindows()` in
   `src/renderer-logic.js` um die Overage-Zeile ergänzen (Feld z. B.
   `{ label, usedAmount, limitAmount, currency, utilization }` — Format hängt
   vom realen Text ab).
2. **Delta-Tracking in den bestehenden Kosten-Log:** `used_credits`/der
   ausgegebene Betrag ist ein kumulativer Monatswert. In
   `refreshSubscriptionUsage()` (`renderer/app.js`) das Delta zum zuletzt
   gesehenen Wert berechnen und per `recordCostEntry(sessionId, sessionName,
   deltaUsd, 'claude-code')` in den bestehenden `costLog` schreiben (gleicher
   Mechanismus wie bei den Direkt-API-Providern). Dadurch taucht die
   Overage-Ausgabe **automatisch** im Tag/Woche/Monat-Chart auf — keine neue
   Chart-Logik nötig.
3. **Budget-Karte auf der Kostenseite:** Eigene Karte/Anzeige für den
   aktuellen Monat (verbraucht/Limit/Prozent), **nur sichtbar, wenn das
   Abo-Limit bereits erreicht ist** (`status === 'rejected'` im
   `formatSubscriptionUsage()`-Ergebnis o. Ä.) — das Erreichen des Limits ist
   der natürliche Anlass, die Darstellung umzustellen (Entscheidung des
   Nutzers vom 2026-07-13).
4. **Tests:** Wie gehabt reine, unit-getestete Parser-/Format-Funktionen in
   `src/renderer-logic.js`, Sample-basiert (analog zu den
   `parseUsageWindows`-Tests mit dem echten `/usage`-Text als Fixture).

## Explizit zurückgestellt

Eine umfangreichere Integration von Claude-Code-Kosten in die Kostenseite
(über die reine Overage-Anzeige hinaus) wird bewusst **nicht** in diesem Zug
mitgemacht — separates Thema für später, erst wenn die Basis
(Overage-Anzeige) steht (Entscheidung des Nutzers vom 2026-07-13).

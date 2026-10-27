# Autokomprimierung im Chatverlauf

## Problem und Ziel
Der Start der automatischen Komprimierung erscheint bisher nur als temporaere
Benachrichtigung. Er soll im zugehoerigen Chat sichtbar nachvollziehbar sein.

## Vorgeschlagene Anforderungen (noch nicht freigegeben)
- Die App SHALL beim Ereignis `session.auto_compaction` mit Status `started`
  einen Systemhinweis im betreffenden Chat einfuegen: Automatische
  Komprimierung gestartet, mit gemeldeter Tokenzahl oder Auslastung.
- Der Hinweis SHALL bei `completed` als abgeschlossen und bei `error`
  als fehlgeschlagen aktualisiert werden, ohne Erfolg vorwegzunehmen.
- Der Hinweis SHALL kein LLM-Prompt sein und keine Tokens durch
  Kontextinjektion verursachen. Hintergrundtabs SHALL nicht aktiviert werden.
- Die bestehende Behandlung von Fehlerbenachrichtigungen SHALL erhalten bleiben.

## Ansatz
Bestehende Wartungsereignisse in `renderer/modules/agent-ipc.js` verwenden.
Vorhandene Systemmeldungs- und Verlaufsspeicherungsmuster pruefen und
wiederverwenden, damit der Hinweis beim Wiederherstellen des App-Verlaufs
erhalten bleibt. Keine Aenderung an Ausloeseschwellen oder Backend-Lebenszyklus.

## Aufgaben nach Freigabe
- [ ] Systemhinweis und Statusaktualisierung in den Chat integrieren.
- [ ] Wiederherstellung und Hintergrundtabs beruecksichtigen.
- [ ] Start, Erfolg und Fehler mit gezielten Tests absichern.
- [ ] Handbuch und Projektstand aktualisieren.

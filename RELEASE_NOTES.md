# Release Notes v0.31.0

## Was ist neu?

### Kosten-Tracking und Credit-Schätzung 💰

Die App berechnet jetzt geschätzte AI Credits aus dem Token-Verbrauch jeder Session:

- **Kostenanzeige in der Session-Leiste**: Zeigt `~12.5C` nach jedem Prompt (berechnet aus Input/Cache/Output-Tokens × Modellpreis)
- **Kosten-Verlauf in den Einstellungen**: Neuer Tab „Kosten" mit gestapeltem Balkendiagramm
  - Umschalter zwischen **Tages-** und **Wochenansicht**
  - Farbcodierte Aufschlüsselung nach Session
  - Gesamtsumme am Ende
  - Verlauf löschen per Button
- Kosten werden dauerhaft gespeichert und sessionübergreifend aufsummiert

> **Hinweis:** Die Berechnung basiert auf Token-Daten aus `/usage`. Da ACP aktuell „AI Units" statt „AI Credits" zurückgibt, wird die Schätzung aus Tokens berechnet. Fällt kein Modellpreis an (z.B. Haiku), wird der AIU-Wert als Fallback angezeigt.

---

### Kontext-Dropdown mit Compact und Clear 📊

Der Kontext-Button wurde zu einem vollwertigen Dropdown ausgebaut:

- **Prozentzahl direkt im Button** (`📊 18%`) — auf einen Blick sichtbar
- **Kontext anzeigen**: Detail-Panel mit Kategorien (System/Tools, Messages, Free Space, Buffer) und Farbcodierung
- **Compact**: Fasst die Konversation zusammen und gibt Kontext frei — %-Anzeige aktualisiert sich danach automatisch
- **Clear**: Löscht den Kontext komplett — folgt automatisch ein `/context`-Abruf für die neue Anzeige

---

### Session-Tools mit automatischem Prozess-Neustart 🔧

Der `🔧 Tools`-Button öffnet ein Popup für session-spezifische Tool-Sperren:

- Tools können per Session gesperrt werden (ergänzend zur globalen Deny-Liste)
- **Automatischer Neustart**: Da ACP `--deny-tool`-Flags nur beim Start akzeptiert, wird der Prozess bei jeder Änderung automatisch neu gestartet und die Session wiederhergestellt — kein Datenverlust

---

## Bug Fixes

- **Mode-Dropdown öffnete sich nach oben** statt nach unten (falscher CSS-Klassenname)
- Credit-Berechnung funktionierte nicht (Modell-IDs enthielten Punkte statt Bindestriche)

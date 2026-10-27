# Diagnose der ausbleibenden Autokomprimierung

Freigegeben am 27.10.2026: Die reale Ursache fuer ausbleibende Verdichtung
bei angezeigten 65 Prozent durch Diagnose der Abschlussereignisse ermitteln.

- [x] Beginn und vollstaendigen Abschluss des Prompt-Aufrufs protokollieren.
- [x] Jeden regulaeren Ausstieg mit Grund, Abschlussstatus, Anzahl offener
  Tools, Clientstatus oder deaktivierter Policy nachvollziehbar machen.
- [x] Wirksame Regel, gemessene Auslastung und Compact-Beginn/-Ende erfassen.
- [x] Keine Prompt-, Antwort- oder rohen Kontexttexte zusaetzlich protokollieren.
- [x] Gezielte Regressionen pruefen (84 Tests erfolgreich; ESLint und Diff-Pruefung ohne Fehler).

Die Diagnose verwendet den bestehenden App-Logger. Die reale Ursache ist
erst nach einem neuen Antwortlauf mit geladenem Diagnosecode feststellbar.
Die Nutzer-App wird nicht automatisch neu gestartet.

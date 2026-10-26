# Kalenderbasierte Wiederholungen

## Problem und Ziel
Das bisherige Zahlenfeld fuer Wiederholungen in Wochen wird durch eine
Auswahl mit passenden Kalender-Steuerelementen ersetzt. Die Berechnung im
Scheduler muss die Auswahl tatsaechlich ausfuehren, nicht nur anzeigen.

## Freigegebene Anforderungen
- Einmalig: Datum und Uhrzeit, keine Wiederholungsfelder.
- Taeglich: waehlbare Wochentage Montag bis Sonntag, standardmaessig alle.
  Damit sind auch Werktage oder einzelne Tage einfach waehlbar.
- Woechentlich: alle N Wochen und waehlbare Wochentage.
- Monatlich: alle N Monate; Tag aus dem vorhandenen Datum/Uhrzeitfeld,
  keine separate Tagesauswahl.
- Jaehrlich: alle N Jahre; Monat und Tag aus dem Datum/Uhrzeitfeld,
  keine separate Monats- oder Tagesauswahl.
- Datumaenderungen aktualisieren beim expliziten Speichern die gespeicherte
  Monats-/Jahresregel. Bereits gespeicherte komplexe Regeln bleiben beim
  Oeffnen unveraendert; das Formular weist auf die Ersetzung beim Speichern hin.
- Nicht existierende Kalendertage werden uebersprungen, nicht in den
  Folgemonat verschoben (z. B. 31. April oder 29. Februar ohne Schaltjahr).
- Startdatum ist die Untergrenze; die Uhrzeit gilt fuer alle Wiederholungen.
- Zeitzone bleibt unsichtbar und intern erhalten. Sommerzeitbehandlung,
  Pausieren und bestaetigtes Nachholen verpasster Termine bleiben erhalten.
- Bestehende einmalige und alle-N-Wochen-Aufgaben behalten ihre Termine
  und werden beim Bearbeiten passend dargestellt.

## Technischer Ansatz
Strukturierte Wiederholungsregel statt ausschliesslich `weeks`.
Validierung, Persistenz, Folgeterminberechnung und Listenbeschreibung im
Scheduler sowie dynamische Formularfelder im Renderer gemeinsam anpassen.
Altdaten verlustfrei lesen; aeltere Wochenregeln nicht neu interpretieren.

## Aufgaben nach Freigabe
- [x] Wiederholungsmodell und Kalenderberechnung implementieren.
- [x] Dynamisches, zugaengliches Formular und Terminbeschreibung erstellen.
- [x] Migration, Monatsenden, Schaltjahre, Sommerzeit, Wochenraster und
      Nachholen sowie Formularwechsel testen.
- [x] Benutzerhandbuch und Projektdokumentation aktualisieren.

## Status
Am 2026-10-16 mit „Ja mach mal“ zur Implementierung freigegeben und umgesetzt.
Am selben Tag ausdruecklich genehmigte Vereinfachung umgesetzt: Monats- und
Jahresregeln werden beim Speichern aus dem aktuellen Datum abgeleitet.
Gezielte Jest-Tests und ESLint erfolgreich; keine App gestartet, keine echten
Modellaufrufe, kein Commit oder Push. Visuelle Abnahme in der laufenden App
bleibt offen.

## Umsetzungsdetails
- Intervalle 1–520, nicht leere Wochentagsauswahlen.
- Wochen beginnen montags; Monats-/Jahresraster bleiben am Start verankert.
- Bestehende komplexe Regeln (mehrere Monate/Tage, letzter Tag) bleiben im
  Scheduler lesbar und ausfuehrbar; die Liste beschreibt die gespeicherte Regel.
- Verlustfreier Altdatenadapter behaelt Wochen-Cursor und Folgetermine bei.
- Start in einer fehlenden Sommerzeitstunde wird weiterhin abgelehnt;
  spaetere betroffene Wiederholung wird nur an diesem Tag um eine Stunde
  verschoben. Eine doppelte Herbststunde erzeugt nur einen Lauf.

# Kompakte Sidebar-Navigation

Ganz oben in der Sidebar stehen das vorhandene App-Icon und „Agent Desktop“.
Darunter folgen „Neuer Chat“ und „Funktionen“ als kompakte, links ausgerichtete
Icon-Text-Buttons in einer gemeinsamen vertikalen Liste.
Keine vollbreiten, durch Trennlinien abgesetzten Schaltflächen; stattdessen
kleine Innenabstände und dezente Hover-, Aktiv- und Tastaturfokus-Zustände.
Angestrebte Zeilenhöhe: 32 Pixel.

Nach Nutzerpräzisierung: Sidebar-Kopf und Tabzeile sind beide 36 Pixel hoch
mit gleichem Hintergrund. Die Navigationsbuttons verwenden wie Project-Sessions
12 Pixel Schrift, Schriftgewicht 500 und Zeilenhöhe 1,4.
App-Name und App-Icon wurden anschließend auf Nutzerauftrag auf 14 Pixel
Schrift beziehungsweise 20 × 20 Pixel verkleinert; die Kopfhöhe bleibt erhalten.

Project, Backlog und Bilder bleiben darunter unverändert.
Fenstersteuerung bleibt in der Tabzeile; die separate Titelleiste kehrt nicht
zurück. Chat-Erstellung und Funktionsnavigation behalten ihre bisherigen IDs
und Aktionen.

Umsetzung: Sidebar-Kopf und Buttonliste in `renderer\index.html`;
gezielte Styles in `renderer\styles.css`. Vorhandenes `assets\icon.png`
wiederverwenden. Prüfung von Reihenfolge, Buttonhöhe und bestehenden Aktionen
in beiden Themes.

Status: Am 2026-10-12 bestätigt und umgesetzt. Gezielte Electron-Prüfungen
für App-Icon, Reihenfolge, 32-Pixel-Buttons und bestehende Navigation erfolgreich.

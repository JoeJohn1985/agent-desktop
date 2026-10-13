# Fenstersteuerung in der Tabzeile

## Ziel

Die separate oberste Titelleiste inklusive App-Name und Icon entfällt.
Minimieren, Maximieren/Wiederherstellen und Schließen stehen rechts in
der Tabzeile. Der frei werdende Platz kommt dem App-Inhalt zugute.

## Anforderungen

- Die App **SHALL** keine separate Titelleiste mehr anzeigen.
- Die Fensterknöpfe **SHALL** rechts in derselben Zeile wie die Tabs stehen
  und auch bei vielen Tabs sichtbar bleiben.
- Der Tabbereich **SHALL** unabhängig von den Fensterknöpfen horizontal
  scrollen können.
- Eine freie Fläche der Zeile **SHALL** das Verschieben des rahmenlosen
  Fensters ermöglichen. Tabs, Plus-Knopf und Fensterknöpfe **SHALL**
  klickbar bleiben und keine Fensterziehflächen sein.
- Vorhandene Fensteraktionen, Tabwechsel, Tab-Reihenfolge, Umbenennung und
  Funktionsseiten **SHALL** erhalten bleiben.
- Fensterknöpfe **SHALL** zugängliche Namen und Tastaturbedienung besitzen.

## Szenarien

- Viele Tabs: Tabs scrollen; alle drei Fensterknöpfe bleiben rechts sichtbar.
- Maximieren: Derselbe Knopf maximiert und stellt das Fenster wieder her.
- Freie Zeilenfläche ziehen: Fenster bewegt sich; Klick auf einen Tab wechselt
  weiterhin den Tab.

## Technischer Ansatz

`renderer\index.html`: Titelleisten-Markup entfernen; eine gemeinsame
Zeilenhülle um `tabBar` und die Fensterknöpfe setzen. Vorhandene Button-IDs
und IPC-Anbindung bleiben bestehen.

`renderer\styles.css`: App auf volle Fensterhöhe setzen, ungenutzte
Titelleistenregeln entfernen, feste Fensterknöpfe und separaten
Tab-Scrollbereich gestalten; Drag-/No-Drag-Flächen explizit setzen.

## Abgrenzung

Keine Änderung des Betriebssystem-Fenstertitels, der Anwendung im
Windows-Taskmanager oder der Backend-/Sitzungslogik.

## Status

2026-10-12: Vom Nutzer bestätigt und umgesetzt. Electron-Prüfung bestätigt
volle App-Höhe, feste Fensterknöpfe bei vielen Tabs, Maximieren/Wiederherstellen
und die CSS-Zuordnung von Drag-/No-Drag-Flächen. Kein Commit oder Push.

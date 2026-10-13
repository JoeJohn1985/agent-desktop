# Rechte Sidebar

Eine zusätzliche rechte Sidebar lässt sich über einen Icon-Button direkt
links neben Minimieren ein- und ausblenden. Der Button bleibt in der Tabzeile
erreichbar und kennzeichnet seinen Zustand mit `aria-expanded`.

Vorgeschlagener Umfang: Backlog als Inhalt, initial geschlossen,
280 Pixel breit. Die Sidebar steht neben dem Hauptinhalt und überdeckt ihn
nicht. Die obere Tabzeile samt Fenstersteuerung bleibt über dem rechten
Inhaltsbereich erhalten. Der verbleibende Hauptinhalt bleibt scrollbar.
Auf Nutzerauftrag wird Backlog aus der linken in die rechte Sidebar verlegt.
Aufgabenliste, Optionsmenü, Projektbezug und bestehende Aktionen bleiben erhalten.
Andere Bereiche bleiben unverändert.
Keine Speicherung des Öffnungszustands über einen App-Neustart hinweg.

Technischer Ansatz: Hauptinhalt und rechtes `aside` unterhalb der gemeinsamen
Tabzeile in einer flexiblen Zeile anordnen; vorhandene Chat-/Funktionsansichten
erhalten. Toggle an die bestehende Renderer-Eventanbindung anschließen.
Themes, Fokusdarstellung und No-Drag-Bedienfläche beachten.

Prüfung ausschließlich statisch beziehungsweise isoliert ohne App-Start:
keine Electron-/UI-Tests. Visuelle Abnahme durch den Nutzer.

Status: 2026-10-12, vom Nutzer bestätigt und umgesetzt. Backlog-Markup und
IDs bleiben erhalten; vorhandene Aufgabenaktionen verwenden dieselben Ziele.
Lint und Diff-Prüfung ohne Fehler, bestehende Lint-Warnung unverändert.
Kein App-Start oder UI-Test; visuelle Abnahme steht aus.

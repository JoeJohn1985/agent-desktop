# Visuelle Abstimmung der Funktionsseiten

## Ziel

Skills, Anbindungen, Plugins und Kostenübersicht sollen eine einheitliche,
kompakte Typografie und konsistente Innenabstände im bestehenden App-Design
erhalten. Vorhandene Komponenten und Theme-Variablen wiederverwenden.
Geplante Aufgaben ist ein eigener Sidebar-Einstieg und nicht Teil dieses Scopes.

## Umfang

- Seitentitel etwa 16 Pixel, Abschnittstitel 14 Pixel, Inhalte und Controls
  12 bis 13 Pixel; Hinweise klar nachgeordnet, aber lesbar.
- Gemeinsames Abstandsraster von 8, 12 und 16 Pixel statt unterschiedlicher
  großzügiger Abstände pro Unterseite.
- Harmonisierung von Seitennavigation, Kopfzeilen, Skill-/Plugin-Karten,
  MCP-Zeilen und Kostenfiltern beziehungsweise Aufschlüsselungen.
- Erhalt von Aktionen, Datenquellen, Diagrammlesbarkeit, Fokuszuständen und
  Scrollbarkeit bei schmalen Fenstern.
- Keine neue Navigation, Backend-Änderung oder Änderung der Kostenberechnung.

## Vorgehen und Freigaben

Der Nutzer erlaubt für diese Aufgabe ausdrücklich Screenshots. Nach
Bestätigung Vorher-/Nachher-Aufnahmen in einer isolierten Ansicht ohne
Live-Prompts, geplante Ausführungen, Anmeldungen oder Änderungen an Nutzerdaten.
Beide Themes und ein schmales Fenster berücksichtigen.
Screenshots im Session-Artefaktordner, nicht im Repository oder Vault ablegen.
Keine bestehende laufende Nutzer-App beenden oder neu starten.

## Status

2026-10-13: Vom Nutzer freigegeben und umgesetzt. Die vier Funktionsseiten
verwenden scoped kompakte Styles auf Basis der bestehenden Komponenten und
Theme-Variablen. Der Präsentationsmarker `functions-view--compact` wird beim
Wechsel zu Geplante Aufgaben entfernt; dessen Layout bleibt unverändert.

## Validierung und Artefakte

- Isolierte Electron-Fixture mit echtem `index.html`, `styles.css` und den
  produktiven Skills-/MCP-/Plugin-/Kosten-/Navigationsrenderern. Keine
  `main.js`-/`app.js`-Initialisierung, kein Backend oder echte Nutzerpräferenzen;
  Testdaten tragen ausdrücklich „Fixture“. HTTP-/HTTPS-Anfragen sind blockiert.
- 16 Vorher- und 16 Nachher-Aufnahmen: alle vier Seiten, Light/Dark, Fenster
  1200 und 760 Pixel breit. Windows-Skalierung beeinflusst die PNG-Abmessungen.
  Vorher-Styles und Navigation stammen aus Commit `153c9ad`.
- Alle Aufnahmen über vier Vergleichsbilder mit `view` tatsächlich angesehen.
  Iteration: Such-/Kostenfilter umbrechen; Canvasbreite scoped begrenzen, damit
  die schmale Kostenansicht nach dem Größenwechsel vollständig sichtbar bleibt.
- Nachher: keine horizontalen Inhaltsüberläufe in den 16 Kombinationen,
  vertikale Scrollbarkeit der langen Skills-/Pluginlisten geprüft, sichtbare
  Tastaturfokus-Outline und exklusive aktive Navigation geprüft.
  Geplante Aufgaben behält 20-Pixel-Titel und `16px 20px` Headerpadding.
- ESLint für die geänderten JS-Dateien erfolgreich; vier gezielte Jest-Suites
  mit 279 Tests erfolgreich; `git diff --check` erfolgreich.
- Artefaktordner:
  `C:\Users\MSchneider\.copilot\session-state\1e1725ad-62f2-4843-97a1-e5d386792bfc\files`
  Einzelbilder: `{before,after}-{skills,connections,plugins,costs}-{light,dark}-{1200,760}.png`.
  Vergleiche: `comparison-{skills,connections,plugins,costs}.png`.
  Messwerte: `before-checks.json`, `after-checks.json`.

Grenzen: kein Live-Backend-, OAuth-, Installations- oder Prompttest; keine
geplante Ausführung. Die bestehende laufende Nutzer-App wurde nicht berührt.
ACP/MCP-Verdrahtung, Kostenberechnung und Datenquellen sind unverändert.

## Folgefreigabe: Geplante Aufgaben

2026-10-13: Der Nutzer hat anschließend auch die visuelle Angleichung der
separaten Ansicht Geplante Aufgaben bestätigt. Sie verwendet nun ebenfalls
den kompakten Präsentationsmarker; die oben dokumentierte frühere Ausnahme
ist damit aufgehoben. Umfang und Prüfgrenzen stehen in
`specs\changes\geplante-aufgaben\proposal.md`.
Für diese Folgearbeit sind kein App-Start, keine Screenshots und keine
Electron-/UI-Tests freigegeben.

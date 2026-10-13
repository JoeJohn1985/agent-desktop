# Zentraler Funktionsbereich

## Problem

Skills und MCP-Server stehen bisher als eigene Sidebar-Listen bereit.
Plugins und Kosten besitzen getrennte Hauptansichten mit unterschiedlichen
Einstiegspunkten. Der Nutzer möchte diese Funktionen zentral erreichen.

## Ziel

Ein Sidebar-Einstieg oberhalb von „Project“ öffnet eine vollflächige
Hauptansicht mit den Unterseiten Skills, Anbindungen, Plugins und Kostenübersicht.
Die Projektnavigation bleibt daneben verfügbar.

## Scope

- In Scope: Navigation, gemeinsame Seitenhülle, Migration bestehender Anzeigen
  und Aktionen, zugängliche Bedienung, Regressionstests und Dokumentation.
- Out of Scope: neue Provider, neue MCP-Protokolle, Änderung der Kostenberechnung,
  Änderung der Gültigkeit von Skills oder automatische globale Skill-Aktivierung.

## Bestätigte Navigation

- Vorgeschlagener Name des Sidebar-Einstiegs: „Funktionen“.
- Skills und MCP-Server entfallen als eigene Sidebar-Bereiche.
- Der bisherige feste Plugins-Tab entfällt zugunsten der Unterseite.
- Beim ersten Öffnen erscheint Skills; weitere Öffnungen verwenden die zuletzt
  besuchte Unterseite innerhalb derselben App-Laufzeit.
- „Übergreifend“ bezeichnet die Navigation, nicht eine neue globale Wirkung
  bisher projekt-, provider- oder tabbezogener Einstellungen.

## Betroffene Bereiche

`renderer\index.html`, `renderer\styles.css`, `renderer\modules\plugins.js`,
`renderer\modules\skills-mcp.js`, `renderer\modules\mcp-manager.js`,
`renderer\modules\costs.js`, `renderer\modules\tabs.js`, `renderer\app.js`,
zugehörige Tests und `docs\USER-GUIDE.md`.

## Status

Vom Nutzer am 2026-10-12 bestätigt und umgesetzt. Die bestehende
MCP-Eingabemaske bleibt als Editor aus der Anbindungen-Unterseite erreichbar.
Spezifikation verbleibt am ursprünglichen Pfad; keine Archivverschiebung
ohne ausdrücklichen Auftrag.

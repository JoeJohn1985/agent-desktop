# Providerbezogene automatische Komprimierung

## Problem und Ziel
Copilot ueberlaesst die automatische Verdichtung bislang der CLI. Andere
Provider verwenden feste App-Schwellen. Die App soll die Verdichtung fuer
unterstuetzte Provider nach abgeschlossenen Antwortlaeufen ausloesen;
Aktivierung und Schwellwert sollen je Provider konfigurierbar sein.

## Scope
Provider-Einstellungen, persistierte Konfiguration, bestehende Kontextanzeige
und Compact-Anbindung, interaktive und geplante Hintergrundsitzungen.
Keine Aenderung der nativen CLI-Komprimierung oder App-/UI-Teststarts.

## Status
Erweiterung am 15.10.2026 erneut bestaetigt: sichtbare Tokens/%-Modellregeln,
Preiswarnung ohne Cap, Sicherheitsabstand als sichtbarer Default und
long_context-Reserve fuer nachweislich unterstuetzte Copilotmodelle.
Die fruehere Ausklammerung der Kontextstufe ist damit aufgehoben.
Keine erneute Abstimmung erforderlich. Kein Modellaufruf zur Verifikation.

Bestaetigt am 14.10.2026: alle Anforderungen, mit aktiviertem Default von
50 Prozent fuer alle Provider. Keine Kontextfenster-Auswahl/ACP-configOptions
und keine App-/UI-Starts, Commits, Subagents oder Vault-Aenderungen.

Umgesetzt: persistierte Provider-Policy, Main-seitige Abschlusskoordination
und isolierte Tests. Bestaetigte Defaults gelten unveraendert fuer alle
Provider; bekannte Grenzen sind im Design und im Benutzerhandbuch dokumentiert.

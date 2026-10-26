# Geplante Copilot-Aufgaben

## Ziel und abgestimmter Umfang

Unter Funktionen entsteht die Unterseite „Geplante Aufgaben“. Aufgaben
enthalten Name, Prompt, Projektordner, Copilot-Modell und Datum/Uhrzeit.
Optionale Wiederholung in ganzen Wochen erlaubt insbesondere alle drei Wochen.
Jeder Lauf arbeitet in einer frischen Copilot-Sitzung im Hintergrund.

Nutzerfestlegungen vom 2026-10-12:
- Automatische Ausführung ausschließlich während die App läuft.
- Verpasste Termine werden niemals automatisch nachgeholt. Die Oberfläche
  erinnert daran und erlaubt Nachholen erst nach ausdrücklicher Zustimmung.
- Projektordner und Modell werden je Aufgabe gespeichert.

## Anforderungen

Die Oberfläche **SHALL** Aufgaben anlegen, bearbeiten, pausieren und löschen
lassen sowie nächsten Termin, verpasste Termine und Ausführungsverlauf zeigen.
Datum/Uhrzeit **SHALL** mit erkennbarer Zeitzone eingegeben werden.
Ungültige Termine, leere Prompts und ungültige Wiederholungsintervalle
**SHALL** sichtbar abgelehnt werden.

Ein fälliger Lauf **SHALL** eine frische Sitzung mit gespeichertem Projektordner
und Modell verwenden, ohne aktiven Chat oder Entwurf zu wechseln.
Aufgaben und Laufzustände **SHALL** dauerhaft gespeichert werden.
Der Scheduler **SHALL** im Main-Prozess laufen, auch bei minimiertem Fenster.
Ein Termin **SHALL** nicht durch mehrere Timer oder Neustarts doppelt starten.
Gleichzeitige Fälligkeiten **SHALL** geordnet verarbeitet werden;
dieselbe Aufgabe **SHALL** nicht parallel mehrfach laufen.

Bei Start oder Aufwachen nach Schlafmodus **SHALL** verpasste Termine sichtbar
gemeldet werden, ohne automatische Ausführung. Bei Wiederholungen **SHALL**
der nächste zukünftige Termin aus dem ursprünglichen Plan berechnet werden.
Nachholen **SHALL** eine explizite Bestätigung verlangen und den regulären
Wiederholungsplan nicht verschieben. Mehrere verpasste Termine **SHALL**
gebündelt angezeigt werden; Nachholen startet einen Lauf, nicht eine Serie.

Fehler, Anmeldung, Nutzerfragen und erforderliche Freigaben **SHALL**
die betroffene Sitzung sichtbar machen und Aufmerksamkeit anfordern.
Bestehende Freigaberegeln **SHALL** gelten; keine automatische Erlaubnis
allein wegen geplanter Ausführung.
Ein erfolgreicher Lauf **SHALL** im Hintergrund bleiben und sein Ergebnis
**SHALL** später aufrufbar sein. Nach einem App-Abbruch **SHALL** ein
unterbrochener Lauf erkennbar bleiben, ohne automatische Wiederholung.
Eine normale Agentenantwort **SHALL** nicht als Beweis einer fachlich
erfolgreichen Wiki-Veröffentlichung dargestellt werden.

## Szenarien

- App läuft: Eine fällige Aufgabe startet einmal, der aktive Chat bleibt erhalten.
- App war geschlossen: Erinnerung erscheint; erst Bestätigung startet Nachholen.
- Drei-Wochen-Aufgabe verpasst: Erinnerung bleibt; nächster regulärer Termin
  bleibt am ursprünglichen Wiederholungsraster.
- Anmeldung/Freigabe erforderlich: Sitzung wird zugänglich und fordert Eingriff.
- App beendet sich während eines Laufs: Verlauf zeigt Unterbrechung statt Erfolg.

## Technischer Ansatz

Persistenter Task-/Laufstore und Scheduler im Main-Prozess, neue IPC-Bridge
für Verwaltung und Laufereignisse. Bestehenden Copilot-ACP-Lifecycle,
MCP-Brücken, Modellwahl und Berechtigungsmechanismus wiederverwenden.
Renderer-Unterseite unter Funktionen; Hintergrundsitzungen dürfen nicht
über den bisherigen automatisch aktivierenden Tab-Erstellungspfad starten.

Der ältere Entwurf `plans\task-automation.md` ist nicht freigegeben und
enthält abweichenden Scope (Dateitrigger, tägliche Termine, Renderer-Timer).
Für dieses Arbeitspaket gilt diese Spezifikation: keine Dateitrigger,
kein Windows-Dienst und keine automatische Nachholung.

## Freigabe und Umsetzung

Vorgeschlagen: einmalige Termine und Wiederholung alle N Wochen;
lokale Zeitzone bei Anlage speichern, gleiche lokale Uhrzeit über
Sommer-/Winterzeit hinweg beibehalten.

Status: Umfang am 2026-10-12 ausdrücklich freigegeben und implementiert.
Einmalige Termine oder alle N Wochen, lokale Zone gespeichert. Wiederholungen
in einer nicht existierenden Sommerzeitstunde werden für diesen Termin um
eine Stunde verschoben; das ursprüngliche Raster bleibt erhalten.
Visuelle Abnahme bleibt beim Nutzer; keine App-/Electron-/UI-Tests durchgeführt.

## Freigegebene visuelle Angleichung (2026-10-13)

Die separate Sidebar-Ansicht wird an die bereits überarbeiteten Funktionsseiten
angeglichen: Seitentitel 16 px, Abschnittstitel 14 px, Inhalte/Controls 12–13 px
und konsistente Abstände von 8, 12 und 16 px. Das Formular ist semantisch in
„Aufgabe & Prompt“, „Zeitplan“ und „Copilot-Einstellungen“ gegliedert.
Bestehende `settings__*`-/`action-btn`-Komponenten und Theme-Variablen werden
wiederverwendet; Aufgabenliste und Verlauf einschließlich dynamischer Buttons,
Statuszeilen, Hinweise und Leerzustände folgen denselben Styles.
Schmale Fenster, lange Inhalte und sichtbarer Tastaturfokus werden berücksichtigt.

IDs, Feldnamen, Events, Scheduler, Nachholen, manuelle Freigaben und
Sitzungsöffnung bleiben unverändert. Vorhandene uncommittete Änderungen an
Funktionsseiten, täglichen Sitzungskosten und Sidebar-Höhen bleiben erhalten.
Keine App starten, keine Screenshots, keine Electron-/UI-Tests. Prüfung nur
über isolierte Logiktests, Lint und Diff-Check; visuelle Abnahme bleibt offen.
Kein Commit oder Push. Vault-Pflege liegt beim Elternagenten.

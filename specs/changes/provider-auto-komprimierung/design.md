# Design

## Erweiterung 15.10.2026 (ersetzt widersprechende Erstannahmen unten)

Gemeinsame reine Policy-Aufloesung fuer Renderer und Main. Bestehende
Provider-Prozente werden nicht migriert. Neue Copilot-Policies markieren
modellabhaengige Defaults explizit (`modelDefaults`); `models` speichert
sichtbare Einheit und Zahl je Modell. Offizielle Preisquelle liefert nur
Default und Warnhinweis, niemals eine zweite wirksame Cap.
Renderer fragt dieselbe offizielle Preismap wie Main ab (kein abweichender
statischer Preisfallback). Keine Schreibzugriffe beim Oeffnen/Modellwechsel.
UI bei Modell/Reasoning in vorhandenen Settings-Klassen.

Native aktuelle Kontext-Tokens und Kapazitaet werden getrennt von
Abrechnungssummen ausgewertet. Prozentregeln bleiben ohne belegbares Fenster
preislich unbestimmt; Tokenregeln werden ohne aktuelle Tokenmessung uebersprungen.

ACP-Start fordert fuer alle Modelle long_context (groesstes Fenster) an; CLI
1.0.98 faellt bei Modellen ohne groesseres Fenster still auf den Standard
zurueck (GPT-5.3-Codex: 272k, 16.10.2026). Keine hardcodierte Fenstergroesse,
das tatsaechliche Fenster kommt aus /context. Modellwechsel braucht keinen
Neustart; nur Reasoning-Wechsel nutzt den Pre-Prompt-Neustart.
Changelog 1.0.95 bestaetigt Flag-Anwendung bei neuen und geladenen ACP-Sitzungen.
Details zu Belegen und Verifikationsgrenzen in verification.md.

Bestehende Provider-Einstellungsoberflaeche und persistierte Settings erweitern.
Gemeinsame validierte Provider-Policy statt fester verteilter Schwellen nutzen.

Gemeinsame Koordination in src/auto-compaction.js auf Main-Ebene. Alle
sendAgentPrompt-Aufrufer (interaktiv und geplant) laufen ueber dieselbe Queue.
Das Streaming-IPC-ACK bleibt frueh, die Queue bleibt jedoch bis zum Aufloesen
des vollstaendigen prompt-Promise plus Wartung reserviert. Fruehes ACP
agent_turn_end/done reicht nicht fuer den Ausloeser. Offene Tools,
Abbruch und fehlgeschlagene Prompt-Abschluesse blockieren den Lauf.
Korrektur 27.10.2026: Antworttext, vorherige Freigabe-/Frage-/Auth-Signale
und einzelne Werkzeugfehler sperren erfolgreiche Antwortlaeufe nicht.
Fehler oder Aufmerksamkeit waehrend der Wartungsbefehle bleiben abgesichert.

Vorhandene /context- und /compact-Anbindungen wiederverwenden. Je Sitzung
exklusiv mit Prompts und stillen Befehlen koordinieren. Nach Compact Kontext
erneut abfragen; keine Erfolgsaussage ohne geprueftes Befehlsergebnis.
Native /context-Prozentangaben oder frische reine usage_update.used/size
gelten als Auslastung. Keine Copilot-Modellfenstertabelle und keine
Kontextfenster-Auswahl/configOptions-Erweiterung. Direkte APIs verwenden
gemeldete Prompt-Tokens und ihre bestehenden providerinternen Fenstermetadaten.
Fehlende Tokens/Fenster sind unbekannt, nicht 0 %. Nach API-Verdichtung ist die
Auslastung bis zur naechsten gemessenen Anfrage ebenfalls unbekannt.

settings.autoCompaction[provider] = { enabled, thresholdPercent }; fehlende
Provider haben aktiviert/50 als Default. UI und Preferences-Schreibpfad
validieren 1..95/ganzzahlig und boolean. Persistenzfehler sind sichtbar.
OpenAI-kompatible Provider und Gemini erhalten reale toolfreie
Zusammenfassungsanfragen statt des bisherigen No-op-Compact; alle API-Provider
behalten bei leerer/abgeschnittener Zusammenfassung ihre alte Historie.
Toollimit und nichtregulaere Stopgruende sind keine erfolgreichen Laeufe.

session.context_updated aktualisiert die Anzeige; session.auto_compaction
meldet Start, Abschluss, expliziten Skip oder Fehler. Fehler stehen auch im
geplanten Lauf und dessen Historie; erfolgreiche Wartung aktiviert kein Fenster.
Stille Command-Abschluesse werden vom Ausloeser ignoriert; keine Wiederholung
innerhalb eines Laufs. Stop sperrt laufende Pruefung und wartende Prompts.

Risiken: Provider unterscheiden sich in Kontextereignissen und Slash-Support.
Die Abschlussentscheidung beruht auf dem Backend-Lebenszyklus, nicht auf
einer heuristischen Interpretation der fachlichen Aufgabenerledigung.
Die native Copilot-CLI kann weiterhin waehrend einer Aufgabe verdichten;
die App kann diese Garantie nur fuer ihren eigenen Ausloeser geben.

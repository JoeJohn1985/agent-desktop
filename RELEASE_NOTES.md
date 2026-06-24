# Release Notes v0.32.0

## Was ist neu?

### Mehrere LLM-Provider — Anthropic API direkt nutzen 🔌

Neben der GitHub Copilot CLI kann jetzt **pro Tab** die **Anthropic-API direkt** verwendet werden — mit vollem Agent-Funktionsumfang.

- **Provider-Auswahl** in der Session-Leiste (`🔌 Provider`): Umschalten zwischen *GitHub Copilot* und *Anthropic API* (Gemini/OpenAI sind vorbereitet). Das Modell-Dropdown zeigt nur die Modelle des gewählten Providers.
- **Voll agentisch**: Das API-Backend führt eine eigene Tool-Schleife aus — lesen/schreiben/bearbeiten von Dateien und Shell-Befehle (unter Windows über PowerShell), inkl. Streaming und adaptivem Thinking.
- **Sichere API-Keys**: Neuer Einstellungen-Tab „API-Provider". Keys werden über den OS-Schlüsselbund verschlüsselt gespeichert und verlassen den Hauptprozess nie.
- **Projekt-Kontext**: Skills, Agents und `copilot-instructions.md` werden als (gecachter) System-Prompt mitgegeben.
- **Prompt-Caching**: Der wachsende Verlauf wird zwischengespeichert → deutlich geringere Kosten bei langen Sessions.
- **Kontext-Management**: Auslastungsanzeige in Prozent und **automatisches Verdichten** ab 80 %.
- **Session-Wiederaufnahme**: Verlauf wird gespeichert und beim erneuten Öffnen wieder angezeigt; das Gespräch läuft mit vollem Kontext weiter.
- **Exakte Kosten**: Direkt-API liefert echte Token-Zahlen (inkl. Cache-Write zu 1,25× Input) statt Schätzung.

> **Hinweis:** Für die Anthropic-API wird ein eigener API-Key benötigt (Einstellungen → API-Provider).

---

## Bug Fixes

- **Copilot-Antworten brachen nach 60 s mit „Code 1" ab und liefen dann scheinbar endlos weiter**: Längere agentische Turns liefen in ein festes 60-Sekunden-Timeout des `session/prompt`-Requests — die Anzeige blieb auf „Running" hängen, obwohl die CLI noch arbeitete. Der Turn hat jetzt kein künstliches Timeout mehr (begrenzt durch Stop-Button und Prozess-Ende).

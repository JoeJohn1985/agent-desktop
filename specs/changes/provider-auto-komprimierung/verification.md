# Verifikation der Erweiterung, 15.10.2026

## CLI und Quellen (ohne Modellaufrufe)

- Installierte CLI meldet **1.0.98**, nicht mehr 1.0.97.
- `copilot --help`: `--context default|long_context`, ueberschreibt persistierte
  Einstellung. Globale Konfiguration wurde nicht geaendert.
- Offizieller Changelog:
  https://github.com/github/copilot-cli/blob/main/changelog.md
  - **1.0.95 (09.10.2026)**: `--context` gilt fuer neue UND geladene ACP-Sitzungen
    statt stillschweigend die Default-/gespeicherte Stufe zu benutzen.
  - **1.0.93 (07.10.2026)**: long_context beim Start beachten, korrekte
    Kontextfreigabe in `/context` anzeigen.
- Offizielle Preisquelle:
  https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml
  GPT-6.1 Sol: Preisstufe **>272000 Eingabe-Tokens pro Aufruf**, nicht
  aufsummierte Sessiontokens. Parser `src/pricing-source.js` bleibt Quelle.

## Begrenzte ACP-Probe

Nur eigens gestartete CLI-Prozesse; initialize, session/new,
session/get_config_options, session/set_config_option und lokales `/context`.
Keine normalen Prompts, kein `/compact`, keine Modell-/Tarifmessung,
kein Electron/App/UI-Start, keine existierenden Prozesse gestoppt.

- initialize bestaetigt Copilot 1.0.98.
- session/new mit GPT-6.1 Sol + long_context erfolgreich.
- configOptions: mode, model, reasoning_effort, allow_all. Keine Kontextstufe,
  keine belegbaren Fensterwerte oder modellbezogene Long-context-Capabilities.
- session/get_config_options: **-32601 Method not found**.
- session/set_config_option(contextTier): **-32602 Unknown config option**.
- Neue Default- und Long-context-Sitzungen: `/context` meldet, dass der
  Agentkontext erst nach einer Nachricht verfuegbar ist. Daraus wurden KEINE
  Fenstergroessen abgeleitet. Ein direktes erneutes Laden derselben live
  geladenen Sitzung meldet "already loaded"; die unbenutzte Sitzung ist nach
  Prozessende nicht als gespeicherte Unterhaltung ladbar ("Resource not found").
  Wiederherstellungsverhalten ist deshalb hier ueber den oeffentlichen
  1.0.95-Changelog belegt, nicht durch eine neue kostenpflichtige Unterhaltung.

## Vorbestehende Messung und Grenzen

Vom Auftrag uebernommene fruehere Messung: GPT-6.1 Sol Default **272000**,
long_context **922000**, gleiche costPerBatch bei ca. 13800 Inputtokens.
Diese Messung wurde NICHT wiederholt und ist kein neu erhobenes Testergebnis.
Keine dieser Fenstergroessen steht im neuen Trigger als Modellkonstante.

Automatische Reserve wird fuer gemessenes GPT-6.1 Sol angefordert.
Fuer weitere Modelle akzeptiert die Implementierung explizit angebotene
contextTier/context_tier-Optionen mit long_context. Die aktuelle ACP-Antwort
liefert das nicht: eine vollstaendige unterstuetzte Modellliste ist damit
weiterhin **nicht belegbar**. Unbestaetigte Modelle werden nicht blind
ueberschrieben. Diese Grenze ist auch in den sichtbaren Settings beschrieben.

## Defaults und Migration

- Keine gespeicherte Policy + offizielle Preisstufe272000: sichtbar240000Tokens.
- Andere Preisstufe: 88 Prozent, auf Tausender abgerundet.
- Ohne Preisstufe:50Prozent. Vorhandene Prozent-/Aktivierungswerte bleiben.
- Positive ganze Tokenwerte ueber Preisgrenze sind erlaubt; sichtbare Warnung,
  keine zusaetzliche interne Preis-Cap. Prozentregel warnt bei unbekanntem
  Fenster vorsorglich und mit tatsaechlichem Fenster bei der Abschlusspruefung.
- Derselbe Main-Pfad fuer interaktive, Hintergrund- und geplante Sitzungen.
- App-Trigger nur nach Antwortlauf/Tools; native CLI-Verdichtung unveraendert.
  Ein einzelner Task und die Verdichtungsanfrage koennen teurer werden.

## Isolierte automatisierte Pruefung

11 Jest-Suites, 550 Tests bestanden: Auto-Compaction-Koordinator, Policy/UI-
Persistenz, ACP (inklusive Reserve-Spawn und beidseitigem Modellwechsel mit
Session-Load vor Prompt), direkte API, Providerverdichtung, strikter Session-
Store, Planung/Integration, Pricing-Parser und strukturelle Integritaet.
Neue Tests decken Token-Grenzen 239999/240000/300000, erlaubte 500000er-
Usergrenze ohne versteckte272000-Cap, Warnungen, lokale Zahlenformate,
Legacy-/Modellmigration und fehlende Tokenmessung ab.

Gezieltes ESLint:0Fehler,9bereits vorhandene Warnungen in main.js und
acp-client.test.js. `git diff --check`: erfolgreich.
Keine Abhaengigkeiten installiert oder Manifeste geaendert.

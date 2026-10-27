# Long Context: redundante Modellsetzung vermeiden

Status: vom Nutzer freigegebene gezielte Fehlerbehebung, 2026-10-27.

## Reproduktion

Isolierte ACP-Probe mit CLI 1.0.104, GPT-6.1 Sol, `--context
long_context`, Reasoning low, drei minimale Modellanfragen:

1. Neue Sitzung ohne `set_model`: `/context` meldet 23k/922k (2%).
2. `session/set_model` auf dasselbe Modell: Kontext zunächst unbekannt;
   nach nächster Minimalanfrage 23k/272k (8%).
3. Neuer Prozess mit identischem Flag, Resume ausschließlich der Testsitzung:
   vor Anfrage unbekannt, nach Anfrage 23k/922k (2%).

Damit ist der Kontextreset durch redundantes `set_model` belegt. Die
Sitzungsantwort bietet model/mode/reasoning_effort/allow_all, aber keine
Kontexttier-Konfigurationsoption an. Keine erfundene ACP-Kontext-API verwenden.

## Anforderungen

- Das von Copilot in new/load bestätigte Modell als bereits angewendet merken.
- Bei abweichendem oder unbekanntem Modell weiterhin explizit setzen.
- Nicht-Copilot-Adapter und echte Modellwechsel nicht stillschweigend ändern.
- Die bestehende `/context`-Auswertung soll den belegten Sol-Standardfenster-
  Rückfall sichtbar melden; keine zusätzlichen Modellanfragen.
- Bestehende Auto-Compaction-Schwellen unverändert lassen.
- Tests für new/load, unbekanntes/abweichendes Modell und Adapterabgrenzung.

## Freigegebene Erweiterung: echte Modellwechsel

Bestätigt am 2026-10-27: Echte Copilot-Modellwechsel verwenden den bestehenden
Reasoning-Neustart vor dem nächsten Prompt, niemals während einer Anfrage.
Neuer Prozess: neues `--model`, `--context long_context`, dieselbe Session laden,
kein anschließendes `session/set_model`. Identische Modelle starten nicht neu;
gleichzeitige Reasoning-/Modellwechsel benötigen nur einen Neustart. Andere
Provider bleiben unverändert. CWD, Optionen, MCP und History bleiben erhalten.
Fehlende oder widersprüchliche Modellbestätigung nach diesem Resume wird als
Fehler gemeldet, nicht durch kontextzurücksetzende Modellsetzung repariert.

Isolierter vorliegender Test mit CLI 1.0.104 bestätigt Modellübernahme beim
Load: Sonnet 5.5 `/context` 936k, zurück Sol 922k. ACP usage (Sonnet 872k)
ist eine andere Messquelle. Keine weiteren Live-Anfragen für die Umsetzung.

## Grenze

Das Startflag garantiert kein tatsächliches Providerfenster. Die vorhandene
Laufzeitwarnung bleibt erhalten und macht gemessene Rückfälle sichtbar.

## Validierung

- Zusätzlich zwei Minimalanfragen mit dem echten korrigierten `AcpClient`:
  neue Sitzung 23k/922k (2%), isolierter Resume derselben Testsitzung ebenfalls
  23k/922k (2%). Insgesamt fünf echte Modellanfragen, keine Tools angefordert.
- Nutzer-App und Nutzersitzungen unverändert, nur eigene Prozesse beendet.
- Artefakte: Sessionordner `files\long-context-acp-probe*` und
  `files\long-context-fixed-client-*`; keine Rohlogs im Repository.
- 181 gezielte Jest-Tests (ACP, Kontextoberfläche, Auto-Compaction) erfolgreich;
  Diffprüfung erfolgreich; ESLint ohne Fehler, sechs bestehende
  ungenutzte Variablen in der ACP-Testdatei als Warnungen.

### Erweiterungsvalidierung

- 213 Tests in ACP, Auto-Compaction, Session-Actions und Main-Helfern erfolgreich.
- Fake-ACP prüft verzögerten Modellneustart, identische Auswahl,
  kombinierten Reasoningwechsel, Session/CWD/MCP-Startoptionen, kein set_model,
  unveränderte andere Adapter und Wiederverwendung bestehender MCP-/Approval-
  Neustarts. Fehlende/falsche Modellbestätigung und Loadfehler senden keinen
  Prompt; ein Loadfehler ersetzt die History nicht durch eine neue Sitzung.
- Gezielter ESLint: keine Fehler, neun vorhandene Warnungen. Diffprüfung
  erfolgreich. Keine neuen Live-Modellanfragen, Nutzer-App unverändert,
  kein Commit oder Push.

# Design

Gemeinsamer begrenzter Parser und kompakte App-Anweisung. ACP nutzt den
vorhandenen unsichtbaren systemContext-Block pro Prompt (keine erneute
Injektion nativer Skills/Agents). API-Provider erhalten die Anweisung im
Systemtext, Gemini einschließlich seines kontextarmen Modus.

Renderer speichert Rohtext an finalisierten Bubbles, ersetzt nur valide
Blöcke und rekonstruiert beantworteten Zustand anhand folgender Nutzernachrichten.
Historienprojektion berücksichtigt auch noch nicht ins DOM geladene Antworten.
Echte Buttons mit textContent; keine Modell-HTML-Ausführung.
Sendeweg erhält optionale explizite Antwortdaten, bricht bei Tabwechsel ab.

OpenAI-kompatible restaurierte Systemtexte werden in einer Laufzeitkopie um den
Vertrag ergänzt (einmalig, native Originaldaten bleiben unverändert).
Native Rückfragetools werden bevorzugt, Tool-Kommentare nicht als Buttons
aktiviert. Bei fehlender/verdichteter Historie und SSH ohne lokale Vorschau ist
keine vollständige Rekonstruktion möglich; kein zusätzlicher Verlaufsspeicher.

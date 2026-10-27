# Requirements

- SHALL nur einen expliziten abschließenden `agent-desktop-question`-JSON-Fence
  mit `question` und 2–6 eindeutigen `options` erkennen; begrenzte Strings.
- SHALL ungültige/unvollständige Blöcke und normale Listen unverändert zeigen.
- SHALL Buttons erst nach erfolgreichem vollständigem Antwortlauf aktivieren.
- SHALL den bestehenden Sendeweg im Ursprungstab nutzen, Doppelklick und
  Tabwechsel während asynchroner Prüfungen absichern.
- SHALL jede folgende Nutzerantwort alte Optionen deaktivieren; passende
  Antwort markieren. Rekonstruktion aus Verlauf ohne native Datenänderung.
- SHALL kleine App-Instructions bei allen Providerpfaden wirksam einbinden,
  auch bei laufenden/resumierten ACP-Sessions ab nächstem Prompt.

Szenarien: gültiger Block → Frage/Buttons; Liste oder defektes JSON → Text;
Streaming/Abbruch → keine aktiven Buttons; Freitext → deaktiviert;
Historie mit Folgeantwort → bleibt deaktiviert; gelöschter Tab → kein Versand.

# Anforderungen

## Bestaetigte Erweiterung 15.10.2026
- REQ-10: Copilot SHALL modellbezogene sichtbare Eingaben mit Einheit Tokens/%
  anbieten. Alle wirksamen App-Schwellen SHALL diesen Eingaben entsprechen,
  ohne versteckte Preis-Cap. Bestehende individuelle Prozentwerte bleiben erhalten.
- REQ-11: Ohne gespeicherte Policy SHALL ein Modell mit offizieller Preisstufe
  einen sichtbaren Token-Default mit Sicherheitsabstand erhalten: 240000 bei
  272000, sonst abgerundete 88 Prozent der Preisgrenze. Ohne Preisstufe: 50 %.
- REQ-12: Eine Eingabe oberhalb der Preisgrenze SHALL erlaubt bleiben und sichtbar
  vor steigenden Kosten warnen. Prozentregeln SHALL mit dem tatsaechlich
  gemeldeten Sitzungsfenster verglichen werden, nicht einem angenommenen Fenster.
- REQ-13: Fuer alle Copilotmodelle SHALL immer das groesste Kontextfenster
  (long_context) angefordert werden. Das Flag ist eine Anforderung, kein Beleg
  fuer ein groesseres Fenster; massgeblich ist /context.
- REQ-14: Einstellungen SHALL oben bei Modell/Reasoning stehen und die vorhandenen
  settings__label/input/select/toggle-Stile verwenden. Dieselben Policies SHALL
  auch fuer Tab-Modellwechsel und geplante Aufgaben gelten.

REQ-10/11 ergaenzen REQ-1/2: die alten 50-%-Defaults gelten weiterhin fuer
Modelle ohne Preisstufe sowie bereits gespeicherte Prozent-Policies.

- REQ-1: Die App SHALL Aktivierung und ganzzahligen Schwellwert von 1 bis 95
  Prozent pro unterstuetztem Provider in dessen Einstellungen speichern.
  Ungueltige Werte SHALL sichtbar abgewiesen werden.
- REQ-2: Als bestaetigte Defaults SHALL alle unterstuetzten Provider aktiviert
  mit 50 Prozent verwendet werden. Vorhandene Werte SHALL erhalten bleiben.
- REQ-3: Die App SHALL nur nach regulaer abgeschlossenem Antwortlauf pruefen
  und bei Auslastung groesser oder gleich Schwellwert verdichten.
  Ein Antwortlauf umfasst alle zugehoerigen Werkzeugaufrufe, nicht einzelne
  Nachrichten oder Tool-Ergebnisse.
- REQ-4 (korrigiert 27.10.2026): Laufende, abgebrochene oder als Ganzes
  fehlgeschlagene Antwortlaeufe SHALL nicht automatisch verdichtet werden.
  Nach erfolgreichem Abschluss des gesamten Prompt-Aufrufs SHALL weder der
  Antworttext noch vorherige Freigaben, Rueckfragen oder einzelne
  Werkzeugfehler die Pruefung verhindern. Noch offene Tools bleiben gesperrt.
- REQ-5: Die Regel SHALL fuer Hintergrundtabs und geplante Sitzungen gelten,
  ohne erfolgreiche Hintergrundlaeufe in den Vordergrund zu holen.
- REQ-6: Pruefung, Compact und Kontextaktualisierung SHALL serialisiert sein.
  Neue Prompts SHALL nicht mit einer Verdichtung kollidieren. Wiederholte
  Abschlussereignisse oder Compact-Abschluesse SHALL keine Schleife ausloesen.
- REQ-7: Bei unbekannter Auslastung SHALL keine Verdichtung erfolgen.
  Fehler SHALL sichtbar gemeldet und protokolliert werden; automatische
  Wiederholung innerhalb desselben Antwortlaufs SHALL nicht erfolgen.
- REQ-8: Native CLI-Komprimierung und manuelles Compact SHALL erhalten bleiben.
  Die Konfiguration steuert nur den zusaetzlichen App-Ausloeser.
- REQ-9: Copilot-Auslastung SHALL ausschliesslich aus Backend-Angaben stammen,
  niemals aus einem fest angenommenen Modellfenster. Fehlende Werte SHALL
  explizit als unbekannt behandelt und die Pruefung uebersprungen werden.

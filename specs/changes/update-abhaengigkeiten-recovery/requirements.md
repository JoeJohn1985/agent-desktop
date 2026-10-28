# Anforderungen

- Jedes explizite Update/Repair SHALL nach sauberem Git-Checkout und ff-only Pull
  npm install ausführen, unabhängig von HEAD- oder Manifeständerungen.
- npm-Fehler und fehlgeschlagene Nachprüfung SHALL non-ok liefern und keinen
  Neustart auslösen. stdout und stderr sollen bei Fehlern sichtbar sein.
- Ein manueller Updatecheck SHALL auch ohne Remoteänderung Repair anbieten.
- Nachprüfung SHALL den installierten erforderlichen Dependencygraph mit npm
  sowie statische Runtime-Imports ohne Ausführung der Module prüfen.
- Unvollständige Installationen benötigen bei bereits nicht startender App eine
  dokumentierte manuelle Reparatur. Vollständige Dateiintegrität oder erfolgreicher
  Appstart werden durch diese Prüfungen nicht garantiert.

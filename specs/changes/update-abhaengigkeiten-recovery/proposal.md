# Update-Abhängigkeiten-Recovery

Freigegebener Bugfix: Ein erfolgreicher Pull mit anschließend fehlgeschlagenem
npm install darf nicht als startbereites Update gelten. Wiederholung muss auch
ohne neue Commits reparieren. Keine Rollbacks, Datenänderungen oder CLI-Updates.

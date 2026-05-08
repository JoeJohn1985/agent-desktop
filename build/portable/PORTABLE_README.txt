Copilot Desktop - Portable Edition
===================================

WAS IST DAS?
------------
Ein eigenstaendig lauffaehiges Bundle von Copilot Desktop fuer Windows.
Keine Installation, keine Admin-Rechte, kein zusaetzlicher Server noetig.
Einzige Voraussetzung: Ein GitHub-Account mit Copilot-Subscription.

ERSTSTART
---------
1. Diese ZIP-Datei in einen Ordner Deiner Wahl entpacken
   (z.B. C:\Tools\copilot-desktop\).
2. Doppelklick auf "start.bat".
3. Beim ersten Start oeffnet sich ein Browser-Fenster mit dem
   GitHub-Login. Folge den Anweisungen.
4. Danach wird die "gh-copilot"-Extension automatisch installiert.
5. Anschliessend startet die Copilot-Desktop-Oberflaeche.

NORMALE NUTZUNG
---------------
Einfach "start.bat" doppelklicken. Login und Extension werden uebersprungen,
sobald sie einmal eingerichtet sind.

UPDATE
------
1. Neue ZIP-Datei herunterladen.
2. Alten Ordner loeschen (oder umbenennen) und die neue ZIP entpacken.
3. "start.bat" doppelklicken - Login bleibt erhalten, weil er im
   Benutzerprofil unter "%APPDATA%\GitHub CLI\" liegt.

DEINSTALLATION
--------------
1. Ordner mit dem Bundle loeschen.
2. Optional: "%APPDATA%\GitHub CLI\" loeschen, um die GitHub-Login-Daten
   zu entfernen.
3. Optional: "%USERPROFILE%\.copilot\" und "%USERPROFILE%\.copilot-desktop\"
   loeschen, um App-Einstellungen und Sessions zu entfernen.

WO LIEGEN MEINE DATEN?
----------------------
- Login          : %APPDATA%\GitHub CLI\
- App-Settings   : %USERPROFILE%\.copilot-desktop\
- Sessions/Skills: %USERPROFILE%\.copilot\
- Logs (Launcher): %LOCALAPPDATA%\copilot-desktop\logs\

FEHLER?
-------
1. In "%LOCALAPPDATA%\copilot-desktop\logs\" liegt fuer jeden Start eine
   Log-Datei (start-YYYYMMDD-HHMMSS.log).
2. Die juengste Log-Datei beim Support-Ticket mitschicken.

SICHERHEIT
----------
Beim ersten Start kann Windows SmartScreen warnen, weil das Bundle nicht
codesigniert ist (interne GEBIT-Verteilung). "Weitere Informationen" ->
"Trotzdem ausfuehren" ist hier akzeptabel, da das Bundle aus dem internen
GitHub-Repository kommt.

VERSION
-------
Siehe Datei VERSION.txt im selben Ordner (wird vom Release-Workflow
automatisch erzeugt).

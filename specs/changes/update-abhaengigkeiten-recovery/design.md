# Design

Immer installieren statt Marker-/Manifest-Heuristik: Ein Retry kann niemals den
Installationsschritt überspringen. npm ls prüft Versionen und erforderliche
transitive Abhängigkeiten; createRequire.resolve prüft statische externe
require/import-Spezifizierer aus main.js, preload.js und src ohne Modulimporte.
Optionaler Dependencygraph wird nicht als erforderlich behandelt; explizite
Runtime-Imports bleiben prüfpflichtig. npm wird wie bisher über PATH ausgeführt,
nicht über Electrons execPath. Daher kein belegter Anlass, die bestehende
ELECTRON_RUN_AS_NODE-Umgebung zu verändern. --no-save verhindert eigene
Manifest-/Lockänderungen, die einen Retry am Clean-Tree-Schutz blockieren würden.
Kein automatischer destruktiver Rollback. Repair bleibt über manuellen Check
zugänglich. Bestehende Main-IPC startet ausschließlich bei ok neu.

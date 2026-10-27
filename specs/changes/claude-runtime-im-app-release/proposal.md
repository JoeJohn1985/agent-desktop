# Claude-Runtime mit dem App-Release

## Problem
Normale Nutzer erhalten keine neuen Claude-Adapterversionen: Updates sind
entwicklerexklusiv und lokale Versionspraeferenzen uebersteuern den Standard.

## Freigegebener Ansatz
- Die App SHALL eine exakt versionierte, gemeinsam mit der App gepruefte
  Claude-ACP-Runtime einschliesslich benoetigter SDK-Abhaengigkeiten ausliefern.
- Normale Nutzer SHALL diese Release-Version automatisch mit dem App-Update
  erhalten, ohne Entwickleroptionen oder manuelles Adapterupdate.
- Alte gespeicherte Adapterversionen SHALL im normalen Betrieb die
  Release-Version nicht mehr blockieren.
- Entwickler MAY abweichende Versionen explizit testen. Solche Overrides
  SHALL nur im Entwicklermodus gelten und als Abweichung sichtbar sein.
- Es SHALL kein unabhaengiges automatisches Update auf npm-latest erfolgen.
- Laufende Claude-Prozesse SHALL nicht mitten im Gespraech ausgetauscht werden.
- Lokale Paketierung/Startpfade und native Abhaengigkeiten SHALL geprueft werden.
  SSH-Ausfuehrung SHALL gesondert behandelt werden: dort kann die lokale
  gebuendelte Runtime nicht direkt ausgefuehrt werden.

## Aufgaben nach Freigabe
- [x] Bestehende Runtime-, Versions-, Build- und SSH-Pfade untersuchen.
- [x] Neue konkrete Adapter-/SDK-Version auswaehlen und Kompatibilitaet pruefen.
- [x] Exakte Abhaengigkeiten und Paketierung/Startpfade verdrahten.
- [x] Alt-Praeferenzen und explizite Entwickler-Overrides sauber unterscheiden.
- [x] Update-/Neuinstallations-/Starttests und Dokumentation aktualisieren.

## Status
Vom Nutzer am 2026-10-27 freigegeben („Ja das passt.“), implementiert.
Adapter 0.97.0 / Claude Agent SDK 0.3.310 / native CLI 2.1.310.
Prüfumfang und Grenzen: [validation.md](validation.md).

## Laufzeitvertrag
- `package.json` ist die Release-Versionsquelle, `package-lock.json` bindet den
  Dependency-Baum inklusive nativer optionaler Pakete.
- Lokaler Start: Electron als Node (`ELECTRON_RUN_AS_NODE=1`), physischer
  Adapter-Einstieg ohne Shell oder npx. Alle Produktions-Dependencies liegen
  außerhalb des asar; `afterPack` prüft Adapter, SDK und Zielplattform-Binary.
- `claudeCodeAdapterVersion` wird nie ausgewertet. Nur
  `settings.devMode === true` plus `claudeCodeAdapterDeveloperVersion` aktiviert
  einen expliziten Override. Auswahl und Release werden in Provider-Einstellungen
  angezeigt. Eingabe der Release-Version setzt den Override zurück.
- Overrides werden per npx-`initialize` geprüft und betreffen nur neue Prozesse.
  Keine automatisch angewandten Registryupdates, kein Session-Abbruch.
- SSH verwendet dieselbe ausgewählte exakte Paketversion auf dem Remotehost
  via npx, benötigt dort Node ≥22 und ggf. Netzwerk. Keine lokale Offline-Zusage.
  Kein Remotehost wurde für die Umsetzung angesprochen oder geändert.
- Login/Logout und Authstatus verwenden die gebündelte native CLI. Eine separat
  installierte System-Claude-Version wird weder gesucht noch aktualisiert.

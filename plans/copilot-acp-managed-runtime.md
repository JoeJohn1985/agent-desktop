# Plan: App-verwaltete Copilot-CLI fuer ACP

Datum: 2026-10-07
Status: Neu zu bewerten; ACP bleibt; SDK-Wechsel ausgeschlossen; nicht implementiert
Projekt: Agent Desktop

## Verbindlicher Stand (2026-10-07, 12:06 CEST)

- ACP bleibt die Copilot-Anbindung des Agent Desktop.
- Eine Umstellung auf Copilot SDK ist vom Nutzer ausdruecklich
  ausgeschlossen. Laut Nutzer lief die App bereits ueber das SDK und
  hatte damit andere Probleme. Deren konkrete Art ist hier nicht erhoben
  und darf nicht rekonstruiert werden.
- Aktuelle, fuer das Konto verfuegbare Modelle muessen erhalten bleiben.
  Ein funktional einschraenkender CLI-Downgrade ist nicht freigegeben.
- Die unten stehenden SDK- und Downgrade-Arbeitspakete sind historische,
  nicht auszufuehrende Vorschlaege.
- Ein SDK-Test oder eine SDK-abhaengige MCP-/OAuth-Loesung gehoert nicht
  zum aktuellen Auftrag.

## Neue Untersuchungsrichtung (2026-10-07, 12:12 CEST)

Der Nutzer fordert eine Loesung ausserhalb der betroffenen
Copilot-ACP-OAuth-Verarbeitung, bei unveraenderter ACP-Anbindung
und aktuellen Modellen. Die erneute allgemeine Eingrenzung der
bereits reproduzierten Runtime-Regression ist nicht der priorisierte
Loesungsansatz.

**Konkreter Vorschlag, noch nicht implementiert oder live verifiziert:**
Eine lokale stdio-MCP-Bruecke uebernimmt die Remote-HTTP-Verbindung
und OAuth. Die aktuelle Copilot CLI verbindet sich nur zum lokalen
MCP-Prozess; die Modellkommunikation zwischen App und CLI bleibt ACP.
Eine solche Bruecke kann ohne Copilot SDK betrieben werden.

`mcp-remote` ist ein zu pruefender bestehender Kandidat:
https://github.com/geelen/mcp-remote
Seine Dokumentation beschreibt stdio zu Remote-MCP, OAuth,
persistente Autorisierung und HTTP/SSE-Transporte. Ein eigener
OAuth-Client muss nicht vorschnell neu implementiert werden.

Die lokal gepruefte CLI 1.0.92 dokumentiert
`--disable-mcp-server` und `--additional-mcp-config` fuer den
jeweiligen Lauf. Dies eroeffnet einen prozesslokalen Vergleich,
belegt aber noch nicht dessen korrekte Anwendung im ACP-Modus.

- [ ] Mit aktueller CLI einen isolierten ACP-Test aufsetzen, in dem
      nur die betroffenen nativen Remote-Server fuer diesen Prozess
      deaktiviert und Bridge-Server zusaetzlich konfiguriert werden.
      Keine globale MCP-Konfiguration aendern.
- [ ] Konfigurationsprioritaet und Servernamen explizit pruefen:
      derselbe Ausschluss darf nicht auch die Bridge ausschliessen.
      Bei Aliasnamen Auswirkungen auf Toolfilter, Custom Agents,
      Skills und gespeicherte Berechtigungen pruefen.
- [ ] Einen gepflegten, veroeffentlichten Bridge-Stand exakt binden;
      Dokumentation des Hauptzweigs nicht als Funktionsnachweis
      fuer jede Paketversion verwenden. Kein `npx @latest` beim Tabstart.
- [ ] Token-Persistenz, Windows-Dateischutz beziehungsweise
      Credential-Speicher, Refresh und koordinierte parallele
      Anmeldungen pruefen. Kein ungeprueftes Kopieren bestehender
      Copilot-Tokens und keine Secrets in Prozessargumenten.
- [ ] Eine legitime erste Autorisierung des separaten Clients kann
      notwendig sein. Automatische Installation bedeutet nicht,
      dass eine neue OAuth-Zustimmung entfallen darf.
- [ ] Echte Miro-/GEBIT-Tool-Aufrufe nach Prozessneustart und bei
      mehreren Tabs testen, einschliesslich Fehler-/Widerrufsfaellen.
- [ ] Moderne Modelle mit derselben aktuellen CLI tatsaechlich verwenden;
      keine SDK- oder Runtime-Migration aus diesem Test ableiten.
- [ ] Protokolltransparenz pruefen: Tools, Ressourcen, Prompts,
      Aenderungsbenachrichtigungen, Elicitation, Abbruch und
      serverseitige Fehler. Keine Scheinerfolge oder verlorenen
      Berechtigungs-/Zustimmungsanfragen.
- [ ] Erst nach erfolgreichem Vergleich die App-Integration,
      automatische Bereitstellung und Statusanzeige ausarbeiten.

**Abgrenzung:** Das waere eine Umgehung der fehlerhaften
Remote-OAuth-Strecke, keine Reparatur des CLI-Bugs und kein blosses
Unterdruecken von Browserfenstern.

## Bisheriger allgemeiner Diagnosevorschlag (nicht priorisiert)

Der vorherige Vorschlag war: Mit aktueller
CLI die Unterschiede zwischen Terminal- und ACP-Authentifizierung weiter
eingrenzen: Laufzeit/Umgebung, verwendeter Credential-Speicher, Auswahl
vorhandener Anmeldung sowie Challenge-/Refresh-/Reconnect-Verhalten.
Keine Tokens loeschen oder uebertragen, keine Browserfenster nur
unterdruecken und keinen neuen Architekturumbau ohne Abstimmung beginnen.
Ein lokal wirksamer Fix innerhalb dieser Grenzen ist noch nicht bekannt.

## Neue verbindliche Randbedingung (2026-10-07, 12:01 CEST)

Der Nutzer bewertet den moeglichen Verlust aktueller Modelle durch eine alte
CLI als No-Go. Die Loesung muss die aktuell fuer das Konto verfuegbaren
Modelle erhalten. Die nachfolgenden Arbeitspakete zur 1.0.88-Bindung sind
damit ein bisheriger Vorschlag, kein freigegebener Implementierungsauftrag.
Ein Verlust konkreter Modelle mit 1.0.88 wurde bislang nicht getestet;
die dokumentierten spaeteren Modellergänzungen begruenden das Risiko.

App-verwaltete Laufzeiten und automatische Bereitstellung bleiben als
Installationskonzept sinnvoll. Nicht akzeptiert ist ein Workaround, der
zugunsten von OAuth auf eine alte, funktional einschraenkende Runtime
zurueckgeht oder deren Aktualisierung dauerhaft verhindert.

## Historischer SDK-Untersuchungsvorschlag (seit 12:06 CEST ausgeschlossen)

**Nicht ausfuehren; durch die Nutzerentscheidung oben ausgeschlossen.**
Der bisherige Vorschlag war: Zuerst die offizielle
SDK-/CLI-Server-Integration mit einer aktuellen Runtime isoliert gegen
denselben ACP-Fall pruefen. Das SDK spricht JSON-RPC zum Runtime-Server,
nicht das bestehende ACP-Protokoll. Sein dokumentierter Runtime-OAuth-Flow
uebernimmt Discovery, PKCE, Persistenz, Refresh und Reconnect.
Da derselbe Runtime-Kern verwendet werden kann, ist eine Behebung des
OAuth-Fehlers durch den Transportwechsel nicht garantiert.

- [ ] Verfuegbare veroeffentlichte SDK-Version und passende aktuelle
      Runtime bestimmen; APIs aus dem Repository-Hauptzweig nicht
      ungeprueft als installierte Release-Funktionen voraussetzen.
- [ ] Mit vorhandener Anmeldung und unveraenderter MCP-Konfiguration
      aktuelle Runtime ueber SDK-/Server-Modus starten. Mehrere neue
      Sitzungen, Prozessneustart und parallele Sitzungen vergleichen.
- [ ] Modellangebot gegen die aktuelle direkte CLI vergleichen und
      die benoetigten neuesten Modelle wirklich fuer einen Prompt verwenden.
      Nur eine Liste von Modellnamen ist kein Verfuegbarkeitsnachweis.
- [ ] Miro und GEBIT/Jira mit echten lesenden Tool-Aufrufen verwenden,
      einschliesslich Wiederverwendung gueltiger Anmeldung und
      legitimer erneuter Anmeldung bei Ablauf/Widerruf.
- [ ] SDK-Ereignisse auf die bestehende Backend-/Renderer-Schnittstelle
      abbilden: Streaming, Toolaktivitaet, Berechtigungen, Abbruch,
      Modell/Effort, Session-Resume und Subagents.
- [ ] Native Nutzerkonfiguration und Unternehmensrichtlinien erhalten;
      keine eigenen Tokens in Session-Prompts oder Logs weiterreichen.
- [ ] Erst nach erfolgreichem Vergleich einen separaten SDK-Backend-Plan
      freigeben. Claude-Code-ACP und andere Provider nicht mit migrieren.

Wenn auch die SDK-Strecke betroffen ist, zwei weitere Wege bewerten:

1. Eine upstream korrigierte aktuelle Runtime verwenden und denselben
   Fehler reproduzierbar beim Hersteller belegen. Keine unbelegten
   lokalen Patches am geschlossenen Runtime-Kern.
2. MCP/OAuth appseitig verwalten und Tools ueber dokumentierte
   SDK-Host-Schnittstellen bereitstellen. Das erfordert eigene
   Credential-Persistenz, Refresh, Callback-Validierung,
   parallele Anmeldekoordination und serverbezogene Zustandsanzeigen;
   deutlich groesserer Umfang als ein Transportwechsel.

**Abbruchkriterium:** Kein SDK-Umbau allein auf Grundlage der Annahme,
der OAuth-Fehler sei ACP-spezifisch. Aktuelle Modelle und reale MCP-Aufrufe
muessen zusammen nachgewiesen sein.

## Bisheriger Vorschlag zur Managed-ACP-Laufzeit

## Ziel

Agent Desktop verwendet eine von der App freigegebene Copilot-CLI unabhaengig
von der globalen Terminal-Installation. Ein normales App-Update mit Neustart
stellt die Laufzeit automatisch bereit. Nutzer muessen keine CLI installieren,
keinen Programmpfad setzen und keine Daten migrieren.

Die Versionsbindung ist ein zeitweiliger Workaround fuer das nachgewiesene
ACP-OAuth-Problem, keine dauerhafte Bindung an eine veraltete CLI. Spaetere
App-Releases koennen eine neuere, vollstaendig gepruefte Laufzeit ausliefern.

## Verifizierte Ausgangslage

- Die direkte CLI kann Miro und GEBIT/Jira verwenden. Neue ACP-Sitzungen mit
  1.0.92 oeffnen dagegen erneut die OAuth-Seiten.
- Isolierter Vergleich am 07.10.2026: 1.0.88, 1.0.92, nochmals 1.0.88;
  jeweils `--no-auto-update --acp`, derselbe Arbeitsordner, dieselbe
  Umgebung und `mcpServers: []`. Beide 1.0.88-Laeufe verbinden GEBIT und
  Miro ohne Browser. 1.0.92 oeffnet fuer beide die Anmeldeseite.
- Die MCP-Konfigurationsdatei blieb unveraendert. Der Authentifizierungsspeicher
  wurde nicht manuell geaendert; interne CLI-Aktualisierungen sind nicht
  ausgeschlossen. Die Testprozesse sind beendet.
- Die komplette App-Nutzung, Modellaufrufe, Subagents und die Wiederaufnahme
  vorhandener Sitzungen mit 1.0.88 sind noch nicht geprueft.
- `main.js` startet Copilot ueber den festen Befehl `copilot`. Versionsanzeige,
  MCP-Konfigurationsabfrage und Login verwenden ebenfalls die globale CLI.
- `src/acp-client.js` erzeugt die Copilot-Startargumente und verwaltet die
  Sitzungsanlage, Wiederaufnahme und Prozessneustarts.
- `src/updater.js` aktualisiert `origin/main`, installiert bei geaenderten
  Paketmanifesten mit npm und laesst die App anschliessend neu starten.
  Aktuell verwaltet er keine eigene Copilot-CLI.
- Der Checkout enthaelt bereits uncommittete Anpassungen an `main.js`,
  `docs/USER-GUIDE.md`, `__tests__/acp-client.test.js` und
  `__tests__/integrity.test.js`. Diese sind zu erhalten und zu integrieren.

## Vorgeschlagene Umsetzung

### Offizielle CLI als exakt gebundene App-Abhaengigkeit

Die bevorzugte Variante ist eine exakte Abhaengigkeit auf `@github/copilot`
mit passendem `package-lock.json`, zunaechst mit 1.0.88 als
Kompatibilitaetskandidat. Die offiziellen plattformspezifischen
Native-Pakete sollen ueber npm bereitgestellt werden.

Das nutzt den bestehenden Installations- und Updateweg statt eines eigenen
HTTP-Downloaders, Archivformats oder zweiten Updatekanals. Paketintegritaet
und Version werden ueber den Lockfile nachvollziehbar festgelegt.

Vor Umsetzung pruefen: Die offizielle Paketaufloesung muss auf den
unterstuetzten Plattformen den tatsaechlichen nativen Einstiegspunkt liefern;
es darf kein Wrapper verwendet werden, der unbemerkt auf eine andere
CLI-Version aktualisiert. Fehlende optionale Native-Pakete sind explizite
Bereitstellungsfehler, kein Anlass fuer einen stillen PATH-Fallback.

### Ein zentraler Laufzeit-Resolver

Ein kleines Modul, beispielsweise `src/copilot-runtime.js`, liefert
Programmpfad, feste Startargumente, gewaehlte Version und Herkunft
(`app-managed` oder explizit `system`).

- Standard fuer normale Nutzer: app-verwaltete, freigegebene Version.
- Kein eigener OAuth-Client und keine kopierten Tokens in der App.
- Kein neues `COPILOT_HOME` und keine separate Nutzerkonfiguration.
- Keine Veraenderung von PATH, globaler CLI oder Terminal-Installation.
- `--no-auto-update` bei allen app-verwalteten CLI-Aufrufen.
- Native Programme ohne Shell starten; bestehende Shell-/Shim-Behandlung
  nur fuer die ausdruecklich gewaehlt globale Laufzeit erhalten.
- Gleiche Umgebung und gleicher Profilzugriff wie bisher, insbesondere
  bestehende Authentifizierung, Unternehmensrichtlinien und Arbeitsordner.
- Eine optionale Experteneinstellung `managed`/`system` dient dem bewussten
  Rueckwechsel. Nutzer muessen sie nicht bedienen; sie ist kein Installations-
  oder Update-Schritt. Kein beliebiger Versionspicker oder eigener
  Paketmanager im ersten Umfang.

Die App-Release-Abhaengigkeit bestimmt die freigegebene Managed-Version.
Ein spaeterer Versionswechsel geschieht durch ein normales App-Update.

### Bereitstellung und Fehlerverhalten

Vor dem ersten Copilot-Start pruefen, ob das erwartete Native-Paket vorhanden
ist und `--no-auto-update --version` die freigegebene Version meldet.
Parallel startende Tabs teilen dieselbe Vorbereitung; die Electron-UI
darf dabei nicht blockieren.

Npm-Download, fehlgeschlagene Installation, falsche Architektur und
Versionsabweichungen werden klar als Laufzeitfehler angezeigt. Keine
automatische Rueckkehr zur bekanntermassen problematischen globalen CLI.
Andere Provider bleiben nutzbar.

Falls die offizielle Paketaufloesung unter Electron keinen verlaesslichen
nativen Start erlaubt, zuerst die eng begrenzte Alternative pruefen:
offizielles, exakt gebundenes Native-Paket direkt referenzieren. Einen eigenen
Downloader nur nach dokumentierter Notwendigkeit planen.

## Arbeitspakete

### 1. Kompatibilitaet vor produktiver Versionswahl pruefen

- [ ] Offizielle Paketstruktur, Plattformmatrix und nativen Einstiegspunkt
      nachvollziehen; keine Abhaengigkeit auf lokale Scoop- oder
      Sitzungsordner.
- [ ] Mit 1.0.88 einen echten Agent-Desktop-Copilot-Tab starten.
- [ ] Modellangebot und benoetigte Modelle gegen das aktuelle Konto pruefen.
- [ ] Prompt, Streaming, Tool-Ausfuehrung und Berechtigungsdialoge pruefen.
- [ ] Bestehende und neu angelegte Sitzungen wiederaufnehmen.
- [ ] Modell-/Modus-/Effort-Wechsel sowie Neustart mit gesperrten Tools pruefen.
- [ ] Benoetigte Custom Agents, Subagents, `/context` und Kompaktierung pruefen.
- [ ] Miro und GEBIT/Jira vor und nach App-Neustart ueber reale lesende
      Tool-Aufrufe verwenden; nicht nur `tools/list` oder Handshake zaehlen.
- [ ] Mehrere Copilot-Tabs parallel starten; keine erneute OAuth-Seite bei
      weiterhin gueltiger Anmeldung, keine Rueckgabe alter Toolkataloge
      als scheinbar funktionierende Verbindung.

**Release-Gate:** 1.0.88 erst produktiv freigeben, wenn die benoetigten
App-Funktionen funktionieren. Andernfalls Kompatibilitaetsgrenzen benennen und
den Plan vor einem automatischen Downgrade erneut abstimmen.

### 2. Paketbindung und Resolver einfuehren

- [ ] Exakte offizielle CLI-Abhaengigkeit und Lockfile mit npm pflegen.
- [ ] Zentralen Resolver einschliesslich tatsaechlicher Versionspruefung,
      Plattformaufloesung und paralleler Vorbereitungsanfragen erstellen.
- [ ] Managed-Modus standardmaessig verwenden; expliziten System-Modus
      optional in den bestehenden Praeferenzen hinterlegen.
- [ ] Beim System-Modus klar anzeigen, dass die globale Installation und
      deren Updateverhalten gelten.
- [ ] Bei fehlender/falscher Runtime einen handlungsfaehigen Fehler mit
      Wiederholmoeglichkeit anzeigen; keine Credentials oder Tokens loggen.

### 3. Alle Copilot-Oberflaechen konsistent verdrahten

- [ ] ACP-Start in `main.js` und Argumentaufbau in `src/acp-client.js`.
- [ ] Sitzungsanlage, Wiederaufnahme, Fallback sowie alle Prozessneustarts.
- [ ] Versionsanzeige und Provider-Status: aktive App-Runtime anzeigen,
      nicht versehentlich die Version auf PATH.
- [ ] `copilot mcp list --json` fuer Sidebar und Workspace-Erkennung
      ueber denselben Resolver ausfuehren; Cache bei Runtime-Wechsel
      invalidieren.
- [ ] GitHub-Login aus der App mit derselben Runtime starten; interaktive
      Anmeldung bleibt bei fehlender/abgelaufener Autorisierung notwendig.
- [ ] CLI-Verfuegbarkeitspruefung und bestehende Provider-Onboardingpfade.
- [ ] Built-in-Skills aus der aktiven CLI-Laufzeit aufloesen, nicht aus
      dem zufaellig neuesten globalen Paketcache. Vorhandene oeffentliche
      CLI-Schnittstellen bevorzugen.
- [ ] Unterstuetzte Modelle und Funktionen aus der aktiven Runtime lesen.
      Nicht verfuegbare gespeicherte Modelle sichtbar behandeln; kein
      stiller Wechsel auf ein anderes Modell.
- [ ] `mcpServers: []` fuer Copilot erhalten; keine erneute redundante
      Konfigurationsuebergabe und keine selbstgebauten OAuth-Umgehungen.
- [ ] Claude Code, SSH, API-Provider und globale Terminal-CLI unveraendert lassen.

### 4. In den vorhandenen App-Updateweg integrieren

- [ ] Der bestehende Manifestvergleich soll die neue CLI-Abhaengigkeit
      automatisch ueber npm installieren.
- [ ] Vor Erfolgsmeldung und App-Neustart das erwartete Native-Paket und
      seine Version pruefen. Ein erfolgreicher npm-Aufruf allein reicht
      wegen optionaler Plattformpakete nicht.
- [ ] Dieselbe Pruefung fuer Erstinstallation und spaetere Starts nutzen.
- [ ] Download-/Installationsfehler sichtbar melden und keinen
      ungeprueften Runtime-Wechsel ausloesen.
- [ ] Ausdruecklich pruefen, wie die App nach einer fehlgeschlagenen
      Installation wieder startbar wird. Der heutige Git-/npm-Updater
      garantiert keinen atomaren Rollback des gesamten Checkouts;
      dieses Verhalten nicht unbelegt versprechen.
- [ ] Bestehende Regeln fuer sauberen Git-Checkout erhalten; keine fremden
      lokalen Aenderungen verwerfen.
- [ ] Aenderung regulaer versionieren und auf dem Updatekanal veroeffentlichen.
      Eine nur lokale Codeaenderung wird nicht automatisch an Nutzer verteilt.

**Nutzerablauf:** App-Update ausloesen, die App laedt die erforderliche
Abhaengigkeit automatisch, prueft sie und startet neu. Kein zusaetzlicher
CLI-Installationsschritt, keine Pfadauswahl und keine Neuinstallation.

### 5. Regressionstests und Freigabe

- [ ] Resolvertests: korrekter Pfad/Version, Architektur, fehlendes Paket,
      expliziter System-Modus, konkurrierende Starts und Versionsabweichung.
- [ ] `__tests__/acp-client.test.js`: Runtime und `--no-auto-update`
      bleiben bei allen Start-/Neustartwegen erhalten; andere Provider
      bekommen das Flag nicht.
- [ ] `__tests__/integrity.test.js`: App-Verdrahtung, native
      MCP-Konfiguration, Version/Status/Login/Sidebar konsistent.
- [ ] `__tests__/updater.test.js`: Manifestwechsel, Native-Paket fehlt,
      Versionspruefung scheitert, erfolgreicher Update-Neustart.
- [ ] Bestehende Praeferenzen ohne Datenmigration laden; alte Sitzungen,
      Skills, Anmeldungen und Projekte erhalten.
- [ ] Update von einem sauberen Checkout der vorherigen App-Version
      auf einem System mit anderer globaler CLI testen.
- [ ] Erstinstallation ohne globales `copilot` testen; fuer die App ist
      die Managed-Runtime vorhanden, die Terminal-Installation bleibt
      optional und wird nicht heimlich angelegt.
- [ ] Globales `copilot --no-auto-update --version`, PATH und
      MCP-Konfiguration vor/nach dem Update vergleichen.
- [ ] Windows x64 live pruefen; weitere bereits unterstuetzte Plattformen
      vor deren Release absichern, nicht unbelegt als kompatibel ausweisen.
- [ ] Kleinste passende Jest-Suite und bestehendes ESLint ausfuehren;
      bei Bedarf auf die betroffenen Integrationspruefungen erweitern.

### 6. Dokumentation und spaeteres Entpinnen

- [ ] `docs/USER-GUIDE.md`: automatisch bereitgestellte App-Runtime,
      Abgrenzung zur Terminal-CLI, Versionsanzeige und expliziter Rueckwechsel.
- [ ] Release Notes: Grund der vorlaeufigen Versionsbindung und belegte
      Kompatibilitaetsgrenzen, keine Zusage neuer Modelle in 1.0.88.
- [ ] Projektstatus und Aenderungsverlauf im Obsidian-Vault aktualisieren.
- [ ] Upstream #4994 beobachten und neuere Kandidaten mit denselben
      realen MCP-/Sitzungspruefungen freigeben.
- [ ] Nach bestaetigtem Fix die App-Abhaengigkeit per normalem Release
      aktualisieren; kein manuelles Upgrade bei Nutzern erforderlich.

## Abnahmekriterien

1. Ein normales App-Update stellt die freigegebene CLI automatisch bereit,
   selbst wenn PATH auf eine andere Copilot-Version zeigt.
2. Agent Desktop meldet und startet dieselbe tatsaechliche Laufzeitversion.
   Ihr Auto-Update kann die App-Bindung nicht umgehen.
3. Miro und GEBIT/Jira funktionieren mit gueltiger vorhandener Anmeldung
   nach Neustart und in mehreren Tabs ohne erneute OAuth-Seiten.
4. Echte Erstanmeldung, abgelaufene oder widerrufene Autorisierung bleiben
   moeglich und werden nicht unterdrueckt.
5. Daten, globale CLI, native MCP-Konfiguration und andere Provider bleiben
   erhalten; kein administrativer Installationsschritt und keine Migration.
6. Fehler werden sichtbar gemeldet; keine falsche Erfolgsmeldung und kein
   stiller Wechsel auf die problematische globale Runtime.
7. Benoetigte Modelle, Session-Resume, Subagents und Berechtigungen sind
   nachgewiesen oder eine Einschraenkung wurde vor dem Release abgestimmt.

## Risiken und Grenzen

- 1.0.88 enthaelt spaetere Modellunterstuetzung und Fehlerkorrekturen nicht:
  GPT-6 Sol/Luna und Claude Opus 5.5 kamen laut Changelog in 1.0.89,
  GPT-6.1 Sol in 1.0.90. Auch ACP-, MCP-, Sandbox- und Subagent-Korrekturen
  fehlen. Ein OAuth-Erfolg allein reicht nicht zur produktiven Freigabe.
- Neuere und aeltere CLI koennen denselben Nutzerzustand verwenden.
  Vollstaendige Rueckwaertskompatibilitaet der Sitzungsdaten ist nicht
  bewiesen; sie darf nicht durch eine destructive Migration ersetzt werden.
- Paketdownloads benoetigen Netzwerkzugriff und koennen durch Proxy,
  Richtlinien oder Virenschutz blockiert sein. Die UI muss den Unterschied
  zwischen Bereitstellungsfehler und OAuth-Fehler erklaeren.
- Eine Managed-Runtime verhindert Versionsdrift, behebt aber keine
  serverseitigen Tokenwiderrufe oder Fehler in dieser Runtime.
- Das Unterdruecken von Browserfenstern ohne funktionierende Anmeldung
  waere kein Fix.

## Vergleich mit anderen Harnesses

### GitHub Copilot app

Die offiziellen Docs bestaetigen, dass die App auf Copilot CLI aufbaut
und vorhandene CLI-/Repository-MCP-Konfigurationen verwendet. Eine konkrete
interne ACP-Anbindung oder die verwendete Cache-Key-Implementierung ist
damit nicht belegt.

Ein aehnlicher Fehler ist im App-Issue #1936 dokumentiert: OAuth gelingt,
Tokens werden nach Neustart nicht gefunden und Tools erscheinen nicht
wieder. Das Issue ist geschlossen; der Release-Bot nennt v1.1.11 als Fix.
Der Bericht vermutet instabile Cache-Schluessel durch variable Redirect-Ports;
das ist keine bestaetigte Erklaerung des implementierten Fixes.
Die geprueften Release-Notizen zu v1.1.11 nennen unter anderem einen Fix
fuer MCP-Anmeldungen, die am Ladeindikator haengen, aber keinen konkreten
Cache-Key- oder Token-Persistenz-Patch fuer #1936. Der genaue technische
Fix ist in den untersuchten oeffentlichen Quellen nicht offengelegt.
Dies ist auch nicht der Nachweis, dass unsere spaetere ACP-Regression #4994
ebenfalls behoben ist.

Das offene App-Issue #4390 beschreibt am 02.10.2026 erneut einen Unterschied
zwischen Windows-App und funktionierender CLI fuer Entra-MCP. Der Bericht
nennt eine gebuendelte App-Runtime 1.0.90-0 gegen eine separate 1.0.92-0.
Das ist eine Nutzermeldung und ein anderer Authentifizierungspfad, keine
bestaetigte Ursache fuer Miro oder GEBIT.

Das offizielle Copilot SDK bietet eine alternative Integrationsstrecke:
JSON-RPC zum CLI-Server, automatische Prozessverwaltung und bei Node.js,
Python und .NET eine gebuendelte CLI-Abhaengigkeit. Ein SDK-Wechsel kann
den ACP-spezifischen Pfad vermeiden, ist aber kein belegter OAuth-Fix und
waere ein separates Integrationsprojekt, nicht Teil dieses Workarounds.

### Hermes Agent / Hermes Desktop von Nous Research

Hermes verwaltet Remote-MCP ueber den MCP-Python-SDK-basierten OAuth-Client
selbst: Discovery, PKCE, Tokenaustausch und Refresh. Die Docs nennen einen
persistent serverbezogenen Cache unter `~/.hermes/mcp-tokens/` und stille
Wiederverwendung. Damit liegt diese MCP-Anmeldung nicht im fehlerhaften
Copilot-ACP-Client.

Der dokumentierte Desktop-/Katalog-Setupflow speichert die neue Verbindung
erst nach akzeptiertem Token und erfolgreicher erster Verbindung.
Er trennt "Authorized. Tools unavailable." von einer fehlenden Anmeldung.
In diesem Setupflow oeffnet der Nutzer die Anmeldeseite bewusst. Andere
erste HTTP-MCP-Verbindungen koennen laut derselben Dokumentation den
Browser automatisch oeffnen; ein universelles Browserverbot ist nicht belegt.

Hermes Desktop und CLI verwenden denselben Agent-Kern und denselben
Nutzerzustand. Die Desktop-Pakete buendeln Agent, Python und Abhaengigkeiten;
der Pakettyp bestimmt den Updateverantwortlichen. Das verhindert nicht
alle OAuth-Bugs, reduziert aber unkontrollierte Abhaengigkeit von einer
global installierten fremden CLI.

## Quellen

Lokal geprueft am 07.10.2026:
`main.js`, `src/acp-client.js`, `src/updater.js`,
`src/claude-adapter-update.js` und das mit CLI 1.0.92 ausgelieferte
`changelog.json`. Projektnotiz:
`C:\DEV\copilot\Obsidian\GEBIT\01_Projekte\Aktiv\Copilot Desktop App.md`.

Primaerquellen, abgerufen am 07.10.2026:

- https://github.com/github/copilot-cli/issues/4994
- https://github.com/github/app/issues/1936
- https://github.com/github/app/issues/1936#issuecomment-5359714120
- https://github.com/github/app/issues/4390
- https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions
- https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app
- https://github.com/github/copilot-sdk/blob/main/README.md
- https://github.com/github/app/blob/main/changelog.md
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- https://hermes-agent.nousresearch.com/docs/user-guide/desktop
- https://hermes-agent.nousresearch.com/docs/getting-started/installation

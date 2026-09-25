# Plan: Automatisierte Aufgaben (Trigger-basierte Prompt-Ausführung)

## Ziel

Der Nutzer kann "Automationen" konfigurieren: bei einem Trigger (Uhrzeit,
Datum+Uhrzeit, oder Datei-/Ordner-Änderung) wird automatisch ein
vorgefertigter Prompt an einen neuen Tab geschickt — ohne manuelles
Abschicken. Läuft nur, während die App offen ist (kein OS-Cron, kein
Hintergrunddienst).

## Kontext (verifiziert im Code)

- **Datei-Überwachung, Vorbild**: `src/ipc/images-ipc.js` — `fs.watch(dir,
  cb)` mit Debounce (`setTimeout`/`clearTimeout`), dann
  `sendToRenderer('images:changed')`. Läuft im Main-Prozess (Node-`fs` ist
  im Renderer nicht verfügbar, `nodeIntegration:false`).
- **Periodische Prüfung, Vorbild**: `renderer/modules/self-update.js` —
  `setTimeout(...)` kurz nach Start, danach `setInterval(...)` alle N ms,
  reine Renderer-Seite (kein Node nötig für einen Zeitvergleich).
- **Prompt an einen Tab schicken**: bereits vorhandene, providerunabhängige
  Mechanik (`createTab`/`switchTab` in `renderer/modules/tabs.js`,
  `sendAgentPrompt` in `main.js`) — bestätigt least Nutzererwartung, dass
  der Provider hier keinen Unterschied macht.
- **Persistenz-Konvention**: app-verwaltete Datenlisten (Skills, Agents,
  API-Sessions, Preis-Cache) liegen unter `DATA_DIR` (`src/data-dir.js`,
  `~/.agent-desktop/`), je eine eigene JSON-Datei — nicht in
  `preferences.json` (das ist für einfache Key-Value-Einstellungen).

## Design-Entscheidungen

- **Persistenz**: neue Datei `~/.agent-desktop/automations.json`, Liste von
  Automation-Objekten (Form siehe Task 1). Eigene Datei statt
  `preferences.json`, da es eine wachsende Liste strukturierter Einträge
  ist, kein einzelner Einstellungswert — folgt der bestehenden Konvention.
- **Trigger, v1 zwei Typen**:
  - `schedule`: tägliche Uhrzeit (`{ time: "08:00" }`) — wiederkehrend.
  - `datetime`: einmaliger Zeitpunkt (`{ at: "2026-09-25T08:00:00" }`) —
    feuert einmal, wird danach automatisch deaktiviert (nicht gelöscht,
    damit der Nutzer sieht, dass/wann es gelaufen ist).
  - `file`: Pfad zu Datei oder Ordner (`{ path: "..." }`) — jede Änderung
    löst aus, mit Debounce (Vorbild `images-ipc.js`, ~500ms).
- **Prüf-Intervall**: ein einzelner `setInterval` (Renderer, ~alle 30s)
  reicht für `schedule`/`datetime` — auf Minuten-Genauigkeit ausgelegt,
  kein Sekunden-Timing nötig. Datei-Trigger laufen separat event-basiert
  über `fs.watch` (Main-Prozess), nicht über denselben Interval-Tick.
- **Aufgabe, v1 nur ein Typ**: `{ type: 'prompt', prompt: string }` — ein
  fest hinterlegter Text. Andere Aufgabentypen (z.B. "Slash-Befehl
  ausführen") bewusst zurückgestellt (Nutzer-Vorgabe: "lass uns mit einem
  vorgefertigten Prompt starten").
- **Ziel, v1 immer ein neuer Tab** (nicht: eine bestehende Session
  weiterführen). Begründung: eine bestehende Session könnte gerade
  verarbeiten, geschlossen oder auf einen anderen Provider gewechselt sein
  — "neuer Tab" ist immer eindeutig ausführbar, ohne Sonderfälle. Ziel
  einer Automation ist also `{ provider: string, model?: string }`, analog
  zur bestehenden "Neuer Tab"-Auswahl. **Das ist eine bewusste Annahme,
  bitte im Review bestätigen** — falls stattdessen "an eine bestehende
  benannte Session anhängen" gewollt ist, ist das ein größerer Zusatz
  (Session muss geladen, ggf. eine Weile gewartet werden, falls sie gerade
  beschäftigt ist) und sollte als eigene, spätere Erweiterung geplant
  werden.
- **Kein Hintergrunddienst**: entspricht der Nutzervorgabe ("reicht, wenn
  es läuft während die App offen ist"). Verpasste Trigger (App war zu,
  als die Zeit kam) werden beim nächsten Start **nicht** nachgeholt — wird
  im Nicht-Scope-Abschnitt dokumentiert, da es sonst zu Überraschungen
  führen könnte.

## Betroffene Bereiche

### Task 1: `src/automations.js` (neu) — Datenmodell + reine Logik

- [ ] `readAutomations()`/`writeAutomations()` — JSON unter
      `DATA_DIR/automations.json`, fail-soft (leere Liste bei Fehler/nicht
      vorhanden), analog zu anderen `DATA_DIR`-Dateien.
- [ ] Reine, testbare Funktionen (kein `fs`, kein IPC):
      `shouldFireSchedule(automation, now, lastFiredAt)`,
      `shouldFireDatetime(automation, now)` — Kernlogik, die entscheidet ob
      ein Trigger jetzt feuert. Getrennt von I/O, damit sie ohne Electron
      testbar sind (Konvention: reine Logik in `src/`, nicht inline in
      `main.js`/Renderer).
- **Contract:**
  ```js
  // Automation shape
  {
    id: string, name: string, enabled: boolean,
    trigger: { type: 'schedule', time: 'HH:MM' }
           | { type: 'datetime', at: ISOString }
           | { type: 'file', path: string },
    task: { type: 'prompt', prompt: string },
    target: { provider: string, model?: string },
    lastFiredAt?: number, // epoch ms
  }
  ```

### Task 2: `main.js` — IPC + Datei-Überwachung

- [ ] `automations:list`/`automations:save`/`automations:delete` — CRUD über
      `src/automations.js`.
- [ ] Für jede aktive `file`-Automation: `fs.watch` + Debounce (Vorbild
      `images-ipc.js`), sendet `automations:fileTriggered` mit der
      Automation-ID an den Renderer. Watcher werden bei
      Save/Delete/Disable neu aufgesetzt (keine Leichen-Watcher).

### Task 3: `preload.js`

- [ ] Bridge-Methoden für die drei IPC-Handler + Listener für
      `automations:fileTriggered`.

### Task 4: `renderer/modules/automations.js` (neu)

- [ ] `initAutomationScheduler()`: `setInterval` alle 30s, prüft
      `schedule`/`datetime`-Trigger aller aktiven Automationen über
      `shouldFireSchedule`/`shouldFireDatetime` (aus `src/automations.js`,
      im Renderer via... — **zu klären**: `src/automations.js` läuft aktuell
      nur im Main-Prozess (kein `require` im Renderer, siehe `CLAUDE.md`).
      Reine Zeit-Vergleichslogik dupliziert sich am einfachsten nach
      `src/renderer-logic.js` (UMD, in beiden Welten nutzbar) — die
      main-seitige `src/automations.js` bleibt für Datei-I/O zuständig,
      ruft aber dieselben reinen Funktionen aus `renderer-logic.js` auf,
      statt sie zu duplizieren.
- [ ] Bei Trigger (Zeit oder `automations:fileTriggered`-Event): neuen Tab
      mit `target.provider` öffnen, `task.prompt` senden. `lastFiredAt`
      aktualisieren (persistiert über `automations:save`).
- [ ] Settings-UI: neuer Tab "Automationen" — Liste + Formular (Name,
      Trigger-Typ mit den drei Untervarianten, Prompt-Text, Ziel-Provider).

### Task 5: Tests

- [ ] `src/automations.js`/`renderer-logic.js`: `shouldFireSchedule`/
      `shouldFireDatetime` — Kernfälle (Zeit erreicht/nicht erreicht,
      bereits heute gefeuert, einmaliger Trigger nach Feuern deaktiviert).
- [ ] `readAutomations`/`writeAutomations`: fail-soft bei fehlender/kaputter
      Datei.

## Nicht im Scope (v1)

- Kein Nachholen verpasster Trigger (App war beim Zeitpunkt geschlossen).
- Keine Wiederholungsmuster außer "täglich zur Uhrzeit" (kein
  Wochentags-Filter, kein "alle N Minuten").
- Kein Anhängen an eine bestehende/benannte Session als Ziel — nur neuer Tab.
- Keine anderen Aufgabentypen außer festem Prompt-Text.
- Kein Nachholen/Queueing, falls zum Trigger-Zeitpunkt bereits ein anderer
  automatischer Lauf/eine Verarbeitung aktiv ist — mehrere Automationen
  können gleichzeitig mehrere neue Tabs öffnen.

## Status

Plan erstellt, Design zur Bestätigung mit dem Nutzer — insbesondere die
"immer neuer Tab statt bestehende Session"-Annahme. Umsetzung noch offen.

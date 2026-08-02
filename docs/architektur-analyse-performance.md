# Architektur-Analyse: Performance & Security

*Stand: 2026-07-30 (Nachtanalyse). Bezieht sich auf den Arbeitsstand nach Commit `d6b3969` plus die uncommitteten Änderungen dieses Tages.*

---

## TL;DR — Management Summary

Die gefühlte Verschlechterung hat **nicht eine** Ursache, sondern vier, die sich gegenseitig verstärken:

1. **Tab-Wechsel-Freeze (1–2s):** Commit `60682e4` stellte das Wiederöffnen von Sessions von "letzte 5 Nachrichten" auf "**komplette Historie**" um. Seitdem wachsen die Tabs mit jeder langen Session auf zehntausende DOM-Knoten. Ein Tab-Wechsel togglet `display:none → block` und zwingt den Browser, den **gesamten** Baum des Ziel-Tabs neu zu layouten. Chrome selbst markiert das im Profil mit *"Optimize DOM size"* und *"Forced reflow"*. → Heute Nacht teilentschärft (nur noch 20 Nachrichten live im DOM), aber der teure Markdown-Parse der Alt-Historie passiert weiterhin eager beim Resume (nur das Layout wird gespart) — Restfix steht aus (P0-2).
2. **Streaming-Jank + Speicherdruck:** Bei jedem gestreamten Textdelta wurde die **gesamte** bisherige Antwort neu durch marked + `hljs.highlightAuto()` gejagt. `highlightAuto` kompiliert bei jedem Aufruf Sprachgrammatiken neu (die `ResumableMultiRegex`/`MultiRegex`-Objekte im Heap-Snapshot, zusammen ~7MB + massiver GC-Churn). Kosten wachsen quadratisch mit der Antwortlänge. → Heute gefixt (`renderFast` ohne hljs während des Streamens; volles Highlighting einmal am Ende).
3. **176ms-Blocker `playNotificationSound`:** Die lazy `new AudioContext()`-Konstruktion beim ersten Benachrichtigungston blockierte den Main-Thread genau dann, wenn ein Hintergrund-Tab fertig wurde — fiel im Profil als 97%-Posten auf. → Heute gefixt (Vorab-Konstruktion beim Start).
4. **RAM "1,4 GB" ist überwiegend kein Renderer-Leak:** Der Task-Manager-Eintrag summiert **alle** Kindprozesse — pro Tab läuft ein eigener `copilot --acp`- bzw. `npx claude-agent-acp`-Node-Prozess (je 150–400MB, wachsend mit dem Transkript). Der Renderer-Heap selbst lag im Snapshot bei nur ~40MB. Es gibt aber zwei echte, unbegrenzt wachsende Renderer-Strukturen (P1-3) und stetiges Log-IPC im Leerlauf.

**Security:** Ein realer Befund mit Handlungsbedarf (S1: JS-Injection über Skill-/Agent-Namen via Inline-`onclick` — ausnutzbar durch bösartige Marketplace-Plugins), zwei strukturelle Schwächen (CSP `unsafe-inline`, Markdown-Pipeline im Node-fähigen Preload), Rest solide (safeStorage-Keystore, Pfad-Traversal-Schutz, Link-Handling).

---

## 1. Methodik

- Profiling-Daten des Nutzers (DevTools Performance-Trace + Heap-Snapshot vom 29./30.07.)
- Vollständige Durchsicht: `renderer/app.js` (~7800 Zeilen), `main.js`, `src/acp-client.js`, `preload.js`, `renderer/styles.css`, `renderer/modules/*`, `src/secure-store.js`, `src/sessions.js`
- Git-Archäologie zur Datierung der Regressionen (`git log -S`)
- Instrumentierung: `[perf]`-Logging in `switchTab()`/`loadProjectSkillsAndAgents()` + Paint-inklusive Klick-Messung (heute eingebaut, siehe §6)

---

## 2. Architektur-Überblick (Ist-Zustand)

```
┌────────────── Renderer (index.html) ──────────────┐
│ app.js (Monolith, ~7800 Z., klassische Globals)   │
│ modules/*.js (utils, todos, dev-console, …)       │
│ Alle Listen: innerHTML-Full-Rebuild               │
│ Chat: 1 stream-output-DIV pro Tab, display-Toggle │
└────────────▲──────────────────────▲───────────────┘
   contextBridge (copilot.*)   contextBridge (markdown.render)
             │                      │  marked+hljs+DOMPurify
┌────────────┴──── Main (main.js) ──┴───────────────┐
│ ~80 IPC-Handler, tw. execSync (blockierend!)      │
│ backends: Map<tabId, AcpClient|ApiAgentClient>    │
└───────▲──────────────▲───────────────▲────────────┘
   copilot --acp   npx claude-agent-acp   Direkt-APIs
   (Prozess/Tab)   (Prozess/Tab)          (fetch)
```

Grundsätzlich gesund: klare IPC-Trennung, `contextIsolation`, ein Backend pro Tab, getestete Pure-Logic-Module. Die Performance-Probleme sind **konzentriert**, nicht flächig — sie liegen fast alle im Rendering-Pfad des Chats und in wenigen blockierenden Main-Prozess-Stellen.

---

## 3. Performance-Befunde (priorisiert)

### P0 — Ursachen der akuten Freezes

| # | Befund | Ursachenkette | Status / Fix |
|---|---|---|---|
| P0-1 | **Tab-Wechsel legt UI 1–2s lahm** | `60682e4` lädt volle Historie → zehntausende Knoten pro Tab → `display:block` beim Wechsel erzwingt Voll-Layout des Ziel-Tabs (+ `chatInput.focus()` und `resizeChatInput()` lesen Layout-Werte → Forced Reflow auf dem frischen Riesenbaum) | **Teilfix heute Nacht**: Resume rendert nur noch die letzten 20 Nachrichten live, Rest nachladbar per Scroll-up; 30-Min-Pruning für Live-Verlauf. Verifikation über `[perf]`-Logging ausstehend |
| P0-2 | **Resume parst trotzdem noch die GESAMTE Historie** | `insertHistoryGroups()` staged alte Nachrichten zwar außerhalb des DOM, aber `renderSimpleHistory`/`renderApiHistory` bauen **alle** Elemente inkl. `markdown.render()` pro Alt-Nachricht **sofort** — bei 500 Nachrichten ~500 Markdown-Parses beim Öffnen | **Offen (empfohlener nächster Schritt):** Rohdaten statt fertiger Elemente stagen; Elemente erst in `restorePrunedHistory()` beim Hochscrollen bauen. Zusätzlich `sessions:readAllMessages` (liest events.jsonl synchron im Main-Prozess komplett) auf Streaming/Slice umstellen |
| P0-3 | **Quadratisches Re-Highlighting beim Streamen** | Jedes Delta → marked-Parse der Gesamtantwort + `hljs.highlightAuto()` (kompiliert Grammatiken jedes Mal neu — sichtbar als `MultiRegex`-Berge im Heap) | **Gefixt heute** (`markdownRenderFast` ohne hljs während Stream; volles Rendering einmal bei Bubble-Abschluss). Look&Feel-Delta: Code-Farben erscheinen erst bei Abschluss des Absatzes |
| P0-4 | **`playNotificationSound` = 176ms Main-Thread** | Lazy `new AudioContext()` beim ersten Ton; kollidierte zeitlich mit Tab-Wechseln | **Gefixt heute** (Vorab-Konstruktion bei `DOMContentLoaded`) |

### P1 — Dauerhafte Grundlast & echte Leaks

| # | Befund | Detail | Fix-Vorschlag |
|---|---|---|---|
| P1-1 | **`execSync` blockiert den Main-Prozess** | `readMcpConfig()` ruft `copilot mcp list --json` **synchron** bei jeder neuen/geladenen ACP-Session auf (bis 5s Timeout; CLI-Kaltstart real 0,5–2s). Ebenso `copilot --version` beim Start. Während execSync läuft, steht die **gesamte App** (alle IPC, alle Fenster) | Auf async `spawn` + Promise umstellen; Ergebnis pro `cwd` cachen (MCP-Konfig ändert sich selten); Cache-Invalidierung über den bestehenden Settings-Pfad |
| P1-2 | **`scrollToBottom()` pro Stream-Event = Forced Reflow** | Liest `scrollHeight` (Layout-Flush) bei *jedem* Delta/Tool-Event | Über `requestAnimationFrame` einmal pro Frame bündeln (Flag "scrollPending" statt Direktaufruf) |
| P1-3 | **Zwei unbegrenzt wachsende Strukturen im Renderer** | (a) `window._rendererLogs` — **kein Cap**, jede Konsolenzeile für immer; (b) Dev-Console-DOM: `appendDevConsoleRow` hängt bei offenem Panel Zeilen ohne Limit an (das 1000er-Cap gilt nur fürs Array, nicht fürs DOM) | (a) Cap analog `DEV_CONSOLE_MAX_ENTRIES`; (b) beim Anhängen älteste Rows entfernen |
| P1-4 | **Log-Pipeline erzeugt Leerlauf-IPC in beide Richtungen** | Renderer: jeder `console.log` → IPC `log:write` (Datei). Main: jeder `console.log` → Datei **und** IPC `dev-console:log` an den Renderer — auch bei geschlossener Dev-Console. Chatty Quellen (ACP-stderr, usage-Events) laufen ständig. Zusätzlich ersetzt `initDevConsole` die Renderer-Overrides erneut — **danach landen Renderer-Logs nicht mehr im File-Log** (Bug) | `dev-console:log` nur senden, wenn Panel offen (Renderer meldet Zustand per IPC); Renderer-Override-Kette konsolidieren (eine Funktion, die Array-Cap + Datei + Panel bedient); das heute eingebaute `[perf]`-Logging nach der Diagnose wieder entfernen |
| P1-5 | **RAM im Task-Manager ≠ Renderer-RAM** | Pro Tab ein CLI-/Adapter-Kindprozess (Node, je 150–400MB, wächst mit Transkript). 4–5 Tabs erklären >1GB unabhängig vom Renderer | Dokumentieren + optional: Backends inaktiver Tabs nach N Minuten Idle stoppen (Session-ID bleibt, Prozess wird bei Bedarf neu gestartet — Pattern existiert schon für Approval-Umschaltung) |

### P2 — Unnötige Arbeit pro Interaktion

| # | Befund | Detail | Fix-Vorschlag |
|---|---|---|---|
| P2-1 | **`renderTabs()` = Full-Rebuild** bei jedem Wechsel, jedem Statuswechsel, jedem Rename | Alle Tab-Elemente + Listener werden weggeworfen und neu gebaut; ruft zudem jedes Mal `saveOpenTabs()` auf | Aktiv-Klasse per `classList` togglen statt Rebuild; Rebuild nur bei Struktur-Änderung (add/close/reorder) |
| P2-2 | **`saveOpenTabs()` schreibt bei jedem `renderTabs()` die kompletten Preferences** | `setPref` serialisiert das gesamte prefs-Objekt (inkl. `namedSessions`-Map) über IPC, Main schreibt die Datei synchron | Debounce (~500ms) in `setPref`; langfristig Key-weises Schreiben |
| P2-3 | **`switchTab()` stößt 7 Lade-/Renderpfade an**, auch wenn sich Provider/CWD nicht geändert haben | loadTodos, renderTabs, Skills, Agents, Projekt-Skills/Agents/MCP, SessionTools, MCP-Render, Mode/Model/Context-Buttons, Usage-Refresh (`/usage`-Silent-Command an die CLI!) | Pro Pfad Guard "Eingabe unverändert → skip" (Provider-Guard existiert bereits für Skills/Agents; auf cwd/todos/session-tools ausweiten). `/usage`-Refresh nur bei Tab mit neuen Turns seit letztem Refresh |
| P2-4 | **`_prunedNodes` hält fertige DOM-Knoten im Speicher** | Detached Nodes sind deutlich schwerer als Rohdaten | Zusammen mit P0-2 lösen: Rohdaten stagen, lazy bauen |

### P3 — Kleinkram (nur der Vollständigkeit halber)

- `transition: all 0.15s ease` auf `.tab`/`.session-card` — `all` transitioniert auch Layout-Props; auf `background, color, border-color` einschränken.
- `scrollToBottom` sucht den Tab per `[...tabs.entries()].find(…)` — O(n), unkritisch, aber `streamEl._tabId` wäre gratis.
- Globaler `mouseover`-Tooltip-Listener mit `closest()` — okay; bei Bedarf `pointerover` + Delegation auf Container.
- Perf-Instrumentierung (`[perf]`-Zeilen) selbst kostet pro Wechsel ein paar ms (jede Zeile = 2×IPC + Datei) — nach Abschluss der Diagnose entfernen.

---

## 4. Security-Review

### S1 (HOCH) — JS-Injection über Inline-`onclick` trotz `escapeAttr`

**Mechanismus:** Listen werden als HTML-Strings mit Inline-Handlern gebaut, z. B.
`onclick="confirmDeleteSkill('${escapeAttr(s.dirName)}', '${escapeAttr(s.name)}')"`.
`escapeAttr` wandelt `'` in `&#39;` — das schützt das **HTML-Attribut**, aber der Browser **dekodiert Entities, bevor** der `onclick`-Code den JS-Parser erreicht. Ein Wert wie `x'),stealKeys(),('` wird also im JS-String-Kontext wieder zu einem echten `'` und bricht aus.

**Angriffsvektor:** Skill-/Agent-Name und -Beschreibung stammen aus YAML-Frontmatter beliebiger `SKILL.md`-Dateien — inklusive **Marketplace-Plugins**, deren Skills per `plugin-skill-mirror` automatisch in den User-Skill-Ordner gespiegelt werden. Ein bösartiges Plugin erhält damit JS-Ausführung im Renderer mit Zugriff auf die komplette `window.copilot`-Bridge (Dateien schreiben, Keys löschen, Prompts mit `--allow-all` an die CLI senden → faktisch Codeausführung auf dem Rechner). Session-IDs/Suchfeld sind durch `isSessionIdLike` (`/^[a-z0-9_-]+$/i`) abgesichert — der Skill-/Agent-Pfad ist es **nicht**.

**Fix (Look&Feel-neutral):** Inline-Handler durch `data-*`-Attribute + delegierte Listener ersetzen (ein Listener pro Liste). Betrifft `renderSkills`, `renderAgents`, `renderSessions`, Skill-Manager, Plugin-Manager. Nebeneffekt: Vorarbeit für S2.

### S2 (MITTEL) — CSP erlaubt `'unsafe-inline'` für Skripte

`index.html` setzt `script-src 'self' 'unsafe-inline'`. Damit ist die CSP als XSS-Verteidigungslinie faktisch abgeschaltet (S1 wird dadurch erst voll ausnutzbar). Nach Umsetzung von S1 kann `'unsafe-inline'` entfernt werden — dann wäre selbst eine künftige Escaping-Lücke nicht mehr direkt ausführbar.

### S3 (MITTEL) — Markdown-Pipeline läuft im Node-fähigen Preload

`marked` + `highlight.js` + `DOMPurify` werden **im Preload** ausgeführt (`sandbox: false`, volles `require`). Sie verarbeiten die un-vertrauenswürdigste Eingabe der App (LLM-Ausgabe, Tool-Ergebnisse, potenziell Webinhalte via fetch-Tools). Ein Parser-Exploit würde direkt in einem Node-Kontext landen statt in der isolierten Page. Empfehlung: marked/hljs/DOMPurify als normale `<script>`-Dateien in die Page verlagern (dort gibt es kein `require`) — `window.markdown` bleibt API-identisch; Preload behält nur die IPC-Bridge. Danach ist auch `sandbox: true` erreichbar.

### S4 (NIEDRIG) — Prozess-Spawns

`spawn(..., { shell: true })` für `copilot`/`npx`/`claude` (Windows-.cmd-Zwang). Argumente sind statisch bzw. stammen aus eigener Konfiguration (Modell-IDs, cwd aus Ordner-Dialog) — kein Injektionsvektor von außen erkennbar. Deny-Tools/Add-Dirs werden als separate argv-Einträge übergeben. Hinweis: `windowsHide: true` fehlt bei den ACP-Spawns (nur kosmetisch).

### S5 (SOLIDE) — Positivbefunde

- **Key-Store:** `safeStorage` (DPAPI/Keychain), Datei `0600`, Entschlüsselung nur im Main, Renderer sieht nur `hasKey`-Booleans. Gut.
- **Pfad-Sicherheit:** `safeSessionPath` validiert gegen Traversal; Skills-Delete nutzt `dirName`-Basename-Checks.
- **Navigation:** `will-navigate` blockt alles außer `file://`, `setWindowOpenHandler` → `openExternal` + `deny`. Gut.
- **DOMPurify** auf jedem Markdown-Render (beide Modi), `ADD_TAGS` minimal.
- **IPC-Validierung** bei kritischen Handlern vorhanden (Typ-Checks), wenn auch nicht flächendeckend.

---

## 5. Regression-Timeline (Was wurde wann langsamer?)

| Commit | Änderung | Perf-Wirkung |
|---|---|---|
| `60682e4` (v1.2.x) | Voll-Historie beim Wiederöffnen (statt letzter 5) | **Hauptursache** Tab-Wechsel-Freeze; wuchs schleichend mit den Sessions |
| `53ce0de` v1.2.0 | Claude-Code-History-Restore | dito für Claude-Code-Tabs |
| v1.5–v1.7 (Skills/Agents/Settings-Ausbau) | mehr Lade-/Renderpfade in `switchTab` | additiv (P2-3) |
| `35525f7`/`a198c16` v1.9.0 | Transitions, `transition: all` | marginal (P3) |
| Heutige Session (uncommitted) | Perf-Logging, Pruning-Sweep | Diagnose-Overhead, s. P3; Pruning/Tail-Cap sind Gegenmaßnahmen |

Wichtig: Die dominanten Kosten existierten **latent** schon länger — sie eskalieren mit *Datenwachstum* (Session-Länge, Tab-Anzahl), nicht primär durch einzelne neue Features. Deshalb "wurde es schleichend schlimmer".

---

## 5b. Umsetzungsstand (30.07., nach der Nachtanalyse)

| Befund | Status |
|---|---|
| P1-1 execSync → async + Cache | **erledigt** — `execCliAsync()`; MCP-Konfig pro cwd 5-Min-Cache, CLI-Version prozessweit gecacht |
| Electron 35 → 43 | **erledigt** — `npm audit`: 0 Schwachstellen, alle Tests grün |
| P1-2 scrollToBottom bündeln | **erledigt** — ein Layout pro Frame statt pro Event |
| P1-3 Log-Leaks | **erledigt** — Dev-Console-DOM gekappt, unbegrenztes `_rendererLogs` entfernt |
| P1-4 Doppelte Console-Override-Kette | **erledigt** — eine Kette; Renderer-Logs landen wieder im File-Log (war ein stiller Bug) |
| P2-2 Preferences-Writes | **erledigt** — 300ms Debounce + Flush bei `beforeunload` |
| P0-2 Lazy-Historie | **erledigt** — Builder-Funktionen statt fertiger Elemente; Markdown-Parse der Alt-Historie erst beim Hochscrollen |
| S1 onclick-Injection | **erledigt** — Skills/Agents/Sessions/Skill-Manager/Plugins/Todos/Tag-Listen auf `data-*` + Delegation; Icon-Interpolation escaped |
| S2 CSP `unsafe-inline` | **erledigt** — alle 17 statischen Inline-Handler in `index.html` plus einer im Test-Runner auf Delegation umgestellt; `script-src` ist jetzt nur noch `'self'` |
| P2-1/P2-3 renderTabs/switchTab-Guards | offen |
| P1-5 Idle-Backends | offen (Produktentscheidung) |
| S3 Markdown-Pipeline aus dem Preload | offen |

## 6. Bereits in der Nacht umgesetzt (uncommitted, mit Strg+R bzw. Neustart testbar)

1. `markdownRenderFast` — kein hljs mehr während des Streamens (P0-3)
2. AudioContext-Vorab-Konstruktion (P0-4)
3. Resume-Cap: nur letzte 20 Nachrichten live im DOM, Rest per Scroll-up (P0-1 teilweise)
4. 30-Min-DOM-Pruning + Scroll-up-Restore mit Endlosschleifen-Guard
5. `[perf]`-Instrumentierung in `switchTab`/Klickpfad/`loadProjectSkillsAndAgents` (Diagnose, wieder zu entfernen)
6. MCP-Status: Live-Session-Status überschreibt den unauthentifizierten Probe nicht mehr
7. Kleinere UI-Aufträge des Tages (Chat-Input-Umbau, Dev-Zeile, Update-Button, Tab-DnD, Skill-Toggle pro Tab, …)

**Verifikation morgen:** App neu starten → Dev-Console öffnen → zwischen zwei großen Tabs wechseln → `[perf] tab click → painted: …ms` ablesen. Erwartung: deutlich unter den bisherigen 1–2s; die Zeile `target tab has N DOM children` zeigt, ob das 20er-Cap greift (N sollte grob ≤ 60–80 sein statt tausende).

---

## 7. Empfohlener Maßnahmenplan

**Reihenfolge nach Wirkung/Aufwand, alle Look&Feel-neutral (außer wo vermerkt):**

1. **P0-2** Lazy-Bau der Historie (Rohdaten stagen statt fertige Nodes) + `readAllMessages` streamen — größter verbleibender Hebel für Resume/Restore. *(mittel)*
2. **S1 + S2** onclick → delegierte Listener, dann `'unsafe-inline'` aus der CSP — wichtigster Security-Fix. *(mittel, mechanisch)*
3. **P1-1** `execSync` → async + Cache (MCP-Config, Versions-Check). *(klein)*
4. **P1-3/P1-4** Log-Caps + Dev-Console-IPC nur bei offenem Panel + Override-Kette bereinigen + `[perf]`-Logging entfernen. *(klein)*
5. **P1-2** scrollToBottom per rAF bündeln. *(klein)*
6. **P2-1/P2-2** renderTabs-Rebuild nur bei Strukturänderung; setPref debouncen. *(klein–mittel)*
7. **P2-3** switchTab-Pfade guarden (cwd-/provider-Memoisierung). *(mittel)*
8. **P1-5** Optional: Idle-Backends stoppen (größter RAM-Hebel, braucht Produktentscheidung: Prozess-Neustart beim Reaktivieren dauert 1–3s). *(mittel, UX-Abwägung)*
9. **S3** Markdown-Pipeline in die Page verlagern, danach `sandbox: true`. *(mittel)*

---

## 8. Grundsatzempfehlung zur Architektur (mittelfristig)

Der `app.js`-Monolith ist mit ~7800 Zeilen der wartungskritischste Punkt — nicht per se langsam, aber jede Änderung riskiert Nebenwirkungen (mehrere Regressionen dieser Woche entstanden genau so: verwaiste Referenzen nach UI-Umbauten). Empfohlener schrittweiser Schnitt entlang bereits existierender Grenzen, ohne Framework-Einführung:

- `tabs.js` (Tab-Lifecycle, renderTabs, switchTab)
- `chat-stream.js` (Event-Handler, Bubbles, Pruning/Restore)
- `sidebar.js` (Skills/Agents/Sessions/MCP/Todos-Rendering)
- `settings.js` (bereits weitgehend isoliert)

Das existierende Muster (klassische Script-Globals, `renderer/modules/`) reicht dafür aus — kein Build-Schritt nötig.

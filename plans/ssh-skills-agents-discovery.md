# Plan: Skills/Agents/Instructions-Discovery für Claude Code (SSH)

## Ziel

Für `claude-code-ssh` zeigt die App aktuell keine Skills, keine Agents und
keinen Instructions-Editor — nicht weil Claude Code auf dem Remote-Host sie
nicht hätte (es entdeckt sie selbst genau wie lokal), sondern weil die
Sidebar/Settings-Anzeige der App bisher nur lokales `fs` kennt. Dieser Plan
baut die drei fehlenden Anzeigen über SSH nach.

**Wichtiger Befund vorab, der den Umfang verkleinert:** „Instructions" ist bei
Claude Code kein Ordner-Scan wie bei Skills/Agents, sondern nur die eine
Datei `~/.claude/CLAUDE.md` (`instructions:readClaudeCode`/`writeClaudeCode`
in `main.js`) — ein einfaches Lesen/Schreiben, kein Parsen vieler Dateien mit
Frontmatter. Das ist der mit Abstand kleinste Teil dieses Plans.

## Kontext (verifiziert im Code)

- **Skills**: pro Ordner eine `SKILL.md` mit YAML-Frontmatter
  (`scanSkillDirectory` in `src/scanners.js`). Pfade für `claude-code`:
  global `~/.claude/skills`, projektbezogen `<cwd>/.claude/skills`
  (`src/context-paths.js`).
- **Agents**: flache `*.agent.md`-Dateien mit YAML-Frontmatter
  (`scanAgentsDirectory` in `src/agents.js`). Pfade: global `~/.claude/agents`,
  projektbezogen `<cwd>/.claude/agents`.
- **Instructions**: eine einzelne Datei, kein Ordner, kein Frontmatter-Parsing
  — `~/.claude/CLAUDE.md`, global, fix (main.js ~1745-1770).
- Beide Scan-Funktionen sind async (`fsp.readdir`/`fsp.readFile`) und lesen
  parallel (`Promise.all`) — Begründung im Code: „auf einem Netzlaufwerk
  dominiert die Latenz pro Datei, nicht der Durchsatz". Über SSH gilt das
  noch stärker: **ein Roundtrip pro Datei ist inakzeptabel** (SSH-Handshake
  kostet spürbar, siehe `buildProbeCommand()`s Kommentar „jeder Handshake
  kostet Sekunden").
- `context:listSkills`/`context:listAgents` (main.js) sind die einzigen
  Aufrufer der Scan-Funktionen für die Sidebar — beide bekommen bereits
  `provider` und `cwd`, die Verzweigung auf SSH kann dort ansetzen.
- Es gibt **einen** global konfigurierten SSH-Host/-cwd für `claude-code-ssh`
  (`getClaudeCodeSshHost()`/`getClaudeCodeSshCwd()`), nicht pro Tab — das
  vereinfacht Caching auf einen einzigen Schlüssel.

## Design-Entscheidungen

- **Ein Batch-Kommando statt N Roundtrips.** Ein einziger SSH-Aufruf listet
  beide Skill-Verzeichnisse (global+project), liest jede gefundene `SKILL.md`,
  listet beide Agent-Verzeichnisse, liest jede `*.agent.md` — alles in einer
  Shell-Pipeline, getrennt durch Sentinel-Marker in der Ausgabe. Kosten: eine
  SSH-Verbindung, egal wie viele Skills/Agents existieren.
- **Frontmatter-Parsing von Dateizugriff trennen** (gleiches Prinzip wie im
  Schwesterplan zur Historie): `scanSkillDirectory`/`scanAgentsDirectory`
  bekommen den Datei-Lesevorgang aus dem lokalen `fs` — die eigentliche
  Frontmatter-Extraktion (Regex + `yamlParse`) wird in reine Funktionen
  ausgelagert, die sowohl vom lokalen als auch vom SSH-Scanner aufgerufen
  werden. Eine Regel für „was ist ein gültiger Skill/Agent", nicht zwei.
- **Kurzlebiger Cache, kein Push-Update.** Skills/Agents ändern sich selten
  gegenüber der Sidebar-Render-Frequenz. Ein einfacher In-Memory-Cache in
  `main.js` (Map, TTL — Vorschlag 60 s, key = `host:cwd`) reicht; kein
  Dateisystem-Watcher auf der Remote-Seite, das wäre deutlich mehr Aufwand
  für einen seltenen Anwendungsfall (Skills ändert man nicht minütlich).
- **Instructions bekommt einen eigenen, parallelen Remote-Pfad**, keine
  Batch-Logik nötig — ein `cat`/ein Schreib-Befehl, analog zum lokalen
  `instructions:readClaudeCode`/`writeClaudeCode`.
- **Schreiben (Skill/Agent anlegen oder bearbeiten) ist NICHT Teil dieses
  Plans.** Nur Lesen/Anzeigen. Marketplace-Installation (Schreiben) bleibt
  wie besprochen zurückgestellt.

## Betroffene Bereiche

### Task 1: `src/scanners.js` / `src/agents.js` — Parsing extrahieren

- [ ] `parseSkillFrontmatter(rawSkillMdContent, dirName, source, iconFn, yamlParse)`
  → dasselbe Rückgabeobjekt wie heute pro Skill, aber aus bereits gelesenem
  Text statt aus einem Pfad. `scanSkillDirectory()` wird zur dünnen
  fs-Hülle darüber (Verhalten bitgleich, bestehende Tests bleiben grün).
- [ ] `parseAgentFrontmatter(rawAgentMdContent, fileSlug, yamlParse)` —
  gleiches Prinzip für Agents.

**Contract:**
```js
parseSkillFrontmatter(raw: string, dirName: string, source: string, iconFn, yamlParse): {id, dirName, name, description, source, icon} | null
parseAgentFrontmatter(raw: string, fileSlug: string, yamlParse): {id, fileSlug, name, description, icon} | null
```

### Task 2: `src/ssh-remote.js` — Batch-Scan-Kommando

- [ ] `buildScanSkillsAgentsCommand(cwd)`: eine Shell-Pipeline, die für jedes
  der vier Verzeichnisse (`~/.claude/skills`, `<cwd>/.claude/skills`,
  `~/.claude/agents`, `<cwd>/.claude/agents`) still fehlschlägt, wenn es
  nicht existiert (`2>/dev/null || true`), und für jede gefundene Datei einen
  Sentinel plus Inhalt ausgibt, z. B.:
  ```
  ===SKILL:global:<dirName>===
  <Inhalt von SKILL.md>
  ===AGENT:project:<fileSlug>===
  <Inhalt von *.agent.md>
  ```
  Pfad-Bestandteile (cwd) werden über `shellQuote()` behandelt wie überall
  sonst in diesem Modul.
- [ ] `parseScanSkillsAgentsOutput(stdout)` → `{ skills: [{scope, dirName, raw}], agents: [{scope, fileSlug, raw}] }`
  — reines Aufteilen an den Sentinels, **kein** Frontmatter-Parsing hier (das
  macht Task 1 in main.js, mit Zugriff auf `yamlParse`).

**Contract:**
```js
buildScanSkillsAgentsCommand(cwd: string): string
parseScanSkillsAgentsOutput(stdout: string): { skills: Array<{scope: 'global'|'project', dirName: string, raw: string}>, agents: Array<{scope: 'global'|'project', fileSlug: string, raw: string}> }
```

### Task 3: `main.js` — IPC, Cache, Verzweigung

- [ ] Neue interne Funktion `scanSkillsAgentsRemote(host, cwd)`: spawnt den
  Task-2-Befehl über SSH, parst die Rohausgabe, wendet Task-1-Parser mit
  `yaml.parse` an, liefert dieselbe Form wie `scanSkillDirectory`/
  `scanAgentsDirectory` lokal zurück.
- [ ] In-Memory-Cache (Map `host:cwd` → `{ at, skills, agents }`, TTL 60 s),
  damit ein Sidebar-Re-Render nicht bei jedem Aufruf neu über SSH geht.
- [ ] `context:listSkills`/`context:listAgents`: bei `provider === 'claude-code-ssh'`
  auf `scanSkillsAgentsRemote()` verzweigen statt auf die lokalen
  Scan-Funktionen — Host/cwd kommen aus `getClaudeCodeSshHost()`/
  `getClaudeCodeSshCwd()`.
- [ ] Neue Handler `instructions:readClaudeCodeRemote(host)` /
  `instructions:writeClaudeCodeRemote(host, content)`: `cat ~/.claude/CLAUDE.md`
  bzw. Schreiben über Stdin-Pipe (`ssh host 'cat > ~/.claude/CLAUDE.md'`,
  Inhalt auf Stdin — **nicht** in die Kommandozeile einbetten, das würde bei
  langem/mehrzeiligem Text und Sonderzeichen an Quoting-Grenzen stoßen, die
  ein Stdin-Pipe gar nicht erst hat).

### Task 4: `src/context-paths.js` + Capability-Matrix

- [ ] `claude-code-ssh` aus `UNSUPPORTED_PROVIDERS` für Skills/Agents entfernen
  — die eigentliche Pfad-Auflösung bleibt aber weiterhin serverseitig in
  main.js (Task 3), da `skillDirs()`/`agentDirs()` lokale `path.join`-Logik
  sind und für Remote-Pfade nicht direkt wiederverwendet werden (String-Bau
  in `ssh-remote.js`, Task 2).
- [ ] `renderer/app.js`: `PROVIDER_CAPABILITIES['claude-code-ssh']` —
  `skills`, `agents`, `instructions` auf `true`.

### Task 5: `renderer/app.js` — Instructions-Editor für SSH

- [ ] Der bestehende Instructions-Editor (Settings, Claude-Code-Tab) bekommt
  einen dritten Fall neben lokal/Copilot: bei aktivem SSH-Ziel
  `readClaudeCodeRemote`/`writeClaudeCodeRemote` statt der lokalen Variante.
  Gleiche UI, andere Datenquelle — kein neues Editor-Widget.

### Task 6: Tests

- [ ] `parseSkillFrontmatter`/`parseAgentFrontmatter`: gültiges Frontmatter,
  fehlendes Frontmatter, kaputtes YAML, BOM, Icon-Fallback — Fälle, die
  heute schon gegen `scanSkillDirectory`/`scanAgentsDirectory` laufen,
  gegen die extrahierten reinen Funktionen wiederholt.
- [ ] `buildScanSkillsAgentsCommand`/`parseScanSkillsAgentsOutput`: korrektes
  Quoting der cwd, Sentinel-Trennung bei mehreren Dateien, leere
  Verzeichnisse, Verzeichnis mit Datei ohne gültiges Frontmatter (Sentinel da,
  aber Parser liefert für dieses Fragment `null`).
  **Sicherheitsrelevant** (wie `ssh-remote.test.js` bereits vorlebt): eine
  cwd mit `;`/Backticks/Anführungszeichen darf keine zusätzlichen Befehle
  einschleusen.
- [ ] Cache in `main.js`: zweiter Aufruf innerhalb der TTL löst keinen neuen
  SSH-Aufruf aus; nach Ablauf schon.
- [ ] `instructions:*Remote`-Handler: Erfolg, fehlende Datei (leerer Inhalt,
  kein Fehler), Schreibfehler.

## Risiken

- **Sentinel-Kollision**: Wenn eine `SKILL.md`/`*.agent.md` selbst eine Zeile
  enthält, die wie ein Sentinel aussieht (`===SKILL:...===`), zerlegt der
  Parser falsch. Sentinel bewusst ungewöhnlich genug wählen (z. B. mit
  Zufalls-/Präfix-Anteil) oder zumindest im Test explizit gegenprüfen.
- **Cache-Veralterung**: Legt der Nutzer remote einen neuen Skill an, sieht
  die Sidebar ihn bis zu 60 s lang nicht. Akzeptiert für v1 — kein
  Refresh-Button vorgesehen, könnte bei Bedarf leicht ergänzt werden.
- **Kosten pro Sidebar-Öffnen ohne Cache-Treffer**: ein SSH-Handshake plus
  Übertragung aller Skill-/Agent-Dateien. Bei sehr vielen/großen Skills
  langsamer als der lokale Fall — kein Show-Stopper, aber spürbar.

## Nicht im Scope

- Schreiben/Anlegen/Löschen von Skills oder Agents auf dem Remote-Host.
- Marketplace-Spiegelung für SSH (bräuchte Schreibzugriff).
- Ein Dateisystem-Watcher/Live-Update bei Änderungen auf dem Remote-Host.

## Status

Plan erstellt, Umsetzung noch offen.

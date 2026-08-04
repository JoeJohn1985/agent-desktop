# Concept: New providers — DeepSeek (API) & Kimi/Moonshot (ACP)

**Status:** Recherche abgeschlossen, Implementierung zurückgestellt · **Datum:** 2026-08-04

**Grund für die Zurückstellung:** Die Recherche fand auf einem Firmenrechner statt. Für die
Kimi-Integration wäre lokal ein fremdes Binary mit Shell-Zugriff nötig gewesen
(Kimi Code CLI nutzt Git-Bash intern für Tool-Ausführung) — unklar, wie die
Firmenrichtlinie zu einem chinesischen LLM-Tool auf dem Arbeitsrechner steht,
unabhängig von der technischen Sauberkeit der Installation. Geplant ist,
beide Provider erst nach Anschaffung eines separaten Raspberry Pi (eigenes
Netzwerk, losgelöst vom Arbeitsrechner) anzugehen.

Dieses Dokument hält die Rechercheergebnisse fest, damit sie bei
Wiederaufnahme nicht erneut erhoben werden müssen.

---

## 1. DeepSeek — Direct-API-Provider

Architektonisch identisch zum bestehenden OpenAI/GLM-Provider-Muster
(`src/providers/*.js`), kein neuer CLI-Prozess, keine ACP-Anbindung nötig.

- **Base-URL:** `https://api.deepseek.com` (OpenAI-Request/Response-Schema),
  zusätzlich `https://api.deepseek.com/anthropic` (Anthropic-Format),
  Beta-Features unter `/beta`. Endpoint: `POST /chat/completions`.
- **Auth:** Header `Authorization: Bearer $DEEPSEEK_API_KEY` — passt direkt in
  das bestehende `secureStore`-Muster.
- **OpenAI-Kompatibilität:** Ja, laut offizieller Doku. Umstieg über
  bestehendes OpenAI-SDK + geänderte `baseURL` funktioniert direkt, kein
  eigenes DeepSeek-SDK nötig (auch keins offiziell verfügbar — nur
  inoffizielle Drittanbieter-Pakete wie `@ai-sdk/deepseek`, `node-deepseek`).
- **Modelle (Stand 2026-08-04):** Legacy-Aliase `deepseek-chat` /
  `deepseek-reasoner` werden zum 24.07.2026 abgeschaltet und zeigen bereits
  auf `deepseek-v4-flash` (Update 0731) bzw. `deepseek-v4-pro`. **Vor
  Implementierung erneut prüfen**, ob die Aliase dann noch existieren oder
  die neuen IDs direkt verwendet werden müssen.
- **Kontext/Output:** 1M Tokens Kontext, bis zu 384K Tokens Output laut
  aktueller Doku (ältere Quellen nennen fälschlich 128K — veraltet).
- **Tool-/Function-Calling:** OpenAI-Stil (`tools`-Array, `tool_choice`),
  bis zu 128 Funktionen pro Call, paralleles Tool-Calling unterstützt.
  **Offener Punkt:** Ob das aktuelle Reasoning-Modell (`deepseek-v4-pro`)
  noch Einschränkungen beim Function-Calling hat (galt für den Vorgänger
  R1/`deepseek-reasoner`) — vor Implementierung direkt in der
  Function-Calling-Doku gegenprüfen.
- **Streaming:** SSE (`stream: true`), Abschluss durch `data: [DONE]` —
  identisch zu OpenAI, passt in bestehende Streaming-Logik.
- **Preise (Stand 2026-08-04):** V4-Flash Input Cache-Hit $0,0028 /
  Cache-Miss $0,14 / Output $0,28 pro 1M Tokens; V4-Pro $0,003625 / $0,435 /
  $0,87. Peak/Off-Peak-Preismodell (9–12 & 14–18 Uhr Peking-Zeit) laut Doku
  in Vorbereitung — vor Implementierung erneut prüfen.
- **Rate-Limits:** konkurrenzbasiert (nicht Token-Bucket) — V4-Flash 2500,
  V4-Pro 500 gleichzeitige Requests.

**Einschätzung:** Mit vertretbarem, geringem Aufwand anbindbar — strukturell
nahezu 1:1 wie der bestehende OpenAI/GLM-Provider zu implementieren.

**Quellen:** [api-docs.deepseek.com](https://api-docs.deepseek.com/),
[Function Calling Guide](https://api-docs.deepseek.com/guides/function_calling),
[Pricing](https://api-docs.deepseek.com/quick_start/pricing)

---

## 2. Kimi Code CLI (MoonshotAI) — ACP-Provider

Im Gegensatz zu Claude Code (braucht den separaten Adapter
`@agentclientprotocol/claude-agent-acp`) spricht die **Kimi Code CLI ACP
nativ** über den Subcommand `kimi acp` — kein Adapter-Paket nötig. Passt gut
in die bestehende `AcpClient`-Abstraktion (`src/acp-client.js`,
`command`/`baseArgs`/`stripEnv`/`useConfigOptions`-Optionen).

- **Zwei verschiedene Moonshot-Projekte — nicht verwechseln:**
  `MoonshotAI/kimi-cli` (Python, PyPI `kimi-cli`) ist die **alte,
  auslaufende** Version. `MoonshotAI/kimi-code` (TypeScript-Quellcode, aber
  als **kompiliertes Binary** verteilt) ist die aktuell aktive CLI, auf die
  sich `kimi acp` bezieht.
- **Installation:** **Kein offizielles npm-Paket** (verifiziert per
  Registry-API — `@moonshotai/kimi-code` und `@kimi-code/cli` → 404). Nur
  über Binary-Releases:
  - Offizielles Skript: `irm https://code.kimi.com/kimi-code/install.ps1 | iex`
    (Windows) bzw. `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`
    (Mac/Linux) — Inhalt vor Ausführung nicht verifiziert.
  - **Sicherere Alternative:** direkter ZIP-Download von den GitHub Releases
    (`MoonshotAI/kimi-code`, z.B. Version `0.32.0` Stand 2026-08-04):
    `kimi-code-win32-x64.zip` / `kimi-code-win32-arm64.zip`, je mit
    `.sha256`-Prüfsummendatei. Kein Installer, keine Registry-Einträge,
    kann in einen beliebigen nutzerbeschreibbaren Ordner entpackt werden.
    Kein PATH-Eintrag nötig — `AcpClient`s `command`-Option akzeptiert einen
    vollständigen Pfad zur `.exe`.
  - **Voraussetzung:** Git für Windows muss installiert sein — Kimi Code
    nutzt das gebündelte Git-Bash intern als Shell für Tool-Ausführung. Bei
    nicht-Standard-Pfad: Env-Var `KIMI_SHELL_PATH` auf `bash.exe` setzen.
- **ACP-Start:** denkbar einfach, keine Sonderflags:
  ```json
  { "command": "kimi", "args": ["acp"] }
  ```
  `cwd` wird pro Session über `session/new`/`session/load` übergeben, nicht
  über CLI-Flags — passt exakt zur bestehenden `AcpClient`-Architektur.
- **Auth:** **Kein** Umgebungsvariablen-Weg (kein `MOONSHOT_API_KEY` für
  ACP dokumentiert). Erfordert vorheriges interaktives Login: `kimi` im
  Terminal starten, `/login` ausführen. Der ACP-Server liest den
  gespeicherten Session-State; fehlt er, liefert `kimi acp` den Fehler
  `authRequired (-32000)`.
- **MCP-Forwarding:** `http`/`stdio`/`sse`-MCP-Server aus der ACP-Client-Config
  werden auf Kimis eigene Transporte gemappt (Details nicht verifiziert).

### ⚠️ Bekannter Blocker — vor Implementierung zwingend empirisch prüfen

[Issue #1485](https://github.com/MoonshotAI/kimi-code/issues/1485) (offen,
Stand 2026-08-04): `kimi acp` schließt Prompts korrekt mit
`stopReason: "end_turn"` ab, sendet dabei aber bei **generischen
ACP-Clients (nicht Zed)** keine `session/update`/`agent_message_chunk`-
Benachrichtigungen. Reproduziert unter v0.23.1/v0.22.3 mit einem
Drittanbieter-ACP-Client. Unser `AcpClient` ist genau so ein generischer
Client — im schlimmsten Fall bekäme die UI nie eine sichtbare Antwort,
obwohl der Request technisch erfolgreich war.

**Vor jeder Implementierung:** minimaler Rohtest — `kimi acp` direkt per
JSON-RPC über stdio ansprechen (initialize → session/new → session/prompt)
und prüfen, ob `session/update`-Notifications tatsächlich ankommen. Erst
danach lohnt sich die volle Integration (Renderer-Provider-Matrix,
Model-Liste, Settings-Panel, Tests — geschätzt 25+ Berührungspunkte analog
zur bestehenden Claude-Code-Integration).

**Fallback, falls ACP nicht zuverlässig funktioniert:** Moonshot-Platform-API
als Direct-API-Provider (wie DeepSeek) statt ACP-CLI:
- Base-URL `https://api.moonshot.ai/v1`, Auth
  `Authorization: Bearer $MOONSHOT_API_KEY`, OpenAI-kompatibler
  `/v1/chat/completions`-Endpoint, zusätzlich ein Anthropic-kompatibler
  Endpoint (Kuriosität: `real_temperature = request_temperature * 0.6`).
- Modelle: `kimi-k2`, `kimi-k2-turbo`, `kimi-k2.5`, `kimi-k2.6`, Flaggschiff
  „Kimi K3" (2,8T Parameter, 1M Kontext, „always thinking"-Modus).
- Tool-Use im OpenAI-Stil plus Kimi-spezifischer `thinking`-Parameter.
- Konkrete Kontextfenster-/Preis-/Rate-Limit-Werte pro Modell nicht
  vollständig verifiziert — vor Implementierung
  `platform.kimi.ai/docs/api/chat` und Pricing-Seite direkt prüfen.

**Einschätzung:** Technisch reizvoller als Claude Code (kein Adapter-Layer
nötig), aber wegen des offenen Streaming-Bugs riskanter als DeepSeek — der
Rohtest ist Pflicht, bevor Implementierungsaufwand investiert wird.

**Quellen:**
[GitHub MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code),
[Kimi Docs – kimi-acp Reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html),
[Kimi Docs – IDE-Integration](https://moonshotai.github.io/kimi-code/en/guides/ides),
[Zed ACP Agent-Seite](https://zed.dev/acp/agent/kimi-cli),
[Issue #1485](https://github.com/MoonshotAI/kimi-code/issues/1485),
[Moonshot Platform API Overview](https://platform.kimi.ai/docs/api/overview),
[LibreChat Moonshot-Doku](https://www.librechat.ai/docs/configuration/librechat_yaml/ai_endpoints/moonshot)

---

## Architektur-Referenz für die Implementierung (beide Provider)

Beim Wiederaufgreifen zuerst diese bestehenden Dateien als Vorlage nutzen:

- **DeepSeek (Direct-API):** `src/providers/` (OpenAI/GLM-Provider als
  Vorlage), `PROVIDER_CAPABILITIES`/`DEFAULT_MODELS`/`PROVIDER_LABELS` in
  `renderer/app.js`, `src/context-paths.js` (Skills/Agents-Pfade,
  `<cwd>/.agent-desktop/skills` gilt bereits generisch für alle
  Direct-API-Provider), `src/data-dir.js`.
- **Kimi (ACP):** `claudeCodeClientOptions()` + `sendCopilotPrompt()` in
  `main.js` als Vorlage für eine analoge `kimiClientOptions()`,
  `claudecode:status`-IPC-Handler (main.js) als Vorlage für
  `kimicli:status`, `src/acp-client.js` (generische ACP-Client-Abstraktion,
  keine Änderung nötig — nur neue Konfiguration).

# Release Notes v1.3.0

## What's new?

### Provider-Instructions 📋

Neben Skills und Agents gibt es jetzt **Instructions** — aber gezielt nur für
die vier Direkt-API-Provider (Anthropic, OpenAI, GLM, Ollama). Copilot und
Claude Code brauchen das nicht: beide lesen ihre eigenen Instructions-Dateien
(`.github/copilot-instructions.md` bzw. `CLAUDE.md`) bereits selbst.

- **Anders als Skills/Agents** wird der Inhalt jeder Instructions-Datei bei
  jeder Nachricht **vollständig** in den Kontext eingebettet, statt dem
  Modell nur einen Hinweis zu geben, dass es die Datei bei Bedarf selbst
  liest — Instructions sollen unbedingt gelten, nicht optional sein.
- Dateien liegen unter `~/.agent-desktop/<provider>/instructions/` als
  `*.instructions.md`. **Kein Ein/Aus-Schalter, keine Sidebar-Ansicht** —
  eine Datei dort abzulegen aktiviert sie automatisch, sie zu entfernen
  deaktiviert sie wieder.

### Technical details
- Neue Module `src/instructions.js`, `buildInstructionsBlock()` in
  `src/providers/system-context.js`, `resolveInstructions()` in `main.js`.
- 23 neue Tests, insgesamt 1432 Tests grün.

> **Hinweis:** Diese Datei wurde eine Weile nicht gepflegt (letzter Eintrag
> zuvor: v1.0.0/v0.32.0) — die Zwischenversionen sind vollständig im
> [CHANGELOG](./CHANGELOG.md) dokumentiert.

---

# Release Notes v1.0.0

**First stable release.** GitHub Copilot (CLI/ACP) is the fully-tested core. In addition, direct-API providers are available — labelled by maturity: **Gemini = Beta** ("tested, not final"), **Anthropic/OpenAI/GLM/Ollama = Alpha** ("untested"). Copilot carries no label.

## What's new in 1.0?

- **Dynamic model discovery** for all providers (live via `/models` or ACP), including an info message when new models appear.
- **Maturity labels (Alpha/Beta)** per provider with a tooltip.
- **Reworked tab bar**: the active tab is large, the rest compact (short label + separator borders), actions on hover, close ✕ in the corner.

### Bug fixes
- Cost is billed per message using the **model actually used** (no more mispricing when switching models between prompts).
- **Tool calls visible again** (Copilot/ACP: correct icon; MCP tools like Playwright no longer hidden); **no more triple** result display.
- Fixed a missing **paragraph break between sentences**; reopening a session now **scrolls to the bottom**.

---

# Release Notes v0.32.0

## What's new?

### Multiple LLM providers — use the Anthropic API directly 🔌

Alongside the GitHub Copilot CLI, the **Anthropic API** can now be used **directly, per tab** — with the full agent feature set.

- **Provider selection** in the session bar (`🔌 Provider`): switch between *GitHub Copilot* and *Anthropic API* (Gemini/OpenAI are prepared). The model dropdown shows only the selected provider's models.
- **Fully agentic**: the API backend runs its own tool loop — read/write/edit files and shell commands (on Windows via PowerShell), incl. streaming and adaptive thinking.
- **Secure API keys**: new "API providers" settings tab. Keys are encrypted via the OS keychain and never leave the main process.
- **Project context**: skills, agents, and `copilot-instructions.md` are passed as a (cached) system prompt.
- **Prompt caching**: the growing history is cached → significantly lower cost on long sessions.
- **Context management**: usage shown as a percentage, with **automatic compaction** above 80%.
- **Session resume**: history is persisted and shown again on reopen; the conversation continues with full context.
- **Exact cost**: the direct API returns real token counts (incl. cache-write at 1.25× input) instead of an estimate.

> **Note:** the Anthropic API requires your own API key (Settings → API providers).

---

## Bug Fixes

- **Copilot responses aborted after 60s with "Code 1" and then seemed to run forever**: longer agentic turns hit a fixed 60-second timeout on the `session/prompt` request — the UI stayed stuck on "Running" while the CLI was still working. The turn no longer has an artificial timeout (bounded by the stop button and process exit).

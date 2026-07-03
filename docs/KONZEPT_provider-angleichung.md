# Concept: Copilot alignment & provider neutrality

> **Implementation status (1.0.0, 2026-07-02):** Implemented. In addition to the
> originally planned display-name-only change, 1.0 renamed the **entire internal
> identity** from `copilot-desktop` to `agent-desktop` (incl. `app.name`,
> `package.json`, data path `~/.agent-desktop`, Electron `userData`) — with
> automatic data migration (`src/data-dir.js`; on Windows DPAPI keeps the
> encrypted keys valid). The passage below stating "internal IDs stay unchanged"
> is therefore **outdated**. The provider id `copilot` and the IPC channels
> `copilot:*` are intentionally kept.

**Status:** Implemented in 1.0.0 · **Date:** 2026-06-30
**Goal:** Align the app from a "Copilot UI" into a provider-neutral, local agent application. Copilot technically remains the CLI (no API binding) but is presented to the user **as one provider among several**.

Decisions (agreed):
- The app is **renamed provider-neutrally** (display name).
- Copilot setup/login is **centralized in the provider tab**.
- The app is **fully usable without the Copilot CLI** (Copilot optional).
- **Concept first, then implementation.**

---

## ⚠️ Critical constraint: change display name only

The identifier `copilot-desktop` is coupled to **user data**:
- `app.name` / Electron userData path → `~/.copilot-desktop/` resp. `%APPDATA%\copilot-desktop\`
- **encrypted API keys** (`safeStorage` is bound to the app identity)
- preferences (`settings`, `namedSessions`, `costLog`, …), logs, deleted todos

**Consequence:** changing the *internal* name/path would make every user lose keys, settings, cost history, and session names.
→ **We change only the visible display name.** Internal IDs (`copilot-desktop`, userData path, `package.json` `name`) stay **unchanged**.

**Open:** the desired **display name** (e.g. "Agent Desktop", "Local Agent", "GEBIT Agent" …). → please decide.

---

## Phase A — Rebranding (display only, low risk)

Change (strings/text only):
- `renderer/index.html`: `<title>`, `.titlebar__title`, onboarding title, settings hints
- `main.js`: `BrowserWindow.title`, startup log text (display); **NOT** `app.name`, **NOT** userData paths
- `renderer/app.js`: onboarding texts (CWD/folders/login), the "Copilot Desktop" mentions
- `PROVIDER_LABELS.copilot` stays "GitHub Copilot" (that's correct — the provider *is* called that)
- Default tab label "🤖 Copilot" → neutral (e.g. "🤖 New tab") or based on the selected provider

Intentionally **unchanged**: `package.json` `name`, `app.name`, all `~/.copilot-desktop/` paths, logger file names.

---

## Phase B — Copilot as a provider in the "API providers" tab

Copilot gets **a row like the other providers** in Settings → "API providers":
- **Status detection** (new IPC `copilot:status`):
  - CLI installed? (`copilot --version` → ok/missing)
  - logged in? (existing `auth:check`)
- **Display:** "● logged in as <user>" / "○ CLI installed, not logged in" / "⚠ CLI not found"
- **Actions in the row:** "Sign in" (= existing terminal login) · install hint/link if the CLI is missing
- **Info tooltip** like the others (tools, MCP support as a unique selling point)
- No key field (Copilot uses CLI login instead of a key) — the row shows the CLI/login status instead

This way the user manages **all** providers in **one** place. The terminal login stays technically, but is presented identically.

Affected: `PROVIDER_SETTINGS` (+ `copilot` entry with `type:'cli'`), `renderProvidersSettings`, new `copilot:status` IPC, `refreshProviderStatus`.

---

## Phase C — Copilot optional (onboarding rework)

Today the **Copilot login is a mandatory step**. New:
- **Provider selection step** on first start: "What would you like to start with?" → Copilot **or** an API provider (enter a key) **or** Ollama (local).
- The Copilot login step becomes **skippable**; anyone choosing an API provider needs no Copilot CLI.
- The **default provider** is set from the selection (feeds into the already-built `settings.defaultProvider`).
- Folder setup stays (project/cwd logic applies to all providers).

Affected: onboarding wizard (`renderLoginStep` → `renderProviderStep`), step order, `getDefaultProvider`.

Edge case: app features that **strictly** require the CLI (MCP, skill/agent execution via the CLI) remain Copilot-only and are hidden for non-Copilot tabs (MCP is already handled this way).

---

## Order & risk

1. **Phase A (rebranding)** — low risk, purely cosmetic. Only needs the name.
2. **Phase B (Copilot in the provider tab)** — medium; new `copilot:status` IPC, UI extension.
3. **Phase C (onboarding/optional)** — the largest change; onboarding flow + first-start logic.

Each phase committed separately, tests/lint green. No data migration needed (internal IDs stay).

---

## Open items for you
1. The app's **display name**?
2. Phase order OK (A → B → C)?
3. Should the default tab label "🤖 Copilot" become generic (e.g. "🤖 New tab")?

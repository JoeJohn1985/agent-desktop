# Konzept: Copilot-Angleichung & Provider-Neutralität

**Status:** Entwurf zur Abnahme · **Datum:** 2026-06-30
**Ziel:** Die App von einer „Copilot-UI" zu einer provider-neutralen, lokalen Agent-Anwendung angleichen. Copilot bleibt technisch die CLI (keine API-Anbindung), wird aber für den Nutzer **wie ein Provider unter mehreren** behandelt.

Entscheidungen (abgestimmt):
- App wird **provider-neutral umbenannt** (Anzeigename).
- Copilot-Setup/Login **zentral im Provider-Tab**.
- App **ohne Copilot-CLI** voll nutzbar (Copilot optional).
- **Erst Konzept, dann Umsetzung.**

---

## ⚠️ Kritische Randbedingung: nur Anzeigename ändern

Der Identifier `copilot-desktop` ist an **Nutzerdaten** gekoppelt:
- `app.name` / Electron-userData-Pfad → `~/.copilot-desktop/` bzw. `%APPDATA%\copilot-desktop\`
- **verschlüsselte API-Keys** (`safeStorage` ist an die App-Identität gebunden)
- Preferences (`settings`, `namedSessions`, `costLog`, …), Logs, gelöschte Todos

**Folge:** Ändert man den *internen* Namen/Pfad, verlieren alle Nutzer Keys, Einstellungen, Kosten-Historie und Session-Namen.
→ **Wir ändern ausschließlich den sichtbaren Anzeigenamen.** Interne IDs (`copilot-desktop`, userData-Pfad, `package.json` `name`) bleiben **unverändert**.

**Offen:** gewünschter **Anzeigename** (z.B. „Agent Desktop", „Local Agent", „GEBIT Agent" …). → bitte festlegen.

---

## Phase A — Rebranding (nur Anzeige, risikoarm)

Ändern (nur Strings/Texte):
- `renderer/index.html`: `<title>`, `.titlebar__title`, Onboarding-Titel, Settings-Hinweise
- `main.js`: `BrowserWindow.title`, Startup-Log-Text (Anzeige); **NICHT** `app.name`, **NICHT** userData-Pfade
- `renderer/app.js`: Onboarding-Texte (CWD/Folders/Login), die „Copilot Desktop"-Erwähnungen
- `PROVIDER_LABELS.copilot` bleibt „GitHub Copilot" (das ist korrekt — der Provider *heißt* so)
- Default-Tab-Label „🤖 Copilot" → neutral (z.B. „🤖 Neuer Tab") bzw. nach gewähltem Provider

Bewusst **unverändert**: `package.json` `name`, `app.name`, alle `~/.copilot-desktop/`-Pfade, Logger-Dateinamen.

---

## Phase B — Copilot als Provider im „API-Provider"-Tab

Copilot bekommt **eine Zeile wie die anderen Provider** in den Einstellungen → „API-Provider":
- **Status-Erkennung** (neuer IPC `copilot:status`):
  - CLI installiert? (`copilot --version` → ok/fehlt)
  - eingeloggt? (vorhandene `auth:check`)
- **Anzeige:** „● eingeloggt als <user>" / „○ CLI installiert, nicht eingeloggt" / „⚠ CLI nicht gefunden"
- **Aktionen in der Zeile:** „Anmelden" (= bestehender Terminal-Login) · Install-Hinweis/Link, falls CLI fehlt
- **Info-Tooltip** wie bei den anderen (Tools, MCP-Unterstützung als Alleinstellungsmerkmal)
- Kein Key-Feld (Copilot nutzt CLI-Login statt Key) — die Zeile zeigt stattdessen den CLI-/Login-Status

So managt der Nutzer **alle** Provider an **einem** Ort. Der Terminal-Login bleibt technisch, ist aber gleich präsentiert.

Betroffen: `PROVIDER_SETTINGS` (+ `copilot`-Eintrag mit `type:'cli'`), `renderProvidersSettings`, neuer `copilot:status`-IPC, `refreshProviderStatus`.

---

## Phase C — Copilot optional (Onboarding-Umbau)

Heute ist der **Copilot-Login ein Pflichtschritt**. Neu:
- **Provider-Auswahl-Schritt** beim Erststart: „Womit möchtest du starten?" → Copilot **oder** ein API-Provider (Key eingeben) **oder** Ollama (lokal).
- Copilot-Login-Schritt wird **überspringbar**; wer einen API-Provider wählt, braucht keine Copilot-CLI.
- **Default-Provider** wird aus der Auswahl gesetzt (greift in das bereits gebaute `settings.defaultProvider`).
- Folder-Setup bleibt (projekt-/cwd-Logik gilt für alle Provider).

Betroffen: Onboarding-Wizard (`renderLoginStep` → `renderProviderStep`), Schritt-Reihenfolge, `getDefaultProvider`.

Edge-Case: App-Funktionen, die **zwingend** die CLI brauchen (MCP, Skills/Agents-Ausführung via CLI), bleiben Copilot-only und werden bei Nicht-Copilot-Tabs ausgeblendet (MCP ist bereits so).

---

## Reihenfolge & Risiko

1. **Phase A (Rebranding)** — risikoarm, rein kosmetisch. Braucht nur den Namen.
2. **Phase B (Copilot im Provider-Tab)** — mittel; neuer `copilot:status`-IPC, UI-Erweiterung.
3. **Phase C (Onboarding/optional)** — größter Umbau; Onboarding-Flow + Erststart-Logik.

Jede Phase einzeln committet, Tests/Lint grün. Keine Daten-Migration nötig (interne IDs bleiben).

---

## Offene Punkte für dich
1. **Anzeigename** der App?
2. Phasen-Reihenfolge ok (A → B → C)?
3. Soll das Default-Tab-Label „🤖 Copilot" generisch werden (z.B. „🤖 Neuer Tab")?

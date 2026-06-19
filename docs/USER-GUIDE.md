# 📘 Copilot Desktop – Benutzerhandbuch

**Version 0.31.0** · Electron-basierte Desktop-Anwendung für GitHub Copilot CLI

---

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Erste Schritte](#erste-schritte)
   - [Voraussetzungen](#voraussetzungen)
   - [Installation](#installation)
   - [Onboarding-Wizard](#onboarding-wizard)
   - [Erster Chat](#erster-chat)
3. [Benutzeroberfläche](#benutzeroberfläche)
   - [Titlebar](#titlebar)
   - [Sidebar](#sidebar)
   - [Hauptbereich](#hauptbereich)
   - [Session-Statusbar](#session-statusbar)
4. [Features im Detail](#features-im-detail)
   - [Multi-Session Management](#multi-session-management)
   - [Chat](#chat)
   - [Tutorial-Popups](#tutorial-popups)
   - [Datei Drag & Drop](#datei-drag--drop)
   - [Skills](#skills)
   - [Agents](#agents)
   - [MCP-Server](#mcp-server-sidebar)
   - [Todos](#todos)
   - [Session-Actions](#session-actions)
   - [Session Resume](#session-resume)
   - [Settings](#settings)
   - [Themes](#themes)
5. [Tastenkombinationen](#tastenkombinationen)

---

## Überblick

Copilot Desktop verpackt GitHub Copilot CLI in eine moderne Chat-Oberfläche. Statt auf der Kommandozeile zu arbeiten, interagierst du über eine grafische Anwendung mit Copilot – inklusive Multi-Session-Tabs, einer Sidebar für Sessions, Skills und Todos, Kontext-Überwachung und Kosten-Tracking.

---

## Erste Schritte

### Voraussetzungen

| Anforderung | Details |
|---|---|
| Betriebssystem | Windows 11 (primär), Linux, macOS |
| Lizenz | GitHub Copilot (aktives Abonnement) |
| Runtime | Node.js 18 oder höher |
| CLI | GitHub CLI mit installierter Copilot Extension |

### Installation

```powershell
git clone https://github.com/matthias-schneider_gebit/github-copilot-desktop.git
cd github-copilot-desktop
.\setup.ps1    # oder manuell: npm install
npm start
```

> **Tipp:** Das Setup-Skript `setup.ps1` installiert automatisch alle Abhängigkeiten.

### Onboarding-Wizard

Beim **ersten App-Start** führt dich ein 4-stufiger Onboarding-Wizard durch die Einrichtung:

| Schritt | Inhalt |
|---|---|
| **1. GitHub Auth-Check** | Prüft `gh auth status` und leitet bei Bedarf `gh auth login` ein |
| **2. Ordner-Einrichtung** | Erstellt das Verzeichnis `~/.copilot-desktop/` mit allen nötigen Unterordnern |
| **3. Starter Agents & Skills** | Auswahl aus 6 Kategorien – jede per Toggle aktivierbar/deaktivierbar |
| **4. Feature-Einführung** | 3-Slide-Carousel mit den wichtigsten App-Features |

> **Tab-Unlock Fallback:** Falls ein Schritt nicht automatisch abgeschlossen wird, erscheint nach 30 Sekunden ein manueller Unlock-Button. Nach 180 Sekunden wird der nächste Schritt automatisch freigeschaltet.

> **Onboarding zurücksetzen:** Im Developer-Modus (Settings) kann der Wizard jederzeit erneut gestartet werden.

### Erster Chat

1. **App starten** – Ein leerer Tab „Neuer Chat" öffnet sich automatisch.
2. **Nachricht eingeben** und mit **Enter** absenden.
3. Copilot antwortet im Stream-Modus – du siehst die Antwort in Echtzeit erscheinen.
4. Die Session wird automatisch erstellt und erscheint in der Sidebar.

---

## Benutzeroberfläche

Die Oberfläche besteht aus vier Hauptbereichen: Titlebar, Sidebar, Hauptbereich und Statusbar.

```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Copilot Desktop                  v0.31.0         _ □ ✕     │  ← Titlebar
├────────────┬────────────────────────────────────────────────────┤
│            │  Tab 1 │ Tab 2 │ ➕                                │  ← Tab-Bar
│  Sessions  ├────────────────────────────────────────────────────┤
│            │  🧠 Sonnet  🤖 Agent  📊 18%  🔧 Tools   ~12.5C  │  ← Session-Actions
│  Skills    ├────────────────────────────────────────────────────┤
│            │                                                    │
│  Todos     │                  Chat-Bereich                      │
│            │                                                    │
│  Images    ├────────────────────────────────────────────────────┤
│            │  📤 [  Nachricht eingeben…                    ] ➤  │  ← Chat-Eingabe
│  ⚙️ ◀      ├────────────────────────────────────────────────────┤
│            │  🔌 3  🛠 5  📂 ~/Projekte                        │  ← Statusbar
└────────────┴────────────────────────────────────────────────────┘
```

### Titlebar

Die App verwendet eine frameless Titlebar im Custom-Design:

- **Links:** App-Icon und Titel „Copilot Desktop"
- **Mitte:** Version-Badge
- **Rechts:** Fenster-Steuerung – Minimieren, Maximieren, Schließen

### Sidebar

Die Sidebar befindet sich am linken Rand und ist über den **Collapse-Button** (◀) im Footer ein- und ausklappbar. Sie enthält vier Bereiche:

#### 📂 Sessions

- **Suchfeld** zum Filtern nach Session-Namen.
- **Session-Karten** zeigen Name, Datum und Checkpoint-Anzahl.
- **Klick** auf eine Karte öffnet die Session in einem neuen Tab.
- **Rechtsklick** oder **Hover** zeigt Optionen zum Umbenennen oder Löschen.

> **Hinweis:** Nur benannte Sessions werden in der Sidebar angezeigt. Unbenannte Sessions existieren nur als offene Tabs.

#### 🧠 Skills

- Liste aller verfügbaren KI-Skills mit Icon, Name und Beschreibung.
- **Toggle-Schalter** zum Aktivieren und Deaktivieren pro Session.
- **⊘-Button** deaktiviert einen Skill global in der Copilot CLI (`~/.copilot/settings.json`).
- Aktive Skills werden automatisch als Prompt-Präfix in jede Nachricht injiziert.

#### ✅ Todos

> Dieser Bereich ist nur sichtbar, wenn eine Session geladen ist.

- **Eingabefeld** „Neues Todo…" mit ➕-Button oder `Enter`.
- **Todo-Liste** mit Checkboxen und 🗑️-Löschen-Buttons.
- **Drag & Drop** zum Umsortieren.
- 🔄 **Sync:** Sendet die ersten 5 offenen Todos als Prompt an Copilot.

#### 🖼️ Images

- **Thumbnail-Galerie** der Bilder aus dem konfigurierten Bilder-Ordner.
- **Klick** öffnet die Lightbox-Ansicht.
- 🗑️ **Löschen** und **„Ordner öffnen"**-Button.

#### Footer

- **Collapse-Button** (◀) – Sidebar ein-/ausklappen.
- ⚙️ **Settings-Button** – Öffnet die Einstellungen.

### Hauptbereich

#### Tab-Bar

- Jeder Tab entspricht einer eigenen Chat-Session.
- ➕ **Neuer Tab** – Erstellt eine neue, leere Session.
- **Doppelklick** auf einen Tab-Titel zum Umbenennen.
- ✕ **Schließen-Button** pro Tab.
- **Status-Badge** „Working" während Copilot antwortet.

#### Session-Actions Bar

Direkt unter der Tab-Bar steuert du die aktive Session:

| Element | Beschreibung |
|---|---|
| **🧠 Modell-Name** | Öffnet Dropdown zur Modellauswahl (pro Tab, persistent) |
| **🤖 Modus** | Öffnet Dropdown zur Modus-/Agent-Auswahl |
| **📊 XX%** | Kontext-Dropdown — zeigt Auslastung, öffnet Detail-Panel oder führt Compact/Clear aus |
| **🔧 Tools** | Öffnet Popup für session-spezifische Tool-Sperren |
| **📈** | Öffnet die Kosten-Page (Kostenauflistung als eigene Vollbild-Seite) |
| **~XX.XC** | Geschätzte AI Credits für diese Session (immer sichtbar, `~0C` vor dem ersten Prompt) |

#### Chat-Bereich

- **User-Nachrichten** erscheinen rechts, **Copilot-Antworten** links.
- Nachrichten werden als **Markdown** gerendert mit Syntax-Highlighting.
- **„Thinking"-Abschnitte** zeigen den Denkprozess der KI (aufklappbar).
- **Tool-Calls** werden als aufklappbare Karten dargestellt.
- **Skill-Tags** zeigen, welche Skills beim Senden aktiv waren.
- **Chat-Suche** über `Strg+F`.
- **Scroll-to-Bottom Button** springt ans Ende des Chats.

#### Chat-Eingabe

- **Export-Button** – Chat als HTML oder Text exportieren.
- **Textarea** mit Placeholder „Nachricht eingeben…"
- **Rich-Text-Toggle** (✏️) – Wechselt zum Rich-Text-Editor.
- **Senden-Button** (oder `Enter`).
- `Shift+Enter` für Zeilenumbruch (Textarea-Modus).

##### Rich-Text-Editor

Klick auf den ✏️-Button aktiviert den Rich-Text-Modus:

- **Formatierungs-Toolbar**: **B**old, *I*talic, Aufzählung (UL), Nummerierung (OL).
- **Senden:** `Strg+Enter` (Enter = Zeilenumbruch).
- Formatierung wird beim Senden automatisch zu Markdown konvertiert.

### Session-Statusbar

Am unteren Rand zeigt die Statusbar kontextuelle Informationen zur aktiven Session:

| Icon | Information |
|---|---|
| 🔌 | Anzahl verbundener MCP-Server |
| 🛠 | Anzahl aktiver Skills |
| 📂 | Aktuelles Arbeitsverzeichnis (CWD) — klickbar zum Wechseln |

---

## Features im Detail

### Multi-Session Management

| Aktion | Vorgehen |
|---|---|
| **Neue Session** | ➕-Tab klicken → Nachricht senden → Session wird automatisch erstellt |
| **Session fortsetzen** | In der Sidebar auf die Session-Karte klicken |
| **Session umbenennen** | Doppelklick auf den Tab-Titel oder Rechtsklick in der Sidebar |
| **Session löschen** | Hover über die Session-Karte → 🗑️ → Bestätigungsdialog |
| **CWD wählen** | Klick auf 📂 in der Statusbar → Ordner-Auswahl-Dialog |

### Chat

- Nachrichten werden als **Markdown** gerendert mit vollständigem Syntax-Highlighting.
- **„Thinking"-Blöcke** — aufklappbar für mehr Transparenz.
- **Tool-Calls** als aufklappbare Karten.
- **Export:** HTML- oder Textdatei über den Export-Button.
- **Suche:** `Strg+F` öffnet die Chat-Suche.

### Tutorial-Popups

Bei bestimmten Aktionen erscheinen einmalige Tutorial-Popups:

| Popup | Auslöser | Auto-Schließen |
|---|---|---|
| **„Skills neu laden"** | Erster Klick auf den Reload-Button | Bei erneutem Reload oder nach 30 Sekunden |
| **„Tab umbenennen"** | Erster Doppelklick auf einen Tab-Titel | Nach Umbenennung oder nach 30 Sekunden |

### Datei Drag & Drop

Ziehe Dateien direkt in den Chat-Bereich — die Dateipfade werden als Kontext an Copilot gesendet.

### Skills

- Skills liegen als `SKILL.md`-Dateien in `~/.copilot/skills/`.
- Per **Toggle-Schalter** in der Sidebar aktivieren/deaktivieren.
- **⊘-Button** deaktiviert Skills CLI-weit (`~/.copilot/settings.json`).
- **Projekt-Skills** (`Projekt`-Badge): aus `.github/skills/` im aktiven CWD.

### Agents

- **Sidebar-Badge** zeigt die Gesamtanzahl geladener Agents.
- **Projekt-Agents** (`Projekt`-Badge): aus `.github/agents/` im aktiven CWD.

### MCP-Server (Sidebar)

- **Badge** zeigt `verbunden/gesamt`.
- **Projekt-MCP** (`Projekt`-Badge): aus `.github/mcp.json` im aktiven CWD.

### Todos

| Aktion | Vorgehen |
|---|---|
| **Neues Todo** | Text eingeben → ➕ oder `Enter` |
| **Abhaken** | Checkbox klicken |
| **Löschen** | 🗑️-Button |
| **Sortieren** | Drag & Drop |
| **Sync** | 🔄-Button → erste 5 offene Todos als Prompt |

### Session-Actions

#### 🧠 Modell-Auswahl

Öffnet ein Dropdown zur tab-spezifischen Modellauswahl. Wird als `--model`-Argument übergeben.

- Pro Tab; persistent über App-Neustarts
- Standard: `claude-sonnet-4.6`

#### 🤖 Modus

Wählt den Modus/Agent für den aktiven Tab (z.B. Agent, Autopilot).

#### 📊 Kontext-Dropdown

Klick auf den Button (`📊 18%`) öffnet ein Dropdown mit drei Aktionen:

**Kontext anzeigen**
- Detail-Panel mit Token-Auslastung, Kategorien und Prozent
- Farbcodierung: 🟢 Grün (≤ 60 %), 🟡 Gelb (61–80 %), 🔴 Rot (> 80 %)

**Compact**
- Fasst die bisherige Konversation zusammen und gibt Kontext frei
- %-Anzeige aktualisiert sich danach automatisch

**Clear**
- Löscht den gesamten Session-Kontext
- Nach dem Clear wird automatisch `/context` abgefragt — fällt der Wert auf 0%, steht im Button `📊 0%`

> **Tipp:** Wenn die Auslastung rot ist, nutze **Compact** oder **Clear**, um Platz zu schaffen.

#### 🔧 Session-Tools

Öffnet ein Popup für session-spezifische Tool-Sperren:

- **Tool hinzufügen:** Shell-Befehl eingeben (ohne `shell(...)`) und ➕ klicken
- **Toggle:** Sperre ein-/ausschalten
- **Löschen:** 🗑️-Button

> **Hinweis:** Jede Änderung startet den ACP-Prozess automatisch neu. Die Session bleibt erhalten — es gibt keinen Datenverlust.

#### Kostenanzeige (`~XX.XC`) und Kosten-Page (📈)

Rechts in der Session-Leiste steht immer die geschätzte Credit-Summe der aktuellen Session (`~0C` vor dem ersten Prompt). Berechnet aus Token-Verbrauch × Modellpreis nach jedem Prompt; ein Tooltip zeigt den vollständigen `/usage`-Output.

Das **📈-Icon** daneben öffnet die **Kosten-Page** — eine eigene Vollbild-Seite (wie der Plugin-Marketplace, kein Modal) mit:

- **Tages-/Wochenansicht** (Umschalter in der Kopfzeile)
- **Gestapeltes Balkendiagramm**: jede Session hat eine eigene Farbe
- **Aufschlüsselung**: Kosten pro Session + Gesamtsumme
- **🗑️ Verlauf löschen** und **✕ Schließen** in der Kopfzeile

### Session Resume

Beim Laden einer gespeicherten Session werden nur die **letzten Nachrichten** angezeigt — ohne den vollständigen Plan. Das sorgt für eine übersichtlichere Darstellung.

### Settings

Die Settings erreichst du über das ⚙️-Symbol im Sidebar-Footer. Es gibt vier Tabs:

#### UI-Tab

| Einstellung | Optionen |
|---|---|
| **Theme** | Light, Dark, GEBIT |
| **Chat-Schriftgröße** | 12–24 px (Schieberegler) |
| **Benachrichtigungston** | An / Aus |
| **Entwicklermodus** | Aktiviert Test-Runner (🧪) und Developer Console (🖥️) in der Sidebar |

#### Copilot Config-Tab

| Einstellung | Beschreibung |
|---|---|
| **Standard-Modell** | Modell für neue Tabs (überschreibbar pro Tab) |
| **Verbotene Shell Tools (global)** | Shell-Befehle, die in allen Sessions blockiert werden |
| **Zusätzliche Verzeichnisse** | Extra Pfade, die Copilot durchsuchen darf |

#### Ordner-Tab

Konfiguriert die Standard-Verzeichnisse für Sessions, Skills, Agents, Plugins und Bilder.

#### Tastenkürzel-Tab

Erlaubt das Anpassen aller konfigurierbaren Tastenkürzel. Klick auf **„Ändern"**, drücke die neue Kombination (`Esc` bricht ab). **„🔄 Alle zurücksetzen"** stellt alle Defaults wieder her.

> **Hinweis:** Der Kostenverlauf ist keine Settings-Einstellung mehr, sondern eine eigene Page — siehe [Kostenanzeige und Kosten-Page](#kostenanzeige-xxxc-und-kosten-page-) unter Session-Actions.

### Tastenkürzel-Hilfe

Das ⌨️-Symbol im Sidebar-Footer (oder `Ctrl+/`) öffnet ein Overlay mit allen aktuell aktiven Tastenkürzeln, gruppiert nach Kategorie. Geänderte Kürzel werden farblich hervorgehoben.

### Themes

| Theme | Beschreibung |
|---|---|
| **Light** | Helles Standard-Theme |
| **Dark** | Dunkles Theme |
| **GEBIT** | Corporate Theme von GEBIT Solutions |

Wechsel über: **Settings → UI → Theme**.

---

## Tastenkombinationen

Konfigurierbare Kürzel sind über **Settings → Tastenkürzel** anpassbar.

### Konfigurierbar

| Kürzel (Default) | Aktion | Kategorie |
|---|---|---|
| `Ctrl+T` | Neuer Tab | Tabs |
| `Ctrl+W` | Tab schließen | Tabs |
| `Ctrl+Tab` | Nächster Tab | Tabs |
| `Ctrl+Shift+Tab` | Vorheriger Tab | Tabs |
| `Ctrl+L` | Eingabe fokussieren | Chat |
| `Ctrl+F` | Chat durchsuchen | Chat |
| `Ctrl+E` | Chat exportieren | Chat |
| `Ctrl+B` | Sidebar ein-/ausblenden | UI |
| `Ctrl+/` | Tastenkürzel-Hilfe | UI |

### Fest verdrahtet

| Kürzel | Aktion |
|---|---|
| `Ctrl+1` … `Ctrl+8` | Tab 1–8 direkt anspringen |
| `Ctrl+9` | Letzter Tab |
| `Enter` | Nachricht senden |
| `Shift+Enter` | Zeilenumbruch in der Nachricht |
| `Escape` | Aktion abbrechen / Overlay schließen |

---

> **Copilot Desktop v0.31.0** · Entwickelt für GEBIT Solutions

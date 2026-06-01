# 📘 Copilot Desktop – Benutzerhandbuch

**Version 0.20.5** · Electron-basierte Desktop-Anwendung für GitHub Copilot CLI

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
   - [Todos](#todos)
   - [Session-Actions](#session-actions)
   - [Session Resume](#session-resume)
   - [Terminal](#terminal)
   - [Settings](#settings)
   - [Themes](#themes)
5. [Tastenkombinationen](#tastenkombinationen)

---

## Überblick

Copilot Desktop verpackt GitHub Copilot CLI in eine moderne Chat-Oberfläche. Statt auf der Kommandozeile zu arbeiten, interagierst du über eine grafische Anwendung mit Copilot – inklusive Multi-Session-Tabs, einer Sidebar für Sessions, Skills und Todos, einem integrierten Terminal und vielem mehr.

---

## Erste Schritte

### Voraussetzungen

| Anforderung | Details |
|---|---|
| Betriebssystem | Windows 11 |
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

> **Tipp:** Das Setup-Skript `setup.ps1` installiert automatisch alle Abhängigkeiten. Falls es zu Problemen kommt, führe `npm install` manuell aus.

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
3. Copilot antwortet im Stream-Modus – du siehst die Antwort Zeichen für Zeichen erscheinen.
4. Die Session wird automatisch erstellt und erscheint in der Sidebar.

---

## Benutzeroberfläche

Die Oberfläche besteht aus vier Hauptbereichen: Titlebar, Sidebar, Hauptbereich und Statusbar.

```
┌─────────────────────────────────────────────────────┐
│  🟢 Copilot Desktop          v0.20.5      _ □ ✕    │  ← Titlebar
├────────────┬────────────────────────────────────────┤
│            │  Tab 1 │ Tab 2 │ ➕                    │  ← Tab-Bar
│  Sessions  ├────────────────────────────────────────┤
│            │  📊  📐  🧹                            │  ← Session-Actions
│  Skills    ├────────────────────────────────────────┤
│            │                                        │
│  Todos     │           Chat-Bereich                 │
│            │                                        │
│  Images    ├────────────────────────────────────────┤
│            │  $ Terminal                             │  ← Terminal (ausklappbar)
│            ├────────────────────────────────────────┤
│            │  🖥️ 📤 [  Nachricht eingeben…  ] ➤    │  ← Chat-Eingabe
│  ⚙️ ◀      ├────────────────────────────────────────┤
│            │  🧠 Claude Sonnet 4  🔌 3  🛠 5  📂 …│  ← Statusbar
└────────────┴────────────────────────────────────────┘
```

### Titlebar

Die App verwendet eine frameless Titlebar im Custom-Design:

- **Links:** App-Icon und Titel „Copilot Desktop"
- **Mitte:** Version-Badge (v0.20.5)
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
- Jeder Skill hat einen **Toggle-Schalter** zum Aktivieren und Deaktivieren.
- Über den **⊘-Button** kann ein Skill zusätzlich global in der Copilot CLI deaktiviert werden (gespeichert in `~/.copilot/settings.json` unter `disabledSkills`). Deaktivierte Skills werden ausgegraut dargestellt.
- Aktive Skills werden automatisch als Prompt-Präfix in jede Nachricht injiziert.
- Skills werden aus dem Verzeichnis `~/.copilot/skills/` geladen (SKILL.md Dateien).

#### ✅ Todos

> Dieser Bereich ist nur sichtbar, wenn eine Session geladen ist.

- **Eingabefeld** „Neues Todo…" mit ➕-Button zum Hinzufügen (oder Enter drücken).
- **Todo-Liste** mit Checkboxen zum Abhaken und 🗑️-Buttons zum Löschen.
- **Drag & Drop** zum Umsortieren der Todos.
- 🔄 **Sync-Button:** Sendet die ersten 5 offenen Todos als Chat-Prompt an Copilot und markiert sie automatisch als erledigt.

#### 🖼️ Images

- **Thumbnail-Galerie** der Bilder aus `~/Copilot/images/`.
- **Klick** auf ein Bild öffnet die Lightbox-Ansicht.
- 🗑️ **Löschen-Button** pro Bild.
- **„Ordner öffnen"-Button** öffnet das Bildverzeichnis im Explorer.

#### Footer

- **Collapse-Button** (◀) – Sidebar ein-/ausklappen.
- ⚙️ **Settings-Button** – Öffnet die Einstellungen.

### Hauptbereich

Der Hauptbereich rechts neben der Sidebar enthält alle Chat-relevanten Elemente:

#### Tab-Bar

- Jeder Tab entspricht einer eigenen Chat-Session.
- ➕ **Neuer Tab** – Erstellt eine neue, leere Session.
- **Doppelklick** auf einen Tab-Titel zum Umbenennen.
- ✕ **Schließen-Button** pro Tab.
- **Status-Badge** „Working" erscheint, während Copilot eine Antwort generiert.
- **Pro-Tab-Input:** Die Chat-Eingabe (Text, Rich-Text-HTML und Modus) wird beim Tab-Wechsel gespeichert und wiederhergestellt — angefangene Nachrichten gehen beim Wechsel nicht verloren.

#### Session-Actions Bar

Direkt unter der Tab-Bar findest du fünf Aktionen:

| Button | Aktion | Beschreibung |
|---|---|---|
| 📊 Kontext | Token-Auslastung anzeigen | Popup mit farbcodierter Auslastung und Kategorien |
| 📐 Compact | Session komprimieren | Fasst die bisherige Chat-History zusammen |
| 🧹 Clear | Session-Kontext löschen | Entfernt den gesamten Kontext der Session |
| 🤖 Autopilot | Autopilot-Modus umschalten | Aktiviert `--autopilot` für den nächsten CLI-Aufruf (pro Tab) |
| 🧠 Model | KI-Modell für diesen Tab wählen | Öffnet ein Dropdown zur Modellauswahl (pro Tab, optional) |

> Die Kontext-Auslastung wird **pro Tab** individuell berechnet.

#### Chat-Bereich

Der zentrale Bereich für die Kommunikation mit Copilot:

- **User-Nachrichten** erscheinen rechts, **Copilot-Antworten** links.
- Nachrichten werden als **Markdown** gerendert, inklusive Syntax-Highlighting für Code-Blöcke.
- **„Thinking"-Abschnitte** zeigen den Denkprozess der KI (aufklappbar).
- **Tool-Calls** werden als aufklappbare Karten dargestellt.
- **Skill-Tags** unter jeder Nachricht zeigen, welche Skills aktiv waren.
- **Chat-Suche** über `Strg+F` oder das Suchfeld.
- **Scroll-to-Bottom Button** springt ans Ende des Chats.
- **Drag & Drop Overlay** erscheint, wenn du Dateien über den Chat ziehst.

#### Terminal-Panel

- Ausklappbar über den **Terminal-Button** links neben der Chat-Eingabe.
- Vollwertiges Terminal basierend auf **xterm.js**.
- **Resizable** – Vertikaler Drag am oberen Rand des Panels.
- Minimieren- und Schließen-Buttons.

#### Chat-Eingabe

- **Terminal-Toggle** (links) – Terminal ein-/ausblenden.
- **Export-Button** – Chat als HTML oder Text exportieren.
- **Textarea** mit Placeholder „Nachricht eingeben…"
- **Rich-Text-Toggle** (✏️) – Wechselt zwischen einfacher Textarea und dem Rich-Text-Editor.
- **Senden-Button** (oder `Enter` / `Strg+Enter` im Rich-Text-Modus).
- `Shift+Enter` für einen Zeilenumbruch innerhalb der Nachricht (Textarea-Modus).

##### Rich-Text-Editor

Klick auf den ✏️-Button aktiviert den Rich-Text-Modus:

- **Formatierungs-Toolbar** (erscheint über dem Eingabefeld): **B**old, *I*talic, Aufzählung (UL), Nummerierung (OL).
- **Senden:** `Strg+Enter` (Enter erzeugt Zeilenumbruch).
- Die Formatierung wird beim Senden automatisch in **Markdown** umgewandelt (`**fett**`, `*kursiv*`, `- Liste`).
- Umschalten zurück zur Textarea mit erneutem Klick auf den Toggle-Button.

### Session-Statusbar

Am unteren Rand zeigt die Statusbar kontextuelle Informationen zur aktiven Session:

| Icon | Information |
|---|---|
| 🔌 | Anzahl verbundener MCP-Server |
| 🛠 | Anzahl aktiver Skills |
| 📋 | Anzahl geladener Instructions |
| 📂 | Aktuelles Arbeitsverzeichnis (CWD) — klickbar zum Wechseln |

> **Hinweis:** Das aktive KI-Modell wird nicht mehr in der Statusbar, sondern direkt im **🧠 Model-Button** der Session-Aktionsleiste angezeigt.

---

## Features im Detail

### Multi-Session Management

Sessions sind benannte Copilot CLI Sessions. Du kannst beliebig viele Sessions parallel in Tabs geöffnet haben.

| Aktion | Vorgehen |
|---|---|
| **Neue Session** | ➕-Tab klicken → Nachricht senden → Session wird automatisch erstellt |
| **Session fortsetzen** | In der Sidebar auf die Session-Karte klicken |
| **Session umbenennen** | Doppelklick auf den Tab-Titel oder Rechtsklick in der Sidebar |
| **Session löschen** | Hover über die Session-Karte → 🗑️ → Bestätigungsdialog |
| **CWD wählen (Statusbar)** | Klick auf 📂 in der Statusbar → Ordner-Auswahl-Dialog; CWD wird pro Session persistiert |
| **CWD wählen (Sidebar)** | Klick auf 📁 in der Session-Karte → Ordner-Auswahl-Dialog; persistiert und gilt beim nächsten Resume dieser Session |

### Chat

- Nachrichten werden als **Markdown** gerendert mit vollständigem Syntax-Highlighting (highlight.js).
- **„Thinking"-Blöcke** zeigen den Denkprozess der KI – aufklappbar für mehr Transparenz.
- **Tool-Calls** werden als aufklappbare Karten dargestellt, damit du sehen kannst welche Werkzeuge Copilot nutzt.
- **Export:** Über den Export-Button kannst du den gesamten Chat als HTML- oder Textdatei speichern.
- **Suche:** Mit `Strg+F` öffnest du die Chat-Suche zum Durchsuchen der gesamten Historie.

### Tutorial-Popups

Bei bestimmten Aktionen erscheinen einmalige Tutorial-Popups, die neue Features erklären:

| Popup | Auslöser | Auto-Schließen |
|---|---|---|
| **„Skills neu laden"** | Erster Klick auf den Reload-Button | Bei erneutem Reload oder nach 30 Sekunden |
| **„Tab umbenennen"** | Erster Doppelklick auf einen Tab-Titel | Nach erfolgreicher Umbenennung oder nach 30 Sekunden |

> Die Popups erscheinen jeweils nur beim ersten Mal. Danach werden sie nicht erneut angezeigt.

### Datei Drag & Drop

Ziehe Dateien direkt in den Chat-Bereich:

1. Datei(en) aus dem Explorer über das Chat-Fenster ziehen.
2. Ein **Drop-Overlay** zeigt an, dass die Datei akzeptiert wird.
3. Beim Loslassen werden die Dateipfade als Kontext an Copilot gesendet.

### Skills

Skills sind KI-Erweiterungen, die Copilot spezialisierte Fähigkeiten verleihen.

- Skills liegen als `SKILL.md`-Dateien im Verzeichnis `~/.copilot/skills/`.
  (Wird vom Setup-Skript automatisch angelegt; bei manueller Installation
  ggf. selbst erstellen: `mkdir ~/.copilot/skills`.)
- In der Sidebar kannst du Skills per **Toggle-Schalter** aktivieren und deaktivieren.
- Über den **⊘-Button** kannst du Skills auch global in der Copilot CLI deaktivieren. Der Status wird in `~/.copilot/settings.json` unter `disabledSkills` gespeichert und gilt CLI-weit.
- Aktive Skills werden als Prompt-Präfix in jede Nachricht injiziert.
- **Skill-Tags** unter jeder Chat-Nachricht zeigen, welche Skills zum Zeitpunkt des Sendens aktiv waren.
- **Projekt-Skills** (`Projekt`-Badge): Liegt im aktiven CWD unter `.github/skills/`, werden automatisch geladen und in der Sidebar mit einem „Projekt"-Badge markiert. Beim Tab-Wechsel oder CWD-Änderung werden sie neu eingelesen.

> **Eigene Skills erstellen:** Lege eine neue `.md`-Datei in `~/.copilot/skills/` an. Die Datei sollte den Skill-Namen, eine Beschreibung und die Prompt-Anweisungen enthalten.

### Agents

Agents sind spezialisierte Copilot-Sub-Agenten.

- **Sidebar-Badge** zeigt die Gesamtanzahl geladener Agents.
- **Projekt-Agents** (`Projekt`-Badge): Liegt das Projekt unter `.github/agents/`, werden die Agents beim Setzen des CWD automatisch geladen.

### MCP-Server (Sidebar)

Der MCP-Bereich zeigt alle konfigurierten Model Context Protocol-Server.

- **Badge** zeigt `verbunden/gesamt` (z. B. `2/3`).
- **Projekt-MCP** (`Projekt`-Badge): MCP-Server aus `.github/mcp.json` oder `.github/copilot-mcp.json` im aktiven CWD werden automatisch erkannt und mit einem „Projekt"-Badge markiert.

### Todos

Jede Session verfügt über eine eigene Todo-Liste. Todos werden in einer `todos.json` gespeichert.

| Aktion | Vorgehen |
|---|---|
| **Neues Todo** | Text eingeben → ➕ klicken oder `Enter` drücken |
| **Abhaken** | Checkbox klicken → Status wechselt zu „done" |
| **Löschen** | 🗑️-Button neben dem Todo |
| **Sortieren** | Drag & Drop innerhalb der Liste |
| **Sync** | 🔄-Button → Die ersten 5 offenen Todos werden als Prompt an Copilot gesendet und automatisch als erledigt markiert |

### Session-Actions

Die Session-Actions Bar bietet fünf wichtige Aktionen für die aktive Session:

#### 📊 Kontext anzeigen

Zeigt ein Popup mit der **Token-Auslastung** der aktuellen Session:

- **Farbcodierung:** 🟢 Grün (≤ 60 %), 🟡 Gelb (61–80 %), 🔴 Rot (> 80 %)
- **Kategorien:** System/Tools, Messages, Free Space, Buffer

> **Tipp:** Wenn die Auslastung im roten Bereich ist, nutze **Compact** oder **Clear**, um Platz zu schaffen.

#### 📐 Compact

Komprimiert die Session, indem die bisherige Chat-History zusammengefasst wird. Das reduziert die Token-Auslastung und gibt dem Kontext wieder Platz.

#### 🧹 Clear

Löscht den gesamten Session-Kontext. Die Chatverläufe in der Oberfläche bleiben sichtbar, aber Copilot hat keinen Kontext mehr aus vorherigen Nachrichten.

#### 🤖 Autopilot

Schaltet den Autopilot-Modus für den aktiven Tab ein oder aus. Wenn aktiviert (Button leuchtet grün), wird bei jedem Chat-Send das `--autopilot`-Flag an den Copilot CLI übergeben.

- **Pro-Tab-State:** Jeder Tab hat einen eigenen Autopilot-Status, der beim Tab-Wechsel korrekt wiederhergestellt wird.
- **Kein Reset durch Nachrichten:** Der Autopilot bleibt aktiv, bis er manuell deaktiviert wird.
- **Visuelles Feedback:** Der Button erhält die grüne Akzentfarbe wenn aktiv.

#### 🧠 Model

Öffnet ein Dropdown zur tab-spezifischen Modellauswahl. Das gewählte Modell wird als `--model`-Argument an den nächsten CLI-Aufruf übergeben.

- **Pro-Tab-State:** Jeder Tab hat ein eigenes ausgewähltes Modell (unabhängig von anderen Tabs).
- **Kein Reset durch Nachrichten:** Das gewählte Modell bleibt aktiv, bis ein anderes gewählt wird.
- **Visuelles Feedback:** Der Button zeigt den Kurznamen des gewählten Modells (z. B. „🧠 Sonnet 4.6").
- **Persistenz:** Das gewählte Modell wird session-spezifisch gespeichert und nach App-Neustart automatisch wiederhergestellt — auch für unbenannte Sessions.
- **Standard:** Ohne explizite Auswahl wird `claude-sonnet-4.6` verwendet.

### Session Resume

Beim Laden einer gespeicherten Session werden nur die **letzten Nachrichten** angezeigt – der vollständige Plan wird nicht mehr geladen. Das sorgt für eine übersichtlichere Darstellung beim Fortsetzen einer Session.

### Terminal

Copilot Desktop enthält ein vollwertiges integriertes Terminal (xterm.js):

1. **Öffnen:** Terminal-Button links neben der Chat-Eingabe klicken.
2. **Größe anpassen:** Am oberen Rand des Terminal-Panels vertikal ziehen.
3. **Minimieren/Schließen:** Über die Buttons in der Terminal-Leiste.

### Settings

Die Settings erreichst du über das ⚙️-Symbol im Sidebar-Footer. Es gibt vier Tabs:

#### UI-Tab

| Einstellung | Optionen |
|---|---|
| **Theme** | Light, Dark, GEBIT |
| **Chat-Schriftgröße** | 12–24 px (Schieberegler) |
| **Benachrichtigungston** | An / Aus |

#### Copilot Config-Tab

| Einstellung | Beschreibung |
|---|---|
| **Auto-Approve** | Alle Tool-Aufrufe automatisch genehmigen |
| **Erlaubte Tools** | Whitelist – nur diese Tools darf Copilot nutzen |
| **Verbotene Tools** | Blacklist – diese Tools werden blockiert |
| **Zusätzliche Verzeichnisse** | Extra Pfade, die Copilot durchsuchen darf |
| **Shell-Ausnahmen** | Befehle, die immer erlaubt sind (Bypass der Genehmigung) |

#### Ordner-Tab

Konfiguriert die Standard-Verzeichnisse für Sessions, Skills, Plugins und Drop-Files.

#### Tastenkürzel-Tab

Erlaubt das Anpassen aller konfigurierbaren Tastenkürzel (siehe Abschnitt
[Tastenkombinationen](#tastenkombinationen)). Klick auf **„Ändern"**, drücke die neue Kombination
(`Esc` bricht ab). **„🔄 Alle zurücksetzen"** stellt alle Defaults wieder her.

### Tastenkürzel-Hilfe

Das ⌨️-Symbol im Sidebar-Footer (oder `Ctrl+/`) öffnet ein Overlay mit allen aktuell aktiven
Tastenkürzeln, gruppiert nach Kategorie (Tabs, Chat, UI). Geänderte Kürzel werden farblich
hervorgehoben.

### Themes

Drei Themes stehen zur Verfügung, alle über CSS Custom Properties implementiert:

| Theme | Beschreibung |
|---|---|
| **Light** | Helles Standard-Theme |
| **Dark** | Dunkles Theme für augenschonendes Arbeiten |
| **GEBIT** | Corporate Theme von GEBIT Solutions |

Wechsel über: **Settings → UI → Theme**.

---

## Tastenkombinationen

Konfigurierbare Kürzel sind über **Settings → Tastenkürzel** anpassbar. Übersicht jederzeit
mit `Ctrl+/` oder dem ⌨️-Button.

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

> **Copilot Desktop v0.20.5** · Entwickelt für GEBIT Solutions

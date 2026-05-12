# 📘 Copilot Desktop – Benutzerhandbuch

**Version 0.10.1** · Electron-basierte Desktop-Anwendung für GitHub Copilot CLI

---

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Erste Schritte](#erste-schritte)
   - [Voraussetzungen](#voraussetzungen)
   - [Installation](#installation)
   - [Erster Chat](#erster-chat)
3. [Benutzeroberfläche](#benutzeroberfläche)
   - [Titlebar](#titlebar)
   - [Sidebar](#sidebar)
   - [Hauptbereich](#hauptbereich)
   - [Session-Statusbar](#session-statusbar)
4. [Features im Detail](#features-im-detail)
   - [Multi-Session Management](#multi-session-management)
   - [Chat](#chat)
   - [Datei Drag & Drop](#datei-drag--drop)
   - [Skills](#skills)
   - [Todos](#todos)
   - [Session-Actions](#session-actions)
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
│  🟢 Copilot Desktop          v0.10.1      _ □ ✕    │  ← Titlebar
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
- **Mitte:** Version-Badge (v0.10.1)
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

#### Session-Actions Bar

Direkt unter der Tab-Bar findest du drei Aktionen:

| Button | Aktion | Beschreibung |
|---|---|---|
| 📊 Kontext | Token-Auslastung anzeigen | Popup mit farbcodierter Auslastung und Kategorien |
| 📐 Compact | Session komprimieren | Fasst die bisherige Chat-History zusammen |
| 🧹 Clear | Session-Kontext löschen | Entfernt den gesamten Kontext der Session |

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
- **Senden-Button** (oder `Enter`).
- `Shift+Enter` für einen Zeilenumbruch innerhalb der Nachricht.

### Session-Statusbar

Am unteren Rand zeigt die Statusbar kontextuelle Informationen zur aktiven Session:

| Icon | Information |
|---|---|
| 🧠 | Aktives KI-Modell (z. B. „Claude Sonnet 4") |
| 🔌 | Anzahl verbundener MCP-Server |
| 🛠 | Anzahl aktiver Skills |
| 📋 | Anzahl geladener Instructions |
| 📂 | Aktuelles Arbeitsverzeichnis (CWD) |

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

### Chat

- Nachrichten werden als **Markdown** gerendert mit vollständigem Syntax-Highlighting (highlight.js).
- **„Thinking"-Blöcke** zeigen den Denkprozess der KI – aufklappbar für mehr Transparenz.
- **Tool-Calls** werden als aufklappbare Karten dargestellt, damit du sehen kannst welche Werkzeuge Copilot nutzt.
- **Export:** Über den Export-Button kannst du den gesamten Chat als HTML- oder Textdatei speichern.
- **Suche:** Mit `Strg+F` öffnest du die Chat-Suche zum Durchsuchen der gesamten Historie.

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
- Aktive Skills werden als Prompt-Präfix in jede Nachricht injiziert.
- **Skill-Tags** unter jeder Chat-Nachricht zeigen, welche Skills zum Zeitpunkt des Sendens aktiv waren.

> **Eigene Skills erstellen:** Lege eine neue `.md`-Datei in `~/.copilot/skills/` an. Die Datei sollte den Skill-Namen, eine Beschreibung und die Prompt-Anweisungen enthalten.

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

Die Session-Actions Bar bietet drei wichtige Aktionen für die aktive Session:

#### 📊 Kontext anzeigen

Zeigt ein Popup mit der **Token-Auslastung** der aktuellen Session:

- **Farbcodierung:** 🟢 Grün (≤ 60 %), 🟡 Gelb (61–80 %), 🔴 Rot (> 80 %)
- **Kategorien:** System/Tools, Messages, Free Space, Buffer

> **Tipp:** Wenn die Auslastung im roten Bereich ist, nutze **Compact** oder **Clear**, um Platz zu schaffen.

#### 📐 Compact

Komprimiert die Session, indem die bisherige Chat-History zusammengefasst wird. Das reduziert die Token-Auslastung und gibt dem Kontext wieder Platz.

#### 🧹 Clear

Löscht den gesamten Session-Kontext. Die Chatverläufe in der Oberfläche bleiben sichtbar, aber Copilot hat keinen Kontext mehr aus vorherigen Nachrichten.

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

> **Copilot Desktop v0.10.1** · Entwickelt für GEBIT Solutions

# Skills-Auswahl an der Sessionleiste

## Ziel
Ein Skills-Button in der Sessionleiste zeigt die fuer den aktiven Tab
verfuegbaren Skills als Dropdown oberhalb des Eingabebereichs.

## Genehmigte Anforderungen
- Pro Skill vorhandenes Icon (Fallback 🧩), Name und ein zugaenglicher Ein/Aus-Toggle; keine Beschreibung. Der Skills-Button zeigt ebenfalls 🧩.
- Auswahl ist tabbezogen und verwendet die vorhandene activeSkills-Logik
  sowie die bestehende Prompt-Anreicherung, keinen zweiten Auswahlzustand.
- Eingeschaltete Skills werden den folgenden Prompts angehaengt, bis sie
  ausgeschaltet werden. Der Button zeigt die Anzahl ausgewaehlter Skills.
- Tab-/Projekt-/Providerwechsel aktualisiert Liste und Auswahl; Laden,
  Fehler und eine leere Liste werden explizit angezeigt.
- Dropdown bleibt bei vielen Skills scrollbar und innerhalb des Fensters;
  Tastaturbedienung, Escape und Schliessen bei Klick ausserhalb funktionieren.
- Bestehende Skills-Verwaltung unter Funktionen bleibt erhalten und mit
  den Toggles synchron. Keine Aenderung an automatischer Skill-Erkennung.

## Aufgaben nach Freigabe
- [x] Skills-Button neben Auto in die Sessionleiste aufnehmen.
- [x] Dropdown auf vorhandene Skill-Daten und Auswahl verdrahten.
- [x] Prompt-Anreicherung und Synchronisierung ueber Tabwechsel pruefen.
- [x] Zugaenglichkeit, Layout und Verhalten testen; Dokumentation aktualisieren.

## Status
Genehmigt und implementiert; isolierte Tests ohne Start der Nutzer-App.

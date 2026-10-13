# Neuer Chat in der Sidebar

Direkt oberhalb von „Funktionen“ soll ein Button „+ Neuer Chat“ stehen.
Er verwendet dieselbe Provider-Auswahl und Chat-Erstellung wie der vorhandene
Plus-Button in der Tabzeile. Der Plus-Button und Ctrl+T bleiben erhalten.
Beim Erstellen wird der neue Chat geöffnet, auch aus der Funktionsansicht.
Bestehende Chats und Entwürfe bleiben unverändert.

Technischer Ansatz: Sidebar-Markup und vorhandenes Button-Styling nutzen;
den neuen Button an `openAddTabProviderMenu` mit seiner eigenen Position
anbinden. Keine neue Backend- oder Sitzungslogik.

Status: 2026-10-12, bestätigt und umgesetzt. Gezielter Electron-Test
für Position, Provider-Auswahl und neuen Chat aus der Funktionsseite erfolgreich.

# Agent Desktop — Setup
# Installiert Dependencies und erstellt Desktop-Verknüpfung.
# Keine Admin-Rechte erforderlich.

$ErrorActionPreference = "Stop"
$appRoot = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [ERROR] $msg" -ForegroundColor Red }

Write-Host "`n===========================================" -ForegroundColor Magenta
Write-Host "  Agent Desktop — Setup" -ForegroundColor Magenta
Write-Host "===========================================`n" -ForegroundColor Magenta

# ── 1. Node.js prüfen ────────────────────────────────────────
Write-Step "Node.js prüfen..."
# Get-Command statt direktem Aufruf: löst bei fehlendem Node KEINEN
# terminierenden Fehler aus (ErrorActionPreference=Stop) → freundliche Meldung.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js nicht gefunden."
    Write-Host "  Bitte installiere Node.js 18+ von https://nodejs.org/" -ForegroundColor White
    Write-Host "  und oeffne danach das Terminal neu (PATH aktualisieren)." -ForegroundColor White
    exit 1
}
$nodeVersion = & node --version
$major = [int]($nodeVersion -replace 'v(\d+).*','$1')
if ($major -ge 18) {
    Write-OK "Node.js $nodeVersion"
} else {
    Write-Fail "Node.js $nodeVersion ist zu alt (mind. 18 benötigt)."
    Write-Host "  Bitte installiere Node.js 18+ von https://nodejs.org/" -ForegroundColor White
    exit 1
}

# ── 2. npm install ───────────────────────────────────────────
Write-Step "Dependencies installieren (npm install)..."
Set-Location $appRoot
npm install 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install fehlgeschlagen."
    Write-Host "  Versuche manuell: npm install" -ForegroundColor White
    exit 1
}
Write-OK "Dependencies installiert."

# ── 3. Desktop-Verknüpfung erstellen ─────────────────────────
Write-Step "Desktop-Verknüpfung erstellen..."

$electronExe = Join-Path $appRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Fail "electron.exe nicht gefunden unter: $electronExe"
    exit 1
}

$iconPath = Join-Path $appRoot "assets\icon.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Agent Desktop.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronExe
$shortcut.Arguments = "."
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = "$iconPath, 0"
$shortcut.Description = "Agent Desktop"
$shortcut.Save()

Write-OK "Verknüpfung erstellt: $shortcutPath"

# ── Fertig ───────────────────────────────────────────────────
Write-Host "`n===========================================" -ForegroundColor Green
Write-Host "  Setup abgeschlossen!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host "`n  Starte die App über die Desktop-Verknüpfung" -ForegroundColor White
Write-Host "  oder mit: npm start`n" -ForegroundColor White

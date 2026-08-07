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

# ── 1. Node.js prüfen (und bei Bedarf installieren) ──────────
Write-Step "Node.js prüfen..."

function Update-PathFromEnvironment {
    # Nach einer Installation kennt die laufende Session den neuen PATH noch nicht.
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machine, $user | Where-Object { $_ }) -join ';'
}

# Get-Command statt direktem Aufruf: löst bei fehlendem Node KEINEN
# terminierenden Fehler aus (ErrorActionPreference=Stop).
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Node.js nicht gefunden — versuche automatische Installation via winget..." -ForegroundColor White
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        try {
            winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        } catch {
            Write-Host "  winget-Installation nicht abgeschlossen: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
        Update-PathFromEnvironment
    } else {
        Write-Host "  winget ist auf diesem System nicht verfügbar." -ForegroundColor DarkYellow
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js nicht gefunden / Auto-Installation fehlgeschlagen."
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

# ── 3. Electron-Binary prüfen ────────────────────────────────
# `npm install` installiert bei electron nur den JS-Wrapper — das eigentliche
# ~100+ MB große Binary lädt ein Postinstall-Skript separat von GitHub
# Releases herunter. Dieser Download schlägt in Firmennetzwerken (Firewall/
# Proxy blockiert GitHub) öfter mal fehl, ohne dass npm install das immer als
# Fehler-Exitcode zurückmeldet — deshalb hier ein expliziter Check statt dem
# Exitcode von Schritt 2 blind zu vertrauen.
Write-Step "Electron-Binary prüfen..."

$electronExe = Join-Path $appRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "  Electron-Binary fehlt — Download ist vermutlich fehlgeschlagen (z.B. Firewall/Proxy blockiert GitHub Releases)." -ForegroundColor DarkYellow
    Write-Host "  Versuche gezielten Nach-Download..." -ForegroundColor White
    npm install electron --force 2>&1 | Out-Null

    if (-not (Test-Path $electronExe)) {
        Write-Fail "electron.exe weiterhin nicht gefunden unter: $electronExe"
        Write-Host "  Mögliche Ursachen und Lösungen:" -ForegroundColor White
        Write-Host "    - Firewall/Proxy blockiert den Download von github.com/electron/electron/releases." -ForegroundColor White
        Write-Host "      Falls im Unternehmensnetzwerk ein Spiegel-Server für Electron-Binaries existiert," -ForegroundColor White
        Write-Host "      vor erneutem Ausführen setzen: `$env:ELECTRON_MIRROR = 'https://...'" -ForegroundColor White
        Write-Host "    - Hinter einem Proxy: `$env:ELECTRON_GET_USE_PROXY = '1'" -ForegroundColor White
        Write-Host "    - Danach erneut versuchen: npm install electron --force" -ForegroundColor White
        exit 1
    }
    Write-OK "Electron-Binary beim zweiten Versuch erfolgreich geladen."
} else {
    Write-OK "Electron-Binary vorhanden."
}

# ── 4. Desktop-Verknüpfung erstellen ─────────────────────────
Write-Step "Desktop-Verknüpfung erstellen..."

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

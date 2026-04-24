# Copilot Desktop — Setup Script
# Run as Administrator for best results

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [ERROR] $msg" -ForegroundColor Red }

Write-Host "`n===========================================" -ForegroundColor Magenta
Write-Host "  Copilot Desktop — Setup" -ForegroundColor Magenta
Write-Host "===========================================`n" -ForegroundColor Magenta

# ── 1. Node.js ───────────────────────────────────────────────
Write-Step "Checking Node.js..."
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    $major = [int]($nodeVersion -replace 'v(\d+).*','$1')
    if ($major -ge 18) {
        Write-OK "Node.js $nodeVersion already installed."
    } else {
        Write-Warn "Node.js $nodeVersion is too old (need 18+). Installing latest..."
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        Write-OK "Node.js installed. Please restart this script."
        exit 0
    }
} else {
    Write-Warn "Node.js not found. Installing..."
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Write-OK "Node.js installed. Please restart this script."
    exit 0
}

# ── 2. Windows Build Tools ───────────────────────────────────
Write-Step "Checking Windows Build Tools..."
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = $false
if (Test-Path $vswhere) {
    $vs = & $vswhere -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 -format json 2>$null | ConvertFrom-Json
    if ($vs) { $hasBuildTools = $true }
}
if ($hasBuildTools) {
    Write-OK "Windows Build Tools already installed."
} else {
    Write-Warn "Windows Build Tools not found. Installing Visual Studio Build Tools..."
    winget install Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
        --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    Write-OK "Windows Build Tools installed."
}

# ── 3. GitHub Copilot CLI ────────────────────────────────────
Write-Step "Checking GitHub Copilot CLI..."
$ghVersion = gh --version 2>$null
if ($ghVersion) {
    Write-OK "GitHub CLI already installed: $($ghVersion | Select-Object -First 1)"
} else {
    Write-Warn "GitHub CLI not found. Installing..."
    winget install GitHub.cli --silent --accept-package-agreements --accept-source-agreements
    Write-OK "GitHub CLI installed."
}

# Check Copilot extension
Write-Step "Checking GitHub Copilot CLI extension..."
$copilotCheck = gh extension list 2>$null | Select-String "copilot"
if ($copilotCheck) {
    Write-OK "Copilot CLI extension already installed."
} else {
    Write-Warn "Copilot CLI extension not found. Installing..."
    gh extension install github/gh-copilot
    Write-OK "Copilot CLI extension installed."
}

# ── 4. npm install + rebuild ─────────────────────────────────
Write-Step "Installing Node.js dependencies..."
npm install
Write-OK "Dependencies installed and native modules rebuilt."

# ── 5. Auth check ────────────────────────────────────────────
Write-Step "Checking GitHub authentication..."
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "GitHub CLI is authenticated."
} else {
    Write-Warn "Not authenticated. Please run:"
    Write-Host "`n    gh auth login`n" -ForegroundColor White
    Write-Host "  Then restart the app with: npm start" -ForegroundColor White
    exit 0
}

# ── Done ─────────────────────────────────────────────────────
Write-Host "`n===========================================" -ForegroundColor Green
Write-Host "  Setup complete! Starting Copilot Desktop..." -ForegroundColor Green
Write-Host "===========================================`n" -ForegroundColor Green

npm start

# Copilot Desktop — Setup Script
# No administrator rights required.

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
        Write-Warn "Node.js $nodeVersion is too old (need 18+). Installing latest (user scope)..."
        winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements
        Write-OK "Node.js installed. Please restart this script."
        exit 0
    }
} else {
    Write-Warn "Node.js not found. Installing (user scope)..."
    winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements
    Write-OK "Node.js installed. Please restart this script."
    exit 0
}

# ── 2. GitHub CLI ────────────────────────────────────────────
Write-Step "Checking GitHub CLI..."
$ghVersion = gh --version 2>$null
if ($ghVersion) {
    Write-OK "GitHub CLI already installed: $($ghVersion | Select-Object -First 1)"
} else {
    Write-Warn "GitHub CLI not found. Installing (user scope)..."
    winget install GitHub.cli --scope user --silent --accept-package-agreements --accept-source-agreements
    Write-OK "GitHub CLI installed."
}

# ── 3. Copilot CLI extension ─────────────────────────────────
Write-Step "Checking GitHub Copilot CLI extension..."
$copilotCheck = gh extension list 2>$null | Select-String "copilot"
if ($copilotCheck) {
    Write-OK "Copilot CLI extension already installed."
} else {
    Write-Warn "Copilot CLI extension not found. Installing..."
    gh extension install github/gh-copilot
    Write-OK "Copilot CLI extension installed."
}

# ── 4. npm install ───────────────────────────────────────────
Write-Step "Installing Node.js dependencies..."
Write-Host "  (Using prebuilt native binaries — no compiler required)" -ForegroundColor DarkGray
$npmResult = npm install 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "npm install encountered issues. If native module compilation failed,"
    Write-Warn "Windows Build Tools may be required (needs administrator rights)."
    Write-Host "`n  See: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor White
    Write-Host "  Then run: npm run rebuild`n" -ForegroundColor White
    exit 1
}
Write-OK "Dependencies installed successfully."

# ── 5. Auth check ────────────────────────────────────────────
Write-Step "Checking GitHub authentication..."
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "GitHub CLI is authenticated."
} else {
    Write-Warn "Not authenticated yet. Please run:"
    Write-Host "`n    gh auth login`n" -ForegroundColor White
    Write-Host "  Then start the app with: npm start" -ForegroundColor White
    exit 0
}

# ── Done ─────────────────────────────────────────────────────
Write-Host "`n===========================================" -ForegroundColor Green
Write-Host "  Setup complete! Starting Copilot Desktop..." -ForegroundColor Green
Write-Host "===========================================`n" -ForegroundColor Green

npm start

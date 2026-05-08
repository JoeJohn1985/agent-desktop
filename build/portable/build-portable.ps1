<#
.SYNOPSIS
    Builds a portable ZIP bundle of Copilot Desktop for Windows.

.DESCRIPTION
    Local equivalent of the GitHub Actions release workflow. Produces
    dist-portable\copilot-desktop-vX.Y.Z-portable.zip:

      copilot-desktop-vX.Y.Z-portable\
      ├── start.bat
      ├── PORTABLE_README.txt
      ├── VERSION.txt
      ├── app\                    (electron-builder --dir output)
      └── tools\gh\bin\gh.exe     (portable GitHub CLI)

    Every step is logged to dist-portable\build-YYYYMMDD-HHMMSS.log.

.PARAMETER GhVersion
    Version of cli/cli (gh) to download. Defaults to 2.65.0.

.PARAMETER SkipGh
    Skip the gh download step (useful for fast local iterations once
    tools\gh is already populated from a previous run).

.EXAMPLE
    pwsh build\portable\build-portable.ps1
#>
[CmdletBinding()]
param(
    [string]$GhVersion = '2.65.0',
    [switch]$SkipGh
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$distRoot = Join-Path $repoRoot 'dist-portable'
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

$ts      = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $distRoot "build-$ts.log"

function Write-Log {
    param([string]$Msg, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Msg
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Log "==== $Name ===="
    try {
        & $Action
        Write-Log "OK: $Name"
    } catch {
        Write-Log "FAILED: $Name -- $($_.Exception.Message)" 'ERROR'
        Write-Log $_.ScriptStackTrace 'ERROR'
        throw
    }
}

Write-Log "Repo root : $repoRoot"
Write-Log "Dist root : $distRoot"
Write-Log "Log file  : $logFile"

# --- 1. Read version --------------------------------------------------------
$pkg     = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$bundleName = "copilot-desktop-v$version-portable"
$stage      = Join-Path $distRoot $bundleName
Write-Log "App version : $version"
Write-Log "Stage dir   : $stage"

# --- 2. Clean stage ---------------------------------------------------------
Invoke-Step 'Clean stage directory' {
    if (Test-Path $stage)            { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
}

# --- 3. electron-builder ----------------------------------------------------
Invoke-Step 'Run electron-builder --win dir' {
    & npx --no-install electron-builder --win dir 2>&1 |
        ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "electron-builder exited with $LASTEXITCODE" }

    $ebOut = Join-Path $repoRoot 'dist\win-unpacked'
    if (-not (Test-Path $ebOut)) { throw "electron-builder output not found: $ebOut" }

    Copy-Item -Recurse -Force $ebOut (Join-Path $stage 'app')
}

# --- 4. Portable gh ---------------------------------------------------------
Invoke-Step "Fetch portable gh v$GhVersion" {
    $ghStage = Join-Path $stage 'tools\gh'
    New-Item -ItemType Directory -Force -Path $ghStage | Out-Null

    if ($SkipGh) {
        $cached = Join-Path $repoRoot 'dist-portable\_cache\gh'
        if (-not (Test-Path $cached)) { throw "SkipGh set but cache empty: $cached" }
        Copy-Item -Recurse -Force "$cached\*" $ghStage
        return
    }

    $url = "https://github.com/cli/cli/releases/download/v$GhVersion/gh_${GhVersion}_windows_amd64.zip"
    $zip = Join-Path $distRoot "_cache\gh_${GhVersion}_windows_amd64.zip"
    New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null

    if (-not (Test-Path $zip)) {
        Write-Log "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $zip
    } else {
        Write-Log "Using cached $zip"
    }

    $extract = Join-Path $distRoot "_cache\gh_${GhVersion}_extracted"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract -Force

    $inner = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
    if (-not $inner) { throw "Unexpected gh archive layout under $extract" }
    Copy-Item -Recurse -Force "$($inner.FullName)\*" $ghStage

    $cache = Join-Path $repoRoot 'dist-portable\_cache\gh'
    if (Test-Path $cache) { Remove-Item -Recurse -Force $cache }
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    Copy-Item -Recurse -Force "$ghStage\*" $cache
}

# --- 5. Copy launcher + docs ------------------------------------------------
Invoke-Step 'Copy start.bat, README, VERSION.txt' {
    Copy-Item -Force (Join-Path $PSScriptRoot 'start.bat')           (Join-Path $stage 'start.bat')
    Copy-Item -Force (Join-Path $PSScriptRoot 'PORTABLE_README.txt') (Join-Path $stage 'PORTABLE_README.txt')
    Set-Content -Path (Join-Path $stage 'VERSION.txt') -Value @"
copilot-desktop $version
built  : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ssK')
host   : $env:COMPUTERNAME
gh     : v$GhVersion
"@
}

# --- 6. Zip -----------------------------------------------------------------
$zipOut = Join-Path $distRoot "$bundleName.zip"
Invoke-Step "Create $zipOut" {
    if (Test-Path $zipOut) { Remove-Item -Force $zipOut }
    Compress-Archive -Path $stage -DestinationPath $zipOut -CompressionLevel Optimal
}

Write-Log "==== DONE ===="
Write-Log "Bundle : $zipOut"
Write-Log "Size   : $([math]::Round((Get-Item $zipOut).Length / 1MB, 1)) MB"
Write-Host ""
Write-Host "Bundle ready: $zipOut"

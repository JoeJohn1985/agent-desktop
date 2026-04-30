@echo off
REM ═══════════════════════════════════════════════════════════
REM  Copilot Desktop — Bootstrap Setup
REM  Downloads portable PowerShell if needed, then runs setup.ps1
REM ═══════════════════════════════════════════════════════════

title Copilot Desktop Setup

set "PWSH_DIR=%~dp0vendor\pwsh"
set "PWSH_EXE=%PWSH_DIR%\pwsh.exe"
set "PWSH_VERSION=7.5.5"
set "PWSH_ZIP=%TEMP%\pwsh-%PWSH_VERSION%-win-x64.zip"
set "PWSH_URL=https://github.com/PowerShell/PowerShell/releases/download/v%PWSH_VERSION%/PowerShell-%PWSH_VERSION%-win-x64.zip"

echo.
echo  ╔═══════════════════════════════════════╗
echo  ║   Copilot Desktop — Setup            ║
echo  ╚═══════════════════════════════════════╝
echo.

REM ── Check if bundled pwsh exists ──────────────────────────
if exist "%PWSH_EXE%" (
    echo  [OK] Bundled PowerShell found.
    goto :run_setup
)

REM ── Download PowerShell portable ──────────────────────────
echo  [..] PowerShell not found. Downloading v%PWSH_VERSION%...
echo       URL: %PWSH_URL%
echo.

if not exist "%PWSH_DIR%" mkdir "%PWSH_DIR%"

REM Use curl (available on Windows 10+)
curl -L -o "%PWSH_ZIP%" "%PWSH_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] Download failed. Please check your internet connection.
    echo          You can manually download PowerShell from:
    echo          https://github.com/PowerShell/PowerShell/releases
    pause
    exit /b 1
)

echo  [..] Extracting PowerShell...
REM Use tar (available on Windows 10+)
tar -xf "%PWSH_ZIP%" -C "%PWSH_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo  [..] tar failed, trying PowerShell expand...
    powershell -NoProfile -Command "Expand-Archive -Path '%PWSH_ZIP%' -DestinationPath '%PWSH_DIR%' -Force"
)

del "%PWSH_ZIP%" 2>nul

if exist "%PWSH_EXE%" (
    echo  [OK] PowerShell %PWSH_VERSION% installed to vendor\pwsh\
) else (
    echo  [ERROR] Extraction failed. Please extract manually:
    echo          %PWSH_URL%
    echo          into: %PWSH_DIR%\
    pause
    exit /b 1
)

:run_setup
echo.
echo  [..] Running setup.ps1 with bundled PowerShell...
echo.
"%PWSH_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Setup finished with errors. See above for details.
    pause
)

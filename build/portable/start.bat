@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Copilot Desktop - Portable Launcher
REM  Bootstraps gh auth + gh-copilot extension, then starts app.
REM  All steps are logged to %LOCALAPPDATA%\copilot-desktop\logs\
REM ============================================================

set "BUNDLE_ROOT=%~dp0"
set "CURRENT_DIR=%BUNDLE_ROOT%current"
set "STAGED_DIR=%BUNDLE_ROOT%_staged"
set "OLD_DIR=%BUNDLE_ROOT%_old"
set "PENDING_FILE=%STAGED_DIR%\pending-update.json"
set "APP_ROOT=%CURRENT_DIR%\"
set "GH_BIN=%APP_ROOT%tools\gh\bin"
set "PATH=%GH_BIN%;%PATH%"

REM --- Prepare log file -----------------------------------------------------
set "LOG_DIR=%LOCALAPPDATA%\copilot-desktop\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "LDT=%%I"
if defined LDT (
    set "TS=!LDT:~0,8!-!LDT:~8,6!"
) else (
    set "TS=%RANDOM%"
)
set "LOG_FILE=%LOG_DIR%\start-%TS%.log"

call :log "==== Copilot Desktop Portable Launcher ===="
call :log "Timestamp     : %DATE% %TIME%"
call :log "Bundle root   : %BUNDLE_ROOT%"
call :log "Current dir   : %CURRENT_DIR%"
call :log "Staged dir    : %STAGED_DIR%"
call :log "Log file      : %LOG_FILE%"
call :log "User          : %USERNAME%"
call :log "Computer      : %COMPUTERNAME%"
call :log "OS            : %OS%"

REM --- Apply pending update (atomic switch) ---------------------------------
REM If the in-app updater has staged a new version under _staged\, swap it
REM into place BEFORE starting the app. Layout stays atomic: at any moment
REM either the old or the new "current" exists; never a half-written state.
if exist "%PENDING_FILE%" call :apply_pending_update

call :log "PATH (head)   : %GH_BIN%"

REM --- Sanity checks --------------------------------------------------------
if not exist "%APP_ROOT%app\copilot-desktop.exe" (
    call :log "[ERROR] app\copilot-desktop.exe not found under %APP_ROOT%app\"
    call :fail "Bundle scheint unvollstaendig: current\app\copilot-desktop.exe fehlt."
    goto :end
)
if not exist "%GH_BIN%\gh.exe" (
    call :log "[ERROR] gh.exe not found under %GH_BIN%"
    call :fail "Bundle scheint unvollstaendig: current\tools\gh\bin\gh.exe fehlt."
    goto :end
)

REM --- Log gh version -------------------------------------------------------
call :log "---- gh --version ----"
"%GH_BIN%\gh.exe" --version >> "%LOG_FILE%" 2>&1

REM --- Auth check -----------------------------------------------------------
call :log "---- gh auth status ----"
"%GH_BIN%\gh.exe" auth status >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    call :log "[INFO] No active gh auth session - launching interactive login."
    echo.
    echo Erstmaliger Login zu GitHub erforderlich...
    echo Es oeffnet sich ein Browser-Fenster.
    echo.
    "%GH_BIN%\gh.exe" auth login --web --hostname github.com
    set "AUTH_RC=!errorlevel!"
    call :log "gh auth login exit code: !AUTH_RC!"
    if not "!AUTH_RC!"=="0" (
        call :fail "GitHub-Login fehlgeschlagen (exit !AUTH_RC!). Details im Log."
        goto :end
    )
) else (
    call :log "[OK] gh auth session active."
)

REM --- gh-copilot extension -------------------------------------------------
call :log "---- gh extension list ----"
"%GH_BIN%\gh.exe" extension list >> "%LOG_FILE%" 2>&1
"%GH_BIN%\gh.exe" extension list 2>nul | findstr /i "github/gh-copilot" >nul
if errorlevel 1 (
    call :log "[INFO] gh-copilot extension missing - installing."
    echo.
    echo Installiere gh-copilot Extension...
    "%GH_BIN%\gh.exe" extension install github/gh-copilot >> "%LOG_FILE%" 2>&1
    set "EXT_RC=!errorlevel!"
    call :log "gh extension install exit code: !EXT_RC!"
    if not "!EXT_RC!"=="0" (
        call :fail "Installation der gh-copilot Extension fehlgeschlagen (exit !EXT_RC!). Details im Log."
        goto :end
    )
) else (
    call :log "[OK] gh-copilot extension already installed."
)

REM --- Launch app -----------------------------------------------------------
call :log "---- Starting copilot-desktop.exe ----"
start "" "%APP_ROOT%app\copilot-desktop.exe"
call :log "Launcher finished, app started detached."

goto :end

REM --- Helpers --------------------------------------------------------------
:log
echo [%DATE% %TIME%] %~1 >> "%LOG_FILE%"
exit /b 0

:fail
echo.
echo *** FEHLER ***
echo %~1
echo.
echo Vollstaendiges Log: %LOG_FILE%
echo.
pause
exit /b 1

:apply_pending_update
call :log "---- Pending update detected ----"
type "%PENDING_FILE%" >> "%LOG_FILE%" 2>&1

set "STAGED_VER_DIR="
for /d %%D in ("%STAGED_DIR%\v*") do set "STAGED_VER_DIR=%%~fD"
if not defined STAGED_VER_DIR (
    call :log "[WARN] pending-update.json present but no v*\ folder under _staged\ - clearing marker."
    del /q "%PENDING_FILE%" >nul 2>&1
    exit /b 0
)
call :log "Staged version dir: %STAGED_VER_DIR%"

if exist "%OLD_DIR%" (
    call :log "Removing leftover _old\"
    rmdir /s /q "%OLD_DIR%" >nul 2>&1
)

if exist "%CURRENT_DIR%" (
    ren "%CURRENT_DIR%" "_old"
    if errorlevel 1 (
        call :log "[ERROR] Failed to rename current\ to _old\ (file lock?). Aborting switch."
        exit /b 1
    )
)
move /y "%STAGED_VER_DIR%" "%CURRENT_DIR%" >nul 2>&1
if errorlevel 1 (
    call :log "[ERROR] Failed to promote staged version. Rolling back."
    if exist "%OLD_DIR%" ren "%OLD_DIR%" "current"
    exit /b 1
)
del /q "%PENDING_FILE%" >nul 2>&1
call :log "[OK] Switch complete. Cleaning up _old\ in background."
start "" /b cmd /c "timeout /t 2 >nul & rmdir /s /q "%OLD_DIR%" >nul 2>&1"
exit /b 0

:end
endlocal

@echo off
REM SSH_ASKPASS helper, see main.js sshPasswordEnv. Deliberately does NOT
REM read the password via cmd.exe percent-expansion anywhere on this page,
REM not even in a comment: cmd.exe expands every "percent variable percent"
REM occurrence while reading a line, comment or not, then re-parses the
REM result for command separators like ampersand/pipe/redirect. A password
REM containing one of those would otherwise run as a second command instead
REM of being printed. PowerShell reads the variable as a plain string value
REM instead, so its content is never re-tokenized as code.
powershell -NoProfile -NonInteractive -Command "Write-Output $env:AGENT_DESKTOP_SSH_PW"

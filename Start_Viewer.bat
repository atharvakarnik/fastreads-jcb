@echo off
setlocal

cd /d "%~dp0"

set "URL=http://127.0.0.1:8000/"

where py >nul 2>&1
if not errorlevel 1 (
  set "PY=py -3"
) else (
  set "PY=python"
)

%PY% --version >nul 2>&1
if errorlevel 1 (
  echo Python 3.10+ is required but no Python interpreter was found.
  echo https://www.python.org/downloads/
  pause
  exit /b 1
)

%PY% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
  echo Python 3.10+ is required.
  %PY% --version
  pause
  exit /b 1
)

if not exist ui\dist\index.html (
  echo The prebuilt viewer files are missing from ui\dist\.
  echo Download a complete FastReads JCB shipment and try again.
  pause
  exit /b 1
)

echo Starting FastReads JCB server...
start "FastReads JCB Server" cmd /k %PY% server.py

echo Waiting for server...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(15); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/'; if($r.StatusCode -eq 200 -and $r.Content -match 'FastReads JCB' -and $r.Content -match '/assets/'){ exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1"
if errorlevel 1 (
  echo The server at %URL% did not respond with the current viewer UI.
  echo This usually means another server is already running on port 8000.
  pause
  exit /b 1
)

set "RUN_URL=%URL%?v=%RANDOM%%RANDOM%"

echo Opening viewer...
start "" "%RUN_URL%"

echo.
echo FastReads JCB started at:
echo   %RUN_URL%
echo.
echo Do not close the "FastReads JCB Server" window while using the viewer.
endlocal

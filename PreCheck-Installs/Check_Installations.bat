@echo off
setlocal EnableExtensions

set "OUTPUT_FILE=%~dp0install_this.txt"
set "PYTHON_OK=0"
set "PYTHON_DETAILS=Not detected"
set "BROWSER_OK=0"
set "BROWSER_DETAILS=Not detected"
set "PACKAGE_OK=0"
set "NEEDS_ACTION=0"

where py >nul 2>&1
if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_OK=1"
        for /f "delims=" %%V in ('py -3 --version 2^>^&1') do set "PYTHON_DETAILS=%%V (py -3)"
    ) else (
        for /f "delims=" %%V in ('py -3 --version 2^>^&1') do set "PYTHON_DETAILS=%%V (py -3)"
    )
)

if "%PYTHON_OK%"=="0" (
    where python >nul 2>&1
    if not errorlevel 1 (
        python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
        if not errorlevel 1 (
            set "PYTHON_OK=1"
            for /f "delims=" %%V in ('python --version 2^>^&1') do set "PYTHON_DETAILS=%%V (python)"
        ) else (
            for /f "delims=" %%V in ('python --version 2^>^&1') do set "PYTHON_DETAILS=%%V (python)"
        )
    )
)

if "%BROWSER_OK%"=="0" (
    where msedge >nul 2>&1
    if not errorlevel 1 (
        set "BROWSER_OK=1"
        set "BROWSER_DETAILS=Microsoft Edge"
    )
)
if "%BROWSER_OK%"=="0" (
    where chrome >nul 2>&1
    if not errorlevel 1 (
        set "BROWSER_OK=1"
        set "BROWSER_DETAILS=Google Chrome"
    )
)
if "%BROWSER_OK%"=="0" (
    where firefox >nul 2>&1
    if not errorlevel 1 (
        set "BROWSER_OK=1"
        set "BROWSER_DETAILS=Mozilla Firefox"
    )
)

if "%BROWSER_OK%"=="0" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Microsoft Edge"
)
if "%BROWSER_OK%"=="0" if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Microsoft Edge"
)
if "%BROWSER_OK%"=="0" if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Google Chrome"
)
if "%BROWSER_OK%"=="0" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Google Chrome"
)
if "%BROWSER_OK%"=="0" if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Mozilla Firefox"
)
if "%BROWSER_OK%"=="0" if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" (
    set "BROWSER_OK=1"
    set "BROWSER_DETAILS=Mozilla Firefox"
)

if exist "%~dp0..\ui\dist\index.html" set "PACKAGE_OK=1"

if "%PYTHON_OK%"=="0" set "NEEDS_ACTION=1"
if "%BROWSER_OK%"=="0" set "NEEDS_ACTION=1"
if "%PACKAGE_OK%"=="0" set "NEEDS_ACTION=1"

>"%OUTPUT_FILE%" echo FASTREADS-JCB PRECHECK
>>"%OUTPUT_FILE%" echo.

if "%NEEDS_ACTION%"=="0" goto write_ready

>>"%OUTPUT_FILE%" echo ACTION NEEDED
>>"%OUTPUT_FILE%" echo.
if "%PYTHON_OK%"=="0" goto write_install_header
if "%BROWSER_OK%"=="0" goto write_install_header
>>"%OUTPUT_FILE%" echo No software installation is needed.
>>"%OUTPUT_FILE%" echo.
goto write_package_issue

:write_install_header
>>"%OUTPUT_FILE%" echo IT: Install or update:
if "%PYTHON_OK%"=="0" >>"%OUTPUT_FILE%" echo - Python 3.10+; make py or python available on PATH.
if "%PYTHON_OK%"=="0" >>"%OUTPUT_FILE%" echo   Found: %PYTHON_DETAILS%
if "%BROWSER_OK%"=="0" >>"%OUTPUT_FILE%" echo - Current Chrome, Edge, or Firefox with WebGL2.
>>"%OUTPUT_FILE%" echo Node.js/npm: not required.
>>"%OUTPUT_FILE%" echo.

:write_package_issue
if "%PACKAGE_OK%"=="1" goto write_footer
>>"%OUTPUT_FILE%" echo VIEWER PACKAGE ISSUE:
>>"%OUTPUT_FILE%" echo - Missing ui\dist\index.html. Replace this with a complete shipment.
>>"%OUTPUT_FILE%" echo.
goto write_footer

:write_ready
>>"%OUTPUT_FILE%" echo READY - no software installation is needed.
>>"%OUTPUT_FILE%" echo Found: %PYTHON_DETAILS%; %BROWSER_DETAILS%
>>"%OUTPUT_FILE%" echo Node.js/npm: not required.
>>"%OUTPUT_FILE%" echo.
>>"%OUTPUT_FILE%" echo Next: return to the main folder and open Start_Viewer.
goto show_report

:write_footer
>>"%OUTPUT_FILE%" echo After resolving the items above, run this checker again.

:show_report
echo.
type "%OUTPUT_FILE%"
echo.
echo Report written to:
echo %OUTPUT_FILE%
echo.
pause

set "RESULT=%NEEDS_ACTION%"
endlocal & exit /b %RESULT%

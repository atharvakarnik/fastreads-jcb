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
        for /f "delims=" %%V in ('py -3 --version 2^>^&1') do set "PYTHON_DETAILS=%%V (Python 3.10 or newer is required)"
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
            for /f "delims=" %%V in ('python --version 2^>^&1') do set "PYTHON_DETAILS=%%V (Python 3.10 or newer is required)"
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

>"%OUTPUT_FILE%" echo FastReads-JCB installation check
>>"%OUTPUT_FILE%" echo Generated: %DATE% %TIME%
>>"%OUTPUT_FILE%" echo Platform: Windows
>>"%OUTPUT_FILE%" echo.

if "%NEEDS_ACTION%"=="0" goto write_ready

>>"%OUTPUT_FILE%" echo RESULT: Action is required before the viewer can run.
>>"%OUTPUT_FILE%" echo.
if "%PYTHON_OK%"=="0" goto write_install_header
if "%BROWSER_OK%"=="0" goto write_install_header
goto write_package_issue

:write_install_header
>>"%OUTPUT_FILE%" echo Install or update through IT:
if "%PYTHON_OK%"=="0" >>"%OUTPUT_FILE%" echo - Python 3.10 or newer, including the py/python command on PATH.
if "%PYTHON_OK%"=="0" >>"%OUTPUT_FILE%" echo   Current result: %PYTHON_DETAILS%
if "%BROWSER_OK%"=="0" >>"%OUTPUT_FILE%" echo - A current version of Chrome, Edge, or Firefox with WebGL2 support.
>>"%OUTPUT_FILE%" echo.

:write_package_issue
if "%PACKAGE_OK%"=="1" goto write_footer
>>"%OUTPUT_FILE%" echo Viewer package issue:
>>"%OUTPUT_FILE%" echo - ui\dist\index.html is missing. Obtain a complete FastReads-JCB shipment.
>>"%OUTPUT_FILE%" echo.
goto write_footer

:write_ready
>>"%OUTPUT_FILE%" echo RESULT: No additional software installation is required.
>>"%OUTPUT_FILE%" echo.
>>"%OUTPUT_FILE%" echo Detected:
>>"%OUTPUT_FILE%" echo - %PYTHON_DETAILS%
>>"%OUTPUT_FILE%" echo - Browser: %BROWSER_DETAILS%
>>"%OUTPUT_FILE%" echo - Prebuilt viewer files: present

:write_footer
>>"%OUTPUT_FILE%" echo Node.js and npm are not required for the shipped viewer.
>>"%OUTPUT_FILE%" echo Run this checker again after installations or package replacement.

echo.
type "%OUTPUT_FILE%"
echo.
echo Report written to:
echo %OUTPUT_FILE%
echo.
pause

set "RESULT=%NEEDS_ACTION%"
endlocal & exit /b %RESULT%

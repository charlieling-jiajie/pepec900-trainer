@echo off
cd /d "%~dp0"
set PORT=8080

set PY=
where py >nul 2>nul && set PY=py
if "%PY%"=="" (where python >nul 2>nul && set PY=python)
if "%PY%"=="" goto nopy

rem Python 3.7+ required (http.server / ThreadingHTTPServer)
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>nul
if errorlevel 1 goto oldpy

echo.
echo   PEPEC 900 Trainer
echo   Server will start at http://127.0.0.1:%PORT%/
echo   The browser opens automatically once ready.
echo   Close this window to stop the server.
echo.

rem serve.py: binds 127.0.0.1 only, friendly port-busy error,
rem correct .webmanifest MIME, opens browser AFTER the server is ready
%PY% tools\serve.py %PORT%
pause
exit /b 0

:nopy
echo.
echo   [!] Python not found.
echo       Option 1: install Python 3 (https://www.python.org/downloads/)
echo       Option 2: put the web folder on any static web server
echo.
pause
exit /b 1

:oldpy
echo.
echo   [!] Python 3.7 or newer is required. Please upgrade and retry.
echo.
pause
exit /b 1

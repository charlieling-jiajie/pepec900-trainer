@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8080

set PY=
where py >nul 2>nul && set PY=py
if "%PY%"=="" (where python >nul 2>nul && set PY=python)
if "%PY%"=="" (
  echo.
  echo   [!] 没有找到 Python。
  echo       方式一：安装 Python 3 ^(https://www.python.org/downloads/^)
  echo       方式二：把 web 目录放到任意静态服务器上打开
  echo.
  pause
  exit /b 1
)

echo.
echo   PEPEC 900 复诵训练器
echo   浏览器即将打开 http://127.0.0.1:%PORT%/
echo   关闭本窗口即停止服务
echo.
start "" http://127.0.0.1:%PORT%/
%PY% -m http.server %PORT% --directory web
pause

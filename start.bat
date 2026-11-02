@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py --host 127.0.0.1 --port 3000
  goto finished
)
where python >nul 2>nul
if not errorlevel 1 (
  python server.py --host 127.0.0.1 --port 3000
  goto finished
)
echo Python 3.11+ is needed for the server.
echo Open play.html for the installation-free demo.
:finished
pause

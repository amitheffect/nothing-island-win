@echo off
rem Starts Nothing Island without leaving a command window open.
cd /d "%~dp0"
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%EXE%" (
  echo First run: installing, this takes a minute...
  call npm install
)
rem Newer npm versions skip package install scripts, so Electron's own download step never runs
rem and electron.exe is missing. Run that step directly.
if not exist "%EXE%" if exist "node_modules\electron\install.js" (
  echo Downloading Electron...
  node "node_modules\electron\install.js"
)
if not exist "%EXE%" (
  echo.
  echo Couldn't set up Electron. Check your internet connection, then run:
  echo     npm install-scripts approve electron
  echo     node node_modules\electron\install.js
  echo and start this file again.
  pause
  exit /b 1
)
rem electron.exe is a windowed app: "start" launches it and this window closes straight away
start "" "%EXE%" "%~dp0."
exit

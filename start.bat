@echo off
rem Starts Nothing Island without leaving a command window open.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing, this takes a minute...
  call npm install
)
rem electron.exe is a windowed app: "start" launches it and this window closes straight away
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit

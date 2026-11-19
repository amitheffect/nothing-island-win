@echo off
rem Nothing Island Lite - builds NothingIsland.exe with the C# compiler that ships with Windows.
rem No Visual Studio, no .NET SDK, no Node.js needed.
setlocal
cd /d "%~dp0"
set "FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"
if not exist "%FW%\csc.exe" set "FW=%WINDIR%\Microsoft.NET\Framework\v4.0.30319"
if not exist "%FW%\csc.exe" (
  echo Could not find the .NET Framework 4 C# compiler. It ships with Windows 10/11 - make sure .NET Framework 4.8 is enabled.
  pause
  exit /b 1
)
echo Building Nothing Island Lite...
"%FW%\csc.exe" /nologo /noconfig /target:winexe /platform:anycpu /optimize+ /warn:1 /main:NI.LiteApp /out:NothingIsland.exe ^
  /r:"%FW%\System.dll" /r:"%FW%\System.Core.dll" /r:"%FW%\System.Drawing.dll" /r:"%FW%\System.Windows.Forms.dll" ^
  /r:"%FW%\System.Management.dll" /r:"%FW%\System.Web.Extensions.dll" /r:"%FW%\System.Security.dll" ^
  /r:"%FW%\WPF\UIAutomationClient.dll" /r:"%FW%\WPF\UIAutomationTypes.dll" /r:"%FW%\WPF\WindowsBase.dll" ^
  engine.cs lite-core.cs lite-draw.cs lite-ui.cs lite-paint.cs lite-panel.cs lite-app.cs > build.log 2>&1
if errorlevel 1 (
  type build.log
  echo.
  echo BUILD FAILED - send build.log to whoever is helping you.
  pause
  exit /b 1
)
echo Done: NothingIsland.exe
echo Starting it now. Use the tray icon to quit or to turn on "Start with Windows".
start "" "%~dp0NothingIsland.exe"

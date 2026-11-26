title: "Windows cannot find …\electron.exe" on first run with newer npm
labels: bug, area: packaging
milestone: v1.0
state: closed
fixed: 11c73c1
---
Newer npm versions skip dependency install scripts, so Electron's binary was never downloaded.

Fixed: `allowScripts` approves electron, our own `postinstall` runs Electron's download step, and `start.bat` repairs a missing `electron.exe` with a clear message.

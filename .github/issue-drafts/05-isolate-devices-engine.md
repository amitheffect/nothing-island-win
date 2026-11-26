title: A compile error in devices.cs silently disables the whole native engine
labels: bug, area: engine
milestone: v1.1
state: open
---
## What happens
`devices.cs` (Wi-Fi / Bluetooth / sound pickers) is compiled **together** with `bridge.cs`. If it fails to compile on some PC (different .NET Framework / Windows build), the whole native engine fails and the app silently falls back to the slower PowerShell engine for *everything* (laggier controls, more RAM).

## Plan
- Compile `devices.cs` into its own DLL (`NothingIslandDevices.dll`) and load it with `Assembly.LoadFrom` from the engine; if that fails, only the pickers are disabled with a clear message.
- Write compile errors to `engine/build-error.log` (already done for bridge.cs) and show "Engine: PowerShell (fallback)" in the tray menu so users can tell.

## Done when
- [ ] Breaking `devices.cs` on purpose leaves media/volume/Wi-Fi toggle working on the native engine.
- [ ] Tray shows which engine is running.

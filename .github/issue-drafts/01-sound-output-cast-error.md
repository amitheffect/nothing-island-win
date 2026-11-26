title: Sound output picker fails: "Unable to cast NI.MMDeviceEnumeratorComObject to NI.Dev.MMEnumeratorCo"
labels: bug, area: engine, priority: high
milestone: v1.1
state: open
---
## What happens
Volume slider **›** → *Sound output* shows:

> Couldn't list outputs: Unable to cast object of type 'NI.MMDeviceEnumeratorComObject' to type 'NI.Dev.MMEnumeratorCo'.

No outputs are listed, so you can't switch between speakers / headphones.

## Cause
`MMDeviceEnumerator` is a process-wide singleton COM object. The main engine (`bridge.cs`) already wraps it as `NI.MMDeviceEnumeratorComObject`. When `devices.cs` does `new MMEnumeratorCo()`, .NET gets back the **same** COM object, reuses the existing wrapper, and the cast to the second wrapper class (`NI.Dev.MMEnumeratorCo`) fails.

## Fix
In `devices.cs`, don't declare a second `[ComImport]` class for the same CLSID. Create it through the type system and cast straight to the interface (a QueryInterface, which always works):

```csharp
var en = (IMMDeviceEnumeratorX)Activator.CreateInstance(
    Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
```

Do the same for `PolicyConfigCo` to be safe.

## Done when
- [ ] Sound output lists every active output on a PC with speakers + headphones + HDMI.
- [ ] Choosing one switches Windows' default output (check the Windows volume flyout).
- [ ] Works with both engines (native and PowerShell fallback).

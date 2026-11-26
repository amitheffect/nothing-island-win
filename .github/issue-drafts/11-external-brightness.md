title: Brightness for external monitors (DDC/CI)
labels: enhancement, area: engine
milestone: Backlog
state: open
---
Brightness shows **N/A** on desktops because WMI brightness only covers built-in laptop screens. Many external monitors support **DDC/CI** (`dxva2.dll`: `GetPhysicalMonitorsFromHMONITOR`, `GetMonitorBrightness`, `SetMonitorBrightness`). Add this to the native engine, slow-poll only (DDC calls can take ~50 ms), with one slider controlling the monitor the island is on.

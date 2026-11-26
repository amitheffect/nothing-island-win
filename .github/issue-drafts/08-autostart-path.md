title: "Start with Windows" breaks if the project folder is moved
labels: bug, area: packaging
milestone: v1.2
state: open
---
When run from the folder (not installed), "Start with Windows" saves the current `electron.exe` path + project folder. Moving or renaming the folder breaks auto-start silently.

## Plan
- Fixed properly by the installer (#[07]).
- Until then: on launch, if the saved login item points somewhere else, re-register it with the current path.

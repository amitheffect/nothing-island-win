title: "Object has been destroyed" error when quitting
labels: bug
milestone: v1.0
state: closed
fixed: bd8fb4a
---
Quitting showed a JavaScript error dialog because timers kept talking to the closed window.

Fixed: timers are cleared on quit and every send checks the window is still alive.

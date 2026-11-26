title: Global hotkey fails silently when another app uses Ctrl+Alt+Space
labels: bug, enhancement
milestone: v1.1
state: open
---
## What happens
If another app already owns `Ctrl+Alt+Space`, `globalShortcut.register` returns `false` and the island just doesn't respond to the hotkey. Nothing tells the user.

## Plan
- Check the return value; if it fails, show a one-time tray balloon / peek: "Hotkey Ctrl+Alt+Space is taken by another app".
- Let users pick the hotkey in ⚙ (record a key combo), saved in `settings.json`.

## Done when
- [ ] A taken hotkey is reported, and a new one can be set without restarting.

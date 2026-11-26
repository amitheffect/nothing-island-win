title: Some keyboard shortcuts close or reload the island (Ctrl+W, Ctrl+R, Alt+F4, …)
labels: bug, priority: high
milestone: v1.1
state: open
---
## What happens
While the island is open (focused), some keyboard shortcuts close the whole app or reload it.

## Cause
- No application menu is removed, so Electron's **default menu** is still active and its accelerators work even though the window has no menu bar: `Ctrl+W` (close window → `window-all-closed` → app quits), `Ctrl+R` / `Ctrl+Shift+R` / `F5` (reload), `Ctrl+Shift+I` (DevTools), `Ctrl +/-/0` (zoom).
- `Alt+F4` closes the focused window, and closing the only window quits the app.

## Fix
- `Menu.setApplicationMenu(null)` before creating the window.
- `webContents.on('before-input-event')`: block reload, zoom, DevTools and close combos.
- `win.on('close', e => { if (!quitting) { e.preventDefault(); collapse/hide } })` so only **Quit** in the tray menu ends the app.
- Optionally keep a hidden `Ctrl+Shift+Alt+R` for "Restart island" in the tray instead.

## Done when
- [ ] `Ctrl+W`, `Ctrl+R`, `F5`, `Ctrl+Shift+I`, `Ctrl+=/-/0`, `Alt+F4` do nothing harmful while the panel is open.
- [ ] Typing in the Wi-Fi password and calendar fields still works (`Ctrl+A/C/V/Z`).
- [ ] Tray → Quit still quits.

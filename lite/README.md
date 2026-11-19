# Nothing Island Lite: the low-RAM version

The same island as the Electron app, rebuilt as one small native Windows program. There's no Electron or Chromium and no browser engine. A single process draws the island itself.

| | Electron version | **Lite** |
|---|---|---|
| Processes | 4–6 (Electron + helper) | **1** |
| RAM in use (Task Manager) | ~120–300 MB | **~15–30 MB**, less when idle |
| Needs Node.js / npm | yes | **no** |
| Size on disk | ~250 MB | **~150 KB** |

*(RAM figures are estimates. Check Task Manager on your PC.)*

## Build & run (one double-click)
1. Open this `lite` folder.
2. Double-click **`build.bat`**.
   - It compiles `NothingIsland.exe` with the C# compiler that's already part of Windows 10/11.
   - Nothing needs to be installed.
   - It starts the app when it's done.
3. Right-click the tray icon → **Start with Windows** if you want it on every boot.

If the build fails, a `build.log` file appears next to `build.bat`. Send that file to whoever is helping you.

## What's included
- **Pill:** time · date, music (halftone album art + dot equaliser), timer countdown, next-meeting countdown, mic/camera privacy dots.
- **Peeks:** notifications, now playing, charger plugged/unplugged, mic/camera turned on, meeting in 5 min / starting (with JOIN).
- **Volume / brightness HUD** when you change them with the keyboard.
- **Panel:**
  - Media controls and an analog clock
  - Wi-Fi and Bluetooth toggles (right-click either one for Settings)
  - Volume and brightness sliders
  - Timer with alarm
  - Mic mute, dark mode, screenshot and lock
  - Battery
  - Today's date and your agenda
- **Gestures:**
  - Click the pill to open the panel.
  - Swipe left/right on the pill to change track.
  - Hold the pill to play or pause.
  - Scroll on the pill to change volume.
  - Two-finger trackpad swipe also changes track.
  - **Ctrl+Alt+Space** opens/closes the panel.
- **Island or Notch style:** button in the panel footer, or the tray menu.
- **Auto-hides over fullscreen games and videos.** It never hides over Premiere, After Effects, Photoshop and similar apps.
- **Settings (⚙):** calendar link (stored encrypted with Windows DPAPI), auto-hide, notification peeks, start with Windows, and **Copy diagnostics**.

## Why it uses so little memory
- **Exact-size window:** the window is exactly the size of the island, with per-pixel transparency. Nothing outside the island is drawn, and the area around it is naturally click-through.
- **Redraws only when needed:** it redraws only while animating or once a second for the clock. Slow system calls run on one background thread.
- **Memory hand-back:** after ~20 s of idle it hands unused memory back to Windows.
- **Tiny album art:** artwork is kept as a 24×24 dot map, not as an image.
- **Settings window:** it only exists while it's open.

title: macOS and Linux versions
labels: enhancement, platform: macos, platform: linux
milestone: Backlog
state: open
---
The UI (Electron) already runs everywhere; only the system **engine** is Windows-only. Plan: one engine per OS answering the same commands (`fast`, `slow`, `media`, `setVolume`, `wifiList`, …).

- **Linux:** `playerctl` (MPRIS) for media, PipeWire/PulseAudio (`wpctl`/`pactl`) for volume & outputs, NetworkManager (`nmcli`) for Wi-Fi, BlueZ (`bluetoothctl`) for Bluetooth incl. connect, logind for brightness/lock. Run under X11 (Wayland doesn't allow positioning an always-on-top overlay).
- **macOS:** `osascript`/JXA for volume, dark mode, Spotify/Music; `networksetup` for Wi-Fi; optional Homebrew helpers (`blueutil`, `SwitchAudioSource`) for Bluetooth/outputs. Notched Macs: the Notch style sits around the real notch. Browser media isn't readable on macOS 15.4+.
- Builds: `.dmg` and `.AppImage`/`.deb` in the release workflow (#[07]).

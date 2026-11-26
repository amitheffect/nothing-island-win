title: Windows installer + automatic release builds
labels: enhancement, area: packaging, priority: high
milestone: v1.2
state: open
---
Today everyone runs the app from the folder with `start.bat`, which needs Node/npm and breaks auto-start if the folder moves.

## Plan
- **Installer (NSIS, electron-builder)** — already configured as a target but never built/tested:
  - per-user install (no admin), Start-menu shortcut, "Start with Windows" option, clean uninstall (offer to remove `%APPDATA%\Nothing Island`).
  - app icon (`build/icon.ico`, 256×256) — none exists yet.
  - `appId` is still `in.bizkit.nothingisland` → change to a Zevox id (e.g. `com.zevox.nothingisland`) **before** the first public release (it's baked into the installer and Windows notifications).
  - keep the **portable** `.exe` too.
- **Release workflow (GitHub Actions)**: on a `v*` tag, run on `windows-latest`, `npm ci`, `npm run dist`, attach the `.exe` files to a GitHub Release with SHA-256 checksums.
- **Code signing (later)**: unsigned apps that compile a helper at first run can be flagged by SmartScreen / antivirus. Options: a code-signing certificate, or ship the engine **pre-compiled** in the installer so nothing is compiled on the user's PC.
- Auto-start should point to the installed exe (fixes #[08]).

## Done when
- [ ] Fresh Windows 10 + 11 PCs (no Node) install, run, auto-start, and uninstall cleanly.
- [ ] Tagging `v1.2.0` produces a Release with installer + portable exe.

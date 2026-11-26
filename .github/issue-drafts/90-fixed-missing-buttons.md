title: Toggle buttons (mic / dark / screenshot / lock) sometimes invisible
labels: bug
milestone: v1.0
state: closed
fixed: 3bb6d1e
---
The four round toggle buttons sometimes didn't show up in the panel (a stale paint after the opening animation, mostly in low-memory/software rendering).

Fixed: the toggles now sit in their own tile, tiles repaint after their entrance animation, and blur is disabled in software rendering. Confirmed fixed on Windows.

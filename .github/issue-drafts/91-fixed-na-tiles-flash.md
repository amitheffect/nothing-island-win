title: Unavailable tiles (Bluetooth / brightness N/A) flash bright when the panel opens
labels: bug
milestone: v1.0
state: closed
fixed: ca95a49
---
On PCs without Bluetooth or brightness control, those tiles briefly looked usable on every open, then dimmed.

Fixed: the entrance animation now ends at each tile's own style instead of full opacity.

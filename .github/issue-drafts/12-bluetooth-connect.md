title: Connect / disconnect paired Bluetooth devices from the island
labels: enhancement, area: engine
milestone: Backlog
state: open
---
The Bluetooth view lists paired devices but tapping one opens Windows Settings — Windows has no simple public API for "connect this paired headset". Research options (audio endpoint `IKsControl` connect/disconnect used by some tools, or toggling the device's service) and only ship if reliable.

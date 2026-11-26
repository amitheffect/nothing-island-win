title: Timer can't be set above 3 hours
labels: bug, enhancement, area: ui
milestone: v1.1
state: open
---
## What happens
The timer stops at **3:00:00**. Scrolling also only moves 1 minute per step, so long timers are slow to set.

## Cause
`renderer/app.js` clamps the timer: `clamp(…, 60, 180 * 60)`.

## Plan
- Raise the limit to **23:59:59**.
- Faster scrolling: 1 min steps up to 1 h, 5 min steps up to 3 h, 15 min steps above (hold Shift for 1 min).
- Click on the digits to type a time (e.g. `1h30`, `90`, `2:15:00`).
- Make sure the dot-matrix digits and the collapsed pill fit `H:MM:SS` (check widths for `23:59:59`).
- Keep presets 1 / 5 / 10 / 25 (maybe allow changing them in ⚙).

## Done when
- [ ] A 5-hour timer can be set in a few seconds and counts down correctly, including on the pill.
- [ ] The alarm still fires at 0, also after the PC slept (timer is based on end time, not ticks).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nothingIsland', {
  sys: (cmd, arg) => ipcRenderer.invoke('sys', cmd, arg),
  setInteractive: (on, focus) => ipcRenderer.send('interactive', !!on, !!focus),
  setStyle: (style) => ipcRenderer.send('set-style', style),
  onStyle: (cb) => ipcRenderer.on('style', (_e, s) => cb(s)),
  setCalendar: (url) => ipcRenderer.invoke('set-calendar', url),
  refreshCalendar: () => ipcRenderer.send('refresh-calendar'),
  onCalendar: (cb) => ipcRenderer.on('calendar', (_e, c) => cb(c)),
  openUrl: (url) => ipcRenderer.send('open-url', url),
  setAutoHidePref: (on) => ipcRenderer.send('set-autohide', !!on),
  onPrefs: (cb) => ipcRenderer.on('prefs', (_e, p) => cb(p)),
  setHitRect: (r) => ipcRenderer.send('hit-rect', r),
  onCursorInside: (cb) => ipcRenderer.on('cursor-inside', (_e, v) => cb(v)),
  setAutoHide: (hide) => ipcRenderer.send('autohide', !!hide),
  quit: () => ipcRenderer.send('quit'),
  onToggle: (cb) => ipcRenderer.on('toggle', () => cb()),
  onBlur: (cb) => ipcRenderer.on('blur', () => cb()),
  onReady: (cb) => ipcRenderer.on('bridge-ready', (_e, info) => cb(info)),
});

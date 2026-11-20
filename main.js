// Nothing Island — main process
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, net, shell, safeStorage, session, clipboard, powerMonitor } = require('electron');
const { eventsBetween } = require('./calendar');
const path = require('path');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const WIN_W = 740;
const WIN_H = 500;
const HOTKEY = 'CommandOrControl+Alt+Space';

let win = null;
let tray = null;
let bridge = null;
let quitting = false;
let bridgeInfo = null;
let settings = { style: 'island', calendarUrl: '', autoHide: true, lowMemory: true, engine: 'native', screenEvery: 1 };   // 'island' (floating) | 'notch' (docked to the top edge)
let userHidden = false;   // hidden from the tray menu
let autoHidden = false;   // hidden because a fullscreen app is in front
let seq = 0;
const pending = new Map();

// ------------------------------------------------------------------ low-memory mode
// Read just this flag early: Chromium switches only work before the app is ready.
function earlyPrefs() {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')) || {}; } catch { return {}; }
}
const LOW_MEMORY = earlyPrefs().lowMemory !== false;
if (LOW_MEMORY) {
  app.disableHardwareAcceleration();                       // no separate GPU process; the island is tiny
  app.commandLine.appendSwitch('in-process-gpu');          // fold what is left of it into the main process
  app.commandLine.appendSwitch('renderer-process-limit', '1');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disk-cache-size', '1');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=64 --optimize-for-size --lite-mode');
  app.commandLine.appendSwitch('disable-features', [
    'HardwareMediaKeyHandling', 'MediaSessionService', 'GlobalMediaControls', 'SpareRendererForSitePerProcess',
    'CalculateNativeWinOcclusion', 'BackForwardCache', 'Translate', 'OptimizationHints', 'AutofillServerCommunication',
    'DialMediaRouteProvider', 'MediaRouter', 'WinUseBrowserSpellChecker', 'InterestFeedContentSuggestions',
  ].join(','));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// The window can be destroyed while timers are still queued (e.g. during Quit): always check first.
function alive() { return !!(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()); }
function send(channel, ...args) { if (alive()) win.webContents.send(channel, ...args); }

// ------------------------------------------------------------------ settings
// The calendar link is a secret (anyone with it can read your calendar), so it is stored
// encrypted with Windows DPAPI via safeStorage, never in plain text.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch {}
  settings.style = raw.style === 'notch' ? 'notch' : 'island';
  settings.autoHide = raw.autoHide !== false;
  settings.lowMemory = raw.lowMemory !== false;
  settings.engine = raw.engine === 'powershell' ? 'powershell' : 'native';
  settings.screenEvery = [0, 1, 2, 3].includes(raw.screenEvery) ? raw.screenEvery : 1;
  settings.calendarUrl = '';
  try {
    if (typeof raw.calendarUrlEnc === 'string' && safeStorage.isEncryptionAvailable()) {
      settings.calendarUrl = normaliseCalUrl(safeStorage.decryptString(Buffer.from(raw.calendarUrlEnc, 'base64')));
    } else if (typeof raw.calendarUrl === 'string') {
      settings.calendarUrl = normaliseCalUrl(raw.calendarUrl);   // migrate old plain-text value
      saveSettings();
    }
  } catch { settings.calendarUrl = ''; }
}
function saveSettings() {
  const out = { style: settings.style, autoHide: settings.autoHide, lowMemory: settings.lowMemory, engine: settings.engine, screenEvery: settings.screenEvery };
  if (settings.calendarUrl) {
    if (safeStorage.isEncryptionAvailable()) out.calendarUrlEnc = safeStorage.encryptString(settings.calendarUrl).toString('base64');
    else return; // never write the secret link in plain text; it just won't survive a restart
  }
  try { fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2), { mode: 0o600 }); } catch {}
}
function sendPrefs() {
  send('prefs', { autoHide: settings.autoHide, screenEvery: settings.screenEvery, software: LOW_MEMORY, screenSecs: screen_.secs });
}

// ------------------------------------------------------------------ screen time
// Counts time you're actually at the PC today (not locked, asleep or idle for 5+ minutes) and
// asks the island to show a short break reminder every 1 / 2 / 3 hours. Stays on this PC.
const SCREEN_TICK = 30;
const screenFile = () => path.join(app.getPath('userData'), 'screen-time.json');
const dayKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
let screen_ = { day: '', secs: 0, shown: 0 }, screenLocked = false, screenTimer = null, screenSaved = 0;
function loadScreenTime() {
  try {
    const r = JSON.parse(fs.readFileSync(screenFile(), 'utf8'));
    if (r && r.day === dayKeyNow() && Number.isFinite(r.secs) && Number.isFinite(r.shown)) {
      screen_ = { day: r.day, secs: Math.max(0, Math.min(r.secs, 86400)), shown: Math.max(0, Math.min(r.shown, 24)) };
      return;
    }
  } catch {}
  screen_ = { day: dayKeyNow(), secs: 0, shown: 0 };
}
function saveScreenTime() { try { fs.writeFileSync(screenFile(), JSON.stringify(screen_)); } catch {} screenSaved = Date.now(); }
function screenTick() {
  if (quitting) return;
  if (screen_.day !== dayKeyNow()) screen_ = { day: dayKeyNow(), secs: 0, shown: 0 };
  let idle = 0;
  try { idle = powerMonitor.getSystemIdleTime(); } catch {}
  if (!screenLocked && idle < 300) screen_.secs += SCREEN_TICK;
  const hours = Math.floor(screen_.secs / 3600);
  const every = settings.screenEvery;
  if (every && hours >= screen_.shown + every) {
    screen_.shown = hours - (hours % every);
    send('screen-time', { hours, secs: screen_.secs, every });
    saveScreenTime();
  }
  send('screen-secs', screen_.secs);
  if (Date.now() - screenSaved > 5 * 60e3) saveScreenTime();
}
function startScreenTime() {
  loadScreenTime();
  try {
    powerMonitor.on('lock-screen', () => { screenLocked = true; });
    powerMonitor.on('unlock-screen', () => { screenLocked = false; });
    powerMonitor.on('suspend', () => { screenLocked = true; saveScreenTime(); });
    powerMonitor.on('resume', () => { screenLocked = false; });
  } catch {}
  screenTimer = setInterval(screenTick, SCREEN_TICK * 1000);
}
function setStyle(style) {
  settings.style = style === 'notch' ? 'notch' : 'island';
  saveSettings();
  send('style', settings.style);
}

// ------------------------------------------------------------------ calendar (ICS link)
let calState = { configured: false, ok: false, error: null, events: [], updated: 0 };
let calTimer = null;
let icsText = '';            // last downloaded calendar, kept in memory only (for the month view)
let icsOk = false, icsError = null;

// ---- your own events and marked days (stored on this PC, next to settings.json)
const LOCAL_MAX_EVENTS = 1000, LOCAL_MAX_MARKS = 1000;
const localCalFile = () => path.join(app.getPath('userData'), 'calendar-local.json');
let localCal = { events: [], marks: [] };
function loadLocalCal() {
  try {
    const raw = JSON.parse(fs.readFileSync(localCalFile(), 'utf8'));
    localCal.events = (Array.isArray(raw.events) ? raw.events : []).filter(validLocalEvent).slice(0, LOCAL_MAX_EVENTS);
    localCal.marks = (Array.isArray(raw.marks) ? raw.marks : []).filter(isDayKey).slice(0, LOCAL_MAX_MARKS);
  } catch { localCal = { events: [], marks: [] }; }
}
function saveLocalCal() {
  try { fs.writeFileSync(localCalFile(), JSON.stringify(localCal)); } catch {}
}
const isDayKey = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const MIN_T = Date.UTC(2000, 0, 1), MAX_T = Date.UTC(2100, 0, 1);
function validLocalEvent(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' && /^[a-f0-9-]{36}$/.test(e.id) &&
    typeof e.title === 'string' && e.title.trim().length > 0 && e.title.length <= 80 &&
    Number.isFinite(e.start) && Number.isFinite(e.end) && e.start >= MIN_T && e.end <= MAX_T &&
    e.end >= e.start && e.end - e.start <= 14 * 86400e3 && typeof e.allDay === 'boolean';
}
const localOut = (e) => ({ id: 'local:' + e.id, title: e.title, start: e.start, end: e.end, url: null, allDay: e.allDay, local: true });

// Timed events for the countdown / agenda: calendar link + your own, in the next 36 h.
function rebuildCalState() {
  const now = Date.now(), from = now - 12 * 3600e3, to = now + 36 * 3600e3;
  let events = [];
  if (settings.calendarUrl && icsOk && icsText) { try { events = eventsBetween(icsText, from, to); } catch {} }
  for (const e of localCal.events) if (!e.allDay && e.end > from && e.start < to) events.push(localOut(e));
  events.sort((a, b) => a.start - b.start);
  calState = {
    configured: !!settings.calendarUrl, ok: settings.calendarUrl ? icsOk : true,
    error: settings.calendarUrl ? icsError : null, events, hasLocal: localCal.events.length > 0, updated: now,
  };
  send('calendar', calState);
}

function normaliseCalUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (u.startsWith('webcal://')) u = 'https://' + u.slice(9);
  if (u.length > 2048) throw new Error('Link is too long');
  const parsed = new URL(u);                      // throws on garbage
  if (parsed.protocol !== 'https:') throw new Error('Link must start with https://');
  if (parsed.username || parsed.password) throw new Error('Link must not contain a username or password');
  return parsed.toString();
}

const MAX_ICS_BYTES = 10 * 1024 * 1024;
async function readCapped(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { reader.cancel(); throw new Error('Calendar file is too large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function refreshCalendar() {
  clearTimeout(calTimer);
  calTimer = setTimeout(refreshCalendar, 5 * 60 * 1000);
  if (!settings.calendarUrl) {
    icsText = ''; icsOk = false; icsError = null;
  } else {
    try {
      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), 20000);
      let text;
      try {
        const res = await net.fetch(settings.calendarUrl, {
          headers: { 'User-Agent': 'NothingIsland/1.0' }, signal: ctrl.signal, credentials: 'omit',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (res.url && !res.url.startsWith('https://')) throw new Error('Calendar redirected to an insecure address');
        text = await readCapped(res, MAX_ICS_BYTES);
      } finally { clearTimeout(killer); }
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not a calendar (.ics) link');
      icsText = text; icsOk = true; icsError = null;
    } catch (e) {
      icsOk = !!icsText; icsError = String(e.message || e);   // keep the last good copy if a refresh fails
      if (!icsText) icsOk = false;
    }
  }
  rebuildCalState();
}

// ------------------------------------------------------------------ PowerShell bridge
function bridgePath() {
  // when packaged, bridge.ps1 is unpacked next to app.asar so PowerShell can read it
  return path.join(__dirname, 'bridge.ps1').replace('app.asar', 'app.asar.unpacked');
}

// ---- native engine: bridge.cs compiled once with the C# compiler built into Windows
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
let engineInUse = 'none';
let nativeFailures = [];
let nativeDisabledThisRun = false;

function engineDir() { return path.join(app.getPath('userData'), 'engine'); }

function buildNativeEngine() {
  return new Promise((resolve) => {
    try {
      const src = path.join(__dirname, 'bridge.cs').replace('app.asar', 'app.asar.unpacked');
      const dir = engineDir();
      fs.mkdirSync(dir, { recursive: true });
      const exe = path.join(dir, 'NothingIslandEngine.exe');
      const stampFile = path.join(dir, 'build.json');
      const devSrc = path.join(__dirname, 'devices.cs').replace('app.asar', 'app.asar.unpacked');
      const srcHash = sha256(Buffer.concat([fs.readFileSync(src), fs.readFileSync(devSrc)]));
      try {
        const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
        // reuse the build only if the source is unchanged AND the exe is byte-for-byte what we built
        if (stamp.srcHash === srcHash && fs.existsSync(exe) && sha256(fs.readFileSync(exe)) === stamp.exeHash) return resolve(exe);
      } catch {}
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      let fw = path.join(sysRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
      if (!fs.existsSync(path.join(fw, 'csc.exe'))) fw = path.join(sysRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319');
      const csc = path.join(fw, 'csc.exe');
      if (!fs.existsSync(csc)) return resolve(null);
      const refs = ['System.Core.dll', 'System.Management.dll', 'System.Web.Extensions.dll',
        path.join('WPF', 'UIAutomationClient.dll'), path.join('WPF', 'UIAutomationTypes.dll'), path.join('WPF', 'WindowsBase.dll')]
        .map((r) => '/r:' + path.join(fw, r));
      const args = ['/nologo', '/noconfig', '/target:exe', '/platform:anycpu', '/optimize+', '/warn:0',
        '/r:' + path.join(fw, 'System.dll'), ...refs, '/out:' + exe, src, devSrc];
      execFile(csc, args, { windowsHide: true, timeout: 90000 }, (err, stdout, stderr) => {
        if (err || !fs.existsSync(exe)) {
          try { fs.writeFileSync(path.join(dir, 'build-error.log'), String(stdout || '') + String(stderr || '') + String(err || '')); } catch {}
          return resolve(null);
        }
        try { fs.writeFileSync(stampFile, JSON.stringify({ srcHash, exeHash: sha256(fs.readFileSync(exe)) })); } catch {}
        resolve(exe);
      });
    } catch { resolve(null); }
  });
}

async function startBridge() {
  if (process.platform !== 'win32') {
    console.warn('[island] Not on Windows — system controls disabled.');
    return;
  }
  let exe = null;
  if (settings.engine === 'native' && !nativeDisabledThisRun) exe = await buildNativeEngine();
  if (exe) {
    engineInUse = 'native';
    bridge = spawn(exe, [], { windowsHide: true, cwd: engineDir() });
  } else {
    engineInUse = 'powershell';
    startPowerShellBridge();
    return;
  }
  wireBridge();
}

function startPowerShellBridge() {
  // absolute path: never pick up a powershell.exe from the current folder or PATH
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  bridge = spawn(
    ps,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgePath()],
    { windowsHide: true }
  );
  wireBridge();
}

function wireBridge() {
  const proc = bridge;
  const startedAt = Date.now();
  bridge.stdout.setEncoding('utf8');
  const rl = readline.createInterface({ input: bridge.stdout });
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === 0) {
      bridgeInfo = msg.data;
      send('bridge-ready', msg.data);
      return;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve({ ok: msg.ok, data: msg.data, error: msg.error });
    }
  });
  bridge.stderr.on('data', (d) => console.error('[bridge]', d.toString()));
  bridge.on('error', (e) => console.error('[bridge] failed to start', e));
  bridge.on('exit', (code) => {
    console.warn('[bridge] exited', code);
    if (bridge !== proc) return;
    bridge = null;
    // if the native engine keeps crashing, fall back to PowerShell for the rest of this run
    if (engineInUse === 'native' && !quitting) {
      nativeFailures = nativeFailures.filter((t) => Date.now() - t < 60000);
      nativeFailures.push(Date.now());
      if (nativeFailures.length >= 2 || Date.now() - startedAt < 4000) nativeDisabledThisRun = true;
    }
    for (const resolve of pending.values()) resolve({ ok: false, error: 'bridge exited' });
    pending.clear();
    if (!quitting) setTimeout(startBridge, 2000);
  });
}

function callBridge(cmd, arg) {
  return new Promise((resolve) => {
    if (!bridge) return resolve({ ok: false, error: 'bridge not running' });
    const id = ++seq;
    pending.set(id, resolve);
    bridge.stdin.write(JSON.stringify({ id, cmd, arg: arg === undefined ? null : arg }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }
    }, 10000);
  });
}

// ------------------------------------------------------------------ window
function placeWindow() {
  if (!alive()) return;
  const d = screen.getPrimaryDisplay();
  const x = Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2);
  const y = d.bounds.y;
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  placeWindow();
  // the island never navigates, opens windows, or asks for permissions
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => {
    send('style', settings.style);
    send('calendar', calState);
    send('notif-source', notifSource);
    sendPrefs();
    if (bridgeInfo) send('bridge-ready', bridgeInfo);
  });
  win.on('blur', () => send('blur'));
  win.on('closed', () => { win = null; });
}

function applyVisibility() {
  if (!alive()) return;
  const show = !userHidden && !(autoHidden && settings.autoHide);
  if (show && !win.isVisible()) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  } else if (!show && win.isVisible()) {
    win.hide();
  }
}

// ------------------------------------------------------------------ tray
function trayIcon() {
  // 16x16 BGRA: a white dot ring, drawn in code so no image file is needed
  const s = 16;
  const buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const on = (r < 7.5 && r > 4.5) || r < 2;
      const i = (y * s + x) * 4;
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = on ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function buildTrayMenu() {
  const login = app.getLoginItemSettings(loginOpts()).openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Nothing Island', enabled: false },
    { type: 'separator' },
    { label: 'Style: Island (floating)', type: 'radio', checked: settings.style === 'island', click: () => setStyle('island') },
    { label: 'Style: Notch (docked)', type: 'radio', checked: settings.style === 'notch', click: () => setStyle('notch') },
    { type: 'separator' },
    { label: `Expand  (${HOTKEY.replace('CommandOrControl', 'Ctrl')})`, click: () => send('toggle') },
    {
      label: 'Show island', type: 'checkbox', checked: !userHidden,
      click: (item) => { userHidden = !item.checked; applyVisibility(); },
    },
    {
      label: 'Hide over fullscreen games / videos', type: 'checkbox', checked: settings.autoHide,
      click: (item) => { settings.autoHide = item.checked; saveSettings(); applyVisibility(); sendPrefs(); },
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: login,
      click: (item) => app.setLoginItemSettings({ ...loginOpts(), openAtLogin: item.checked }),
    },
    {
      label: 'Copy mic/camera diagnostics', click: async () => {
        const r = await callBridge('diag');
        if (r && r.data && typeof r.data === 'object') r.data.notifications = { source: notifSource, error: notifErr, lastId: lastNotifId };
        clipboard.writeText(JSON.stringify(r, null, 2));
      },
    },
    { type: 'separator' },
    { label: `Engine: ${engineInUse === 'native' ? 'Native (low memory)' : engineInUse === 'powershell' ? 'PowerShell' : '…'}`, enabled: false },
    {
      label: 'Use native engine (recommended)', type: 'checkbox', checked: settings.engine === 'native',
      click: (item) => {
        settings.engine = item.checked ? 'native' : 'powershell';
        nativeDisabledThisRun = false;
        saveSettings();
        if (bridge) bridge.kill(); else startBridge();
      },
    },
    {
      label: 'Low-memory mode (restart)', type: 'checkbox', checked: settings.lowMemory,
      click: (item) => { settings.lowMemory = item.checked; saveSettings(); app.relaunch(); app.quit(); },
    },
    { label: 'Restart system bridge', click: () => { if (bridge) bridge.kill(); else startBridge(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function loginOpts() {
  return app.isPackaged
    ? { path: process.execPath, args: [] }
    : { path: process.execPath, args: [app.getAppPath()] };
}

// ------------------------------------------------------------------ IPC
// Every message must come from our own window's top frame (local index.html).
const { fileURLToPath } = require('url');
const RENDERER_PATH = path.normalize(path.join(__dirname, 'renderer', 'index.html')).toLowerCase();
function trusted(e) {
  const f = e.senderFrame;
  if (!alive() || e.sender !== win.webContents || !f || f !== win.webContents.mainFrame) return false;
  try {
    const u = new URL(f.url);
    return u.protocol === 'file:' && path.normalize(fileURLToPath(u)).toLowerCase() === RENDERER_PATH;
  } catch { return false; }
}
const onTrusted = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (trusted(e)) fn(...a); });
const handleTrusted = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (trusted(e) ? fn(...a) : { ok: false, error: 'denied' }));

// Only these bridge commands may be called from the UI, each with a strict argument check.
const isPct = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
const SYS_ALLOWED = {
  fast: (a) => a == null,
  slow: (a) => a == null,
  thumb: (a) => a == null,
  setVolume: isPct,
  setBrightness: isPct,
  setMute: (a) => typeof a === 'boolean',
  setMic: (a) => typeof a === 'boolean',
  setDark: (a) => typeof a === 'boolean',
  media: (a) => ['toggle', 'next', 'prev'].includes(a),
  setRadio: (a) => a && typeof a === 'object' && ['WiFi', 'Bluetooth'].includes(a.kind) && ['On', 'Off'].includes(a.state),
  lock: (a) => a == null,
  snip: (a) => a == null,
  open: (a) => typeof a === 'string' && (/^ms-settings:[a-z0-9-]{0,64}$/.test(a) || a === 'ms-settings-connectabledevices:devicediscovery'),
  // pickers
  wifiList: (a) => a == null,
  wifiScan: (a) => a == null,
  wifiDisconnect: (a) => a == null,
  wifiConnect: (a) => a && typeof a === 'object' && isSsid(a.ssid) &&
    (a.password == null || (typeof a.password === 'string' && a.password.length >= 8 && a.password.length <= 64 && /^[\x20-\x7e]+$/.test(a.password))),
  wifiForget: (a) => isSsid(a),
  audioOutputs: (a) => a == null,
  setAudioOutput: (a) => typeof a === 'string' && a.length <= 200 && /^\{0\.0\.0\.00000000\}\.\{[0-9a-fA-F-]{36}\}$/.test(a),
  btList: (a) => a == null,
};
function isSsid(v) {
  return typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 32 && !/[\x00-\x1f\x7f]/.test(v);
}
handleTrusted('sys', (cmd, arg) => {
  if (typeof cmd !== 'string' || !Object.prototype.hasOwnProperty.call(SYS_ALLOWED, cmd)) return { ok: false, error: 'unknown command' };
  if (!SYS_ALLOWED[cmd](arg)) return { ok: false, error: 'invalid argument' };
  if (cmd === 'setRadio') arg = { kind: arg.kind, state: arg.state };   // drop any extra fields
  if (cmd === 'wifiConnect') arg = { ssid: arg.ssid, password: arg.password == null ? null : arg.password };
  return callBridge(cmd, arg === undefined ? null : arg);
});
// ---- click-through handling
// The window is click-through except where the island is. Electron's "forward" mode relies on a
// mouse hook that apps like After Effects / Premiere (and anything run as admin) can starve, so the
// island looked fine but never reacted. Instead we watch the cursor ourselves and switch
// click-through off whenever it is over the island's shape.
let rendererWants = false;            // expanded / alarm / hovering
let hitRect = null;                   // island rect inside the window, from the renderer
let cursorInside = false;
let ignoring = true;
function updateIgnore() {
  if (!alive()) return;
  const on = rendererWants || cursorInside;
  if (on === !ignoring) return;
  ignoring = !on;
  win.setIgnoreMouseEvents(ignoring, { forward: true });
}
const cursorTimer = setInterval(() => {
  if (quitting || !alive() || !win.isVisible() || !hitRect) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const pad = 6;
  const inside = p.x >= b.x + hitRect.x - pad && p.x <= b.x + hitRect.x + hitRect.w + pad &&
                 p.y >= b.y + hitRect.y - pad && p.y <= b.y + hitRect.y + hitRect.h + pad;
  if (inside !== cursorInside) {
    cursorInside = inside;
    updateIgnore();
    send('cursor-inside', inside);
  }
}, 40);
onTrusted('interactive', (on, focus) => {
  if (!alive()) return;
  rendererWants = !!on;
  updateIgnore();
  if (on && focus) { win.moveTop(); win.focus(); }
});
onTrusted('hit-rect', (r) => {
  if (!r || ![r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 4000)) return;
  hitRect = { x: r.x, y: r.y, w: r.w, h: r.h };
});
onTrusted('set-style', (style) => setStyle(style));
onTrusted('set-screen-every', (n) => {
  if (![0, 1, 2, 3].includes(n)) return;
  settings.screenEvery = n;
  const hours = Math.floor(screen_.secs / 3600);
  screen_.shown = n ? hours - (hours % n) : hours;   // next reminder at the next multiple, never right away
  saveSettings(); saveScreenTime(); sendPrefs();
});
onTrusted('set-autohide', (on) => { settings.autoHide = !!on; saveSettings(); applyVisibility(); sendPrefs(); });
handleTrusted('set-calendar', async (url) => {
  try { settings.calendarUrl = normaliseCalUrl(url); } catch (e) { return { ok: false, error: e.message }; }
  icsText = ''; icsOk = false; icsError = null;      // never show the previous link's events
  saveSettings();
  await refreshCalendar();
  return { ok: calState.ok || !settings.calendarUrl, error: calState.error };
});
onTrusted('refresh-calendar', () => refreshCalendar());
// ---- month view: everything between two times (at most ~6 weeks), plus your marked days
handleTrusted('cal-range', (from, to) => {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < MIN_T || to > MAX_T || to <= from || to - from > 45 * 86400e3) {
    return { ok: false, error: 'invalid range' };
  }
  let events = [];
  if (settings.calendarUrl && icsText) { try { events = eventsBetween(icsText, from, to, { allDay: true }); } catch {} }
  for (const e of localCal.events) if (e.end >= from && e.start < to) events.push(localOut(e));
  events.sort((a, b) => a.start - b.start);
  return { ok: true, events: events.slice(0, 1500), marks: localCal.marks.slice(), linked: !!settings.calendarUrl };
});
handleTrusted('cal-add', (ev) => {
  if (!ev || typeof ev !== 'object') return { ok: false, error: 'invalid event' };
  const title = String(ev.title == null ? '' : ev.title).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80);
  const e = { id: crypto.randomUUID(), title, start: ev.start, end: ev.end, allDay: !!ev.allDay };
  if (!validLocalEvent(e)) return { ok: false, error: title ? 'Check the date and time' : 'Give the event a name' };
  if (localCal.events.length >= LOCAL_MAX_EVENTS) return { ok: false, error: 'Too many events — remove some first' };
  localCal.events.push(e);
  saveLocalCal();
  rebuildCalState();
  return { ok: true };
});
handleTrusted('cal-remove', (id) => {
  if (typeof id !== 'string' || !/^local:[a-f0-9-]{36}$/.test(id)) return { ok: false, error: 'Only your own events can be removed here' };
  const before = localCal.events.length;
  localCal.events = localCal.events.filter((e) => 'local:' + e.id !== id);
  if (localCal.events.length === before) return { ok: false, error: 'not found' };
  saveLocalCal();
  rebuildCalState();
  return { ok: true };
});
handleTrusted('cal-mark', (day, on) => {
  if (!isDayKey(day) || typeof on !== 'boolean') return { ok: false, error: 'invalid day' };
  const has = localCal.marks.includes(day);
  if (on && !has) {
    if (localCal.marks.length >= LOCAL_MAX_MARKS) return { ok: false, error: 'Too many marked days' };
    localCal.marks.push(day);
  } else if (!on && has) localCal.marks = localCal.marks.filter((d) => d !== day);
  saveLocalCal();
  return { ok: true, marks: localCal.marks.slice() };
});
// Only open a link that belongs to one of your calendar events and points to a known meeting service.
const MEETING_HOSTS = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)$/i;
onTrusted('open-url', (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !MEETING_HOSTS.test(u.hostname)) return;
    if (!calState.events.some((ev) => ev.url === url)) return;
    shell.openExternal(u.toString());
  } catch {}
});
onTrusted('autohide', (hide) => { autoHidden = !!hide; applyVisibility(); });
onTrusted('quit', () => app.quit());

// ------------------------------------------------------------------ notifications (Windows notification history)
// Windows keeps every notification in a local database (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db).
// Reading it read-only is far more reliable than reading the pop-up off the screen: it works even when
// banners are off or Do Not Disturb is on, and in any Windows language. Nothing leaves this PC.
let notifDb = null, notifErr = null, lastNotifId = null, notifSource = 'popup';
function openNotifDb() {
  if (process.platform !== 'win32' || notifDb) return;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
    if (!fs.existsSync(file)) throw new Error('notification database not found');
    notifDb = new DatabaseSync(file, { readOnly: true });
    notifSource = 'history';
    notifErr = null;
    send('notif-source', notifSource);
  } catch (e) { notifDb = null; notifErr = String(e.message || e); notifSource = 'popup'; }
}
const decodeXml = (t) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const APP_NAMES = [[/whatsapp/i, 'WhatsApp'], [/teams/i, 'Teams'], [/outlook/i, 'Outlook'], [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'],
  [/brave/i, 'Brave'], [/firefox/i, 'Firefox'], [/discord/i, 'Discord'], [/telegram/i, 'Telegram'], [/slack/i, 'Slack'], [/zoom/i, 'Zoom'],
  [/instagram/i, 'Instagram'], [/spotify/i, 'Spotify'], [/mail/i, 'Mail'], [/calendar/i, 'Calendar'], [/defender|security/i, 'Security']];
function appName(id) {
  const s = String(id || '');
  for (const [re, name] of APP_NAMES) if (re.test(s)) return name;
  let n = s.split('!')[0].replace(/\.exe$/i, '').split('_')[0].split(/[\\.]/).pop() || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}
function pollNotifs() {
  if (quitting) return;
  if (!notifDb) { openNotifDb(); if (!notifDb) return; }
  try {
    if (lastNotifId === null) {
      const r = notifDb.prepare('SELECT MAX(Id) AS m FROM Notification').get();
      lastNotifId = Number(r && r.m) || 0;          // start from now: don't replay old notifications
      return;
    }
    const rows = notifDb.prepare(
      'SELECT n.Id AS id, n.Type AS type, n.Payload AS payload, h.PrimaryId AS app ' +
      'FROM Notification n LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId ' +
      'WHERE n.Id > ? ORDER BY n.Id LIMIT 10').all(lastNotifId);
    const out = [];
    for (const row of rows) {
      lastNotifId = Math.max(lastNotifId, Number(row.id) || 0);
      if (String(row.type).toLowerCase() !== 'toast' || !row.payload) continue;
      const xml = Buffer.from(row.payload).toString('utf8');
      const texts = [...xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)]
        .filter((m) => !/placement\s*=\s*["']attribution/i.test(m[1]))
        .map((m) => decodeXml(m[2])).filter(Boolean);
      if (!texts.length) continue;
      out.push({ app: appName(row.app), title: texts[0].slice(0, 200), body: texts.slice(1).join(' ').slice(0, 300) });
    }
    if (out.length) send('notifs', out.slice(-3));
    notifErr = null;
  } catch (e) {
    notifErr = String(e.message || e);
    if (/not a database|no such table|malformed/i.test(notifErr)) { try { notifDb.close(); } catch {} notifDb = null; notifSource = 'popup'; send('notif-source', notifSource); }
  }
}
const notifTimer = setInterval(pollNotifs, 1200);

// ------------------------------------------------------------------ memory trimming
// While the island is collapsed and idle, ask Windows to page out memory our processes aren't using.
// Pages come back instantly when needed; Task Manager's "Memory" column drops a lot.
let lastTrim = 0;
function trimMemory() {
  if (quitting || !alive()) return;
  if (!settings.lowMemory || !bridge || rendererWants) return;
  if (Date.now() - lastTrim < 45000) return;
  lastTrim = Date.now();
  const pids = app.getAppMetrics().map((m) => m.pid).filter((p) => Number.isInteger(p) && p > 0);
  callBridge('trim', pids);
}
const trimTimer = setInterval(trimMemory, 60000);

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('in.bizkit.nothingisland');
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  loadSettings();
  loadLocalCal();
  startScreenTime();
  startBridge();
  createWindow();
  refreshCalendar();

  tray = new Tray(trayIcon());
  tray.setToolTip('Nothing Island');
  tray.on('click', () => send('toggle'));
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));

  globalShortcut.register(HOTKEY, () => send('toggle'));

  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});

app.on('second-instance', () => send('toggle'));
app.on('before-quit', () => {
  quitting = true;
  clearInterval(cursorTimer);
  clearInterval(trimTimer);
  clearInterval(notifTimer);
  clearInterval(screenTimer);
  if (screen_.day) saveScreenTime();
  try { if (notifDb) notifDb.close(); } catch {}
  clearTimeout(calTimer);
  globalShortcut.unregisterAll();
  if (bridge) bridge.kill();
});
app.on('window-all-closed', () => app.quit());

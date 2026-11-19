// Nothing Island — main process
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, net, shell, safeStorage, session, clipboard } = require('electron');
const { eventsBetween } = require('./calendar');
const path = require('path');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const WIN_W = 520;
const WIN_H = 560;
const HOTKEY = 'CommandOrControl+Alt+Space';

let win = null;
let tray = null;
let bridge = null;
let quitting = false;
let bridgeInfo = null;
let settings = { style: 'island', calendarUrl: '', autoHide: true, lowMemory: true, engine: 'native' };   // 'island' (floating) | 'notch' (docked to the top edge)
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
  const out = { style: settings.style, autoHide: settings.autoHide, lowMemory: settings.lowMemory, engine: settings.engine };
  if (settings.calendarUrl) {
    if (safeStorage.isEncryptionAvailable()) out.calendarUrlEnc = safeStorage.encryptString(settings.calendarUrl).toString('base64');
    else return; // never write the secret link in plain text; it just won't survive a restart
  }
  try { fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2), { mode: 0o600 }); } catch {}
}
function sendPrefs() {
  if (win) win.webContents.send('prefs', { autoHide: settings.autoHide });
}
function setStyle(style) {
  settings.style = style === 'notch' ? 'notch' : 'island';
  saveSettings();
  if (win) win.webContents.send('style', settings.style);
}

// ------------------------------------------------------------------ calendar (ICS link)
let calState = { configured: false, ok: false, error: null, events: [], updated: 0 };
let calTimer = null;

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
    calState = { configured: false, ok: false, error: null, events: [], updated: Date.now() };
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
      const now = Date.now();
      const events = eventsBetween(text, now - 12 * 3600e3, now + 36 * 3600e3);
      calState = { configured: true, ok: true, error: null, events, updated: now };
    } catch (e) {
      calState = { ...calState, configured: true, ok: false, error: String(e.message || e), updated: Date.now() };
    }
  }
  if (win) win.webContents.send('calendar', calState);
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
      const srcHash = sha256(fs.readFileSync(src));
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
        '/r:' + path.join(fw, 'System.dll'), ...refs, '/out:' + exe, src];
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
      if (win) win.webContents.send('bridge-ready', msg.data);
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
  if (!win) return;
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
    win.webContents.send('style', settings.style);
    win.webContents.send('calendar', calState);
    sendPrefs();
    if (bridgeInfo) win.webContents.send('bridge-ready', bridgeInfo);
  });
  win.on('blur', () => win.webContents.send('blur'));
}

function applyVisibility() {
  if (!win) return;
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
    { label: `Expand  (${HOTKEY.replace('CommandOrControl', 'Ctrl')})`, click: () => win && win.webContents.send('toggle') },
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
  if (!win || e.sender !== win.webContents || !f || f !== win.webContents.mainFrame) return false;
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
  open: (a) => typeof a === 'string' && /^ms-settings:[a-z0-9-]{0,64}$/.test(a),
};
handleTrusted('sys', (cmd, arg) => {
  if (typeof cmd !== 'string' || !Object.prototype.hasOwnProperty.call(SYS_ALLOWED, cmd)) return { ok: false, error: 'unknown command' };
  if (!SYS_ALLOWED[cmd](arg)) return { ok: false, error: 'invalid argument' };
  if (cmd === 'setRadio') arg = { kind: arg.kind, state: arg.state };   // drop any extra fields
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
  if (!win) return;
  const on = rendererWants || cursorInside;
  if (on === !ignoring) return;
  ignoring = !on;
  win.setIgnoreMouseEvents(ignoring, { forward: true });
}
setInterval(() => {
  if (!win || !win.isVisible() || !hitRect) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const pad = 6;
  const inside = p.x >= b.x + hitRect.x - pad && p.x <= b.x + hitRect.x + hitRect.w + pad &&
                 p.y >= b.y + hitRect.y - pad && p.y <= b.y + hitRect.y + hitRect.h + pad;
  if (inside !== cursorInside) {
    cursorInside = inside;
    updateIgnore();
    win.webContents.send('cursor-inside', inside);
  }
}, 40);
onTrusted('interactive', (on, focus) => {
  if (!win) return;
  rendererWants = !!on;
  updateIgnore();
  if (on && focus) { win.moveTop(); win.focus(); }
});
onTrusted('hit-rect', (r) => {
  if (!r || ![r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 4000)) return;
  hitRect = { x: r.x, y: r.y, w: r.w, h: r.h };
});
onTrusted('set-style', (style) => setStyle(style));
onTrusted('set-autohide', (on) => { settings.autoHide = !!on; saveSettings(); applyVisibility(); sendPrefs(); });
handleTrusted('set-calendar', async (url) => {
  try { settings.calendarUrl = normaliseCalUrl(url); } catch (e) { return { ok: false, error: e.message }; }
  saveSettings();
  await refreshCalendar();
  return { ok: calState.ok || !settings.calendarUrl, error: calState.error };
});
onTrusted('refresh-calendar', () => refreshCalendar());
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

// ------------------------------------------------------------------ memory trimming
// While the island is collapsed and idle, ask Windows to page out memory our processes aren't using.
// Pages come back instantly when needed; Task Manager's "Memory" column drops a lot.
let lastTrim = 0;
function trimMemory() {
  if (!settings.lowMemory || !bridge || rendererWants) return;
  if (Date.now() - lastTrim < 45000) return;
  lastTrim = Date.now();
  const pids = app.getAppMetrics().map((m) => m.pid).filter((p) => Number.isInteger(p) && p > 0);
  callBridge('trim', pids);
}
setInterval(trimMemory, 60000);

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('in.bizkit.nothingisland');
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  loadSettings();
  startBridge();
  createWindow();
  refreshCalendar();

  tray = new Tray(trayIcon());
  tray.setToolTip('Nothing Island');
  tray.on('click', () => win && win.webContents.send('toggle'));
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));

  globalShortcut.register(HOTKEY, () => win && win.webContents.send('toggle'));

  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});

app.on('second-instance', () => win && win.webContents.send('toggle'));
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (bridge) bridge.kill();
});
app.on('window-all-closed', () => app.quit());

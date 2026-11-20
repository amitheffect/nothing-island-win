/* Nothing Island — renderer */
(() => {
  const DM = window.DotMatrix;
  const $ = (id) => document.getElementById(id);
  const api = window.nothingIsland || mockApi();

  // ---------------------------------------------------------------- state
  const S = {
    ready: false,
    expanded: false,
    hover: false,
    hudUntil: 0,
    hudKind: 'volume',
    alarm: false,
    volume: null, muted: false, mic: null,
    brightness: { supported: false, value: 50 },
    radios: { wifi: null, bluetooth: null },
    wifi: { ssid: null, signal: null },
    dark: false,
    media: { active: false },
    mediaKey: '',
    artImg: null,
    battery: null,
    timer: { total: 300, remaining: 300, running: false, endAt: 0 },
    notifQueue: [], notif: null, notifUntil: 0,
    chargeUntil: 0, chargePlugged: false,
    fullscreen: false, autoHidden: false,
    style: 'island',
    notifSource: 'popup',
    autoHidePref: true,
    inUse: { mic: [], cam: [] }, privPrimed: false,
    cal: { configured: false, ok: false, error: null, events: [] },
    peeked: new Set(),
    lastLocalVol: 0,
    lastLocalBri: 0,
  };

  const SIZES = {
    idle:   { w: 168, h: 34, r: 17 },
    media:  { w: 196, h: 34, r: 17 },
    timer:  { w: 196, h: 34, r: 17 },
    hud:    { w: 320, h: 40, r: 20 },
    charge: { w: 300, h: 40, r: 20 },
    notif:  { w: 360, h: 62, r: 31 },
    alarm:  { w: 330, h: 64, r: 32 },
  };

  const island = $('island');
  const dock = $('dock');
  const panel = $('panel');
  const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;

  // ---------------------------------------------------------------- mode + layout
  function mode() {
    if (S.alarm) return 'alarm';
    if (S.expanded) return 'expanded';
    if (S.notif && Date.now() < S.notifUntil) return 'notif';
    if (Date.now() < S.chargeUntil) return 'charge';
    if (Date.now() < S.hudUntil) return 'hud';
    if (S.timer.running) return 'timer';
    if (meetInfo()) return 'meet';
    if (S.media.active && S.media.playing) return 'media';
    return 'idle';
  }

  let lastMode = '';
  function layout() {
    const m = mode();
    island.className = 'state-' + m + (m === 'charge' && S.chargePlugged ? ' plugged' : '') +
      (S.inUse.cam.length ? ' priv-cam' : S.inUse.mic.length ? ' priv-mic' : '');
    dock.classList.toggle('peek', S.hover && m !== 'expanded');
    dock.classList.toggle('alarm', m === 'alarm');
    if (m !== lastMode) {
      lastMode = m;
      renderPill();
    }
    let size = SIZES[m];
    if (m === 'expanded') size = { w: 460, h: panel.offsetHeight, r: 34 };
    if (m === 'media') size = { w: PILL_MIN_W, h: 34, r: 17 };
    if (m === 'idle' || m === 'timer' || m === 'meet') {
      // fixed comfortable width; content is centred so the padding is always equal
      size = { w: Math.max(PILL_MIN_W, Math.ceil($('pillIn').offsetWidth) + PILL_PAD * 2), h: 34, r: 17 };
    }
    if (S.style === 'notch' && m !== 'expanded') {
      // notch hangs from the top edge: a bit taller, softer bottom corners
      size = { w: size.w, h: size.h + 4, r: Math.min(size.r, 14) };
    }
    if (S.style === 'notch' && m === 'expanded') size = { ...size, h: size.h + 4, r: 30 };
    dock.style.setProperty('--w', size.w + 'px');
    dock.style.setProperty('--h', size.h + 'px');
    // tell the main process where the island will be, so it can make that area clickable
    if (api.setHitRect) {
      const top = S.style === 'notch' ? 0 : 8;
      api.setHitRect({ x: Math.round((window.innerWidth - size.w) / 2), y: top, w: size.w, h: size.h });
    }
    island.style.setProperty('--r', size.r + 'px');
    syncInteractive();
  }

  let interactive = false;
  function syncInteractive(focus) {
    const want = S.expanded || S.hover || S.alarm;
    if (want !== interactive || focus) {
      interactive = want;
      api.setInteractive(want, focus);
    }
  }

  function expand(focus) {
    if (S.alarm) return;
    S.expanded = true;
    renderAll();
    layout();
    syncInteractive(!!focus);
    slowPoll();
  }
  function collapse() {
    S.expanded = false;
    if (panel.classList.contains('show-settings')) setTimeout(() => toggleSettings(false), 400);
    layout();
  }

  // ---------------------------------------------------------------- pointer handling
  let leaveTimer = null;
  island.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimer);
    S.hover = true;
    layout();
  });
  island.addEventListener('mouseleave', () => {
    S.hover = false;
    if (S.expanded) {
      leaveTimer = setTimeout(() => { if (!S.hover && !dragging) collapse(); }, 650);
    }
    layout();
  });
  $('pill').addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    expand(true);
  });
  $('hud').addEventListener('click', () => expand(true));
  $('alarm').addEventListener('click', dismissAlarm);

  // scroll anywhere on the collapsed island = volume
  island.addEventListener('wheel', (e) => {
    if (S.expanded || S.volume == null) return;
    e.preventDefault();
    const v = clamp(S.volume + (e.deltaY < 0 ? 2 : -2), 0, 100);
    setVolume(v, true);
    showHud('volume');
  }, { passive: false });

  api.onToggle(() => (S.expanded ? collapse() : expand(true)));
  // cursor tracking from the main process (works even when the app in front swallows mouse hooks)
  if (api.onCursorInside) api.onCursorInside((inside) => {
    if (inside === S.hover) return;
    if (inside) { clearTimeout(leaveTimer); S.hover = true; layout(); }
    else {
      S.hover = false;
      if (S.expanded) leaveTimer = setTimeout(() => { if (!S.hover && !dragging) collapse(); }, 650);
      layout();
    }
  });
  api.onBlur(() => { if (S.expanded && !S.hover) collapse(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapse(); });

  // ---------------------------------------------------------------- collapsed pill
  const pillArt = document.createElement('canvas');
  pillArt.className = 'pill-art';
  const eq = document.createElement('div');
  eq.className = 'eq';
  eq.innerHTML = Array.from({ length: 5 }, () => '<span>' + '<b></b>'.repeat(4) + '</span>').join('');

  // small dot-matrix for the 34px pill: 7 rows x 2.55px = ~17px tall, centred
  const PILL_DOTS = (color) => ({ dot: 1.9, gap: 0.55, color });   // ~16.6px tall, dense = reads bolder
  const PILL_SMALL = (color) => ({ dot: 1.25, gap: 0.45, color });  // ~11.5px tall
  const PILL_PAD = 18;
  const PILL_MIN_W = 196;

  function renderPill() {
    const m = lastMode || mode();
    const P = $('pillIn');
    P.textContent = '';
    P.classList.toggle('spread', m === 'media');
    P.classList.remove('live');
    if (m === 'meet') {
      const mi = meetInfo();
      if (mi) {
        P.classList.toggle('live', mi.live);
        P.innerHTML = '<span class="meet-dot"></span>' +
          `<span class="pill-title">${esc(mi.ev.title)}</span>` +
          DM.text(fmtMins(mi.mins), PILL_DOTS(mi.live ? '#8e8e93' : '#f0f0f0'));
        return;
      }
    }
    if (m === 'media') {
      P.appendChild(pillArt);
      drawArt(pillArt, 9);
      P.insertAdjacentHTML('beforeend', '<span class="pill-gap"></span>');
      P.appendChild(eq);
    } else if (m === 'timer') {
      P.innerHTML = '<span class="rec-dot"></span>' + DM.text(fmtTimer(S.timer.remaining), PILL_DOTS('#f0f0f0'));
    } else {
      const now = new Date();
      const day = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      P.innerHTML = DM.text(fmtClock(now), PILL_DOTS('#f0f0f0')) +
        '<span class="pill-sep"></span>' +
        DM.text(`${day} ${now.getDate()}`, PILL_SMALL('#8e8e93'));
    }
  }

  setInterval(() => {
    if (mode() === 'media' && S.media.playing) {
      eq.querySelectorAll('span').forEach((col) => {
        const lvl = 1 + Math.floor(Math.random() * 4);
        col.querySelectorAll('b').forEach((b, i) => {
          b.classList.toggle('on', i < lvl);
          b.classList.toggle('top', i === lvl - 1 && lvl === 4);
        });
      });
    }
  }, 150);

  // ---------------------------------------------------------------- HUD
  function showHud(kind) {
    S.hudKind = kind;
    S.hudUntil = Date.now() + 1600;
    renderHud();
    layout();
    clearTimeout(showHud.t);
    showHud.t = setTimeout(layout, 1650);
  }
  function renderHud() {
    const isVol = S.hudKind === 'volume';
    const v = isVol ? (S.muted ? 0 : S.volume || 0) : S.brightness.value || 0;
    $('hudIco').setAttribute('href', isVol ? (S.muted || v === 0 ? '#i-volmute' : '#i-vol') : '#i-sun');
    const n = 18, lit = Math.round((v / 100) * n);
    $('hudBar').innerHTML = Array.from({ length: n }, (_, i) => `<b class="${i < lit ? 'on' : ''}"></b>`).join('');
    $('hudVal').innerHTML = DM.text(String(v), { dot: 2.2, color: '#f0f0f0' });
  }

  // ---------------------------------------------------------------- notifications
  function pushNotifs(list) {
    if (!Array.isArray(list) || !list.length) return;
    list.forEach((n) => { if (n && (n.title || n.body)) S.notifQueue.push(n); });
    if (S.notifQueue.length > 5) S.notifQueue.splice(0, S.notifQueue.length - 5);
    if (!S.notif || Date.now() >= S.notifUntil) nextNotif();
  }
  function nextNotif() {
    S.notif = S.expanded || S.autoHidden ? null : S.notifQueue.shift() || null;
    if (!S.notif) { S.notifQueue.length = 0; layout(); return; }
    const n = S.notif;
    const app = (n.app || '').trim();
    $('nApp').textContent = (app || 'NOTIFICATION').toUpperCase();
    $('nTitle').textContent = n.title || app;
    $('nText').textContent = n.body || '';
    const ico = $('nIco');
    ico.className = 'n-ico' + (n.icon ? ' ' + n.icon : '');
    if (n.icon === 'art') {
      const c = document.createElement('canvas');
      ico.textContent = '';
      ico.appendChild(c);
      drawArt(c, 12);
    } else if (n.icon) {
      ico.innerHTML = `<svg><use href="#i-${n.icon}"/></svg>`;
    } else {
      const letter = (app || n.title || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0) || '?';
      ico.innerHTML = DM.text(letter, { dot: 2.6, gap: 1, color: '#111' });
    }
    $('nAct').textContent = n.action || '';
    $('nAct').classList.toggle('show', !!(n.action && n.url));
    $('nDot').style.display = n.action ? 'none' : '';
    const dur = n.duration || 4500;
    S.notifUntil = Date.now() + dur;
    layout();
    clearTimeout(nextNotif.t);
    nextNotif.t = setTimeout(nextNotif, dur + 50);
  }
  function showPeek(n) {
    if (S.autoHidden) return;
    S.notifQueue.unshift(n);
    if (!S.notif || Date.now() >= S.notifUntil) nextNotif();
  }
  $('nAct').addEventListener('click', (e) => {
    e.stopPropagation();
    if (S.notif && S.notif.url && api.openUrl) api.openUrl(S.notif.url);
    S.notifUntil = 0; nextNotif();
  });
  $('notif').addEventListener('click', () => { S.notifUntil = 0; nextNotif(); });
  $('notif').addEventListener('mouseenter', () => {
    // keep it up while the mouse is on it
    clearTimeout(nextNotif.t);
    S.notifUntil = Date.now() + 60000;
  });
  $('notif').addEventListener('mouseleave', () => {
    if (mode() !== 'notif') return;
    S.notifUntil = Date.now() + 1500;
    clearTimeout(nextNotif.t);
    nextNotif.t = setTimeout(nextNotif, 1550);
  });

  // ---------------------------------------------------------------- charging animation
  function showCharge(plugged) {
    const B = S.battery;
    if (!B || B.desktop) return;
    S.chargePlugged = plugged;
    S.chargeUntil = Date.now() + 2800;
    $('chgIco').setAttribute('href', plugged ? '#i-bolt' : '#i-plug');
    const n = 18, lit = Math.max(1, Math.round((B.level / 100) * n));
    const bar = $('chgBar');
    bar.classList.toggle('low', B.level <= 20 && !plugged);
    bar.innerHTML = Array.from({ length: n }, (_, i) =>
      `<b class="${i < lit ? 'on' : ''}" style="animation-delay:${plugged ? 0.15 + i * 0.045 : 0.1}s"></b>`).join('');
    $('chgVal').innerHTML = DM.text(B.level + '%', { dot: 2.2, color: B.level <= 20 && !plugged ? '#d71921' : '#f0f0f0' });
    layout();
    clearTimeout(showCharge.t);
    showCharge.t = setTimeout(layout, 2850);
  }

  // ---------------------------------------------------------------- fullscreen auto-hide
  function updateAutoHide() {
    const hide = S.fullscreen && !S.alarm && S.autoHidePref;
    if (hide === S.autoHidden) return;
    S.autoHidden = hide;
    if (hide) { S.expanded = false; S.notif = null; S.notifQueue.length = 0; layout(); }
    if (api.setAutoHide) api.setAutoHide(hide);
  }

  // ---------------------------------------------------------------- media
  document.querySelectorAll('[data-media]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = b.dataset.media;
      if (a === 'toggle' && S.media.active) { S.media.playing = !S.media.playing; renderMedia(); }
      await api.sys('media', a);
      setTimeout(fastPoll, 350);
      setTimeout(fastPoll, 1200);
    })
  );

  function prettyApp(id) {
    const s = String(id || '').toLowerCase();
    const known = [['spotify', 'SPOTIFY'], ['chrome', 'CHROME'], ['msedge', 'EDGE'], ['firefox', 'FIREFOX'],
      ['zune', 'MEDIA PLAYER'], ['vlc', 'VLC'], ['brave', 'BRAVE'], ['opera', 'OPERA'], ['apple', 'APPLE MUSIC'], ['youtube', 'YOUTUBE']];
    for (const [k, v] of known) if (s.includes(k)) return v;
    const base = s.split('!')[0].replace(/\.exe$/, '').split('_')[0].split('.').pop();
    return (base || 'MEDIA').toUpperCase();
  }

  function renderMedia() {
    const m = S.media;
    $('mediaApp').textContent = m.active ? prettyApp(m.app) : 'MEDIA';
    $('mTitle').textContent = m.active ? m.title || 'Unknown title' : 'Nothing playing';
    $('mArtist').textContent = m.active ? m.artist || m.album || '' : 'Play something to control it here';
    $('playIco').setAttribute('href', m.active && m.playing ? '#i-pause' : '#i-play');
    const pct = m.active && m.duration > 0 ? (m.position / m.duration) * 100 : 0;
    $('mProg').style.width = clamp(pct, 0, 100) + '%';
  }

  function drawArt(canvas, cols) {
    if (S.artImg) DM.halftone(canvas, S.artImg, cols);
    else DM.placeholder(canvas);
  }

  async function updateArt() {
    const m = S.media;
    const key = m.active ? `${m.title}|${m.artist}|${m.app}` : '';
    if (key === S.mediaKey) return;
    S.mediaKey = key;
    S.artImg = null;
    if (m.active && m.hasThumb) {
      const r = await api.sys('thumb');
      if (r.ok && r.data && S.mediaKey === key) {
        const img = new Image();
        img.onload = () => {
          // keep a tiny 96px copy instead of the full decoded artwork
          const small = document.createElement('canvas');
          small.width = small.height = 96;
          const s = Math.min(img.naturalWidth, img.naturalHeight);
          small.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96);
          img.onload = null; img.src = '';
          S.artImg = small; drawArt($('art'), 22); drawArt(pillArt, 9);
          const pc = document.querySelector('#nIco.art canvas');
          if (pc) drawArt(pc, 12);
        };
        img.src = r.data;
        r.data = null;
      }
    }
    drawArt($('art'), 22);
    drawArt(pillArt, 9);
  }

  // local progress interpolation between polls
  setInterval(() => {
    if (S.media.active && S.media.playing && S.media.duration > 0) {
      S.media.position = Math.min(S.media.duration, S.media.position + 1);
      if (S.expanded) renderMedia();
    }
  }, 1000);

  // ---------------------------------------------------------------- sliders
  let dragging = null;
  const throttles = {};
  function throttle(key, ms, fn) {
    const t = throttles[key] || (throttles[key] = { last: 0, timer: null });
    const now = Date.now();
    clearTimeout(t.timer);
    if (now - t.last >= ms) { t.last = now; fn(); }
    else t.timer = setTimeout(() => { t.last = Date.now(); fn(); }, ms - (now - t.last));
  }

  function setVolume(v, send) {
    S.volume = Math.round(v);
    if (S.volume > 0) S.muted = false;
    S.lastLocalVol = Date.now();
    renderSliders();
    if (send) throttle('vol', 60, () => api.sys('setVolume', S.volume));
  }
  function setBrightness(v, send) {
    S.brightness.value = Math.round(v);
    S.lastLocalBri = Date.now();
    renderSliders();
    if (send) throttle('bri', 140, () => api.sys('setBrightness', S.brightness.value));
  }

  function bindSlider(el, onValue) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || el.classList.contains('na')) return;
      dragging = el;
      el.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e) => {
      if (dragging !== el) return;
      const r = el.getBoundingClientRect();
      onValue(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
    };
    el.addEventListener('pointermove', move);
    const end = () => { if (dragging === el) { dragging = null; el.classList.remove('dragging'); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      if (el.classList.contains('na')) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = el.id === 'volSlider' ? S.volume || 0 : S.brightness.value || 0;
      onValue(clamp(cur + (e.deltaY < 0 ? 5 : -5), 0, 100));
    }, { passive: false });
  }
  bindSlider($('volSlider'), (v) => setVolume(v, true));
  bindSlider($('briSlider'), (v) => setBrightness(v, true));

  $('muteBtn').addEventListener('click', async () => {
    S.muted = !S.muted;
    S.lastLocalVol = Date.now();
    renderSliders();
    await api.sys('setMute', S.muted);
  });

  function renderSliders() {
    const vs = $('volSlider');
    const v = S.volume == null ? 0 : S.volume;
    vs.style.setProperty('--v', v + '%');
    vs.classList.toggle('muted', !!S.muted);
    vs.classList.toggle('na', S.volume == null);
    $('volIco').setAttribute('href', S.muted || v === 0 ? '#i-volmute' : '#i-vol');
    $('volVal').innerHTML = DM.text(S.muted ? 'MUTE' : String(v), { dot: 2.2, color: '#fff' });

    const bs = $('briSlider');
    const b = S.brightness.supported ? S.brightness.value : 0;
    bs.style.setProperty('--v', b + '%');
    bs.classList.toggle('na', !S.brightness.supported);
    bs.title = S.brightness.supported ? 'Brightness' : 'Brightness control is only available on built-in laptop displays';
    $('briVal').innerHTML = DM.text(S.brightness.supported ? String(b) : 'N/A', { dot: 2.2, color: '#fff' });
  }

  // ---------------------------------------------------------------- radios
  async function toggleRadio(kind, btn, subEl, settingsUri) {
    const key = kind === 'WiFi' ? 'wifi' : 'bluetooth';
    const cur = S.radios[key];
    if (cur == null) { api.sys('open', settingsUri); return; }
    const next = cur === 'On' ? 'Off' : 'On';
    btn.classList.add('busy');
    const r = await api.sys('setRadio', { kind, state: next });
    btn.classList.remove('busy');
    if (!r.ok) {
      subEl.textContent = "CAN'T TOGGLE";
      subEl.classList.add('flash');
      setTimeout(() => { subEl.classList.remove('flash'); renderRadios(); }, 1800);
      return;
    }
    S.radios[key] = next;
    renderRadios();
    setTimeout(slowPoll, 1500);
  }
  $('wifiBtn').addEventListener('click', () => toggleRadio('WiFi', $('wifiBtn'), $('wifiSub'), 'ms-settings:network-wifi'));
  $('btBtn').addEventListener('click', () => toggleRadio('Bluetooth', $('btBtn'), $('btSub'), 'ms-settings:bluetooth'));
  $('wifiBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); api.sys('open', 'ms-settings:network-wifi'); });
  $('btBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); api.sys('open', 'ms-settings:bluetooth'); });

  function renderRadios() {
    const w = S.radios.wifi, b = S.radios.bluetooth;
    $('wifiBtn').classList.toggle('on', w === 'On');
    $('wifiBtn').classList.toggle('na', w == null && S.ready);
    $('wifiSub').textContent = w == null ? (S.ready ? 'NOT FOUND' : '—')
      : w === 'On' ? (S.wifi.ssid ? S.wifi.ssid.toUpperCase() + (S.wifi.signal ? ` · ${S.wifi.signal}%` : '') : 'NOT CONNECTED') : 'OFF';
    $('btBtn').classList.toggle('on', b === 'On');
    $('btBtn').classList.toggle('na', b == null && S.ready);
    $('btSub').textContent = b == null ? (S.ready ? 'NOT FOUND' : '—') : b === 'On' ? 'ON' : 'OFF';
  }

  // ---------------------------------------------------------------- quick toggles
  $('micBtn').addEventListener('click', async () => {
    if (S.mic == null) return;
    S.mic = !S.mic;
    renderToggles();
    await api.sys('setMic', S.mic);
  });
  $('darkBtn').addEventListener('click', async () => {
    S.dark = !S.dark;
    renderToggles();
    await api.sys('setDark', S.dark);
  });
  $('snipBtn').addEventListener('click', () => { collapse(); setTimeout(() => api.sys('snip'), 350); });
  $('lockBtn').addEventListener('click', () => { collapse(); api.sys('lock'); });
  $('settingsBtn').addEventListener('click', () => toggleSettings());
  $('setClose').addEventListener('click', () => toggleSettings(false));
  $('winSettings').addEventListener('click', () => api.sys('open', 'ms-settings:'));

  function renderToggles() {
    const mic = $('micBtn');
    mic.classList.toggle('alert', S.mic === true);
    $('micIco').setAttribute('href', S.mic ? '#i-micoff' : '#i-mic');
    mic.title = S.mic == null ? 'No microphone' : S.mic ? 'Microphone muted — click to unmute' : 'Microphone on — click to mute';
    $('darkBtn').classList.toggle('on', S.dark);
    $('darkBtn').title = S.dark ? 'Dark mode on' : 'Dark mode off';
  }

  // ---------------------------------------------------------------- timer
  const T = S.timer;
  document.querySelectorAll('#chips button').forEach((b) =>
    b.addEventListener('click', () => {
      T.total = +b.dataset.min * 60;
      T.remaining = T.total;
      if (T.running) T.endAt = Date.now() + T.total * 1000;
      renderTimer();
    })
  );
  $('timerGo').addEventListener('click', () => {
    if (T.running) {
      T.remaining = Math.max(0, (T.endAt - Date.now()) / 1000);
      T.running = false;
    } else {
      if (T.remaining <= 0) T.remaining = T.total;
      T.endAt = Date.now() + T.remaining * 1000;
      T.running = true;
    }
    renderTimer();
  });
  $('timerReset').addEventListener('click', () => {
    T.running = false;
    T.remaining = T.total;
    renderTimer();
  });
  $('timerTime').addEventListener('wheel', (e) => {
    if (T.running) return;
    e.preventDefault();
    e.stopPropagation();
    T.total = clamp(Math.round(T.total / 60) * 60 + (e.deltaY < 0 ? 60 : -60), 60, 180 * 60);
    T.remaining = T.total;
    renderTimer();
  }, { passive: false });

  function renderTimer() {
    const tile = document.querySelector('.timer');
    tile.classList.toggle('running', T.running);
    $('timerTime').innerHTML = DM.text(fmtTimer(T.remaining), { dot: 4, gap: 1.8, color: 'currentColor', ghost: 0.08 });
    $('goIco').setAttribute('href', T.running ? '#i-pause' : '#i-play');
    $('timerLabel').textContent = T.running ? 'RUNNING' : T.remaining < T.total ? 'PAUSED' : 'TIMER';
    document.querySelectorAll('#chips button').forEach((b) =>
      b.classList.toggle('sel', +b.dataset.min * 60 === T.total));
    if (mode() === 'timer') renderPill();
    layout();
  }

  setInterval(() => {
    if (!T.running) return;
    T.remaining = Math.max(0, (T.endAt - Date.now()) / 1000);
    if (T.remaining <= 0) {
      T.running = false;
      T.remaining = T.total;
      fireAlarm();
    }
    renderTimer();
  }, 250);

  function fireAlarm() {
    S.alarm = true;
    updateAutoHide(); // the alarm always shows, even over fullscreen apps
    S.expanded = false;
    $('alarmText').innerHTML = DM.text("TIME'S UP", { dot: 3, color: '#fff' });
    layout();
    startBeeps();
    clearTimeout(fireAlarm.t);
    fireAlarm.t = setTimeout(dismissAlarm, 60000);
  }
  function dismissAlarm() {
    S.alarm = false;
    updateAutoHide();
    stopBeeps();
    layout();
  }

  // beeps via WebAudio
  let actx = null, beepTimer = null;
  function unlockAudio() {
    try { actx = actx || new AudioContext(); if (actx.state === 'suspended') actx.resume(); } catch {}
  }
  function beep(at, freq) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    o.connect(g).connect(actx.destination);
    o.start(at); o.stop(at + 0.14);
  }
  function startBeeps() {
    unlockAudio();
    if (!actx) return;
    const pattern = () => { const t = actx.currentTime; [0, 0.18, 0.36].forEach((d, i) => beep(t + d, i === 2 ? 1320 : 990)); };
    pattern();
    clearInterval(beepTimer);
    beepTimer = setInterval(pattern, 1300);
  }
  function stopBeeps() {
    clearInterval(beepTimer); beepTimer = null;
    // release Chromium's audio service until the next alarm
    if (actx) { try { actx.close(); } catch {} actx = null; }
  }

  // ---------------------------------------------------------------- clock + battery
  const ticks = $('ticks');
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r1 = i % 5 === 0 ? 39 : 42, r2 = 45;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', 50 + Math.sin(a) * r1); l.setAttribute('y1', 50 - Math.cos(a) * r1);
    l.setAttribute('x2', 50 + Math.sin(a) * r2); l.setAttribute('y2', 50 - Math.cos(a) * r2);
    l.setAttribute('stroke', '#111');
    l.setAttribute('stroke-width', i % 5 === 0 ? 1.6 : 0.7);
    ticks.appendChild(l);
  }
  function renderClock() {
    const d = new Date();
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    $('hHand').setAttribute('transform', `rotate(${h * 30} 50 50)`);
    $('mHand').setAttribute('transform', `rotate(${m * 6} 50 50)`);
    $('sHand').setAttribute('transform', `rotate(${s * 6} 50 50)`);
    let label = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase().replace(',', '');
    const nx = nextEvent();
    if (nx && new Date(nx.start).toDateString() === d.toDateString()) {
      label += ` · NEXT ${fmtClock(new Date(nx.start))} ${nx.title.toUpperCase()}`;
    }
    $('dateLabel').textContent = label;
  }
  let lastMinute = -1;
  setInterval(() => {
    renderClock();
    const min = new Date().getMinutes();
    tickMeetings();
    if (min !== lastMinute) {
      lastMinute = min;
      const m = mode();
      if (m === 'idle' || m === 'meet') { renderPill(); layout(); }
      renderAgenda();
    }
  }, 1000);

  async function initBattery() {
    if (!navigator.getBattery) return;
    try {
      const b = await navigator.getBattery();
      const upd = () => {
        const desktop = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;
        const prev = S.battery;
        S.battery = { level: Math.round(b.level * 100), charging: b.charging, desktop };
        renderBattery();
        if (prev && prev.charging !== b.charging) showCharge(b.charging);
      };
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, upd));
      upd();
    } catch {}
  }
  function renderBattery() {
    const B = S.battery;
    const tile = $('batTile');
    if (!B) return;
    tile.classList.toggle('low', B.level <= 20 && !B.charging);
    tile.classList.toggle('charging', B.charging && !B.desktop);
    $('batLabel').textContent = B.desktop ? 'POWER' : B.charging ? 'CHARGING' : 'BATTERY';
    $('batNum').innerHTML = B.desktop ? DM.text('AC', { dot: 4.4, color: '#f0f0f0' })
      : DM.text(B.level + '%', { dot: B.level === 100 ? 3.2 : 3.8, color: B.level <= 20 && !B.charging ? '#d71921' : '#f0f0f0' });
    const lit = Math.round(B.level / 10);
    $('batDots').innerHTML = Array.from({ length: 10 }, (_, i) => `<b class="${i < lit ? 'on' : ''}"></b>`).join('');
  }

  // ---------------------------------------------------------------- polling
  let fastBusy = false, slowBusy = false;
  async function fastPoll() {
    if (fastBusy || !S.ready) return;
    fastBusy = true;
    try {
      const r = await api.sys('fast');
      if (r.ok && r.data) {
        const d = r.data;
        const changedExternally = S.volume != null && !dragging && Date.now() - S.lastLocalVol > 1500 &&
          (d.volume !== S.volume || d.muted !== S.muted);
        if (!dragging && Date.now() - S.lastLocalVol > 800) { S.volume = d.volume; S.muted = d.muted; }
        if (d.mic !== null && d.mic !== undefined) S.mic = d.mic;
        if (typeof d.fullscreen === 'boolean' && d.fullscreen !== S.fullscreen) {
          S.fullscreen = d.fullscreen;
          updateAutoHide();
        }
        // pop-up reading is only the fallback when the notification history can't be read
        if (!S.autoHidden && S.notifSource !== 'history') pushNotifs(asList(d.notifs));
        updatePrivacy(asList(d.micApps), asList(d.camApps));
        const wasPlaying = S.media.active && S.media.playing;
        const prevKey = S.mediaKey;
        S.media = d.media || { active: false };
        renderSliders();
        renderToggles();
        renderMedia();
        updateArt();
        // new track while collapsed -> short "now playing" peek
        if (prevKey && S.mediaKey && prevKey !== S.mediaKey && S.media.playing && !S.expanded) {
          showPeek({ icon: 'art', app: 'NOW PLAYING', title: S.media.title, body: S.media.artist, duration: 3000 });
        }
        if (changedExternally && !S.expanded) showHud('volume');
        else if (wasPlaying !== (S.media.active && S.media.playing)) layout();
      }
    } finally { fastBusy = false; }
  }
  async function slowPoll() {
    if (slowBusy || !S.ready) return;
    slowBusy = true;
    try {
      const r = await api.sys('slow');
      if (r.ok && r.data) {
        const d = r.data;
        S.radios = d.radios || S.radios;
        S.wifi = d.wifi || S.wifi;
        if (d.brightness) {
          const changedExternally = S.brightness.supported && d.brightness.supported &&
            Date.now() - S.lastLocalBri > 2500 && d.brightness.value !== S.brightness.value;
          if (Date.now() - S.lastLocalBri > 1500 && dragging?.id !== 'briSlider') S.brightness = d.brightness;
          if (changedExternally && !S.expanded) showHud('brightness');
        }
        S.dark = !!d.dark;
        renderRadios();
        renderSliders();
        renderToggles();
      }
    } finally { slowBusy = false; }
  }
  // adaptive polling: quick while you're using it, relaxed while it just sits there
  function fastDelay() {
    if (S.autoHidden) return 3000;
    if (S.expanded || S.hover || dragging) return 700;
    if (S.media.active && S.media.playing) return 1200;
    return 1800;
  }
  (function fastLoop() { fastPoll().finally(() => setTimeout(fastLoop, fastDelay())); })();
  (function slowLoop() { slowPoll().finally(() => setTimeout(slowLoop, S.expanded ? 4000 : 12000)); })();

  api.onReady(() => {
    S.ready = true;
    fastPoll();
    slowPoll();
    renderRadios();
  });

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function asList(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTimer(sec) {
    sec = Math.ceil(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function fmtClock(d) {
    let h = d.getHours();
    if (hour12) h = h % 12 || 12;
    return `${hour12 ? h : pad(h)}:${pad(d.getMinutes())}`;
  }

  function renderAll() {
    renderMedia(); renderSliders(); renderRadios(); renderToggles(); renderTimer(); renderClock(); renderBattery();
    if (typeof renderAgenda === 'function') renderAgenda();
    drawArt($('art'), 22);
  }

  if (!window.nothingIsland) { window.__showCharge = (lvl, plugged) => { S.battery = { level: lvl, charging: plugged, desktop: false }; showCharge(plugged); }; }

  // ---------------------------------------------------------------- privacy indicator (mic / camera)
  const PROC_NAMES = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', brave: 'Brave', opera: 'Opera',
    'ms-teams': 'Teams', teams: 'Teams', zoom: 'Zoom', discord: 'Discord', whatsapp: 'WhatsApp', whatsappdesktop: 'WhatsApp',
    slack: 'Slack', obs64: 'OBS', obs: 'OBS', skype: 'Skype', windowscamera: 'Camera', soundrecorder: 'Sound Recorder',
    'afterfx': 'After Effects', 'adobe premiere pro': 'Premiere Pro', telegram: 'Telegram', webex: 'Webex', meet: 'Meet' };
  function niceApps(list) {
    const out = [];
    for (const raw of list) {
      const k = String(raw || '').trim();
      if (!k) continue;
      const name = PROC_NAMES[k.toLowerCase()] || (k.charAt(0).toUpperCase() + k.slice(1));
      if (!out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
    }
    return out;
  }
  function updatePrivacy(mic, cam) {
    mic = niceApps(mic); cam = niceApps(cam);
    const before = S.inUse;
    S.inUse = { mic, cam };
    if (S.privPrimed) {
      const newCam = cam.filter((a) => !before.cam.includes(a));
      const newMic = mic.filter((a) => !before.mic.includes(a));
      if (newCam.length) showPeek({ icon: 'cam', app: 'CAMERA ON', title: `${newCam[0]} is using your camera`, body: 'Green dot stays on while it’s in use', duration: 3500 });
      else if (newMic.length) showPeek({ icon: 'mic', app: 'MICROPHONE ON', title: `${newMic[0]} is using your mic`, body: 'Orange dot stays on while it’s in use', duration: 3500 });
    }
    S.privPrimed = true;
    const tip = [cam.length ? 'Camera: ' + cam.join(', ') : '', mic.length ? 'Mic: ' + mic.join(', ') : ''].filter(Boolean).join(' · ');
    island.title = tip;
    if (String(before.mic) !== String(mic) || String(before.cam) !== String(cam)) layout();
  }

  // ---------------------------------------------------------------- meetings (calendar ICS)
  function nextEvent() {
    const now = Date.now();
    return S.cal.events.find((e) => e.start > now) || null;
  }
  function meetInfo() {
    const now = Date.now();
    const live = S.cal.events.find((e) => e.start <= now && now < e.end);
    if (live) return { ev: live, live: true, mins: Math.ceil((live.end - now) / 60000) };
    const nx = nextEvent();
    if (nx && nx.start - now <= 15 * 60000) return { ev: nx, live: false, mins: Math.max(1, Math.ceil((nx.start - now) / 60000)) };
    return null;
  }
  function fmtMins(m) {
    return m < 60 ? `${m}M` : `${Math.floor(m / 60)}H${pad(m % 60)}`;
  }
  let lastMeetKey = '';
  function tickMeetings() {
    const now = Date.now();
    for (const e of S.cal.events) {
      const k5 = e.id + ':5', k0 = e.id + ':0';
      const t = e.start - now;
      if (t <= 5 * 60000 && t > 4 * 60000 && !S.peeked.has(k5)) {
        S.peeked.add(k5);
        showPeek({ icon: 'cal', app: 'IN 5 MINUTES', title: e.title, body: fmtClock(new Date(e.start)) + ' – ' + fmtClock(new Date(e.end)),
          action: e.url ? 'JOIN' : null, url: e.url, duration: 8000 });
      }
      if (t <= 0 && t > -90000 && !S.peeked.has(k0)) {
        S.peeked.add(k0);
        showPeek({ icon: 'cal', app: 'STARTING NOW', title: e.title, body: e.url ? 'Tap JOIN to open the call' : 'Until ' + fmtClock(new Date(e.end)),
          action: e.url ? 'JOIN' : null, url: e.url, duration: 12000 });
      }
    }
    const mi = meetInfo();
    const key = mi ? `${mi.ev.id}|${mi.live}|${mi.mins}` : '';
    if (key !== lastMeetKey) {
      lastMeetKey = key;
      if (mode() === 'meet' || lastMode === 'meet') { renderPill(); layout(); }
    }
  }
  function renderAgenda() {
    const d = new Date();
    $('cdDay').textContent = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    $('cdMon').textContent = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + ' ' + d.getFullYear();
    $('cdNum').innerHTML = DM.text(String(d.getDate()), { dot: 4.2, gap: 1.4, color: '#111' });
    // week strip, Monday first
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    $('week').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const x = new Date(mon); x.setDate(mon.getDate() + i);
      return `<b class="${x.toDateString() === d.toDateString() ? 'today' : ''}">${x.getDate()}</b>`;
    }).join('');

    const list = $('agList');
    if (!S.cal.configured) {
      list.innerHTML = '<div class="ag-empty">No calendar connected. <button id="agConnect">Add your calendar link</button> to see meetings here.</div>';
      $('agConnect').addEventListener('click', () => toggleSettings(true));
      $('agLabel').textContent = 'CALENDAR';
      return;
    }
    if (!S.cal.ok) {
      list.innerHTML = `<div class="ag-empty">Couldn't load your calendar: ${esc(S.cal.error || 'unknown error')}</div>`;
      return;
    }
    const now = Date.now();
    const items = S.cal.events.filter((e) => e.end > now).slice(0, 3);
    $('agLabel').textContent = items.length ? 'UP NEXT' : 'CALENDAR';
    if (!items.length) { list.innerHTML = '<div class="ag-empty">Nothing scheduled for today or tomorrow.</div>'; return; }
    const today = new Date().toDateString();
    list.innerHTML = items.map((e, i) => {
      const s = new Date(e.start);
      const live = e.start <= now;
      const when = live ? 'NOW' : s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
      const tmrw = !live && s.toDateString() !== today ? '<span class="tm">TMRW</span>' : '';
      return `<div class="ag-row${live ? ' live' : ''}"><span class="d"></span><span class="t">${when}</span>` +
        `<span class="n">${tmrw}${esc(e.title)}</span>${e.url ? `<button class="j" data-i="${i}">JOIN</button>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('.j').forEach((b) => b.addEventListener('click', () => {
      const ev = items[+b.dataset.i];
      if (ev && ev.url && api.openUrl) api.openUrl(ev.url);
    }));
  }

  function applyCalendar(c) {
    S.cal = { configured: !!c.configured, ok: !!c.ok, error: c.error || null, events: Array.isArray(c.events) ? c.events : [] };
    renderCalStatus();
    renderAgenda();
    tickMeetings();
    renderClock();
    layout();
  }
  function renderCalStatus() {
    const st = $('calStatus');
    st.classList.remove('ok', 'err');
    if (!S.cal.configured) { st.textContent = 'NOT CONNECTED'; return; }
    if (!S.cal.ok) { st.textContent = 'ERROR: ' + (S.cal.error || 'could not load'); st.classList.add('err'); return; }
    const nx = nextEvent();
    st.classList.add('ok');
    st.textContent = 'CONNECTED · ' + (nx ? `NEXT: ${nx.title} AT ${fmtClock(new Date(nx.start))}` : 'NOTHING IN THE NEXT 36 H');
  }
  if (api.onCalendar) api.onCalendar(applyCalendar);
  $('calSave').addEventListener('click', async () => {
    const st = $('calStatus');
    st.classList.remove('ok', 'err');
    st.textContent = 'CHECKING…';
    if (!api.setCalendar) return;
    const r = await api.setCalendar($('calInput').value);
    if (!r.ok) { st.textContent = 'ERROR: ' + (r.error || 'could not load'); st.classList.add('err'); }
    else $('calInput').value = '';
  });
  $('calInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('calSave').click(); e.stopPropagation(); });

  function toggleSettings(force) {
    const show = force === undefined ? !panel.classList.contains('show-settings') : force;
    if (show) $('settingsView').style.minHeight = panel.querySelector('.grid').offsetHeight + 'px';
    panel.classList.toggle('show-settings', show);
    renderCalStatus();
    layout();
    if (show) setTimeout(() => $('calInput').focus(), 300);
  }

  // ---------------------------------------------------------------- gestures on the collapsed pill
  // swipe left = next, swipe right = previous, hold = play/pause, click = open panel
  const pillEl = $('pill');
  let gesture = null, suppressClick = false, wheelX = 0, wheelCool = 0;
  function bump(cls) {
    dock.classList.remove('nudge-l', 'nudge-r', 'squeeze');
    void dock.offsetWidth;
    dock.classList.add(cls);
    setTimeout(() => dock.classList.remove(cls), 420);
  }
  function mediaGesture(action) {
    bump(action === 'next' ? 'nudge-l' : action === 'prev' ? 'nudge-r' : 'squeeze');
    if (action === 'toggle' && S.media.active) { S.media.playing = !S.media.playing; renderMedia(); layout(); }
    api.sys('media', action);
    setTimeout(fastPoll, 400);
    setTimeout(fastPoll, 1300);
  }
  pillEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    gesture = { x: e.clientX, id: e.pointerId, moved: false, done: false };
    pillEl.setPointerCapture(e.pointerId);
    gesture.hold = setTimeout(() => {
      if (gesture && !gesture.moved) { gesture.done = true; suppressClick = true; mediaGesture('toggle'); }
    }, 550);
  });
  pillEl.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    if (Math.abs(dx) > 6) { gesture.moved = true; pillEl.classList.add('swiping'); }
    if (gesture.moved) $('pillIn').style.transform = `translateX(${clamp(dx * 0.3, -16, 16)}px)`;
  });
  const endGesture = (e) => {
    if (!gesture) return;
    clearTimeout(gesture.hold);
    const dx = e.clientX - gesture.x;
    pillEl.classList.remove('swiping');
    $('pillIn').style.transform = '';
    if (!gesture.done && Math.abs(dx) > 36) { suppressClick = true; mediaGesture(dx < 0 ? 'next' : 'prev'); }
    gesture = null;
  };
  pillEl.addEventListener('pointerup', endGesture);
  pillEl.addEventListener('pointercancel', endGesture);
  // trackpad two-finger swipe (horizontal wheel)
  island.addEventListener('wheel', (e) => {
    if (S.expanded || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Date.now() < wheelCool) return;
    wheelX += e.deltaX;
    clearTimeout(island.wx);
    island.wx = setTimeout(() => { wheelX = 0; }, 250);
    if (Math.abs(wheelX) > 70) {
      mediaGesture(wheelX > 0 ? 'next' : 'prev');
      wheelX = 0;
      wheelCool = Date.now() + 700;
    }
  }, { passive: false, capture: true });

  // ---------------------------------------------------------------- style: notch / island
  function applyStyle(style) {
    S.style = style === 'notch' ? 'notch' : 'island';
    document.body.classList.toggle('notch', S.style === 'notch');
    $('styleName').textContent = S.style.toUpperCase();
    layout();
  }
  $('styleBtn').addEventListener('click', () => {
    const next = S.style === 'notch' ? 'island' : 'notch';
    applyStyle(next);
    if (api.setStyle) api.setStyle(next);
  });
  if (api.onStyle) api.onStyle(applyStyle);
  if (api.onNotifSource) api.onNotifSource((src) => { S.notifSource = src; });
  if (api.onNotifs) api.onNotifs((list) => { if (!S.autoHidden && !S.expanded) pushNotifs(asList(list)); });
  function applyPrefs(p) {
    S.autoHidePref = p.autoHide !== false;
    $('autoHideBtn').classList.toggle('on', S.autoHidePref);
    updateAutoHide();
  }
  if (api.onPrefs) api.onPrefs(applyPrefs);
  $('autoHideBtn').addEventListener('click', () => {
    applyPrefs({ autoHide: !S.autoHidePref });
    if (api.setAutoHidePref) api.setAutoHidePref(S.autoHidePref);
  });
  $('autoHideBtn').classList.add('on');

  // ---------------------------------------------------------------- boot
  renderAll();
  initBattery();
  layout();

  // ---------------------------------------------------------------- browser preview (no Electron)
  function mockApi() {
    const st = { mic2: [], cam2: [], notifs: [], volume: 62, muted: false, mic: false, bri: 70, wifi: 'On', bt: 'Off', dark: true, playing: true, pos: 74 };
    const h = { toggle: null, ready: null };
    setTimeout(() => h.ready && h.ready({}), 50);
    return {
      setInteractive() {},
      quit() {},
      onToggle(cb) { h.toggle = cb; window.__toggle = cb; window.__mock = st; },
      onBlur() {},
      onStyle(cb) { window.__style = cb; },
      onCalendar(cb) { window.__cal = cb; },
      async setCalendar() { return { ok: true }; },
      openUrl() {},
      setStyle() {},
      onReady(cb) { h.ready = cb; },
      async sys(cmd, arg) {
        switch (cmd) {
          case 'fast': return { ok: true, data: { volume: st.volume, muted: st.muted, mic: st.mic, fullscreen: false, notifs: st.notifs.splice(0), micApps: st.mic2, camApps: st.cam2,
            media: { active: true, title: 'Concierto de Aranjuez', artist: 'Jim Hall', app: 'Spotify.exe', playing: st.playing, position: st.pos, duration: 1172, hasThumb: false } } };
          case 'slow': return { ok: true, data: { radios: { wifi: st.wifi, bluetooth: st.bt }, wifi: { ssid: 'Bizkit 5G', signal: 92 }, brightness: { supported: true, value: st.bri }, dark: st.dark } };
          case 'setVolume': st.volume = arg; break;
          case 'setMute': st.muted = arg; break;
          case 'setMic': st.mic = arg; break;
          case 'setBrightness': st.bri = arg; break;
          case 'setDark': st.dark = arg; break;
          case 'media': if (arg === 'toggle') st.playing = !st.playing; break;
          case 'setRadio': if (arg.kind === 'WiFi') st.wifi = arg.state; else st.bt = arg.state; break;
        }
        return { ok: true, data: null };
      },
    };
  }
})();

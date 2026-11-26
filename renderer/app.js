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
    screenUntil: 0, screenPending: null, screenSecs: 0, screenEvery: 1, software: false,
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
    screen: { w: 400, h: 80, r: 40 },
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
    if (Date.now() < S.screenUntil) return 'screen';
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
    if (m === 'expanded') size = { w: 680, h: panel.offsetHeight, r: 32 };
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
    const was = S.expanded;
    S.expanded = true;
    if (!was && !panel.classList.contains('show-sub') && !panel.classList.contains('show-settings')) {
      requestAnimationFrame(() => staggerIn(panel.querySelector('.grid').children, 18));
    }
    renderAll();
    layout();
    syncInteractive(!!focus);
    slowPoll();
  }
  function collapse() {
    S.expanded = false;
    setTimeout(repaint, 600);
    setTimeout(flushScreen, 700);
    if (panel.classList.contains('show-settings')) setTimeout(() => toggleSettings(false), 400);
    if (panel.classList.contains('show-sub')) setTimeout(() => { if (!S.expanded) closeSub(true); }, 400);
    if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
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
      leaveTimer = setTimeout(() => { if (!S.hover && !dragging && !typing()) collapse(); }, 650);
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
      if (S.expanded) leaveTimer = setTimeout(() => { if (!S.hover && !dragging && !typing()) collapse(); }, 650);
      layout();
    }
  });
  api.onBlur(() => { if (S.expanded && !S.hover) collapse(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (panel.classList.contains('show-sub')) closeSub(); else collapse();
  });

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
    if (!hide) setTimeout(flushScreen, 1500);
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
  // up to 23 h 59 min. Scrolling speeds up with the length (Shift = always 1 min), and a
  // double-click on the digits lets you type a time: 90 · 45m · 1h30 · 2h · 25:00 · 2:15:00
  const TIMER_MAX = 23 * 3600 + 59 * 60;
  function timerStep(sec, up, fine) {
    const m = Math.round(sec / 60);
    const step = fine ? 1 : (up ? m >= 180 : m > 180) ? 15 : (up ? m >= 60 : m > 60) ? 5 : 1;
    const next = up ? Math.floor(m / step) * step + step : Math.ceil(m / step) * step - step;
    return clamp(next * 60, 60, TIMER_MAX);
  }
  function setTimer(sec) {
    T.running = false;
    T.total = clamp(Math.round(sec), 60, TIMER_MAX);
    T.remaining = T.total;
    renderTimer();
  }
  $('timerTime').title = 'Scroll to change · double-click to type a time (e.g. 90, 1h30, 25:00, 2:15:00)';
  $('timerTime').addEventListener('wheel', (e) => {
    if (T.running) return;
    e.preventDefault();
    e.stopPropagation();
    setTimer(timerStep(T.total, e.deltaY < 0, e.shiftKey));
  }, { passive: false });
  function parseTimer(txt) {
    const s = String(txt).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/))) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if ((m = s.match(/^(\d{1,3}):(\d{1,2})$/))) return (+m[1]) * 60 + (+m[2]);                 // mm:ss, like the display
    if ((m = s.match(/^(?:(\d{1,2})h)?(?:(\d{1,4})m?)?$/)) && (m[1] || m[2])) return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60;
    return null;
  }
  $('timerTime').addEventListener('dblclick', () => {
    if (T.running || $('timerTime').querySelector('input')) return;
    const box = $('timerTime');
    const inp = document.createElement('input');
    inp.className = 't-input'; inp.maxLength = 8; inp.spellcheck = false;
    inp.placeholder = '1h30'; inp.value = '';
    box.innerHTML = ''; box.appendChild(inp);
    syncInteractive(true);
    inp.focus();
    let done = false;
    const finish = (apply) => {
      if (done) return; done = true;
      const sec = apply ? parseTimer(inp.value) : null;
      box.innerHTML = '';                       // drop the field before the digits are drawn again
      if (sec != null && sec > 0) setTimer(sec); else renderTimer();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  });

  function renderTimer() {
    const tile = document.querySelector('.timer');
    tile.classList.toggle('running', T.running);
    if (!$('timerTime').querySelector('input')) {
      const txt = fmtTimer(T.remaining);
      // H:MM:SS is wider than MM:SS: shrink the dots so it still fits beside the play button
      const dots = txt.length > 5 ? { dot: 2.3, gap: 1.05 } : { dot: 3.1, gap: 1.4 };
      $('timerTime').innerHTML = DM.text(txt, { ...dots, color: 'currentColor', ghost: 0.08 });
    }
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
    $('batNum').innerHTML = B.desktop ? DM.text('AC', { dot: 2, color: '#f0f0f0' })
      : DM.text(B.level + '%', { dot: 2, color: B.level <= 20 && !B.charging ? '#d71921' : '#f0f0f0' });
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
    $('cdNum').innerHTML = DM.text(String(d.getDate()), { dot: 3.3, gap: 1.2, color: '#111' });
    // week strip, Monday first
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    $('week').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const x = new Date(mon); x.setDate(mon.getDate() + i);
      return `<b class="${x.toDateString() === d.toDateString() ? 'today' : ''}">${x.getDate()}</b>`;
    }).join('');

    const list = $('agList');
    if (!S.cal.configured && !S.cal.events.length) {
      list.innerHTML = '<div class="ag-empty">Tap to open the calendar and add events, or <button id="agConnect">link your Google / Outlook calendar</button>.</div>';
      $('agConnect').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(true); });
      $('agLabel').textContent = 'CALENDAR';
      return;
    }
    if (S.cal.configured && !S.cal.ok && !S.cal.events.length) {
      list.innerHTML = `<div class="ag-empty">Couldn't load your calendar: ${esc(S.cal.error || 'unknown error')}</div>`;
      return;
    }
    const now = Date.now();
    const items = S.cal.events.filter((e) => e.end > now).slice(0, 3);
    $('agLabel').textContent = items.length ? 'UP NEXT' : 'CALENDAR';
    if (!items.length) { list.innerHTML = '<div class="ag-empty">Nothing scheduled for today or tomorrow. Tap to plan something.</div>'; return; }
    const today = new Date().toDateString();
    list.innerHTML = items.map((e, i) => {
      const s = new Date(e.start);
      const live = e.start <= now;
      const when = live ? 'NOW' : s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
      const tmrw = !live && s.toDateString() !== today ? '<span class="tm">TMRW</span>' : '';
      return `<div class="ag-row${live ? ' live' : ''}"><span class="d"></span><span class="t">${when}</span>` +
        `<span class="n">${tmrw}${esc(e.title)}</span>${e.url ? `<button class="j" data-i="${i}">JOIN</button>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('.j').forEach((b) => b.addEventListener('click', (clk) => {
      clk.stopPropagation();
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
    if (show === panel.classList.contains('show-settings') && !panel.classList.contains('show-sub')) return;
    if (show) { sub.view = null; sub.token++; clearTimeout(sub.timer); }
    if (show) $('settingsView').style.minHeight = panel.querySelector('.grid').offsetHeight + 'px';
    renderCalStatus();
    renderScreenPrefs();
    viewSwap(() => {
      if (show) panel.classList.remove('show-sub');
      panel.classList.toggle('show-settings', show);
    }, show ? 1 : -1);
    if (show) setTimeout(() => $('calInput').focus(), 450);
  }

  // ---------------------------------------------------------------- pickers: Wi-Fi / Bluetooth / output / calendar
  // One sub-view inside the panel. Each picker renders its own body; the island keeps its size
  // (min-height = the grid) so it doesn't jump around while lists load.
  const sub = { view: null, token: 0, fresh: false };

  // ---- motion (One UI-style): the old view sinks back and blurs out, the new one glides in on a
  // soft spring, then its rows rise in one after another. Skipped when Windows asks for less motion.
  const REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRING = 'cubic-bezier(.22, 1.18, .36, 1)';
  const currentView = () => panel.classList.contains('show-sub') ? $('subView')
    : panel.classList.contains('show-settings') ? $('settingsView') : panel.querySelector('.grid');
  let swapSeq = 0;
  function viewSwap(apply, dir) {
    const seq = ++swapSeq;
    if (REDUCE || !S.expanded) { apply(); afterSwap(); return; }
    const from = currentView();
    from.getAnimations().forEach((a) => a.cancel());
    const blur = S.software ? 'none' : 'blur(4px)';      // blur is costly (and glitchy) without the GPU
    const out = from.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translateX(${-18 * dir}px) scale(.965)`, filter: blur },
    ], { duration: 140, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    out.onfinish = () => {
      out.cancel();
      if (seq !== swapSeq) return;
      apply();
      const to = currentView();
      to.animate([
        { opacity: 0, transform: `translateX(${28 * dir}px) scale(.975)`, filter: blur },
        { opacity: 1, transform: 'none', filter: 'none' },
      ], { duration: 520, easing: SPRING }).finished.then(repaint, () => {});
      if (to.classList.contains('grid')) staggerIn(to.children, 16);
      afterSwap();
    };
  }
  // Without the GPU (low-memory mode) Chromium sometimes leaves a stale patch on a transparent
  // window after an animation — a button that never shows up. Nudging the island's layer once the
  // motion has settled makes it redraw the whole thing.
  let repaintT = null;
  function repaint() {
    clearTimeout(repaintT);
    repaintT = setTimeout(() => {
      island.style.transform = 'translateZ(0)';
      requestAnimationFrame(() => requestAnimationFrame(() => { island.style.transform = ''; }));
    }, 30);
  }
  function afterSwap() { layout(); if (panel.classList.contains('show-sub')) enter(); }
  function staggerIn(els, step = 22, rowOf = (i) => i) {
    if (REDUCE) return;
    // only a start keyframe: each tile animates back to its own style, so a dimmed (N/A) tile
    // fades to its dimmed look instead of flashing fully bright first
    let last = null;
    [...els].forEach((el, i) => {
      last = el.animate([{ offset: 0, opacity: 0, transform: 'translateY(12px) scale(.97)' }],
        { duration: 520, delay: Math.min(rowOf(i), 12) * step, easing: SPRING, fill: 'backwards' });
      last.finished.then(() => { el.style.transform = 'translateZ(0)'; requestAnimationFrame(() => { el.style.transform = ''; }); }, () => {});
    });
    if (last) last.finished.then(repaint, () => {});
  }
  // first real content of a freshly opened picker rises in (later refreshes don't re-animate)
  function enter() {
    const body = $('subBody');
    if (!sub.fresh || !panel.classList.contains('show-sub') || body.querySelector('.sv-loading')) return;
    sub.fresh = false;
    staggerIn(body.querySelectorAll('.sv-row, .sv-empty, .sv-note, .sv-foot .set-btn, .dayp'), 28);
    staggerIn(body.querySelectorAll('.mgrid > *'), 22, (i) => Math.floor(i / 7));
  }
  const svIcon = (id) => `<svg><use href="#${id}"/></svg>`;
  const ROW_ICON = { audio: 'i-headphones', keyboard: 'i-keyboard', mouse: 'i-mouse', phone: 'i-phone', gamepad: 'i-pad', watch: 'i-dev', device: 'i-dev' };

  function openSub(view) {
    const switching = panel.classList.contains('show-sub');
    $('subView').style.minHeight = '250px';     // lists size the island; this just avoids a jump while loading
    sub.view = view;
    sub.token++;
    sub.fresh = true;
    clearTimeout(sub.timer);
    const show = () => {
      panel.classList.remove('show-settings');
      $('subActs').innerHTML = '';
      $('subBody').innerHTML = '<div class="sv-list"><div class="sv-empty sv-loading">LOADING…</div></div>';
      panel.classList.add('show-sub');
      ({ wifi: wifiView, bt: btView, audio: audioView, cal: calView })[view]();
    };
    if (switching) { show(); layout(); } else viewSwap(show, 1);
  }
  function closeSub(instant) {
    if (!panel.classList.contains('show-sub')) return;
    sub.view = null;
    sub.token++;
    clearTimeout(sub.timer);
    const hide = () => panel.classList.remove('show-sub');
    if (instant) { hide(); layout(); } else viewSwap(hide, -1);
  }
  $('subBack').addEventListener('click', () => closeSub());
  const setTitle = (txt) => { $('subTitle').innerHTML = `<span class="label" style="color:var(--white)">${esc(txt)}</span>`; };
  const relayout = () => requestAnimationFrame(layout);
  // typing in a picker: keep the island open even if the mouse wanders off
  const typing = () => { const a = document.activeElement; return !!(a && panel.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')); };
  panel.addEventListener('focusin', (e) => { if (e.target.matches('input,select')) syncInteractive(true); });

  function radioSwitch(kind) {
    const key = kind === 'WiFi' ? 'wifi' : 'bluetooth';
    const sw = document.createElement('button');
    sw.className = 'switch' + (S.radios[key] === 'On' ? ' on' : '');
    sw.title = 'Turn ' + (kind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth') + ' on / off';
    sw.innerHTML = '<i></i>';
    sw.addEventListener('click', async () => {
      const next = S.radios[key] === 'On' ? 'Off' : 'On';
      sw.classList.toggle('on', next === 'On');
      const r = await api.sys('setRadio', { kind, state: next });
      if (!r.ok) { sw.classList.toggle('on', next !== 'On'); return; }
      S.radios[key] = next;
      renderRadios();
      setTimeout(() => { if (sub.view) openSub(sub.view); }, next === 'On' ? 2500 : 300);
    });
    return sw;
  }
  function iconBtn(icon, title, fn) {
    const b = document.createElement('button');
    b.className = 'sub-ic'; b.title = title; b.innerHTML = svIcon(icon);
    b.addEventListener('click', fn);
    return b;
  }
  function footButtons(list) {
    return `<div class="sv-foot">${list.map((x, i) => `<button class="set-btn${x.prim ? ' prim' : ''}" data-f="${i}">${esc(x.label)}</button>`).join('')}</div>`;
  }
  function bindFoot(list) {
    $('subBody').querySelectorAll('.sv-foot [data-f]').forEach((b) => b.addEventListener('click', () => list[+b.dataset.f].fn()));
  }
  const openWin = (uri) => api.sys('open', uri);

  // ---- Wi-Fi
  const SEC_LABEL = { open: 'OPEN', owe: 'OPEN · ENCRYPTED', wpa: 'SECURED', wpa2: 'SECURED', wpa3: 'SECURED · WPA3', enterprise: 'WORK / SCHOOL', other: 'SECURED' };
  const wifiUi = { open: null, msg: {}, nets: [] };
  async function wifiView(rescan = true) {
    const tk = sub.token;
    setTitle('WI-FI');
    const acts = $('subActs'); acts.innerHTML = '';
    const rf = iconBtn('i-reset', 'Scan again', () => { rf.classList.add('spin'); wifiView(true); });
    acts.append(rf, radioSwitch('WiFi'));
    const foot = [{ label: 'WI-FI SETTINGS', fn: () => openWin('ms-settings:network-wifi') }];
    if (S.radios.wifi !== 'On') {
      $('subBody').innerHTML = `<div class="sv-list"><div class="sv-empty">Wi-Fi is off.<br/><button class="set-btn" id="wOn">TURN ON</button></div></div>` + footButtons(foot);
      $('wOn').addEventListener('click', () => acts.querySelector('.switch').click());
      bindFoot(foot); relayout(); enter(); return;
    }
    if (rescan) { api.sys('wifiScan'); }
    await wifiLoad(tk);
    if (rescan) { clearTimeout(sub.timer); sub.timer = setTimeout(() => { if (sub.token === tk) wifiLoad(tk).then(() => rf.classList.remove('spin')); }, 3500); }
  }
  async function wifiLoad(tk) {
    const r = await api.sys('wifiList');
    if (sub.token !== tk) return;
    const foot = [{ label: 'WI-FI SETTINGS', fn: () => openWin('ms-settings:network-wifi') }];
    if (!r.ok) {
      const loc = /location/i.test(r.error || '');
      $('subBody').innerHTML = `<div class="sv-list"><div class="sv-empty">${loc
        ? 'Windows only shows nearby Wi-Fi networks to apps that have <b style="color:#fff">location access</b>.<br/>Turn on “Let desktop apps access your location”, then come back.<br/><button class="set-btn" id="wLoc">OPEN LOCATION SETTINGS</button>'
        : 'Couldn’t read Wi-Fi networks: ' + esc(r.error || 'unknown error')}</div></div>` + footButtons(foot);
      if (loc) $('wLoc').addEventListener('click', () => openWin('ms-settings:privacy-location'));
      bindFoot(foot); relayout(); enter(); return;
    }
    wifiUi.nets = r.data.networks || [];
    renderWifi();
  }
  function renderWifi() {
    const nets = wifiUi.nets;
    const foot = [{ label: 'WI-FI SETTINGS', fn: () => openWin('ms-settings:network-wifi') }];
    const bars = (s) => { const n = s >= 75 ? 4 : s >= 50 ? 3 : s >= 25 ? 2 : 1; return `<span class="sig">${[1, 2, 3, 4].map((i) => `<b class="${i <= n ? 'l' : ''}"></b>`).join('')}</span>`; };
    const rows = nets.map((n, i) => {
      const m = wifiUi.msg[n.ssid];
      const status = m ? `<span class="sv-sub${m.err ? ' err' : ''}">${esc(m.text)}</span>`
        : `<span class="sv-sub">${n.connected ? 'CONNECTED' : n.known ? 'SAVED' : SEC_LABEL[n.security] || 'SECURED'}</span>`;
      let extra = '';
      if (wifiUi.open === n.ssid) {
        if (n.connected) {
          extra = `<div class="sv-acts"><button class="set-btn ghost" data-a="disc">DISCONNECT</button><button class="set-btn ghost" data-a="forget">FORGET</button></div>`;
        } else if (n.security === 'enterprise') {
          extra = `<div class="sv-acts"><span class="sv-note">Work / school networks need a sign-in — finish it in Windows.</span><button class="set-btn" data-a="win">OPEN</button></div>`;
        } else if (!n.known && n.security !== 'open' && n.security !== 'owe' || wifiUi.askPw === n.ssid) {
          extra = `<div class="sv-form"><input type="password" maxlength="64" placeholder="Password" autocomplete="off" spellcheck="false" data-pw="${i}"/><button class="set-btn" data-a="join">JOIN</button></div>`;
        } else {
          extra = `<div class="sv-acts"><button class="set-btn" data-a="join">CONNECT</button>${n.known ? '<button class="set-btn ghost" data-a="forget">FORGET</button>' : ''}</div>`;
        }
      }
      return `<div class="sv-item" data-i="${i}"><button class="sv-row${n.connected ? ' on' : ''}" data-row="${i}">` +
        `<span class="sv-ic">${svIcon('i-wifi')}</span><span class="sv-txt"><span class="sv-name">${esc(n.ssid)}</span>${status}</span>` +
        `<span class="sv-end">${n.security !== 'open' && n.security !== 'owe' ? svIcon('i-padlock') : ''}${bars(n.signal)}</span></button>${extra}</div>`;
    }).join('');
    $('subBody').innerHTML = `<div class="sv-list">${rows || '<div class="sv-empty">No networks found nearby.</div>'}</div>` + footButtons(foot);
    bindFoot(foot);
    const body = $('subBody');
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => {
      const n = nets[+b.dataset.row];
      // one click on a saved / open network connects straight away; others open the row
      if (wifiUi.open !== n.ssid && !n.connected && (n.known || n.security === 'open' || n.security === 'owe') && wifiUi.askPw !== n.ssid) { wifiJoin(n, null); return; }
      wifiUi.open = wifiUi.open === n.ssid ? null : n.ssid;
      renderWifi();
    }));
    body.querySelectorAll('.sv-item').forEach((it) => {
      const n = nets[+it.dataset.i];
      it.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'disc') wifiDisconnect();
        else if (a === 'forget') wifiForget(n);
        else if (a === 'win') openWin('ms-settings:network-wifi');
        else if (a === 'join') { const pw = it.querySelector('[data-pw]'); wifiJoin(n, pw ? pw.value : null); }
      }));
      const pw = it.querySelector('[data-pw]');
      if (pw) {
        pw.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') wifiJoin(n, pw.value); if (e.key === 'Escape') { wifiUi.open = null; renderWifi(); } });
        setTimeout(() => pw.focus(), 30);
      }
    });
    relayout();
    enter();
  }
  function wifiMsg(ssid, text, err) { if (text) wifiUi.msg[ssid] = { text, err }; else delete wifiUi.msg[ssid]; }
  async function wifiJoin(n, password) {
    if (password != null) {
      if (password.length < 8) { wifiMsg(n.ssid, 'PASSWORD IS AT LEAST 8 CHARACTERS', true); renderWifi(); return; }
    }
    const tk = sub.token;
    wifiMsg(n.ssid, 'CONNECTING…');
    wifiUi.open = null; wifiUi.askPw = null;
    renderWifi();
    const r = await api.sys('wifiConnect', { ssid: n.ssid, password: password || null });
    if (sub.token !== tk) return;
    if (!r.ok) {
      const enterprise = /enterprise/i.test(r.error || '');
      wifiMsg(n.ssid, enterprise ? 'FINISH SIGN-IN IN WINDOWS' : (r.error || 'COULDN’T CONNECT').toUpperCase(), true);
      if (enterprise) openWin('ms-settings:network-wifi');
      renderWifi(); return;
    }
    if (r.data === 'password') { wifiUi.open = n.ssid; wifiUi.askPw = n.ssid; wifiMsg(n.ssid, null); renderWifi(); return; }
    // Windows connects in the background: check a few times
    let tries = 0;
    const check = async () => {
      if (sub.token !== tk) return;
      const l = await api.sys('wifiList');
      if (sub.token !== tk || !l.ok) return;
      wifiUi.nets = l.data.networks || [];
      const now = wifiUi.nets.find((x) => x.ssid === n.ssid);
      if (now && now.connected) { wifiMsg(n.ssid, null); renderWifi(); slowPoll(); return; }
      if (++tries < 6) { sub.timer = setTimeout(check, 2000); return; }
      wifiMsg(n.ssid, password || !n.known ? 'COULDN’T CONNECT — CHECK THE PASSWORD' : 'COULDN’T CONNECT', true);
      wifiUi.open = n.ssid; wifiUi.askPw = n.ssid;      // let them retype the password
      renderWifi();
    };
    sub.timer = setTimeout(check, 2000);
  }
  async function wifiDisconnect() {
    await api.sys('wifiDisconnect');
    wifiUi.open = null;
    setTimeout(() => { if (sub.view === 'wifi') wifiView(false); slowPoll(); }, 1200);
  }
  async function wifiForget(n) {
    const r = await api.sys('wifiForget', n.profile || n.ssid);
    wifiUi.open = null;
    if (!r.ok) wifiMsg(n.ssid, (r.error || 'COULDN’T FORGET').toUpperCase(), true);
    setTimeout(() => { if (sub.view === 'wifi') wifiView(false); slowPoll(); }, 800);
  }

  // ---- Bluetooth
  async function btView() {
    const tk = sub.token;
    setTitle('BLUETOOTH');
    const acts = $('subActs'); acts.innerHTML = '';
    acts.append(iconBtn('i-reset', 'Refresh', () => btView()), radioSwitch('Bluetooth'));
    const foot = [
      { label: '+ ADD DEVICE', prim: true, fn: () => openWin('ms-settings-connectabledevices:devicediscovery') },
      { label: 'BLUETOOTH SETTINGS', fn: () => openWin('ms-settings:bluetooth') },
    ];
    if (S.radios.bluetooth !== 'On') {
      $('subBody').innerHTML = `<div class="sv-list"><div class="sv-empty">Bluetooth is off.<br/><button class="set-btn" id="bOn">TURN ON</button></div></div>` + footButtons(foot);
      $('bOn').addEventListener('click', () => acts.querySelector('.switch').click());
      bindFoot(foot); relayout(); enter(); return;
    }
    const r = await api.sys('btList');
    if (sub.token !== tk) return;
    const devs = r.ok && r.data ? r.data.devices || [] : [];
    const rows = devs.map((d, i) => `<button class="sv-row${d.connected ? ' on' : ''}" data-d="${i}"><span class="sv-ic">${svIcon(ROW_ICON[d.kind] || 'i-dev')}</span>` +
      `<span class="sv-txt"><span class="sv-name">${esc(d.name)}</span><span class="sv-sub">${d.connected ? 'CONNECTED' : 'PAIRED'}</span></span>` +
      `<span class="sv-end">${svIcon('i-chev')}</span></button>`).join('');
    $('subBody').innerHTML = `<div class="sv-list">${rows || `<div class="sv-empty">${r.ok ? 'No paired devices yet.' : 'Couldn’t list devices: ' + esc(r.error || 'unknown error')}</div>`}</div>` +
      `<div class="sv-note">Connect or disconnect a paired device in Windows (tap it). New devices: put them in pairing mode, then <b style="color:#c7c7cc">Add device</b>.</div>` + footButtons(foot);
    bindFoot(foot);
    $('subBody').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => openWin('ms-settings:bluetooth')));
    relayout();
    enter();
    clearTimeout(sub.timer);
    sub.timer = setTimeout(() => { if (sub.token === tk) btView(); }, 8000);   // keep status fresh while open
  }

  // ---- Sound output
  async function audioView() {
    const tk = sub.token;
    setTitle('SOUND OUTPUT');
    $('subActs').innerHTML = '';
    const r = await api.sys('audioOutputs');
    if (sub.token !== tk) return;
    const foot = [{ label: 'SOUND SETTINGS', fn: () => openWin('ms-settings:sound') }, { label: 'VOLUME MIXER', fn: () => openWin('ms-settings:apps-volume') }];
    const devs = r.ok && r.data ? r.data.devices || [] : [];
    const ico = (n) => /hdmi|displayport|display audio|monitor|nvidia|\bamd\b|intel\(r\) display/i.test(n) ? 'i-monitor'
      : /\b(head(phone|set)s?|ear(buds?|phones?)?|buds|airpods|hands-free)\b/i.test(n) ? 'i-headphones' : 'i-speaker';
    const split = (n) => { const m = n.match(/^(.*?)\s*\((.+)\)$/); return m ? [m[1], m[2]] : [n, '']; };
    const rows = devs.map((d, i) => {
      const [a, b] = split(d.name);
      return `<button class="sv-row${d.active ? ' on' : ''}" data-o="${i}"><span class="sv-ic">${svIcon(ico(d.name))}</span>` +
        `<span class="sv-txt"><span class="sv-name">${esc(a)}</span><span class="sv-sub">${esc(d.active ? 'IN USE' + (b ? ' · ' + b : '') : b || 'OUTPUT')}</span></span>` +
        `<span class="sv-end">${d.active ? '<svg class="chk"><use href="#i-check"/></svg>' : ''}</span></button>`;
    }).join('');
    $('subBody').innerHTML = `<div class="sv-list">${rows || `<div class="sv-empty">${r.ok ? 'No speakers or headphones found.' : 'Couldn’t list outputs: ' + esc(r.error || 'unknown error')}</div>`}</div>` + footButtons(foot);
    bindFoot(foot);
    $('subBody').querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', async () => {
      const d = devs[+b.dataset.o];
      if (d.active) return;
      b.classList.add('busy');
      const res = await api.sys('setAudioOutput', d.id);
      if (sub.token !== tk) return;
      if (!res.ok) { b.classList.remove('busy'); b.querySelector('.sv-sub').textContent = (res.error || 'COULDN’T SWITCH').toUpperCase(); b.querySelector('.sv-sub').classList.add('err'); return; }
      audioView();
      fastPoll();
    }));
    relayout();
    enter();
  }

  // ---- Calendar (month view + your own events + marked days)
  const cal = { month: null, sel: null, data: { events: [], marks: [], linked: false } };
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  function calGridStart(m) { const f = new Date(m.getFullYear(), m.getMonth(), 1); f.setDate(f.getDate() - ((f.getDay() + 6) % 7)); return f; }
  function calView() {
    const now = new Date();
    if (!cal.month) cal.month = new Date(now.getFullYear(), now.getMonth(), 1);
    if (!cal.sel) cal.sel = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const acts = $('subActs'); acts.innerHTML = '';
    const nav = (d) => () => { cal.dir = d; cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + d, 1); calLoad(); };
    const prev = document.createElement('button'); prev.className = 'cal-nav'; prev.title = 'Previous month'; prev.innerHTML = svIcon('i-back'); prev.onclick = nav(-1);
    const next = document.createElement('button'); next.className = 'cal-nav'; next.title = 'Next month'; next.innerHTML = svIcon('i-chev'); next.onclick = nav(1);
    const today = document.createElement('button'); today.className = 'cal-today'; today.textContent = 'TODAY';
    today.onclick = () => { const n = new Date(); cal.dir = Math.sign(new Date(n.getFullYear(), n.getMonth(), 1) - cal.month); cal.month = new Date(n.getFullYear(), n.getMonth(), 1); cal.sel = new Date(n.getFullYear(), n.getMonth(), n.getDate()); calLoad(); };
    acts.append(today, prev, next);
    calLoad();
  }
  async function calLoad() {
    const tk = sub.token;
    const m = cal.month;
    $('subTitle').innerHTML = DM.text(m.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + ' ' + m.getFullYear(), { dot: 2.4, gap: 0.9, color: '#fff' });
    const from = calGridStart(m).getTime();
    const to = from + 42 * 86400e3 + 3 * 3600e3;            // +3 h covers a daylight-saving change
    if (api.calRange) {
      const r = await api.calRange(from, to);
      if (sub.token !== tk) return;
      if (r && r.ok) cal.data = r;
    }
    renderCal();
  }
  function eventsOn(day) {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const e = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    return cal.data.events.filter((ev) => (ev.allDay ? ev.start < e && ev.end > s : ev.start < e && ev.end > s) || (ev.start === ev.end && ev.start >= s && ev.start < e));
  }
  function renderCal() {
    const m = cal.month, now = new Date();
    const start = calGridStart(m);
    const marks = new Set(cal.data.marks || []);
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => `<span class="wd${i > 4 ? ' we' : ''}">${w}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i === 35 && d.getMonth() !== m.getMonth()) break;      // 5-row months stay compact
      const evs = eventsOn(d);
      const dots = evs.slice(0, 3).map((e) => `<i class="${e.local ? 'mine' : ''}"></i>`).join('');
      cells += `<button class="mday${d.getMonth() !== m.getMonth() ? ' out' : ''}${sameDay(d, now) ? ' today' : ''}${sameDay(d, cal.sel) ? ' sel' : ''}" data-k="${i}" title="${d.toDateString()}">` +
        `${marks.has(dayKey(d)) ? '<span class="mk"></span>' : ''}<span>${d.getDate()}</span><span class="ev">${dots}</span></button>`;
    }
    const sel = cal.sel;
    const list = eventsOn(sel);
    const fmtT = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
    const items = list.map((e, i) => `<div class="de${e.local ? ' mine' : ''}"><span class="d"></span><span class="t">${e.allDay ? 'ALL DAY' : fmtT(e.start)}</span>` +
      `<span class="n" title="${esc(e.title)}">${esc(e.title)}</span>${e.local ? `<button class="rm" data-rm="${i}" title="Remove">${svIcon('i-x')}</button>` : '<span class="src">CAL</span>'}</div>`).join('');
    const marked = marks.has(dayKey(sel));
    const nowH = new Date(); nowH.setMinutes(Math.ceil((nowH.getMinutes() + 1) / 15) * 15);
    const defT = `${String(nowH.getHours() % 24).padStart(2, '0')}:${String(nowH.getMinutes() % 60).padStart(2, '0')}`;
    $('subBody').innerHTML = `<div class="cal-split"><div class="mgrid">${cells}</div>` +
      `<div class="dayp"><div class="dayp-head"><span class="dayp-title">${sel.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}</span>` +
      `<button class="mark-btn${marked ? ' on' : ''}" id="calMark" title="Mark this day"><i></i>${marked ? 'MARKED' : 'MARK DAY'}</button></div>` +
      `<div class="dayp-list">${items || `<div class="de-empty">${cal.data.linked ? 'Nothing on this day.' : 'Nothing yet — add something below.'}</div>`}</div>` +
      `<div class="addf"><input class="ttl" id="calTtl" maxlength="80" placeholder="Add event…" spellcheck="false"/>` +
      `<input type="time" id="calTime" value="${cal.lastTime || defT}"/>` +
      `<select id="calDur" title="Length"><option value="15">15 M</option><option value="30">30 M</option><option value="60" selected>1 H</option><option value="90">1.5 H</option><option value="120">2 H</option><option value="180">3 H</option><option value="all">ALL DAY</option></select>` +
      `<button class="add" id="calAdd" title="Add">${svIcon('i-plus')}</button></div><div class="addf-msg" id="calMsg"></div></div></div>`;
    const body = $('subBody');
    body.querySelectorAll('.mday').forEach((b) => b.addEventListener('click', () => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + +b.dataset.k);
      cal.sel = d; cal.pick = true;
      if (d.getMonth() !== m.getMonth()) { cal.dir = d < m ? -1 : 1; cal.month = new Date(d.getFullYear(), d.getMonth(), 1); calLoad(); } else renderCal();
    }));
    body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      const ev = list[+b.dataset.rm];
      if (!api.calRemove) return;
      const r = await api.calRemove(ev.id);
      if (r && r.ok) calLoad(); else $('calMsg').textContent = ((r && r.error) || 'Couldn’t remove').toUpperCase();
    }));
    $('calMark').addEventListener('click', async () => {
      if (!api.calMark) return;
      const r = await api.calMark(dayKey(sel), !marked);
      if (r && r.ok) { cal.data.marks = r.marks; renderCal(); }
    });
    const dur = $('calDur'), time = $('calTime');
    dur.value = cal.lastDur || '60';
    const syncAllDay = () => { time.disabled = dur.value === 'all'; time.style.opacity = time.disabled ? .35 : 1; };
    dur.addEventListener('change', syncAllDay); syncAllDay();
    const add = async () => {
      const title = $('calTtl').value.trim();
      if (!title) { $('calMsg').textContent = 'GIVE IT A NAME FIRST'; $('calTtl').focus(); return; }
      const allDay = dur.value === 'all';
      let s, e;
      if (allDay) { s = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate()).getTime(); e = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 1).getTime(); }
      else {
        const [hh, mm] = (time.value || '09:00').split(':').map(Number);
        s = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), hh, mm).getTime();
        e = s + +dur.value * 60000;
      }
      cal.lastTime = time.value; cal.lastDur = dur.value;
      const r = api.calAdd ? await api.calAdd({ title, start: s, end: e, allDay }) : { ok: false, error: 'unavailable' };
      if (r && r.ok) calLoad(); else $('calMsg').textContent = ((r && r.error) || 'Couldn’t add').toUpperCase();
    };
    $('calAdd').addEventListener('click', add);
    [$('calTtl'), time, dur].forEach((el) => el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') add(); if (e.key === 'Escape') el.blur(); }));
    relayout();
    if (cal.dir && !REDUCE) {
      const k = [{ opacity: 0, transform: `translateX(${36 * cal.dir}px)`, filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }];
      body.querySelector('.mgrid').animate(k, { duration: 460, easing: SPRING });
      $('subTitle').animate(k, { duration: 460, easing: SPRING });
    }
    if (cal.pick && !REDUCE) {
      body.querySelector('.dayp-list').animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING });
      const selEl = body.querySelector('.mday.sel');
      if (selEl) selEl.animate([{ transform: 'scale(.82)' }, { transform: 'none' }], { duration: 420, easing: SPRING });
    }
    cal.dir = 0; cal.pick = false;
    enter();
  }

  // entry points
  function pillClick(kind, btn, subEl, uri, view) {
    return (e) => {
      if (e.target.closest('.pb-ico')) { toggleRadio(kind, btn, subEl, uri); return; }
      if (S.radios[kind === 'WiFi' ? 'wifi' : 'bluetooth'] == null) { openWin(uri); return; }
      openSub(view);
    };
  }
  $('wifiBtn').addEventListener('click', pillClick('WiFi', $('wifiBtn'), $('wifiSub'), 'ms-settings:network-wifi', 'wifi'));
  $('btBtn').addEventListener('click', pillClick('Bluetooth', $('btBtn'), $('btSub'), 'ms-settings:bluetooth', 'bt'));
  $('outBtn').addEventListener('click', (e) => { e.stopPropagation(); openSub('audio'); });
  $('volSlider').addEventListener('contextmenu', (e) => { e.preventDefault(); openSub('audio'); });
  $('calDate').addEventListener('click', () => openSub('cal'));
  $('agenda').addEventListener('click', (e) => { if (!e.target.closest('button')) openSub('cal'); });

  // ---------------------------------------------------------------- screen-time break reminder
  const fmtDur = (secs) => { const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60); return h ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M`; };
  const SCREEN_TIPS = [
    'Blink, stretch, look far away for 20 s.',
    'Stand up, drink water, rest your eyes.',
    'Long session — step away for a bit.',
  ];
  function showScreen(d) {
    // wait for a calm moment: not while the panel is open, a fullscreen app runs, or another peek shows
    const busy = S.expanded || S.autoHidden || S.alarm || (S.notif && Date.now() < S.notifUntil) || Date.now() < S.chargeUntil;
    if (busy) { S.screenPending = d; clearTimeout(showScreen.retry); showScreen.retry = setTimeout(flushScreen, 5000); return; }
    S.screenPending = null;
    const h = Math.max(1, d.hours | 0);
    const n = 28, R = 27;
    let dots = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      dots += `<circle class="on${i === n - 1 ? ' red' : ''}" cx="${(32 + R * Math.cos(a)).toFixed(2)}" cy="${(32 + R * Math.sin(a)).toFixed(2)}" r="2.1" style="animation-delay:${(0.12 + i * 0.035).toFixed(3)}s"/>`;
    }
    $('stRing').innerHTML = `<svg class="ring" viewBox="0 0 64 64">${dots}</svg><div class="num">${DM.text(h + 'H', { dot: 2.6, gap: 0.9, color: '#f0f0f0' })}</div>`;
    $('stTitle').textContent = `${h} hour${h > 1 ? 's' : ''} on screen today`;
    $('stSub').textContent = SCREEN_TIPS[Math.min(h, 3) - 1];
    S.screenUntil = Date.now() + 7500;
    layout();
    clearTimeout(showScreen.t);
    showScreen.t = setTimeout(() => { layout(); repaint(); }, 7550);
  }
  function flushScreen() { if (S.screenPending) showScreen(S.screenPending); }
  $('stime').addEventListener('click', (e) => { e.stopPropagation(); S.screenUntil = 0; layout(); repaint(); });
  if (api.onScreenTime) api.onScreenTime(showScreen);
  function renderScreenPrefs() {
    $('screenSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === S.screenEvery));
    $('screenToday').textContent = 'TODAY: ' + fmtDur(S.screenSecs) + ' ON SCREEN' + (S.screenEvery ? ` · REMINDER EVERY ${S.screenEvery} H` : '');
  }
  $('screenSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    S.screenEvery = +b.dataset.n;
    renderScreenPrefs();
    if (api.setScreenEvery) api.setScreenEvery(S.screenEvery);
  }));
  if (api.onScreenSecs) api.onScreenSecs((secs) => { S.screenSecs = secs; if (panel.classList.contains('show-settings')) renderScreenPrefs(); });
  window.__screen = (h) => showScreen({ hours: h, secs: h * 3600 });   // handy for testing from DevTools

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
    if ([0, 1, 2, 3].includes(p.screenEvery)) S.screenEvery = p.screenEvery;
    if (Number.isFinite(p.screenSecs)) S.screenSecs = p.screenSecs;
    S.software = !!p.software;
    renderScreenPrefs();
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
      async calRange(from, to) {
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const d = (n, h, m = 0) => t.getTime() + n * 86400e3 + (h * 60 + m) * 60000;
        st.local = st.local || [{ id: 'local:1', title: 'Expression Saver demo', start: d(0, 16), end: d(0, 17), local: true, allDay: false }];
        st.marks = st.marks || [];
        return { ok: true, linked: true, marks: st.marks, events: [
          { id: 'x', title: 'Bizkit stand-up', start: d(0, 10), end: d(0, 10, 30) }, { id: 'y', title: 'Client call — BuildX', start: d(1, 15), end: d(1, 16) },
          { id: 'z', title: 'Holiday', start: d(4, 0), end: d(5, 0), allDay: true }, ...st.local].filter((e) => e.end > from && e.start < to) };
      },
      async calAdd(e) { st.local.push({ ...e, id: 'local:' + Math.random(), local: true }); return { ok: true }; },
      async calRemove(id) { st.local = st.local.filter((e) => e.id !== id); return { ok: true }; },
      async calMark(day, on) { st.marks = on ? [...st.marks, day] : st.marks.filter((x) => x !== day); return { ok: true, marks: st.marks }; },
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
          case 'wifiList': return { ok: true, data: { current: 'Bizkit 5G', networks: [
            { ssid: 'Bizkit 5G', signal: 92, security: 'wpa2', known: true, profile: 'Bizkit 5G', connected: true },
            { ssid: 'Bizkit Guest', signal: 71, security: 'wpa2', known: true, profile: 'Bizkit Guest', connected: false },
            { ssid: 'Zevox Studio', signal: 58, security: 'wpa3', known: false, profile: null, connected: false },
            { ssid: 'Cafe Free WiFi', signal: 34, security: 'open', known: false, profile: null, connected: false },
            { ssid: 'Office-Corp', signal: 22, security: 'enterprise', known: false, profile: null, connected: false }] } };
          case 'wifiConnect': return { ok: true, data: arg.password || arg.ssid !== 'Zevox Studio' ? 'connecting' : 'password' };
          case 'btList': return { ok: true, data: { devices: [
            { name: 'Nothing Ear (2)', connected: true, kind: 'audio' }, { name: 'MX Master 3S', connected: true, kind: 'mouse' },
            { name: 'Keychron K2', connected: false, kind: 'keyboard' }, { name: 'Pixel 8', connected: false, kind: 'phone' }] } };
          case 'audioOutputs': return { ok: true, data: { devices: [
            { id: 'a', name: 'Speakers (Realtek(R) Audio)', active: !st.out || st.out === 'a' },
            { id: 'b', name: 'Headphones (Nothing Ear (2))', active: st.out === 'b' },
            { id: 'c', name: 'LG ULTRAGEAR (NVIDIA High Definition Audio)', active: st.out === 'c' }] } };
          case 'setAudioOutput': st.out = arg; break;
        }
        return { ok: true, data: null };
      },
    };
  }
})();

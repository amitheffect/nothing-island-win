// Minimal iCalendar (.ics) reader: events, time zones, common recurrences, exceptions.
// Used for the "next meeting" countdown. Works with Google Calendar / Outlook "secret iCal" links.

const WIN_TZ = {
  'India Standard Time': 'Asia/Kolkata',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
};

function validTz(tz) {
  if (!tz) return null;
  tz = tz.replace(/^"|"$/g, '');
  if (WIN_TZ[tz]) return WIN_TZ[tz];
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

const fmtCache = new Map();
function offsetAt(tz, ms) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// wall-clock parts -> epoch ms, given how the original DTSTART was expressed
function toMs(c, kind, tz) {
  if (kind === 'utc') return Date.UTC(c.y, c.mo, c.d, c.h, c.mi, c.s);
  if (kind === 'tz') {
    const guess = Date.UTC(c.y, c.mo, c.d, c.h, c.mi, c.s);
    let ms = guess - offsetAt(tz, guess);
    const off2 = offsetAt(tz, ms);
    if (guess - off2 !== ms) ms = guess - off2;
    return ms;
  }
  return new Date(c.y, c.mo, c.d, c.h, c.mi, c.s).getTime(); // floating / all-day = local time
}

function parseDate(value, params) {
  value = (value || '').trim();
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || params.VALUE === 'DATE') {
    m = m || value.match(/^(\d{4})(\d{2})(\d{2})/);
    const c = { y: +m[1], mo: +m[2] - 1, d: +m[3], h: 0, mi: 0, s: 0 };
    return { c, kind: 'local', tz: null, allDay: true, ms: toMs(c, 'local') };
  }
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const c = { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  let kind = 'local', tz = null;
  if (m[7]) kind = 'utc';
  else if (params.TZID) { tz = validTz(params.TZID); if (tz) kind = 'tz'; }
  return { c, kind, tz, allDay: false, ms: toMs(c, kind, tz) };
}

function splitLine(line) {
  // NAME;P1=a;P2="b:c":VALUE  -> split on first ':' outside quotes
  let q = false, i = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ':' && !q) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(s) {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

const MEET_HOSTS = /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)/i;
function findMeetingUrl(texts) {
  const urls = [];
  for (const t of texts) {
    const found = String(t || '').match(/https:\/\/[^\s"'<>\\)]+/g);
    if (found) urls.push(...found);
  }
  return urls.find((u) => MEET_HOSTS.test(u)) || null;
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function addDays(c, n) {
  const d = new Date(Date.UTC(c.y, c.mo, c.d + n));
  return { ...c, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}
function weekday(c) { return new Date(Date.UTC(c.y, c.mo, c.d)).getUTCDay(); }

function expand(ev, from, to) {
  const out = [];
  const { start, dur, rrule, exdates, overridden } = ev;
  const push = (ms) => {
    if (exdates.has(ms) || overridden.has(ms)) return;
    if (ms + dur > from && ms < to) out.push({ start: ms, end: ms + dur });
  };
  if (!rrule) { push(start.ms); return out; }

  const r = {};
  for (const kv of rrule.split(';')) { const [k, v] = kv.split('='); r[k.toUpperCase()] = v; }
  const freq = r.FREQ;
  const interval = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  let until = Infinity;
  if (r.UNTIL) { const u = parseDate(r.UNTIL, {}); if (u) until = u.allDay ? u.ms + 86399999 : u.ms; }

  let n = 0;
  const visit = (c) => {
    // returns false to stop
    const ms = toMs(c, start.kind, start.tz);
    if (ms < start.ms) return true;
    n++;
    if (n > count || ms > until || ms > to) return false;
    push(ms);
    return true;
  };

  const LIMIT = 20000;
  if (freq === 'DAILY') {
    for (let i = 0; i < LIMIT; i++) if (!visit(addDays(start.c, i * interval))) break;
  } else if (freq === 'WEEKLY') {
    const byday = (r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : [weekday(start.c)])
      .map((d) => (d + 6) % 7).sort((a, b) => a - b); // Monday = 0
    const weekStart = addDays(start.c, -((weekday(start.c) + 6) % 7));
    outer: for (let w = 0; w < LIMIT; w++) {
      for (const d of byday) if (!visit(addDays(weekStart, w * interval * 7 + d))) break outer;
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; i < LIMIT / 10; i++) {
      const dt = new Date(Date.UTC(start.c.y, start.c.mo + i * interval, 1));
      const c = { ...start.c, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() };
      const days = new Date(Date.UTC(c.y, c.mo + 1, 0)).getUTCDate();
      if (start.c.d > days) continue;
      if (!visit(c)) break;
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; i < 200; i++) {
      const c = { ...start.c, y: start.c.y + i * interval };
      if (c.mo === 1 && c.d === 29 && new Date(Date.UTC(c.y, 1, 29)).getUTCMonth() !== 1) continue;
      if (!visit(c)) break;
    }
  } else {
    push(start.ms);
  }
  return out;
}

/** Parse ICS text and return timed events overlapping [from, to], sorted by start. */
function eventsBetween(text, from, to) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const raw = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }       // skip VALARM etc.
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { raw.push(cur); cur = null; continue; }
    if (depth === 0 && line) cur.push(splitLine(line));
  }

  const events = [];
  const overrides = new Map(); // uid -> Set(original start ms)
  for (const props of raw) {
    const get = (n) => props.find((p) => p.name === n);
    const all = (n) => props.filter((p) => p.name === n);
    const status = (get('STATUS') || {}).value;
    if (status && status.toUpperCase() === 'CANCELLED') continue;
    const ds = get('DTSTART');
    if (!ds) continue;
    const start = parseDate(ds.value, ds.params);
    if (!start || start.allDay) continue; // the island only counts down to timed events
    let end = null;
    const de = get('DTEND');
    if (de) end = parseDate(de.value, de.params);
    let dur = end ? end.ms - start.ms : 30 * 60000;
    const durP = get('DURATION');
    if (!end && durP) {
      const m = durP.value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
      if (m) dur = ((+m[1] || 0) * 7 * 86400 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000;
    }
    const uid = (get('UID') || {}).value || Math.random().toString(36);
    const rid = get('RECURRENCE-ID');
    if (rid) {
      const r = parseDate(rid.value, rid.params);
      if (r) { if (!overrides.has(uid)) overrides.set(uid, new Set()); overrides.get(uid).add(r.ms); }
    }
    const exdates = new Set();
    for (const ex of all('EXDATE')) {
      for (const v of ex.value.split(',')) { const d = parseDate(v, ex.params); if (d) exdates.add(d.ms); }
    }
    const rr = get('RRULE');
    events.push({
      uid,
      isOverride: !!rid,
      title: unescapeText((get('SUMMARY') || {}).value) || 'Busy',
      url: findMeetingUrl([(get('URL') || {}).value, (get('LOCATION') || {}).value,
        unescapeText((get('DESCRIPTION') || {}).value), (get('X-GOOGLE-CONFERENCE') || {}).value]),
      start, dur: Math.max(0, dur),
      rrule: rid ? null : rr ? rr.value : null,
      exdates,
    });
  }

  const out = [];
  for (const ev of events) {
    ev.overridden = (!ev.isOverride && overrides.get(ev.uid)) || new Set();
    for (const o of expand(ev, from, to)) {
      out.push({ id: `${ev.uid}@${o.start}`, title: ev.title, start: o.start, end: o.end, url: ev.url });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

module.exports = { eventsBetween };

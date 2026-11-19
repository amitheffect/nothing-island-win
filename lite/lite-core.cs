// Nothing Island Lite — native Windows version (no Electron, no browser, one small process).
// Compiled on your PC by build.bat with the C# compiler that ships with Windows (C# 5 syntax).
// System access (audio, media, radios, brightness, notifications…) comes from engine.cs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace NI {

  // ===================================================================== settings
  static class Prefs {
    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NothingIslandLite");
    static string FilePath { get { return Path.Combine(Dir, "settings.ini"); } }

    public static bool Notch = false;
    public static bool AutoHide = true;
    public static bool Notifs = true;
    public static string CalUrl = "";   // kept in memory only; stored encrypted (Windows DPAPI)

    public static void Load() {
      try {
        if (!File.Exists(FilePath)) return;
        foreach (string raw in File.ReadAllLines(FilePath)) {
          int eq = raw.IndexOf('=');
          if (eq <= 0) continue;
          string k = raw.Substring(0, eq).Trim(), v = raw.Substring(eq + 1).Trim();
          if (k == "style") Notch = v == "notch";
          else if (k == "autoHide") AutoHide = v != "0";
          else if (k == "notifs") Notifs = v != "0";
          else if (k == "calendar" && v.Length > 0) {
            try {
              byte[] plain = ProtectedData.Unprotect(Convert.FromBase64String(v), null, DataProtectionScope.CurrentUser);
              CalUrl = Calendar.Normalise(Encoding.UTF8.GetString(plain));
            } catch { CalUrl = ""; }
          }
        }
      } catch { }
    }

    public static void Save() {
      try {
        Directory.CreateDirectory(Dir);
        var sb = new StringBuilder();
        sb.AppendLine("style=" + (Notch ? "notch" : "island"));
        sb.AppendLine("autoHide=" + (AutoHide ? "1" : "0"));
        sb.AppendLine("notifs=" + (Notifs ? "1" : "0"));
        if (CalUrl.Length > 0) {
          byte[] enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(CalUrl), null, DataProtectionScope.CurrentUser);
          sb.AppendLine("calendar=" + Convert.ToBase64String(enc));
        }
        File.WriteAllText(FilePath, sb.ToString());
      } catch { }
    }

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static bool StartWithWindows {
      get {
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("NothingIslandLite") != null; }
        catch { return false; }
      }
      set {
        try {
          using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true)) {
            if (k == null) return;
            if (value) k.SetValue("NothingIslandLite", "\"" + Process.GetCurrentProcess().MainModule.FileName + "\"");
            else k.DeleteValue("NothingIslandLite", false);
          }
        } catch { }
      }
    }
  }

  // ===================================================================== calendar (.ics)
  class CalEvent {
    public string Id, Title, Url;
    public DateTime Start, End;   // UTC
  }

  static class Calendar {
    public static volatile List<CalEvent> Events = new List<CalEvent>();
    public static volatile string Error = null;
    public static volatile bool Ok = false;
    public static bool Configured { get { return Prefs.CalUrl.Length > 0; } }

    public static string Normalise(string u) {
      u = (u ?? "").Trim();
      if (u.Length == 0) return "";
      if (u.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase)) u = "https://" + u.Substring(9);
      if (u.Length > 2048) throw new ArgumentException("Link is too long");
      Uri uri;
      if (!Uri.TryCreate(u, UriKind.Absolute, out uri)) throw new ArgumentException("That doesn't look like a link");
      if (uri.Scheme != "https") throw new ArgumentException("Link must start with https://");
      if (uri.UserInfo.Length > 0) throw new ArgumentException("Link must not contain a username or password");
      return uri.AbsoluteUri;
    }

    public static void Refresh() {
      if (!Configured) { Events = new List<CalEvent>(); Ok = false; Error = null; return; }
      try {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var req = (HttpWebRequest)WebRequest.Create(Prefs.CalUrl);
        req.Timeout = 20000; req.ReadWriteTimeout = 20000;
        req.UserAgent = "NothingIslandLite/1.0";
        req.AllowAutoRedirect = true; req.MaximumAutomaticRedirections = 5;
        string text;
        using (var res = (HttpWebResponse)req.GetResponse()) {
          if (res.ResponseUri.Scheme != "https") throw new Exception("Calendar redirected to an insecure address");
          using (Stream s = res.GetResponseStream())
          using (var ms = new MemoryStream()) {
            var buf = new byte[16384]; int n; long total = 0;
            while ((n = s.Read(buf, 0, buf.Length)) > 0) {
              total += n;
              if (total > 10 * 1024 * 1024) throw new Exception("Calendar file is too large");
              ms.Write(buf, 0, n);
            }
            text = Encoding.UTF8.GetString(ms.ToArray());
          }
        }
        if (text.IndexOf("BEGIN:VCALENDAR", StringComparison.Ordinal) < 0) throw new Exception("Not a calendar (.ics) link");
        DateTime now = DateTime.UtcNow;
        Events = Between(text, now.AddHours(-12), now.AddHours(36));
        Ok = true; Error = null;
      } catch (Exception e) {
        Ok = false; Error = e.Message;
      }
    }

    // ---- parsing -------------------------------------------------------------------------
    static readonly Dictionary<string, string> IanaToWin = new Dictionary<string, string> {
      { "Asia/Kolkata", "India Standard Time" }, { "Asia/Calcutta", "India Standard Time" },
      { "UTC", "UTC" }, { "Etc/UTC", "UTC" }, { "GMT", "UTC" },
      { "Europe/London", "GMT Standard Time" }, { "Europe/Berlin", "W. Europe Standard Time" },
      { "Europe/Paris", "Romance Standard Time" }, { "Asia/Dubai", "Arabian Standard Time" },
      { "Asia/Riyadh", "Arab Standard Time" }, { "Asia/Singapore", "Singapore Standard Time" },
      { "Asia/Shanghai", "China Standard Time" }, { "Asia/Tokyo", "Tokyo Standard Time" },
      { "Australia/Sydney", "AUS Eastern Standard Time" }, { "America/New_York", "Eastern Standard Time" },
      { "America/Chicago", "Central Standard Time" }, { "America/Denver", "Mountain Standard Time" },
      { "America/Los_Angeles", "Pacific Standard Time" }, { "Asia/Qatar", "Arab Standard Time" },
      { "Asia/Kuwait", "Arab Standard Time" }, { "Asia/Muscat", "Arabian Standard Time" },
    };

    static TimeZoneInfo Zone(string id) {
      if (string.IsNullOrEmpty(id)) return null;
      id = id.Trim('"');
      string win;
      if (IanaToWin.TryGetValue(id, out win)) id = win;
      try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch { return null; }
    }

    class Stamp {
      public int Y, Mo, D, H, Mi, S;
      public string Kind;          // utc | tz | local
      public TimeZoneInfo Tz;
      public bool AllDay;
      public DateTime Utc;
    }

    static DateTime ToUtc(DateTime date, Stamp st) {
      var wall = new DateTime(date.Year, date.Month, date.Day, st.H, st.Mi, st.S, DateTimeKind.Unspecified);
      if (st.Kind == "utc") return DateTime.SpecifyKind(wall, DateTimeKind.Utc);
      TimeZoneInfo z = st.Kind == "tz" ? st.Tz : TimeZoneInfo.Local;
      try { return TimeZoneInfo.ConvertTimeToUtc(wall, z); }
      catch (ArgumentException) { return TimeZoneInfo.ConvertTimeToUtc(wall.AddHours(1), z); } // inside a DST gap
    }

    static Stamp ParseDate(string value, Dictionary<string, string> prm) {
      value = (value ?? "").Trim();
      Match m = Regex.Match(value, @"^(\d{4})(\d{2})(\d{2})$");
      string vt;
      if (m.Success || (prm.TryGetValue("VALUE", out vt) && vt == "DATE")) {
        if (!m.Success) m = Regex.Match(value, @"^(\d{4})(\d{2})(\d{2})");
        if (!m.Success) return null;
        var a = new Stamp { Y = int.Parse(m.Groups[1].Value), Mo = int.Parse(m.Groups[2].Value), D = int.Parse(m.Groups[3].Value), Kind = "local", AllDay = true };
        a.Utc = ToUtc(new DateTime(a.Y, a.Mo, a.D), a);
        return a;
      }
      m = Regex.Match(value, @"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$");
      if (!m.Success) return null;
      var s = new Stamp {
        Y = int.Parse(m.Groups[1].Value), Mo = int.Parse(m.Groups[2].Value), D = int.Parse(m.Groups[3].Value),
        H = int.Parse(m.Groups[4].Value), Mi = int.Parse(m.Groups[5].Value), S = int.Parse(m.Groups[6].Value), Kind = "local"
      };
      string tzid;
      if (m.Groups[7].Success) s.Kind = "utc";
      else if (prm.TryGetValue("TZID", out tzid)) { s.Tz = Zone(tzid); if (s.Tz != null) s.Kind = "tz"; }
      try { s.Utc = ToUtc(new DateTime(s.Y, s.Mo, s.D), s); } catch { return null; }
      return s;
    }

    class Prop { public string Name, Value; public Dictionary<string, string> Params; }

    static Prop SplitLine(string line) {
      bool q = false; int i = 0;
      for (; i < line.Length; i++) {
        char ch = line[i];
        if (ch == '"') q = !q;
        else if (ch == ':' && !q) break;
      }
      string head = line.Substring(0, i), value = i < line.Length ? line.Substring(i + 1) : "";
      string[] parts = head.Split(';');
      var prm = new Dictionary<string, string>();
      for (int k = 1; k < parts.Length; k++) {
        int eq = parts[k].IndexOf('=');
        if (eq > 0) prm[parts[k].Substring(0, eq).ToUpperInvariant()] = parts[k].Substring(eq + 1).Trim('"');
      }
      return new Prop { Name = parts[0].ToUpperInvariant(), Value = value, Params = prm };
    }

    static string Unescape(string s) {
      if (s == null) return "";
      s = Regex.Replace(s, @"\\n", "\n", RegexOptions.IgnoreCase);
      return Regex.Replace(s, @"\\([,;\\])", "$1");
    }

    static readonly Regex MeetHosts = new Regex(@"(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)", RegexOptions.IgnoreCase);
    static string MeetingUrl(params string[] texts) {
      foreach (string t in texts) {
        if (t == null) continue;
        foreach (Match m in Regex.Matches(t, @"https://[^\s""'<>\\)]+"))
          if (MeetHosts.IsMatch(m.Value)) return m.Value;
      }
      return null;
    }

    class Ev {
      public string Uid, Title, Url, RRule;
      public bool IsOverride;
      public Stamp Start;
      public TimeSpan Dur;
      public HashSet<long> ExDates = new HashSet<long>();
      public HashSet<long> Overridden = new HashSet<long>();
    }

    public static List<CalEvent> Between(string text, DateTime from, DateTime to) {
      string unfolded = Regex.Replace(text.Replace("\r\n", "\n").Replace("\r", "\n"), "\n[ \t]", "");
      var raw = new List<List<Prop>>();
      List<Prop> cur = null; int depth = 0;
      foreach (string line in unfolded.Split('\n')) {
        if (line == "BEGIN:VEVENT") { cur = new List<Prop>(); depth = 0; continue; }
        if (cur == null) continue;
        if (line.StartsWith("BEGIN:")) { depth++; continue; }
        if (line.StartsWith("END:") && depth > 0) { depth--; continue; }
        if (line == "END:VEVENT") { raw.Add(cur); cur = null; continue; }
        if (depth == 0 && line.Length > 0) cur.Add(SplitLine(line));
      }

      var events = new List<Ev>();
      var overrides = new Dictionary<string, HashSet<long>>();
      foreach (List<Prop> props in raw) {
        Func<string, Prop> get = n => props.FirstOrDefault(p => p.Name == n);
        Prop status = get("STATUS");
        if (status != null && status.Value.ToUpperInvariant() == "CANCELLED") continue;
        Prop ds = get("DTSTART");
        if (ds == null) continue;
        Stamp start = ParseDate(ds.Value, ds.Params);
        if (start == null || start.AllDay) continue;   // the island only counts down to timed events
        Prop de = get("DTEND");
        Stamp end = de != null ? ParseDate(de.Value, de.Params) : null;
        TimeSpan dur = end != null ? end.Utc - start.Utc : TimeSpan.FromMinutes(30);
        Prop durP = get("DURATION");
        if (end == null && durP != null) {
          Match m = Regex.Match(durP.Value, @"P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?");
          if (m.Success) {
            Func<int, int> g = i => m.Groups[i].Success ? int.Parse(m.Groups[i].Value) : 0;
            dur = new TimeSpan(g(1) * 7 + g(2), g(3), g(4), g(5));
          }
        }
        Prop uidP = get("UID");
        string uid = uidP != null ? uidP.Value : Guid.NewGuid().ToString();
        Prop rid = get("RECURRENCE-ID");
        if (rid != null) {
          Stamp r = ParseDate(rid.Value, rid.Params);
          if (r != null) {
            if (!overrides.ContainsKey(uid)) overrides[uid] = new HashSet<long>();
            overrides[uid].Add(r.Utc.Ticks);
          }
        }
        var ev = new Ev { Uid = uid, IsOverride = rid != null, Start = start, Dur = dur < TimeSpan.Zero ? TimeSpan.Zero : dur };
        foreach (Prop ex in props.Where(p => p.Name == "EXDATE"))
          foreach (string v in ex.Value.Split(',')) { Stamp d = ParseDate(v, ex.Params); if (d != null) ev.ExDates.Add(d.Utc.Ticks); }
        Prop summary = get("SUMMARY"), url = get("URL"), loc = get("LOCATION"), desc = get("DESCRIPTION"), conf = get("X-GOOGLE-CONFERENCE"), rr = get("RRULE");
        ev.Title = summary != null ? Unescape(summary.Value) : "Busy";
        if (ev.Title.Length == 0) ev.Title = "Busy";
        ev.Url = MeetingUrl(url != null ? url.Value : null, loc != null ? loc.Value : null, desc != null ? Unescape(desc.Value) : null, conf != null ? conf.Value : null);
        ev.RRule = rid == null && rr != null ? rr.Value : null;
        events.Add(ev);
      }

      var outList = new List<CalEvent>();
      foreach (Ev ev in events) {
        HashSet<long> ov;
        if (!ev.IsOverride && overrides.TryGetValue(ev.Uid, out ov)) ev.Overridden = ov;
        foreach (DateTime s in Expand(ev, from, to))
          outList.Add(new CalEvent { Id = ev.Uid + "@" + s.Ticks, Title = ev.Title, Url = ev.Url, Start = s, End = s + ev.Dur });
      }
      return outList.OrderBy(e => e.Start).ToList();
    }

    static List<DateTime> Expand(Ev ev, DateTime from, DateTime to) {
      var outList = new List<DateTime>();
      Action<DateTime> push = ms => {
        if (ev.ExDates.Contains(ms.Ticks) || ev.Overridden.Contains(ms.Ticks)) return;
        if (ms + ev.Dur > from && ms < to) outList.Add(ms);
      };
      Stamp st = ev.Start;
      if (ev.RRule == null) { push(st.Utc); return outList; }

      var r = new Dictionary<string, string>();
      foreach (string kv in ev.RRule.Split(';')) { int eq = kv.IndexOf('='); if (eq > 0) r[kv.Substring(0, eq).ToUpperInvariant()] = kv.Substring(eq + 1); }
      string freq; r.TryGetValue("FREQ", out freq);
      string sv;
      int interval = r.TryGetValue("INTERVAL", out sv) ? Math.Max(1, int.Parse(sv)) : 1;
      int count = r.TryGetValue("COUNT", out sv) ? int.Parse(sv) : int.MaxValue;
      DateTime until = DateTime.MaxValue;
      if (r.TryGetValue("UNTIL", out sv)) {
        Stamp u = ParseDate(sv, new Dictionary<string, string>());
        if (u != null) until = u.AllDay ? u.Utc.AddDays(1).AddTicks(-1) : u.Utc;
      }

      var baseDate = new DateTime(st.Y, st.Mo, st.D);
      int n = 0;
      Func<DateTime, bool> visit = date => {
        DateTime ms = ToUtc(date, st);
        if (ms < st.Utc) return true;
        n++;
        if (n > count || ms > until || ms > to) return false;
        push(ms);
        return true;
      };

      try {
        if (freq == "DAILY") {
          for (int i = 0; i < 20000; i++) if (!visit(baseDate.AddDays((double)i * interval))) break;
        } else if (freq == "WEEKLY") {
          var days = new List<int>();
          string byday;
          if (r.TryGetValue("BYDAY", out byday)) {
            string[] names = { "MO", "TU", "WE", "TH", "FR", "SA", "SU" };
            foreach (string d in byday.Split(',')) { string k = d.Length >= 2 ? d.Substring(d.Length - 2) : d; int idx = Array.IndexOf(names, k); if (idx >= 0) days.Add(idx); }
          }
          if (days.Count == 0) days.Add(((int)baseDate.DayOfWeek + 6) % 7);
          days.Sort();
          DateTime weekStart = baseDate.AddDays(-(((int)baseDate.DayOfWeek + 6) % 7));
          bool stop = false;
          for (int w = 0; w < 5000 && !stop; w++)
            foreach (int d in days) if (!visit(weekStart.AddDays((double)w * interval * 7 + d))) { stop = true; break; }
        } else if (freq == "MONTHLY") {
          for (int i = 0; i < 2000; i++) {
            DateTime first = new DateTime(baseDate.Year, baseDate.Month, 1).AddMonths(i * interval);
            if (baseDate.Day > DateTime.DaysInMonth(first.Year, first.Month)) continue;
            if (!visit(new DateTime(first.Year, first.Month, baseDate.Day))) break;
          }
        } else if (freq == "YEARLY") {
          for (int i = 0; i < 200; i++) {
            int y = baseDate.Year + i * interval;
            if (baseDate.Month == 2 && baseDate.Day == 29 && !DateTime.IsLeapYear(y)) continue;
            if (!visit(new DateTime(y, baseDate.Month, baseDate.Day))) break;
          }
        } else push(st.Utc);
      } catch (ArgumentOutOfRangeException) { }
      return outList;
    }
  }
}

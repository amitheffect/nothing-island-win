// Nothing Island Lite — the island window: state, layout, drawing and input.
// One per-pixel-alpha layered window that is exactly as big as the island, so everything around it
// is naturally click-through and nothing is drawn that you can't see.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.Linq;
using System.Media;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace NI {

  class Hit { public RectangleF R; public string Id; }
  class Peek { public string App, Title, Body, Icon, Action, Url; public int Ms = 4500; }

  // values read on the engine thread and handed to the UI thread
  class Snapshot {
    public int Volume = -1; public bool Muted; public bool? MicMuted;
    public bool MediaActive, Playing, HasThumb; public string Title = "", Artist = "", App = "";
    public double Pos, Dur;
    public bool Fullscreen;
    public List<Peek> Notifs = new List<Peek>();
    public List<string> MicApps = new List<string>(), CamApps = new List<string>();
  }
  class SlowSnapshot {
    public string Wifi, Bluetooth, Ssid; public int? Signal;
    public bool BriSupported; public int Bri; public bool Dark;
  }

  partial class Island : Form {
    // ---------------------------------------------------------------- native
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int W, H; public SIZE(int w, int h) { W = w; H = h; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLENDFUNCTION { public byte Op, Flags, Alpha, Format; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER {
      public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }
    [DllImport("user32.dll", SetLastError = true)] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);

    // ---------------------------------------------------------------- state
    public float S = 1f;                       // DPI scale
    readonly Engine engine;
    string mode = "idle", lastMode = "";
    float cw = 196, ch = 34, cr = 17, vw, vh, vr;      // animated size
    float tw = 196, th = 34, tr = 17;                 // target size
    float ca = 1f;                                    // content alpha
    float swipe, swipeV, swipeTarget;                 // pill nudge
    bool expanded, hover, alarm, autoHidden;
    DateTime hudUntil, chargeUntil, peekUntil, lastActivity = DateTime.Now;
    string hudKind = "volume";
    bool chargePlugged;
    Peek peek; readonly List<Peek> peekQueue = new List<Peek>();
    readonly HashSet<string> peeked = new HashSet<string>();

    // system values
    int volume = -1; bool muted; bool? micMuted; DateTime lastLocalVol, lastLocalBri;
    Snapshot media = new Snapshot(); string mediaKey = ""; Art art;
    SlowSnapshot slow = new SlowSnapshot();
    List<string> micApps = new List<string>(), camApps = new List<string>(); bool privPrimed;
    bool fullscreen;
    PowerLineStatus lastPower = PowerLineStatus.Unknown;

    // timer
    int timerTotal = 300; double timerRemaining = 300; bool timerRunning; DateTime timerEnd;
    SoundPlayer beeper; MemoryStream beepWav;

    // input
    readonly List<Hit> hits = new List<Hit>();
    Point downPt; string downId; DateTime downAt; bool holdFired, gestureMoved; string dragSlider;
    readonly Timer anim = new Timer { Interval = 15 }, tick = new Timer { Interval = 250 }, leave = new Timer { Interval = 650 }, hold = new Timer { Interval = 550 };
    bool hour12;
    int tickCount;

    // drawing resources
    IntPtr memDC, dib, oldBmp, bits; Bitmap canvas; int bufW, bufH;
    readonly Font fTitle, fBody, fSmall, fName, fMono, fMonoS, fMonoXS;
    readonly StringFormat sfEllipsis = new StringFormat(StringFormatFlags.NoWrap) { Trimming = StringTrimming.EllipsisCharacter };
    readonly StringFormat sfTypo = (StringFormat)StringFormat.GenericTypographic.Clone();

    public Island() {
      engine = new Engine(this);
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      StartPosition = FormStartPosition.Manual;
      Text = "Nothing Island";
      using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) S = Math.Max(1f, g.DpiX / 96f);
      string sans = FontExists("Segoe UI Variable Display") ? "Segoe UI Variable Display" : "Segoe UI";
      string mono = FontExists("Cascadia Mono") ? "Cascadia Mono" : "Consolas";
      fTitle = new Font(sans, 14, FontStyle.Bold, GraphicsUnit.Pixel);
      fName = new Font(sans, 12, FontStyle.Bold, GraphicsUnit.Pixel);
      fBody = new Font(sans, 12, FontStyle.Regular, GraphicsUnit.Pixel);
      fSmall = new Font(sans, 11, FontStyle.Regular, GraphicsUnit.Pixel);
      fMono = new Font(mono, 10, FontStyle.Regular, GraphicsUnit.Pixel);
      fMonoS = new Font(mono, 9, FontStyle.Regular, GraphicsUnit.Pixel);
      fMonoXS = new Font(mono, 8, FontStyle.Regular, GraphicsUnit.Pixel);
      sfTypo.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
      hour12 = CultureInfo.CurrentCulture.DateTimeFormat.ShortTimePattern.Contains("h");
      Size = new Size(1, 1);
      Shown += (s, e) => Paint0();

      anim.Tick += (s, e) => Step();
      tick.Tick += (s, e) => OnTick();
      leave.Tick += (s, e) => { leave.Stop(); if (!hover && dragSlider == null && expanded) Collapse(); };
      hold.Tick += (s, e) => { hold.Stop(); if (downId == "pill" && !gestureMoved) { holdFired = true; MediaAction("toggle"); Nudge(0, true); } };
    }

    static bool FontExists(string name) {
      using (var fams = new InstalledFontCollection()) return fams.Families.Any(f => f.Name == name);
    }

    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= 0x00080000 | 0x00000080 | 0x00000008 | 0x08000000; // LAYERED | TOOLWINDOW | TOPMOST | NOACTIVATE
        return cp;
      }
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      RegisterHotKey(Handle, 1, 0x0002 | 0x0001 | 0x4000, 0x20);   // Ctrl+Alt+Space (no repeat)
      engine.Start();
      tick.Start();
      Retarget();
      cw = tw; ch = th; cr = tr;
      Paint0();
    }

    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x0312 && m.WParam.ToInt32() == 1) { if (expanded) Collapse(); else Expand(); return; }   // WM_HOTKEY
      if (m.Msg == 0x020E) { OnHWheel((short)((m.WParam.ToInt64() >> 16) & 0xFFFF)); m.Result = IntPtr.Zero; return; } // WM_MOUSEHWHEEL
      base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing) {
      try { if (IsHandleCreated) UnregisterHotKey(Handle, 1); } catch { }
      FreeBuffer();
      base.Dispose(disposing);
    }

    // ================================================================ modes & sizes
    string ComputeMode() {
      DateTime now = DateTime.Now;
      if (alarm) return "alarm";
      if (expanded) return "expanded";
      if (peek != null && now < peekUntil) return "notif";
      if (now < chargeUntil) return "charge";
      if (now < hudUntil) return "hud";
      if (timerRunning) return "timer";
      if (Meet() != null) return "meet";
      if (media.MediaActive && media.Playing) return "media";
      return "idle";
    }

    public void Retarget() {
      string m = ComputeMode();
      if (m != mode) { lastMode = mode; mode = m; ca = 0f; }
      switch (mode) {
        case "expanded": tw = 460; th = PanelHeight(); tr = 34; break;
        case "hud": tw = 320; th = 40; tr = 20; break;
        case "charge": tw = 300; th = 40; tr = 20; break;
        case "notif": tw = 360; th = 62; tr = 31; break;
        case "alarm": tw = 330; th = 64; tr = 32; break;
        case "media": tw = 196; th = 34; tr = 17; break;
        default: tw = Math.Max(196, PillContentWidth() + 36); th = 34; tr = 17; break;
      }
      if (Prefs.Notch) { th += 4; tr = mode == "expanded" ? 30 : Math.Min(tr, 14); }
      Kick();
    }

    void Kick() { if (!anim.Enabled) anim.Start(); }

    // spring animation; stops itself when everything has settled
    void Step() {
      const float k = 0.16f, damp = 0.68f;
      vw = (vw + (tw - cw) * k) * damp; cw += vw;
      vh = (vh + (th - ch) * k) * damp; ch += vh;
      vr = (vr + (tr - cr) * k) * damp; cr += vr;
      swipeV = (swipeV + (swipeTarget - swipe) * 0.25f) * 0.6f; swipe += swipeV;
      if (ca < 1f) ca = Math.Min(1f, ca + 0.09f);
      bool settled = Math.Abs(tw - cw) < 0.3f && Math.Abs(th - ch) < 0.3f && Math.Abs(tr - cr) < 0.3f && Math.Abs(vw) < 0.2f && Math.Abs(vh) < 0.2f &&
                     Math.Abs(swipe - swipeTarget) < 0.3f && Math.Abs(swipeV) < 0.2f && ca >= 1f;
      if (settled) { cw = tw; ch = th; cr = tr; swipe = swipeTarget; anim.Stop(); }
      Paint0();
    }

    // ================================================================ periodic work
    void OnTick() {
      tickCount++;
      DateTime now = DateTime.Now;
      if (timerRunning) {
        timerRemaining = Math.Max(0, (timerEnd - now).TotalSeconds);
        if (timerRemaining <= 0) { timerRunning = false; timerRemaining = timerTotal; FireAlarm(); }
      }
      // power plug in/out
      PowerStatus ps = SystemInformation.PowerStatus;
      if (lastPower != PowerLineStatus.Unknown && ps.PowerLineStatus != lastPower && (ps.BatteryChargeStatus & BatteryChargeStatus.NoSystemBattery) == 0) {
        chargePlugged = ps.PowerLineStatus == PowerLineStatus.Online;
        chargeUntil = now.AddMilliseconds(2800);
      }
      lastPower = ps.PowerLineStatus;
      if (tickCount % 4 == 0) { TickMeetings(); KeepOnTop(); }
      if (peek != null && now >= peekUntil) NextPeek();
      string m = ComputeMode();
      if (m != mode) Retarget();
      else if (mode == "idle" || mode == "timer" || mode == "meet") { float want = Math.Max(196, PillContentWidth() + 36); if (Math.Abs(want - tw) > 0.5f) Retarget(); }
      // redraw only what moves: eq / blinking dots every tick, clock & panel once a second
      bool animated = mode == "media" || mode == "timer" || mode == "alarm" || (mode == "meet" && Meet() != null && Meet().Live) || (mode == "charge");
      if (!anim.Enabled && (animated || (tickCount % 4 == 0 && (mode == "idle" || mode == "expanded")))) Paint0();
      if (alarm && tickCount % 2 == 0) Paint0();
      // memory: when idle for a while, give pages back to Windows
      if (!expanded && !hover && (now - lastActivity).TotalSeconds > 20 && tickCount % 240 == 0) engine.Do(Mem.TrimSelf);
    }

    void KeepOnTop() {
      if (!Visible) return;
      SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
    }

    public int FastDelay() {
      if (autoHidden) return 3000;
      if (expanded || hover) return 700;
      if (media.MediaActive && media.Playing) return 1200;
      return 1800;
    }
    public bool IsExpanded { get { return expanded; } }

    // ================================================================ data from the engine thread
    public void Apply(Snapshot s) {
      if (s.Volume >= 0) {
        bool external = volume >= 0 && dragSlider != "vol" && (DateTime.Now - lastLocalVol).TotalMilliseconds > 1500 && (s.Volume != volume || s.Muted != muted);
        if (dragSlider != "vol" && (DateTime.Now - lastLocalVol).TotalMilliseconds > 800) { volume = s.Volume; muted = s.Muted; }
        if (external && !expanded) ShowHud("volume");
      }
      micMuted = s.MicMuted;
      bool wasFs = fullscreen;
      fullscreen = s.Fullscreen;
      if (wasFs != fullscreen) UpdateAutoHide();
      string prevKey = mediaKey;
      media = s;
      string key = s.MediaActive ? s.Title + "|" + s.Artist + "|" + s.App : "";
      if (key != mediaKey) {
        mediaKey = key; art = null;
        if (s.MediaActive && s.HasThumb) engine.FetchArt(key);
        if (prevKey.Length > 0 && key.Length > 0 && s.Playing && !expanded)
          ShowPeek(new Peek { Icon = "art", App = "NOW PLAYING", Title = s.Title, Body = s.Artist, Ms = 3000 });
      }
      if (!autoHidden) foreach (Peek p in s.Notifs.Take(3)) QueuePeek(p);
      UpdatePrivacy(s.MicApps, s.CamApps);
      Retarget();
      if (!anim.Enabled) Paint0();
    }
    public void ApplySlow(SlowSnapshot s) {
      bool bExternal = slow.BriSupported && s.BriSupported && (DateTime.Now - lastLocalBri).TotalMilliseconds > 2500 && s.Bri != slow.Bri;
      int keepBri = slow.Bri;
      bool keepDark = slow.Dark;
      slow = s;
      if ((DateTime.Now - lastLocalBri).TotalMilliseconds < 1500 || dragSlider == "bri") slow.Bri = keepBri;
      if (bExternal && !expanded) ShowHud("brightness");
      if (!anim.Enabled) Paint0();
    }
    public void ApplyArt(string key, Art a) { if (key == mediaKey) { art = a; if (!anim.Enabled) Paint0(); } }
    public void CalendarUpdated() { TickMeetings(); Retarget(); if (!anim.Enabled) Paint0(); }

    void UpdatePrivacy(List<string> mic, List<string> cam) {
      List<string> nm = Nice(mic), nc = Nice(cam);
      if (privPrimed) {
        string newCam = nc.FirstOrDefault(a => !camApps.Contains(a));
        string newMic = nm.FirstOrDefault(a => !micApps.Contains(a));
        if (newCam != null) ShowPeek(new Peek { Icon = "cam", App = "CAMERA ON", Title = newCam + " is using your camera", Body = "Green dot stays on while it's in use", Ms = 3500 });
        else if (newMic != null) ShowPeek(new Peek { Icon = "mic", App = "MICROPHONE ON", Title = newMic + " is using your mic", Body = "Orange dot stays on while it's in use", Ms = 3500 });
      }
      privPrimed = true;
      micApps = nm; camApps = nc;
    }
    static readonly Dictionary<string, string> ProcNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
      { "msedge", "Edge" }, { "chrome", "Chrome" }, { "firefox", "Firefox" }, { "brave", "Brave" }, { "ms-teams", "Teams" },
      { "teams", "Teams" }, { "zoom", "Zoom" }, { "discord", "Discord" }, { "whatsapp", "WhatsApp" }, { "whatsappdesktop", "WhatsApp" },
      { "slack", "Slack" }, { "obs64", "OBS" }, { "windowscamera", "Camera" }, { "afterfx", "After Effects" }, { "adobe premiere pro", "Premiere Pro" },
    };
    static List<string> Nice(List<string> raw) {
      var outL = new List<string>();
      foreach (string r in raw) {
        string k = (r ?? "").Trim(); if (k.Length == 0) continue;
        string n; if (!ProcNames.TryGetValue(k, out n)) n = char.ToUpperInvariant(k[0]) + k.Substring(1);
        if (!outL.Any(x => string.Equals(x, n, StringComparison.OrdinalIgnoreCase))) outL.Add(n);
      }
      return outL;
    }

    // ================================================================ peeks / hud / alarm
    void QueuePeek(Peek p) {
      if (p == null || (string.IsNullOrEmpty(p.Title) && string.IsNullOrEmpty(p.Body))) return;
      peekQueue.Add(p);
      while (peekQueue.Count > 5) peekQueue.RemoveAt(0);
      if (peek == null || DateTime.Now >= peekUntil) NextPeek();
    }
    void ShowPeek(Peek p) {
      if (autoHidden) return;
      peekQueue.Insert(0, p);
      if (peek == null || DateTime.Now >= peekUntil) NextPeek();
    }
    void NextPeek() {
      peek = null;
      if (!expanded && !autoHidden && peekQueue.Count > 0) {
        peek = peekQueue[0]; peekQueue.RemoveAt(0);
        peekUntil = DateTime.Now.AddMilliseconds(peek.Ms);
      } else peekQueue.Clear();
      Retarget();
    }
    void ShowHud(string kind) { hudKind = kind; hudUntil = DateTime.Now.AddMilliseconds(1600); Retarget(); }

    void FireAlarm() {
      alarm = true; expanded = false;
      UpdateAutoHide();
      Retarget();
      try {
        beepWav = BuildBeeps();
        beeper = new SoundPlayer(beepWav);
        beeper.PlayLooping();
      } catch { }
      var stopAfter = new Timer { Interval = 60000 };
      stopAfter.Tick += (s, e) => { stopAfter.Stop(); stopAfter.Dispose(); if (alarm) DismissAlarm(); };
      stopAfter.Start();
    }
    void DismissAlarm() {
      alarm = false;
      if (beeper != null) { try { beeper.Stop(); } catch { } beeper.Dispose(); beeper = null; }
      if (beepWav != null) { beepWav.Dispose(); beepWav = null; }
      UpdateAutoHide();
      Retarget();
    }
    // three short square-wave beeps, then silence; looped
    static MemoryStream BuildBeeps() {
      const int rate = 22050; int total = (int)(rate * 1.3);
      var samples = new short[total];
      double[][] tones = { new[] { 0.0, 990.0 }, new[] { 0.18, 990.0 }, new[] { 0.36, 1320.0 } };
      foreach (double[] t in tones) {
        int start = (int)(t[0] * rate), len = (int)(0.12 * rate);
        for (int i = 0; i < len && start + i < total; i++) {
          double env = Math.Min(1, Math.Min(i, len - i) / (rate * 0.008));
          samples[start + i] = (short)((Math.Sin(2 * Math.PI * t[1] * i / rate) >= 0 ? 1 : -1) * 3500 * env);
        }
      }
      var ms = new MemoryStream();
      var w = new BinaryWriter(ms);
      int dataLen = total * 2;
      w.Write(new[] { 'R', 'I', 'F', 'F' }); w.Write(36 + dataLen); w.Write(new[] { 'W', 'A', 'V', 'E' });
      w.Write(new[] { 'f', 'm', 't', ' ' }); w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
      w.Write(new[] { 'd', 'a', 't', 'a' }); w.Write(dataLen);
      foreach (short s in samples) w.Write(s);
      w.Flush();
      ms.Position = 0;
      return ms;
    }

    // ================================================================ meetings
    class MeetInfo { public CalEvent Ev; public bool Live; public int Mins; }
    MeetInfo Meet() {
      DateTime now = DateTime.UtcNow;
      List<CalEvent> evs = Calendar.Events;
      CalEvent live = evs.FirstOrDefault(ev => ev.Start <= now && now < ev.End);
      if (live != null) return new MeetInfo { Ev = live, Live = true, Mins = (int)Math.Ceiling((live.End - now).TotalMinutes) };
      CalEvent next = evs.FirstOrDefault(ev => ev.Start > now);
      if (next != null && (next.Start - now).TotalMinutes <= 15) return new MeetInfo { Ev = next, Live = false, Mins = Math.Max(1, (int)Math.Ceiling((next.Start - now).TotalMinutes)) };
      return null;
    }
    void TickMeetings() {
      DateTime now = DateTime.UtcNow;
      foreach (CalEvent e in Calendar.Events) {
        double t = (e.Start - now).TotalMinutes;
        if (t <= 5 && t > 4 && peeked.Add(e.Id + ":5"))
          ShowPeek(new Peek { Icon = "cal", App = "IN 5 MINUTES", Title = e.Title, Body = Clock(e.Start.ToLocalTime()) + " – " + Clock(e.End.ToLocalTime()), Action = e.Url != null ? "JOIN" : null, Url = e.Url, Ms = 8000 });
        if (t <= 0 && t > -1.5 && peeked.Add(e.Id + ":0"))
          ShowPeek(new Peek { Icon = "cal", App = "STARTING NOW", Title = e.Title, Body = e.Url != null ? "Tap JOIN to open the call" : "Until " + Clock(e.End.ToLocalTime()), Action = e.Url != null ? "JOIN" : null, Url = e.Url, Ms = 12000 });
      }
    }
    static string Mins(int m) { return m < 60 ? m + "M" : (m / 60) + "H" + (m % 60).ToString("00"); }
    string Clock(DateTime d) {
      int h = d.Hour;
      if (hour12) { h = h % 12; if (h == 0) h = 12; return h + ":" + d.Minute.ToString("00"); }
      return h.ToString("00") + ":" + d.Minute.ToString("00");
    }

    // ================================================================ auto-hide over fullscreen
    void UpdateAutoHide() {
      bool hide = fullscreen && Prefs.AutoHide && !alarm;
      if (hide == autoHidden) return;
      autoHidden = hide;
      if (hide) { expanded = false; peek = null; peekQueue.Clear(); Hide(); }
      else { Show(); KeepOnTop(); Retarget(); }   // ShowWithoutActivation => never steals focus
    }
    public void PrefsChanged() { UpdateAutoHide(); Retarget(); }

    // ================================================================ expand / collapse
    public void Expand() {
      if (alarm) return;
      expanded = true; peek = null; lastActivity = DateTime.Now;
      engine.PollSoon();
      Retarget();
    }
    public void Collapse() { expanded = false; Retarget(); }
    public void ToggleExpand() { if (expanded) Collapse(); else Expand(); }
}
}

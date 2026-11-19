// Nothing Island Lite — background engine thread, settings window, tray icon and entry point.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace NI {

  // ===================================================================== engine thread
  // All slow system calls (WinRT, WMI, UI Automation, registry) run here, never on the UI thread.
  class Engine {
    readonly Island ui;
    readonly Queue<Action> jobs = new Queue<Action>();
    readonly AutoResetEvent wake = new AutoResetEvent(false);
    volatile bool pollNow, slowNow, calNow = true;
    volatile string artWanted;

    public Engine(Island ui) { this.ui = ui; }

    public void Start() {
      var t = new Thread(Loop) { IsBackground = true, Name = "engine" };
      t.SetApartmentState(ApartmentState.STA);
      t.Start();
    }
    public void Do(Action a) { lock (jobs) jobs.Enqueue(a); wake.Set(); }
    public void PollSoon() { pollNow = true; wake.Set(); }
    public void SlowSoon() { slowNow = true; wake.Set(); }
    public void CalendarSoon() { calNow = true; wake.Set(); }
    public void FetchArt(string key) { artWanted = key; wake.Set(); }

    void Post(Action a) {
      try { if (ui.IsHandleCreated && !ui.IsDisposed) ui.BeginInvoke(a); } catch { }
    }

    void Loop() {
      DateTime nextFast = DateTime.MinValue, nextSlow = DateTime.MinValue, nextCal = DateTime.MinValue;
      while (true) {
        Action job = null;
        lock (jobs) if (jobs.Count > 0) job = jobs.Dequeue();
        if (job != null) { try { job(); } catch { } continue; }

        DateTime now = DateTime.UtcNow;
        try {
          if (pollNow || now >= nextFast) { pollNow = false; Fast(); nextFast = DateTime.UtcNow.AddMilliseconds(ui.FastDelay()); }
          if (slowNow || now >= nextSlow) { slowNow = false; Slow(); nextSlow = DateTime.UtcNow.AddMilliseconds(ui.IsExpanded ? 4000 : 12000); }
          if (calNow || now >= nextCal) { calNow = false; Calendar.Refresh(); nextCal = DateTime.UtcNow.AddMinutes(5); Post(() => ui.CalendarUpdated()); }
          string key = artWanted;
          if (key != null) { artWanted = null; Art a = LoadArt(); Post(() => ui.ApplyArt(key, a)); }
        } catch { }
        wake.WaitOne(150);
      }
    }

    void Fast() {
      var s = new Snapshot();
      try { s.Volume = (int)Math.Round(Audio.GetVolume(0) * 100); s.Muted = Audio.GetMute(0); } catch { s.Volume = -1; }
      try { s.MicMuted = Audio.GetMute(1); } catch { s.MicMuted = null; }
      try {
        Dictionary<string, object> m = Media.Get();
        object v;
        s.MediaActive = m.TryGetValue("active", out v) && v is bool && (bool)v;
        if (s.MediaActive) {
          s.Title = (string)m["title"]; s.Artist = (string)m["artist"]; s.App = (string)m["app"];
          s.Playing = (bool)m["playing"]; s.Pos = Convert.ToDouble(m["position"]); s.Dur = Convert.ToDouble(m["duration"]);
          s.HasThumb = (bool)m["hasThumb"];
        }
      } catch { s.MediaActive = false; }
      try { s.Fullscreen = Native.Fullscreen(); } catch { }
      if (Prefs.Notifs) {
        try {
          foreach (Dictionary<string, object> n in Toasts.New())
            s.Notifs.Add(new Peek { App = (string)n["app"], Title = (string)n["title"], Body = (string)n["body"] });
        } catch { }
      }
      try { s.MicApps = Sys.MicApps(); } catch { }
      try { s.CamApps = Sys.InUse("webcam"); } catch { }
      Post(() => ui.Apply(s));
    }

    void Slow() {
      var s = new SlowSnapshot();
      try {
        Dictionary<string, object> r = Radios.State();
        s.Wifi = r["wifi"] as string; s.Bluetooth = r["bluetooth"] as string;
      } catch { }
      if (s.Wifi == "On") {
        try { Dictionary<string, object> w = Sys.Wifi(); s.Ssid = w["ssid"] as string; if (w["signal"] != null) s.Signal = Convert.ToInt32(w["signal"]); } catch { }
      }
      try {
        Dictionary<string, object> b = Sys.Brightness();
        s.BriSupported = b["supported"] is bool && (bool)b["supported"];
        if (s.BriSupported) s.Bri = Convert.ToInt32(b["value"]);
      } catch { }
      try { s.Dark = Sys.Dark(); } catch { }
      Post(() => ui.ApplySlow(s));
    }

    static Art LoadArt() {
      try {
        string url = Media.Thumb();
        if (url == null) return null;
        int comma = url.IndexOf(',');
        byte[] data = Convert.FromBase64String(url.Substring(comma + 1));
        using (var ms = new MemoryStream(data))
        using (var bmp = new Bitmap(ms)) return Art.From(bmp);
      } catch { return null; }
    }
  }

  // ===================================================================== settings window (created only while open)
  class SettingsForm : Form {
    readonly TextBox cal = new TextBox();
    readonly Label status = new Label();
    readonly CheckBox autoHide = new CheckBox(), notifs = new CheckBox(), startup = new CheckBox();

    public SettingsForm() {
      Text = "Nothing Island — Settings";
      FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
      StartPosition = FormStartPosition.CenterScreen;
      BackColor = Color.FromArgb(18, 18, 18); ForeColor = Color.FromArgb(240, 240, 240);
      Font = new Font("Segoe UI", 9.5f);
      AutoScaleMode = AutoScaleMode.Dpi;
      ClientSize = new Size(520, 330);

      var h1 = new Label { Text = "CALENDAR · SECRET ICS LINK", Left = 20, Top = 18, Width = 480, ForeColor = Color.FromArgb(142, 142, 147), Font = new Font("Consolas", 8.5f) };
      cal.SetBounds(20, 42, 380, 26);
      cal.BackColor = Color.Black; cal.ForeColor = Color.White; cal.BorderStyle = BorderStyle.FixedSingle;
      cal.UseSystemPasswordChar = false;
      if (Calendar.Configured) cal.Text = "";
      var save = Btn("Save", 410, 41, 90);
      save.Click += (s, e) => SaveCal();
      var help = new Label {
        Text = "Google Calendar → Settings → your calendar → \"Secret address in iCal format\".\r\nOutlook → Settings → Calendar → Shared calendars → Publish → ICS.",
        Left = 20, Top = 76, Width = 480, Height = 38, ForeColor = Color.FromArgb(142, 142, 147)
      };
      status.SetBounds(20, 116, 480, 20);
      status.Font = new Font("Consolas", 8.5f);
      RefreshStatus();

      autoHide.Text = "Hide over fullscreen games / videos (never over Premiere, After Effects…)";
      autoHide.SetBounds(20, 150, 480, 24); autoHide.Checked = Prefs.AutoHide;
      notifs.Text = "Show notification peeks (WhatsApp, Gmail, Teams…)";
      notifs.SetBounds(20, 178, 480, 24); notifs.Checked = Prefs.Notifs;
      startup.Text = "Start with Windows";
      startup.SetBounds(20, 206, 480, 24); startup.Checked = Prefs.StartWithWindows;
      foreach (CheckBox c in new[] { autoHide, notifs, startup }) { c.ForeColor = ForeColor; c.FlatStyle = FlatStyle.Flat; }

      var diag = Btn("Copy diagnostics", 20, 270, 150);
      diag.Click += (s, e) => LiteApp.CopyDiagnostics();
      var done = Btn("Done", 410, 270, 90);
      done.Click += (s, e) => Close();
      AcceptButton = done;

      Controls.AddRange(new Control[] { h1, cal, save, help, status, autoHide, notifs, startup, diag, done });
      FormClosed += (s, e) => {
        Prefs.AutoHide = autoHide.Checked; Prefs.Notifs = notifs.Checked; Prefs.Save();
        if (startup.Checked != Prefs.StartWithWindows) Prefs.StartWithWindows = startup.Checked;
        LiteApp.PrefsChanged();
      };
    }

    Button Btn(string text, int x, int y, int w) {
      var b = new Button { Text = text, Left = x, Top = y, Width = w, Height = 28, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(240, 240, 240), ForeColor = Color.FromArgb(17, 17, 17) };
      b.FlatAppearance.BorderSize = 0;
      return b;
    }

    void RefreshStatus() {
      if (!Calendar.Configured) { status.Text = "NOT CONNECTED"; status.ForeColor = Color.FromArgb(142, 142, 147); return; }
      if (!Calendar.Ok) { status.Text = "ERROR: " + (Calendar.Error ?? "loading…"); status.ForeColor = Color.FromArgb(215, 25, 33); return; }
      DateTime now = DateTime.UtcNow;
      CalEvent nx = Calendar.Events.FirstOrDefault(ev => ev.Start > now);
      status.Text = "CONNECTED · " + (nx != null ? "NEXT: " + nx.Title + " AT " + nx.Start.ToLocalTime().ToShortTimeString() : "NOTHING IN THE NEXT 36 H");
      status.ForeColor = Color.FromArgb(48, 209, 88);
    }

    void SaveCal() {
      try {
        string url = Calendar.Normalise(cal.Text);
        Prefs.CalUrl = url; Prefs.Save();
        status.Text = "CHECKING…"; status.ForeColor = Color.FromArgb(142, 142, 147);
        cal.Text = "";
        ThreadPool.QueueUserWorkItem(_ => {
          Calendar.Refresh();
          try { BeginInvoke((Action)RefreshStatus); } catch { }
          LiteApp.CalendarChanged();
        });
      } catch (Exception ex) {
        status.Text = "ERROR: " + ex.Message; status.ForeColor = Color.FromArgb(215, 25, 33);
      }
    }
  }

  // ===================================================================== app
  static class LiteApp {
    static Island island;
    static NotifyIcon tray;
    static SettingsForm settings;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    public static void Main() {
      bool created;
      using (var mutex = new Mutex(true, "Local\\NothingIslandLite", out created)) {
        if (!created) return;
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { try { SetProcessDPIAware(); } catch { } }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Prefs.Load();

        island = new Island();
        tray = new NotifyIcon { Text = "Nothing Island", Icon = MakeIcon(), Visible = true };
        tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) island.ToggleExpand(); };
        var menu = new ContextMenu();
        menu.Popup += (s, e) => BuildMenu(menu);
        tray.ContextMenu = menu;
        BuildMenu(menu);

        Application.ApplicationExit += (s, e) => { tray.Visible = false; tray.Dispose(); };
        island.Show();
        Application.Run(island);
      }
    }

    static void BuildMenu(ContextMenu menu) {
      menu.MenuItems.Clear();
      menu.MenuItems.Add(new MenuItem("Nothing Island Lite") { Enabled = false });
      menu.MenuItems.Add("-");
      menu.MenuItems.Add(new MenuItem("Expand  (Ctrl+Alt+Space)", (s, e) => island.ToggleExpand()));
      menu.MenuItems.Add(new MenuItem("Style: Island (floating)", (s, e) => { Prefs.Notch = false; Prefs.Save(); PrefsChanged(); }) { RadioCheck = true, Checked = !Prefs.Notch });
      menu.MenuItems.Add(new MenuItem("Style: Notch (docked)", (s, e) => { Prefs.Notch = true; Prefs.Save(); PrefsChanged(); }) { RadioCheck = true, Checked = Prefs.Notch });
      menu.MenuItems.Add("-");
      menu.MenuItems.Add(new MenuItem("Hide over fullscreen games / videos", (s, e) => { Prefs.AutoHide = !Prefs.AutoHide; Prefs.Save(); PrefsChanged(); }) { Checked = Prefs.AutoHide });
      menu.MenuItems.Add(new MenuItem("Notification peeks", (s, e) => { Prefs.Notifs = !Prefs.Notifs; Prefs.Save(); }) { Checked = Prefs.Notifs });
      menu.MenuItems.Add(new MenuItem("Start with Windows", (s, e) => { Prefs.StartWithWindows = !Prefs.StartWithWindows; }) { Checked = Prefs.StartWithWindows });
      menu.MenuItems.Add(new MenuItem("Settings…", (s, e) => ShowSettings()));
      menu.MenuItems.Add(new MenuItem("Copy diagnostics", (s, e) => CopyDiagnostics()));
      menu.MenuItems.Add("-");
      menu.MenuItems.Add(new MenuItem("Quit", (s, e) => Application.Exit()));
    }

    public static void ShowSettings() {
      if (settings != null && !settings.IsDisposed) { settings.Activate(); return; }
      settings = new SettingsForm();
      settings.FormClosed += (s, e) => { settings = null; GC.Collect(); };
      settings.Show();
      settings.Activate();
    }

    public static void PrefsChanged() { if (island != null) island.BeginInvoke((Action)island.PrefsChanged); }
    public static void CalendarChanged() { if (island != null) island.BeginInvoke((Action)island.CalendarUpdated); }

    public static void CopyDiagnostics() {
      ThreadPool.QueueUserWorkItem(_ => {
        string text;
        try {
          Dictionary<string, object> d = Sys.Diag();
          d["engine"] = "lite";
          d["memoryMB"] = Math.Round(System.Diagnostics.Process.GetCurrentProcess().WorkingSet64 / 1048576.0, 1);
          text = new JavaScriptSerializer().Serialize(d);
        } catch (Exception ex) { text = "diagnostics failed: " + ex.Message; }
        island.BeginInvoke((Action)(() => { try { Clipboard.SetText(text); } catch { } }));
      });
    }

    static Icon MakeIcon() {
      using (var bmp = new Bitmap(32, 32)) {
        using (Graphics g = Graphics.FromImage(bmp)) {
          g.SmoothingMode = SmoothingMode.AntiAlias;
          g.Clear(Color.Transparent);
          using (var pen = new Pen(Color.White, 5)) g.DrawEllipse(pen, 4, 4, 24, 24);
          g.FillEllipse(Brushes.White, 12, 12, 8, 8);
        }
        IntPtr h = bmp.GetHicon();
        return Icon.FromHandle(h);
      }
    }
  }
}

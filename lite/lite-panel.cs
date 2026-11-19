// Nothing Island Lite — the expanded panel (drawing) and all mouse / gesture handling.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace NI {

  partial class Island {

    // grid: 4 columns, rows 100 / 46 / 46 / 124 / 96, gap 10, padding 14 (same as the Electron version)
    const float PadX = 14, Gap = 10, ColW = (460f - 28f - 30f) / 4f;
    static float ColX(int c) { return PadX + c * (ColW + Gap); }
    static float Span(int n) { return n * ColW + (n - 1) * Gap; }
    float PanelHeight() { return 506 + (Prefs.Notch ? 4 : 0); }

    // ---------------------------------------------------------------- panel
    void DrawPanel(Graphics g, float top) {
      float y0 = 14 + top, y1 = y0 + 110, y2 = y1 + 56, y3 = y2 + 56, y4 = y3 + 134, yf = y4 + 106;
      DrawMedia(g, ColX(0), y0, Span(3), 100);
      DrawClockTile(g, ColX(3), y0, 100);
      DrawRadio(g, "wifi", "Wi-Fi", ColX(0), y1, slow.Wifi, slow.Wifi == "On" ? (slow.Ssid != null ? slow.Ssid.ToUpperInvariant() + (slow.Signal.HasValue ? " · " + slow.Signal + "%" : "") : "NOT CONNECTED") : null);
      DrawRadio(g, "bt", "Bluetooth", ColX(2), y1, slow.Bluetooth, slow.Bluetooth == "On" ? "ON" : null);
      DrawSlider(g, "vol", ColX(0), y2, volume < 0 ? -1 : (muted ? 0 : volume), muted || volume == 0 ? "volmute" : "vol", muted ? "MUTE" : null);
      DrawSlider(g, "bri", ColX(2), y2, slow.BriSupported ? slow.Bri : -1, "sun", slow.BriSupported ? null : "N/A");
      DrawTimer(g, ColX(0), y3, Span(2), 124);
      DrawQuad(g, ColX(2), y3, ColW, 124);
      DrawBattery(g, ColX(3), y3, ColW, 124);
      DrawDate(g, ColX(0), y4, ColW, 96);
      DrawAgenda(g, ColX(1), y4, Span(3), 96);
      // footer
      string foot = DateTime.Now.ToString("ddd dd MMM", CultureInfo.InvariantCulture).ToUpperInvariant();
      Tracked(g, foot, fMonoS, Pal.Grey, 20, yf + 5, 1.6f);
      float gx = 460 - 20 - 18;
      Ico(g, "gear", gx, yf + 1, 18, Pal.Grey);
      AddHit("gear", gx - 4, yf - 3, 26, 26);
      string st = Prefs.Notch ? "NOTCH" : "ISLAND";
      float sw = TrackedWidth(g, st, fMonoS, 1.6f) + 34;
      float sx = gx - 10 - sw;
      FillRound(g, Pal.Tile, sx, yf, sw, 20, 10);
      if (Prefs.Notch) { using (var p = new GraphicsPath()) { p.AddLine(sx + 8, yf + 7, sx + 24, yf + 7); p.AddArc(sx + 20, yf + 7, 4, 6, 0, 90); p.AddArc(sx + 8, yf + 7, 4, 6, 90, 90); p.CloseFigure(); using (var b = new SolidBrush(A(Pal.Grey))) g.FillPath(b, p); } }
      else FillRound(g, Pal.Grey, sx + 8, yf + 6.5f, 16, 7, 3.5f);
      Tracked(g, st, fMonoS, Pal.Grey, sx + 30, yf + 5, 1.6f);
      AddHit("style", sx, yf, sw, 20);
    }

    void DrawMedia(Graphics g, float x, float y, float w, float h) {
      FillRound(g, Pal.Tile, x, y, w, h, 22);
      DrawArt(g, new RectangleF(x + 12, y + 12, 76, 76), 22);
      float bx = x + 100, bw = w - 100 - 12;
      Tracked(g, media.MediaActive ? PrettyApp(media.App) : "MEDIA", fMonoS, Pal.Grey, bx, y + 14, 1.6f);
      TextFit(g, media.MediaActive ? (media.Title.Length > 0 ? media.Title : "Unknown title") : "Nothing playing", fTitle, Pal.White, bx - 1, y + 28, bw);
      TextFit(g, media.MediaActive ? media.Artist : "Play something to control it here", fSmall, Pal.Grey, bx - 1, y + 47, bw);
      // controls (right) + progress (left)
      float right = x + w - 12, cyb = y + h - 12 - 17;
      float nx = right - 30, px = nx - 2 - 34, vx = px - 2 - 30;
      Ico(g, "next", nx + 7, cyb - 8, 16, Pal.White); AddHit("m-next", nx, cyb - 15, 30, 30);
      Circle(g, Pal.White, px, cyb - 17, 34);
      Ico(g, media.MediaActive && media.Playing ? "pause" : "play", px + 9, cyb - 8, 16, Pal.Black); AddHit("m-toggle", px, cyb - 17, 34, 34);
      Ico(g, "prev", vx + 7, cyb - 8, 16, Pal.White); AddHit("m-prev", vx, cyb - 15, 30, 30);
      float pw = vx - 10 - bx;
      FillRound(g, Color.FromArgb(255, 58, 58, 60), bx, cyb - 1, pw, 2, 1);
      double frac = media.MediaActive && media.Dur > 0 ? Math.Max(0, Math.Min(1, media.Pos / media.Dur)) : 0;
      if (frac > 0) FillRound(g, Pal.White, bx, cyb - 1, (float)(pw * frac), 2, 1);
    }

    static string PrettyApp(string id) {
      string s = (id ?? "").ToLowerInvariant();
      string[][] known = { new[] { "spotify", "SPOTIFY" }, new[] { "chrome", "CHROME" }, new[] { "msedge", "EDGE" }, new[] { "firefox", "FIREFOX" },
        new[] { "zune", "MEDIA PLAYER" }, new[] { "vlc", "VLC" }, new[] { "brave", "BRAVE" }, new[] { "opera", "OPERA" }, new[] { "apple", "APPLE MUSIC" } };
      foreach (string[] k in known) if (s.Contains(k[0])) return k[1];
      string b = s.Split('!')[0];
      if (b.EndsWith(".exe")) b = b.Substring(0, b.Length - 4);
      b = b.Split('_')[0];
      b = b.Split('.').Last();
      return b.Length > 0 ? b.ToUpperInvariant() : "MEDIA";
    }

    void DrawClockTile(Graphics g, float x, float y, float d) {
      Circle(g, Pal.White, x, y, d);
      float cx = x + d / 2, cyc = y + d / 2, k = d / 100f;
      using (var thin = new Pen(A(Pal.Ink), 0.7f * k)) using (var thick = new Pen(A(Pal.Ink), 1.6f * k)) {
        for (int i = 0; i < 60; i++) {
          double a = i / 60.0 * Math.PI * 2;
          float r1 = (i % 5 == 0 ? 39 : 42) * k, r2 = 45 * k;
          g.DrawLine(i % 5 == 0 ? thick : thin, cx + (float)Math.Sin(a) * r1, cyc - (float)Math.Cos(a) * r1, cx + (float)Math.Sin(a) * r2, cyc - (float)Math.Cos(a) * r2);
        }
      }
      DateTime n = DateTime.Now;
      double sec = n.Second, min = n.Minute + sec / 60, hr = (n.Hour % 12) + min / 60;
      Hand(g, cx, cyc, hr * 30, 20 * k, 0, 3.6f * k, Pal.Ink);
      Hand(g, cx, cyc, min * 6, 33 * k, 0, 2.6f * k, Pal.Ink);
      Hand(g, cx, cyc, sec * 6, 37 * k, 6 * k, 1.2f * k, Pal.Red);
      Circle(g, Pal.Red, cx - 2.4f * k, cyc - 2.4f * k, 4.8f * k);
    }
    void Hand(Graphics g, float cx, float cy, double deg, float len, float tail, float width, Color c) {
      double a = deg * Math.PI / 180;
      using (var p = new Pen(A(c), width) { StartCap = LineCap.Round, EndCap = LineCap.Round })
        g.DrawLine(p, cx - (float)Math.Sin(a) * tail, cy + (float)Math.Cos(a) * tail, cx + (float)Math.Sin(a) * len, cy - (float)Math.Cos(a) * len);
    }

    void DrawRadio(Graphics g, string id, string name, float x, float y, string state, string sub) {
      float w = Span(2), h = 46;
      bool on = state == "On", na = state == null;
      float dim = na ? 0.4f : 1f;
      using (var p = Icons.RoundRect(x, y, w, h, 23)) using (var b = new SolidBrush(A(on ? Pal.White : Pal.Tile, dim))) g.FillPath(b, p);
      using (var b = new SolidBrush(A(on ? Pal.Ink : Pal.Tile2, dim))) g.FillEllipse(b, x + 6, y + 6, 34, 34);
      Icons.Draw(g, id, new RectangleF(x + 6 + 8.5f, y + 6 + 8.5f, 17, 17), A(on ? Pal.White : Pal.White, dim));
      Txt(g, name, fName, on ? Pal.Ink : Pal.White, x + 50, y + 8);
      string subText = na ? "NOT FOUND" : (sub ?? "OFF");
      GraphicsState st = g.Save();
      g.IntersectClip(new RectangleF(x + 50, y, w - 64, h));
      Tracked(g, subText, fMonoS, on ? Color.FromArgb(255, 102, 102, 102) : Pal.Grey, x + 50, y + 26, 0.6f);
      g.Restore(st);
      AddHit(id, x, y, w, h);
    }

    void DrawSlider(Graphics g, string id, float x, float y, int value, string icon, string label) {
      float w = Span(2), h = 46;
      bool na = value < 0 && label != "MUTE";
      float dim = na ? 0.4f : 1f;
      using (var p = Icons.RoundRect(x, y, w, h, 23)) using (var b = new SolidBrush(A(Pal.Tile, dim))) g.FillPath(b, p);
      float fw = value < 0 ? 46 : Math.Max(46, w * value / 100f);
      Color fillC = id == "vol" && muted ? Color.FromArgb(255, 85, 85, 85) : Pal.White;
      using (var p = Icons.RoundRect(x, y, fw, h, 23)) using (var b = new SolidBrush(A(fillC, dim))) g.FillPath(b, p);
      Ico(g, icon, x + 14, y + 14, 18, Pal.Ink);
      string txt = label ?? Math.Max(0, value).ToString();
      float tw2 = Dots.Width(txt, 2.2f, 1f), tx = x + w - 14 - tw2;
      Color tc = fw > tx - x + tw2 / 2 ? Pal.Ink : Pal.White;
      DotsA(g, txt, tx, y + h / 2 - Dots.Height(2.2f, 1f) / 2, 2.2f, 1f, tc, 0);
      if (id == "vol") AddHit("mute", x + 4, y + 4, 38, 38);
      if (!na) AddHit(id, x, y, w, h);
    }

    void DrawTimer(Graphics g, float x, float y, float w, float h) {
      FillRound(g, Pal.White, x, y, w, h, 22);
      string label = timerRunning ? "RUNNING" : timerRemaining < timerTotal ? "PAUSED" : "TIMER";
      Tracked(g, label, fMonoS, Color.FromArgb(255, 119, 119, 119), x + 14, y + 12, 1.6f);
      Ico(g, "reset", x + w - 12 - 18, y + 9, 16, Color.FromArgb(255, 85, 85, 85));
      AddHit("t-reset", x + w - 12 - 24, y + 4, 28, 26);
      string tt = TimerText();
      DotsA(g, tt, x + 14, y + 32, 4, 1.8f, timerRunning ? Pal.Red : Pal.Ink, 0.08f);
      AddHit("t-digits", x + 14, y + 30, w - 28, 44);
      int[] chips = { 1, 5, 10, 25 };
      float cx = x + 14, cyy = y + h - 12 - 18 - 11;
      foreach (int c in chips) {
        string s = c.ToString();
        float cwid = Math.Max(26, TrackedWidth(g, s, fMono, 0) + 12);
        bool sel = c * 60 == timerTotal;
        FillRound(g, sel ? Pal.Ink : Color.FromArgb(255, 224, 224, 224), cx, cyy, cwid, 22, 11);
        Txt(g, s, fMono, sel ? Pal.White : Pal.Ink, cx + (cwid - TrackedWidth(g, s, fMono, 0)) / 2, cyy + 5);
        AddHit("t-" + c, cx, cyy, cwid, 22);
        cx += cwid + 4;
      }
      float gx = x + w - 12 - 36, gy = y + h - 12 - 36;
      Circle(g, Pal.Red, gx, gy, 36);
      Ico(g, timerRunning ? "pause" : "play", gx + 10, gy + 10, 16, Color.White);
      AddHit("t-go", gx, gy, 36, 36);
    }

    void DrawQuad(Graphics g, float x, float y, float w, float h) {
      float d = 46, gp = 8, sx = x + (w - (d * 2 + gp)) / 2, sy = y + (h - (d * 2 + gp)) / 2;
      bool mic = micMuted == true;
      QuadBtn(g, "mic", mic ? "micoff" : "mic", sx, sy, d, mic ? Pal.Red : Pal.Tile, Color.White);
      QuadBtn(g, "dark", "moon", sx + d + gp, sy, d, slow.Dark ? Pal.White : Pal.Tile, slow.Dark ? Pal.Ink : Color.White);
      QuadBtn(g, "snip", "snip", sx, sy + d + gp, d, Pal.Tile, Color.White);
      QuadBtn(g, "lock", "lock", sx + d + gp, sy + d + gp, d, Pal.Tile, Color.White);
    }
    void QuadBtn(Graphics g, string id, string icon, float x, float y, float d, Color bg, Color fg) {
      Circle(g, bg, x, y, d);
      Ico(g, icon, x + 14, y + 14, 18, fg);
      AddHit(id, x, y, d, d);
    }

    void DrawBattery(Graphics g, float x, float y, float w, float h) {
      FillRound(g, Pal.Tile, x, y, w, h, 22);
      PowerStatus ps = SystemInformation.PowerStatus;
      bool desktop = (ps.BatteryChargeStatus & BatteryChargeStatus.NoSystemBattery) != 0;
      bool charging = ps.PowerLineStatus == PowerLineStatus.Online;
      int lvl = desktop ? 100 : (int)Math.Round(ps.BatteryLifePercent * 100);
      bool low = !desktop && lvl <= 20 && !charging;
      Tracked(g, desktop ? "POWER" : charging ? "CHARGING" : "BATTERY", fMonoS, Pal.Grey, x + 12, y + 12, 1.6f);
      if (desktop) DotsA(g, "AC", x + 12, y + 32, 4.4f, 2f, Pal.White, 0);
      else DotsA(g, lvl + "%", x + 12, y + 32, lvl == 100 ? 3.2f : 3.8f, 1.6f, low ? Pal.Red : Pal.White, 0);
      int lit = (int)Math.Round(lvl / 10.0);
      float dot = (w - 24 - 9 * 3) / 10f;
      bool blink = charging && !desktop && DateTime.Now.Millisecond < 500;
      for (int i = 0; i < 10; i++) {
        bool on = i < lit && !(blink && i == lit - 1);
        Circle(g, on ? (low ? Pal.Red : Pal.White) : Color.FromArgb(255, 51, 51, 51), x + 12 + i * (dot + 3), y + h - 12 - dot, dot);
      }
    }

    void DrawDate(Graphics g, float x, float y, float w, float h) {
      FillRound(g, Pal.White, x, y, w, h, 22);
      DateTime n = DateTime.Now;
      string day = n.ToString("ddd", CultureInfo.InvariantCulture).ToUpperInvariant();
      string mon = n.ToString("MMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant();
      Tracked(g, day, fMonoS, Pal.Red, x + (w - TrackedWidth(g, day, fMonoS, 1.8f)) / 2, y + 10, 1.8f);
      string num = n.Day.ToString();
      DotsA(g, num, x + (w - Dots.Width(num, 4.2f, 1.4f)) / 2, y + 27, 4.2f, 1.4f, Pal.Ink, 0);
      Tracked(g, mon, fMonoS, Color.FromArgb(255, 119, 119, 119), x + (w - TrackedWidth(g, mon, fMonoS, 1.8f)) / 2, y + h - 22, 1.8f);
    }

    void DrawAgenda(Graphics g, float x, float y, float w, float h) {
      FillRound(g, Pal.Tile, x, y, w, h, 22);
      DateTime n = DateTime.Now;
      // week strip, Monday first
      DateTime mon = n.Date.AddDays(-(((int)n.DayOfWeek + 6) % 7));
      float wx = x + w - 14 - 7 * 14 - 6 * 5;
      for (int i = 0; i < 7; i++) {
        DateTime d = mon.AddDays(i);
        string s = d.Day.ToString();
        bool today = d.Date == n.Date;
        if (today) FillRound(g, Pal.White, wx + i * 19, y + 11, 14, 14, 7);
        float tw2 = TrackedWidth(g, s, fMonoXS, 0);
        Txt(g, s, fMonoXS, today ? Pal.Ink : Color.FromArgb(255, 85, 85, 85), wx + i * 19 + (14 - tw2) / 2, y + 13);
      }
      if (!Calendar.Configured) {
        Tracked(g, "CALENDAR", fMonoS, Pal.Grey, x + 14, y + 13, 1.6f);
        TextFit(g, "No calendar connected.", fSmall, Pal.Grey, x + 14, y + 36, w - 28);
        Txt(g, "Add your calendar link →", fSmall, Pal.White, x + 14, y + 54);
        AddHit("cal-add", x + 10, y + 50, 180, 22);
        return;
      }
      if (!Calendar.Ok) {
        Tracked(g, "CALENDAR", fMonoS, Pal.Grey, x + 14, y + 13, 1.6f);
        TextFit(g, "Couldn't load your calendar: " + (Calendar.Error ?? "unknown error"), fSmall, Pal.Grey, x + 14, y + 36, w - 28);
        AddHit("cal-add", x, y + 30, w, h - 30);
        return;
      }
      DateTime now = DateTime.UtcNow;
      List<CalEvent> items = Calendar.Events.Where(ev => ev.End > now).Take(3).ToList();
      Tracked(g, items.Count > 0 ? "UP NEXT" : "CALENDAR", fMonoS, Pal.Grey, x + 14, y + 13, 1.6f);
      if (items.Count == 0) { TextFit(g, "Nothing scheduled for today or tomorrow.", fSmall, Pal.Grey, x + 14, y + 36, w - 28); return; }
      for (int i = 0; i < items.Count; i++) {
        CalEvent e = items[i];
        float ry = y + 32 + i * 21, rc = ry + 9;
        bool live = e.Start <= now;
        DateTime ls = e.Start.ToLocalTime();
        bool blink = DateTime.Now.Millisecond < 500;
        if (!live || blink) Circle(g, live ? Pal.Red : Color.FromArgb(255, 85, 85, 85), x + 14, rc - 2.5f, 5);
        string when = live ? "NOW" : Clock(ls) + (hour12 ? (ls.Hour < 12 ? " AM" : " PM") : "");
        Txt(g, when, fMono, live ? Pal.Red : Pal.Grey, x + 26, rc - 7);
        float nx = x + 26 + 60;
        float right = x + w - 14;
        if (e.Url != null) {
          float bw = 44;
          FillRound(g, Pal.White, right - bw, rc - 9, bw, 18, 9);
          Tracked(g, "JOIN", fMonoXS, Pal.Ink, right - bw + 9, rc - 5, 1.4f);
          AddHit("join-" + i, right - bw, rc - 9, bw, 18);
          right -= bw + 8;
        }
        string title = e.Title;
        if (!live && ls.Date != DateTime.Now.Date) title = "TMRW · " + title;
        TextFit(g, title, fBody, Pal.White, nx, rc - 9, right - nx);
      }
    }

    // ================================================================ input
    PointF L(Point p) { return new PointF(p.X / S - Ear - 1 / S, p.Y / S); }
    string HitAt(Point p) {
      PointF q = L(p);
      for (int i = hits.Count - 1; i >= 0; i--) if (hits[i].R.Contains(q)) return hits[i].Id;
      return null;
    }

    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); hover = true; leave.Stop(); lastActivity = DateTime.Now; Retarget(); }
    protected override void OnMouseLeave(EventArgs e) {
      base.OnMouseLeave(e);
      hover = false;
      if (expanded && dragSlider == null) { leave.Stop(); leave.Start(); }
    }

    protected override void OnMouseDown(MouseEventArgs e) {
      base.OnMouseDown(e);
      lastActivity = DateTime.Now;
      downPt = e.Location; downAt = DateTime.Now; holdFired = false; gestureMoved = false;
      downId = HitAt(e.Location);
      if (e.Button != MouseButtons.Left) return;
      if (downId == "vol" || downId == "bri") { dragSlider = downId; SliderFromMouse(e.Location); }
      if (downId == "pill") { hold.Stop(); hold.Start(); }
    }

    protected override void OnMouseMove(MouseEventArgs e) {
      base.OnMouseMove(e);
      if (e.Button != MouseButtons.Left) return;
      if (dragSlider != null) { SliderFromMouse(e.Location); return; }
      if (downId == "pill") {
        float dx = (e.X - downPt.X) / S;
        if (Math.Abs(dx) > 6) gestureMoved = true;
        if (gestureMoved) { swipeTarget = Math.Max(-16, Math.Min(16, dx * 0.3f)); Kick(); }
      }
    }

    protected override void OnMouseUp(MouseEventArgs e) {
      base.OnMouseUp(e);
      hold.Stop();
      if (dragSlider != null) { dragSlider = null; if (!hover && expanded) { leave.Stop(); leave.Start(); } return; }
      string id = HitAt(e.Location);
      if (e.Button == MouseButtons.Right) {
        if (id == "wifi") Open("ms-settings:network-wifi");
        else if (id == "bt") Open("ms-settings:bluetooth");
        return;
      }
      if (downId == "pill") {
        float dx = (e.X - downPt.X) / S;
        swipeTarget = 0; Kick();
        if (holdFired) return;
        if (Math.Abs(dx) > 36) { MediaAction(dx < 0 ? "next" : "prev"); Nudge(dx < 0 ? -1 : 1, false); return; }
        if (!gestureMoved) Expand();
        return;
      }
      if (id != null && id == downId) Click(id);
    }

    protected override void OnMouseWheel(MouseEventArgs e) {
      base.OnMouseWheel(e);
      lastActivity = DateTime.Now;
      string id = HitAt(e.Location);
      int step = e.Delta > 0 ? 1 : -1;
      if (!expanded) {
        if (volume < 0) return;
        SetVolume(volume + step * 2); ShowHud("volume"); return;
      }
      if (id == "vol" || id == "mute") SetVolume(volume + step * 5);
      else if (id == "bri" && slow.BriSupported) SetBrightness(slow.Bri + step * 5);
      else if (id == "t-digits" && !timerRunning) {
        timerTotal = Math.Max(60, Math.Min(180 * 60, (timerTotal / 60) * 60 + step * 60));
        timerRemaining = timerTotal; Paint0();
      }
    }

    int hwheelAcc; DateTime hwheelCool;
    void OnHWheel(int delta) {
      if (expanded || DateTime.Now < hwheelCool) return;
      hwheelAcc += delta;
      if (Math.Abs(hwheelAcc) >= 240) {
        MediaAction(hwheelAcc > 0 ? "next" : "prev");
        Nudge(hwheelAcc > 0 ? -1 : 1, false);
        hwheelAcc = 0; hwheelCool = DateTime.Now.AddMilliseconds(700);
      }
    }

    void Nudge(int dir, bool squeeze) {
      swipe = dir * 8; swipeV = 0; swipeTarget = 0;
      if (squeeze) { cw -= 10; vw = 0; }
      Kick();
    }

    void SliderFromMouse(Point p) {
      Hit h = hits.FirstOrDefault(x => x.Id == dragSlider);
      if (h == null) return;
      float v = (L(p).X - h.R.X) / h.R.Width * 100f;
      v = Math.Max(0, Math.Min(100, v));
      if (dragSlider == "vol") SetVolume((int)Math.Round(v)); else SetBrightness((int)Math.Round(v));
    }

    DateTime lastVolSend, lastBriSend;
    void SetVolume(int v) {
      v = Math.Max(0, Math.Min(100, v));
      volume = v; if (v > 0) muted = false;
      lastLocalVol = DateTime.Now;
      if ((DateTime.Now - lastVolSend).TotalMilliseconds > 50 || dragSlider == null) { lastVolSend = DateTime.Now; engine.Do(() => { Audio.SetVolume(0, v / 100f); if (v > 0) Audio.SetMute(0, false); }); }
      Retarget(); Paint0();
    }
    void SetBrightness(int v) {
      v = Math.Max(0, Math.Min(100, v));
      slow.Bri = v; lastLocalBri = DateTime.Now;
      if ((DateTime.Now - lastBriSend).TotalMilliseconds > 140 || dragSlider == null) { lastBriSend = DateTime.Now; engine.Do(() => Sys.SetBrightness(v)); }
      Paint0();
    }

    void MediaAction(string a) {
      if (a == "toggle" && media.MediaActive) media.Playing = !media.Playing;
      engine.Do(() => Media.Action(a));
      engine.PollSoon();
      Retarget(); Paint0();
    }

    void Open(string uri) {
      if (!Regex.IsMatch(uri, "^ms-settings:[a-z0-9-]{0,64}$")) return;
      engine.Do(() => { using (Process p = Process.Start(uri)) { } });
    }

    void Click(string id) {
      lastActivity = DateTime.Now;
      switch (id) {
        case "hud": Expand(); break;
        case "alarm": DismissAlarm(); break;
        case "notif": peekUntil = DateTime.MinValue; NextPeek(); break;
        case "notif-act":
          if (peek != null && peek.Url != null) OpenMeeting(peek.Url);
          peekUntil = DateTime.MinValue; NextPeek(); break;
        case "m-prev": MediaAction("prev"); break;
        case "m-next": MediaAction("next"); break;
        case "m-toggle": MediaAction("toggle"); break;
        case "wifi": ToggleRadio("WiFi", slow.Wifi, "ms-settings:network-wifi"); break;
        case "bt": ToggleRadio("Bluetooth", slow.Bluetooth, "ms-settings:bluetooth"); break;
        case "mute": {
          muted = !muted; lastLocalVol = DateTime.Now; bool m = muted;
          engine.Do(() => Audio.SetMute(0, m)); Paint0(); break;
        }
        case "mic": {
          if (micMuted == null) break;
          micMuted = !micMuted.Value; bool m = micMuted.Value;
          engine.Do(() => Audio.SetMute(1, m)); Paint0(); break;
        }
        case "dark": {
          slow.Dark = !slow.Dark; bool d = slow.Dark;
          engine.Do(() => Sys.SetDark(d)); Paint0(); break;
        }
        case "snip": Collapse(); engine.Do(() => { System.Threading.Thread.Sleep(350); using (Process p = Process.Start("ms-screenclip:")) { } }); break;
        case "lock": Collapse(); engine.Do(() => { using (Process.Start(new ProcessStartInfo(System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "rundll32.exe"), "user32.dll,LockWorkStation") { UseShellExecute = false })) { } }); break;
        case "t-1": case "t-5": case "t-10": case "t-25": {
          timerTotal = int.Parse(id.Substring(2)) * 60; timerRemaining = timerTotal;
          if (timerRunning) timerEnd = DateTime.Now.AddSeconds(timerTotal);
          Retarget(); Paint0(); break;
        }
        case "t-go":
          if (timerRunning) { timerRemaining = Math.Max(0, (timerEnd - DateTime.Now).TotalSeconds); timerRunning = false; }
          else { if (timerRemaining <= 0) timerRemaining = timerTotal; timerEnd = DateTime.Now.AddSeconds(timerRemaining); timerRunning = true; }
          Retarget(); Paint0(); break;
        case "t-reset": timerRunning = false; timerRemaining = timerTotal; Retarget(); Paint0(); break;
        case "style": Prefs.Notch = !Prefs.Notch; Prefs.Save(); Retarget(); Paint0(); break;
        case "gear": case "cal-add": LiteApp.ShowSettings(); break;
        default:
          if (id.StartsWith("join-")) {
            int i = int.Parse(id.Substring(5));
            DateTime now = DateTime.UtcNow;
            List<CalEvent> items = Calendar.Events.Where(ev => ev.End > now).Take(3).ToList();
            if (i < items.Count && items[i].Url != null) OpenMeeting(items[i].Url);
          }
          break;
      }
    }

    void ToggleRadio(string kind, string state, string settingsUri) {
      if (state == null) { Open(settingsUri); return; }
      string next = state == "On" ? "Off" : "On";
      if (kind == "WiFi") slow.Wifi = next; else slow.Bluetooth = next;
      Paint0();
      engine.Do(() => {
        try { Radios.Set(kind, next); } catch { }
        engine.SlowSoon();
      });
    }

    // only links from your own calendar events, and only to known meeting services
    static readonly Regex MeetHost = new Regex(@"^https://([a-z0-9-]+\.)*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)(/|$)", RegexOptions.IgnoreCase);
    void OpenMeeting(string url) {
      if (url == null || !MeetHost.IsMatch(url)) return;
      if (!Calendar.Events.Any(ev => ev.Url == url)) return;
      engine.Do(() => { using (Process p = Process.Start(url)) { } });
    }
  }
}

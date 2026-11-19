// Nothing Island Lite — rendering into a premultiplied DIB and pushing it with UpdateLayeredWindow.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;

namespace NI {

  partial class Island {

    // ---------------------------------------------------------------- buffer
    void EnsureBuffer(int w, int h) {
      if (canvas != null && w <= bufW && h <= bufH) return;
      FreeBuffer();
      bufW = Math.Max(w, (int)(500 * S)); bufH = Math.Max(h, (int)(540 * S));
      var bmi = new BITMAPINFOHEADER { biSize = 40, biWidth = bufW, biHeight = -bufH, biPlanes = 1, biBitCount = 32, biCompression = 0 };
      memDC = CreateCompatibleDC(IntPtr.Zero);
      dib = CreateDIBSection(memDC, ref bmi, 0, out bits, IntPtr.Zero, 0);
      oldBmp = SelectObject(memDC, dib);
      canvas = new Bitmap(bufW, bufH, bufW * 4, PixelFormat.Format32bppPArgb, bits);
    }
    void FreeBuffer() {
      if (canvas != null) { canvas.Dispose(); canvas = null; }
      if (memDC != IntPtr.Zero) { SelectObject(memDC, oldBmp); DeleteObject(dib); DeleteDC(memDC); memDC = IntPtr.Zero; dib = IntPtr.Zero; }
      bufW = bufH = 0;
    }

    float Ear { get { return Prefs.Notch ? 12f : 0f; } }

    // ---------------------------------------------------------------- paint
    void Paint0() {
      if (!IsHandleCreated || autoHidden) return;
      float ear = Ear;
      int W = (int)Math.Ceiling((cw + ear * 2) * S) + 2, H = (int)Math.Ceiling(ch * S) + 2;
      EnsureBuffer(W, H);
      using (Graphics g = Graphics.FromImage(canvas)) {
        g.CompositingMode = CompositingMode.SourceCopy;
        using (var clear = new SolidBrush(Color.Transparent)) g.FillRectangle(clear, 0, 0, W, H);
        g.CompositingMode = CompositingMode.SourceOver;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAlias;
        g.ScaleTransform(S, S);
        g.TranslateTransform(ear + 1 / S, 0);
        hits.Clear();
        Color fill = alarm ? Pal.Red : Pal.Black;
        using (GraphicsPath shape = Shape(cw, ch, cr, ear)) {
          using (var b = new SolidBrush(fill)) g.FillPath(b, shape);
          if (!Prefs.Notch) using (var outline = new Pen(Color.FromArgb(22, 255, 255, 255), 1f / S)) g.DrawPath(outline, shape);
          g.SetClip(shape);
        }
        DrawContent(g);
      }
      Push(W, H);
    }

    void Push(int W, int H) {
      Rectangle scr = Screen.PrimaryScreen.Bounds;
      var dst = new POINT(scr.X + (scr.Width - W) / 2, scr.Y + (Prefs.Notch ? 0 : (int)Math.Round(8 * S)));
      var size = new SIZE(W, H);
      var src = new POINT(0, 0);
      var blend = new BLENDFUNCTION { Op = 0, Flags = 0, Alpha = 255, Format = 1 };
      UpdateLayeredWindow(Handle, IntPtr.Zero, ref dst, ref size, memDC, ref src, 0, ref blend, 2);
    }

    GraphicsPath Shape(float w, float h, float r, float ear) {
      r = Math.Max(1, Math.Min(r, Math.Min(w, h) / 2));
      if (!Prefs.Notch) return Icons.RoundRect(0, 0, w, h, r);
      var p = new GraphicsPath();
      // flat top, curved "ears" flowing into the screen edge, rounded bottom
      p.StartFigure();
      p.AddLine(-ear, 0, w + ear, 0);
      p.AddArc(w, 0, ear * 2, ear * 2, 270, -90);          // right ear (concave)
      p.AddLine(w, ear, w, h - r);
      p.AddArc(w - r * 2, h - r * 2, r * 2, r * 2, 0, 90);
      p.AddLine(w - r, h, r, h);
      p.AddArc(0, h - r * 2, r * 2, r * 2, 90, 90);
      p.AddLine(0, h - r, 0, ear);
      p.AddArc(-ear * 2, 0, ear * 2, ear * 2, 0, -90);     // left ear (concave)
      p.CloseFigure();
      return p;
    }

    // ---------------------------------------------------------------- helpers
    Color A(Color c) { return Color.FromArgb((int)(c.A * Math.Max(0, Math.Min(1, ca))), c); }
    Color A(Color c, float extra) { return Color.FromArgb((int)(c.A * Math.Max(0, Math.Min(1, ca * extra))), c); }
    void AddHit(string id, float x, float y, float w, float h) { hits.Add(new Hit { Id = id, R = new RectangleF(x, y, w, h) }); }
    void FillRound(Graphics g, Color c, float x, float y, float w, float h, float r) {
      using (var p = Icons.RoundRect(x, y, w, h, r)) using (var b = new SolidBrush(A(c))) g.FillPath(b, p);
    }
    void Circle(Graphics g, Color c, float x, float y, float d) { using (var b = new SolidBrush(A(c))) g.FillEllipse(b, x, y, d, d); }
    void Txt(Graphics g, string s, Font f, Color c, float x, float y) { using (var b = new SolidBrush(A(c))) g.DrawString(s, f, b, x, y, sfTypo); }
    void TextFit(Graphics g, string s, Font f, Color c, float x, float y, float w) {
      using (var b = new SolidBrush(A(c))) g.DrawString(s ?? "", f, b, new RectangleF(x, y, Math.Max(1, w), f.Size * 1.5f), sfEllipsis);
    }
    float Tracked(Graphics g, string s, Font f, Color c, float x, float y, float track) {
      float x0 = x;
      using (var b = new SolidBrush(A(c))) {
        foreach (char ch in s) {
          string one = ch.ToString();
          if (ch != ' ') g.DrawString(one, f, b, x, y, sfTypo);
          x += (ch == ' ' ? f.Size * 0.6f : g.MeasureString(one, f, PointF.Empty, sfTypo).Width) + track;
        }
      }
      return x - x0 - track;
    }
    float TrackedWidth(Graphics g, string s, Font f, float track) {
      float w = 0;
      foreach (char ch in s) w += (ch == ' ' ? f.Size * 0.6f : g.MeasureString(ch.ToString(), f, PointF.Empty, sfTypo).Width) + track;
      return Math.Max(0, w - track);
    }
    float DotsA(Graphics g, string s, float x, float y, float dot, float gap, Color c, float ghost) { return Dots.Draw(g, s, x, y, dot, gap, A(c), ghost); }
    void Ico(Graphics g, string name, float x, float y, float size, Color c) { Icons.Draw(g, name, new RectangleF(x, y, size, size), A(c)); }

    // ---------------------------------------------------------------- pill content sizes
    const float PD = 1.9f, PG = 0.55f, SD = 1.25f, SG = 0.45f;   // pill dots: time / small date
    string DayLabel() { return DateTime.Now.ToString("ddd", CultureInfo.InvariantCulture).ToUpperInvariant() + " " + DateTime.Now.Day; }
    float PillContentWidth() {
      if (mode == "timer") return 6 + 9 + Dots.Width(TimerText(), PD, PG);
      if (mode == "meet") {
        MeetInfo mi = Meet();
        if (mi == null) return 120;
        using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) {
          float tw2 = Math.Min(104, TrackedWidth(g, mi.Ev.Title.ToUpperInvariant(), fMonoS, 1.1f));
          return 6 + 9 + tw2 + 9 + Dots.Width(Mins(mi.Mins), PD, PG);
        }
      }
      return Dots.Width(Clock(DateTime.Now), PD, PG) + 9 + 4 + 9 + Dots.Width(DayLabel(), SD, SG);
    }
    string TimerText() {
      int sec = (int)Math.Ceiling(timerRemaining);
      int h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60;
      return h > 0 ? h + ":" + m.ToString("00") + ":" + s.ToString("00") : m.ToString("00") + ":" + s.ToString("00");
    }

    // ---------------------------------------------------------------- content per mode
    void DrawContent(Graphics g) {
      float w = cw, h = ch;
      float top = Prefs.Notch ? 4 : 0;           // notch is a bit taller; keep content optically centred lower
      float cy = top + (h - top) / 2;
      bool blinkOn = (DateTime.Now.Millisecond < 500);
      switch (mode) {
        case "idle": {
          AddHit("pill", 0, 0, w, h);
          float total = PillContentWidth();
          float x = (w - total) / 2 + swipe;
          x += DotsA(g, Clock(DateTime.Now), x, cy - Dots.Height(PD, PG) / 2, PD, PG, Pal.White, 0) + 9;
          Circle(g, Pal.Red, x, cy - 2, 4); x += 4 + 9;
          DotsA(g, DayLabel(), x, cy - Dots.Height(SD, SG) / 2, SD, SG, Pal.Grey, 0);
          break;
        }
        case "timer": {
          AddHit("pill", 0, 0, w, h);
          float total = PillContentWidth(), x = (w - total) / 2 + swipe;
          if (blinkOn) Circle(g, Pal.Red, x, cy - 3, 6);
          x += 6 + 9;
          DotsA(g, TimerText(), x, cy - Dots.Height(PD, PG) / 2, PD, PG, Pal.White, 0);
          break;
        }
        case "meet": {
          AddHit("pill", 0, 0, w, h);
          MeetInfo mi = Meet();
          if (mi == null) break;
          float total = PillContentWidth(), x = (w - total) / 2 + swipe;
          if (!mi.Live || blinkOn) Circle(g, mi.Live ? Pal.Red : Pal.White, x, cy - 3, 6);
          x += 6 + 9;
          string title = mi.Ev.Title.ToUpperInvariant();
          float tw2 = Math.Min(104, TrackedWidth(g, title, fMonoS, 1.1f));
          GraphicsState st = g.Save();
          g.IntersectClip(new RectangleF(x, 0, tw2, h));
          Tracked(g, title, fMonoS, mi.Live ? Pal.Grey : Pal.White, x, cy - 6, 1.1f);
          g.Restore(st);
          x += tw2 + 9;
          DotsA(g, Mins(mi.Mins), x, cy - Dots.Height(PD, PG) / 2, PD, PG, mi.Live ? Pal.Grey : Pal.White, 0);
          break;
        }
        case "media": {
          AddHit("pill", 0, 0, w, h);
          var r = new RectangleF(14 + swipe, cy - 10, 20, 20);
          DrawArt(g, r, 9);
          // dot equaliser
          float ex = w - 16 - (camApps.Count + micApps.Count > 0 ? 10 : 0) - (5 * 3 + 4 * 2) + swipe;
          var rnd = new Random(DateTime.Now.Millisecond / 150 + DateTime.Now.Second * 7);
          for (int c = 0; c < 5; c++) {
            int lvl = media.Playing ? 1 + rnd.Next(4) : 1;
            for (int i = 0; i < 4; i++) {
              Color col = i < lvl ? (i == 3 ? Pal.Red : Pal.White) : Color.FromArgb(255, 51, 51, 51);
              Circle(g, col, ex + c * 5, cy + 5 - i * 5, 3);
            }
          }
          break;
        }
        case "hud": {
          AddHit("hud", 0, 0, w, h);
          bool vol = hudKind == "volume";
          int v = vol ? (muted ? 0 : Math.Max(0, volume)) : slow.Bri;
          Ico(g, vol ? (muted || v == 0 ? "volmute" : "vol") : "sun", 16, cy - 9, 18, Pal.White);
          DotBar(g, 46, w - 46 - 50, cy, v, 18, Pal.White);
          string vs = v.ToString();
          DotsA(g, vs, w - 16 - Dots.Width(vs, 2.2f, 1f), cy - Dots.Height(2.2f, 1f) / 2, 2.2f, 1f, Pal.White, 0);
          break;
        }
        case "charge": {
          PowerStatus ps = SystemInformation.PowerStatus;
          int lvl = (int)Math.Round(ps.BatteryLifePercent * 100);
          bool low = lvl <= 20 && !chargePlugged;
          Ico(g, chargePlugged ? "bolt" : "plug", 16, cy - 9, 18, chargePlugged ? Pal.Green : Pal.White);
          float fillTo = Math.Min(1f, (float)(DateTime.Now - chargeUntil.AddMilliseconds(-2800)).TotalMilliseconds / 900f);
          DotBar(g, 46, w - 46 - 56, cy, (int)(lvl * (chargePlugged ? fillTo : 1)), 18, low ? Pal.Red : Pal.White);
          string vs = lvl + "%";
          DotsA(g, vs, w - 16 - Dots.Width(vs, 2.2f, 1f), cy - Dots.Height(2.2f, 1f) / 2, 2.2f, 1f, low ? Pal.Red : Pal.White, 0);
          break;
        }
        case "notif": DrawPeek(g, w, h, cy); break;
        case "alarm": {
          AddHit("alarm", 0, 0, w, h);
          string t = "TIME'S UP";
          DotsA(g, t, (w - Dots.Width(t, 3, 1.35f)) / 2, cy - 16, 3, 1.35f, Color.White, 0);
          string sub = "TAP TO DISMISS";
          Tracked(g, sub, fMonoXS, Color.FromArgb(200, 255, 255, 255), (w - TrackedWidth(g, sub, fMonoXS, 1.6f)) / 2, cy + 10, 1.6f);
          break;
        }
        case "expanded": DrawPanel(g, top); break;
      }
      // privacy dot (green camera / orange mic) on collapsed states
      if (mode != "expanded" && mode != "notif" && mode != "alarm" && (camApps.Count > 0 || micApps.Count > 0))
        Circle(g, camApps.Count > 0 ? Pal.Green : Pal.Orange, w - 9 - 6, cy - 3, 6);
    }

    void DotBar(Graphics g, float x, float width, float cy, int value, int n, Color on) {
      int lit = (int)Math.Round(Math.Max(0, Math.Min(100, value)) / 100.0 * n);
      float step = (width - 5) / (n - 1);
      for (int i = 0; i < n; i++) Circle(g, i < lit ? on : Pal.DimDot, x + i * step, cy - 2.5f, 5);
    }

    void DrawArt(Graphics g, RectangleF r, int cols) {
      using (var p = Icons.RoundRect(r.X, r.Y, r.Width, r.Height, r.Width * 0.28f)) {
        using (var b = new SolidBrush(A(Pal.Black))) g.FillPath(b, p);
        GraphicsState st = g.Save();
        using (var reg = new Region(p)) g.IntersectClip(reg);
        if (art != null) art.Draw(g, r, cols, ca); else Art.Placeholder(g, r, ca);
        g.Restore(st);
      }
    }

    void DrawPeek(Graphics g, float w, float h, float cy) {
      Peek p = peek;
      if (p == null) return;
      AddHit("notif", 0, 0, w, h);
      float ix = 12, iy = cy - 20;
      Color icoBg = p.Icon == "cam" ? Pal.Green : p.Icon == "mic" ? Pal.Orange : p.Icon == "cal" ? Pal.Red : p.Icon == "art" ? Pal.Black : Pal.White;
      Circle(g, icoBg, ix, iy, 40);
      if (p.Icon == "art") {
        GraphicsState st = g.Save();
        using (var clip = new GraphicsPath()) { clip.AddEllipse(ix, iy, 40, 40); using (var reg = new Region(clip)) g.IntersectClip(reg); }
        if (art != null) art.Draw(g, new RectangleF(ix, iy, 40, 40), 12, ca); else Art.Placeholder(g, new RectangleF(ix, iy, 40, 40), ca);
        g.Restore(st);
      } else if (p.Icon != null) {
        Color fg = p.Icon == "cal" ? Color.White : p.Icon == "cam" ? Color.FromArgb(255, 0, 43, 14) : Color.FromArgb(255, 58, 35, 0);
        Ico(g, p.Icon, ix + 10, iy + 10, 20, fg);
      } else {
        string letter = new string((p.App ?? "").Where(ch => char.IsLetterOrDigit(ch)).Take(1).ToArray());
        if (letter.Length == 0) letter = new string((p.Title ?? "?").Where(ch => char.IsLetterOrDigit(ch)).Take(1).ToArray());
        if (letter.Length == 0) letter = "?";
        letter = letter.ToUpperInvariant();
        float lw = Dots.Width(letter, 2.6f, 1f);
        DotsA(g, letter, ix + 20 - lw / 2, iy + 20 - Dots.Height(2.6f, 1f) / 2, 2.6f, 1f, Pal.Ink, 0);
      }
      float tx = ix + 40 + 12;
      float right = w - 18;
      if (p.Action != null && p.Url != null) {
        float bw = 62;
        FillRound(g, Pal.White, right - bw, cy - 15, bw, 30, 15);
        float aw = TrackedWidth(g, p.Action, fMono, 1.4f);
        Tracked(g, p.Action, fMono, Pal.Ink, right - bw + (bw - aw) / 2, cy - 6, 1.4f);
        AddHit("notif-act", right - bw, cy - 15, bw, 30);
        right -= bw + 10;
      } else {
        Circle(g, Pal.Red, right - 7, cy - 3.5f, 7);
        right -= 16;
      }
      float tw2 = right - tx;
      Tracked(g, string.IsNullOrEmpty(p.App) ? "NOTIFICATION" : p.App.ToUpperInvariant(), fMonoS, Pal.Grey, tx, cy - 22, 1.4f);
      TextFit(g, string.IsNullOrEmpty(p.Title) ? p.App : p.Title, fTitle, Pal.White, tx - 1, cy - 9, tw2);
      TextFit(g, p.Body ?? "", fSmall, Pal.Grey, tx - 1, cy + 8, tw2);
    }
  }
}

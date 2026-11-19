// Nothing Island Lite — drawing helpers: palette, dot-matrix type, icons, halftone album art.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace NI {

  static class Pal {
    public static readonly Color Black = Color.FromArgb(255, 0, 0, 0);
    public static readonly Color Red = Color.FromArgb(255, 215, 25, 33);
    public static readonly Color White = Color.FromArgb(255, 240, 240, 240);
    public static readonly Color Tile = Color.FromArgb(255, 28, 28, 30);
    public static readonly Color Tile2 = Color.FromArgb(255, 42, 42, 44);
    public static readonly Color Grey = Color.FromArgb(255, 142, 142, 147);
    public static readonly Color Ink = Color.FromArgb(255, 17, 17, 17);
    public static readonly Color DimDot = Color.FromArgb(255, 44, 44, 46);
    public static readonly Color Green = Color.FromArgb(255, 48, 209, 88);
    public static readonly Color Orange = Color.FromArgb(255, 255, 159, 10);
  }

  // ------------------------------------------------------------------ dot-matrix type (5x7, NDot style)
  static class Dots {
    static readonly Dictionary<char, string[]> G = new Dictionary<char, string[]> {
      { '0', new[] { "01110", "10001", "10001", "10001", "10001", "10001", "01110" } },
      { '1', new[] { "010", "110", "010", "010", "010", "010", "111" } },
      { '2', new[] { "01110", "10001", "00001", "00010", "00100", "01000", "11111" } },
      { '3', new[] { "11111", "00010", "00100", "00010", "00001", "10001", "01110" } },
      { '4', new[] { "00010", "00110", "01010", "10010", "11111", "00010", "00010" } },
      { '5', new[] { "11111", "10000", "11110", "00001", "00001", "10001", "01110" } },
      { '6', new[] { "00110", "01000", "10000", "11110", "10001", "10001", "01110" } },
      { '7', new[] { "11111", "00001", "00010", "00100", "01000", "01000", "01000" } },
      { '8', new[] { "01110", "10001", "10001", "01110", "10001", "10001", "01110" } },
      { '9', new[] { "01110", "10001", "10001", "01111", "00001", "00010", "01100" } },
      { 'A', new[] { "01110", "10001", "10001", "11111", "10001", "10001", "10001" } },
      { 'B', new[] { "11110", "10001", "10001", "11110", "10001", "10001", "11110" } },
      { 'C', new[] { "01110", "10001", "10000", "10000", "10000", "10001", "01110" } },
      { 'D', new[] { "11100", "10010", "10001", "10001", "10001", "10010", "11100" } },
      { 'E', new[] { "11111", "10000", "10000", "11110", "10000", "10000", "11111" } },
      { 'F', new[] { "11111", "10000", "10000", "11110", "10000", "10000", "10000" } },
      { 'G', new[] { "01110", "10001", "10000", "10111", "10001", "10001", "01111" } },
      { 'H', new[] { "10001", "10001", "10001", "11111", "10001", "10001", "10001" } },
      { 'I', new[] { "111", "010", "010", "010", "010", "010", "111" } },
      { 'J', new[] { "00111", "00010", "00010", "00010", "00010", "10010", "01100" } },
      { 'K', new[] { "10001", "10010", "10100", "11000", "10100", "10010", "10001" } },
      { 'L', new[] { "10000", "10000", "10000", "10000", "10000", "10000", "11111" } },
      { 'M', new[] { "10001", "11011", "10101", "10101", "10001", "10001", "10001" } },
      { 'N', new[] { "10001", "10001", "11001", "10101", "10011", "10001", "10001" } },
      { 'O', new[] { "01110", "10001", "10001", "10001", "10001", "10001", "01110" } },
      { 'P', new[] { "11110", "10001", "10001", "11110", "10000", "10000", "10000" } },
      { 'Q', new[] { "01110", "10001", "10001", "10001", "10101", "10010", "01101" } },
      { 'R', new[] { "11110", "10001", "10001", "11110", "10100", "10010", "10001" } },
      { 'S', new[] { "01111", "10000", "10000", "01110", "00001", "00001", "11110" } },
      { 'T', new[] { "11111", "00100", "00100", "00100", "00100", "00100", "00100" } },
      { 'U', new[] { "10001", "10001", "10001", "10001", "10001", "10001", "01110" } },
      { 'V', new[] { "10001", "10001", "10001", "10001", "10001", "01010", "00100" } },
      { 'W', new[] { "10001", "10001", "10001", "10101", "10101", "10101", "01010" } },
      { 'X', new[] { "10001", "10001", "01010", "00100", "01010", "10001", "10001" } },
      { 'Y', new[] { "10001", "10001", "10001", "01010", "00100", "00100", "00100" } },
      { 'Z', new[] { "11111", "00001", "00010", "00100", "01000", "10000", "11111" } },
      { ' ', new[] { "000", "000", "000", "000", "000", "000", "000" } },
      { ':', new[] { "0", "0", "1", "0", "1", "0", "0" } },
      { '.', new[] { "0", "0", "0", "0", "0", "0", "1" } },
      { '-', new[] { "000", "000", "000", "111", "000", "000", "000" } },
      { '%', new[] { "11000", "11001", "00010", "00100", "01000", "10011", "00011" } },
      { '\'', new[] { "1", "1", "0", "0", "0", "0", "0" } },
      { '/', new[] { "00001", "00010", "00010", "00100", "01000", "01000", "10000" } },
    };

    static string[] Glyph(char c) {
      string[] g;
      return G.TryGetValue(char.ToUpperInvariant(c), out g) ? g : G[' '];
    }

    public static float Width(string text, float dot, float gap) {
      if (string.IsNullOrEmpty(text)) return 0;
      int cols = 0;
      for (int i = 0; i < text.Length; i++) cols += Glyph(text[i])[0].Length + (i < text.Length - 1 ? 1 : 0);
      return cols * (dot + gap) - gap;
    }
    public static float Height(float dot, float gap) { return 7 * (dot + gap) - gap; }

    public static float Draw(Graphics g, string text, float x, float y, float dot, float gap, Color c, float ghost) {
      if (string.IsNullOrEmpty(text)) return 0;
      float step = dot + gap;
      int col = 0;
      using (var on = new SolidBrush(c))
      using (var off = new SolidBrush(Color.FromArgb((int)(c.A * ghost), c))) {
        for (int i = 0; i < text.Length; i++) {
          string[] gl = Glyph(text[i]);
          int w = gl[0].Length;
          for (int row = 0; row < 7; row++)
            for (int k = 0; k < w; k++) {
              bool lit = gl[row][k] == '1';
              if (!lit && ghost <= 0) continue;
              g.FillEllipse(lit ? on : off, x + (col + k) * step, y + row * step, dot, dot);
            }
          col += w + 1;
        }
      }
      return Width(text, dot, gap);
    }
  }

  // ------------------------------------------------------------------ halftone album art
  class Art {
    const int N = 24;
    readonly float[] lum = new float[N * N];
    readonly bool[] red = new bool[N * N];

    public static Art From(Bitmap src) {
      var a = new Art();
      using (var small = new Bitmap(N, N, PixelFormat.Format32bppArgb)) {
        using (Graphics g = Graphics.FromImage(small)) {
          g.InterpolationMode = InterpolationMode.HighQualityBilinear;
          int s = Math.Min(src.Width, src.Height);
          g.DrawImage(src, new Rectangle(0, 0, N, N), new Rectangle((src.Width - s) / 2, (src.Height - s) / 2, s, s), GraphicsUnit.Pixel);
        }
        for (int y = 0; y < N; y++)
          for (int x = 0; x < N; x++) {
            Color p = small.GetPixel(x, y);
            a.lum[y * N + x] = (float)Math.Pow((0.299 * p.R + 0.587 * p.G + 0.114 * p.B) / 255.0, 0.85);
            a.red[y * N + x] = p.R > 150 && p.R > p.G * 1.8 && p.R > p.B * 1.8;
          }
      }
      return a;
    }

    public void Draw(Graphics g, RectangleF r, int cols, float alpha) {
      float cell = r.Width / cols;
      using (var white = new SolidBrush(Color.FromArgb((int)(255 * alpha), Pal.White)))
      using (var redB = new SolidBrush(Color.FromArgb((int)(255 * alpha), Pal.Red))) {
        for (int y = 0; y < cols; y++)
          for (int x = 0; x < cols; x++) {
            int sx = Math.Min(N - 1, (int)((x + 0.5f) * N / cols)), sy = Math.Min(N - 1, (int)((y + 0.5f) * N / cols));
            int i = sy * N + sx;
            float rad = cell / 2 * 0.92f * lum[i];
            if (rad < 0.35f) continue;
            g.FillEllipse(red[i] ? redB : white, r.X + x * cell + cell / 2 - rad, r.Y + y * cell + cell / 2 - rad, rad * 2, rad * 2);
          }
      }
    }

    static readonly string[] Note = {
      "0000011110", "0000111110", "0000110010", "0000100010", "0000100010",
      "0000100010", "0011100110", "0111101110", "0111001100", "0000000000" };
    public static void Placeholder(Graphics g, RectangleF r, float alpha) {
      float pad = r.Width * 0.16f, cell = (r.Width - pad * 2) / 10;
      using (var on = new SolidBrush(Color.FromArgb((int)(255 * alpha), Pal.White)))
      using (var off = new SolidBrush(Color.FromArgb((int)(18 * alpha), 255, 255, 255))) {
        for (int y = 0; y < 10; y++)
          for (int x = 0; x < 10; x++) {
            float d = cell * 0.72f;
            g.FillEllipse(Note[y][x] == '1' ? on : off, r.X + pad + x * cell + (cell - d) / 2, r.Y + pad + y * cell + (cell - d) / 2, d, d);
          }
      }
    }
  }

  // ------------------------------------------------------------------ icons (drawn on a 24x24 grid)
  static class Icons {
    public static void Draw(Graphics g, string name, RectangleF r, Color c) {
      GraphicsState saved = g.Save();
      g.TranslateTransform(r.X, r.Y);
      g.ScaleTransform(r.Width / 24f, r.Height / 24f);
      using (var pen = new Pen(c, 1.8f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
      using (var fill = new SolidBrush(c)) {
        switch (name) {
          case "play": g.FillPolygon(fill, new[] { new PointF(8, 5.5f), new PointF(18.5f, 12), new PointF(8, 18.5f) }); break;
          case "pause": g.FillRectangle(fill, 6.5f, 5.5f, 3.6f, 13); g.FillRectangle(fill, 13.9f, 5.5f, 3.6f, 13); break;
          case "next": g.FillPolygon(fill, new[] { new PointF(6, 6.5f), new PointF(14, 12), new PointF(6, 17.5f) }); g.FillRectangle(fill, 15.5f, 6.5f, 2.4f, 11); break;
          case "prev": g.FillPolygon(fill, new[] { new PointF(18, 6.5f), new PointF(10, 12), new PointF(18, 17.5f) }); g.FillRectangle(fill, 6.1f, 6.5f, 2.4f, 11); break;
          case "wifi":
            g.DrawArc(pen, 12 - 12, 20 - 12, 24, 24, 225, 90);
            g.DrawArc(pen, 12 - 8, 20 - 8, 16, 16, 225, 90);
            g.DrawArc(pen, 12 - 4, 20 - 4, 8, 8, 225, 90);
            g.FillEllipse(fill, 10.9f, 17.9f, 2.2f, 2.2f);
            break;
          case "bt":
            g.DrawLines(pen, new[] { new PointF(7, 7.5f), new PointF(17, 16.5f), new PointF(12, 21), new PointF(12, 3), new PointF(17, 7.5f), new PointF(7, 16.5f) });
            break;
          case "mic":
          case "micoff":
            using (var p = RoundRect(9, 3.5f, 6, 11, 3)) g.DrawPath(pen, p);
            g.DrawArc(pen, 5.5f, 5, 13, 13, 0, 180);
            g.DrawLine(pen, 12, 18, 12, 20.5f);
            if (name == "micoff") g.DrawLine(pen, 4, 4, 20, 20);
            break;
          case "moon":
            using (var a = new GraphicsPath()) {
              a.AddEllipse(4, 4, 16, 16);
              using (var reg = new Region(a))
              using (var b = new GraphicsPath()) {
                b.AddEllipse(9.5f, 1, 15, 15);
                reg.Exclude(b);
                g.FillRegion(fill, reg);
              }
            }
            break;
          case "lock":
            using (var p = RoundRect(5.5f, 10.5f, 13, 10, 2.5f)) g.DrawPath(pen, p);
            g.DrawArc(pen, 8.5f, 4.5f, 7, 7, 180, 180);
            g.DrawLine(pen, 8.5f, 8, 8.5f, 10.5f); g.DrawLine(pen, 15.5f, 8, 15.5f, 10.5f);
            break;
          case "snip":
            g.DrawLines(pen, new[] { new PointF(4, 8), new PointF(4, 4), new PointF(8, 4) });
            g.DrawLines(pen, new[] { new PointF(16, 4), new PointF(20, 4), new PointF(20, 8) });
            g.DrawLines(pen, new[] { new PointF(20, 16), new PointF(20, 20), new PointF(16, 20) });
            g.DrawLines(pen, new[] { new PointF(8, 20), new PointF(4, 20), new PointF(4, 16) });
            g.FillEllipse(fill, 9.8f, 9.8f, 4.4f, 4.4f);
            break;
          case "vol":
          case "volmute":
            g.FillPolygon(fill, new[] { new PointF(4, 9.5f), new PointF(7.5f, 9.5f), new PointF(12, 5.5f), new PointF(12, 18.5f), new PointF(7.5f, 14.5f), new PointF(4, 14.5f) });
            if (name == "vol") { g.DrawArc(pen, 11, 8.5f, 7, 7, -55, 110); g.DrawArc(pen, 10, 4.5f, 14, 15, -55, 110); }
            else { g.DrawLine(pen, 16, 9.5f, 21, 14.5f); g.DrawLine(pen, 21, 9.5f, 16, 14.5f); }
            break;
          case "sun":
            g.FillEllipse(fill, 8.4f, 8.4f, 7.2f, 7.2f);
            for (int i = 0; i < 8; i++) {
              double a = i * Math.PI / 4;
              g.DrawLine(pen, (float)(12 + Math.Cos(a) * 7.5), (float)(12 + Math.Sin(a) * 7.5), (float)(12 + Math.Cos(a) * 9.5), (float)(12 + Math.Sin(a) * 9.5));
            }
            break;
          case "gear":
            g.DrawEllipse(pen, 9, 9, 6, 6);
            for (int i = 0; i < 8; i++) {
              double a = i * Math.PI / 4;
              g.DrawLine(pen, (float)(12 + Math.Cos(a) * 6.3), (float)(12 + Math.Sin(a) * 6.3), (float)(12 + Math.Cos(a) * 9.2), (float)(12 + Math.Sin(a) * 9.2));
            }
            break;
          case "bolt": g.FillPolygon(fill, new[] { new PointF(13.5f, 2.5f), new PointF(5, 13.5f), new PointF(11, 13.5f), new PointF(10, 21.5f), new PointF(18.5f, 10.5f), new PointF(12.5f, 10.5f) }); break;
          case "plug":
            g.DrawLine(pen, 9, 3, 9, 7); g.DrawLine(pen, 15, 3, 15, 7);
            using (var p = new GraphicsPath()) { p.AddLine(6.5f, 7, 17.5f, 7); p.AddArc(6.5f, 5, 11, 11, 0, 180); p.CloseFigure(); g.DrawPath(pen, p); }
            g.DrawLine(pen, 12, 16, 12, 21);
            break;
          case "cal":
            using (var p = RoundRect(4, 5.5f, 16, 14.5f, 3)) g.DrawPath(pen, p);
            g.DrawLine(pen, 4, 10, 20, 10); g.DrawLine(pen, 8.5f, 3.5f, 8.5f, 7.5f); g.DrawLine(pen, 15.5f, 3.5f, 15.5f, 7.5f);
            break;
          case "cam":
            using (var p = RoundRect(3, 6.5f, 12.5f, 11, 2.5f)) g.DrawPath(pen, p);
            g.DrawPolygon(pen, new[] { new PointF(15.5f, 10.5f), new PointF(20.5f, 7.5f), new PointF(20.5f, 16.5f), new PointF(15.5f, 13.5f) });
            break;
          case "reset":
            g.DrawArc(pen, 4.5f, 4.5f, 15, 15, 200, 290);
            g.DrawLines(pen, new[] { new PointF(4.5f, 4.5f), new PointF(4.5f, 8.5f), new PointF(8.5f, 8.5f) });
            break;
        }
      }
      g.Restore(saved);
    }

    public static GraphicsPath RoundRect(float x, float y, float w, float h, float r) {
      var p = new GraphicsPath();
      r = Math.Max(0.01f, Math.Min(r, Math.Min(w, h) / 2));
      float d = r * 2;
      p.AddArc(x, y, d, d, 180, 90);
      p.AddArc(x + w - d, y, d, d, 270, 90);
      p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
      p.AddArc(x, y + h - d, d, d, 90, 90);
      p.CloseFigure();
      return p;
    }
  }
}

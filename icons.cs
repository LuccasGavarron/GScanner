// Reconhece o item sob o cursor pelo ícone, sem esperar a dica do jogo.
// 1) acha a célula do item pelas linhas da grade (cinza-azulado, RGB ~73,81,84 a 88,93,96);
// 2) se a célula está vazia (quase preta e lisa), não há item;
// 3) compara o recorte com as imagens de grade do tarkov.dev (cache/grid) do mesmo tamanho, também girado 90°.
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging;
using System.IO; using System.Collections.Generic; using System.Runtime.InteropServices;

public static class Icons {
  const int P = 8; // amostras por espaço da grade na comparação
  class Ref { public string Id; public int W, H; public float[] V; }
  static readonly List<Ref> refs = new List<Ref>();
  public static int Count { get { return refs.Count; } }

  public static void Load(string dir) {
    refs.Clear();
    foreach (var line in File.ReadAllLines(Path.Combine(dir, "index.txt"))) {
      var p = line.Split(' ');
      if (p.Length < 3) continue;
      try {
        int w = int.Parse(p[1]), h = int.Parse(p[2]);
        using (var b = new Bitmap(Path.Combine(dir, p[0] + ".jpg")))
          refs.Add(new Ref { Id = p[0], W = w, H = h, V = Vec(b, new Rectangle(0, 0, b.Width - 1, b.Height - 1), w, h) }); // a imagem tem 1 px a mais (borda)
      } catch { }
    }
  }

  // Vetor normalizado (média 0, norma 1) do recorte reduzido a P amostras por espaço, em RGB.
  // Ignora os cantos da direita em cima (nome curto) e embaixo (quantidade, durabilidade, marca de FIR).
  static float[] Vec(Bitmap src, Rectangle r, int w, int h) {
    int W = w * P, H = h * P;
    using (var small = new Bitmap(W, H, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(small)) {
        g.InterpolationMode = InterpolationMode.HighQualityBilinear; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(src, new Rectangle(0, 0, W, H), r, GraphicsUnit.Pixel);
      }
      var data = small.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      var bytes = new byte[data.Stride * H];
      Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
      small.UnlockBits(data);
      var v = new List<float>();
      for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
          if (x >= W / 2 && (y < 2 || y >= H - 2)) continue;
          int i = y * data.Stride + x * 3;
          v.Add(bytes[i]); v.Add(bytes[i + 1]); v.Add(bytes[i + 2]);
        }
      var a = v.ToArray();
      double mean = 0; foreach (var f in a) mean += f; mean /= a.Length;
      double norm = 0; for (int i = 0; i < a.Length; i++) { a[i] -= (float)mean; norm += a[i] * a[i]; }
      norm = Math.Sqrt(norm); if (norm < 1e-6) norm = 1;
      for (int i = 0; i < a.Length; i++) a[i] = (float)(a[i] / norm);
      return a;
    }
  }

  static bool IsLine(Color c) { // cor das linhas da grade, com folga para o topo mais claro do esconderijo
    return c.R >= 62 && c.R <= 104 && c.G >= 70 && c.G <= 110 && c.B >= 72 && c.B <= 116 && c.B >= c.R && c.G >= c.R - 2;
  }
  // fração de pixels de linha numa coluna (vertical) ou numa linha (horizontal) do trecho dado
  static double LineRatio(Bitmap b, int fixedPos, int from, int to, bool vertical) {
    int hit = 0, n = 0;
    for (int t = from; t <= to; t++) {
      int x = vertical ? fixedPos : t, y = vertical ? t : fixedPos;
      if (x < 0 || y < 0 || x >= b.Width || y >= b.Height) continue;
      n++; if (IsLine(b.GetPixel(x, y))) hit++;
    }
    return n == 0 ? 0 : (double)hit / n;
  }
  static int Scan(Bitmap b, int start, int step, int limit, int across, int half, bool vertical) {
    for (int p = start, k = 0; k < limit; p += step, k++)
      if (LineRatio(b, p, across - half, across + half, vertical) >= 0.5) return p;
    return -1;
  }

  // Resultado: "vazio", "" (não deu para saber) ou "id largura altura nota segunda" do melhor item.
  // b: captura em volta do cursor; (cx, cy): cursor dentro dela; slot: tamanho do espaço em px (84 em 1440p).
  public static string Identify(Bitmap b, int cx, int cy, double slot) {
    int half = (int)(slot * 0.35), lim = (int)(slot * 6.2);
    int L = Scan(b, cx, -1, lim, cy, half, true), R = Scan(b, cx, 1, lim, cy, half, true);
    int T = Scan(b, cy, -1, lim, cx, half, false), B = Scan(b, cy, 1, lim, cx, half, false);
    if (L < 0 || R < 0 || T < 0 || B < 0) return "";
    double fw = (R - L) / slot, fh = (B - T) / slot;
    int w = (int)Math.Round(fw), h = (int)Math.Round(fh);
    if (w < 1 || h < 1 || w > 6 || h > 6 || Math.Abs(fw - w) > 0.15 || Math.Abs(fh - h) > 0.15) return "";
    var cell = Rectangle.FromLTRB(L + 1, T + 1, R, B);
    // vazio: miolo escuro e liso
    double sum = 0, sq = 0; int n = 0;
    for (int y = cell.Top + 6; y < cell.Bottom - 6; y += 3)
      for (int x = cell.Left + 6; x < cell.Right - 6; x += 3) { var c = b.GetPixel(x, y); double s = c.R + c.G + c.B; sum += s; sq += s * s; n++; }
    double m = sum / Math.Max(1, n), sd = Math.Sqrt(Math.Max(0, sq / Math.Max(1, n) - m * m));
    if (m < 90 && sd < 12) return "vazio";
    float[] direct = Vec(b, cell, w, h), turned = null;
    if (w != h) using (var r = b.Clone(cell, b.PixelFormat)) { r.RotateFlip(RotateFlipType.Rotate270FlipNone); turned = Vec(r, new Rectangle(0, 0, r.Width, r.Height), h, w); }
    double best = -1, second = -1; string id = null;
    foreach (var f in refs) {
      float[] v = f.W == w && f.H == h ? direct : f.W == h && f.H == w ? turned : null;
      if (v == null || v.Length != f.V.Length) continue;
      double dot = 0; for (int i = 0; i < v.Length; i++) dot += v[i] * f.V[i];
      if (dot > best) { second = best; best = dot; id = f.Id; } else if (dot > second) second = dot;
    }
    return id == null ? "" : id + " " + w + " " + h + " " + best.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + " " + second.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
  }
}

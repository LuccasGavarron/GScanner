# Cartão do item por cima do jogo (Tarkov em janela sem borda): ao lado do cursor no inventário, ao lado da mira em raid.
# Ouve os eventos "hover" do servidor do GScanner. A janela não recebe foco nem clique: tudo passa para o jogo.
# Arquivo salvo em UTF-8 com BOM: sem ele o PowerShell 5 lê como ANSI e embaralha ₽, — e ⚠.
param([int]$Port = 7777, [int]$ParentPid = 0)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions @'
using System; using System.Drawing; using System.Windows.Forms; using System.Net; using System.IO; using System.Threading;
using System.Globalization; using System.Collections; using System.Collections.Generic; using System.Collections.Concurrent;
using System.Web.Script.Serialization;
public class Card : Form {
  // Cores e fonte no estilo das telas do Tarkov
  static readonly Color Bg = Color.FromArgb(12, 12, 12), Head = Color.FromArgb(28, 28, 26), Line = Color.FromArgb(74, 74, 70);
  static readonly Color Ink = Color.FromArgb(199, 197, 179), Muted = Color.FromArgb(128, 126, 114), Sand = Color.FromArgb(154, 136, 102);
  static readonly Color Green = Color.FromArgb(132, 190, 96), Amber = Color.FromArgb(222, 180, 90);
  static readonly string Face = FontFamily.Families.Length > 0 && Array.Exists(FontFamily.Families, f => f.Name == "Bahnschrift SemiCondensed") ? "Bahnschrift SemiCondensed" : "Segoe UI";
  static readonly CultureInfo BR = new CultureInfo("pt-BR");
  static readonly ConcurrentDictionary<string, Image> Cache = new ConcurrentDictionary<string, Image>();

  Label title = Lbl(12f, Color.FromArgb(229, 227, 216), true), stats = Lbl(9.5f, Muted), quests = Lbl(9.5f, Amber);
  Label fleaK = Key("FLEA"), fleaV = Val(), tradK = Key("TRADER"), tradV = Val(), slotK = Key("POR SLOT"), slotV = Val();
  Label ammoHead = Key("MUNIÇÃO  ·  PENETRAÇÃO / DANO"), magHead = Key("PENTES");
  FlowLayoutPanel col = new FlowLayoutPanel(), ammoRow = Row(), magRow = Row();
  TableLayoutPanel prices = new TableLayoutPanel();
  PictureBox pic = new PictureBox();
  FlowLayoutPanel root = new FlowLayoutPanel();
  Panel head, accent, body;

  // TOOLWINDOW | TRANSPARENT (clique passa) | LAYERED | NOACTIVATE
  protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x20 | 0x80000 | 0x08000000; return cp; } }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void OnPaint(PaintEventArgs e) { // borda fina, como as caixas do jogo
    base.OnPaint(e);
    using (var p = new Pen(Line)) e.Graphics.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
  }

  static Label Lbl(float size, Color c, bool bold = false) {
    return new Label { AutoSize = true, MaximumSize = new Size(460, 0), ForeColor = c, BackColor = Color.Transparent,
      Font = new Font(Face, size, bold ? FontStyle.Bold : FontStyle.Regular), Margin = new Padding(0, 2, 0, 2) };
  }
  static Label Key(string t) { var l = Lbl(8.5f, Muted); l.Text = t; l.Margin = new Padding(0, 3, 12, 3); return l; }
  static Label Val() { var l = Lbl(10.5f, Ink); l.Anchor = AnchorStyles.Right; return l; }
  static FlowLayoutPanel Row() { return new FlowLayoutPanel { AutoSize = true, WrapContents = true, MaximumSize = new Size(460, 0), Margin = new Padding(0, 0, 0, 6) }; }

  public Card() {
    FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    BackColor = Bg; Opacity = 0.94; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(1);
    // faixa do título: nome do item em maiúsculas, linha cor de areia embaixo
    head = new Panel { BackColor = Head, AutoSize = true, Padding = new Padding(12, 8, 12, 8), Margin = new Padding(0) };
    title.MaximumSize = new Size(470, 0); head.Controls.Add(title);
    accent = new Panel { Height = 2, BackColor = Sand, Margin = new Padding(0) };
    // corpo: foto do trader à esquerda, preços em linhas rótulo/valor à direita
    body = new Panel { AutoSize = true, Padding = new Padding(0, 0, 12, 10), Margin = new Padding(0) };
    pic.Size = new Size(54, 54); pic.SizeMode = PictureBoxSizeMode.Zoom; pic.Location = new Point(12, 12); pic.ErrorImage = null; pic.InitialImage = null;
    prices.AutoSize = true; prices.ColumnCount = 2; prices.Margin = new Padding(0);
    prices.Controls.Add(fleaK, 0, 0); prices.Controls.Add(fleaV, 1, 0);
    prices.Controls.Add(tradK, 0, 1); prices.Controls.Add(tradV, 1, 1);
    prices.Controls.Add(slotK, 0, 2); prices.Controls.Add(slotV, 1, 2);
    col.FlowDirection = FlowDirection.TopDown; col.WrapContents = false; col.AutoSize = true; col.Location = new Point(78, 8);
    col.Controls.AddRange(new Control[] { prices, stats, quests, ammoHead, ammoRow, magHead, magRow });
    body.Controls.Add(pic); body.Controls.Add(col);
    root.FlowDirection = FlowDirection.TopDown; root.WrapContents = false; root.AutoSize = true; root.Margin = new Padding(0);
    root.Controls.AddRange(new Control[] { head, accent, body });
    Controls.Add(root);
  }

  // imagens já baixadas ficam na memória: o próximo hover do mesmo item aparece na hora
  static void Fetch(PictureBox p, string url) {
    Image img;
    if (Cache.TryGetValue(url, out img)) { p.Image = img; return; }
    System.ComponentModel.AsyncCompletedEventHandler done = null;
    done = (s, e) => { p.LoadCompleted -= done; if (e.Error == null && !e.Cancelled && p.Image != null) Cache[url] = p.Image; };
    p.LoadCompleted += done;
    p.LoadAsync(url);
  }
  static string Rub(object v) { return v == null ? "—" : string.Format(BR, "{0:N0} ₽", Convert.ToDouble(v)); }
  // ícone com duas linhas de texto embaixo, num quadro escuro
  static Control Tile(string icon, string text) {
    var p = new Panel { Size = new Size(70, 78), Margin = new Padding(0, 0, 4, 4), BackColor = Head };
    var img = new PictureBox { Size = new Size(46, 46), Location = new Point(12, 3), SizeMode = PictureBoxSizeMode.Zoom, ErrorImage = null, InitialImage = null }; // sem o x vermelho quando falta ícone
    Fetch(img, icon);
    var l = new Label { Text = text, Location = new Point(0, 50), Size = new Size(70, 28), ForeColor = Ink, Font = new Font(Face, 8f), TextAlign = ContentAlignment.TopCenter };
    p.Controls.Add(img); p.Controls.Add(l);
    return p;
  }
  void Fill(FlowLayoutPanel row, Label head, ArrayList list, Func<IDictionary, string> text) {
    row.Controls.Clear();
    bool any = list != null && list.Count > 0;
    head.Visible = row.Visible = any;
    if (any) foreach (IDictionary x in list) row.Controls.Add(Tile((string)x["icon"], text(x)));
  }
  public void ShowItem(IDictionary h) {
    if (h == null) { Hide(); return; }
    SuspendLayout();
    var t = h["trader"] as IDictionary;
    double fl = h["flea"] == null ? 0 : Convert.ToDouble(h["flea"]), tp = t == null ? 0 : Convert.ToDouble(t["price"]);
    title.Text = ((string)h["name"]).ToUpper(BR);
    fleaV.Text = Rub(h["flea"]);
    tradK.Text = t == null ? "TRADER" : ((string)t["name"]).ToUpper(BR);
    tradV.Text = t == null ? "nenhum compra" : Rub(t["price"]);
    fleaV.ForeColor = fl > 0 && fl >= tp ? Green : Ink;
    tradV.ForeColor = tp > fl ? Green : Ink;
    slotV.Text = Rub(h["perSlot"]);
    var st = h.Contains("stats") ? h["stats"] as ArrayList : null; // mochila/colete: espaço; armadura: proteção
    stats.Text = st != null ? string.Join(Environment.NewLine, st.ToArray()) : "";
    stats.Visible = stats.Text != "";
    var q = h["quests"] as ArrayList;
    quests.Text = q != null && q.Count > 0 ? "⚠ QUEST: " + string.Join(", ", q.ToArray()) : "";
    quests.Visible = quests.Text != "";
    Fill(ammoRow, ammoHead, h.Contains("ammo") ? h["ammo"] as ArrayList : null, a => a["name"] + "\n" + a["pen"] + " / " + a["dmg"]);
    Fill(magRow, magHead, h.Contains("mags") ? h["mags"] as ArrayList : null, m => m["name"] + "\n" + m["cap"] + " balas");
    pic.Image = null;
    if (t != null && t["portrait"] != null) Fetch(pic, (string)t["portrait"]);
    ResumeLayout(); PerformLayout();
    // faixa do título e linha de areia na largura do conteúdo
    int w = Math.Max(head.PreferredSize.Width, body.PreferredSize.Width);
    head.MinimumSize = new Size(w, 0); accent.Width = w; body.MinimumSize = new Size(w, 0);
    PerformLayout();
    // em raid fica ao lado da mira (centro da tela); no inventário, ao lado do cursor
    bool raid = h.Contains("raid") && h["raid"] is bool && (bool)h["raid"];
    var screen = raid ? Screen.PrimaryScreen : Screen.FromPoint(Cursor.Position);
    var c = raid ? new Point(screen.Bounds.X + screen.Bounds.Width / 2 + 60, screen.Bounds.Y + screen.Bounds.Height / 2 + 20) : Cursor.Position;
    var area = screen.WorkingArea;
    int x = c.X + 28, y = c.Y + 28;
    if (x + Width > area.Right) x = c.X - Width - 12;
    if (y + Height > area.Bottom) y = Math.Max(area.Top, c.Y - Height - 12);
    Location = new Point(x, y);
    Show(); Invalidate();
  }
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  public static void Run(int port, int parent) {
    var card = new Card(); var handle = card.Handle; // cria a janela na thread da interface
    if (Environment.GetEnvironmentVariable("GSCANNER_CAPTURE") == null) SetWindowDisplayAffinity(handle, 0x11); // fora das capturas: o leitor não lê o próprio cartão (GSCANNER_CAPTURE=1 só em teste)
    // fotos dos traders baixadas já: o primeiro cartão sai completo
    new Thread(() => {
      foreach (var n in new[] { "prapor", "therapist", "fence", "skier", "peacekeeper", "mechanic", "ragman", "jaeger", "ref", "lightkeeper" }) {
        var url = "https://tarkov.dev/images/traders/" + n + "-portrait.png";
        try { using (var wc = new WebClient()) Cache[url] = Image.FromStream(new MemoryStream(wc.DownloadData(url))); } catch { }
      }
    }) { IsBackground = true }.Start();
    new Thread(() => {
      var js = new JavaScriptSerializer();
      while (true) {
        try {
          var req = (HttpWebRequest)WebRequest.Create("http://localhost:" + port + "/events"); req.Timeout = Timeout.Infinite; req.ReadWriteTimeout = Timeout.Infinite;
          using (var rd = new StreamReader(req.GetResponse().GetResponseStream())) {
            string line;
            while ((line = rd.ReadLine()) != null) {
              if (!line.StartsWith("data: ")) continue;
              var msg = js.Deserialize<Dictionary<string, object>>(line.Substring(6));
              if ((string)msg["type"] != "hover") continue;
              var data = msg["data"] as IDictionary;
              card.BeginInvoke((Action)(() => card.ShowItem(data)));
            }
          }
        } catch { }
        card.BeginInvoke((Action)(() => card.Hide()));
        if (parent > 0) { try { System.Diagnostics.Process.GetProcessById(parent); } catch { Environment.Exit(0); } } // servidor morreu
        Thread.Sleep(3000); // servidor fora do ar: tenta de novo
      }
    }) { IsBackground = true }.Start();
    Application.Run();
  }
}
'@
[Card]::Run($Port, $ParentPid)

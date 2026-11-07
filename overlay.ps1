# Cartão do item ao lado do mouse, por cima do jogo (precisa do Tarkov em janela sem borda).
# Ouve os eventos "hover" do servidor do GScanner. A janela não recebe foco nem clique: tudo passa para o jogo.
# Arquivo salvo em UTF-8 com BOM: sem ele o PowerShell 5 lê como ANSI e embaralha ₽, — e ⚠.
param([int]$Port = 7777, [int]$ParentPid = 0)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions @'
using System; using System.Drawing; using System.Windows.Forms; using System.Net; using System.IO; using System.Threading;
using System.Globalization; using System.Collections; using System.Collections.Generic; using System.Web.Script.Serialization;
public class Card : Form {
  Label title = Lbl(10.5f, true), flea = Lbl(10f), trader = Lbl(10f), slot = Lbl(10f), quests = Lbl(10f);
  Label ammoHead = Lbl(8.5f), magHead = Lbl(8.5f), stats = Lbl(9.5f);
  FlowLayoutPanel col = new FlowLayoutPanel(), ammoRow = Row(), magRow = Row();
  PictureBox pic = new PictureBox();
  static readonly CultureInfo BR = new CultureInfo("pt-BR");
  static readonly Color Ink = Color.Gainsboro, Green = Color.FromArgb(120, 220, 120);
  // TOOLWINDOW | TRANSPARENT (clique passa) | LAYERED | NOACTIVATE
  protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x20 | 0x80000 | 0x08000000; return cp; } }
  protected override bool ShowWithoutActivation { get { return true; } }
  static Label Lbl(float size, bool bold = false) {
    return new Label { AutoSize = true, MaximumSize = new Size(440, 0), ForeColor = Ink, Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular), Margin = new Padding(0, 1, 0, 1) };
  }
  static FlowLayoutPanel Row() {
    return new FlowLayoutPanel { AutoSize = true, WrapContents = true, MaximumSize = new Size(440, 0), Margin = new Padding(0, 0, 0, 4) };
  }
  public Card() {
    FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(27, 27, 27); Opacity = 0.95; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(0, 0, 10, 8);
    pic.Size = new Size(56, 56); pic.SizeMode = PictureBoxSizeMode.Zoom; pic.Location = new Point(8, 8); Controls.Add(pic);
    col.FlowDirection = FlowDirection.TopDown; col.WrapContents = false; col.AutoSize = true; col.Location = new Point(72, 6);
    col.Controls.AddRange(new Control[] { title, flea, trader, slot, stats, quests, ammoHead, ammoRow, magHead, magRow });
    Controls.Add(col);
    slot.ForeColor = Color.Gray; quests.ForeColor = Color.FromArgb(255, 210, 100); ammoHead.ForeColor = magHead.ForeColor = Color.Gray;
    ammoHead.Text = "Munição (penetração / dano)"; magHead.Text = "Pentes";
  }
  // imagens já baixadas ficam na memória: o próximo hover do mesmo item aparece na hora
  static readonly Dictionary<string, Image> Cache = new Dictionary<string, Image>();
  static void Fetch(PictureBox p, string url) {
    Image img;
    if (Cache.TryGetValue(url, out img)) { p.Image = img; return; }
    System.ComponentModel.AsyncCompletedEventHandler done = null;
    done = (s, e) => { p.LoadCompleted -= done; if (e.Error == null && !e.Cancelled && p.Image != null) Cache[url] = p.Image; };
    p.LoadCompleted += done;
    p.LoadAsync(url);
  }
  static string Rub(object v) { return v == null ? "—" : string.Format(BR, "{0:N0} ₽", Convert.ToDouble(v)); }
  // um quadrado com o ícone e duas linhas de texto embaixo
  static Control Tile(string icon, string text) {
    var p = new Panel { Size = new Size(66, 74), Margin = new Padding(0, 0, 4, 0) };
    var img = new PictureBox { Size = new Size(48, 48), Location = new Point(9, 0), SizeMode = PictureBoxSizeMode.Zoom };
    Fetch(img, icon);
    var l = new Label { Text = text, Location = new Point(0, 48), Size = new Size(66, 26), ForeColor = Ink, Font = new Font("Segoe UI", 7.5f), TextAlign = ContentAlignment.TopCenter };
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
    title.Text = (string)h["name"];
    flea.Text = "Flea: " + Rub(h["flea"]);
    trader.Text = t == null ? "Nenhum trader compra" : t["name"] + ": " + Rub(t["price"]);
    flea.ForeColor = fl > 0 && fl >= tp ? Green : Ink;
    trader.ForeColor = tp > fl ? Green : Ink;
    slot.Text = "Por slot: " + Rub(h["perSlot"]);
    var q = h["quests"] as ArrayList;
    quests.Text = q != null && q.Count > 0 ? "⚠ Quest: " + string.Join(", ", q.ToArray()) : "";
    quests.Visible = quests.Text != "";
    var st = h.Contains("stats") ? h["stats"] as ArrayList : null; // mochila/colete: espaço; armadura: proteção
    stats.Text = st != null ? string.Join(Environment.NewLine, st.ToArray()) : "";
    stats.Visible = stats.Text != "";
    Fill(ammoRow, ammoHead, h.Contains("ammo") ? h["ammo"] as ArrayList : null, a => a["name"] + "\n" + a["pen"] + " / " + a["dmg"]);
    Fill(magRow, magHead, h.Contains("mags") ? h["mags"] as ArrayList : null, m => m["name"] + "\n" + m["cap"] + " balas");
    pic.Image = null;
    if (t != null && t["portrait"] != null) Fetch(pic, (string)t["portrait"]);
    ResumeLayout(); PerformLayout();
    var c = Cursor.Position; var area = Screen.FromPoint(c).WorkingArea;
    int x = c.X + 28, y = c.Y + 28;
    if (x + Width > area.Right) x = c.X - Width - 12;
    if (y + Height > area.Bottom) y = Math.Max(area.Top, c.Y - Height - 12);
    Location = new Point(x, y);
    Show();
  }
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  public static void Run(int port, int parent) {
    var card = new Card(); var handle = card.Handle; // cria a janela na thread da interface
    if (Environment.GetEnvironmentVariable("GSCANNER_CAPTURE") == null) SetWindowDisplayAffinity(handle, 0x11); // fora das capturas: o leitor não lê o próprio cartão (GSCANNER_CAPTURE=1 só em teste)
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

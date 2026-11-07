# Cartão do item ao lado do mouse, por cima do jogo (precisa do Tarkov em janela sem borda).
# Ouve os eventos "hover" do servidor do GScanner. A janela não recebe foco nem clique: tudo passa para o jogo.
param([int]$Port = 7777, [int]$ParentPid = 0)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions @'
using System; using System.Drawing; using System.Windows.Forms; using System.Net; using System.IO; using System.Threading;
using System.Globalization; using System.Collections; using System.Collections.Generic; using System.Web.Script.Serialization;
public class Card : Form {
  Label title = new Label(), flea = new Label(), trader = new Label(), slot = new Label(), quests = new Label();
  PictureBox pic = new PictureBox();
  static readonly CultureInfo BR = new CultureInfo("pt-BR");
  // TOOLWINDOW | TRANSPARENT (clique passa) | LAYERED | NOACTIVATE
  protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x20 | 0x80000 | 0x08000000; return cp; } }
  protected override bool ShowWithoutActivation { get { return true; } }
  public Card() {
    FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(27, 27, 27); Opacity = 0.94; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(0, 0, 10, 8);
    pic.Size = new Size(56, 56); pic.SizeMode = PictureBoxSizeMode.Zoom; pic.Location = new Point(8, 8); Controls.Add(pic);
    int y = 6;
    foreach (var l in new[] { title, flea, trader, slot, quests }) {
      l.AutoSize = true; l.MaximumSize = new Size(380, 0); l.ForeColor = Color.Gainsboro; l.Font = new Font("Segoe UI", 10f);
      l.Location = new Point(72, y); y += 21; Controls.Add(l);
    }
    title.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold); slot.ForeColor = Color.Gray; quests.ForeColor = Color.FromArgb(255, 210, 100);
  }
  // arquivo salvo em UTF-8 com BOM: sem ele o PowerShell 5 lê como ANSI e embaralha ₽, — e ⚠
  static string Rub(object v) { return v == null ? "—" : string.Format(BR, "{0:N0} ₽", Convert.ToDouble(v)); }
  public void ShowItem(IDictionary h) {
    if (h == null) { Hide(); return; }
    var t = h["trader"] as IDictionary;
    double fl = h["flea"] == null ? 0 : Convert.ToDouble(h["flea"]), tp = t == null ? 0 : Convert.ToDouble(t["price"]);
    title.Text = (string)h["name"];
    flea.Text = "Flea: " + Rub(h["flea"]);
    trader.Text = t == null ? "Nenhum trader compra" : t["name"] + ": " + Rub(t["price"]);
    var green = Color.FromArgb(120, 220, 120);
    flea.ForeColor = fl > 0 && fl >= tp ? green : Color.Gainsboro;
    trader.ForeColor = tp > fl ? green : Color.Gainsboro;
    slot.Text = "Por slot: " + Rub(h["perSlot"]);
    var q = h["quests"] as ArrayList;
    quests.Text = q != null && q.Count > 0 ? "⚠ Quest: " + string.Join(", ", q.ToArray()) : "";
    quests.Visible = quests.Text != "";
    pic.Image = null;
    if (t != null && t["portrait"] != null) pic.LoadAsync((string)t["portrait"]);
    var c = Cursor.Position; var area = Screen.FromPoint(c).WorkingArea;
    int x = c.X + 28, y = c.Y + 28;
    if (x + Width > area.Right) x = c.X - Width - 12;
    if (y + Height > area.Bottom) y = c.Y - Height - 12;
    Location = new Point(x, y);
    Show();
  }
  public static void Run(int port, int parent) {
    var card = new Card(); var handle = card.Handle; // cria a janela na thread da interface
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

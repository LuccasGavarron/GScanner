# Lê o texto perto do mouse quando o Tarkov está em primeiro plano (OCR do Windows) e escreve uma linha JSON por leitura.
# Não toca no processo do jogo: só captura a tela, como um print.
Add-Type -AssemblyName System.Drawing, System.Runtime.WindowsRuntime
[Console]::OutputEncoding = [Text.Encoding]::UTF8 # o servidor lê UTF-8; sem isso os acentos chegam embaralhados
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class Win {
  // assinatura barata da imagem (1 pixel a cada 7): se não mudou, não precisa rodar o OCR de novo
  public static long Sig(System.Drawing.Bitmap b) { long h = 17; for (int y = 0; y < b.Height; y += 7) for (int x = 0; x < b.Width; x += 7) h = h * 31 + b.GetPixel(x, y).ToArgb(); return h; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  // Em raid o jogo esconde o cursor; ele só aparece com inventário ou menu aberto
  public static bool CursorVisible() { var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(ci); return GetCursorInfo(ref ci) && (ci.flags & 1) != 0; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string ForegroundProcess() {
    uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }
}
'@
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

function Read-Text([Drawing.Bitmap]$bmp) {
  $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
  $ras = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
  $w = [Windows.Storage.Streams.DataWriter]::new($ras); $w.WriteBytes($ms.ToArray())
  $null = Await ($w.StoreAsync()) ([uint32]); $ras.Seek(0)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  (Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])).Lines
}
# Cada linha vira [texto, esquerda, topo, direita, base], com o cursor em (0, 0)
function Lines-Json($lines, [int]$cx, [int]$cy) {
  # laços simples: pipeline (Measure-Object, ForEach-Object) custava milissegundos por linha
  $sb = New-Object Text.StringBuilder '['
  foreach ($l in $lines) {
    $x1 = 99999; $y1 = 99999; $x2 = -99999; $y2 = -99999
    foreach ($w in $l.Words) {
      $r = $w.BoundingRect
      if ($r.X -lt $x1) { $x1 = $r.X }; if ($r.Y -lt $y1) { $y1 = $r.Y }
      if ($r.X + $r.Width -gt $x2) { $x2 = $r.X + $r.Width }; if ($r.Y + $r.Height -gt $y2) { $y2 = $r.Y + $r.Height }
    }
    $t = $l.Text.Replace('\', '\\').Replace('"', '\"')
    if ($sb.Length -gt 1) { [void]$sb.Append(',') }
    [void]$sb.Append("[`"$t`",$([int]($x1 - $cx)),$([int]($y1 - $cy)),$([int]($x2 - $cx)),$([int]($y2 - $cy))]")
  }
  [void]$sb.Append(']')
  $sb.ToString()
}

# Arquivo de imagem como argumento: lê uma vez e sai (usado no teste).
if ($args.Count) { $b = [Drawing.Bitmap]::new($args[0]); Lines-Json (Read-Text $b) ([int]$args[1]) ([int]$args[2]); exit } # teste: imagem, x e y do cursor nela

$last = ''; $lastSig = 0; $n = 0; $stillAt = ''; $iconAt = ''
Add-Type -AssemblyName System.Windows.Forms
# Reconhecimento pelo ícone (icons.cs): imagens de grade em cache/grid; sem elas, só a dica do jogo
Add-Type -Path (Join-Path $PSScriptRoot 'icons.cs') -ReferencedAssemblies System.Drawing
$gridDir = Join-Path $PSScriptRoot 'cachegrid'
if (Test-Path (Join-Path $gridDir 'index.txt')) { [Icons]::Load($gridDir) }
$slot = 63.0 * [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height / 1080 # espaço da grade: 63 px em 1080p, 84 px em 1440p
function Emit($json) { if ($json -ne $script:last) { $script:last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() } }
while ($true) {
  if (($n++ % 50) -eq 0 -and $env:GSCANNER_PID -and -not (Get-Process -Id $env:GSCANNER_PID -ErrorAction SilentlyContinue)) { exit } # servidor caiu
  if ([Win]::ForegroundProcess() -ne 'EscapeFromTarkov') { Emit '[]'; Start-Sleep -Milliseconds 200; continue } # fora do jogo: esconde o cartão
  if ([Win]::CursorVisible()) {
    # Inventário: só a região da dica do jogo, colada ao cursor (à direita, um pouco acima)
    Start-Sleep -Milliseconds 80
    $p = New-Object Win+POINT; [void][Win]::GetCursorPos([ref]$p)
    # mouse parado num ponto novo: reconhece pelo ícone uma vez (rápido, sem esperar a dica do jogo)
    $at = "$($p.X),$($p.Y)"
    if ($at -eq $stillAt -and $at -ne $iconAt -and [Icons]::Count -gt 0) {
      $iconAt = $at
      $big = New-Object Drawing.Bitmap 1100, 1100
      $gb = [Drawing.Graphics]::FromImage($big); $gb.CopyFromScreen($p.X - 550, $p.Y - 550, 0, 0, $big.Size); $gb.Dispose()
      $r = [Icons]::Identify($big, 550, 550, $slot); $big.Dispose()
      if ($r) { $script:last = ''; Emit ('{"icon":' + (ConvertTo-Json -Compress $r) + '}') }
    }
    $stillAt = $at
    $bmp = New-Object Drawing.Bitmap 760, 240
    $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($p.X - 40, $p.Y - 160, 0, 0, $bmp.Size); $g.Dispose()
    $cx = 40; $cy = 160; $raid = $false
  } else {
    # Raid (o jogo esconde o cursor): retângulo no centro, onde aparece o nome curto do item mirado, abaixo da mira
    Start-Sleep -Milliseconds 150
    $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object Drawing.Bitmap 440, 220
    $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($s.X + $s.Width / 2 - 220, $s.Y + $s.Height / 2 - 90, 0, 0, $bmp.Size); $g.Dispose()
    $cx = 220; $cy = 90; $raid = $true
  }
  $sig = [Win]::Sig($bmp)
  if ($sig -eq $lastSig) { $bmp.Dispose(); continue }
  $lastSig = $sig
  $json = Lines-Json @(Read-Text $bmp) $cx $cy; $bmp.Dispose()
  Emit $(if ($raid) { '{"raid":1,"l":' + $json + '}' } else { $json })
}

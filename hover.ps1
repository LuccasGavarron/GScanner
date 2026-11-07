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
  $parts = foreach ($l in $lines) {
    $r = $l.Words | ForEach-Object { $_.BoundingRect }
    $x1 = ($r | Measure-Object X -Minimum).Minimum; $y1 = ($r | Measure-Object Y -Minimum).Minimum
    $x2 = ($r | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum; $y2 = ($r | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
    '[' + (ConvertTo-Json -Compress $l.Text) + ",$([int]($x1 - $cx)),$([int]($y1 - $cy)),$([int]($x2 - $cx)),$([int]($y2 - $cy))]"
  }
  '[' + ($parts -join ',') + ']'
}

# Arquivo de imagem como argumento: lê uma vez e sai (usado no teste).
if ($args.Count) { $b = [Drawing.Bitmap]::new($args[0]); Lines-Json (Read-Text $b) ([int]$args[1]) ([int]$args[2]); exit } # teste: imagem, x e y do cursor nela

$last = ''; $lastSig = 0; $n = 0
while ($true) {
  Start-Sleep -Milliseconds 80
  if (($n++ % 50) -eq 0 -and $env:GSCANNER_PID -and -not (Get-Process -Id $env:GSCANNER_PID -ErrorAction SilentlyContinue)) { exit } # servidor caiu
  if ([Win]::ForegroundProcess() -ne 'EscapeFromTarkov') {
    if ($last -ne '[]') { $last = '[]'; [Console]::Out.WriteLine($last); [Console]::Out.Flush() } # saiu do jogo: esconde o cartão
    continue
  }
  $p = New-Object Win+POINT; [void][Win]::GetCursorPos([ref]$p)
  # Região em volta do cursor: pega a dica do item (ao lado) e o rótulo do item na grade (acima, até 330 px para itens altos)
  $bmp = New-Object Drawing.Bitmap 1000, 420
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($p.X - 300, $p.Y - 340, 0, 0, $bmp.Size); $g.Dispose()
  $sig = [Win]::Sig($bmp)
  if ($sig -eq $lastSig) { $bmp.Dispose(); continue }
  $lastSig = $sig
  $json = Lines-Json @(Read-Text $bmp) 300 340; $bmp.Dispose()
  if ($json -ne $last) { $last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
}

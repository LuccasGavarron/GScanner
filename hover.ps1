# Lê o texto perto do mouse quando o Tarkov está em primeiro plano (OCR do Windows) e escreve uma linha JSON por leitura.
# Não toca no processo do jogo: só captura a tela, como um print.
Add-Type -AssemblyName System.Drawing, System.Runtime.WindowsRuntime
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class Win {
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
  (Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])).Lines | ForEach-Object { $_.Text }
}

# Arquivo de imagem como argumento: lê uma vez e sai (usado no teste).
if ($args.Count) { Read-Text ([Drawing.Bitmap]::new($args[0])) | ConvertTo-Json -Compress; exit }

$last = ''
while ($true) {
  Start-Sleep -Milliseconds 300
  if ($env:GSCANNER_PID -and -not (Get-Process -Id $env:GSCANNER_PID -ErrorAction SilentlyContinue)) { exit } # servidor caiu
  if ([Win]::ForegroundProcess() -ne 'EscapeFromTarkov') {
    if ($last -ne '[]') { $last = '[]'; [Console]::Out.WriteLine($last); [Console]::Out.Flush() } # saiu do jogo: esconde o cartão
    continue
  }
  $p = New-Object Win+POINT; [void][Win]::GetCursorPos([ref]$p)
  # A dica do item aparece ao lado do cursor: região de 900x140 em volta dele
  $bmp = New-Object Drawing.Bitmap 900, 140
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($p.X - 200, $p.Y - 90, 0, 0, $bmp.Size); $g.Dispose()
  $lines = @(Read-Text $bmp); $bmp.Dispose()
  $json = ConvertTo-Json -Compress -InputObject $lines
  if ($json -ne $last) { $last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
}

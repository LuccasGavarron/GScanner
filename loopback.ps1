# Grava o som que sai pela saída padrão do Windows (WASAPI loopback, o mesmo que o OBS usa).
# Saída: uma linha "RATE <hz>" e depois amostras mono float32 little-endian, sem parar, até ser encerrado.
Add-Type @'
using System; using System.IO; using System.Threading; using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotUsed(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(int share, int flags, long dur, long period, IntPtr fmt, IntPtr session);
  int GetBufferSize(out uint n); int GetStreamLatency(out long l); int GetCurrentPadding(out uint p);
  int IsFormatSupported(int share, IntPtr fmt, out IntPtr closest); int GetMixFormat(out IntPtr fmt);
  int GetDevicePeriod(out long d, out long m); int Start(); int Stop(); int Reset(); int SetEventHandle(IntPtr h);
  int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong pos, out ulong qpc);
  int ReleaseBuffer(uint frames); int GetNextPacketSize(out uint n);
}
public static class Loopback {
  public static void Run() {
    IMMDevice dev; ((IMMDeviceEnumerator)new MMDeviceEnumeratorCo()).GetDefaultAudioEndpoint(0, 0, out dev);
    Guid iidClient = typeof(IAudioClient).GUID; object o; dev.Activate(ref iidClient, 23, IntPtr.Zero, out o);
    var client = (IAudioClient)o; IntPtr fmt; client.GetMixFormat(out fmt);
    int channels = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14);
    if (bits != 32) throw new Exception("formato de mixagem não é float32: " + bits + " bits");
    Marshal.ThrowExceptionForHR(client.Initialize(0, 0x00020000, 10000000, 0, fmt, IntPtr.Zero)); // 0x20000 = LOOPBACK
    Guid iidCap = typeof(IAudioCaptureClient).GUID; client.GetService(ref iidCap, out o);
    var cap = (IAudioCaptureClient)o;
    Stream so = Console.OpenStandardOutput();
    byte[] head = System.Text.Encoding.ASCII.GetBytes("RATE " + rate + "\n"); so.Write(head, 0, head.Length);
    client.Start();
    float[] all = new float[0];
    while (true) {
      Thread.Sleep(10);
      uint n; cap.GetNextPacketSize(out n);
      while (n > 0) {
        IntPtr data; uint frames, flags; ulong p1, p2; cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
        if (all.Length < frames * channels) all = new float[frames * channels];
        if ((flags & 2) == 0) Marshal.Copy(data, all, 0, (int)(frames * channels)); else Array.Clear(all, 0, all.Length); // 2 = silêncio
        byte[] outb = new byte[frames * 4];
        for (int f = 0; f < frames; f++) {
          float s = 0; for (int c = 0; c < channels; c++) s += all[f * channels + c];
          Buffer.BlockCopy(BitConverter.GetBytes(s / channels), 0, outb, f * 4, 4);
        }
        cap.ReleaseBuffer(frames); so.Write(outb, 0, outb.Length); so.Flush();
        cap.GetNextPacketSize(out n);
      }
    }
  }
}
'@
[Loopback]::Run()

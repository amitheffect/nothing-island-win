// Nothing Island - native system engine.
// Same JSON-lines protocol as bridge.ps1, but a small compiled .NET Framework program instead of a
// whole PowerShell runtime, so it needs far less memory. Compiled on first run with the C# compiler
// that ships with Windows (no SDK, no Visual Studio). C# 5 syntax on purpose: that's what csc.exe in
// C:\Windows\Microsoft.NET\Framework64\v4.0.30319 understands.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using Microsoft.Win32;

namespace NI {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref System.Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int Item(uint i, out IMMDevice d);
  }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl();   // unused slot
    [PreserveSig] int GetSimpleAudioVolume();     // unused slot
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
  }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);    // 1 = active
    [PreserveSig] int s1(); [PreserveSig] int s2(); [PreserveSig] int s3(); [PreserveSig] int s4();
    [PreserveSig] int s5(); [PreserveSig] int s6(); [PreserveSig] int s7(); [PreserveSig] int s8();
    [PreserveSig] int s9(); [PreserveSig] int s10();
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

  public static class Audio {
    // flow: 0 = speakers (eRender), 1 = microphone (eCapture)
    static IAudioEndpointVolume Ep(int flow) {
      var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
      IMMDevice dev = null;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, 1, out dev));
      object o;
      var iid = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }

    // Processes with an ACTIVE capture session on any microphone = apps using the mic right now.
    public static string[] MicApps() {
      var names = new System.Collections.Generic.List<string>();
      var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
      IMMDeviceCollection col;
      if (en.EnumAudioEndpoints(1, 1, out col) != 0 || col == null) return names.ToArray();
      uint n; col.GetCount(out n);
      var iid = typeof(IAudioSessionManager2).GUID;
      int self = System.Diagnostics.Process.GetCurrentProcess().Id;
      for (uint i = 0; i < n; i++) {
        try {
          IMMDevice dev;
          if (col.Item(i, out dev) != 0 || dev == null) continue;
          object o;
          if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0 || o == null) continue;
          var mgr = (IAudioSessionManager2)o;
          IAudioSessionEnumerator se;
          if (mgr.GetSessionEnumerator(out se) != 0 || se == null) continue;
          int c; se.GetCount(out c);
          for (int k = 0; k < c; k++) {
            try {
              IAudioSessionControl2 s;
              if (se.GetSession(k, out s) != 0 || s == null) continue;
              int st; s.GetState(out st);
              if (st != 1) continue;
              uint pid; s.GetProcessId(out pid);
              if (pid == 0 || pid == self) continue;
              string nm = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
              if (!names.Contains(nm)) names.Add(nm);
            } catch { }
          }
        } catch { }
      }
      return names.ToArray();
    }
    // Same walk as MicApps, but reports every step and error (for the tray "diagnostics" item).
    public static string[] MicDebug() {
      var log = new System.Collections.Generic.List<string>();
      try {
        var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        if (en == null) { log.Add("enumerator cast failed"); return log.ToArray(); }
        IMMDeviceCollection col;
        int hr = en.EnumAudioEndpoints(1, 1, out col);
        if (hr != 0 || col == null) { log.Add("EnumAudioEndpoints hr=0x" + hr.ToString("X8")); return log.ToArray(); }
        uint n; col.GetCount(out n);
        log.Add("capture devices: " + n);
        var iid = typeof(IAudioSessionManager2).GUID;
        for (uint i = 0; i < n; i++) {
          try {
            IMMDevice dev;
            hr = col.Item(i, out dev);
            if (hr != 0 || dev == null) { log.Add("dev " + i + ": Item hr=0x" + hr.ToString("X8")); continue; }
            object o;
            hr = dev.Activate(ref iid, 23, IntPtr.Zero, out o);
            if (hr != 0 || o == null) { log.Add("dev " + i + ": Activate hr=0x" + hr.ToString("X8")); continue; }
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            hr = mgr.GetSessionEnumerator(out se);
            if (hr != 0 || se == null) { log.Add("dev " + i + ": GetSessionEnumerator hr=0x" + hr.ToString("X8")); continue; }
            int c; se.GetCount(out c);
            log.Add("dev " + i + ": sessions " + c);
            for (int k = 0; k < c; k++) {
              try {
                IAudioSessionControl2 s;
                hr = se.GetSession(k, out s);
                if (hr != 0 || s == null) { log.Add("  s" + k + ": GetSession hr=0x" + hr.ToString("X8")); continue; }
                int st; s.GetState(out st);
                uint pid; int hp = s.GetProcessId(out pid);
                string nm = "?";
                try { if (pid != 0) nm = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
                log.Add("  s" + k + ": state " + st + " pid " + pid + " (" + nm + ") hr=0x" + hp.ToString("X8"));
              } catch (Exception ex) { log.Add("  s" + k + ": " + ex.GetType().Name + " " + ex.Message); }
            }
          } catch (Exception ex) { log.Add("dev " + i + ": " + ex.GetType().Name + " " + ex.Message); }
        }
      } catch (Exception ex) { log.Add("fatal: " + ex.GetType().Name + " " + ex.Message); }
      return log.ToArray();
    }
    public static float GetVolume(int flow) { float v = -1; Marshal.ThrowExceptionForHR(Ep(flow).GetMasterVolumeLevelScalar(out v)); return v; }
    public static void SetVolume(int flow, float v) { Marshal.ThrowExceptionForHR(Ep(flow).SetMasterVolumeLevelScalar(v, Guid.Empty)); }
    public static bool GetMute(int flow) { bool m; Marshal.ThrowExceptionForHR(Ep(flow).GetMute(out m)); return m; }
    public static void SetMute(int flow, bool m) { Marshal.ThrowExceptionForHR(Ep(flow).SetMute(m, Guid.Empty)); }
  }

  public static class Native {
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
    // 2 = busy (fullscreen app), 3 = fullscreen D3D game, 4 = presentation mode
    public static int UserState() { int s; return SHQueryUserNotificationState(out s) == 0 ? s : 0; }

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    // Apps that often look "fullscreen" to Windows (they draw their own title bar) but are just
    // normal work windows. The island never hides over these.
    static readonly string[] WorkApps = {
      "afterfx", "adobe premiere pro", "photoshop", "illustrator", "indesign", "adobe media encoder",
      "audition", "lightroom", "resolve", "blender", "figma", "code", "cursor", "explorer", "obs64", "capcut"
    };
    public static string ForegroundApp() {
      try {
        uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid == 0 ? "" : System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
      } catch { return ""; }
    }
    // True only for real fullscreen: games, F11 browsers, fullscreen video, presentations.
    public static bool Fullscreen() {
      int st = UserState();
      if (st == 3 || st == 4) return true;                     // exclusive D3D game / presentation mode
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return false;
      string app = ForegroundApp().ToLowerInvariant();
      if (Array.IndexOf(WorkApps, app) >= 0) return false;
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      string cls = sb.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Windows.UI.Core.CoreWindow") return false;
      if (IsZoomed(h)) return false;                            // a maximized window is not fullscreen
      RECT r;
      if (!GetWindowRect(h, out r)) return false;
      var mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
    }
    public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
    public static void BroadcastTheme() {
      UIntPtr r;
      SendMessageTimeout((IntPtr)0xffff, 0x1A, UIntPtr.Zero, "ImmersiveColorSet", 2, 200, out r);
    }
  }

  // ======================================================================= memory
  public static class Mem {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();

    // Give unused pages back to Windows (they come back on demand). Only our own processes are passed in.
    public static int Trim(int[] pids) {
      int n = 0;
      if (pids != null) {
        foreach (int pid in pids) {
          IntPtr h = OpenProcess(0x0100 | 0x0400, false, pid); // SET_QUOTA | QUERY_INFORMATION
          if (h == IntPtr.Zero) continue;
          if (EmptyWorkingSet(h)) n++;
          CloseHandle(h);
        }
      }
      TrimSelf();
      return n;
    }
    public static void TrimSelf() {
      GC.Collect();
      GC.WaitForPendingFinalizers();
      EmptyWorkingSet(GetCurrentProcess());
    }
  }

  // ======================================================================= WinRT via reflection
  // No SDK or .winmd references needed: types are resolved at runtime exactly like PowerShell does.
  public static class WinRT {
    static MethodInfo asTaskGeneric;
    static Assembly wrt;
    public static readonly bool Ok;

    static WinRT() {
      try {
        wrt = Assembly.Load("System.Runtime.WindowsRuntime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089");
        Type ext = wrt.GetType("System.WindowsRuntimeSystemExtensions");
        foreach (MethodInfo m in ext.GetMethods()) {
          ParameterInfo[] ps = m.GetParameters();
          if (m.Name == "AsTask" && ps.Length == 1 && ps[0].ParameterType.Name == "IAsyncOperation`1") { asTaskGeneric = m; break; }
        }
        Ok = asTaskGeneric != null;
      } catch { Ok = false; }
    }

    public static Type T(string fullName, string winmd) {
      try { return Type.GetType(fullName + ", " + winmd + ", ContentType=WindowsRuntime", false); } catch { return null; }
    }

    public static object Await(object op, Type resultType) {
      Task task = (Task)asTaskGeneric.MakeGenericMethod(resultType).Invoke(null, new object[] { op });
      if (!task.Wait(5000)) throw new TimeoutException("Windows did not answer in time");
      return task.GetType().GetProperty("Result").GetValue(task, null);
    }

    public static Stream AsStream(object inputStream) {
      Type ext = wrt.GetType("System.IO.WindowsRuntimeStreamExtensions");
      foreach (MethodInfo m in ext.GetMethods()) {
        if (m.Name == "AsStreamForRead" && m.GetParameters().Length == 1) return (Stream)m.Invoke(null, new object[] { inputStream });
      }
      throw new MissingMethodException("AsStreamForRead");
    }

    static MethodInfo FindMethod(Type t, string name, int n) {
      foreach (MethodInfo m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance))
        if (m.Name == name && m.GetParameters().Length == n) return m;
      foreach (Type i in t.GetInterfaces())
        foreach (MethodInfo m in i.GetMethods())
          if (m.Name == name && m.GetParameters().Length == n) return m;
      throw new MissingMethodException(t.FullName, name);
    }
    public static object Call(object o, string name, params object[] args) {
      return FindMethod(o.GetType(), name, args.Length).Invoke(o, args);
    }
    public static object Prop(object o, string name) {
      Type t = o.GetType();
      PropertyInfo p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
      if (p == null) foreach (Type i in t.GetInterfaces()) { p = i.GetProperty(name); if (p != null) break; }
      if (p == null) throw new MissingMemberException(t.FullName, name);
      return p.GetValue(o, null);
    }
    public static object StaticCall(Type t, string name) {
      return t.GetMethod(name, BindingFlags.Public | BindingFlags.Static, null, Type.EmptyTypes, null).Invoke(null, null);
    }
  }

  // ======================================================================= media (SMTC)
  public static class Media {
    static readonly Type tMgr = WinRT.T("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager", "Windows.Media.Control");
    static readonly Type tProps = WinRT.T("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties", "Windows.Media.Control");
    static readonly Type tStream = WinRT.T("Windows.Storage.Streams.IRandomAccessStreamWithContentType", "Windows.Storage.Streams");
    static object mgr;

    public static bool Available { get { return WinRT.Ok && tMgr != null && tProps != null; } }

    static object Session() {
      if (!Available) return null;
      if (mgr == null) mgr = WinRT.Await(WinRT.StaticCall(tMgr, "RequestAsync"), tMgr);
      return WinRT.Call(mgr, "GetCurrentSession");
    }

    public static Dictionary<string, object> Get() {
      var d = new Dictionary<string, object>();
      object s = Session();
      if (s == null) { d["active"] = false; return d; }
      object p = WinRT.Await(WinRT.Call(s, "TryGetMediaPropertiesAsync"), tProps);
      object info = WinRT.Call(s, "GetPlaybackInfo");
      object tl = WinRT.Call(s, "GetTimelineProperties");
      bool playing = WinRT.Prop(info, "PlaybackStatus").ToString() == "Playing";
      double dur = ((TimeSpan)WinRT.Prop(tl, "EndTime")).TotalSeconds;
      double pos = ((TimeSpan)WinRT.Prop(tl, "Position")).TotalSeconds;
      if (playing && dur > 0) {
        pos += (DateTimeOffset.Now - (DateTimeOffset)WinRT.Prop(tl, "LastUpdatedTime")).TotalSeconds;
        if (pos > dur) pos = dur;
      }
      d["active"] = true;
      d["title"] = Str(WinRT.Prop(p, "Title"));
      d["artist"] = Str(WinRT.Prop(p, "Artist"));
      d["album"] = Str(WinRT.Prop(p, "AlbumTitle"));
      d["app"] = Str(WinRT.Prop(s, "SourceAppUserModelId"));
      d["playing"] = playing;
      d["position"] = Math.Round(pos, 1);
      d["duration"] = Math.Round(dur, 1);
      d["hasThumb"] = WinRT.Prop(p, "Thumbnail") != null;
      return d;
    }

    public static string Thumb() {
      object s = Session();
      if (s == null) return null;
      object p = WinRT.Await(WinRT.Call(s, "TryGetMediaPropertiesAsync"), tProps);
      object thumbRef = WinRT.Prop(p, "Thumbnail");
      if (thumbRef == null || tStream == null) return null;
      // call through the declared interface types: the runtime object may not expose its class
      Type refType = tProps.GetProperty("Thumbnail").PropertyType;           // IRandomAccessStreamReference
      object st = WinRT.Await(refType.GetMethod("OpenReadAsync").Invoke(thumbRef, null), tStream);
      string type = "image/png";
      try {
        PropertyInfo ctp = tStream.GetProperty("ContentType");
        if (ctp == null) foreach (Type i in tStream.GetInterfaces()) { ctp = i.GetProperty("ContentType"); if (ctp != null) break; }
        string ct = Str(ctp.GetValue(st, null));
        if (Regex.IsMatch(ct, "^image/[a-z0-9.+-]+$")) type = ct;
      } catch { }
      using (Stream net = WinRT.AsStream(st))
      using (var ms = new MemoryStream()) {
        net.CopyTo(ms);
        if (ms.Length > 4 * 1024 * 1024) return null; // ignore absurdly large artwork
        return "data:" + type + ";base64," + Convert.ToBase64String(ms.ToArray());
      }
    }

    public static void Action(string a) {
      object s = null;
      try { s = Session(); } catch { }
      if (s != null) {
        string m = a == "toggle" ? "TryTogglePlayPauseAsync" : a == "next" ? "TrySkipNextAsync" : "TrySkipPreviousAsync";
        WinRT.Await(WinRT.Call(s, m), typeof(bool));
        return;
      }
      Native.Key((byte)(a == "toggle" ? 0xB3 : a == "next" ? 0xB0 : 0xB1));
    }

    static string Str(object o) { return o == null ? "" : o.ToString(); }
  }

  // ======================================================================= radios
  public static class Radios {
    static readonly Type tRadio = WinRT.T("Windows.Devices.Radios.Radio", "Windows.System.Devices");
    static readonly Type tAccess = WinRT.T("Windows.Devices.Radios.RadioAccessStatus", "Windows.System.Devices");
    static readonly Type tState = WinRT.T("Windows.Devices.Radios.RadioState", "Windows.System.Devices");
    static bool asked;

    static List<object> All() {
      var list = new List<object>();
      if (!WinRT.Ok || tRadio == null) return list;
      if (!asked) { asked = true; WinRT.Await(WinRT.StaticCall(tRadio, "RequestAccessAsync"), tAccess); }
      Type listType = typeof(IReadOnlyList<>).MakeGenericType(tRadio);
      var radios = (IEnumerable)WinRT.Await(WinRT.StaticCall(tRadio, "GetRadiosAsync"), listType);
      foreach (object r in radios) list.Add(r);
      return list;
    }
    static object Find(List<object> all, string kind) {
      foreach (object r in all) if (WinRT.Prop(r, "Kind").ToString() == kind) return r;
      return null;
    }
    public static Dictionary<string, object> State() {
      var d = new Dictionary<string, object>();
      List<object> all = All();
      object w = Find(all, "WiFi"), b = Find(all, "Bluetooth");
      d["wifi"] = w == null ? null : WinRT.Prop(w, "State").ToString();
      d["bluetooth"] = b == null ? null : WinRT.Prop(b, "State").ToString();
      return d;
    }
    public static void Set(string kind, string state) {
      if ((kind != "WiFi" && kind != "Bluetooth") || (state != "On" && state != "Off")) throw new ArgumentException("Invalid radio request");
      object r = Find(All(), kind);
      if (r == null) throw new Exception("No " + kind + " radio found");
      object res = WinRT.Await(WinRT.Call(r, "SetStateAsync", Enum.Parse(tState, state)), tAccess);
      if (res.ToString() != "Allowed") throw new Exception("Windows refused (" + res + ")");
    }
  }

  // ======================================================================= notifications (reads the toast pop-up)
  public static class Toasts {
    static readonly Dictionary<string, DateTime> seen = new Dictionary<string, DateTime>();
    static bool primed;

    public static List<Dictionary<string, object>> New() {
      var res = new List<Dictionary<string, object>>();
      try { Scan(res); } catch { }
      var old = seen.Where(kv => (DateTime.Now - kv.Value).TotalMinutes > 30).Select(kv => kv.Key).ToList();
      foreach (string k in old) seen.Remove(k);
      if (!primed) { primed = true; res.Clear(); }   // don't replay what was already on screen
      return res.Take(3).ToList();
    }

    static void Scan(List<Dictionary<string, object>> res) {
      AutomationElementCollection wins = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
      var textCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text);
      foreach (AutomationElement w in wins) {
        string name, cls;
        try { name = w.Current.Name ?? ""; cls = w.Current.ClassName ?? ""; } catch { continue; }
        bool toast = name.StartsWith("New notification") ||
          (cls == "Windows.UI.Core.CoreWindow" && name.IndexOf("notification", StringComparison.OrdinalIgnoreCase) >= 0 &&
           !Regex.IsMatch(name, "cent(er|re)", RegexOptions.IgnoreCase));
        if (!toast) continue;
        var texts = new List<string>();
        foreach (AutomationElement e in w.FindAll(TreeScope.Descendants, textCond)) {
          try { string t = (e.Current.Name ?? "").Trim(); if (t.Length > 0) texts.Add(t); } catch { }
        }
        if (texts.Count == 0) continue;
        string key = string.Join("|", texts);
        if (seen.ContainsKey(key)) continue;
        seen[key] = DateTime.Now;
        var n = new Dictionary<string, object>();
        if (texts.Count >= 3) { n["app"] = texts[0]; n["title"] = texts[1]; n["body"] = string.Join(" ", texts.Skip(2)); }
        else if (texts.Count == 2) { n["app"] = ""; n["title"] = texts[0]; n["body"] = texts[1]; }
        else { n["app"] = ""; n["title"] = texts[0]; n["body"] = ""; }
        res.Add(n);
      }
    }
  }

  // ======================================================================= mic / camera, wifi, brightness, theme
  public static class Sys {
    const string Consent = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";

    public static string Label(string key) {
      string n;
      if (key.Contains("#")) n = Regex.Replace(key.Split('#').Last(), @"\.exe$", "", RegexOptions.IgnoreCase);
      else n = key.Split('_')[0].Split('.').Last();
      if (n.Length == 0) return "An app";
      return n.Substring(0, 1).ToUpper() + n.Substring(1);
    }

    // (keyName, RegistryKey) for every app under ConsentStore\<cap>, user + machine
    static IEnumerable<KeyValuePair<string, RegistryKey>> Keys(string cap) {
      foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine }) {
        RegistryKey root = null;
        try { root = hive.OpenSubKey(Consent + cap); } catch { }
        if (root == null) continue;
        using (root) {
          foreach (string sub in root.GetSubKeyNames()) {
            if (sub == "NonPackaged") {
              using (RegistryKey np = root.OpenSubKey(sub)) {
                if (np == null) continue;
                foreach (string s2 in np.GetSubKeyNames()) {
                  RegistryKey k = np.OpenSubKey(s2);
                  if (k != null) yield return new KeyValuePair<string, RegistryKey>(s2, k);
                }
              }
            } else {
              RegistryKey k = root.OpenSubKey(sub);
              if (k != null) yield return new KeyValuePair<string, RegistryKey>(sub, k);
            }
          }
        }
      }
    }

    static long Long(object v) { try { return v == null ? 0 : Convert.ToInt64(v); } catch { return 0; } }

    public static List<string> InUse(string cap) {
      var apps = new List<string>();
      foreach (var kv in Keys(cap)) {
        using (kv.Value) {
          long start = Long(kv.Value.GetValue("LastUsedTimeStart"));
          object stopRaw = kv.Value.GetValue("LastUsedTimeStop");
          if (start <= 0 || (stopRaw != null && Long(stopRaw) != 0)) continue;
          if (kv.Key.Contains("#")) {
            string exe = Regex.Replace(kv.Key.Split('#').Last(), @"\.exe$", "", RegexOptions.IgnoreCase);
            Process[] ps = Process.GetProcessesByName(exe);
            bool running = ps.Length > 0;
            foreach (Process p in ps) p.Dispose();
            if (!running) continue;   // stale entry from an app that already closed
          }
          string label = Label(kv.Key);
          if (!apps.Contains(label)) apps.Add(label);
        }
      }
      return apps;
    }

    public static List<string> MicApps() {
      var apps = new List<string>();
      try { apps.AddRange(Audio.MicApps()); } catch { }
      try { foreach (string a in InUse("microphone")) if (!apps.Contains(a)) apps.Add(a); } catch { }
      return apps;
    }

    public static Dictionary<string, object> Diag() {
      var rows = new List<object>();
      foreach (string cap in new[] { "microphone", "webcam" }) {
        foreach (var kv in Keys(cap)) {
          using (kv.Value) {
            long start = Long(kv.Value.GetValue("LastUsedTimeStart"));
            if (start <= 0) continue;
            object stop = kv.Value.GetValue("LastUsedTimeStop");
            var r = new Dictionary<string, object>();
            r["cap"] = cap; r["app"] = Label(kv.Key);
            r["lastStart"] = DateTime.FromFileTime(start).ToString("yyyy-MM-dd HH:mm:ss");
            r["inUseNow"] = stop == null || Long(stop) == 0;
            rows.Add(r);
          }
        }
      }
      var d = new Dictionary<string, object>();
      d["engine"] = "native";
      d["time"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
      d["foreground"] = Native.ForegroundApp();
      d["fullscreen"] = Native.Fullscreen();
      d["userState"] = Native.UserState();
      d["micNow"] = MicApps();
      d["camNow"] = InUse("webcam");
      d["micSessions"] = Audio.MicDebug();
      d["registry"] = rows;
      d["os"] = Environment.OSVersion.VersionString;
      d["memoryMB"] = Math.Round(Process.GetCurrentProcess().WorkingSet64 / 1048576.0, 1);
      return d;
    }

    public static Dictionary<string, object> Wifi() {
      var d = new Dictionary<string, object>();
      d["ssid"] = null; d["signal"] = null;
      try {
        var psi = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "netsh.exe"), "wlan show interfaces");
        psi.UseShellExecute = false; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.CreateNoWindow = true;
        using (Process p = Process.Start(psi)) {
          string outp = p.StandardOutput.ReadToEnd();
          p.WaitForExit(3000);
          Match m = Regex.Match(outp, @"^\s*SSID\s*:\s*(.+)$", RegexOptions.Multiline);
          if (m.Success) d["ssid"] = m.Groups[1].Value.Trim();
          m = Regex.Match(outp, @"^\s*Signal\s*:\s*(\d+)\s*%", RegexOptions.Multiline);
          if (m.Success) d["signal"] = int.Parse(m.Groups[1].Value);
        }
      } catch { }
      return d;
    }

    public static Dictionary<string, object> Brightness() {
      var d = new Dictionary<string, object>();
      d["supported"] = false;
      try {
        using (var q = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness"))
        using (ManagementObjectCollection res = q.Get()) {
          foreach (ManagementObject o in res) {
            using (o) { d["supported"] = true; d["value"] = Convert.ToInt32(o["CurrentBrightness"]); }
            break;
          }
        }
      } catch { d["supported"] = false; }
      return d;
    }
    public static void SetBrightness(int v) {
      v = Math.Max(0, Math.Min(100, v));
      using (var q = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
      using (ManagementObjectCollection res = q.Get()) {
        foreach (ManagementObject o in res) {
          using (o) o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)v });
          return;
        }
      }
      throw new Exception("Brightness control not available");
    }

    const string ThemeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    public static bool Dark() {
      try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(ThemeKey)) return k != null && Long(k.GetValue("AppsUseLightTheme")) == 0; }
      catch { return false; }
    }
    public static void SetDark(bool dark) {
      using (RegistryKey k = Registry.CurrentUser.OpenSubKey(ThemeKey, true)) {
        if (k == null) throw new Exception("Theme settings not found");
        k.SetValue("AppsUseLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
        k.SetValue("SystemUsesLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
      }
      Native.BroadcastTheme();
    }
  }

  // ======================================================================= main loop
  public static class Program {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 16 };
    static StreamWriter Out;
    static int calls;

    [STAThread]
    public static int Main(string[] args) {
      Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
      Out.AutoFlush = true;
      var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

      var hello = new Dictionary<string, object>();
      hello["ready"] = true; hello["engine"] = "native"; hello["media"] = Media.Available; hello["radios"] = WinRT.Ok; hello["notifs"] = "uia";
      Reply(0, true, hello, null);
      Mem.TrimSelf();

      string line;
      while ((line = input.ReadLine()) != null) {
        if (line.Length == 0) continue;
        if (line.Length > 65536) { Reply(-1, false, null, "Request too large"); continue; }
        object id = -1;
        try {
          var req = Json.Deserialize<Dictionary<string, object>>(line);
          if (req.ContainsKey("id")) id = req["id"];
          string cmd = req.ContainsKey("cmd") ? req["cmd"] as string : null;
          object arg = req.ContainsKey("arg") ? req["arg"] : null;
          Reply(id, true, Run(cmd, arg), null);
        } catch (Exception e) {
          Exception inner = e is TargetInvocationException && e.InnerException != null ? e.InnerException : e;
          Reply(id, false, null, inner.Message);
        }
        // keep the helper small: collect + give pages back every ~2 minutes of polling
        if (++calls % 150 == 0) Mem.TrimSelf();
      }
      return 0;
    }

    static void Reply(object id, bool ok, object data, string err) {
      var o = new Dictionary<string, object>();
      o["id"] = id; o["ok"] = ok; o["data"] = data; o["error"] = err;
      Out.WriteLine(Json.Serialize(o));
    }

    static double Num(object a) { return Convert.ToDouble(a, System.Globalization.CultureInfo.InvariantCulture); }
    static bool Bool(object a) { return a is bool && (bool)a; }

    static object Run(string cmd, object arg) {
      switch (cmd) {
        case "ping": return "pong";
        case "fast": {
          var d = new Dictionary<string, object>();
          d["volume"] = (int)Math.Round(Audio.GetVolume(0) * 100);
          d["muted"] = Audio.GetMute(0);
          object mic = null;
          try { mic = Audio.GetMute(1); } catch { }
          d["mic"] = mic;
          Dictionary<string, object> media;
          try { media = Media.Get(); } catch { media = new Dictionary<string, object>(); media["active"] = false; }
          d["media"] = media;
          d["fullscreen"] = Native.Fullscreen();
          d["notifs"] = Toasts.New();
          d["micApps"] = Sys.MicApps();
          List<string> cam;
          try { cam = Sys.InUse("webcam"); } catch { cam = new List<string>(); }
          d["camApps"] = cam;
          return d;
        }
        case "slow": {
          var d = new Dictionary<string, object>();
          Dictionary<string, object> radios;
          try { radios = Radios.State(); } catch { radios = new Dictionary<string, object>(); radios["wifi"] = null; radios["bluetooth"] = null; }
          d["radios"] = radios;
          d["wifi"] = (radios["wifi"] as string) == "On" ? Sys.Wifi() : new Dictionary<string, object> { { "ssid", null }, { "signal", null } };
          d["brightness"] = Sys.Brightness();
          d["dark"] = Sys.Dark();
          return d;
        }
        case "setVolume": {
          double v = Math.Max(0, Math.Min(100, Num(arg)));
          Audio.SetVolume(0, (float)(v / 100));
          if (v > 0) Audio.SetMute(0, false);
          return null;
        }
        case "setMute": Audio.SetMute(0, Bool(arg)); return null;
        case "setMic": Audio.SetMute(1, Bool(arg)); return null;
        case "setBrightness": Sys.SetBrightness((int)Num(arg)); return null;
        case "media": {
          string a = arg as string;
          if (a != "toggle" && a != "next" && a != "prev") throw new ArgumentException("Invalid media action");
          Media.Action(a); return null;
        }
        case "thumb": return Media.Thumb();
        case "setRadio": {
          var o = arg as Dictionary<string, object>;
          if (o == null || !o.ContainsKey("kind") || !o.ContainsKey("state")) throw new ArgumentException("Invalid radio request");
          Radios.Set(o["kind"] as string, o["state"] as string); return null;
        }
        case "setDark": Sys.SetDark(Bool(arg)); return null;
        case "lock":
          Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "rundll32.exe"), "user32.dll,LockWorkStation") { UseShellExecute = false }).Dispose();
          return null;
        case "snip": { Process p = Process.Start("ms-screenclip:"); if (p != null) p.Dispose(); return null; }
        case "open": {
          string uri = arg as string;
          if (uri == null || !Regex.IsMatch(uri, "^ms-settings:[a-z0-9-]{0,64}$")) throw new ArgumentException("Blocked URI");
          Process p = Process.Start(uri); if (p != null) p.Dispose(); return null;
        }
        case "diag": return Sys.Diag();
        case "trim": {
          var list = new List<int>();
          var arr = arg as object[];
          if (arr == null && arg is ArrayList) arr = ((ArrayList)arg).ToArray();
          if (arr != null) foreach (object x in arr.Take(64)) list.Add((int)Num(x));
          return Mem.Trim(list.ToArray());
        }
        default: throw new ArgumentException("Unknown command: " + cmd);
      }
    }
  }
}

// Nothing Island - device pickers (Wi-Fi networks, audio outputs, Bluetooth devices).
// Self-contained so both engines can use it: the native engine compiles it together with bridge.cs,
// and the PowerShell fallback loads it with Add-Type -Path. C# 5 syntax only (Windows' built-in csc).
// Wi-Fi uses the Native Wifi API (wlanapi.dll) instead of parsing netsh text, so it works on any
// Windows display language.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading.Tasks;

namespace NI.Dev {
  // ------------------------------------------------------------------ Core Audio interop
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceX {
    [PreserveSig] int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStoreX store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollectionX {
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int Item(uint i, out IMMDeviceX d);
  }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumeratorX {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollectionX devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDeviceX endpoint);
  }
  [StructLayout(LayoutKind.Sequential)] struct PropKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Sequential)] struct PropVar { public ushort vt, r1, r2, r3; public IntPtr a, b; }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStoreX {
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int GetAt(uint i, out PropKey k);
    [PreserveSig] int GetValue(ref PropKey k, out PropVar v);
  }
  // Undocumented but stable since Windows 7: the interface the Sound control panel uses to change the default device.
  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfigX {
    [PreserveSig] int p1(); [PreserveSig] int p2(); [PreserveSig] int p3(); [PreserveSig] int p4(); [PreserveSig] int p5();
    [PreserveSig] int p6(); [PreserveSig] int p7(); [PreserveSig] int p8(); [PreserveSig] int p9(); [PreserveSig] int p10();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMEnumeratorCo { }
  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigCo { }

  public static class Outputs {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVar v);
    static readonly Guid NameFmt = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");

    static string Prop(IMMDeviceX d, int pid) {
      IPropertyStoreX st;
      if (d.OpenPropertyStore(0, out st) != 0 || st == null) return null;
      var k = new PropKey(); k.fmtid = NameFmt; k.pid = pid;
      PropVar v;
      if (st.GetValue(ref k, out v) != 0) return null;
      try { return v.vt == 31 ? Marshal.PtrToStringUni(v.a) : null; }   // VT_LPWSTR
      finally { PropVariantClear(ref v); }
    }

    // Active speakers / headphones. flow 0 = render.
    public static Dictionary<string, object> List() {
      var en = new MMEnumeratorCo() as IMMDeviceEnumeratorX;
      string def = null;
      IMMDeviceX dd;
      if (en.GetDefaultAudioEndpoint(0, 1, out dd) == 0 && dd != null) dd.GetId(out def);
      var items = new List<object>();
      IMMDeviceCollectionX col;
      if (en.EnumAudioEndpoints(0, 1, out col) == 0 && col != null) {
        uint n; col.GetCount(out n);
        for (uint i = 0; i < n && i < 32; i++) {
          IMMDeviceX d;
          if (col.Item(i, out d) != 0 || d == null) continue;
          string id; if (d.GetId(out id) != 0 || id == null) continue;
          var o = new Dictionary<string, object>();
          o["id"] = id;
          o["name"] = Prop(d, 14) ?? Prop(d, 2) ?? "Audio device";   // 14 = FriendlyName, 2 = DeviceDesc
          o["active"] = id == def;
          items.Add(o);
        }
      }
      var r = new Dictionary<string, object>();
      r["current"] = def; r["devices"] = items;
      return r;
    }

    public static void Set(string id) {
      if (id == null || id.Length > 200 || !id.StartsWith("{0.0.0.00000000}.{", StringComparison.Ordinal))
        throw new ArgumentException("Invalid audio device");
      // only accept an id we just enumerated (never an arbitrary string from the UI)
      bool found = false;
      foreach (object o in (List<object>)List()["devices"]) if ((string)((Dictionary<string, object>)o)["id"] == id) found = true;
      if (!found) throw new ArgumentException("That output is no longer available");
      var pc = new PolicyConfigCo() as IPolicyConfigX;
      if (pc == null) throw new NotSupportedException("Windows did not allow switching the output");
      for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, role));
    }
  }

  // ------------------------------------------------------------------ Wi-Fi (Native Wifi API)
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct WlanConnParams {
    public int mode;                                   // 0 = connect using a stored profile
    [MarshalAs(UnmanagedType.LPWStr)] public string profile;
    public IntPtr ssid, bssids;
    public int bssType;                                // 1 = infrastructure
    public uint flags;
  }

  public static class Wifi {
    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint ver, IntPtr r, out uint neg, out IntPtr h);
    [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr h, IntPtr r);
    [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr r);
    [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid iface, uint flags, IntPtr r, out IntPtr list);
    [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr h, ref Guid iface, ref WlanConnParams p, IntPtr r);
    [DllImport("wlanapi.dll")] static extern int WlanDisconnect(IntPtr h, ref Guid iface, IntPtr r);
    [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)]
    static extern int WlanSetProfile(IntPtr h, ref Guid iface, uint flags, string xml, string sd, bool overwrite, IntPtr r, out uint reason);
    [DllImport("wlanapi.dll", CharSet = CharSet.Unicode)]
    static extern int WlanDeleteProfile(IntPtr h, ref Guid iface, string name, IntPtr r);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);

    const int NETWORK_SIZE = 628;   // WLAN_AVAILABLE_NETWORK

    static IntPtr Open() {
      uint neg; IntPtr h;
      int e = WlanOpenHandle(2, IntPtr.Zero, out neg, out h);
      if (e != 0) throw new Exception(e == 1062 ? "The WLAN service isn't running" : "Wi-Fi is unavailable (" + e + ")");
      return h;
    }

    // first wireless adapter
    static Guid Iface(IntPtr h) {
      IntPtr list;
      int e = WlanEnumInterfaces(h, IntPtr.Zero, out list);
      if (e != 0) throw new Exception("No Wi-Fi adapter (" + e + ")");
      try {
        if (Marshal.ReadInt32(list) < 1) throw new Exception("No Wi-Fi adapter");
        byte[] g = new byte[16];
        Marshal.Copy(new IntPtr(list.ToInt64() + 8), g, 0, 16);
        return new Guid(g);
      } finally { WlanFreeMemory(list); }
    }

    static string Fail(int e) {
      if (e == 5) return "location";    // Windows 11 24H2+: Wi-Fi scanning needs location access
      return "Wi-Fi error " + e;
    }

    public static void Scan() {
      IntPtr h = Open();
      try { Guid g = Iface(h); WlanScan(h, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
      finally { WlanCloseHandle(h, IntPtr.Zero); }
    }

    static string Security(int auth, bool secured) {
      if (!secured) return "open";
      switch (auth) {
        case 7: return "wpa2";      // WPA2-Personal
        case 9: return "wpa3";      // WPA3-Personal (SAE)
        case 4: return "wpa";       // WPA-Personal
        case 10: return "owe";      // Enhanced Open
        case 6: case 8: case 11: case 3: return "enterprise";
        default: return "other";
      }
    }

    public static Dictionary<string, object> List() {
      IntPtr h = Open();
      try {
        Guid g = Iface(h);
        IntPtr list;
        int e = WlanGetAvailableNetworkList(h, ref g, 0, IntPtr.Zero, out list);
        if (e != 0) throw new Exception(Fail(e));
        var by = new Dictionary<string, Dictionary<string, object>>();
        string current = null;
        try {
          int n = Marshal.ReadInt32(list);
          for (int i = 0; i < n && i < 256; i++) {
            long b = list.ToInt64() + 8 + (long)i * NETWORK_SIZE;
            string profile = Marshal.PtrToStringUni(new IntPtr(b));
            int len = Marshal.ReadInt32(new IntPtr(b + 512));
            if (len <= 0 || len > 32) continue;                 // hidden network
            byte[] raw = new byte[len];
            Marshal.Copy(new IntPtr(b + 516), raw, 0, len);
            string ssid;
            try { ssid = new UTF8Encoding(false, true).GetString(raw); } catch { continue; }
            if (ssid.IndexOf('\0') >= 0) continue;
            if (Marshal.ReadInt32(new IntPtr(b + 548)) != 1) continue;   // infrastructure only
            int signal = Marshal.ReadInt32(new IntPtr(b + 604));
            bool secured = Marshal.ReadInt32(new IntPtr(b + 608)) != 0;
            int auth = Marshal.ReadInt32(new IntPtr(b + 612));
            int flags = Marshal.ReadInt32(new IntPtr(b + 620));
            bool connected = (flags & 1) != 0, known = (flags & 2) != 0;
            Dictionary<string, object> o;
            if (!by.TryGetValue(ssid, out o)) {
              o = new Dictionary<string, object>();
              o["ssid"] = ssid; o["signal"] = signal; o["security"] = Security(auth, secured);
              o["known"] = false; o["profile"] = null; o["connected"] = false;
              by[ssid] = o;
            }
            if (signal > (int)o["signal"]) o["signal"] = signal;
            if (known && profile.Length > 0) { o["known"] = true; o["profile"] = profile; }
            if (connected) { o["connected"] = true; current = ssid; }
          }
        } finally { WlanFreeMemory(list); }
        var items = new List<Dictionary<string, object>>(by.Values);
        items.Sort(delegate(Dictionary<string, object> x, Dictionary<string, object> y) {
          int c = ((bool)y["connected"]).CompareTo((bool)x["connected"]);
          if (c != 0) return c;
          c = ((bool)y["known"]).CompareTo((bool)x["known"]);
          return c != 0 ? c : ((int)y["signal"]).CompareTo((int)x["signal"]);
        });
        if (items.Count > 40) items.RemoveRange(40, items.Count - 40);
        var r = new Dictionary<string, object>();
        r["current"] = current;
        r["networks"] = items;
        return r;
      } finally { WlanCloseHandle(h, IntPtr.Zero); }
    }

    static string Xml(string s) { return SecurityElement.Escape(s); }

    static string Hex(string s) {
      var sb = new StringBuilder();
      foreach (byte x in Encoding.UTF8.GetBytes(s)) sb.Append(x.ToString("X2"));
      return sb.ToString();
    }

    static void CheckSsid(string ssid) {
      if (ssid == null || ssid.Length == 0 || Encoding.UTF8.GetByteCount(ssid) > 32) throw new ArgumentException("Invalid network name");
      foreach (char c in ssid) if (c < 0x20 || c == 0x7f) throw new ArgumentException("Invalid network name");
    }

    // Connects to a network from the current scan list: saved networks by their profile, new ones by
    // writing a profile first. Only networks that are actually in range are accepted.
    public static string Connect(string ssid, string password) {
      CheckSsid(ssid);
      Dictionary<string, object> net = null;
      foreach (Dictionary<string, object> o in (List<Dictionary<string, object>>)List()["networks"])
        if ((string)o["ssid"] == ssid) net = o;
      if (net == null) throw new ArgumentException("That network is out of range");
      string sec = (string)net["security"];
      IntPtr h = Open();
      try {
        Guid g = Iface(h);
        string profile = net["profile"] as string;
        if (profile == null || password != null) {
          string auth, enc, key = "";
          if (sec == "open") { auth = "open"; enc = "none"; }
          else if (sec == "owe") { auth = "OWE"; enc = "GCMP256"; }
          else if (sec == "wpa2" || sec == "wpa3" || sec == "wpa") {
            if (password == null) return "password";
            bool hex = password.Length == 64 && IsHex(password);
            if (!hex && (password.Length < 8 || password.Length > 63)) throw new ArgumentException("Wi-Fi passwords are 8 to 63 characters");
            foreach (char c in password) if (c < 0x20 || c > 0x7e) throw new ArgumentException("The password has characters Wi-Fi doesn't allow");
            auth = sec == "wpa3" ? "WPA3SAE" : sec == "wpa" ? "WPAPSK" : "WPA2PSK"; enc = "AES";
            key = "<sharedKey><keyType>" + (hex ? "networkKey" : "passPhrase") + "</keyType><protected>false</protected><keyMaterial>"
                + Xml(password) + "</keyMaterial></sharedKey>";
          } else throw new NotSupportedException("enterprise");
          string xml = "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">"
            + "<name>" + Xml(ssid) + "</name><SSIDConfig><SSID><hex>" + Hex(ssid) + "</hex><name>" + Xml(ssid) + "</name></SSID></SSIDConfig>"
            + "<connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption>"
            + "<authentication>" + auth + "</authentication><encryption>" + enc + "</encryption><useOneX>false</useOneX>"
            + "</authEncryption>" + key + "</security></MSM></WLANProfile>";
          uint reason;
          // the key is handed to Windows directly (never written to disk); Windows encrypts it in the profile store
          int e = WlanSetProfile(h, ref g, 0, xml, null, true, IntPtr.Zero, out reason);
          if (e == 5) e = WlanSetProfile(h, ref g, 2, xml, null, true, IntPtr.Zero, out reason);   // per-user profile
          if (e != 0) throw new Exception("Windows rejected the network settings (" + e + ")");
          profile = ssid;
        }
        var p = new WlanConnParams();
        p.mode = 0; p.profile = profile; p.bssType = 1;
        int ce = WlanConnect(h, ref g, ref p, IntPtr.Zero);
        if (ce != 0) throw new Exception("Couldn't connect (" + ce + ")");
        return "connecting";
      } finally { WlanCloseHandle(h, IntPtr.Zero); }
    }

    public static void Forget(string ssid) {
      CheckSsid(ssid);
      IntPtr h = Open();
      try {
        Guid g = Iface(h);
        int e = WlanDeleteProfile(h, ref g, ssid, IntPtr.Zero);
        if (e != 0 && e != 1168) throw new Exception("Couldn't forget the network (" + e + ")");
      } finally { WlanCloseHandle(h, IntPtr.Zero); }
    }

    public static void Disconnect() {
      IntPtr h = Open();
      try { Guid g = Iface(h); WlanDisconnect(h, ref g, IntPtr.Zero); }
      finally { WlanCloseHandle(h, IntPtr.Zero); }
    }

    static bool IsHex(string s) {
      foreach (char c in s) if (!Uri.IsHexDigit(c)) return false;
      return true;
    }
  }

  // ------------------------------------------------------------------ Bluetooth (paired devices)
  public static class Bluetooth {
    static MethodInfo asTask;
    static Type tInfo, tColl, tKind;

    static bool Init() {
      if (tInfo != null) return true;
      try {
        Assembly wrt = Assembly.Load("System.Runtime.WindowsRuntime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089");
        foreach (MethodInfo m in wrt.GetType("System.WindowsRuntimeSystemExtensions").GetMethods()) {
          ParameterInfo[] ps = m.GetParameters();
          if (m.Name == "AsTask" && ps.Length == 1 && ps[0].ParameterType.Name == "IAsyncOperation`1") { asTask = m; break; }
        }
        tColl = Type.GetType("Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType=WindowsRuntime", false);
        tKind = Type.GetType("Windows.Devices.Enumeration.DeviceInformationKind, Windows.Devices.Enumeration, ContentType=WindowsRuntime", false);
        tInfo = Type.GetType("Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime", false);
      } catch { tInfo = null; }
      return tInfo != null && tColl != null && tKind != null && asTask != null;
    }

    static IEnumerable Find(string aqs) {
      MethodInfo f = null;
      foreach (MethodInfo m in tInfo.GetMethods(BindingFlags.Public | BindingFlags.Static)) {
        ParameterInfo[] ps = m.GetParameters();
        if (m.Name == "FindAllAsync" && ps.Length == 3 && ps[2].ParameterType == tKind) { f = m; break; }
      }
      if (f == null) throw new MissingMethodException("FindAllAsync");
      object op = f.Invoke(null, new object[] { aqs, new string[] { "System.Devices.Aep.IsConnected", "System.Devices.Aep.Category" }, Enum.ToObject(tKind, 5) });
      Task t = (Task)asTask.MakeGenericMethod(tColl).Invoke(null, new object[] { op });
      if (!t.Wait(6000)) throw new TimeoutException("Windows did not answer in time");
      return (IEnumerable)t.GetType().GetProperty("Result").GetValue(t, null);
    }

    static object Get(object o, string name) {
      PropertyInfo p = o.GetType().GetProperty(name);
      if (p == null) foreach (Type i in o.GetType().GetInterfaces()) { p = i.GetProperty(name); if (p != null) break; }
      return p == null ? null : p.GetValue(o, null);
    }

    static object PropValue(object info, string key) {
      var props = Get(info, "Properties") as IEnumerable;
      if (props == null) return null;
      foreach (object kv in props) {
        if ((Get(kv, "Key") as string) == key) return Get(kv, "Value");
      }
      return null;
    }

    static string Kind(string name, object cat) {
      string c = "";
      var arr = cat as IEnumerable;
      if (arr != null && !(cat is string)) foreach (object x in arr) c += " " + x;
      string s = (c + " " + name).ToLowerInvariant();
      if (s.Contains("audio") || s.Contains("headphone") || s.Contains("headset") || s.Contains("speaker") || s.Contains("buds") || s.Contains("earphone") || s.Contains("airpods")) return "audio";
      if (s.Contains("keyboard")) return "keyboard";
      if (s.Contains("mouse") || s.Contains("trackpad")) return "mouse";
      if (s.Contains("phone")) return "phone";
      if (s.Contains("controller") || s.Contains("gamepad")) return "gamepad";
      if (s.Contains("watch") || s.Contains("band")) return "watch";
      return "device";
    }

    public static Dictionary<string, object> List() {
      if (!Init()) throw new NotSupportedException("Bluetooth listing needs Windows 10 or later");
      var seen = new Dictionary<string, Dictionary<string, object>>();
      string[] protocols = { "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}", "{bb7bb05e-5972-42b5-94fc-76eaa7084d49}" };   // classic, LE
      foreach (string proto in protocols) {
        IEnumerable found;
        try {
          found = Find("System.Devices.Aep.ProtocolId:=\"" + proto + "\" AND System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True");
        } catch { continue; }
        foreach (object info in found) {
          string name = (Get(info, "Name") as string ?? "").Trim();
          if (name.Length == 0) continue;
          bool connected = PropValue(info, "System.Devices.Aep.IsConnected") is bool && (bool)PropValue(info, "System.Devices.Aep.IsConnected");
          Dictionary<string, object> o;
          if (seen.TryGetValue(name, out o)) { if (connected) o["connected"] = true; continue; }
          o = new Dictionary<string, object>();
          o["name"] = name.Length > 60 ? name.Substring(0, 60) : name;
          o["connected"] = connected;
          o["kind"] = Kind(name, PropValue(info, "System.Devices.Aep.Category"));
          seen[name] = o;
          if (seen.Count >= 30) break;
        }
      }
      var items = new List<Dictionary<string, object>>(seen.Values);
      items.Sort(delegate(Dictionary<string, object> x, Dictionary<string, object> y) {
        int c = ((bool)y["connected"]).CompareTo((bool)x["connected"]);
        return c != 0 ? c : string.Compare((string)x["name"], (string)y["name"], StringComparison.OrdinalIgnoreCase);
      });
      var r = new Dictionary<string, object>();
      r["devices"] = items;
      return r;
    }
  }
}

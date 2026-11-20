# Nothing Island - system bridge
# A long-running Windows PowerShell 5.1 process. Reads one JSON request per line on stdin:
#   {"id":1,"cmd":"getVolume","arg":null}
# and writes one JSON reply per line on stdout:
#   {"id":1,"ok":true,"data":{...},"error":null}

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding $false

# ---------------------------------------------------------------- native helpers
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

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

}
"@

# ---------------------------------------------------------------- pickers (Wi-Fi / outputs / Bluetooth)
$script:hasDevices = $true
try { Add-Type -Path (Join-Path $PSScriptRoot 'devices.cs') } catch { $script:hasDevices = $false }
function Need-Devices { if (-not $script:hasDevices) { throw 'Device pickers are unavailable' } }

# ---------------------------------------------------------------- WinRT plumbing
$script:winrt = $true
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
} catch { $script:winrt = $false }

function Await($op, [Type]$resultType) {
  $asTask = $script:asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait(5000) | Out-Null
  return $task.Result
}

$script:hasMedia = $false
$script:hasRadios = $false
try {
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
  $script:hasMedia = $script:winrt
} catch {}
try {
  [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  $script:hasRadios = $script:winrt
} catch {}

# ---------------------------------------------------------------- media (SMTC)
$script:mgr = $null
function Get-Session {
  if (-not $script:hasMedia) { return $null }
  if ($null -eq $script:mgr) {
    $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
      ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  return $script:mgr.GetCurrentSession()
}

function Get-Media {
  $s = Get-Session
  if ($null -eq $s) { return @{ active = $false } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $info = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
  $dur = [double]$tl.EndTime.TotalSeconds
  $pos = [double]$tl.Position.TotalSeconds
  if ($playing -and $dur -gt 0) {
    $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
    if ($pos -gt $dur) { $pos = $dur }
  }
  $app = [string]$s.SourceAppUserModelId
  return @{
    active   = $true
    title    = [string]$p.Title
    artist   = [string]$p.Artist
    album    = [string]$p.AlbumTitle
    app      = $app
    playing  = $playing
    position = [math]::Round($pos, 1)
    duration = [math]::Round($dur, 1)
    hasThumb = ($null -ne $p.Thumbnail)
  }
}

function Get-Thumb {
  $s = Get-Session
  if ($null -eq $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($null -eq $p.Thumbnail) { return $null }
  $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $ms = New-Object System.IO.MemoryStream
  $net.CopyTo($ms)
  $net.Dispose()
  $type = [string]$stream.ContentType
  if (-not $type) { $type = 'image/png' }
  return "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
}

function Invoke-MediaAction($action) {
  $s = $null
  try { $s = Get-Session } catch {}
  if ($null -ne $s) {
    switch ($action) {
      'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null; return }
      'next'   { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null; return }
      'prev'   { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null; return }
    }
  }
  # fallback: media keys
  switch ($action) {
    'toggle' { [NI.Native]::Key(0xB3) }
    'next'   { [NI.Native]::Key(0xB0) }
    'prev'   { [NI.Native]::Key(0xB1) }
  }
}

# ---------------------------------------------------------------- radios (Wi-Fi / Bluetooth)
$script:radios = $null
function Get-Radios([bool]$refresh = $false) {
  if (-not $script:hasRadios) { return @() }
  if ($null -eq $script:radios -or $refresh) {
    Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
    $script:radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
      ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  }
  return $script:radios
}

function Get-RadioState {
  $r = Get-Radios $true
  $wifi = $r | Where-Object { $_.Kind.ToString() -eq 'WiFi' } | Select-Object -First 1
  $bt   = $r | Where-Object { $_.Kind.ToString() -eq 'Bluetooth' } | Select-Object -First 1
  return @{
    wifi      = $(if ($wifi) { $wifi.State.ToString() } else { $null })
    bluetooth = $(if ($bt) { $bt.State.ToString() } else { $null })
  }
}

function Set-Radio($kind, $state) {
  if (@('WiFi', 'Bluetooth') -cnotcontains $kind -or @('On', 'Off') -cnotcontains $state) { throw 'Invalid radio request' }
  $r = Get-Radios $false
  $radio = $r | Where-Object { $_.Kind.ToString() -eq $kind } | Select-Object -First 1
  if (-not $radio) { throw "No $kind radio found" }
  $res = Await ($radio.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])
  if ($res.ToString() -ne 'Allowed') { throw "Windows refused ($res)" }
}

function Get-WifiInfo {
  $ssid = $null; $signal = $null
  try {
    $out = & (Join-Path $env:SystemRoot 'System32\netsh.exe') wlan show interfaces 2>$null
    foreach ($line in $out) {
      if (-not $ssid -and $line -match '^\s*SSID\s*:\s*(.+)$') { $ssid = $Matches[1].Trim() }
      if (-not $signal -and $line -match '^\s*Signal\s*:\s*(\d+)\s*%') { $signal = [int]$Matches[1] }
    }
  } catch {}
  if (-not $ssid) {
    try {
      $prof = Get-NetConnectionProfile -ErrorAction Stop |
        Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN|Wireless' } | Select-Object -First 1
      if ($prof) { $ssid = [string]$prof.Name }
    } catch {}
  }
  return @{ ssid = $ssid; signal = $signal }
}

# ---------------------------------------------------------------- notifications
# Preferred: the official UserNotificationListener (works when Windows grants access).
# Fallback: read the toast pop-up itself through UI Automation (no permission needed).
$script:notifMode = 'none'
$script:listener = $null
$script:seen = @{}
$script:primed = $false

function Init-Notifs {
  if ($script:winrt) {
    try {
      [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
      $st = Await ($l.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
      if ($st.ToString() -eq 'Allowed') { $script:listener = $l; $script:notifMode = 'listener'; return }
    } catch {}
  }
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $script:notifMode = 'uia'
  } catch {}
}

function Read-ListenerNotifs {
  $res = @()
  $list = Await ($script:listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) `
    ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
  foreach ($n in $list) {
    $key = 'L' + [string]$n.Id
    if ($script:seen.ContainsKey($key)) { continue }
    $script:seen[$key] = [DateTime]::Now
    $app = ''
    try { $app = [string]$n.AppInfo.DisplayInfo.DisplayName } catch {}
    $texts = @()
    try {
      $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
      if ($b) { $texts = @($b.GetTextElements() | ForEach-Object { [string]$_.Text } | Where-Object { $_ }) }
    } catch {}
    $res += @{ app = $app; title = $(if ($texts.Count -gt 0) { $texts[0] } else { '' }); body = (($texts | Select-Object -Skip 1) -join ' ') }
  }
  return ,$res
}

function Read-UiaNotifs {
  $res = @()
  $AE = [System.Windows.Automation.AutomationElement]
  $scope = [System.Windows.Automation.TreeScope]
  $wins = $AE::RootElement.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    $name = ''; $cls = ''
    try { $name = [string]$w.Current.Name; $cls = [string]$w.Current.ClassName } catch { continue }
    $isToast = ($name -match '^New notification') -or ($cls -eq 'Windows.UI.Core.CoreWindow' -and $name -match 'notification' -and $name -notmatch 'cent(er|re)')
    if (-not $isToast) { continue }
    $textCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
    $els = $w.FindAll($scope::Descendants, $textCond)
    $texts = @()
    foreach ($e in $els) { try { $t = [string]$e.Current.Name; if ($t.Trim()) { $texts += $t.Trim() } } catch {} }
    if ($texts.Count -eq 0) { continue }
    $key = 'U' + ($texts -join '|')
    if ($script:seen.ContainsKey($key)) { continue }
    $script:seen[$key] = [DateTime]::Now
    if ($texts.Count -ge 3) { $res += @{ app = $texts[0]; title = $texts[1]; body = (($texts | Select-Object -Skip 2) -join ' ') } }
    elseif ($texts.Count -eq 2) { $res += @{ app = ''; title = $texts[0]; body = $texts[1] } }
    else { $res += @{ app = ''; title = $texts[0]; body = '' } }
  }
  return ,$res
}

function Get-NewNotifs {
  $res = @()
  try {
    if ($script:notifMode -eq 'listener') { $res = Read-ListenerNotifs }
    elseif ($script:notifMode -eq 'uia') { $res = Read-UiaNotifs }
  } catch { $res = @() }
  # forget old keys
  $old = @($script:seen.Keys | Where-Object { ([DateTime]::Now - $script:seen[$_]).TotalMinutes -gt 30 })
  foreach ($k in $old) { $script:seen.Remove($k) }
  if (-not $script:primed) { $script:primed = $true; return ,@() }   # don't replay what was already on screen
  return ,@($res | Select-Object -First 3)
}

# ---------------------------------------------------------------- mic / camera in use
# Windows records live usage per app under CapabilityAccessManager: LastUsedTimeStop = 0 means "in use now".
function Get-AppLabel([string]$key) {
  if ($key -match '#') { $n = ($key -split '#')[-1] -replace '\.exe$', '' }
  else { $n = (($key -split '_')[0] -split '\.')[-1] }
  if (-not $n) { return 'An app' }
  return ($n.Substring(0, 1).ToUpper() + $n.Substring(1))
}
function Get-InUseKeys([string]$cap) {
  # every app key under ConsentStore\<cap> (packaged apps + NonPackaged desktop apps), current user and machine
  $keys = @()
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $root = "$hive\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\$cap"
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $keys += @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)
    $np = Join-Path $root 'NonPackaged'
    if (Test-Path -LiteralPath $np) { $keys += @(Get-ChildItem -LiteralPath $np -ErrorAction SilentlyContinue) }
  }
  return ,@($keys | Where-Object { $_.PSChildName -ne 'NonPackaged' })
}
function Get-InUse([string]$cap) {
  $apps = @()
  foreach ($k in (Get-InUseKeys $cap)) {
    $start = $k.GetValue('LastUsedTimeStart')
    $stop = $k.GetValue('LastUsedTimeStop')
    if (-not ($start -and [long]$start -gt 0 -and ($null -eq $stop -or [long]$stop -eq 0))) { continue }
    $name = $k.PSChildName
    if ($name -match '#') {
      # desktop app: ignore stale entries left behind by apps that are no longer running
      $exe = ($name -split '#')[-1] -replace '\.exe$', ''
      if (-not (Get-Process -Name $exe -ErrorAction SilentlyContinue)) { continue }
    }
    $label = Get-AppLabel $name
    if ($apps -notcontains $label) { $apps += $label }
  }
  return ,$apps
}
function Get-MicApps {
  $apps = @()
  try { $apps += @([NI.Audio]::MicApps()) } catch {}
  try { foreach ($a in (Get-InUse 'microphone')) { if ($apps -notcontains $a) { $apps += $a } } } catch {}
  return ,$apps
}
function Get-PrivacyDiag {
  $rows = @()
  foreach ($cap in @('microphone', 'webcam')) {
    foreach ($k in (Get-InUseKeys $cap)) {
      $start = $k.GetValue('LastUsedTimeStart')
      if (-not $start) { continue }   # never used
      $stop = $k.GetValue('LastUsedTimeStop')
      $rows += @{ cap = $cap; app = (Get-AppLabel $k.PSChildName)
        lastStart = [DateTime]::FromFileTime([long]$start).ToString('yyyy-MM-dd HH:mm:ss')
        inUseNow = ($null -eq $stop -or [long]$stop -eq 0) }
    }
  }
  $debug = @()
  try { $debug = @([NI.Audio]::MicDebug()) } catch { $debug = @('error: ' + $_.Exception.Message) }
  return @{
    time        = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')
    foreground  = [NI.Native]::ForegroundApp()
    fullscreen  = [NI.Native]::Fullscreen()
    userState   = [NI.Native]::UserState()
    micNow      = @(Get-MicApps)
    camNow      = @($(try { Get-InUse 'webcam' } catch { }))
    micSessions = $debug
    registry    = $rows
    os          = [Environment]::OSVersion.VersionString
  }
}

# ---------------------------------------------------------------- brightness
function Get-Brightness {
  try {
    $b = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $b) { return @{ supported = $false } }
    return @{ supported = $true; value = [int]$b.CurrentBrightness }
  } catch { return @{ supported = $false } }
}
function Set-Brightness([int]$v) {
  $m = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
  $m.WmiSetBrightness(1, [byte][math]::Max(0, [math]::Min(100, $v))) | Out-Null
}

# ---------------------------------------------------------------- theme
$script:themeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
function Get-Dark {
  try { return ((Get-ItemProperty -Path $script:themeKey -Name AppsUseLightTheme).AppsUseLightTheme -eq 0) } catch { return $false }
}
function Set-Dark([bool]$dark) {
  $v = $(if ($dark) { 0 } else { 1 })
  Set-ItemProperty -Path $script:themeKey -Name AppsUseLightTheme -Value $v -Type DWord
  Set-ItemProperty -Path $script:themeKey -Name SystemUsesLightTheme -Value $v -Type DWord
  [NI.Native]::BroadcastTheme()
}

# ---------------------------------------------------------------- dispatcher
function Invoke-Cmd($cmd, $arg) {
  switch ($cmd) {
    'ping'      { return 'pong' }

    # combined fast poll
    'fast' {
      $m = @{ active = $false }
      try { $m = Get-Media } catch {}
      $mic = $null
      try { $mic = [NI.Audio]::GetMute(1) } catch {}
      return @{
        volume     = [int][math]::Round([NI.Audio]::GetVolume(0) * 100)
        muted      = [NI.Audio]::GetMute(0)
        mic        = $mic
        media      = $m
        fullscreen = [NI.Native]::Fullscreen()
        notifs     = (Get-NewNotifs)
        micApps    = @(Get-MicApps)
        camApps    = @($(try { Get-InUse 'webcam' } catch { }))
      }
    }
    # combined slow poll
    'slow' {
      $radio = @{ wifi = $null; bluetooth = $null }
      try { $radio = Get-RadioState } catch {}
      $wifi = @{ ssid = $null; signal = $null }
      if ($radio.wifi -eq 'On') { $wifi = Get-WifiInfo }
      return @{
        radios     = $radio
        wifi       = $wifi
        brightness = (Get-Brightness)
        dark       = (Get-Dark)
      }
    }

    'setVolume' { [NI.Audio]::SetVolume(0, [float]([math]::Max(0, [math]::Min(100, [double]$arg)) / 100)); if ([double]$arg -gt 0) { [NI.Audio]::SetMute(0, $false) }; return $null }
    'setMute'   { [NI.Audio]::SetMute(0, [bool]$arg); return $null }
    'setMic'    { [NI.Audio]::SetMute(1, [bool]$arg); return $null }
    'setBrightness' { Set-Brightness ([int]$arg); return $null }
    'media'     { Invoke-MediaAction ([string]$arg); return $null }
    'thumb'     { return (Get-Thumb) }
    'setRadio'  { Set-Radio ([string]$arg.kind) ([string]$arg.state); return $null }
    'setDark'   { Set-Dark ([bool]$arg); return $null }
    'lock'      { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\rundll32.exe') -ArgumentList 'user32.dll,LockWorkStation'; return $null }
    'diag'      { $d = Get-PrivacyDiag; $d.engine = 'powershell'; return $d }
    'wifiList'  { Need-Devices; return [NI.Dev.Wifi]::List() }
    'wifiScan'  { Need-Devices; [NI.Dev.Wifi]::Scan(); return $null }
    'wifiConnect' {
      Need-Devices
      $pw = $null; if ($null -ne $arg.password) { $pw = [string]$arg.password }
      return [NI.Dev.Wifi]::Connect([string]$arg.ssid, $pw)
    }
    'wifiForget' { Need-Devices; [NI.Dev.Wifi]::Forget([string]$arg); return $null }
    'wifiDisconnect' { Need-Devices; [NI.Dev.Wifi]::Disconnect(); return $null }
    'audioOutputs' { Need-Devices; return [NI.Dev.Outputs]::List() }
    'setAudioOutput' { Need-Devices; [NI.Dev.Outputs]::Set([string]$arg); return $null }
    'btList'    { Need-Devices; return [NI.Dev.Bluetooth]::List() }
    'trim'      { return [NI.Mem]::Trim([int[]]@($arg | Select-Object -First 64)) }
    'snip'      { Start-Process 'ms-screenclip:'; return $null }
    'open'      {
      # strict allowlist: only Windows Settings pages (e.g. ms-settings:bluetooth)
      $uri = [string]$arg
      if ($uri -cnotmatch '^ms-settings:[a-z0-9\-]{0,64}$' -and $uri -cne 'ms-settings-connectabledevices:devicediscovery') { throw 'Blocked URI' }
      Start-Process $uri; return $null
    }
    default { throw "Unknown command: $cmd" }
  }
}

function Send-Reply($id, $ok, $data, $err) {
  $o = [ordered]@{ id = $id; ok = $ok; data = $data; error = $err }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

Init-Notifs
Send-Reply 0 $true @{ ready = $true; engine = 'powershell'; notifs = $script:notifMode; media = $script:hasMedia; radios = $script:hasRadios } $null

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $data = Invoke-Cmd $req.cmd $req.arg
    Send-Reply $req.id $true $data $null
  } catch {
    $rid = $(if ($req) { $req.id } else { -1 })
    Send-Reply $rid $false $null ([string]$_.Exception.Message)
  }
}

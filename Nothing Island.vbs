' Double-click to start Nothing Island with no window at all (good for a desktop / Startup shortcut).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Run start.bat once first to install Nothing Island.", 64, "Nothing Island"
Else
  CreateObject("WScript.Shell").Run """" & exe & """ """ & dir & """", 1, False
End If

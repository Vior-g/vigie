# Vigie - surveille la fenêtre au premier plan (lecture seule).
# Émet une ligne JSON quand la fenêtre active ou sa position change.
# Ne lit ni la mémoire ni le réseau du jeu : uniquement titre, processus
# et rectangle de la fenêtre, comme n'importe quel gestionnaire de fenêtres.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VigieWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[VigieWin]::SetProcessDPIAware() | Out-Null
$names = @{}
$last = ''
$beat = 0
while ($true) {
  $h = [VigieWin]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [VigieWin]::GetWindowText($h, $sb, 512) | Out-Null
  $procId = [uint32]0
  [VigieWin]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if (-not $names.ContainsKey($procId)) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $names[$procId] = if ($p) { $p.ProcessName } else { '' }
  }
  $r = New-Object VigieWin+RECT
  [VigieWin]::GetClientRect($h, [ref]$r) | Out-Null
  $pt = New-Object VigieWin+POINT
  [VigieWin]::ClientToScreen($h, [ref]$pt) | Out-Null
  $obj = [ordered]@{
    hwnd = $h.ToInt64(); title = $sb.ToString(); pid = $procId; process = $names[$procId];
    x = $pt.X; y = $pt.Y; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top;
    minimized = [VigieWin]::IsIconic($h)
  }
  $json = $obj | ConvertTo-Json -Compress
  $beat++
  if ($json -ne $last -or $beat -ge 8) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
    $beat = 0
  }
  Start-Sleep -Milliseconds 250
}

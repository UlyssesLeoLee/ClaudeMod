# Opens a document's folder in Explorer with the document selected, then brings that
# window to the front: Windows keeps a window a background process opens behind the
# active one, so without this the folder opens unseen.
# Prints "front" when the window ended in front, "opened" when it opened but stayed
# behind, "missing" when neither the file nor its folder exists.
param([string]$Path, [string]$Folder)

$ErrorActionPreference = 'Stop'
$hasFile = Test-Path -LiteralPath $Path -PathType Leaf
if (-not $hasFile -and -not (Test-Path -LiteralPath $Folder -PathType Container)) { 'missing'; exit 0 }

Add-Type -Namespace Reveal -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@

if ($hasFile) { Start-Process explorer.exe -ArgumentList "/select,`"$Path`"" }
else { Start-Process explorer.exe -ArgumentList "`"$Folder`"" }

$want = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\')
$shell = New-Object -ComObject Shell.Application
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 100
  foreach ($w in @($shell.Windows())) {
    try { $at = $w.Document.Folder.Self.Path } catch { continue }
    if ($at -and $at.TrimEnd('\') -ieq $want) {
      $h = [System.IntPtr]$w.HWND
      if ([Reveal.Win]::IsIconic($h)) { [void][Reveal.Win]::ShowWindow($h, 9) }
      # A tap of Alt lets this process hand the foreground over.
      [Reveal.Win]::keybd_event(0x12, 0, 0, [System.UIntPtr]::Zero)
      [Reveal.Win]::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero)
      [void][Reveal.Win]::SetForegroundWindow($h)
      Start-Sleep -Milliseconds 150
      if ([Reveal.Win]::GetForegroundWindow() -eq $h) { 'front' } else { 'opened' }
      exit 0
    }
  }
}
'opened'

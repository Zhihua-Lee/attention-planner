<#
  Removes what install.ps1 added: the ap-open: link scheme for this user, and the helper and its list of folders.

  powershell -ExecutionPolicy Bypass -File tools\open-link\uninstall.ps1
#>
$ErrorActionPreference = 'Stop'

$key = 'HKCU:\Software\Classes\ap-open'
if (-not (Test-Path $key)) {
  Write-Output 'Not installed.'
  return
}
$command = (Get-Item "$key\shell\open\command" -ErrorAction SilentlyContinue)
if ($command -and $command.GetValue('') -match '"([^"]*open-link\.js)"') {
  $dir = Split-Path -Parent $Matches[1]
  foreach ($name in 'open-link.js', 'roots.txt') {
    $file = Join-Path $dir $name
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
  }
  if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir }
}
Remove-Item -Path $key -Recurse
Write-Output 'Removed.'

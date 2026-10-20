<#
  Lets Attention Planner open local paths on this Windows account: registers the ap-open: link scheme for the current
  user (no administrator needed) and copies the helper into -Dir. Only folders and .md, .txt, .pdf and image files
  inside -Roots (several separated by semicolons) are opened. Run it again to change -Roots; uninstall.ps1 removes it
  all.

  powershell -ExecutionPolicy Bypass -File tools\open-link\install.ps1 -Dir D:\Tools\ap-open -Roots D:\
#>
param(
  [Parameter(Mandatory = $true)] [string] $Dir,
  [Parameter(Mandatory = $true)] [string[]] $Roots
)
$ErrorActionPreference = 'Stop'

$Dir = [IO.Path]::GetFullPath($Dir)
$roots = foreach ($r in ($Roots -split ';' | Where-Object { $_.Trim() })) {
  $r = $r.Trim()
  if ($r -match '^[A-Za-z]:$') { $r += '\' }
  if (-not (Test-Path -LiteralPath $r -PathType Container)) { throw "Not a folder: $r" }
  [IO.Path]::GetFullPath($r)
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$script = Join-Path $Dir 'open-link.js'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'open-link.js') -Destination $script -Force
$roots | Set-Content -LiteralPath (Join-Path $Dir 'roots.txt') -Encoding Unicode

$key = 'HKCU:\Software\Classes\ap-open'
if (-not (Test-Path $key)) { New-Item -Path $key | Out-Null }
Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:Attention Planner local path'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
$command = "$key\shell\open\command"
if (-not (Test-Path $command)) { New-Item -Path $command -Force | Out-Null }
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
Set-ItemProperty -Path $command -Name '(default)' -Value "`"$wscript`" //nologo //E:jscript `"$script`" `"%1`""

Write-Output "Installed in $Dir. Allowed: $($roots -join ', ')"
Write-Output 'In Attention Planner, turn on Settings > Capture and list > Local paths on this device.'

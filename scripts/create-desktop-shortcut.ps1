# Creates "SEO Acquisition OS" on the desktop. Double-click it to start the app and open the browser.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'SEO Acquisition OS.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-app.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'src\app\favicon.ico') + ',0'
$shortcut.Description = 'Start SEO Client Acquisition OS and open it in the browser'
$shortcut.Save()
Write-Host "Shortcut created: $link"

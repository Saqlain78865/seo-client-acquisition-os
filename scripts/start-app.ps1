# Starts the app (if it is not already running) and opens it in the browser.
# Used by the desktop shortcut; safe to run any number of times.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:3000'

function Test-Up {
  try { (Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Up)) {
  Write-Host 'Starting SEO Client Acquisition OS...'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title SEO Acquisition OS server (keep open) && npm run dev' -WorkingDirectory $root -WindowStyle Minimized
  for ($i = 0; $i -lt 120 -and -not (Test-Up); $i++) { Start-Sleep -Seconds 1 }
}

Start-Process $url

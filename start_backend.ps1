# Start local API (port 8080) connected to VPS database db_solar_v2
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue) {
  Write-Host "Port 8080 already in use. Stop the other process first."
  exit 1
}
Write-Host "Starting DB Solar API on http://0.0.0.0:8080 (database: VPS db_solar_v2)"
node server.js

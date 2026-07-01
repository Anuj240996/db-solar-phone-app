# Package backend for VPS upload and print deploy commands.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $root "backend-deploy.zip"

if (Test-Path $zip) { Remove-Item $zip -Force }

$items = @(
  "server.js",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  ".dockerignore",
  "routes",
  "middleware",
  "utils",
  "database",
  "assets",
  "scripts"
)

Push-Location $root
try {
  Compress-Archive -Path $items -DestinationPath $zip -Force
  Write-Host "Created $zip"
} finally {
  Pop-Location
}

Write-Host @"

=== Deploy on VPS (SSH as root) ===

1) Upload zip (from this PC, new terminal):
   scp "$zip" root@72.60.98.248:/root/backend-deploy.zip

2) On VPS:
   mkdir -p /root/db_solar_backend
   unzip -o /root/backend-deploy.zip -d /root/db_solar_backend
   cd /root/db_solar_backend && npm ci --omit=dev
   bash /root/db_solar_backend/scripts/vps_update_phone_app.sh /root/db_solar_backend db_solar_phone-app

3) Verify (expect apiVersion 1.2.0, services route 401 not 404):
   curl -s http://127.0.0.1:8080/api/health
   curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/services

Or in Easypanel: redeploy phone-app from this repo (source: backend/, port 8080).

"@

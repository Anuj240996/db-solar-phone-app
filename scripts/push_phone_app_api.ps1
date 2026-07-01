# Sync backend/ to GitHub phone-app repo and push (Easypanel auto-deploy).
# Usage:
#   powershell -ExecutionPolicy Bypass -File backend\scripts\push_phone_app_api.ps1
#   powershell -ExecutionPolicy Bypass -File backend\scripts\push_phone_app_api.ps1 -Message "fix: complaints customer lookup"
param(
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$BackendRoot = Split-Path -Parent $PSScriptRoot
$PhoneAppRepo = "C:\Users\deshm\db-solar-phone-app"
$Remote = "https://github.com/Anuj240996/db-solar-phone-app.git"

if (-not (Test-Path $PhoneAppRepo)) {
    Write-Error "Phone-app repo not found at $PhoneAppRepo"
}

Write-Host "=== Sync backend -> db-solar-phone-app ===" -ForegroundColor Cyan
robocopy $BackendRoot $PhoneAppRepo /E `
    /XD node_modules uploads .git .dart_tool .idea `
    /XF .env backend-deploy.zip `
    /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
}

# Keep phone-app package identity (do not use db-solar-backend name from monorepo)
$pkgPath = Join-Path $PhoneAppRepo "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.name = "db-solar-phone-app"
$pkg.description = "Phone app API for DB Solar (Flutter mobile)"
$verMatch = Select-String -Path (Join-Path $BackendRoot "server.js") -Pattern "API_VERSION\s*=\s*'([^']+)'"
if ($verMatch) { $pkg.version = $verMatch.Matches[0].Groups[1].Value }
$pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding UTF8

Push-Location $PhoneAppRepo
try {
    $remoteUrl = git remote get-url origin 2>$null
    if (-not $remoteUrl) {
        git remote add origin $Remote
    } elseif ($remoteUrl -ne $Remote) {
        git remote set-url origin $Remote
    }

    git add -A
    $status = git status --porcelain
    if (-not $status) {
        Write-Host "No API changes to push." -ForegroundColor Yellow
        exit 0
    }

    if (-not $Message) {
        $Message = "API update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }

    git commit -m $Message
    git push origin main
    Write-Host ""
    Write-Host "Pushed to $Remote" -ForegroundColor Green
    Write-Host "Easypanel will redeploy phone-app if auto-deploy is enabled." -ForegroundColor Green
} finally {
    Pop-Location
}

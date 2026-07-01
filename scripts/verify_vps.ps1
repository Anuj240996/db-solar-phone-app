# Run from your PC after VPS phone-app redeploy
$base = "http://72.60.98.248:8080"

Write-Host ""
Write-Host "=== DB Solar VPS API check ===" -ForegroundColor Cyan
Write-Host "Base: $base"
Write-Host ""

try {
    $health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 10
    Write-Host "Health:" ($health | ConvertTo-Json -Compress)
    if ($health.apiVersion -ge "1.2.0") {
        Write-Host "OK  apiVersion $($health.apiVersion) (new backend deployed)" -ForegroundColor Green
    } else {
        Write-Host "WARN  Old backend still running - redeploy phone-app on VPS" -ForegroundColor Yellow
    }
} catch {
    Write-Host "FAIL  Cannot reach $base/api/health" -ForegroundColor Red
    exit 1
}

$routes = @(
    @{ Method = "GET"; Path = "/api/services"; Want = 401 },
    @{ Method = "GET"; Path = "/api/complaints"; Want = 401 },
    @{ Method = "GET"; Path = "/api/leads"; Want = 401 },
    @{ Method = "POST"; Path = "/api/support/query"; Want = 401; Body = '{"subject":"t","message":"t"}' }
)

foreach ($r in $routes) {
    try {
        $params = @{
            Uri        = "$base$($r.Path)"
            Method     = $r.Method
            TimeoutSec = 10
        }
        if ($r.Body) {
            $params.ContentType = "application/json"
            $params.Body = $r.Body
        }
        Invoke-WebRequest @params -UseBasicParsing | Out-Null
        Write-Host "UNEXPECTED $($r.Method) $($r.Path) returned 200" -ForegroundColor Yellow
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq $r.Want) {
            Write-Host "OK    $($r.Method) $($r.Path) -> $code (route exists)" -ForegroundColor Green
        } elseif ($code -eq 404) {
            Write-Host "FAIL  $($r.Method) $($r.Path) -> 404 (redeploy backend)" -ForegroundColor Red
        } else {
            Write-Host "      $($r.Method) $($r.Path) -> $code"
        }
    }
}

Write-Host ""
Write-Host "Next: flutter build apk --release, then install on phone" -ForegroundColor Cyan
Write-Host ""

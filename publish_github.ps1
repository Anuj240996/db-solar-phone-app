# One-time publish to https://github.com/Anuj240996/db-solar-phone-app
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File publish_github.ps1

$ErrorActionPreference = "Stop"
$RepoPath = $PSScriptRoot
$RepoName = "db-solar-phone-app"
$Owner = "Anuj240996"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

Set-Location $RepoPath

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "GitHub login required. Complete the browser step when prompted." -ForegroundColor Yellow
    gh auth login --hostname github.com --git-protocol https --web
}

$remoteUrl = "https://github.com/$Owner/$RepoName.git"
$existing = git remote get-url origin 2>$null
if (-not $existing) {
    git remote add origin $remoteUrl
} elseif ($existing -ne $remoteUrl) {
    git remote set-url origin $remoteUrl
}

$repoExists = gh repo view "$Owner/$RepoName" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating repository $Owner/$RepoName ..."
    gh repo create "$Owner/$RepoName" --private --source=. --remote=origin `
        --description "DB Solar phone app API (Easypanel, port 8080)"
}

Write-Host "Pushing main branch ..."
git push -u origin main

Write-Host ""
Write-Host "Done: https://github.com/$Owner/$RepoName" -ForegroundColor Green
Write-Host "Easypanel: connect this repo, branch main, port 8080, Dockerfile at root."

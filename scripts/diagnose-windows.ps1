#requires -version 5.1
<#
.SYNOPSIS
  Diagnose why DropBeam backend shows "Booting" forever.

.DESCRIPTION
  Checks port 17619, lists processes holding it, queries /api/health, and
  tells you exactly what's wrong.
#>

$ErrorActionPreference = 'Continue'
$port = 17619

Write-Host "DropBeam diagnostic ---------------------------------" -ForegroundColor Cyan

# 1. Who owns port 17619?
$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Host ""
    Write-Host "[1/3] Port $port is FREE." -ForegroundColor Yellow
    Write-Host "      The sidecar is not running. Possible causes:"
    Write-Host "        - DropBeam app is not launched (start it first)"
    Write-Host "        - Sidecar crashed before binding"
    Write-Host "        - dropbeam-backend.exe missing from install dir"
}
else {
    Write-Host ""
    Write-Host "[1/3] Port $port is HELD by:" -ForegroundColor Green
    foreach ($c in $conn | Select-Object -Unique OwningProcess) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host ("      PID {0,-6} {1,-25} {2}" -f $proc.Id, $proc.ProcessName, $proc.Path)
        }
    }
}

# 2. Is the response shape correct?
Write-Host ""
Write-Host "[2/3] Testing /api/health and /api/dashboard..." -ForegroundColor Cyan
try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3 -UseBasicParsing
    $healthJson = $health.Content | ConvertFrom-Json
    if ($healthJson.settings -and $healthJson.settings.deviceName) {
        Write-Host "      /api/health: OK (Node sidecar, correct shape)" -ForegroundColor Green
        Write-Host "      device: $($healthJson.settings.deviceName)"
    }
    elseif ($healthJson.bindUrl) {
        Write-Host "      /api/health: WRONG SHAPE - old Rust backend is running, not the Node sidecar." -ForegroundColor Red
        Write-Host "      Kill it and rebuild with the latest build-windows.ps1"
    }
    else {
        Write-Host "      /api/health: unexpected shape" -ForegroundColor Yellow
        $snippet = $health.Content
        if ($snippet.Length -gt 200) { $snippet = $snippet.Substring(0, 200) }
        Write-Host "      response: $snippet"
    }

    $dash = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/dashboard" -TimeoutSec 3 -UseBasicParsing
    Write-Host "      /api/dashboard: $($dash.StatusCode)" -ForegroundColor Green
}
catch {
    Write-Host "      Request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Are there multiple DropBeam processes?
Write-Host ""
Write-Host "[3/3] DropBeam processes currently running:" -ForegroundColor Cyan
$procs = Get-Process -Name "dropbeam-desktop", "dropbeam-backend", "node" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessName -like "dropbeam*" -or
        ($_.ProcessName -eq "node" -and $_.Path -like "*local-backend*")
    }

if ($procs) {
    foreach ($p in $procs) {
        Write-Host ("      PID {0,-6} {1,-25} {2}" -f $p.Id, $p.ProcessName, $p.Path)
    }
    if (($procs | Where-Object { $_.ProcessName -eq "node" }).Count -gt 0) {
        Write-Host ""
        Write-Host "      Leftover 'node' running the local-backend." -ForegroundColor Red
        Write-Host "      Kill it with:"
        Write-Host '         Get-Process node | Where-Object Path -like "*local-backend*" | Stop-Process -Force'
    }
}
else {
    Write-Host "      (none)"
}

Write-Host ""
Write-Host "--- Quick fixes -------------------------------------" -ForegroundColor Cyan
Write-Host "  Kill everything on port 17619 and restart fresh:"
Write-Host '    Get-NetTCPConnection -LocalPort 17619 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
Write-Host ""
Write-Host "  Then launch the app:"
Write-Host '    .\apps\desktop\src-tauri\target\release\dropbeam-desktop.exe'

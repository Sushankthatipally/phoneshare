#requires -version 5.1
<#
.SYNOPSIS
  Build the DropBeam Windows desktop installer.

.DESCRIPTION
  Self-contained .exe pipeline:
    1. pnpm install                                       (workspace deps)
    2. pnpm --filter @dropbeam/local-backend run bundle:exe
                                                          (esbuild → pkg → sidecar .exe)
    3. pnpm --filter @dropbeam/desktop run build          (Vite → apps/desktop/dist)
    4. cargo tauri build                                  (Rust + sidecar + NSIS installer)

  Output:
    apps/desktop/src-tauri/target/release/dropbeam-desktop.exe       (raw binary)
    apps/desktop/src-tauri/target/release/bundle/nsis/*.exe          (signed installer)

.PARAMETER SkipInstall
  Skip pnpm install (faster reruns).

.PARAMETER SkipSidecar
  Skip rebuilding the Node sidecar (use existing one).

.PARAMETER NoBundle
  Build the raw .exe only, skip NSIS installer packaging.
#>

[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipSidecar,
    [switch]$NoBundle
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."

Push-Location $repo
try {
    if (-not $SkipInstall) {
        Write-Host "==> pnpm install" -ForegroundColor Cyan
        pnpm install
    }

    if (-not $SkipSidecar) {
        Write-Host "==> Build Node sidecar (esbuild + pkg)" -ForegroundColor Cyan
        pnpm --filter "@dropbeam/local-backend" run bundle:exe
    }

    $sidecarPath = Join-Path $repo "apps\desktop\src-tauri\binaries\dropbeam-backend-x86_64-pc-windows-msvc.exe"
    if (-not (Test-Path $sidecarPath) -or (Get-Item $sidecarPath).Length -lt 1MB) {
        Write-Host ""
        Write-Host "ERROR: sidecar binary missing or empty: $sidecarPath" -ForegroundColor Red
        Write-Host "Run without -SkipSidecar to rebuild it." -ForegroundColor Red
        exit 1
    }
    Write-Host "    sidecar: $sidecarPath ($([math]::Round((Get-Item $sidecarPath).Length / 1MB, 1)) MB)"

    Write-Host "==> Build Vite bundle" -ForegroundColor Cyan
    pnpm --filter "@dropbeam/desktop" run build

    Push-Location apps/desktop/src-tauri
    try {
        if ($NoBundle) {
            Write-Host "==> cargo build --release (raw exe only)" -ForegroundColor Cyan
            cargo build --release
        } else {
            Write-Host "==> cargo tauri build (this can take 10+ minutes the first time)" -ForegroundColor Cyan
            cargo tauri build
        }
    } finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Done. Artifacts:" -ForegroundColor Green

    $rawExe = Join-Path $repo "apps\desktop\src-tauri\target\release\dropbeam-desktop.exe"
    if (Test-Path $rawExe) {
        Write-Host "  - $rawExe"
    }

    $bundleDir = Join-Path $repo "apps\desktop\src-tauri\target\release\bundle"
    if (Test-Path $bundleDir) {
        Get-ChildItem $bundleDir -Recurse -Include "*.exe", "*.msi" |
            ForEach-Object { Write-Host "  - $($_.FullName)" }
    }
}
finally {
    Pop-Location
}

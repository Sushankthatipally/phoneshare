#requires -version 5.1
<#
.SYNOPSIS
  Registers the "Send via DropBeam" Windows Explorer context-menu entry.

.DESCRIPTION
  Adds Windows Explorer right-click menu entries for files and folders
  that launch dropbeam-desktop.exe with the --send argument.

.PARAMETER ExePath
  Absolute path to dropbeam-desktop.exe.

.PARAMETER Uninstall
  Removes the context-menu entries.

.EXAMPLE
  PS> .\scripts\install-windows-context-menu.ps1

.EXAMPLE
  PS> .\scripts\install-windows-context-menu.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [string]$ExePath = "C:\Users\nani\Desktop\phoneshare\apps\desktop\src-tauri\target\release\dropbeam-desktop.exe",
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Registry paths
$fileShell = 'HKCU:\Software\Classes\*\shell\DropBeam'
$fileCmd   = "$fileShell\command"

$dirShell  = 'HKCU:\Software\Classes\Directory\shell\DropBeam'
$dirCmd    = "$dirShell\command"

# ---------------------------------------
# Uninstall
# ---------------------------------------
if ($Uninstall) {

    foreach ($path in @($fileCmd, $fileShell, $dirCmd, $dirShell)) {

        if (Test-Path $path) {
            Remove-Item -Path $path -Recurse -Force
            Write-Host "Removed: $path"
        }
    }

    Write-Host ""
    Write-Host "DropBeam context menu uninstalled." -ForegroundColor Green
    return
}

# ---------------------------------------
# Validate EXE
# ---------------------------------------
if (-not (Test-Path $ExePath)) {

    Write-Host ""
    Write-Host "ERROR: Executable not found:" -ForegroundColor Red
    Write-Host "  $ExePath"
    Write-Host ""

    exit 1
}

# ---------------------------------------
# FILES CONTEXT MENU
# ---------------------------------------
New-Item -Path $fileShell -Force | Out-Null

Set-ItemProperty `
    -Path $fileShell `
    -Name '(default)' `
    -Value 'Send via DropBeam'

Set-ItemProperty `
    -Path $fileShell `
    -Name 'Icon' `
    -Value "`"$ExePath`",0"

New-Item -Path $fileCmd -Force | Out-Null

Set-ItemProperty `
    -Path $fileCmd `
    -Name '(default)' `
    -Value "`"$ExePath`" --send `"%1`""


# ---------------------------------------
# FOLDERS CONTEXT MENU
# ---------------------------------------
New-Item -Path $dirShell -Force | Out-Null

Set-ItemProperty `
    -Path $dirShell `
    -Name '(default)' `
    -Value 'Send folder via DropBeam'

Set-ItemProperty `
    -Path $dirShell `
    -Name 'Icon' `
    -Value "`"$ExePath`",0"

New-Item -Path $dirCmd -Force | Out-Null

Set-ItemProperty `
    -Path $dirCmd `
    -Name '(default)' `
    -Value "`"$ExePath`" --send `"%V`""


# ---------------------------------------
# Done
# ---------------------------------------
Write-Host ""
Write-Host "DropBeam context menu installed successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Available options:"
Write-Host "  • Right-click any file   → Send via DropBeam"
Write-Host "  • Right-click any folder → Send folder via DropBeam"
Write-Host ""
Write-Host "Executable:"
Write-Host "  $ExePath"
Write-Host ""
Write-Host "To uninstall later:"
Write-Host "  .\scripts\install-windows-context-menu.ps1 -Uninstall"
# DropBeam diagnostics for Windows.
# Prints LAN candidate IPs, firewall state for ports 17619 / 38251 / 5353,
# tool availability, and the local backend health JSON.

$ErrorActionPreference = 'Continue'
$Port = if ($env:DROPBEAM_BACKEND_PORT) { $env:DROPBEAM_BACKEND_PORT } else { '17619' }
$HostName = if ($env:DROPBEAM_BACKEND_HOST) { $env:DROPBEAM_BACKEND_HOST } else { '127.0.0.1' }

function Write-Section($title) {
    Write-Host ""
    Write-Host "=== $title ==="
}

Write-Section 'System'
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | Format-List

Write-Section 'LAN interfaces (IPv4, non-loopback)'
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object InterfaceAlias, IPAddress, PrefixLength |
    Format-Table -AutoSize

Write-Section "Listeners on TCP/$Port, UDP/38251, UDP/5353"
foreach ($p in @($Port, 38251, 5353)) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, State, OwningProcess |
        Format-Table -AutoSize
    Get-NetUDPEndpoint -LocalPort $p -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess |
        Format-Table -AutoSize
}

Write-Section 'Firewall profile state'
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | Format-Table -AutoSize

Write-Section 'Firewall rules touching DropBeam ports'
Get-NetFirewallPortFilter |
    Where-Object { $_.LocalPort -eq $Port -or $_.LocalPort -eq '38251' -or $_.LocalPort -eq '5353' } |
    ForEach-Object {
        $rule = Get-NetFirewallRule -AssociatedNetFirewallPortFilter $_ -ErrorAction SilentlyContinue
        if ($rule) {
            [pscustomobject]@{
                Rule      = $rule.DisplayName
                Enabled   = $rule.Enabled
                Direction = $rule.Direction
                Action    = $rule.Action
                Port      = $_.LocalPort
                Protocol  = $_.Protocol
            }
        }
    } | Format-Table -AutoSize

Write-Section 'Tool availability'
foreach ($tool in @('adb', 'idevice_id', 'iproxy', 'node', 'curl')) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) {
        Write-Host ("  {0,-12} {1}" -f $tool, $cmd.Source)
    } else {
        Write-Host ("  {0,-12} missing" -f $tool)
    }
}

Write-Section "Backend health (http://$HostName`:$Port/api/health)"
try {
    Invoke-RestMethod -Uri "http://$HostName`:$Port/api/health" -TimeoutSec 3 | ConvertTo-Json -Depth 6
} catch {
    Write-Host "  (no response: $($_.Exception.Message))"
}

Write-Section "LAN discovery candidates (http://$HostName`:$Port/api/discovery/lan-ips)"
try {
    Invoke-RestMethod -Uri "http://$HostName`:$Port/api/discovery/lan-ips" -TimeoutSec 3 | ConvertTo-Json -Depth 6
} catch {
    Write-Host "  (no response: $($_.Exception.Message))"
}

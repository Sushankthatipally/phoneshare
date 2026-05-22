# DropBeam — Windows diagnostic
#
# Surfaces the same information the desktop "something's wrong" UI links to:
#   - firewall posture for the locked transport ports
#   - LAN IPv4 candidates ranked by usefulness
#   - adb / iproxy presence
#   - backend health JSON
#
# Run from PowerShell:   .\scripts\diagnose-windows.ps1
# Plain text output; ends with `OK` or `ISSUES FOUND: <count>`.

$ErrorActionPreference = 'Continue'
$issues = 0

function Write-Section($title) {
  Write-Host ''
  Write-Host ('== ' + $title + ' ==')
}

function Add-Issue($message) {
  $script:issues++
  Write-Host ('  [!] ' + $message)
}

Write-Host 'DropBeam Windows Diagnostic'
Write-Host ('Host: ' + $env:COMPUTERNAME + '  User: ' + $env:USERNAME)
Write-Host ('Time: ' + (Get-Date -Format 'u'))

# ---------- Firewall ----------
Write-Section 'Firewall (ports 17619/tcp, 38251/udp, 5353/udp)'
$portChecks = @(
  @{ Port = 17619; Protocol = 'TCP'; Label = '17619/tcp (backend HTTP+SSE)' },
  @{ Port = 38251; Protocol = 'UDP'; Label = '38251/udp (legacy discovery)' },
  @{ Port = 5353;  Protocol = 'UDP'; Label = '5353/udp (mDNS)' }
)
foreach ($check in $portChecks) {
  Write-Host ('- ' + $check.Label)
  try {
    $rules = Get-NetFirewallPortFilter -ErrorAction Stop |
      Where-Object { $_.Protocol -eq $check.Protocol -and $_.LocalPort -contains [string]$check.Port } |
      ForEach-Object { Get-NetFirewallRule -AssociatedNetFirewallPortFilter $_ -ErrorAction SilentlyContinue }
    if (-not $rules -or $rules.Count -eq 0) {
      Write-Host '    no rules matched'
      Add-Issue ('no firewall rule for ' + $check.Label)
    } else {
      foreach ($rule in $rules) {
        $line = '    ' + $rule.DisplayName + '  enabled=' + $rule.Enabled + '  direction=' + $rule.Direction + '  action=' + $rule.Action + '  profile=' + $rule.Profile
        Write-Host $line
        if ($rule.Action -eq 'Block' -and $rule.Enabled -eq 'True') {
          Add-Issue ('blocking rule active for ' + $check.Label + ': ' + $rule.DisplayName)
        }
      }
    }
  } catch {
    Write-Host ('    error: ' + $_.Exception.Message)
    Add-Issue ('Get-NetFirewallRule failed for ' + $check.Label)
  }
}

# ---------- LAN IPv4 candidates ----------
Write-Section 'LAN IPv4 candidates (ranked)'

function Get-AdapterScore($adapter, $address) {
  $name  = ($adapter.Name + ' ' + $adapter.InterfaceDescription).ToLower()
  $ip    = $address.IPAddress
  if ($ip -like '127.*')      { return @{ score = -100; reason = 'loopback' } }
  if ($ip -like '169.254.*')  { return @{ score = -50;  reason = 'link-local APIPA' } }
  if ($name -match 'tun|tap|wireguard|openvpn|zerotier|hamachi|tailscale|cisco|fortinet|nord|express|globalprotect|virtualbox|hyper-v|vethernet|vmware|loopback|teredo|isatap|bluetooth') {
    return @{ score = 5; reason = 'virtual / VPN' }
  }
  if ($adapter.MediaType -eq '802.3' -or $name -match 'ethernet|realtek|intel.*ethernet|gigabit') {
    return @{ score = 100; reason = 'physical ethernet' }
  }
  if ($adapter.MediaType -like '*802.11*' -or $name -match 'wi-?fi|wireless|wlan|wifi') {
    return @{ score = 70; reason = 'wifi' }
  }
  return @{ score = 30; reason = 'other' }
}

try {
  $candidates = @()
  $adapters = Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' }
  foreach ($adapter in $adapters) {
    $addresses = Get-NetIPAddress -InterfaceIndex $adapter.IfIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
    foreach ($addr in $addresses) {
      $scored = Get-AdapterScore $adapter $addr
      if ($scored.score -le 0) { continue }
      $candidates += [pscustomobject]@{
        Score   = $scored.score
        Reason  = $scored.reason
        IP      = $addr.IPAddress
        Adapter = $adapter.Name
        Desc    = $adapter.InterfaceDescription
      }
    }
  }
  if ($candidates.Count -eq 0) {
    Write-Host '  (no usable IPv4 candidates)'
    Add-Issue 'no usable LAN IPv4 candidates'
  } else {
    $candidates | Sort-Object -Property Score -Descending | ForEach-Object {
      $line = '  [' + $_.Score.ToString().PadLeft(3) + '] ' + $_.IP.PadRight(16) + ' ' + $_.Adapter + ' (' + $_.Reason + ')'
      Write-Host $line
    }
  }
} catch {
  Write-Host ('  Get-NetAdapter failed: ' + $_.Exception.Message)
  Add-Issue 'unable to enumerate network adapters'
}

# ---------- adb ----------
Write-Section 'adb (Android Debug Bridge)'
$adb = Get-Command adb -ErrorAction SilentlyContinue
if ($null -eq $adb) {
  Write-Host '  not found on PATH'
  Add-Issue 'adb missing — Android USB pairing will not work'
} else {
  Write-Host ('  path: ' + $adb.Source)
  try {
    $version = (& adb version 2>&1) -join "`n"
    Write-Host $version
  } catch {
    Write-Host ('  adb version failed: ' + $_.Exception.Message)
    Add-Issue 'adb present but `adb version` failed'
  }
}

# ---------- iproxy ----------
Write-Section 'iproxy (libimobiledevice — iOS USB tunnel)'
$iproxy = Get-Command iproxy -ErrorAction SilentlyContinue
if ($null -eq $iproxy) {
  Write-Host '  not found on PATH'
  Add-Issue 'iproxy missing — iOS USB pairing will not work'
} else {
  Write-Host ('  path: ' + $iproxy.Source)
  try {
    $iproxyVersion = (& iproxy --version 2>&1) -join "`n"
    if (-not $iproxyVersion) { $iproxyVersion = '  (no --version output)' }
    Write-Host $iproxyVersion
  } catch {
    Write-Host ('  iproxy --version failed: ' + $_.Exception.Message)
  }
}

# ---------- Backend health ----------
Write-Section 'Backend health (http://127.0.0.1:17619/api/health)'
try {
  $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:17619/api/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
  Write-Host ('  status: ' + $resp.StatusCode)
  Write-Host '  body:'
  try {
    $parsed = $resp.Content | ConvertFrom-Json
    $pretty = $parsed | ConvertTo-Json -Depth 10
    foreach ($l in ($pretty -split "`n")) { Write-Host ('    ' + $l) }
  } catch {
    Write-Host ('    ' + $resp.Content)
  }
} catch {
  Write-Host ('  backend not reachable: ' + $_.Exception.Message)
  Write-Host '  (this is OK if the desktop app is not running)'
}

# ---------- Summary ----------
Write-Host ''
if ($issues -eq 0) {
  Write-Host 'OK'
} else {
  Write-Host ('ISSUES FOUND: ' + $issues)
}

#!/usr/bin/env bash
# DropBeam — macOS / Linux diagnostic.
#
# Sibling of diagnose-windows.ps1. Surfaces:
#   - firewall posture (pf on macOS, iptables/nft hint on Linux)
#   - LAN IPv4 candidates ranked by usefulness
#   - adb / iproxy presence
#   - backend health JSON
#
# Run:   bash apps/desktop/scripts/diagnose-mac.sh
# Plain text output; ends with `OK` or `ISSUES FOUND: <count>`.

# Intentionally NOT `set -e`: we want to keep collecting diagnostics even when
# individual commands fail (firewall sudo prompt, no backend running, etc.).
set -u

issues=0
note() { issues=$((issues + 1)); printf '  [!] %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

uname_s=$(uname -s 2>/dev/null || echo unknown)

printf 'DropBeam Diagnostic (%s)\n' "$uname_s"
printf 'Host: %s   User: %s\n' "$(hostname 2>/dev/null || echo ?)" "${USER:-?}"
printf 'Time: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# ---------- Firewall ----------
section 'Firewall (ports 17619/tcp, 38251/udp, 5353/udp)'
case "$uname_s" in
  Darwin)
    if command -v pfctl >/dev/null 2>&1; then
      pf_state=$(pfctl -s info 2>/dev/null | awk '/^Status:/ {print $2}')
      if [ -n "${pf_state:-}" ]; then
        printf '  pf state: %s\n' "$pf_state"
      else
        printf '  pf state: unknown (sudo may be required)\n'
      fi
      # pfctl -s rules requires root. We try without sudo, swallow errors.
      rules_output=$(pfctl -s rules 2>/dev/null || true)
      if [ -z "$rules_output" ]; then
        printf '  pf rules: unreadable without sudo — re-run with `sudo` for full visibility\n'
      else
        # Grep for our ports; show matched lines (or note none).
        matched=$(printf '%s\n' "$rules_output" | grep -E '17619|38251|5353' || true)
        if [ -n "$matched" ]; then
          printf '%s\n' "$matched" | sed 's/^/    /'
        else
          printf '  pf rules: no entries reference 17619 / 38251 / 5353 (defaults permit outbound)\n'
        fi
      fi
    else
      printf '  pfctl not found\n'
    fi
    ;;
  Linux)
    if command -v nft >/dev/null 2>&1; then
      printf '  nft ruleset (filtered to dropbeam ports, may be empty):\n'
      nft list ruleset 2>/dev/null | grep -E '17619|38251|5353' | sed 's/^/    /' || true
    elif command -v iptables >/dev/null 2>&1; then
      printf '  iptables rules (filtered):\n'
      iptables -S 2>/dev/null | grep -E '17619|38251|5353' | sed 's/^/    /' || true
    else
      printf '  no nft / iptables found\n'
    fi
    ;;
  *)
    printf '  (firewall enumeration unsupported on %s)\n' "$uname_s"
    ;;
esac

# ---------- LAN IPv4 candidates ----------
section 'LAN IPv4 candidates (ranked)'

score_interface() {
  # $1 = interface name, lowercased. Echoes "<score> <reason>".
  local name="$1"
  case "$name" in
    lo|lo0)                                        echo "-100 loopback"; return ;;
    utun*|tun*|tap*|wg*|ipsec*|gif*|stf*|tailscale*|nordlynx*) echo "5 virtual/VPN"; return ;;
    vmnet*|vboxnet*|docker*|br-*|veth*|virbr*)     echo "5 virtual"; return ;;
    awdl*|llw*|anpi*|ap*|bridge*)                  echo "10 apple-internal"; return ;;
    en0|eth0|eno*|enp*|ens*)                       echo "100 physical-ethernet"; return ;;
    en[1-9]*|eth[1-9]*|wlan*|wlp*|wlx*)            echo "70 wifi-or-secondary"; return ;;
    *)                                             echo "30 other"; return ;;
  esac
}

candidates_tmp=$(mktemp -t dropbeam-diag.XXXXXX)
# shellcheck disable=SC2064
trap "rm -f '$candidates_tmp'" EXIT

if command -v ifconfig >/dev/null 2>&1; then
  current_iface=""
  while IFS= read -r line; do
    case "$line" in
      [a-z]*:\ flags*)
        current_iface="${line%%:*}"
        ;;
      *inet\ *)
        # Parse: "\tinet 192.168.1.42 netmask 0xffffff00 broadcast ..."
        ip=$(printf '%s\n' "$line" | awk '{print $2}')
        case "$ip" in
          127.*|169.254.*) continue ;;
        esac
        lname=$(printf '%s' "$current_iface" | tr '[:upper:]' '[:lower:]')
        scored=$(score_interface "$lname")
        score=$(printf '%s' "$scored" | awk '{print $1}')
        reason=$(printf '%s' "$scored" | cut -d' ' -f2-)
        if [ "${score}" -le 0 ] 2>/dev/null; then continue; fi
        printf '%d\t%s\t%s\t%s\n' "$score" "$ip" "$current_iface" "$reason" >> "$candidates_tmp"
        ;;
    esac
  done < <(ifconfig 2>/dev/null)
elif command -v ip >/dev/null 2>&1; then
  while IFS= read -r line; do
    iface=$(printf '%s' "$line" | awk '{print $NF}')
    ip=$(printf '%s' "$line" | awk '{print $4}' | cut -d/ -f1)
    case "$ip" in 127.*|169.254.*) continue ;; esac
    lname=$(printf '%s' "$iface" | tr '[:upper:]' '[:lower:]')
    scored=$(score_interface "$lname")
    score=$(printf '%s' "$scored" | awk '{print $1}')
    reason=$(printf '%s' "$scored" | cut -d' ' -f2-)
    if [ "${score}" -le 0 ] 2>/dev/null; then continue; fi
    printf '%d\t%s\t%s\t%s\n' "$score" "$ip" "$iface" "$reason" >> "$candidates_tmp"
  done < <(ip -4 -o addr show 2>/dev/null)
else
  printf '  neither ifconfig nor ip found\n'
  note 'cannot enumerate network interfaces'
fi

if [ -s "$candidates_tmp" ]; then
  sort -rn -k1,1 "$candidates_tmp" | while IFS=$'\t' read -r score ip iface reason; do
    printf '  [%3d] %-16s %s (%s)\n' "$score" "$ip" "$iface" "$reason"
  done
else
  printf '  (no usable IPv4 candidates)\n'
  note 'no usable LAN IPv4 candidates'
fi

# ---------- adb ----------
section 'adb (Android Debug Bridge)'
if command -v adb >/dev/null 2>&1; then
  printf '  path: %s\n' "$(command -v adb)"
  adb version 2>&1 | sed 's/^/  /' || true
else
  printf '  not found on PATH\n'
  note 'adb missing — Android USB pairing will not work'
fi

# ---------- iproxy ----------
section 'iproxy (libimobiledevice — iOS USB tunnel)'
if command -v iproxy >/dev/null 2>&1; then
  printf '  path: %s\n' "$(command -v iproxy)"
  # iproxy --version exits non-zero on some builds; handle gracefully.
  iproxy_v=$(iproxy --version 2>&1 || true)
  if [ -n "$iproxy_v" ]; then
    printf '%s\n' "$iproxy_v" | sed 's/^/  /'
  else
    printf '  (no --version output)\n'
  fi
else
  printf '  not found on PATH\n'
  note 'iproxy missing — iOS USB pairing will not work'
fi

# ---------- Backend health ----------
section 'Backend health (http://127.0.0.1:17619/api/health)'
if command -v curl >/dev/null 2>&1; then
  health_body=$(curl -fsS --max-time 3 http://127.0.0.1:17619/api/health 2>/dev/null || true)
  if [ -n "$health_body" ]; then
    if command -v python3 >/dev/null 2>&1; then
      printf '%s' "$health_body" | python3 -m json.tool 2>/dev/null | sed 's/^/  /' \
        || printf '  %s\n' "$health_body"
    else
      printf '  %s\n' "$health_body"
    fi
  else
    printf '  backend not reachable (this is OK if the desktop app is not running)\n'
  fi
else
  printf '  curl not found — skipping backend health probe\n'
fi

# ---------- Summary ----------
printf '\n'
if [ "$issues" -eq 0 ]; then
  printf 'OK\n'
else
  printf 'ISSUES FOUND: %d\n' "$issues"
fi

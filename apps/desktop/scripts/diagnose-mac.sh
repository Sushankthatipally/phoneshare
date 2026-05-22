#!/usr/bin/env bash
# DropBeam diagnostics for macOS / Linux.
# Prints LAN candidate IPs, firewall state for port 17619, tool availability,
# and the local backend health JSON. Output is intentionally plain text so it
# can be copy-pasted into a bug report.

set -u

PORT="${DROPBEAM_BACKEND_PORT:-17619}"
HOST="${DROPBEAM_BACKEND_HOST:-127.0.0.1}"

section() {
  printf '\n=== %s ===\n' "$1"
}

section "System"
uname -a
sw_vers 2>/dev/null || true

section "LAN interfaces (IPv4, non-loopback)"
if command -v ifconfig >/dev/null 2>&1; then
  ifconfig | awk '
    /^[a-z]/ { iface=$1; sub(":","",iface) }
    /inet / && $2 != "127.0.0.1" { printf "  %-12s %s\n", iface, $2 }
  '
elif command -v ip >/dev/null 2>&1; then
  ip -4 -o addr show | awk '$4 !~ /^127\./ { printf "  %-12s %s\n", $2, $4 }'
fi

section "Port ${PORT} listeners"
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || echo "  (no listeners)"
else
  echo "  lsof unavailable"
fi

section "Firewall state (macOS pfctl / Linux ufw)"
if command -v pfctl >/dev/null 2>&1; then
  pfctl -s info 2>/dev/null | head -n 4 || echo "  pfctl query failed (try with sudo)"
elif command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null || echo "  ufw query failed"
else
  echo "  no recognized firewall CLI"
fi

section "Tool availability"
for tool in adb idevice_id iproxy node curl; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf "  %-12s %s\n" "$tool" "$(command -v "$tool")"
  else
    printf "  %-12s missing\n" "$tool"
  fi
done

section "Backend health (http://${HOST}:${PORT}/api/health)"
if command -v curl >/dev/null 2>&1; then
  curl -sS --max-time 3 "http://${HOST}:${PORT}/api/health" || echo "  (no response)"
  echo
else
  echo "  curl missing"
fi

section "LAN discovery candidates (http://${HOST}:${PORT}/api/discovery/lan-ips)"
if command -v curl >/dev/null 2>&1; then
  curl -sS --max-time 3 "http://${HOST}:${PORT}/api/discovery/lan-ips" || echo "  (no response)"
  echo
fi

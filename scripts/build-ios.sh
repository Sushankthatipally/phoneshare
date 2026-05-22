#!/usr/bin/env bash
set -euo pipefail

# Build the DropBeam iOS app via Expo + EAS.
#
# Prereqs:
#   - macOS host (Xcode required for local builds)
#   - Apple Developer membership for code signing
#   - Node 18+, pnpm 10+
#
# Two modes:
#   ./build-ios.sh simulator   → simulator build, no signing
#   ./build-ios.sh device      → EAS cloud build for real iPhones (default)

MODE="${1:-device}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ "$(uname)" != "Darwin" && "$MODE" == "simulator" ]]; then
  echo "Local iOS simulator builds require macOS." >&2
  exit 1
fi

echo "▶ pnpm install"
pnpm install

cd apps/mobile

echo "▶ expo prebuild (generates apps/mobile/ios)"
pnpm exec expo prebuild --platform ios --clean

case "$MODE" in
  simulator)
    echo "▶ EAS build (development profile, simulator)"
    pnpm exec eas build --platform ios --profile development --local
    ;;
  device)
    echo "▶ EAS build (preview profile, signed device build)"
    pnpm exec eas build --platform ios --profile preview --non-interactive
    ;;
  *)
    echo "Unknown mode: $MODE (use 'simulator' or 'device')" >&2
    exit 1
    ;;
esac

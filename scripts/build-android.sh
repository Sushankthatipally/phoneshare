#!/usr/bin/env bash
set -euo pipefail

# Build the DropBeam Android APK / AAB via Expo + EAS.
#
# Prereqs:
#   - Android SDK installed (or use EAS cloud build)
#   - Node 18+, pnpm 10+
#   - Expo account if using `eas build --platform android` (cloud)
#
# Two modes:
#   ./build-android.sh local   → on-machine debug build (apps/mobile/android needs prebuild)
#   ./build-android.sh cloud   → EAS cloud build (default)

MODE="${1:-cloud}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "▶ pnpm install"
pnpm install

cd apps/mobile

echo "▶ expo prebuild (generates apps/mobile/android)"
pnpm exec expo prebuild --platform android --clean

case "$MODE" in
  local)
    echo "▶ assembleDebug (local)"
    cd android
    ./gradlew assembleDebug
    cd ..
    echo "✅ APK at: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  cloud)
    echo "▶ EAS build (preview profile)"
    pnpm exec eas build --platform android --profile preview --non-interactive
    ;;
  *)
    echo "Unknown mode: $MODE (use 'local' or 'cloud')" >&2
    exit 1
    ;;
esac

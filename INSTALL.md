# DropBeam — Building & Installing

This monorepo ships three apps: a **Tauri desktop** (Windows / macOS / Linux),
an **Expo mobile** app (iOS / Android), and a **Node local-backend** that's
embedded into the desktop. Below are the exact prerequisites and commands
for building each platform.

## Repo layout

```
apps/
  desktop/                Vite + React frontend
    src-tauri/            Rust backend (Tauri shell + transfer server)
  mobile/                 Expo Router + React Native
    modules/
      dropbeam-live-activity/   Swift Live Activity (iOS Dynamic Island)
      dropbeam-android/         Kotlin module (hotspot, notifications, background service)
packages/
  local-backend/          Node fallback backend (used during web dev)
  protocol/               Shared TypeScript types & API client
  shared-ui/              Cross-platform UI primitives
scripts/                  Build/install helpers
```

## 0. Common prerequisites

| Tool       | Min version | Notes |
|------------|-------------|-------|
| Node.js    | 18.x        | 22.x recommended |
| pnpm       | 10.x        | `npm i -g pnpm@10` |
| Rust       | 1.78+       | `https://rustup.rs/` |
| Expo CLI   | bundled     | comes via `pnpm exec expo` |
| EAS CLI    | latest      | `npm i -g eas-cli` for mobile cloud builds |

```bash
# From repo root
pnpm install
```

## 1. Windows desktop

### Prereqs
- Rust toolchain (`rustup default stable`).
- Microsoft Visual C++ Build Tools (Desktop development with C++).
- WebView2 runtime (auto-installed by the bundled MSI on Windows 11; for Windows 10 see the Edge WebView2 page).
- PowerShell 5.1+ (ships with Windows).

### Build
```powershell
# From repo root, in PowerShell
.\scripts\build-windows.ps1
```
This runs `pnpm install` → builds the Vite bundle → runs `cargo tauri build`.
Output:
- NSIS installer (`.exe`)
- MSI installer (`.msi`)

Both land in `apps/desktop/src-tauri/target/release/bundle/`.

### Install Explorer context menu (after main app is installed)
```powershell
.\scripts\install-windows-context-menu.ps1
# Uninstall:
.\scripts\install-windows-context-menu.ps1 -Uninstall
```
This writes `HKCU\Software\Classes\*\shell\DropBeam` registry entries so
right-clicking any file shows **Send via DropBeam**.

## 2. macOS / Linux desktop

### Prereqs
- Rust toolchain
- Xcode command-line tools (macOS) or `build-essential` (Linux)
- `libsoup-3.0`, `webkit2gtk-4.1`, `libssl-dev` (Linux only)

### Build
```bash
pnpm install
pnpm --filter @dropbeam/desktop run build
cd apps/desktop/src-tauri && cargo tauri build
```
Output: `target/release/bundle/`
- `dmg/` (macOS)
- `deb/`, `appimage/`, `rpm/` (Linux)

## 3. Android (Expo + native Kotlin module)

### Prereqs
- Android SDK + platform-tools (or skip locally and use EAS cloud).
- Java 17.
- Expo / EAS account for cloud builds.

### Local debug APK
```bash
./scripts/build-android.sh local
# APK output: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### Cloud build (signed, preview profile)
```bash
./scripts/build-android.sh cloud
# Watch build progress: https://expo.dev/accounts/<you>/projects/dropbeam/builds
```

The bundled Kotlin module `dropbeam-android` provides:
- `startHotspot()` → opens the Tethering settings panel.
- `joinWifi(ssid, password)` → uses `WifiNetworkSpecifier` (Android 10+).
- `showIncomingNotification(...)` → notification with Accept / Decline / Change-folder action buttons.
- `startBackgroundReceive(...)` → starts a foreground service so transfers continue with the app closed.

## 4. iOS (Expo + native Swift Live Activity)

### Prereqs
- macOS host (Xcode 15+).
- Apple Developer Program membership ($99/yr).
- A real iPhone for Dynamic Island testing (Live Activities don't run on simulator < iOS 17).
- Expo / EAS account.

### Build
```bash
# Cloud build (signed)
./scripts/build-ios.sh device

# Simulator build (unsigned, requires macOS)
./scripts/build-ios.sh simulator
```

After `expo prebuild`, Xcode opens at `apps/mobile/ios/DropBeam.xcworkspace`.
Add the Live Activity Widget Extension target:
1. File → New → Target → "Widget Extension"
2. Bundle id: `com.dropbeam.mobile.LiveActivity`
3. Check "Include Live Activity"
4. Drag `apps/mobile/modules/dropbeam-live-activity/ios/DropBeamLiveActivityWidget.swift`
   and `DropBeamTransferAttributes.swift` into the new target.
5. Build & run.

The Swift module (`DropBeamLiveActivityModule.swift`) is bridged to JS via
Expo Modules — no extra wiring needed once `expo prebuild` runs.

## 5. Running the desktop in dev mode

```bash
pnpm dev
# → starts:
#   - packages/local-backend on http://127.0.0.1:17619
#   - apps/desktop on        http://127.0.0.1:1420
```

Open the browser at the Vite URL and you'll see the full UI without the
Tauri shell. Inside the bundled desktop app the same UI is hosted in the
Tauri webview, with the embedded Rust backend on port 17619.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `cargo tauri build` says "WebView2 not found" | Install [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |
| `expo prebuild` complains about `npx` | Run via `pnpm exec expo prebuild`. |
| EAS build hangs on Android | Run `eas build:configure` once first. |
| Live Activity not showing on iPhone | Settings → DropBeam → enable "Live Activities". Real iPhone only — simulator can't host these pre-iOS 17. |
| Context-menu install fails | Make sure DropBeam.exe is installed first, then pass `-ExePath` to the installer script. |

## 7. What ships disabled-by-default

A few features need the native pieces to be present *and* wired by the
Tauri JS layer; until then they show their UI but are no-ops on screen
(clearly labeled):

- USB cable transfers (need `adb` and `iproxy` binaries on `$PATH`,
  or `DROPBEAM_ADB_BINARY` / `DROPBEAM_IPROXY_BINARY` env vars).
- Hotspot creation (handled by the Android module; the desktop side just
  shows credentials).
- Watch folders (works the moment `start_watch_folder` is invoked from JS,
  which the Settings screen wires after the Tauri build).
- Dynamic Island (iOS only; needs the Widget Extension target added in Xcode).

# DropBeam

DropBeam is a local-network file transfer app. Native desktop (Tauri + React)
and native mobile (Expo / React Native). No accounts, no cloud, no QR pairing
or PIN — devices on the same Wi-Fi see each other via mDNS, you tap a device
to send. Encryption is invisible: ECDH + AES-GCM under the hood, no UI for it.

## Product shape

- **Desktop**: left rail with Receive · Send · Settings. Default tab is
  Receive, which shows this device's friendly name + hashtag + Quick Save
  toggle. Send shows four selection cards (File / Folder / Text / Paste) and
  a list of nearby devices. Settings holds Profile + Quick Save + Favorites
  plus Trusted Devices / Watch Folders / Shell Integration / Benchmark.
- **Mobile (Android)**: bottom tab bar with Receive · Send · Settings.
  Identical aesthetic (dark glass), same four selection types, same Quick
  Save tri-state.
- **iOS**: parked. Sideload requires a Mac.

## Discovery lanes

mDNS (`_dropbeam._tcp`) is the primary discovery lane. Fallbacks for when
multicast is blocked:

1. **USB tunnel** — `adb reverse tcp:17619 tcp:17619`, the phone then sees a
   synthetic `USB Desktop` peer at the top of Nearby devices.
2. **Manual IP** — enter the desktop's LAN IP in the Send tab's fallback
   form.

## Install + run

```powershell
pnpm install
pnpm dev:desktop                                            # Tauri shell
pnpm --filter @dropbeam/local-backend run bundle:exe        # sidecar binary
pnpm dev:mobile                                             # Expo, Android target
pnpm dev:web                                                # mobile UI in browser
```

JDK 17 is required for Android builds. Windows Firewall must allow UDP 5353
inbound on the LAN interface for mDNS to work — add the rule:

```powershell
New-NetFirewallRule -DisplayName "DropBeam mDNS" -Direction Inbound `
  -Protocol UDP -LocalPort 5353 -Action Allow
```

## Send types

| Type    | What happens                                                        |
|---------|---------------------------------------------------------------------|
| File    | Native file picker → transfer batch.                                |
| Folder  | Picks a directory, zips it, transfers as one `.zip`.                |
| Text    | Opens a note pad; saves as `Note-<HH:MM>.txt`.                      |
| Paste   | Pulls clipboard; saves as `Pasted-<HH:MM>.txt`.                     |

Received `.txt` files preview inline on the Receive tab.

## Repository layout

| Path                          | What lives here                                |
|-------------------------------|------------------------------------------------|
| `apps/desktop`                | Tauri + React shell                            |
| `apps/mobile`                 | Expo (React Native) app                        |
| `packages/local-backend`      | Node sidecar (HTTP + mDNS + storage)           |
| `packages/protocol`           | Shared types and HTTP client                   |
| `packages/crypto-core`        | X25519 / HKDF / AES-GCM primitives             |
| `packages/shared-ui`          | Web design primitives                          |
| `packages/shared-ui-rn`       | RN design primitives + design tokens           |
| `docs/`                       | Architecture, protocol, security, MVP slice    |

## Hard-won lessons

- `react-native-quick-crypto@0.7.x` has no X25519/HKDF — pure-JS overrides
  live in `packages/crypto-core/src/rn.ts`. Don't upgrade.
- `react-native-quick-base64@2.1.2` + `@craftzdog/react-native-buffer@6.0.5`
  are pinned via root `package.json` pnpm overrides for RN 0.76 autolinking.
- Metro requires `unstable_enablePackageExports: true` for the
  `@dropbeam/crypto-core/rn` subpath import.
- iPhone Personal Hotspot blocks multicast; mDNS won't work — USB and
  manual IP are the only fallbacks there.
- Rebuild the sidecar with `pnpm --filter @dropbeam/local-backend run
  bundle:exe` after any change in `packages/local-backend/src/**`.

## Version

`v0.3.0` — redesign v2 (Receive identity layout, bottom tabs, dark glass
parity, Text + Paste, mDNS-first discovery).

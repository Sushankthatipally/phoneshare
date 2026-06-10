# Sharing files with an iPhone

There is no native iOS build of the DropBeam app yet (building one requires a Mac with
Xcode — the project is currently developed on Windows, see "Why no iOS app" below).
iPhones share files through the **Web Share** browser page instead. It works in Safari
with nothing to install.

## How it works

1. On the desktop app, open the **Send** tab.
2. (Optional) Pick the files you want to give to the phone under *Step 1 · Files*.
3. In the **"No app on the phone?" → Share via browser** panel, click
   **Create browser share link**.
4. A QR code and a link like `http://192.168.1.20:17619/guest/…` appear.
5. On the iPhone, scan the QR with the camera (or type the link into Safari).
6. The page shows the files shared from the PC (tap to download) and an upload
   area to **send files to the PC**. Files the phone uploads appear in the same
   desktop panel under *Received from the phone* with a Save link.

The link is valid for **1 hour** or **10 page loads**, whichever comes first.
Click *Create browser share link* again for a fresh one.

## Network setups that work

| Setup | Works? | Notes |
|---|---|---|
| Both on the same Wi‑Fi router | ✅ | The normal case. |
| PC joined to the iPhone's Personal Hotspot | ✅ | The share link uses the hotspot IP (e.g. `172.20.10.x`). Note: automatic device discovery (mDNS) does **not** work on a hotspot — Apple blocks multicast — but the Web Share link doesn't need discovery. |
| iPhone joined to a hotspot the PC creates | ✅ | Same as above. |
| USB cable (iPhone ↔ Windows PC) | ❌ | Not supported. See below. |

If the phone cannot open the link:
- Make sure both devices are on the **same network** (a phone on mobile data can't reach the PC).
- Windows Firewall: inbound rules for `node.exe` (dev) / `dropbeam-backend.exe`
  (installed app) must be allowed — the installer/dev setup adds these, but if you
  declined the prompt run:
  `New-NetFirewallRule -DisplayName "DropBeam Backend" -Direction Inbound -Protocol TCP -LocalPort 17619 -Action Allow`
- Some routers isolate Wi‑Fi clients from each other ("AP isolation" / "guest network").
  Use the hotspot setup instead.

## Why USB cable doesn't work for iPhone

Android phones get a USB fallback because `adb reverse` can tunnel a TCP port over
the cable. iPhones have no equivalent on Windows: tunneling requires
`libimobiledevice`/`iproxy` **plus an app running on the phone that listens on a
port** — and there is no DropBeam iOS app yet. Once a native iOS app exists
(requires a Mac to build), a cable path can be revisited. Until then, use the
iPhone's Personal Hotspot — it gives a direct, fast, local connection that works
even without any Wi‑Fi router.

## Why no iOS app

- iOS apps can only be compiled and signed on macOS with Xcode.
- The Expo project in `apps/mobile` is iOS-ready in source (the crypto and
  networking layers avoid native modules that would block it), but it has never
  been built or tested for iOS.
- When a Mac is available: `pnpm --filter @dropbeam/mobile exec expo prebuild -p ios`
  then build via Xcode. The `react-native-zeroconf` discovery module needs the
  `NSLocalNetworkUsageDescription` and Bonjour service keys in `Info.plist`
  (`_dropbeam._tcp`).

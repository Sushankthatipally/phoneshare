# DropBeam — Full Rebuild Plan

> Generated 2026-05-23. Aligns the codebase with `DROPBEAM_USER_FLOWS.md` across Desktop (Tauri), Mobile (Expo Android+iOS), Backend (Node sidecar), and the Guest browser flow. Authored by Opus, executed by Sonnet sub-agents.

---

## 0 — Architectural decisions (baked in)

These resolve current drift before any feature work happens. **Do not relitigate during execution.**

1. **The Node sidecar (`packages/local-backend`) is THE production backend.** The Rust modules `server.rs`, `transfer.rs`, `crypto.rs`, `pairing.rs`, `qr.rs`, `mdns.rs` in `apps/desktop/src-tauri/src/` are dead — none are registered as Tauri commands. They will be deleted. The Tauri shell keeps only: `main.rs`, `watcher.rs`, `notify_shell.rs`, `usb_android.rs`, `usb_ios.rs`. The latter two will be exposed as new Tauri commands.

2. **Single source of truth for crypto:** `packages/crypto-core`. `packages/protocol/src/native-crypto.ts` is deleted; `client.ts` imports from `@dropbeam/crypto-core`. Crypto-core gains: `derivePinCode` (6-digit SAS from shared secret), React-Native polyfill adapter (consumes `react-native-quick-crypto` when on RN).

3. **Type contract authority:** `packages/protocol` owns every wire shape. New named types added: `HotspotPairingPayload`, `PinVerificationRequest`, `ResumeToken`, `BackendEventMap` (discriminated union for SSE), `FolderTransferOptions`, `BenchmarkResult`, `CreateGuestShareRequest`, `MultiDeviceSlot`.

4. **Shared design tokens:** `packages/shared-ui/src/tokens.json` (new) — both desktop CSS and mobile React Native consume the same color/radius/font values from this JSON. The DOM `Button` / `Badge` / etc. stay desktop-only.

5. **Transport ports (LOCKED):**
   - `17619/tcp` — Node backend HTTP + SSE (`0.0.0.0`)
   - `49876/tcp` — native TCP transport lane (when added, post-phase-2)
   - `38251/udp` — discovery broadcast (existing); will be replaced by real mDNS over standard `5353/udp` in phase 3

6. **PIN flow:** 6-digit SAS = first 6 digits of base10-encoded `HKDF(sharedSecret, salt=sessionId, info="dropbeam-sas-v1")[0..3]`. Same code derives identically on both sides; phone shows entry field, desktop shows display. Three wrong attempts → backend destroys session + zeros keypair. Spec flow 4.1 honored.

7. **Discovery on phones:** mobile uses `react-native-zeroconf` to publish `_dropbeam._tcp` and listen for the same. Desktop's `mdns.rs` (currently custom UDP broadcast) is rewritten to use the `mdns-sd` crate publishing the same service. Custom UDP discovery is **removed** — it was unreliable on Windows and didn't talk to anything else.

8. **Mobile native modules wire-up:** Existing built modules (`dropbeam-android`, `dropbeam-live-activity`) gain TS bindings in `src/lib/native.ts`. JS code calls them; no new native code unless gap requires it.

---

## 1 — Workstreams (W0–W14, sequenced by dependency)

Each workstream has clear inputs and exit criteria. Sub-agents are dispatched per workstream. Workstreams in the same phase can run in parallel.

### Phase 0 — Foundation (sequential, must complete first)

**W0. Architecture cleanup**
- Delete: `src-tauri/src/{server,transfer,crypto,pairing,qr,mdns}.rs`. Remove their modules from `main.rs`. Strip dead deps from `Cargo.toml` (axum, hyper, tower, tower-http, broadcast channels, x25519-dalek, aes-gcm, hkdf, sha2 — anything only those files used).
- Delete: `packages/protocol/src/native-crypto.ts`. Update `client.ts` to import from `@dropbeam/crypto-core`.
- Audit `pnpm-workspace.yaml` / `turbo.json` for stale entries.
- Exit: `pnpm build` succeeds; `pnpm typecheck` clean; desktop still launches (no behavior change yet).

**W1. Protocol contract expansion**
- Add to `packages/protocol/src/live-backend.ts`: `HotspotPairingPayload`, `PinVerificationRequest`, `PinVerificationResponse`, `ResumeToken`, `FolderTransferOptions`, `BenchmarkResult`, `CreateGuestShareRequest`, `MultiDeviceSlot`, `ReconnectToKnownDeviceRequest`.
- Add to `packages/protocol/src/events.ts`: `BackendEventMap` discriminated union typing every SSE `type` → payload shape. `subscribe()` becomes generic over event name.
- Rename `UploadCheckpoint.nextChunkIndex` → `nextChunk` (align with `UploadSessionRecord`). One canonical name.
- `PairingTransport` becomes `'usb' | 'wifi' | 'hotspot'` (no exclusion). PairingPayload gets a discriminated `mode` field.
- Exit: type-check passes desktop, mobile, and backend.

**W2. Crypto-core gains PIN + RN compatibility**
- Add `derivePinCode(sharedSecret, sessionId): string` returning 6-digit SAS. Same algorithm runs in browser, Node, RN.
- Add `crypto-core/src/rn.ts` — adapter that uses `react-native-quick-crypto`'s `webcrypto` shim if available; falls back to `globalThis.crypto.subtle` otherwise. Mobile imports from this entrypoint via `package.json` `"react-native"` field.
- Vitest tests: PIN determinism, AEAD round-trip, key derivation reproducibility.
- Exit: `pnpm --filter @dropbeam/crypto-core test` green.

**W3. Shared tokens for RN + diagnostic env hardening**
- New `packages/shared-ui/src/tokens.json` mirroring `tokens.css` values. Add `getDesignToken(name)` helper. Desktop CSS still wins, but a new `tokens.css.mjs` script generates the CSS from the JSON to prevent drift.
- New `apps/desktop/scripts/diagnose-windows.ps1` (already referenced by error UI but file missing): prints firewall state for ports 17619/38251/5353, lists candidate LAN IPs with scores, checks adb / iproxy availability, dumps backend health JSON.
- Exit: script runs on Windows and produces useful output.

### Phase 1 — Backend correctness (parallelizable after Phase 0)

**W4. PIN + handshake (Flow 2.1, 4.1)**
- Add `POST /api/sessions/:id/pin-verify` taking 6-digit PIN; backend computes its own SAS and compares constant-time. Wrong attempt count tracked per session (max 3); on 3rd failure: session destroyed, keypair zeroed, broadcast `session-locked` SSE event.
- `acceptSession` no longer derives final session key until PIN passes (key derivation moves to pin-verify step). Session state diagram gains `pin-required` state between `awaitingAccept` and `paired`.
- `MAX_PIN_ATTEMPTS` constant becomes used.
- `pairingKeys` map: persist into `state.json` so backend restarts don't silently break encryption. (Encrypt at rest with a machine-local key derived from `app_data_dir` path? — yes, simple `keytar`-style not needed since these are short-lived; just persist plaintext for now and rotate on restart.)
- Exit: phone scans QR → enters PIN → backend verifies → encrypted session works. Three wrong PINs locks. Persists across backend restart.

**W5. Critical bug bash (backend)**
- `hashFile` becomes streaming (`createReadStream` → `crypto.createHash('sha256').update(...)` per chunk). Handles 25 GB files.
- `createUploadFingerprint` drops `sessionId` from the fingerprint, replaces it with a stable `(direction, fileHash-of-first-256KB, name, relativePath, size, sourceDeviceFingerprint)`. After re-pairing with a new sessionId, the resume lookup finds the existing upload. Flow 3.3 works.
- `incrementGuestUse` semantics fixed: increment once per token-load (HTML page render), not once per file download. `maxUses` now matches user expectation.
- `pairingKeys` persisted (covered in W4).
- `defaultBackendOrigin` and `listLanIPv4` consolidated into one function with VM/VPN/loopback exclusion. Single source.
- `broadcastAdvertisement` deleted (UDP discovery removed in W6).
- `MAX_PIN_ATTEMPTS` integrated (W4).
- `randomUUID` properly imported from `node:crypto` and used consistently.
- Exit: regression tests for resume, large hash, guest maxUses.

**W6. mDNS for desktop**
- Replace `apps/desktop/src-tauri/src/mdns.rs` with `mdns-sd` crate publishing `_dropbeam._tcp.local.` on port 17619 with TXT records: `name`, `id`, `icon`, `transports=wifi,usb`, `version`.
- Add `/api/discovery/manual-add` POST endpoint accepting `{ host, port, label }` for the guest-WiFi fallback (Flow 2.3 edge case).
- Discovery worker subscribes to mDNS browse events; peer list TTL derives from mDNS goodbye packets.
- Exit: desktop and Android phone (after W11) see each other on shared WiFi; manual-add endpoint accepts a typed IP.

**W7. Multi-device, hotspot, reconnect**
- Multi-device: `requestConnect` enforces `connectedDevices.length < session.maxDevices`. New `MultiDeviceSlot[]` field on `LiveSessionRecord`. Single QR can be scanned N times.
- Hotspot: `createSession({ mode: 'hotspot' })` returns a `HotspotPairingPayload` with placeholder SSID/password fields that the Tauri layer (desktop) or `dropbeam-android` (mobile, when host) fills in. Backend doesn't *create* the hotspot — it only carries the credentials in the QR.
- Reconnect: `POST /api/known-devices/:fingerprint/reconnect` — creates a pre-targeted session marked `awaiting-known-device`. When the corresponding phone scans/pairs, ECDH-only path is taken (no PIN) per spec Flow 2.6.
- Exit: 3 phones can pair to one session; reconnect link works in <2 s.

**W8. Background notify + watch folder driver**
- Backend exposes `POST /api/notify/system` taking `{ title, body, sessionId, kind }` — Tauri picks this up via SSE and calls `system_notify` Tauri command. Drives Flow 3.8 desktop side.
- Backend has new `watchFolderTransfers` worker: when a known peer's `connected` event fires, scan that peer's watch-folder config, find new files, auto-start uploads. (Tauri's `watcher.rs` only emits *file-created* events into the desktop renderer; backend keeps the canonical config and drives the upload.)
- Exit: drop a file into watch folder, peer connects, file uploads automatically.

### Phase 2 — Desktop UI (parallelizable after Phase 0–1)

**W9. Bug bash + IncomingBanner expansion**
- Fix `Home.tsx` field names: `health.session_count`, drop bogus `fileCount`.
- Fix `session.pairing.ticket.qrValue` → use whatever the backend returns (`session.pairing.qrPayload`). Update QrCode component to read consistently.
- Fix `Receive.tsx::resolveOrigin` — use `resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API)`.
- Fix `retryFailed` closure: filter ids before calling `sendQueuedFiles`, pass explicit override or use ref.
- Fix folder zip mode: implement actual zipping via `jszip` (already a common Tauri pattern).
- IncomingBanner: extend to surface `session.pendingTransfers` not just pairing requests, and call `system_notify` for off-screen alerts.
- Exit: all 12 cataloged UI bugs verified fixed manually.

**W10. PIN UI, multi-device QR, reconnect targeting**
- `ConnectionScreen` adds a `pin-required` state — large 6-digit display, "enter on phone" copy. On `session-paired` SSE event the screen transitions to success.
- Multi-device session shows slot indicators: `Device 1 ✅ / Device 2 ⏳ / Device 3 ❌`.
- ConnectionPicker known-devices "Reconnect" button calls `POST /api/known-devices/:fp/reconnect` and waits on the SSE event.
- Onboarding step 1 pre-fills from `os::hostname` via new Tauri command `get_system_hostname`. Step 2 gets a Browse button via `tauri_plugin_dialog::open()`.
- Exit: each flow visually matches spec illustrations.

**W11. USB wiring + watch-folder activation + context-menu toggle**
- New Tauri commands: `usb_android_status`, `usb_android_ensure_tunnel`, `usb_android_stop_tunnel`, `usb_ios_status`, `usb_ios_ensure_tunnel`, `usb_ios_stop_tunnel`. Expose `usb_android.rs` and `usb_ios.rs` to JS.
- ConnectionScreen USB mode polls `usb_*_status` every 2 s; on `ready` state, ensures the tunnel and transitions to PIN-display. Remove the amber "needs to be wired in" badge.
- Settings → Watch Folders: on add/save, calls `invoke('start_watch_folder', { path })`. On remove, `stop_watch_folder`. The `dropbeam:watch` event handler in App.tsx posts to the backend's `/api/watch-folder/file-detected` endpoint.
- Settings → Add new "Shell integration" tab with "Install context menu" toggle. Calls `register_context_menu` / `unregister_context_menu`.
- Exit: plug in Android, see "Android detected" within 2 s; watch folder fires uploads; right-click in Explorer shows DropBeam entry.

**W12. Clipboard auto-sync, drag-drop, large-file storage check**
- `useEffect` polls `navigator.clipboard.readText()` every 2 s when window focused (with permission); diffs against last seen value; calls `updateClipboard` when different. Setting toggle to enable/disable.
- `App.tsx` adds `onDrop` handler at document level; files dropped anywhere route to Send screen with paths prefilled.
- Send: large file modal calls `GET /api/peers/:fp/storage` for connected device storage (new backend endpoint that proxies from mobile's reported free space).
- Exit: copy on desktop → phone sees clipboard; drag a folder onto window → Send screen pre-populated; >4 GB warning shows phone free space.

**W13. Diagnostic panel + Dynamic Island desktop counterpart**
- New `Diagnostics` tab in Settings: scrollable log viewer fed by Tauri stdout/stderr (route logs through `tauri::async_runtime::spawn` that pushes lines into an event channel; React reads via SSE-like Tauri channel).
- Shows: backend health, mDNS service state, USB tunnel state, LAN IP candidates ranked, firewall warnings.
- Exit: when something breaks, users can see *why* without opening a terminal.

### Phase 3 — Mobile (parallelizable after Phase 0–1)

**W14. Real session pairing on mobile**
- `parseShareUrl` becomes `parseSessionPayload` — handles three QR formats:
  - Guest HTTP URL (existing)
  - Native pairing JSON: `{ sessionId, transport, host, port, publicKey, expiresAt, mode }`
  - Hotspot pairing JSON: `{ mode: 'hotspot', ssid, password, host, port, publicKey, sessionId, expiresAt }`
- New `src/screens/PinEntryScreen.tsx`: 6-digit OTP-style input. On submit, POSTs to `/api/sessions/:id/pin-verify` with the SAS code derived via `crypto-core/rn`.
- ECDH handshake: phone generates its own keypair, POSTs to `/api/sessions/:id/connect` with `{ publicKey, deviceName, deviceIcon }`; on `session-paired` SSE event, PIN screen advances.
- Session state persisted to `AsyncStorage` so app restart resumes the session.
- Replace `useMobileBackend.ts` mock beacons with real data fed by `src/lib/connection.tsx` + new `useDiscovery()` hook backed by zeroconf.
- Exit: phone fully pairs over WiFi end-to-end without any guest-mode shortcut.

**W15. JS bindings to existing native modules**
- New `src/lib/native.ts`:
  - `joinWifi(ssid, password)` → `DropBeamAndroidModule.joinWifi`. On Android 10+, use the unimplemented `NetworkRequest + ConnectivityManager` path (fix the native module too).
  - `showIncomingNotification(payload)` → `DropBeamAndroidModule.showIncomingNotification`.
  - `startBackgroundReceive()` / `stopBackgroundReceive()` → foreground service.
  - `startLiveActivity({ ... })` / `updateLiveActivity` / `endLiveActivity` → `DropBeamLiveActivity`.
- Fix `IncomingTransferActionReceiver.kt` FOLDER action: open the app via `Intent` with extras instead of posting `"accept"`.
- `IncomingScreen` becomes real: subscribes to incoming SSE events, lets user multi-select files for "Accept Some", calls accept/decline endpoints. Triggers `startLiveActivity` on accept.
- Exit: notification actions work without opening the app; Dynamic Island shows transfer.

**W16. Mobile parity features**
- Real mDNS: add `react-native-zeroconf` (or `tinybonjour`), publish `_dropbeam._tcp` on app launch, browse for peers. Replace mock beacons in `useMobileBackend`.
- Persistence: AsyncStorage for `onboarded`, `deviceName`, `connection`, `knownDevices`, history.
- HotspotJoinScreen "Open WiFi Settings": `Linking.openURL('App-Prefs:root=WIFI')` on iOS; `Linking.sendIntent('android.settings.WIFI_SETTINGS')` on Android.
- `OnboardingScreen` device-name default from `Device.deviceName` (expo-device).
- `MobileApp.tsx` removed (dead dev harness) or fixed export.
- Share sheet receive (Android): add `<intent-filter>` for `ACTION_SEND` + `ACTION_SEND_MULTIPLE` on `MainActivity` with mime types `*/*`. Handle the intent in `MainActivity.kt`, post received URIs to React Native via Expo Modules event. New screen: ShareReceiveScreen lets user pick target device.
- Share sheet receive (iOS): new Share Extension target (`ios/DropBeamShareExtension`). Submits files via `App Group` shared container to the main app on next launch (or via deep link).
- Background fetch: `defineTask('dropbeam-background-receive', ...)` registered in root layout; calls `startBackgroundReceive` foreground service on Android.
- Folder send: `expo-document-picker` doesn't do folders. Add native bridge: Android uses `OpenDocumentTree` (SAF), iOS doesn't allow arbitrary folders — limit to "iCloud Drive folder via UIDocumentPickerViewController" for folders.
- Clipboard sync: `expo-clipboard.getStringAsync()` polled when app foregrounds; pushes via `POST /api/clipboard`.
- HistoryScreen: tap entry → detail modal with "Retry transfer" button that re-creates a session targeting the same fingerprint.
- Storage check: `expo-file-system.getFreeDiskStorageAsync()` before accepting large transfers.
- `Notifications.setNotificationHandler` configured in `_layout.tsx`.
- Exit: every Part 3 + Part 5 flow on mobile reaches "spec-implemented" state.

### Phase 4 — Browser guest (parallelizable after Phase 1)

**W17. Guest browser polish**
- `/guest/:token` page already exists. Add: dark/light mode, per-file progress bars, large-file warning, mobile-optimized layout.
- QR encodes `lanUrl` reliably — fix the `defaultBackendOrigin` LAN picker (in W5).
- Add E2E playwright test: spin up backend with fixture share, open guest URL in Chromium, download file, assert checksum.
- Exit: a stranger on the same WiFi can scan the QR, download a file, with no app installed, and it Just Works on iOS Safari and Android Chrome.

### Phase 5 — Integration (sequential, must be last)

**W18. End-to-end verification**
- Walk through each flow in `DROPBEAM_USER_FLOWS.md`. For each, screenshot the actual screen, compare to spec illustration, log discrepancies, fix.
- Adversarial: airplane mode + USB, mDNS-blocked WiFi (manual-add fallback), 3 wrong PINs, mid-transfer disconnect → resume.
- Performance: 25 GB single file via USB ≤ 90s on USB 3.0. WiFi 6 ≥ 80 MB/s effective.
- Write `docs/E2E_REPORT.md` checklisting all flows ✅/🟡/❌ for the user to verify.
- Exit: every Part 2/3/4/5/6 flow has a ✅ in the report.

---

## 2 — Dispatch model

- I (Opus) plan, review, and stitch findings. I do not write code.
- Each W{n} is dispatched as one or more **Sonnet sub-agents** in parallel where dependencies allow.
- Each sub-agent receives: the workstream brief, the spec excerpt for its flows, the relevant source files identified in the survey, and a clear exit criterion.
- After every phase, I review the diffs, run typecheck + build + targeted smoke tests, fix any cross-cutting issues, and brief the next wave.
- The Plan file (this document) and the task list are the single source of truth for what's done vs in flight.

---

## 3 — Estimated effort

| Phase | Sub-agents | Wall-clock (parallel) |
|---|---|---|
| 0 (W0–W3) | 4 (one per workstream, serial because foundation) | ~30–60 min |
| 1 (W4–W8) | 5 in parallel | ~60–90 min |
| 2 (W9–W13) | 5 in parallel | ~90–120 min |
| 3 (W14–W16) | 3 (each large, may sub-fan) | ~120–180 min |
| 4 (W17) | 1 | ~30 min |
| 5 (W18) | 1 + Opus review | ~60 min |

Total parallel: ~6–9 hours of agent time; significantly more sequential CPU.

---

## 4 — Non-goals for this rebuild

- **No new visual design.** Existing shared-ui tokens are kept. Polish passes are post-rebuild.
- **No App Store / Play Store submission.** Local dev builds only.
- **No paid signing certificates.** Windows SmartScreen warning is acceptable for now.
- **No cross-LAN / WAN relay.** DropBeam is fundamentally local; nothing here implements TURN/STUN/cloud relay.
- **No iOS hotspot creation programmatically.** iOS doesn't permit it — manual Personal Hotspot guidance (Flow 6.4) is what we ship.

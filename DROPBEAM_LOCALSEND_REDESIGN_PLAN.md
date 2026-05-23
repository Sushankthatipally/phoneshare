# DropBeam → LocalSend-style Redesign Plan

**Audience:** A fresh Claude Code session (Opus 4.7 / Max plan) executing this end-to-end.
**Status:** Approved by product owner. Execute in phases. Stop and ask before deviating.
**Written:** 2026-05-24 after a long debugging session that fixed pairing + first-pass file transfer.
**Visual reference:** Two LocalSend screenshots live at repo root: `localsend1.png` (Receive screen) and `localsend2.png` (Send screen). Open both and study them before writing UI code.

> 🛑 **READ SECTION 1.5 BEFORE WRITING ANY UI CODE.** The current mobile app does not visually match the desktop (it references invented token paths that resolve to `undefined`). The owner explicitly called the mobile UI "AI slop." Section 1.5 contains the 10 design parity rules. Violating them = rework.

---

## 1. Read this section first (state of the repo today)

The repo is `C:\Users\nani\Desktop\phoneshare`. Turbo-pnpm monorepo with three apps and shared packages. `master` is the deployable branch.

**What works today (confirmed in the previous session, see commit log):**

- Desktop = Tauri 2 shell + bundled Node sidecar (`dropbeam-backend-x86_64-pc-windows-msvc.exe`). The sidecar auto-spawns on app launch — never run `node` separately.
- Mobile = Expo SDK 52 dev-client. The APK on the test device is `com.dropbeam.mobile`. Open it from the app drawer (never Expo Go).
- ECDH handshake between phone and desktop succeeds. The phone scans a desktop-generated QR, derives X25519 keys via `@noble/curves`, derives HKDF + SAS via `@noble/hashes`, POSTs `/connect`, backend auto-pairs (no PIN, no Accept), both sides flip to `paired`.
- Backend has `requestTransferBatch`, `acceptTransferBatch`, `declineTransferBatch`, chunked uploads via `/uploads/start` → `/uploads/{id}/chunks/{n}` → `/uploads/{id}/complete`, and `/api/files/{id}/download` for raw payload.
- Desktop `Send.tsx` requests a transfer batch first, waits for SSE `transfer-accepted`, then uploads. **Not yet end-to-end verified.**
- Phone `IncomingScreen.tsx` downloads files via `expo-file-system` to `documentDirectory/dropbeam/` on `file-uploaded` events whose names match the accepted batch. **Not yet end-to-end verified.**

**What's broken or unsupported today:**

- The "Connect" tab on the phone still uses QR-scan flow. There is no discovery UI.
- mDNS publish-and-browse is half-wired. `mdns-sd` Rust crate is in `Cargo.toml`, `react-native-zeroconf` is installed, but the desktop does not actually publish itself and the phone's `useDiscovery` returns empty in practice.
- iOS has NEVER been built or run. `apps/mobile/ios/` exists but `expo prebuild --platform ios` has not been executed.
- Phone→desktop direction not tested.
- USB transport works via ADB reverse tunneling but the UI doesn't auto-prefer it.

**Hard-won lessons from the previous session (do not relitigate these — they ARE the right answers):**

1. **`react-native-quick-crypto@0.7.x` does NOT support X25519, HKDF, or fully-installed `getRandomValues`.** Pure-JS overrides via `@noble/curves` and `@noble/hashes` live in `packages/crypto-core/src/rn.ts`. Do not try to upgrade quick-crypto to v1.x — it pulls `react-native-nitro-modules` which breaks the RN 0.76 build.
2. **`react-native-quick-base64` v3 is incompatible with RN 0.76 autolinking** (built against RN 0.85's codegen). Pinned to `2.1.2` via pnpm overrides in root `package.json`. `@craftzdog/react-native-buffer` is pinned to `6.0.5` for the same reason.
3. **Metro requires `unstable_enablePackageExports: true`** in `metro.config.js` for `@dropbeam/crypto-core/rn` subpath import to resolve.
4. **React 18 StrictMode** double-runs effects. Don't use `let cancelled = false` + cleanup pattern in `ConnectionScreen.tsx`'s session-create effect — it drops `setSessionId` on the first run.
5. **Tauri 2 `tauri.conf.json` MUST have `build.beforeDevCommand: "pnpm dev"`** or `tauri:dev` hangs waiting for Vite forever.
6. **JDK 17 only.** Newer JDKs (e.g. 25) break Gradle plugin resolution. Verify with `java -version` before any Android build.
7. **iPhone Personal Hotspot blocks multicast.** mDNS discovery WILL NOT WORK on iPhone hotspot — only on real Wi-Fi routers. Plan accordingly: USB tunnel and manual-IP fallbacks are mandatory.
8. **No `Read-Host`, no interactive prompts.** All Bash/PowerShell commands you run must be non-interactive. The harness fails on prompts.

**Reference docs in the repo:**

- `DROPBEAM_USER_FLOWS.md` — original feature vision.
- `DROPBEAM_REBUILD_PLAN.md` — original W0–W18 plan. Most items ✅, see `PROGRESS.md`.
- `PROGRESS.md` — overnight autonomous run summary.
- `apps/mobile/ios/README.md` — iOS share-extension notes (still deferred).
- `localsend1.png`, `localsend2.png` — UI reference screenshots.
- This file.

---

## 1.5 Design parity rules (READ THIS BEFORE ANY UI WORK)

The mobile app today does NOT match the desktop. The product owner flagged this directly as "AI slop." Root cause: the mobile screens reference invented token paths (`tokens.color.overlay`, `tokens.fontSize.title`, `tokens.fontSize.bodyLg`, `tokens.fontSize.caption`, `tokens.lineHeight.body`) that don't exist in the canonical `packages/shared-ui/src/tokens.json` — they resolve to `undefined` at runtime, so colors, type sizes, and spacing fall back to RN defaults.

**Hard rules — enforce these on every UI change you write:**

1. **The desktop is the source of truth for visual design.** Color palette, type scale, spacing rhythm, panel borders, radii, shadow depth, button shapes. Open `apps/desktop/src/styles.css` and `packages/shared-ui/src/tokens.json` BEFORE writing any new mobile screen. If the desktop doesn't have a token for something you need, ADD it to the canonical tokens (both platforms) — never invent a mobile-only token.

2. **One token source.** `packages/shared-ui/src/tokens.json` is canonical. Every other token file (`tokens.ts`, `tokens.css`, `shared-ui-rn/src/tokens.ts`) is a generated or re-exported mirror. If you need to add `tokens.color.overlay`, edit `tokens.json` first, then regenerate or hand-mirror to `tokens.ts` and `tokens.css`. Don't touch the mirrors directly.

3. **No raw colors, no raw font sizes, no raw spacing.** Every `color`, `fontSize`, `padding`, `margin`, `gap`, `borderRadius`, `lineHeight` in mobile code MUST come from `tokens.*`. If you find yourself typing a hex code or a literal number in `StyleSheet.create`, stop and add the value to tokens first.

4. **Component parity.** For every desktop UI element you build (a panel, a card, a row, a pill), the mobile equivalent MUST use the same `@dropbeam/shared-ui-rn` component as the desktop uses from `@dropbeam/shared-ui`. If a primitive is missing in shared-ui-rn (e.g. `<Pill>`), add it to both packages with identical APIs (same props, same variants).

5. **Type hierarchy parity.** Desktop H1 (`.modal__title`, `28px`, `600 weight`, `-0.01em letter-spacing`) ⇒ mobile must use `tokens.fontSize.xl` + `tokens.fontWeight.semibold` + `tokens.letterSpacing.tight`. Match each tier (eyebrow, title, copy, dim copy, meta) by reading the desktop CSS and mapping each rule to its token.

6. **Panel + radius parity.** Desktop uses `border-radius: var(--db-radius-lg)` (= 8) for major panels, `var(--db-radius-xl)` (= 10) for buttons/inputs. Mobile must use `tokens.radius.lg` and `tokens.radius.xl` for the same elements. Don't pick radii by feel.

7. **Spacing rhythm parity.** Desktop uses 8-pt rhythm (`tokens.spacing.sm/md/lg/xl` = 8/12/16/24). Mobile must use the same scale. No 7px, no 13px, no 18px values.

8. **Compare side-by-side before committing.** For every screen you build, set up a desktop screenshot and a mobile screenshot at equivalent breakpoints and visually compare: panel borders the same color and thickness? Type sizes proportional? Buttons the same height and corner radius? Disabled state the same opacity (`tokens.opacity.disabled` = 0.48)? If anything looks AI-generated rather than designed, fix before moving on.

9. **Reject ad-hoc styling.** If you see existing mobile screens with inline `style={{}}` literals containing hex colors or pixel numbers, refactor them to tokens as you touch them. Boy-scout rule.

10. **Verify token usage with grep before each commit:**
    ```powershell
    # No invented tokens:
    Select-String -Path "apps\mobile\src\**\*.ts*" -Pattern "tokens\.\w+\.\w+" -AllMatches |
      ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
    # Cross-check each result against tokens.json. ZERO mismatches allowed.
    ```

If any of these rules is hard to follow because the token system itself is missing a needed primitive, STOP and add the primitive to tokens.json first. Don't work around the design system.

---

## 2. Product owner's locked-in decisions

1. **UI pattern = list, NOT radial.** LocalSend's screenshots are the reference. Receive tab is a passive "this is me" screen. Send tab has a Selection row (4 cards) above a list of Nearby devices as cards. Do not build a radial / circular layout.
2. **Visual style = DropBeam's existing dark aesthetic.** Reuse `@dropbeam/shared-ui` (desktop) and `@dropbeam/shared-ui-rn` (mobile) tokens. Do NOT copy LocalSend's light-teal palette. Match `GlassPanel`, `SectionHeading`, `Badge`, existing radii / spacing.
3. **iOS support:** Mac available, **NO paid Apple Developer account**. Build target: sideload onto user's iPhone via Xcode with free personal Apple ID. 7-day signing expiry is acceptable for daily testing. No TestFlight, no App Store.
4. **Network reality is mixed.** Sometimes a real Wi-Fi router (mDNS works), sometimes iPhone hotspot (mDNS fails). Discovery chain: **mDNS → USB tunnel → manual IP entry → QR scan (last resort)**.
5. **Pairing = silent auto-pair on tap.** No PIN. No per-pair Accept. Per-batch file Accept/Decline on the receiver is sufficient trust.
6. **Quick Save tri-state (per LocalSend):** Off / Favorites / On. Off = always show Accept/Decline. Favorites = auto-accept only from hearted devices. On = auto-accept everything. Persist setting in backend `settings.quickSave`.
7. **Friendly names = adjective + noun.** Generated locally on first launch (e.g. "Tidy Strawberry"), persisted in settings, editable in Settings screen. Built-in word lists in code; ~80 adjectives × 80 nouns = 6,400 combinations.
8. **All four Selection types ship:** File, Folder, Text, Paste. Folder send infrastructure already exists in `apps/mobile/src/lib/folder-send.ts` and desktop uses `jszip`. Text/Paste are new (small additions).
9. **Hotspot mode (desktop creates Wi-Fi) — OUT OF SCOPE.** Skip entirely.
10. **File destination on phone = app sandbox** (`documentDirectory/dropbeam/`) for v1, with a Share button per received file (uses `expo-sharing`). User explicitly does not want public-Downloads auto-save in v1.

---

## 3. Goals & non-goals

### Goals (must ship to call this done)

1. **Phone home / index route = Send screen** (tap a device → send) by default. Two-tab nav: Receive | Send. Settings reachable from a top-right gear.
2. **Send screen layout matches LocalSend's screen 2:**
   - "Selection" header.
   - Row of 4 cards: File / Folder / Text / Paste (mobile) — pick the source first.
   - "Nearby devices" header with action icons (refresh / aim / favorites-filter / settings).
   - Vertical list of device cards. Each card: device icon (phone/laptop/desktop/tablet by platform) + friendly name + small hashtag tag (e.g. "#1") + platform tag (e.g. "iPhone", "Windows") + heart-favorite button on right.
   - Tap a device card → send the selected items to that device.
   - Empty state: "Looking nearby…" → after 8s show "Plug in USB" and "Enter IP" CTAs.
3. **Receive screen layout matches LocalSend's screen 1:**
   - Big device-icon glyph (the existing pulsing wifi-ring concept is fine; just don't make it a radial DEVICE picker).
   - Friendly name in large type (e.g. "Tidy Strawberry").
   - Small hashtag IDs below (e.g. "#5 #1" — derive these from a 4-digit hash of the device fingerprint for memorability).
   - Quick Save row at the bottom: three segmented buttons "Off | Favorites | On".
4. **Settings screen:**
   - Edit friendly name (with a Regenerate button that picks a new adjective+noun combo).
   - Toggle Quick Save tri-state (mirrors the Receive screen's segmented control).
   - List of Favorite devices (heart-managed from Send screen).
   - Existing dev/diagnostics tabs preserved (don't break them).
5. **Discovery chain works:**
   - Phone broadcasts on `_dropbeam._tcp` via `react-native-zeroconf`.
   - Desktop publishes on `_dropbeam._tcp` via `bonjour-service` (pure JS, no native deps) with TXT records: `v=1`, `n=<friendlyName>`, `p=<platform>`, `pk=<base64url pubkey>`, `sid=<sessionId>`, `port=17619`, `fp=<fingerprint>`.
   - Phone browses, parses TXT, populates the Nearby devices list.
   - When mDNS yields nothing: USB tunnel check (`localhost:17619/api/health`) + manual IP + QR scan are the fallbacks.
6. **Tap a device on the Send list → silent auto-pair** using TXT data → if Selection has items, immediately initiate the transfer batch. If nothing selected, navigate to a "Pick what to send" flow.
7. **Desktop has the same Receive/Send/Settings structure** as the phone. Receive shows desktop's friendly name + Quick Save. Send shows Selection cards + Nearby devices list.
8. **Quick Save honored in `acceptSession` / `acceptTransferBatch`:**
   - `Off` = always require manual accept (current behavior).
   - `Favorites` = if `peer.fingerprint` is in `favorites[]`, auto-accept the transfer; else require manual accept.
   - `On` = auto-accept every transfer batch on this device.
9. **Favorites = hearted devices** stored in backend settings. Heart icon on each device card. Tap to toggle. Synced via SSE so both desktop and mobile reflect changes.
10. **iOS sideload works** for at least: mDNS discovery (on a real router) + receive a file. The Send/Receive screens render correctly on iOS via `@dropbeam/shared-ui-rn`.
11. **USB transport auto-preferred.** If the phone-side discovery probe of `localhost:17619` 200s, a synthetic USB peer appears at the top of the Nearby devices list with a wired icon.

### Non-goals (don't build these — defer)

- Radial / circular device picker. Confirmed by user: list view only.
- Desktop-as-hotspot (creating its own Wi-Fi network).
- Multi-device "send to N peers at once" UI (backend supports it; defer the UI to a later plan).
- iOS Share Extension (deferred — see `apps/mobile/ios/README.md`).
- Resumable uploads after network drop.
- Public Downloads / Photos auto-save on phone. Share button per file is the v1 export path.
- Background-receive while app is fully closed.
- Web/browser-guest mode polish (W17 is already ✅).
- Watch folders, clipboard sync, history retry — they exist (W11–W16). Don't break them, don't expand them.
- Multi-window desktop. Keep the single-window shell.

---

## 4. Phased plan

Execute phases strictly in order. **Verify each phase manually before starting the next.** If a phase fails to verify, fix in place — don't pile on the next phase.

### Phase 0 — Dependency / config sanity check (≈20 min) [START HERE]

Before writing any code, verify the workspace is in a buildable, well-configured state. Many bugs from the previous session would have been caught earlier with this check.

**0.1 Tooling versions:**
```powershell
node --version           # >= 20.x
pnpm --version           # 10.27.x
java -version            # MUST be 17.x (NOT 21, 25, etc.)
rustc --version          # >= 1.80
adb --version            # any modern
# On Mac (for iOS phase):
xcode-select -p          # should print Xcode path
```
If JDK is wrong, install Temurin 17 and set `JAVA_HOME` before any Android build. If `xcode-select -p` errors on the Mac, run `sudo xcode-select --install` first.

**0.2 Lockfile + workspace integrity:**
```powershell
cd C:\Users\nani\Desktop\phoneshare
pnpm install --frozen-lockfile
# If --frozen-lockfile fails:
#   - inspect pnpm-lock.yaml diff and the warnings.
#   - DO NOT silently re-resolve. Determine root cause first.
pnpm typecheck
```
All packages should typecheck clean. If `@dropbeam/mobile` fails on `@dropbeam/crypto-core/rn`, your Metro config rolled back — `unstable_enablePackageExports` must still be `true` in `apps/mobile/metro.config.js`.

**0.3 Pinned versions sanity (these were load-bearing in the previous session):**
```powershell
# In root package.json, "pnpm.overrides" MUST contain:
#   "@craftzdog/react-native-buffer": "6.0.5"
#   "react-native-quick-base64": "2.1.2"
Get-Content package.json | Select-String -Pattern "quick-base64|react-native-buffer"

# Crypto-core peer dep MUST be ^0.7.0 (NOT >=0.7.0):
Get-Content packages\crypto-core\package.json | Select-String -Pattern "quick-crypto"

# Mobile MUST list these direct deps:
#   "@noble/curves": "^1.6.0"
#   "@noble/hashes": "^1.5.0"
#   "react-native-quick-base64": "2.1.2"
#   "react-native-quick-crypto": "^0.7.6"
Get-Content apps\mobile\package.json | Select-String -Pattern "noble|quick-"

# Only ONE quick-crypto in pnpm store:
Get-ChildItem node_modules\.pnpm -Directory | Where-Object Name -like "react-native-quick-crypto*"
# Must show exactly one directory.
```
If any of these don't match, restore them from this plan and re-install.

**0.4 Backend sidecar binary check:**
```powershell
Get-Item apps\desktop\src-tauri\binaries\dropbeam-backend-x86_64-pc-windows-msvc.exe |
  Select-Object Length, LastWriteTime
```
If missing, rebuild:
```powershell
pnpm --filter @dropbeam/local-backend run bundle:js
pnpm --filter @dropbeam/local-backend run bundle:exe
```

**0.5 Tauri capabilities / config:**
- `apps/desktop/src-tauri/tauri.conf.json` MUST have `build.beforeDevCommand: "pnpm dev"` and `build.beforeBuildCommand: "pnpm build"`. If missing, `tauri:dev` will hang.
- `apps/desktop/src-tauri/Cargo.toml` MUST keep `mdns-sd`, `gethostname`, `hostname`, `chrono` deps. If any went missing, restore.

**0.6 Phone build prerequisites:**
- `apps/mobile/android/` exists. If not, run `cd apps/mobile && npx expo prebuild --platform android` first.
- ADB sees the device: `adb devices` shows a serial in "device" state.
- `apps/mobile/ios/` — exists or doesn't (iOS phase will create it).

**0.7 Design-token parity audit (CRITICAL — current mobile UI is broken because of this):**

The mobile screens currently reference token paths that don't exist in `packages/shared-ui/src/tokens.json`, causing silent `undefined` at runtime and the "AI slop" look the user called out. **Before touching any UI**, run a grep audit and fix every mismatch:

```powershell
# List every token path the mobile codebase references:
Select-String -Path "apps\mobile\src\**\*.ts*" -Pattern "tokens\.\w+\.\w+" -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique > token-usage.txt

# Compare against the canonical paths in tokens.json:
Get-Content packages\shared-ui\src\tokens.json | ConvertFrom-Json
# Walk: color.*, radius.*, spacing.*, font.*, fontFamily.*, fontSize.*,
#       fontWeight.*, letterSpacing.*, lineHeight.*, opacity.*, shadow.*
```

Known offenders found in the previous session that MUST be fixed before any new mobile screen lands:
- `tokens.color.overlay` → does not exist. Add it to `tokens.json` (suggested: `"rgba(0, 0, 0, 0.55)"`) AND update every caller.
- `tokens.fontSize.title` → does not exist. Either add (suggested: `28`) or callers should use `tokens.fontSize.xl` (24).
- `tokens.fontSize.bodyLg` → does not exist. Add (suggested: `16`, alias of `md`) or callers use `tokens.fontSize.md`.
- `tokens.fontSize.caption` → does not exist. Add (suggested: `12`) or use `tokens.fontSize.xs` (11).
- `tokens.lineHeight.body` → does not exist. Use `tokens.lineHeight.normal` (1.5) or `tokens.lineHeight.relaxed` (1.65).

**Decision rule for adding vs renaming:** if a token semantically belongs in the system and the desktop CSS uses an equivalent variable (`--db-overlay`, `--db-font-title-size`), ADD it to `tokens.json` AND mirror to `tokens.css`/`tokens.ts` so both platforms get it. If it's a one-off in mobile code only, rename the caller to use an existing token.

After fixing the canonical `tokens.json`:
```powershell
# Regenerate the auxiliary token files (tokens.ts, tokens.css, design-tokens.md):
node packages\shared-ui\scripts\generate-tokens.mjs  # if this exists
# OR manually update packages/shared-ui/src/tokens.ts and tokens.css to mirror tokens.json
pnpm typecheck   # must remain clean across all packages
```

**0.8 Visual baseline screenshots:**

Before any UI changes, capture screenshots of the current desktop:
```powershell
# Run the desktop and screenshot each screen (Receive, Send, Settings, Diagnostics).
# Save under docs/baseline/desktop-<screen>.png
```
The next Claude session uses these as the visual reference for "match the desktop style on mobile." Color, spacing, type hierarchy, panel borders, button shapes — copy them precisely. The mobile is the dependent; desktop is the source of truth.

**Verify Phase 0:** `pnpm typecheck` is clean across all 7 packages. No version mismatches. Backend sidecar binary present. Tauri config has the `beforeDevCommand`. **Every mobile `tokens.xxx.yyy` reference resolves to a defined token path.** Baseline screenshots captured. Commit any drift fixes:
```powershell
git checkout -b localsend/00-sanity
git add -A
git commit -m "chore(localsend): pre-redesign dependency + token parity sanity"
git checkout master
git merge --no-ff localsend/00-sanity
```

### Phase A — Verify pairing + file-transfer baseline (≈30 min)

Confirm what the previous session shipped actually works before redesigning anything on top.

**A.1** From repo root:
```powershell
Stop-Process -Name dropbeam-desktop -Force -ErrorAction SilentlyContinue
Get-Process | Where-Object Name -like "dropbeam-backend*" | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item -Force "$env:APPDATA\com.dropbeam.desktop\backend\state.json" -ErrorAction SilentlyContinue
pnpm --filter @dropbeam/desktop tauri:dev
```

**A.2** Phone Metro still running (or restart):
```powershell
pnpm --filter @dropbeam/mobile android
adb reverse tcp:8081 tcp:8081
adb reverse tcp:17619 tcp:17619
```

**A.3** Pair (current QR flow): Desktop → New session → Wi-Fi → QR. Phone → Scan → both flip to `paired` in <2s.

**A.4** Send a file desktop → phone: Send tab → pick a small file → select the phone → Send. Desktop shows "Waiting for phone to accept…". Phone → Incoming tab → Accept all. Phone shows "Saved: <filename>" and a Received card with the URI.

If A.4 fails, fix in place. Likely failure modes:
- Desktop hangs on "Waiting…" → SSE envelope shape. `apps/desktop/src/features/dashboard/useDesktopBackend.ts` `subscribeEvent` forwards the full envelope `{ type, payload }`. The `Send.tsx` handler reads `evt.payload.batchId`.
- Phone Accept but no download → `IncomingScreen.tsx` name-match logic; backend sanitizes filenames in `sanitizeFileName`. Match on the sanitized name or compute the same sanitization on the phone.
- 404 on `/api/files/{id}/download` → file ID from `file-uploaded` event is `record.id` from `completeUpload`, not the batch file ID.

**A.5** Checkpoint:
```powershell
git checkout -b localsend/01-baseline-works
git add -A
git commit -m "checkpoint: pairing + first-pass file transfer verified"
git checkout master
git merge --no-ff localsend/01-baseline-works
git tag v0.1.1-pairing-works
```

### Phase B — Backend foundations: friendly names, mDNS, Quick Save, favorites (≈2 hr)

**B.1 Friendly-name generator** in `packages/local-backend/src/friendly-name.js` (new):
```js
const ADJECTIVES = ['Tidy', 'Fantastic', 'Quiet', 'Bright', 'Eager', 'Gentle', /* ~80 entries */];
const NOUNS = ['Strawberry', 'Lettuce', 'Forest', 'Comet', 'Harbor', 'Lantern', /* ~80 entries */];
export function generateFriendlyName(seed?: string) { ... }
```
Seed-deterministic so the same fingerprint always gets the same name (for reproducibility in tests).

**B.2 Hashtag IDs** = first 4 hex chars of the SHA-256 of the device fingerprint, displayed as `#XXXX`. Compute once at boot, persist in settings.

**B.3 Extend settings** in `packages/local-backend/src/store.js`:
```js
settings: {
  // ... existing
  friendlyName: 'Tidy Strawberry',
  hashtag: '#a3f1',
  quickSave: 'off',         // 'off' | 'favorites' | 'on'
  favorites: [],            // array of device fingerprints
}
```
Add routes:
- `PATCH /api/settings` (already exists — make sure it persists the new fields).
- `POST /api/favorites` body `{ fingerprint }` — add.
- `DELETE /api/favorites/:fingerprint` — remove.

**B.4 Apply Quick Save in transfer flow** (`store.js`):
- In `acceptTransferBatch`, no change.
- In `requestTransferBatch` (when a remote peer initiates): check `settings.quickSave`:
  - `on` → immediately call `acceptTransferBatch` for the batch.
  - `favorites` + peer fingerprint is in `settings.favorites` → same auto-accept.
  - otherwise → standard manual accept flow.

**B.5 mDNS publish/browse** using `bonjour-service` (pure JS, no native deps). Replace any custom UDP code in `packages/local-backend/src/discovery.js`:
- Publish service `_dropbeam._tcp.local.` on port 17619.
- TXT: `v=1`, `n=<friendlyName>`, `tag=<hashtag>`, `p=win32|darwin|linux`, `pk=<pubkey>`, `sid=<discoverySessionId>`, `fp=<fingerprint>`.
- Browser: subscribe to add/remove events, maintain a peer table, expose at `/api/discovery` with merged self-peer + observed-peers (already half-implemented).

**B.6 Discovery session** = always-active session created at backend startup. Real ECDH keypair, state `pairing`, flagged `meta.discovery: true`. When a phone POSTs `/connect`, auto-pair runs (existing flow) and the session graduates; backend creates the next discovery session and re-publishes mDNS TXT with the new pubkey + sid.

**B.7 USB-detected peer injection** on the desktop's `/api/discovery`: when `usb_android.rs` reports a tunneled device, append a synthetic peer to the discovery list with `transport: 'usb', host: 'localhost', port: 17619, preferred: true`.

**B.8 Verify Phase B:**
- `curl http://127.0.0.1:17619/api/settings` shows new fields.
- `curl http://127.0.0.1:17619/api/discovery` shows self-peer with full TXT data.
- On a real Wi-Fi router, `dns-sd -B _dropbeam._tcp` (mac) or `Resolve-DnsName -Type PTR _dropbeam._tcp.local` (Windows) lists the desktop.
- Quick Save = `on`, send a file from another paired device → no Accept prompt appears.
- Heart a device in favorites, set Quick Save = `favorites`, send from that device → auto-accept; send from an unfavorited device → manual accept.

Checkpoint commit: `feat(localsend): backend foundations — friendly names, mDNS, Quick Save, favorites`.

### Phase C — Mobile UI: Send / Receive / Settings (≈3 hr)

This phase replaces the current "Connect" tab.

**C.1 Route structure** in `apps/mobile/app/`:
- `index.tsx` → Send screen (default landing).
- `receive.tsx` → Receive screen (passive identity).
- `settings.tsx` → Settings (already exists; extend).
- Bottom-nav (or top-tab) with Receive | Send | Settings. Use Expo Router's tabs layout.

**C.2 Send screen** (`apps/mobile/src/screens/SendScreen.tsx`, refactor existing):
- Top: "Selection" `<SectionHeading>` then a row of 4 `<GlassPanel>` cards: File / Folder / Text / Paste. Each card shows an icon + label. Tap → opens a picker:
  - File → `expo-document-picker.getDocumentAsync({ multiple: true })`.
  - Folder → existing `folder-send.ts` SAF flow.
  - Text → a small modal `TextInput` (multi-line) + Send button — sends as `.txt`.
  - Paste → `expo-clipboard.getStringAsync()`, preview, Send button.
- Below selection: an inline pill row showing currently selected items count + total size + a small × to clear.
- "Nearby devices" `<SectionHeading>` with right-side icon row: refresh, favorites-filter toggle, settings (cog).
- Vertical scroll list of device cards (`<DeviceCard>` new component):
  - 56px icon by platform.
  - Friendly name (16pt semibold).
  - Hashtag pill + platform pill.
  - Heart icon on the right — tap toggles `favorites` via backend API.
  - Tap the card → if selection is empty, show a brief inline hint "Pick what to send first"; else initiate `requestTransferBatch` for selected items to that peer.
- Empty state: after 3s of zero peers, show "Looking nearby…" with the existing scanning spinner. After 8s, replace with two CTAs: "Plug in USB" (opens a modal with copy-pasteable `adb reverse` instructions) and "Enter IP manually" (opens a small form).

**C.3 Receive screen** (`apps/mobile/src/screens/ReceiveScreen.tsx`, new):
- Large centered pulsing icon (reuse the existing `connection__pulse` animation concept).
- Friendly name (28pt bold).
- Hashtag IDs below in muted text.
- Quick Save segmented control at the bottom: three buttons "Off | Favorites | On". Backed by `settings.quickSave`.
- Below that: a list of in-flight + recent transfers (reuse `History` data, filtered to `phone-to-desktop` or `desktop-to-phone` direction — show both with arrows).

**C.4 Settings additions:**
- Friendly name field with a Regenerate button (calls a new backend route `POST /api/settings/regenerate-name`).
- Hashtag field (read-only — derived from fingerprint).
- Quick Save segmented control (mirrors Receive screen).
- Favorites list with remove buttons.

**C.5 `DeviceCard` component** in `apps/mobile/src/components/DeviceCard.tsx` (new) — used by Send screen and Settings favorites list:
- Props: `{ peer, isFavorite, onTap, onToggleFavorite, transport, status }`.
- Render: glass panel, platform icon, friendly name, hashtag pill, platform pill, transport pill (if USB or hotspot), heart button.
- Heart button calls `POST /api/favorites` / `DELETE /api/favorites/:fp` via the backend client.

**C.6 Discovery hook update** in `apps/mobile/src/lib/discovery.ts`:
- Start `react-native-zeroconf` on app launch.
- Parse each found service's TXT records into `DiscoveredPeer`.
- Also poll `http://localhost:17619/api/health` every 5s; on 200 inject the USB synthetic peer.
- Persist last-seen peers in `AsyncStorage` so the list isn't empty for the first 2-3s after app launch.

**C.7 Verify Phase C:**
- Open phone app. Default lands on Send screen.
- Without any desktop running: empty state appears, with CTAs after 8s.
- Start desktop on the same real Wi-Fi: device card appears in the list with friendly name + hashtag + Windows platform pill.
- Receive tab shows phone's own friendly name + Quick Save toggle.
- Settings tab shows the same friendly name (editable), Quick Save mirror, and an empty Favorites list.
- Heart the desktop card on Send → it appears in Settings → Favorites.

Commit: `feat(localsend): mobile Send/Receive/Settings screens`.

### Phase D — Auto-pair on device-card tap (≈30 min)

**D.1** `<DeviceCard>` `onTap` handler:
- If Selection is empty AND user just tapped a device card: subtle inline message "Pick what to send first" (don't block).
- If Selection has items: construct `DirectSessionPayload` from the peer's TXT data:
  ```ts
  { kind: 'direct', payload: { sessionId: peer.sessionId, transport: peer.transport, host: peer.host, port: peer.port, publicKey: peer.publicKey, expiresAt: <synthetic 10-min future> }, label: peer.name }
  ```
- Call `startDirectHandshake` from `useConnection`. Existing handshake runs, ends in `paired`.
- Immediately after `paired`: call `requestTransferBatch` for the selected items via existing backend API. Receiver gets the standard `transfer-requested` event (or auto-accept if Quick Save covers it).

**D.2** Show in-flight progress on the tapped card (left side of card shows a thin bar that fills from 0→100% during transfer).

**D.3 Verify Phase D:** Pick a file, tap a device card. Within 2s the transfer should start. Watch desktop's Receive screen — file appears in the in-flight list, then in the history.

Commit: `feat(localsend): tap-to-send from Nearby devices list`.

### Phase E — Discovery fallbacks (≈45 min)

**E.1 USB fallback (already partially in C.6):**
- Probe `localhost:17619` on mount AND every 5s. On 200, inject synthetic USB peer.
- USB peer pinned to top of Nearby devices list, with a "USB" pill in green.

**E.2 Manual IP fallback:**
- "Enter IP" CTA opens a modal with `<TextInput>` (numeric keyboard with dots) + Connect button.
- On submit: `fetch('http://<ip>:17619/api/health')` with 2s timeout. On 200, `fetch('/api/discovery')`. Inject the result as a peer in the list.
- Persist last 5 successful IPs in `AsyncStorage` (`recentManualIps`). Show as quick-reconnect chips below the input.

**E.3 QR fallback (last resort):**
- "Scan QR" CTA opens the existing scanner at `app/scan.tsx`. This is the previous flow; do not touch it. Backup safety net.

**E.4 Verify Phase E:** Repeat C.7 on iPhone hotspot. mDNS yields nothing → fallback CTAs appear → USB tunnel injects peer OR manual IP injects peer → tap → transfer works.

Commit: `feat(localsend): discovery fallbacks — USB, manual IP, QR`.

### Phase F — Desktop UI: Send / Receive / Settings (≈2 hr)

Mirror the mobile structure with desktop ergonomics. Use `@dropbeam/shared-ui` tokens.

**F.1 Layout:** Existing left-rail nav stays. Tabs: Receive | Send | Settings. (Already exists at top level — just re-target the screens.)

**F.2 Send screen** (`apps/desktop/src/screens/Send.tsx`, refactor):
- Top: "Selection" header + 4 `<Button variant="ghost">` cards: File / Folder / Text / Paste.
- File / Folder: existing flow (file input + jszip folder).
- Text: small textarea modal → sends as `.txt`.
- Paste: `navigator.clipboard.readText()`.
- "Nearby devices" header with refresh / favorites-filter / settings icons (lucide-react: RefreshCw, Heart, Settings).
- List of device rows (full-width). Each row: platform icon, friendly name (big), hashtag + platform pill, heart on right, click anywhere on the row → if selection non-empty, send immediately.
- Empty state CTAs: "Plug in phone via USB" (just info text, no action) and "Enter IP" (opens modal).

**F.3 Receive screen** (new, `apps/desktop/src/screens/Receive.tsx` — file exists, refactor):
- Big pulsing wifi/dropbeam icon.
- Friendly name in 36pt bold.
- Hashtag IDs below.
- Quick Save segmented control.
- Below: list of in-flight + recent transfers, with progress bars and Open / Reveal-in-Explorer buttons per item.

**F.4 Settings extension:**
- Add a "Profile" tab/section with friendly name + regenerate + hashtag + Quick Save mirror.
- Add a "Favorites" section with the hearted devices list.
- Existing diagnostics / watch folders tabs preserved.

**F.5 Verify Phase F:** On real Wi-Fi with the phone running the redesigned mobile app, the desktop Send screen should show the phone within 5s. Heart the phone, switch Receive's Quick Save to "Favorites", have the phone send a file — desktop auto-accepts. Switch to "Off" — desktop shows the Accept/Decline banner.

Commit: `feat(localsend): desktop Send/Receive/Settings screens`.

### Phase G — Text / Paste send types (≈45 min)

Both directions.

**G.1 Backend:**
- Reuse the existing file upload pipeline. A "text" send is just a file with `name = "Note <timestamp>.txt"`, `mimeType = "text/plain"`, body = the text bytes. No new backend code needed.

**G.2 Mobile Text card:**
- Modal with `<TextInput multiline numberOfLines={10}>` + Send button. On Send, create a Blob (`new Blob([text], { type: 'text/plain' })`) and feed into the existing `requestTransferBatch` flow.

**G.3 Mobile Paste card:**
- `expo-clipboard.getStringAsync()`. If string is non-empty, show a preview modal with the content + Send. Same upload path as Text.
- If clipboard has image/file (less common on Android), fall back to Text-of-the-string. Skip image-from-clipboard for v1.

**G.4 Desktop equivalents:**
- Text: a small textarea component in the Send screen.
- Paste: clip the clipboard via the existing `apps/desktop/src/screens/Send.tsx` clipboard helper (W12 wired this up).

**G.5 Received text:**
- Phone Received card for a `.txt` file: tap → in-app text viewer (a `Modal` with `<ScrollView><Text>` displaying the decoded content) OR a Share button.
- Desktop: same — clicking a received .txt opens it in the in-app viewer + Copy / Save buttons.

**G.6 Verify Phase G:** Send "Hello" via Text from phone → desktop. Desktop should display the text inline (not just download it). Same in reverse.

Commit: `feat(localsend): text + paste send types`.

### Phase H — iOS sideload (≈2 hr, on the user's Mac)

User has Mac, NO paid Apple Developer account. Personal-Apple-ID signing = 7-day expiry; user accepts re-running from Xcode weekly.

**H.1 Prebuild:**
```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
cd ios
pod install
```
If `pod install` fails on M1/M2/M3, try `arch -x86_64 pod install` or update cocoapods (`sudo gem install cocoapods`).

**H.2 Configure `apps/mobile/app.json`:**
```json
"ios": {
  "bundleIdentifier": "com.dropbeam.mobile",
  "infoPlist": {
    "NSLocalNetworkUsageDescription": "DropBeam discovers nearby devices on your Wi-Fi to share files.",
    "NSBonjourServices": ["_dropbeam._tcp"],
    "NSCameraUsageDescription": "Scan pairing QR codes (fallback).",
    "NSPhotoLibraryAddUsageDescription": "Save received images to Photos (optional)."
  }
}
```
After editing `app.json`, re-run `npx expo prebuild --platform ios --clean` to regenerate `Info.plist`.

**H.3 Xcode steps (manual):**
- Open `apps/mobile/ios/dropbeam.xcworkspace` (NOT `.xcodeproj`).
- Xcode → Preferences → Accounts → Add Apple ID (user's personal iCloud account; free).
- Project Navigator → top "dropbeam" target → Signing & Capabilities → uncheck "Automatically manage signing" then re-check it → select user's personal team.
- Connect iPhone via USB. Trust the laptop on the iPhone if prompted. Select the iPhone as the run target.
- Run (⌘R). App installs with a 7-day signing certificate.
- iPhone Settings → General → VPN & Device Management → trust the developer profile (one-time per device).

**H.4 iOS-specific gotchas:**
- Without `NSBonjourServices`, `Zeroconf.start()` silently returns nothing on iOS 14+.
- `react-native-quick-crypto@0.7.x` builds on iOS but requires `pod install`. If it fails, run `pod install --repo-update`.
- `expo-file-system`'s `documentDirectory` is sandboxed. Export via `expo-sharing.shareAsync(uri)` — the iOS share sheet handles "Save to Files", "Save to Photos", etc.

**H.5 Verify Phase H:**
- App opens on iPhone. Lands on Send screen with empty Nearby devices.
- On a real Wi-Fi router (NOT iPhone hotspot — see iPhone hotspot blocks multicast, lesson #7), start the desktop. Desktop should appear in the iOS Nearby devices list within 5s. (If you're testing iOS while the iPhone IS the hotspot host, this won't work and that's expected.)
- Tap desktop card → paired. Send a file from desktop → iOS receives → tap the Received item → Share sheet opens.

Commit: `feat(localsend): iOS sideload support — Bonjour, sharing, Info.plist`.

### Phase I — Polish + docs (≈1 hr)

I.1 Received tab on phone (or section on Receive screen) listing all files in `documentDirectory/dropbeam/` with name, size, date, Open + Share buttons (`expo-sharing.shareAsync`).

I.2 Open / Reveal-in-Explorer buttons on the desktop's received-files list (existing `History` screen).

I.3 Update top-level `README.md` with the new flow (install → open → pick a device from Nearby → send).

I.4 Move historical plans into `docs/`:
```powershell
New-Item -ItemType Directory -Force -Path docs
Move-Item DROPBEAM_REBUILD_PLAN.md docs/
Move-Item DROPBEAM_USER_FLOWS.md docs/
Move-Item DROPBEAM_LOCALSEND_REDESIGN_PLAN.md docs/
Move-Item PROGRESS.md docs/
```

I.5 Bump workspace version to `0.2.0` in root `package.json` and tag:
```powershell
git tag v0.2.0-localsend-list
git push --tags   # ONLY if user has confirmed they want to push
```

---

## 5. Verification matrix (do before declaring done)

| Scenario | Network | Discovery | Expected result |
|---|---|---|---|
| 1. Real Wi-Fi router, Android phone + Windows desktop | Same Wi-Fi | mDNS | Phone Send screen lists desktop in ≤5s. Tap → silent pair → file (≤10MB) lands in ≤10s. |
| 2. Real Wi-Fi router, iOS phone + Windows desktop | Same Wi-Fi | mDNS (NSBonjourServices set) | Same as #1 on iOS. |
| 3. iPhone hotspot, Android phone + Windows laptop | iPhone hotspot | mDNS fails → manual IP | Empty state → "Enter IP" → connect → transfer works. |
| 4. USB only, no Wi-Fi at all | none | ADB reverse tunnel | Phone shows USB peer at top of list → tap → paired → transfer works. |
| 5. Decline path | Any | Any | Quick Save = off, send → receiver Decline → sender shows "Declined" toast, no file moved. |
| 6. Quick Save = On | Any | Any | Send → receiver auto-accepts, no prompt. |
| 7. Quick Save = Favorites, sender hearted | Any | Any | Send → receiver auto-accepts. |
| 8. Quick Save = Favorites, sender NOT hearted | Any | Any | Send → receiver shows Accept/Decline. |
| 9. Multi-file batch | Real Wi-Fi | mDNS | Pick 5 files → Send → receiver Accept-all → all 5 visible in Received list with correct sizes. |
| 10. Folder send | Real Wi-Fi | mDNS | Pick a folder (10 small files) → zips and sends → receiver gets a `.zip` they can extract. |
| 11. Text send | Any | Any | Type "Hello" → Send → receiver shows inline text viewer with "Hello". |
| 12. Paste send | Any | Any | Copy text → tap Paste card → preview → Send → receiver inline viewer. |
| 13. Empty network | iPhone hotspot, USB unplugged | none | Send screen empty state with CTAs, no crashes, no infinite spinners. |
| 14. Crypto correctness | Any | Any | Wireshark capture of `/uploads/*/chunks/*` shows ciphertext, not plaintext. |
| 15. **Visual parity audit** | n/a | n/a | Side-by-side screenshots: desktop Send vs mobile Send, desktop Receive vs mobile Receive, desktop Settings vs mobile Settings. Panel borders identical thickness + color (`tokens.color.panelBorder`). Type sizes proportional (mobile = desktop × 0.95–1.0 at the equivalent hierarchy tier). Button heights, radii, paddings match. No raw hex codes or magic numbers anywhere in mobile `StyleSheet` blocks. |
| 16. **Token integrity** | n/a | n/a | `grep -rh "tokens\\.\\w\\+\\.\\w\\+" apps/mobile/src` produces zero paths that aren't defined in `packages/shared-ui/src/tokens.json`. Verifies no invented tokens. |

---

## 6. Files you will create or modify

**New files:**
- `apps/mobile/src/screens/SendScreen.tsx` (refactor existing if present)
- `apps/mobile/src/screens/ReceiveScreen.tsx`
- `apps/mobile/src/components/DeviceCard.tsx`
- `apps/mobile/src/components/SelectionCard.tsx`
- `apps/mobile/src/components/QuickSaveToggle.tsx`
- `apps/mobile/app/index.tsx` (replace with Send)
- `apps/mobile/app/receive.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx` (Expo Router tabs config)
- `apps/desktop/src/components/DeviceCard.tsx`
- `apps/desktop/src/components/QuickSaveToggle.tsx`
- `packages/local-backend/src/friendly-name.js`

**Modify:**
- `packages/local-backend/src/discovery.js` — bonjour-service publish + browse
- `packages/local-backend/src/store.js` — settings extensions, favorites, Quick Save in `requestTransferBatch`, `ensureDiscoverySession`
- `packages/local-backend/src/index.js` — favorites routes, regenerate-name route
- `apps/mobile/src/lib/discovery.ts` — TXT parsing, USB localhost probe
- `apps/mobile/src/lib/connection.tsx` — accept DirectSessionPayload from a discovered peer (no QR-derived expiry)
- `apps/desktop/src/screens/Send.tsx` — full refactor to Selection + Nearby list
- `apps/desktop/src/screens/Receive.tsx` — identity + Quick Save layout
- `apps/desktop/src/App.tsx` — re-route nav to Receive default
- `apps/mobile/app.json` — iOS NSBonjourServices, NSLocalNetworkUsageDescription

**Do NOT modify:**
- Anything in `packages/crypto-core/`. The pure-JS X25519/HKDF overrides are correct. Touching them risks reigniting the long debug chain from the previous session.
- `apps/desktop/src-tauri/src/main.rs`. The sidecar spawn + window setup are correct.
- The pnpm overrides in root `package.json`.
- The Metro config — don't disable `unstable_enablePackageExports`.

---

## 7. Open questions for the next session

Confirmed and locked (DO NOT re-ask the user):
- **Empty-selection tap on a device card** → show "Pick what to send first" inline; do nothing else.
- **Favorites scope** → device-local. Each side maintains its own list. No cross-device sync.

Still open — ASK when you hit these:

1. **Send screen icons.** Reuse `lucide-react` (desktop) and corresponding RN icon set on mobile? Confirm the icon library.
2. **What happens if Selection is non-empty and user navigates away from Send tab?** Keep selection across tabs or clear it on tab change?
3. **Apple Developer Program upsell.** After 2-3 weeks of re-signing iOS weekly, the user may want to spend $99/yr. Mention as an option in the I.3 README rewrite — do not auto-purchase.
4. **Send screen empty state if NO peers AND no Selection.** Should it nudge the user to pick a file first, or stay neutral with just the "Looking nearby…" copy?

---

## 8. Mandatory hygiene

- After each phase, commit with a clear message: `feat(localsend): <phase letter> — <summary>`.
- After Phase A verifies, tag: `v0.1.1-pairing-works`.
- After Phase I, tag: `v0.2.0-localsend-list`.
- Never `git push --force`. Never amend a published commit.
- Never run interactive commands.
- Always verify the bundled sidecar binary was rebuilt after a `packages/local-backend/src/**` change. Check: `Get-Item apps\desktop\src-tauri\binaries\dropbeam-backend-x86_64-pc-windows-msvc.exe | Select LastWriteTime` — must be newer than the source file.
- If Metro complains about exports/subpaths, do NOT disable `unstable_enablePackageExports`. Fix the offending import instead.
- Prefer pure-JS over native modules. Native modules force APK rebuilds (10+ minutes) and risk autolinking issues.

---

## 9. If you run out of budget

- Stop at the end of the current phase. Don't leave a phase half-done.
- Commit what works.
- Write a one-paragraph status note at the bottom of this file under `## Resume Point`. Be specific.
- Tell the user where you stopped and what's next.

Resume from the same checkpoint next session.

---

## 10. Budget estimate

Phases 0–I: ~12 hours focused work (Phase 0 + sanity now adds ~20 min; Phase G added ~45 min). With the Pro Max plan and Opus 4.7, realistic in 1–2 sessions if you stay disciplined: short commits, no detours, no rewrites of working code.

Biggest time risk: iPhone-hotspot network reality (Phase E). If you can't test E live, ship the code and ask the user to verify in their daily setup.

Good luck.

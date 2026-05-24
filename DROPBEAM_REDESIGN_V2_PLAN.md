# DropBeam Redesign v2 — Requirements & Plan

**Audience:** A fresh Claude Code session (Opus 4.7 / Max plan) executing this end-to-end.
**Supersedes:** `DROPBEAM_LOCALSEND_REDESIGN_PLAN.md` (Phases 0/B/C/D/E/F shipped in commits `7ac067b`…`ecbb408` but never enforced design parity — mobile UI still looks AI-generated).
**Status:** Approved by product owner via brainstorm 2026-05-24.
**Visual reference:** `localsend1.png` (Receive layout), `localsend2.png` (Send layout) at repo root.

> 🛑 **READ §3 BEFORE WRITING ONE LINE OF UI CODE.** The previous executing session ignored design parity and the mobile app still looks broken. This plan makes design parity a HARD GATE with screenshot verification per phase.

---

## 1. Where we are

The previous plan ran. It shipped:

- Phase 0 design-token parity (`tokens.json` got `overlay`, `title`, `bodyLg`, `caption`, `lineHeight.body`).
- Phase B backend foundations: friendly names (adjective+noun, e.g. "Tidy Strawberry"), hashtag IDs, `quickSave` tri-state (off/favorites/on), favorites list, mDNS publish via `bonjour-service`, `requestTransferBatch` honors Quick Save.
- Phase C mobile screens: `SendScreen.tsx`, `ReceiveScreen.tsx`, `SettingsScreen.tsx`, `DeviceCard.tsx`, `SelectionCard.tsx`, `QuickSaveToggle.tsx`. Routed via `apps/mobile/app/index.tsx` (Send), `apps/mobile/app/receive.tsx`, `apps/mobile/app/settings.tsx`.
- Phase D tap-to-send auto-pair via TXT records (in `connection.tsx`).
- Phase E discovery fallbacks: USB localhost probe in `discovery.ts`, manual IP entry on Send screen.
- Phase F desktop Identity panel + Settings Profile/Favorites (commit `817175b`).

What still **does not work** or **does not exist**:

- **mDNS discovery returns empty in practice.** Backend publishes but phone's `useDiscovery` finds nothing. Either `react-native-zeroconf` isn't browsing, or the `bonjour-service` publish isn't wired correctly, or the network blocks multicast. The "Nearby devices" list shows empty state on both desktop and phone.
- **Desktop still has `New session` button** (`App.tsx:358`), `ConnectionPicker` modal, `ConnectionScreen` modal, `Home.tsx` screen — all the "create a session" UX that the owner explicitly told us to remove.
- **Guest-share code is everywhere:** `guest-page.js`, `Guest.tsx` desktop screen, `parseSessionPayload` guest URL branch, `useMobileBackend.ts` guest references, `ConnectScreen.tsx` guest flow, `HistoryScreen.tsx` guest entries. Owner explicitly said remove it all.
- **Android UI is still visually broken.** Even though Phase 0 fixed token paths, the screens themselves don't actually look like the desktop. The previous executing session treated design parity as advisory; this plan makes it mandatory.
- **No Text or Paste send types.** Selection card UI exists but only File and Folder are wired.
- **No `pnpm dev:web` mirror.** Owner wants `expo start --web` as the dev-loop UI so they can iterate Android visuals in browser without rebuilding the APK every change.
- **iOS never built.** Owner is on Windows; iOS is parked.
- **PIN screen still exists** as a "Waiting…" stub (`PinEntryScreen.tsx`). Should be removed entirely or repurposed.

---

## 2. Locked product decisions (from brainstorm)

| Decision | Resolution |
|---|---|
| Visual style | LocalSend's **layout pattern**; DropBeam's existing **dark glass tokens**. NOT a 1:1 LocalSend skin. |
| Trust model | Keep ECDH+AES encryption under the hood. UI never says "session" / "pair" / "key". Internal backend types may keep the word `session` — it just never reaches a user. |
| Session/pair/guest UI | **All UI surfaces removed.** "New session", "Home page", `ConnectionPicker`, `ConnectionScreen`, `Guest.tsx`, the PIN screen, the `/pair` and `/scan` mobile routes — all gone. |
| Receiver prompt | Quick Save tri-state (Off / Favorites / On) preserved. Already shipped. |
| Send selection types | All four: **File / Folder / Text / Paste**. File and Folder exist; Text and Paste are new. |
| Friendly names | Adjective + Noun, hashtag ID. Already shipped, keep. |
| Android nav | **Bottom tab bar:** Receive · Send · Settings. NOT a sidebar (desktop has sidebar, mobile has tabs — visual tokens still match). |
| Discovery fallback | mDNS (when it works) → USB tunnel (`adb reverse tcp:17619 tcp:17619`) → manual IP entry. QR scan is **deleted entirely**. |
| Dev loop for UI | `expo start --web` serves the mobile bundle in browser. Iterate visuals there, then verify on Android. Desktop Vite is at `localhost:1420`. |
| iOS | Parked for now. User is on Windows. Don't touch iOS code. |
| `.gitignore` | Audit and adjust so the next executing session can re-pull and run without missing files. Detailed in §10. |

---

## 3. Design parity gate (HARD — read before any UI work)

The previous executing session ignored design parity and shipped a mobile UI that the product owner called "AI slop." The new plan makes this non-negotiable. The rules:

1. **Desktop is the source of truth.** Open `apps/desktop/src/index.css` and `apps/desktop/src/styles.css` and `packages/shared-ui/src/tokens.json` BEFORE writing any new mobile screen. Every visual decision on mobile MUST map to an equivalent on desktop:
   - Background colors → `tokens.color.bg`, `tokens.color.surface*`, `tokens.color.panelBg*`
   - Borders → `tokens.color.panelBorder` / `panelBorderStrong`, 1px width
   - Radii → `tokens.radius.lg` (8) for panels, `tokens.radius.xl` (10) for buttons/inputs
   - Spacing → `tokens.spacing.sm/md/lg/xl` (8/12/16/24). No 7px, no 14px, no 18px.
   - Type → `tokens.fontSize.*` and `tokens.fontWeight.*` only. No raw `fontSize: 18`.
   - Colors for chips/badges → `tokens.color.blue/green/amber/danger`.

2. **Zero raw values in mobile `StyleSheet.create` blocks.** No literal hex codes, no raw integers for sizes. Every numeric or color value comes from `tokens.*`. Failing this rule = revert the commit.

3. **Component reuse over re-implementation.** Mobile must use `@dropbeam/shared-ui-rn` components (`GlassPanel`, `Badge`, `Button`, `SectionHeading`, `TransferRow`). If you need a primitive that doesn't exist there, ADD it to both `shared-ui` and `shared-ui-rn` with identical props and identical visual output.

4. **Screenshot verification per phase. MANDATORY.** Before each phase commit:
   - Run `expo start --web` and screenshot the affected screens in browser.
   - Run the desktop Tauri app (or `pnpm dev:desktop`) and screenshot the equivalent desktop screen.
   - Save both as `docs/screenshots/<phase>-<screen>-mobile.png` and `docs/screenshots/<phase>-<screen>-desktop.png`.
   - Place them side by side. If panel borders, type sizes, button shapes, or spacing rhythm look different, FIX before committing.
   - Include a one-line note in the commit message: `Parity verified vs <screen>` or skip the commit.

5. **Grep gate before every UI commit:**
   ```powershell
   # No invented tokens:
   Select-String -Path "apps\mobile\src\**\*.ts*" -Pattern "tokens\.\w+\.\w+" -AllMatches |
     ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
   # Cross-check each result against packages\shared-ui\src\tokens.json.
   # Zero mismatches allowed. Zero raw hex codes in StyleSheet blocks.
   Select-String -Path "apps\mobile\src\**\*.ts*" -Pattern "#[0-9a-fA-F]{3,8}" |
     Where-Object { $_.Line -notmatch "tokens\." }
   # Zero matches allowed (raw hex outside token references).
   ```

6. **If a token is missing from `tokens.json`, ADD IT to the canonical file first**, regenerate mirrors (`tokens.ts`, `tokens.css`), then use it. Never hard-code.

7. **No light-mode anywhere.** The app is dark. Background is near-black, panels are near-black with thin white borders, text is `#f4f4f4`. LocalSend's light teal is **not** the visual reference.

8. **Reject by example.** These are NOT acceptable patterns on mobile:
   - `backgroundColor: 'white'` (use `tokens.color.surface`)
   - `borderRadius: 12` (use `tokens.radius.xl` = 10 or add a `2xl` token if you really need 12)
   - `fontSize: 17` (use `tokens.fontSize.md` = 16)
   - `padding: 18` (use `tokens.spacing.lg` = 16 or `xl` = 24)
   - `color: '#888888'` (use `tokens.color.textDim`)

9. **If you find a mobile screen you didn't write that violates these rules, FIX IT as you touch the file.** Boy-scout rule. The current `SendScreen.tsx`, `ReceiveScreen.tsx`, `SettingsScreen.tsx`, `IncomingScreen.tsx` all need an audit.

10. **No new screens until existing ones are parity-clean.** Phase 4 (Android UI rebuild) is where this gets enforced wholesale.

---

## 4. Hard-won lessons (carry from yesterday — DO NOT relitigate)

1. **`react-native-quick-crypto@0.7.x`** does not support X25519, HKDF, or `getRandomValues`. Pure-JS overrides via `@noble/curves` + `@noble/hashes` are in `packages/crypto-core/src/rn.ts`. Don't touch them. Don't upgrade quick-crypto.
2. **`react-native-quick-base64@2.1.2`** + **`@craftzdog/react-native-buffer@6.0.5`** are pinned via pnpm overrides in root `package.json`. Required for RN 0.76 autolinking. Don't bump.
3. **Metro `unstable_enablePackageExports: true`** is required in `apps/mobile/metro.config.js`. Required for `@dropbeam/crypto-core/rn` subpath import. Don't disable.
4. **React 18 StrictMode** double-runs effects. Don't use `let cancelled = false` + cleanup in component effects that perform side effects you want to commit.
5. **Tauri `tauri.conf.json`** MUST have `build.beforeDevCommand: "pnpm dev"`. Otherwise `tauri:dev` hangs.
6. **JDK 17 only** for Android builds. Verify `java -version` before any Gradle run.
7. **iPhone Personal Hotspot blocks multicast.** mDNS will not work on iPhone hotspot. USB tunnel and manual IP entry are the only fallbacks.
8. **No interactive commands.** No `Read-Host`, no `git rebase -i`.
9. **Sidecar binary must be rebuilt** after any `packages/local-backend/src/**` change. Verify with: `Get-Item apps\desktop\src-tauri\binaries\dropbeam-backend-x86_64-pc-windows-msvc.exe | Select-Object LastWriteTime`.

---

## 5. Phased plan

Execute phases strictly in order. Verify each manually before starting the next. No phase ships without screenshot proof (§3 rule 4).

### Phase 1 — Demolition (≈2 hr)

Goal: remove every UI surface of session/pair/guest. The backend keeps its internal session structures (renaming optional, NOT required).

**1.1 Remove guest-share code paths entirely:**

Delete these files:
- `packages/local-backend/src/guest-page.js`
- `packages/local-backend/src/__tests__/guest-page.test.js`
- `packages/local-backend/src/__tests__/guest-page-http.test.js`
- `apps/desktop/src/screens/Guest.tsx`

In `packages/local-backend/src/index.js`: delete all routes under `/api/guest/*` and `/guest/*` (the HTML page serving). The grep `grep -n "guest" packages/local-backend/src/index.js` will list them.

In `packages/local-backend/src/store.js`: delete `createGuestShare`, `addGuestFile`, `getGuestShare`, `listGuestShares`, `guestShares` state, all guest-related broadcast events.

In `apps/desktop/src/features/dashboard/useDesktopBackend.ts`: delete `createGuestShare`, `guestShares`, `guestUrl` exports.

In `apps/desktop/src/App.tsx`: remove the Guest navigation entry and route case.

In `apps/mobile/src/lib/parseSessionPayload.ts`: delete `parseGuestUrl`, the `GuestSessionPayload` type, all guest branches.

In `apps/mobile/src/lib/connection.tsx`: delete `attachGuestSession`, `GuestSession` type, all guest-related state and SSE handling.

In `apps/mobile/src/screens/ConnectScreen.tsx`, `HistoryScreen.tsx`, `useMobileBackend.ts`, `api.ts`: delete every reference to guest. Some of these files are themselves about to be deleted in 1.2, so the easier path may be to delete them outright.

Verify: `grep -rn "guest" packages/local-backend/src/ apps/desktop/src/ apps/mobile/src/` returns ZERO matches.

**1.2 Remove session/pair UI surfaces:**

Delete:
- `apps/desktop/src/screens/Home.tsx` (the home page)
- `apps/desktop/src/components/ConnectionPicker.tsx`
- `apps/desktop/src/components/ConnectionScreen.tsx`
- `apps/mobile/app/pin.tsx`
- `apps/mobile/app/scan.tsx`
- `apps/mobile/app/connect.tsx`
- `apps/mobile/src/screens/PinEntryScreen.tsx`
- `apps/mobile/src/screens/ScanScreen.tsx`
- `apps/mobile/src/screens/ConnectScreen.tsx`
- `apps/mobile/src/screens/HotspotJoinScreen.tsx` (unused after this)

In `apps/desktop/src/App.tsx`:
- Remove the `New session` button (line ~358 area), the `pickerOpen` state, the `<ConnectionPicker>` and `<ConnectionScreen>` modal renders.
- Remove the `Home` route from `NAV` and `renderScreen`.
- Default landing route becomes `Receive`.

In `apps/desktop/src/features/dashboard/useDesktopBackend.ts`:
- `createSession` becomes internal-only — invoked once at mount via a `useEffect` that ensures a discovery session exists. Don't expose it as a return prop.
- Rename the publicly-exposed bits: instead of `activeSession`, expose `peerDevices` (the discovered list).

In `apps/mobile/src/lib/connection.tsx`: keep `startDirectHandshake` (still needed for tap-to-send) but remove all QR/scan/PIN entry hooks. The `state` machine collapses to `idle | connecting | paired | error`.

Verify: `grep -rn "New session\|ConnectionPicker\|ConnectionScreen\|PinEntry\|ScanScreen\|/pair\b" apps/desktop/src apps/mobile/src` returns ZERO matches.

**1.3 Rebuild sidecar + clean state:**
```powershell
pnpm install
pnpm --filter @dropbeam/local-backend run bundle:js
pnpm --filter @dropbeam/local-backend run bundle:exe
Remove-Item -Force "$env:APPDATA\com.dropbeam.desktop\backend\state.json" -ErrorAction SilentlyContinue
```

**1.4 Verify Phase 1:**
- `pnpm typecheck` is clean across all 7 packages.
- Desktop launches via `pnpm --filter @dropbeam/desktop tauri:dev`. Window shows Receive tab as default. No "New session" button anywhere. No "Home" tab. No Guest tab.
- Phone app launches. Lands on Send tab. No Connect / Scan / Pin routes reachable.

Commit: `feat(redesign-v2): demolition — remove guest, session UI, pair UI, home page`

### Phase 2 — Fix mDNS discovery (≈2 hr)

The current backend has `bonjour-service` calls but in practice neither side discovers the other. Investigate and fix.

**2.1 Verify desktop is actually publishing:**

Run desktop. From another shell:
```powershell
# Windows: query the local mDNS responder via Resolve-DnsName
Resolve-DnsName -Type PTR _dropbeam._tcp.local. -ErrorAction SilentlyContinue
# OR use a tool like dns-sd (if installed via Bonjour SDK)
# OR inspect with Wireshark on the LAN interface, filter `mdns`
```
Expected: at least one PTR record pointing at the desktop's instance. If not, the publish step in `packages/local-backend/src/discovery.js` isn't running or `bonjour-service` is silently failing. Add `console.log` at each step of the publish call, restart, check logs.

Common causes:
- The discovery service is gated behind a settings flag that defaults off
- Windows Firewall blocks UDP 5353 on the loopback or LAN interface — add a rule:
  ```powershell
  New-NetFirewallRule -DisplayName "DropBeam mDNS" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow
  ```
- The bonjour-service publish runs but binds to the wrong interface

**2.2 Verify phone is actually browsing:**

In `apps/mobile/src/lib/discovery.ts`, add a `console.info` on every `react-native-zeroconf` event: `start`, `found`, `resolved`, `remove`, `error`. Run app via `pnpm --filter @dropbeam/mobile android`. Watch Metro logs.

Common causes:
- `Zeroconf.scan('dropbeam', 'tcp')` never called
- Android needs `<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />` and a `WifiManager.MulticastLock` acquired before mDNS works. `react-native-zeroconf` has built-in handling but verify in `apps/mobile/android/app/src/main/AndroidManifest.xml`
- On iPhone hotspot: multicast is blocked at the router. Confirm by joining a real Wi-Fi router and re-testing.

**2.3 Make the desktop find phones too:**

The desktop has its own discovery list in `apps/desktop/src/features/dashboard/useDesktopBackend.ts` (`devices`). This populates from `/api/discovery`. Confirm that backend's bonjour browse populates `discovery.peers` and the route exposes them.

**2.4 Verify Phase 2 (REQUIRES a real Wi-Fi router):**
- Desktop launches. Phone app launches.
- Within 5 seconds: phone's Send tab shows the desktop in Nearby devices. Desktop's Receive tab shows the phone as a known peer (or some equivalent surface).
- Disconnect Wi-Fi → both lists empty within 30s.
- Reconnect → both lists repopulate within 5s.

If on iPhone hotspot only: skip mDNS verification, confirm USB fallback works (Phase 2.5).

**2.5 Verify USB fallback still works:**
```powershell
adb reverse tcp:17619 tcp:17619
```
Phone Send tab should show a synthetic "USB" peer at the top of the list within 5s.

Commit: `fix(redesign-v2): mDNS publish + browse — actually populate Nearby devices`

### Phase 3 — Desktop UI rebuild (≈3 hr)

Goal: match `localsend2.png` Send layout and `localsend1.png` Receive layout, but in DropBeam's dark glass aesthetic.

**3.1 Layout shell** (`apps/desktop/src/App.tsx`):
- Left rail: brand mark + 3 tabs (Receive / Send / Settings). Active tab gets a subtle highlight using `tokens.color.surfaceSoft` background and `tokens.color.text` color (already the pattern).
- Right workspace: only the active tab's content. No top-bar "New session" button. No status pill.
- Default route: Receive.

**3.2 Receive screen** (`apps/desktop/src/screens/Receive.tsx`):
- Replace the current content with the identity layout from `localsend1.png`:
  - Top-right: small icons for History (clock) and Info.
  - Center: a large pulsing icon (a clean circle with a dot, using `tokens.color.text` stroke at `tokens.color.surface` background). Reuse the desktop `pulse` animation from existing CSS.
  - Below: friendly name in 36pt bold (use `tokens.fontSize.xxl` = 32, override to 36 via inline if needed).
  - Below: hashtag IDs in muted text (e.g., "#a3f1") — use `tokens.color.textDim`, `tokens.fontSize.md`.
  - Bottom: Quick Save segmented control. Three pill buttons "Off | Favorites | On" inside a single container with `tokens.color.surfaceSoft` background and `tokens.color.panelBorder` border. Active state filled with `tokens.color.text` (inverted text color).
- Below the main identity (less prominent): a list of recent transfers (in-flight + history), using existing `TransferRow` component.

**3.3 Send screen** (`apps/desktop/src/screens/Send.tsx` — major refactor):
- Top: "Selection" `<SectionHeading>` (uppercase eyebrow style).
- Row of 4 cards: File / Folder / Text / Paste. Each card is a `<GlassPanel>` with an icon (lucide-react: FileText / Folder / Type / Clipboard) and label. Clicking opens the corresponding picker. Selected items badge appears in the corner.
- "Nearby devices" `<SectionHeading>` with action icons on the right: RefreshCw, Heart (favorites filter), Settings.
- List of `<DeviceCard>` rows. Each card: platform icon (Monitor/Smartphone/Tablet) + friendly name (`tokens.fontSize.lg` semibold) + hashtag pill (small `Badge`) + platform pill (small `Badge`) + heart button on right. Tap card → if selection non-empty, immediately initiate transfer batch. If empty, inline hint "Pick what to send first."
- Empty state: "Looking nearby…" after 3s, then after 8s show two CTAs: "Connect via USB" (opens a modal with `adb reverse tcp:17619 tcp:17619` instructions) and "Enter IP manually" (small form).
- Bottom: a muted "Troubleshoot" link + helper text "Make sure both devices are on the same Wi-Fi."

**3.4 Settings screen** (`apps/desktop/src/screens/Settings.tsx`):
- Profile section: friendly name (editable) + Regenerate button + hashtag (read-only).
- Quick Save section: same segmented control as Receive (mirrors `settings.quickSave`).
- Favorites section: list of hearted devices with remove buttons.
- Keep existing Diagnostics, Watch Folders, Shell Integration tabs (don't break them).

**3.5 Screenshots:**

Capture `docs/screenshots/phase3-receive-desktop.png`, `phase3-send-desktop.png`, `phase3-settings-desktop.png`. These are the visual reference for Phase 4 mobile rebuild.

**3.6 Verify Phase 3:**
- Desktop launches cleanly.
- Each tab renders without errors.
- No raw colors or magic numbers anywhere in the new TSX. All values via `tokens.*`.
- Side-by-side comparison: visual hierarchy matches LocalSend's localsend2.png STRUCTURE; visual TOKENS match the existing desktop dark aesthetic.

Commit: `feat(redesign-v2): desktop UI — Receive identity + Send selection+list + Settings, dark glass parity`

### Phase 4 — Android UI rebuild (≈4 hr) [HIGHEST RISK]

**The previous executing session shipped this badly. The new executing session must take design parity dead seriously.** Refer to §3 rules before every commit.

**4.1 Bottom tab navigation:**

Create `apps/mobile/app/(tabs)/_layout.tsx` (Expo Router tabs config):
- Three tabs: Receive / Send / Settings.
- Tab bar background: `tokens.color.panelBg` with top border `tokens.color.panelBorder`.
- Active tint: `tokens.color.text`. Inactive: `tokens.color.textDim`.
- Icons (lucide-react-native if available, else SVG via `react-native-svg`): wifi for Receive, send for Send, settings for Settings.

Move `apps/mobile/app/index.tsx` → `apps/mobile/app/(tabs)/index.tsx` (Send), `apps/mobile/app/receive.tsx` → `apps/mobile/app/(tabs)/receive.tsx`, `apps/mobile/app/settings.tsx` → `apps/mobile/app/(tabs)/settings.tsx`.

Default route: Send (the most common action).

**4.2 SendScreen** (`apps/mobile/src/screens/SendScreen.tsx`):

Open `docs/screenshots/phase3-send-desktop.png`. Replicate that visual structure on mobile:
- Top: "Selection" heading. Use `<SectionHeading eyebrow="Send" title="Selection">` from `shared-ui-rn`.
- Row of 4 cards: File / Folder / Text / Paste using `<SelectionCard>` (already shipped — audit it for token compliance).
- "Nearby devices" heading.
- ScrollView of `<DeviceCard>` rows (already shipped — AUDIT and rebuild if needed). Each card: friendly name + hashtag + platform pills + heart, tap to send.
- Empty state: same as desktop ("Connect via USB" / "Enter IP" CTAs).

**4.3 ReceiveScreen** (`apps/mobile/src/screens/ReceiveScreen.tsx`):

Open `docs/screenshots/phase3-receive-desktop.png`. Replicate:
- Big pulsing identity icon (use `react-native-reanimated` for the pulse).
- Friendly name in `tokens.fontSize.xxl` bold.
- Hashtag in `tokens.color.textDim`.
- `<QuickSaveToggle>` segmented control at the bottom (already shipped — audit).
- Below: incoming transfer queue (from `IncomingScreen`'s state — merge `IncomingScreen` INTO `ReceiveScreen` so they're one cohesive surface).

**4.4 SettingsScreen** (`apps/mobile/src/screens/SettingsScreen.tsx`):

Replicate desktop Settings:
- Profile (friendly name editable + Regenerate + hashtag read-only)
- Quick Save mirror
- Favorites list

**4.5 Audit every component, every screen, every StyleSheet:**

For each file in `apps/mobile/src/screens/` and `apps/mobile/src/components/`:
- Run the §3 grep gates.
- Open the corresponding desktop file. Compare side-by-side.
- Replace every raw value with `tokens.*`.
- If a token is needed that doesn't exist, ADD it to `tokens.json` first.

**4.6 Screenshot verification:**

Run `pnpm --filter @dropbeam/mobile exec expo start --web` and screenshot each tab in the browser. Save to `docs/screenshots/phase4-<screen>-mobile.png`. Place beside the desktop equivalents. They must look like the same product. If they don't, fix before committing.

Also run on the Android device and re-screenshot. The web preview MUST match the device — if they diverge, the issue is in `tokens.css` vs `tokens.ts` mirror drift.

**4.7 Verify Phase 4:**
- All §3 grep gates pass with zero findings.
- Screenshots saved.
- Side-by-side visual review: panel borders, type hierarchy, button shapes, spacing rhythm, badge styling are all identical between desktop and mobile.

Commit: `feat(redesign-v2): Android UI rebuilt to dark glass parity with desktop`

### Phase 5 — Text + Paste send types (≈45 min)

**5.1 Text card:**
- Mobile: tapping Text opens a modal with multi-line `<TextInput>` + Send button. On Send, create a `Blob([text], { type: 'text/plain' })` named `Note-<timestamp>.txt`, route into existing transfer batch flow.
- Desktop: tapping Text opens a similar modal with a `<textarea>`.

**5.2 Paste card:**
- Mobile: tap → `expo-clipboard.getStringAsync()`. If non-empty, show preview modal + Send.
- Desktop: tap → `navigator.clipboard.readText()`. If non-empty, preview + Send.

**5.3 Received text:**
- When a `.txt` file arrives, the Receive screen renders an inline preview in a `GlassPanel` (max 10 lines, expand on tap). Add "Copy" and "Save" buttons.

**5.4 Verify Phase 5:**
- Send a text from mobile → desktop receives, displays inline. Copy works.
- Send a text from desktop → mobile receives, displays inline. Copy works.
- Paste from clipboard works both directions.

Commit: `feat(redesign-v2): Text + Paste send types — inline preview on receive`

### Phase 6 — Web-preview dev loop (≈30 min)

Goal: `pnpm dev:web` serves the mobile React Native app via react-native-web in browser at a known port. Owner uses this for fast UI iteration without rebuilding the APK.

**6.1 Add a script to root `package.json`:**
```json
"dev:web": "pnpm --filter @dropbeam/mobile exec expo start --web --port 8082"
```

**6.2 Confirm `apps/mobile/app.json` has `web.bundler: "metro"`** (already set, per recon).

**6.3 Confirm `react-native-web` and `@expo/metro-runtime` resolve** when the web target runs. If not, install:
```powershell
pnpm --filter @dropbeam/mobile add react-native-web react-dom @expo/metro-runtime
```

**6.4 Verify Phase 6:**
- `pnpm dev:web` opens `localhost:8082`. The Send screen renders in browser. Visual matches Android device screenshots.
- Hot-reload works: edit a token, browser updates without restart.

Commit: `chore(redesign-v2): dev:web script for mobile UI iteration`

### Phase 7 — iOS sideload (DEFERRED — skip unless explicitly asked)

Owner is on Windows. Park iOS work entirely. If iOS comes up, refer to yesterday's plan Phase H (still valid) — it requires moving to a Mac.

### Phase 8 — Polish + docs (≈1 hr)

**8.1** Top-level `README.md` rewrite. New flow:
- Install → run desktop → open mobile app → pick file → tap device → receiver accepts → done.
- No mention of sessions, pairing, QR codes, PINs.

**8.2** Move historical plans into `docs/` subfolder. **WARNING**: `docs/` is currently gitignored — see §10. Either un-ignore it or keep plans at root.

**8.3** Update `STRATEGY.md` to match the new product shape (if it exists; create if not).

**8.4** Add a `docs/screenshots/` folder containing the parity-verified screenshots from Phases 3 and 4. These become the visual contract for future contributors.

**8.5** Bump workspace version to `0.3.0` in root `package.json`. Tag: `v0.3.0-redesign-v2`.

Commit: `docs(redesign-v2): README + screenshots + version bump`

---

## 6. Verification matrix

| # | Scenario | Network | Expected result |
|---|---|---|---|
| 1 | Desktop launch, fresh state | n/a | Lands on Receive tab. No "New session" / "Home" / "Guest" / pair / PIN anywhere. |
| 2 | Mobile launch, fresh state | n/a | Lands on Send tab. Bottom tabs visible. No Connect / Scan / Pin routes. |
| 3 | mDNS discovery, same router | Real Wi-Fi | Phone sees desktop in Nearby devices in ≤5s. Desktop sees phone too. |
| 4 | mDNS, iPhone hotspot | iPhone hotspot | Nearby empty. After 8s, CTAs appear. USB fallback works. Manual IP works. |
| 5 | Pick file, tap device | Any | Receiver gets per-transfer Accept/Decline (unless Quick Save = On). On accept, file arrives. |
| 6 | Send Text | Any | Receiver shows inline preview. Copy works. |
| 7 | Send Paste | Any | Same as Text. |
| 8 | Send Folder | Any | Folder zipped + transferred. Receiver gets `.zip`. |
| 9 | Quick Save = On | Any | No prompt on receiver. File arrives silently. |
| 10 | Quick Save = Favorites | Any | Hearted device auto-accepts. Un-hearted prompts. |
| 11 | Decline | Any | Sender shows "Declined" toast. No file moved. |
| 12 | **Visual parity audit** | n/a | Side-by-side `docs/screenshots/phase4-*-mobile.png` vs `phase3-*-desktop.png`: panel borders, type hierarchy, button shapes, spacing all match. Zero raw colors or magic numbers in `apps/mobile/src/**`. |
| 13 | Token integrity | n/a | Grep gates from §3 rule 5 return zero violations. |
| 14 | Guest code removed | n/a | `grep -rn "guest" packages/local-backend/src/ apps/desktop/src/ apps/mobile/src/` returns zero matches. |
| 15 | Session UI removed | n/a | `grep -rn "New session\|ConnectionPicker\|ConnectionScreen\|PinEntry\|/pair\b\|/scan\b" apps/desktop/src apps/mobile/src` returns zero matches. |
| 16 | Crypto still works | Any | Wireshark capture of `/uploads/*/chunks/*` shows ciphertext, not plaintext (encryption preserved). |
| 17 | `pnpm dev:web` works | n/a | Browser shows mobile Send screen at localhost:8082. Matches device. |

---

## 7. Files: create / modify / delete

**Delete entirely:**
- `packages/local-backend/src/guest-page.js`
- `packages/local-backend/src/__tests__/guest-page.test.js`
- `packages/local-backend/src/__tests__/guest-page-http.test.js`
- `apps/desktop/src/screens/Guest.tsx`
- `apps/desktop/src/screens/Home.tsx`
- `apps/desktop/src/components/ConnectionPicker.tsx`
- `apps/desktop/src/components/ConnectionScreen.tsx`
- `apps/mobile/app/pin.tsx`
- `apps/mobile/app/scan.tsx`
- `apps/mobile/app/connect.tsx`
- `apps/mobile/src/screens/PinEntryScreen.tsx`
- `apps/mobile/src/screens/ScanScreen.tsx`
- `apps/mobile/src/screens/ConnectScreen.tsx`
- `apps/mobile/src/screens/HotspotJoinScreen.tsx`

**Major modifications:**
- `apps/desktop/src/App.tsx` — remove session UI, default to Receive
- `apps/desktop/src/screens/Send.tsx` — full refactor per Phase 3.3
- `apps/desktop/src/screens/Receive.tsx` — identity layout per Phase 3.2
- `apps/desktop/src/screens/Settings.tsx` — Profile / Quick Save / Favorites sections
- `apps/desktop/src/features/dashboard/useDesktopBackend.ts` — internalize createSession
- `apps/mobile/src/screens/SendScreen.tsx` — audit + parity fixes
- `apps/mobile/src/screens/ReceiveScreen.tsx` — merge IncomingScreen state, identity layout
- `apps/mobile/src/screens/SettingsScreen.tsx` — audit + parity fixes
- `apps/mobile/src/components/DeviceCard.tsx`, `SelectionCard.tsx`, `QuickSaveToggle.tsx` — audit + parity fixes
- `apps/mobile/src/lib/discovery.ts` — debug logging for mDNS
- `apps/mobile/src/lib/connection.tsx` — strip guest + scan + pin paths
- `apps/mobile/src/lib/parseSessionPayload.ts` — strip guest URL parsing
- `packages/local-backend/src/index.js` — delete guest routes
- `packages/local-backend/src/store.js` — delete guest methods + state
- `packages/local-backend/src/discovery.js` — debug + verify mDNS publish
- Root `package.json` — add `dev:web` script

**Create new:**
- `apps/mobile/app/(tabs)/_layout.tsx` — bottom tabs config
- `apps/mobile/app/(tabs)/index.tsx`, `receive.tsx`, `settings.tsx` — re-routed tabs
- `docs/screenshots/` directory with parity proofs (rule §3.4)

**Do NOT touch:**
- Anything in `packages/crypto-core/`. The pure-JS X25519/HKDF overrides are correct.
- `apps/desktop/src-tauri/src/main.rs`. Sidecar spawn is correct.
- pnpm overrides in root `package.json`.
- Metro `unstable_enablePackageExports`.

---

## 8. Hygiene rules

- Commit per phase. Message format: `feat(redesign-v2): <phase> — <one-line>`
- Tag at the end: `v0.3.0-redesign-v2`
- NEVER `git push --force`
- NEVER skip the screenshot verification step in §3
- NEVER add a raw hex code or magic number in mobile `StyleSheet` blocks
- ALWAYS rebuild the sidecar after touching `packages/local-backend/src/**`
- ALWAYS run grep gates before each UI commit

---

## 9. Open questions for next session

Confirmed and locked (DO NOT re-ask):
- Visual style: LocalSend layout, DropBeam dark glass tokens
- Trust model: encryption invisible, no UI mention
- All four Selection types: File / Folder / Text / Paste
- Quick Save tri-state: Off / Favorites / On
- Friendly names: adjective + noun
- Android nav: bottom tabs
- Empty-card tap: show "Pick what to send first" inline
- Favorites scope: device-local

Open — ASK when you hit:
1. **Send Folder result on receiver**: keep current jszip-to-`.zip` behavior, or extract on the receiver side? (Default: keep zipped.)
2. **If selection has 2+ items and user taps a device**, does the receiver get one Accept/Decline for the batch, or per-file? Backend supports both via `acceptTransferBatch({ fileIds })`. (Default: batch-level, with Accept-selected option.)
3. **Bottom tab icon library**: `lucide-react-native` is the obvious match for desktop's `lucide-react`. If not installed, ask before adding.

---

## 10. `.gitignore` audit (for the next executing system)

Current `.gitignore` (annotated below) has issues that will bite the next executing session:

```gitignore
# Sidecar binary IS ignored. The next system won't have it.
apps/desktop/src-tauri/binaries/
# → If the next system runs `pnpm --filter @dropbeam/local-backend run bundle:exe`,
#   it will regenerate. So this is OK only if the next system has Node + pkg.
#   ACTION: leave ignored, but document the rebuild step prominently.

# docs/ is IGNORED. This breaks doc handoff.
docs/
# → If the next session writes screenshots / plans / strategy under docs/,
#   they won't be committed. Bad for handoff.
#   ACTION: REMOVE this line so docs/ is committed.

# PLAN*.md is ignored. The new plan filename starts with DROPBEAM_, so it's safe.
PLAN*.md

# Skills directory ignored. Fine.
skills/
```

**Required `.gitignore` changes for the next session to work cleanly:**

1. **Remove `docs/`** — the redesign plan asks the next session to save screenshots and updated docs there. They must be committed.

2. **Add a comment to clarify what `apps/desktop/src-tauri/binaries/` means** — leave it ignored but note that the next system must rebuild the sidecar with `pnpm --filter @dropbeam/local-backend run bundle:exe`.

3. **Confirm `localsend1.png`, `localsend2.png` are NOT matched** by the screenshot patterns (`/dropbeam-*.png`, `/scrn.png`, `/screenshot*.png`, `/*-screenshot*.png`). They're not (different names). OK.

4. **No other artifacts need to be un-ignored.** The next session will: clone, `pnpm install`, run the plan's commands. All build outputs regenerate. Source files are tracked.

Run these to apply:
```powershell
cd C:\Users\nani\Desktop\phoneshare
# Remove the docs/ exclusion so the next session's screenshots + docs are committed:
(Get-Content .gitignore) -notmatch "^docs/$" | Set-Content .gitignore
# Verify
Select-String -Path .gitignore -Pattern "^docs"
# Should return nothing now.
git add .gitignore
git commit -m "chore: track docs/ so redesign-v2 plan + screenshots commit"
```

---

## 11. If you run out of budget

- Stop at the end of the current phase. Don't leave a phase half-done.
- Commit what works.
- Append a `## Resume Point` section at the bottom of THIS file with concrete state.
- Tell the user where you stopped.

---

## 12. Budget estimate

| Phase | Estimate |
|---|---|
| 1 — Demolition | 2 hr |
| 2 — Fix mDNS | 2 hr |
| 3 — Desktop UI rebuild | 3 hr |
| 4 — Android UI rebuild | 4 hr |
| 5 — Text + Paste | 45 min |
| 6 — `dev:web` | 30 min |
| 7 — iOS | parked |
| 8 — Polish | 1 hr |
| **Total** | **~13.5 hr** |

Realistic in 1–2 focused sessions with the Pro Max plan + Opus 4.7.

Biggest time risk: Phase 4 (mobile parity). Previous session burned hours and failed it. New session must take screenshot verification dead seriously OR the deliverable is rejected.

Good luck.

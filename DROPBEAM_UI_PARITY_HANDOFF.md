# DropBeam — Mobile UI Parity Handoff

**Date:** 2026-06-10
**Goal:** make the Android/iOS (Expo) app look like the desktop app — same dark-glass design system, same patterns. The mobile app rendered with serif fonts, bright blue buttons, navy panels, and emoji icons; the desktop is the source of truth.
**Status:** ✅ **COMPLETED 2026-06-10.** All 9 work items in §6 done. See "Completion log" below.

---

## Completion log (2026-06-10)

All §6 work items executed and verified.

| # | Item | What was done |
|---|---|---|
| 6.1 | `lib/native.tsx` blue-navy primitives | Button → white bg / black text / radius xl / semibold (was `#3aa9ff`). TextInput → `inputBg` / `panelBorder` / text token, placeholder `textDim` (was navy `#0a1320`). All token-driven. API unchanged. |
| 6.2 | `PermissionScreen.tsx` | Rebuilt on GlassPanel + tokens; eyebrow/title/copy pattern; status badges use pastel tokens (`green`/`danger`/`textDim`); link is `text`+underline (was blue `#3a8bff`). **Web gate:** `app/(tabs)/index.tsx` now skips the permission step on `Platform.OS === 'web'`. |
| 6.3 | `OnboardingScreen.tsx` | Raw grays → tokens; GlassPanel cards; eyebrow/title/copy. |
| 6.4 | `LiveBadge.tsx` | **Deleted** — dead code (no importers); removed its navy hex palette. |
| 6.5 | `ScreenCard.tsx` | **Deleted** — dead code (no importers); removed its navy slate palette. |
| 6.6 | `shared-ui-rn/src/lib/tokens.ts` duplicate | **Deleted** — dead drifted duplicate (no importers). Canonical `src/tokens.ts` (platform font fix) is the only token source. |
| 6.7 | Tab icons | `app/(tabs)/_layout.tsx` text glyphs (↓↑⚙) → lucide line icons via new `src/components/Icon.tsx` (react-native-svg, exact lucide path data): Download / SendHorizontal / Settings. |
| 6.8 | SelectionCard emoji | `SelectionCard` now takes an `IconName`; SendScreen passes `file-text`/`folder`/`type`/`clipboard` lucide icons (was 📄📁✏️📋). |
| 6.9 | Eyebrow audit + DeviceCard | DeviceCard platform emoji → lucide Monitor/Smartphone/Tablet; heart glyph (♥/♡) → lucide `heart` (filled when favorite). Receive/Settings headings already eyebrow-style; left as-is. |

**New file:** `apps/mobile/src/components/Icon.tsx` — reusable lucide-style SVG icon set (11 glyphs) shared by tabs, SelectionCard, DeviceCard.

**Verification:**
- `pnpm typecheck` — 7/7 clean.
- Grep gate (raw hex in `apps/mobile/src` + `packages/shared-ui-rn/src`): only `identity.ts` `'#0000'` (a hashtag ID string, allowed). No rgb/rgba literals.
- Backend regression: `pnpm --filter @dropbeam/local-backend test` 37/37; transfer smoke ALL PASS.
- Web preview screenshots: `docs/screenshots/mobile-{send,receive,settings}-after.png` — sans-serif fonts (was serif), lucide tab icons, white inverted buttons, uppercase token eyebrows. Compare against `-before.png` and `desktop-*.png`.

**Still requires a real device pass:** web preview proves token/structure parity; build the APK (see "Android build" at the bottom of this file) and screenshot on-device to confirm the `Platform.select` font mapping renders identically.

---

## 1. Current repo state

File-sharing repairs were already committed as `e69e7d4` (transfer pipeline, Web Share/iOS path, port fixes — see that commit message). The following **uncommitted** changes are groundwork for THIS parity work. They are tested and should be committed before starting:

| File | What it does |
|---|---|
| `apps/mobile/package.json` | added `react-native-web`, `react-dom`, `@expo/metro-runtime` — `pnpm dev:web` was broken without them |
| `apps/mobile/app.json` | `web.output: "static"` → `"single"` — static SSR crashed with a dual-React `useContext` error; SPA mode works |
| `packages/crypto-core/src/rn.ts` | `require('react-native-quick-crypto')` wrapped in try/catch — the native module doesn't exist on web and crashed the whole bundle; browser WebCrypto is used as fallback |
| `packages/shared-ui-rn/src/tokens.ts` | **font fix**: token `fontFamily.sans = "Inter"` isn't bundled anywhere → web fell back to SERIF, Android silently to Roboto. Now maps per-platform: full CSS stack on web, system sans (undefined) on native |
| `scripts/screenshot.mjs` (new) | headless-Edge screenshot tool over CDP — no Playwright needed. See §3 |
| `docs/screenshots/` (new) | baseline + reference screenshots. See §4 |

Suggested commit: `chore(parity): web preview enablement + font token fix + screenshot harness`

Verified with these changes: `pnpm typecheck` 7/7 clean, backend tests 37/37, `node scripts/smoke-transfer.mjs` all pass.

---

## 2. Errors already hit and FIXED (don't re-debug these)

1. `expo start --web` → "install react-native-web" → fixed (deps added).
2. Metro error `Failed to install react-native-quick-crypto: The native QuickCrypto Module could not be found` → fixed (guarded require in crypto-core/rn.ts).
3. Metro error `Cannot read properties of null (reading 'useContext')` during SSR render → fixed (`web.output: "single"`).
4. Mobile web renders in Times/serif → fixed (shared-ui-rn tokens.ts platform font mapping). **Do not revert these.**
5. Desktop screenshot shows onboarding modal blocking everything → unblock with:
   `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17619/api/settings -ContentType 'application/json' -Body '{"onboardingComplete":true}'`

---

## 3. How to run the verification environment

```powershell
# 1. Backend (port 17619)
node packages\local-backend\src\dev.js

# 2. Desktop UI (port 1420)
pnpm --filter @dropbeam/desktop dev

# 3. Mobile web preview (port 8082)
pnpm --filter @dropbeam/mobile exec expo start --web --port 8082

# 4. Screenshots (headless Edge, no install needed)
#    node scripts/screenshot.mjs <url> <out.png> [width] [height] [clickJs] [settleMs]
node scripts\screenshot.mjs http://localhost:1420 docs\screenshots\desktop-receive.png 1280 900
node scripts\screenshot.mjs http://localhost:1420 docs\screenshots\desktop-send.png 1280 900 "[...document.querySelectorAll('.nav__item')].find(b=>b.textContent.trim()==='Send')?.click()"
node scripts\screenshot.mjs http://localhost:8082/ docs\screenshots\mobile-send.png 390 844 "" 6000
node scripts\screenshot.mjs http://localhost:8082/receive docs\screenshots\mobile-receive.png 390 844 "" 6000
node scripts\screenshot.mjs http://localhost:8082/settings docs\screenshots\mobile-settings.png 390 844 "" 6000
```

Mobile tab routes on web: `/` = Send, `/receive`, `/settings`.

---

## 4. Baseline evidence (docs/screenshots/)

- `desktop-receive.png`, `desktop-send.png`, `desktop-settings.png` — the visual reference. Note: identity panel (avatar + big name + dim hashtag + Quick Save segmented control), uppercase letter-spaced eyebrows, white-on-black primary buttons, thin-bordered rows.
- `mobile-send-before.png` — **broken**: blocked by permission screen with bright BLUE `GRANT ALL`/`CONTINUE` buttons and blue link.
- `mobile-receive-before.png` — structure is close (pulse circle, name, hashtag, segmented control) but SERIF fonts (now fixed at token level — re-screenshot after restart) and card titles not in eyebrow style.
- `mobile-settings-before.png` — structurally fine, serif fonts, otherwise near-parity.

---

## 5. Design spec — desktop DNA (from `apps/desktop/src/styles.css` + `packages/shared-ui/src/tokens.json`)

| Pattern | Spec |
|---|---|
| Screen bg | `tokens.color.bg` (#000) |
| Card/panel | bg `panelBg` rgba(12,12,12,.96), border 1px `panelBorder` rgba(255,255,255,.12), radius `lg` (8), padding 18–20 |
| Eyebrow | ~11px (`fontSize.xs`), weight 600, UPPERCASE, letterSpacing `wide`/`wider`, color `textDim` |
| Card title | ~17px, weight 600, color `text` |
| Card copy | ~14px (`fontSize.body`), color `textSoft`, lineHeight 1.5 |
| List row | bg `surface` rgba(255,255,255,.03), border 1px `panelBorder`, radius `sm` (4), padding 14; name semibold 15px + dim 13px subline; action right-aligned |
| Primary button | bg `text` (white), color `textInverse` (black), radius `xl` (10), semibold |
| Ghost/secondary button | transparent, 1px `panelBorder`, color `textSoft` |
| Input | bg `inputBg`, 1px `panelBorder`, radius `sm`–`md`, text `text`, placeholder `textDim` |
| Empty state | dashed 1px `panelBorder`, radius `sm`, centered `textSoft` |
| Badges | pastel token text (`blue`/`green`/`amber`) on transparent/dark, 1px border |
| Nav active state | white bg, black text (inverted) |
| Icons | lucide line icons, stroke 2, ~16–18px (desktop uses `lucide-react`) |

**Hard rules (from DROPBEAM_REDESIGN_V2_PLAN.md §3):** zero raw hex colors, zero magic numbers in mobile StyleSheets — every value from `tokens.*`. No light mode. Prefer `@dropbeam/shared-ui-rn` components (`GlassPanel`, `Badge`, `Button`, `SectionHeading`, `TransferRow`).

---

## 6. Work items (all confirmed by inspection, with file:line evidence)

### 6.1 `apps/mobile/src/lib/native.tsx` — THE biggest offender
A wrapper around RN primitives that injects an alien **blue-navy palette** into every screen that imports `Pressable`/`TextInput`/`Text`/`View` from it:
- line ~140: button bg `'#3aa9ff'` (the bright blue buttons), disabled `'#223448'`
- line ~112-116: input bg `'#0a1320'`, border `'#274860'`, text `'#edf5ff'`
- line ~107: placeholder `'#5b7894'`
Restyle to spec §5 (primary button = white/black inverted; input = `inputBg`/`panelBorder`). **Keep the exported API identical** — only styles change.

### 6.2 `apps/mobile/src/screens/PermissionScreen.tsx`
- Raw grays throughout (lines ~116-176: `'#0a0a0a'`, `'#1f1f1f'`, `'#7a7a7a'`, `'#b8b8b8'`, …) and blue link `'#3a8bff'` (line ~182).
- Badge colors lines ~172-174 (`'#0e2a14'`/`'#9ee0a8'` etc.) → use pastel tokens.
- **Also:** it blocks the Send tab on web. Skip the permission gate when `Platform.OS === 'web'` (camera/notifications are meaningless in the browser preview).

### 6.3 `apps/mobile/src/screens/OnboardingScreen.tsx`
Raw grays lines ~41-60. Same treatment: tokens + eyebrow/title/copy structure.

### 6.4 `apps/mobile/src/components/LiveBadge.tsx`
Navy badge palette (lines ~25-37: `'#10263d'`, `'#274860'`, `'#113321'`…). Rebuild on the desktop Badge pattern or reuse `shared-ui-rn` `Badge` if its tones suffice.

### 6.5 `apps/mobile/src/components/ScreenCard.tsx`
Navy slate palette (lines ~23-44: `'#0d1724'`, `'#86aec7'`, `'#a9bfd3'`). Restyle to GlassPanel/card pattern.

### 6.6 `packages/shared-ui-rn/src/lib/tokens.ts` — duplicate token file
A stale duplicate token set that has DRIFTED from canonical (e.g. `danger '#ff8a8a'` vs canonical `'#ff9aa2'`; adds `primary`/`primaryFg`). Find its importers (`grep -r "lib/tokens" packages/shared-ui-rn/src`), point them at the canonical `../tokens` (which re-exports `@dropbeam/shared-ui` + the platform font fix — do NOT modify `src/tokens.ts` further), and derive any extra keys (`primary` = `tokens.color.text`, `primaryFg` = `tokens.color.textInverse`) instead of hardcoding hex.

### 6.7 `apps/mobile/app/(tabs)/_layout.tsx` — tab icons
Currently text glyphs `↓ ↑ ⚙`. Desktop uses lucide `Download` / `SendHorizontal` / `Settings` line icons. `react-native-svg@15.8.0` is already installed (do NOT add lucide-react-native): create `apps/mobile/src/components/TabIcons.tsx` with three `Svg`+`Path` components — copy the path `d` strings from `node_modules/lucide-react/dist/esm/icons/{download,send-horizontal,settings}.js` — size 18–20, `strokeWidth 2`, `stroke={color}`, `fill="none"`. Tab bar colors are already token-clean; leave them.

### 6.8 `apps/mobile/src/components/SelectionCard.tsx` usage — emoji icons
`SendScreen.tsx` lines ~335-338 passes emoji (`📄 📁 ✏️ 📋`). Desktop uses lucide `FileText` / `Folder` / `Type` / `Clipboard`. Same react-native-svg approach as 6.7 (icon components, stroke `tokens.color.text`), and let `SelectionCard` accept a rendered icon node instead of an emoji string.

### 6.9 Eyebrow audit across screens
`ReceiveScreen.tsx` ("Quick Save", "Recent transfers"), `SettingsScreen.tsx`, `SendScreen.tsx`: inline card titles should follow the desktop eyebrow pattern (UPPERCASE, letterSpacing wide, `textDim`, ~11-12px semibold) — like desktop's "THIS DEVICE" / "FROM YOUR PHONE" / "STEP 1 · FILES". `SectionHeading` from shared-ui-rn already implements it; use it consistently. These screens are otherwise token-clean.

---

## 7. Verification gates (run ALL before committing)

```powershell
# 1. Types
pnpm typecheck            # must be 7/7 clean

# 2. No raw hex anywhere in mobile / shared-ui-rn sources
#    (only allowed: apps/mobile/src/lib/identity.ts ~line 55 — '#0000' is a hashtag string, not a color)
Select-String -Path "apps\mobile\src\*","apps\mobile\src\**\*","packages\shared-ui-rn\src\**\*" -Pattern "#[0-9a-fA-F]{3,8}"

# 3. No invented tokens — every tokens.x.y must exist in packages/shared-ui/src/tokens.json
Select-String -Path "apps\mobile\src\**\*.ts*" -Pattern "tokens\.\w+\.\w+" -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique

# 4. Screenshot loop (§3) — save final shots as docs/screenshots/mobile-{send,receive,settings}-after.png
#    and compare side-by-side against desktop-*.png:
#    panel borders, type hierarchy, button shapes, spacing rhythm, badge styling must match.

# 5. Functional regression check — file sharing must still work:
node packages\local-backend\src\dev.js   # in background
node scripts\smoke-transfer.mjs          # ALL PASS required
pnpm --filter @dropbeam/local-backend test   # 37/37
```

Commit format: `feat(parity): <what> — parity verified vs <desktop screen>`

---

## 8. Out-of-scope notes (known, not part of this restyle)

- Phone-side accept prompt doesn't truly gate desktop→phone saves (ReceiveScreen downloads on `file-uploaded` event regardless). Functional polish, separate task.
- `store.js` contains literal NUL bytes in `createUploadFingerprint` hash separators — intentional, do not "fix".
- Quick Save / favorites / trusted flows untouched by this work.
- Android device verification (real APK) still needed after web-preview parity — web preview and device should match since both consume the same tokens; if they diverge, suspect the `Platform.select` font mapping.

---

## 9. Android build & install (replace the old app on the phone)

The phone app's package id is `com.dropbeam.mobile` and its manifest declares the
`SEND` / `SEND_MULTIPLE` share-sheet intent filters — that's why "DropBeam"
appears when you tap Share. Building a new APK with the **same package id** and
**same debug keystore** replaces the installed app in place (keeps the share-sheet
entry, just updated code).

The committed `apps/mobile/android/` project already has the share-sheet filters,
custom native modules, and a release build type signed with the bundled
`debug.keystore` — so **no `expo prebuild` and no keystore setup are needed**, and
`assembleRelease` produces a standalone, installable APK with the latest JS
embedded.

### Option A — Local build (recommended; you already built here before)
Prereqs: **JDK 17** (`java -version` must show 17) and the Android SDK
(`ANDROID_HOME` set). From the repo root:

```powershell
pnpm install
cd apps\mobile\android
.\gradlew.bat assembleRelease
# APK output:
#   apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

Install over the old app (phone in USB debugging mode, or copy the APK across):

```powershell
adb install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

`-r` reinstalls keeping data; signatures match (both debug keystore) so it replaces
the existing DropBeam cleanly. If Android refuses with a signature mismatch (only if
the previously installed build used a different keystore), uninstall first:
`adb uninstall com.dropbeam.mobile` then `adb install <apk>`.

If gradle picks the wrong JDK, point it at 17 for the build:
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot"  # your JDK 17 path
cd apps\mobile\android; .\gradlew.bat assembleRelease
```

### Option B — EAS cloud build (no local Android SDK needed)
```powershell
cd apps\mobile
pnpm exec eas login                 # once
pnpm exec eas build --platform android --profile preview
```
EAS returns a download link; install that APK on the phone (same package id → replaces old).

### After installing
- Start the desktop app + backend on the same Wi-Fi (or the phone's hotspot).
- The rebuilt app carries every fix from this session: working file upload path,
  correct ports (17619), restored Web Share, and the dark-glass UI parity.
- iOS: still no native build (needs a Mac) — iPhones use the Web Share browser page
  (`docs/IOS_SHARING.md`).

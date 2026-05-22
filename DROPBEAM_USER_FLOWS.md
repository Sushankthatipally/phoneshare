# DropBeam — Complete User Flow
> Every case. Every path. Every state. Including what no other app covers.

---

## 📐 HOW TO READ THIS DOCUMENT

Each flow uses this notation:
```
[SCREEN]        — what the user sees
(ACTION)        — what the user does
→               — leads to
⚡              — DropBeam exclusive / no competitor has this
⚠️              — edge case / error state
🔒              — security checkpoint
```

---

# PART 1 — FIRST LAUNCH & ONBOARDING

---

## Flow 1.1 — First Ever Launch (Desktop)

```
[SPLASH]
App opens for first time
        │
        ▼
[SETUP — Step 1 of 3]
"What should we call this device?"
Pre-filled: "Sushank's MacBook"  (pulled from system hostname)
[ Edit name ] [ Continue → ]
        │
        ▼
[SETUP — Step 2 of 3]
"Where should received files go?"
Default: ~/Downloads/DropBeam/
[ Browse ] [ Use Default → ]
        │
        ▼
[SETUP — Step 3 of 3]
"Preferred connection mode?"
  ◉ Auto (recommended) — USB if plugged, WiFi otherwise
  ○ Always WiFi
  ○ Always USB
[ Done — Open App ]
        │
        ▼
[HOME] Ready state — no session yet
```

**What no other app does:** Auto-mode selection preference stored upfront.
LocalSend has no onboarding at all — dumps you into the app with no guidance.

---

## Flow 1.2 — First Ever Launch (Mobile — Android or iOS)

```
[SPLASH]
        │
        ▼
[PERMISSIONS REQUEST]
"DropBeam needs these to work:"

  📷 Camera       — to scan QR codes
  📁 Storage      — to send and save files
  📡 Local Network — to find nearby devices
  🔔 Notifications — to alert you of incoming files

[ Grant All ] [ Choose Manually ]
        │
        ▼
⚠️ If any permission denied:
  Show which features are blocked
  "You can re-enable in Settings anytime"
  App still opens — degraded mode
        │
        ▼
[SETUP]
"What's your name for this device?"
Pre-filled from system device name
[ Continue ]
        │
        ▼
[HOME] Ready — scanning for nearby devices
```

**Gap vs competitors:**
LocalSend users report that the app must be open on both devices to send a file, even on desktop — there's no background mode or receive notification. DropBeam solves this with background service + notification on incoming transfer.

---

# PART 2 — CONNECTION FLOWS

---

## Flow 2.1 — Desktop → Phone (WiFi, QR Pairing) ⚡

```
[DESKTOP HOME]
(Click "New Session")
        │
        ▼
[CONNECTION MODAL]
"How do you want to connect?"

  ┌──────────────────┬──────────────┐
  │  📶 Same WiFi   │  🔌 USB      │
  │  Scan QR code   │  Plug in     │
  └──────────────────┴──────────────┘

(Click "Same WiFi")
        │
        ▼
🔒 SECURITY:
  Desktop generates ECDH X25519 keypair
  Builds QR payload:
  { ip, port, pubKey, sessionId, expiry:+10min }

[QR DISPLAY SCREEN]
  Large QR code centered
  "Make sure your phone is on the same WiFi"
  Network name shown: "Connected to: MyHomeWifi"
  Timer: "Expires in 9:58" (countdown)
  [ Cancel ]

        │
[PHONE]  │
(Open DropBeam → tap Scan)
        │
        ▼
[PHONE — CAMERA SCREEN]
  Live camera with blue scan box
  "Point at the QR on the desktop"
        │
(Scan QR)
        │
        ▼
🔒 Phone sends HANDSHAKE:
  TCP connect to ip:port
  Sends: own pubKey + device info

[PHONE — PIN SCREEN]
"Enter the PIN shown on the desktop"
  [ _ ] [ _ ] [ _ ]  -  [ _ ] [ _ ] [ _ ]

[DESKTOP — PIN DISPLAY]
  Large prominent PIN: 3 5 9 7 4 1
  "Enter this PIN on your phone"
  Auto-clears after 3 wrong attempts

(User types PIN on phone)
        │
        ▼
🔒 Desktop verifies PIN → derives AES-256-GCM key
        │
        ▼
[BOTH DEVICES]
  ✅ "Connected to [device name]"
  Mode badge: 📶 WiFi
  Lock icon: 🔒 Encrypted
  → Navigate to Send/Receive screen
```

**Gap filled:** LocalSend has no "Share with → LocalSend" option in Windows context menu and no QR pairing. DropBeam uses QR as primary pairing.

---

## Flow 2.2 — Desktop → Phone (USB Cable) ⚡

```
[CONNECTION MODAL]
(Click "USB Cable")
        │
        ▼
[USB WAITING SCREEN]
  "Plug in your phone with a USB cable"
  Animated cable illustration
  Polling every 2s for USB devices

⚠️ Nothing detected after 10s:
  "No device found. Check your cable supports data transfer,
   not just charging."
  [ Try Again ] [ Switch to WiFi ]

        │ (phone plugged in)
        ▼
[USB DETECTED]
  ✅ "Android detected: Pixel 8 Pro"
  or
  ✅ "iPhone detected: iPhone 15"

  For Android:
    Silently runs: adb reverse tcp:49876 tcp:49876
    No user action needed

  For iPhone:
    "Trust this computer? Check your phone."
    (iOS shows "Trust" dialog)
    User taps Trust on iPhone

        │
        ▼
[PHONE — AUTO LAUNCHES]
  DropBeam opens automatically (deep link via USB)
  Shows: "Connected to [desktop name] via USB 🔌"
        │
        ▼
🔒 PIN confirmation (same as WiFi flow)
        │
        ▼
✅ CONNECTED — USB mode active
   Speed badge: "~300 MB/s"
```

**Gap filled:** LocalSend users coming from PushBullet want one-touch sharing to devices — USB mode with auto-detection gives exactly this. No other tool has USB cable + auto-detection + auto-launch.

---

## Flow 2.3 — Phone → Phone (Same WiFi, Auto-Discover)

```
[BOTH PHONES open DropBeam]
        │
        ▼
Both immediately:
  1. Broadcast _dropbeam._tcp via mDNS
  2. Listen for other _dropbeam._tcp devices

Within 2–3 seconds:

[PHONE A — HOME]                [PHONE B — HOME]
┌─────────────────┐            ┌─────────────────┐
│ Nearby Devices  │            │ Nearby Devices  │
│                 │            │                 │
│ 📱 Phone B     │            │ 📱 Phone A     │
│ Tap to connect  │            │ Tap to connect  │
│                 │            │                 │
│ Searching... ●  │            │ Searching... ●  │
└─────────────────┘            └─────────────────┘

(Phone A taps Phone B)
        │
        ▼
Phone A becomes HOST:
  Starts TCP listener
  Generates ECDH keypair + session
  Updates mDNS TXT: status=requesting

[PHONE B — NOTIFICATION]
  "📲 Phone A wants to connect"
  [ Accept ] [ Decline ]

(Phone B taps Accept)
        │
        ▼
🔒 Handshake → PIN flow (same as desktop flow)
        │
        ▼
✅ CONNECTED
```

⚠️ **Edge case — mDNS blocked (guest WiFi / corporate):**
```
After 5 seconds, no devices found:
        │
        ▼
[AUTO FALLBACK PROMPT]
"Can't find devices automatically.
 Your network may block local discovery."

  [ Enter IP Manually ]
  [ Create Hotspot Instead ]
  [ Scan QR Code ]
```

---

## Flow 2.4 — Phone → Phone (No WiFi — Android Hotspot) ⚡

```
[SENDER — Android]
(Tap "Connect without WiFi")
        │
        ▼
[NO-WIFI MODAL]
"Your phone will create a private
 DropBeam hotspot. No internet needed."

 ⚠️ "Your mobile data will stay active"
 ⚠️ "Only DropBeam traffic will use this hotspot"

 [ Create Hotspot & Show QR ]
 [ Cancel ]

(Tap Create)
        │
        ▼
Android creates hotspot:
  SSID: "DropBeam-K7MX2P"
  Password: "hq8n3rjwtz5m"
  Band: 5GHz preferred

DropBeam starts TCP listener on 192.168.43.1:49876

[SENDER — QR DISPLAY]
  QR encodes ALL of this at once:
  {
    mode: "hotspot",
    ssid: "DropBeam-K7MX2P",
    password: "hq8n3rjwtz5m",
    ip: "192.168.43.1",
    port: 49876,
    pubKey: "...",
    sessionId: 87654321,
    expiry: "..."
  }

[RECEIVER scans QR]
        │
     ┌──┴──────────────┐
  Android            iPhone
     │                  │
  Auto-joins hotspot   Shows:
  via WifiManager      "Join this WiFi first:
  (no user action)     📶 DropBeam-K7MX2P
                       Password: hq8n3rjwtz5m
                       [Open WiFi Settings]
                       
                       Then come back here.
                       [I've joined ✓]"
     │                  │
     └──────┬───────────┘
            │
            ▼
  TCP connect → Handshake → PIN
            │
            ▼
  ✅ CONNECTED via Hotspot
     Speed badge: "~40 MB/s"
```

**Gap filled:** Xender uses WiFi hotspot connectivity for transfers without cellular data but has weak privacy protocols. DropBeam adds ECDH encryption on top of the hotspot path — Xender sends plaintext.

---

## Flow 2.5 — Multi-Device Session (One Desktop → Multiple Phones) ⚡

*No competitor supports this properly*

```
[DESKTOP HOME]
(Click "New Session" → "Multi-device")
        │
        ▼
[MULTI-DEVICE SETUP]
"How many devices?"
  [ 2 ] [ 3 ] [ 4 ] [ More ]

(Select 3)
        │
        ▼
Shows 3 QR codes simultaneously
OR
Shows 1 QR that can be scanned by multiple devices sequentially

Each phone scans → PIN verify → joins session
Progress shows:
  Device 1: ✅ Connected
  Device 2: ✅ Connected
  Device 3: ⏳ Waiting...
        │
        ▼
"All 3 devices connected. Ready to send to all."
[ Send to all simultaneously ]
[ Send to specific device ]
```

---

## Flow 2.6 — Reconnect (Previous Paired Device Returns) ⚡

*No competitor has remembered-device pairing*

```
[DESKTOP — device list]
Shows "Known Devices" section:
  📱 Sushank's iPhone  — Last connected 2 hours ago
  📱 Pixel 8 Pro       — Last connected yesterday

(Click Pixel 8 Pro)
        │
        ▼
[DESKTOP — waiting]
"Waiting for Pixel 8 Pro to accept..."
Sends push-style mDNS signal

[PHONE — notification]
"💻 MacBook Pro wants to reconnect"
[ Accept ] [ Decline ]

(Tap Accept)
        │
        ▼
🔒 New session key derived (fresh ECDH)
   No PIN needed for known devices (trust cached)
        │
        ▼
✅ Reconnected in ~1 second
```

---

# PART 3 — FILE TRANSFER FLOWS

---

## Flow 3.1 — Send Files (Desktop → Phone)

```
[DESKTOP — SEND SCREEN]
Three ways to add files:

  WAY 1: Drag & drop onto app window
  WAY 2: Click "Add Files" → file picker
  WAY 3: Right-click file in Finder/Explorer
         → "Send via DropBeam" ⚡ (context menu)

Files added → shown in queue:
┌────────────────────────────────────┐
│ 📸 vacation.jpg      2.4 MB  ✓    │
│ 🎬 video.mp4        847 MB  ✓    │
│ 📄 report.pdf         1.1 MB  ✓   │
│                                    │
│ Total: 850.5 MB  →  Pixel 8 Pro   │
└────────────────────────────────────┘

[ Send Now ]
        │
        ▼
[PHONE — INCOMING REQUEST]
"📥 MacBook Pro wants to send 3 files"
  📸 vacation.jpg     2.4 MB
  🎬 video.mp4       847 MB
  📄 report.pdf        1.1 MB
  Total: 850.5 MB

[ Accept All ] [ Decline ] [ Accept Some ]

⚡ "Accept Some" — lets phone pick which files to receive
        │
        ▼
[TRANSFER IN PROGRESS]

Desktop shows:
┌────────────────────────────────────────┐
│ Sending to Pixel 8 Pro                 │
│                                        │
│ vacation.jpg  ████████████░░░  73%     │
│               1.75 MB / 2.4 MB         │
│               68 MB/s · 0.1s left      │
│                                        │
│ video.mp4     Queued                   │
│ report.pdf    Queued                   │
│                                        │
│ 📶 WiFi  🔒 Encrypted  ⚡ 68 MB/s     │
└────────────────────────────────────────┘

Phone shows:
  Notification bar: "Receiving: 73% ▓▓▓▓▓▓░░"
  (visible even when app is in background) ⚡
        │
        ▼
[TRANSFER COMPLETE]
Desktop: "✅ All files sent"
Phone:   "✅ 3 files received → Downloads/DropBeam/"
         [ Open Files ] [ Share ] [ Done ]
```

---

## Flow 3.2 — Send Files (Phone → Desktop)

```
[PHONE — SEND SCREEN]
Three ways:

  WAY 1: [ Photo Library ] — opens native photo picker
  WAY 2: [ Files ] — opens Files app picker
  WAY 3: Share sheet from any app → DropBeam ⚡
         (e.g. WhatsApp photo → Share → DropBeam → MacBook)

Files selected → preview shown:

  [Photo 1] [Photo 2] [Photo 3] [+ 5 more]
  8 photos · 24.6 MB total

  Send to:
  ◉ MacBook Pro  (connected)

  [ Send ]
        │
        ▼
[DESKTOP — incoming notification]
"📥 Pixel 8 Pro wants to send 8 photos"
  [ Accept ] [ Decline ]

(Click Accept)
        │
        ▼
Transfer progress (same as above)
```

---

## Flow 3.3 — Transfer Resume After Disconnect ⚡

*No competitor supports this — biggest gap in LocalSend, PairDrop, Warpinator*

```
[MID-TRANSFER — 60% complete]
Connection drops (WiFi hiccup, phone locked, etc.)
        │
        ▼
[BOTH DEVICES]
  "⚠️ Connection lost"
  "video.mp4: 508 MB / 847 MB transferred"
  "Resume will pick up where you left off."
  [ Retry Connection ] [ Cancel Transfer ]

(Click Retry)
        │
        ▼
Re-pair flow (QR or USB or mDNS auto-reconnect)
        │
        ▼
[RESUME NEGOTIATION]
Desktop sends: "I have chunks 0–507 of video.mp4"
Phone responds: "Confirmed. Resume from chunk 508."
        │
        ▼
[TRANSFER RESUMES from 60%]
  "↩️ Resuming: video.mp4"
  "████████████░░░░  60% → continuing..."
```

---

## Flow 3.4 — Large File Transfer (>4 GB) ⚡

```
User drags a 25 GB video onto DropBeam desktop

[PRE-TRANSFER CHECK]
"25 GB file detected."
"Estimated time on current connection:"
  🔌 USB:    ~90 seconds
  📶 WiFi 6: ~4 minutes
  📶 WiFi 5: ~7 minutes
"USB cable recommended for this size."
[ Proceed ] [ Switch to USB ]

        │ (proceed)
        ▼
Transfer uses:
  - 4 MB chunks (USB) or 1 MB (WiFi)
  - Each chunk encrypted independently
  - Checksum verified per chunk
  - Resume-capable throughout
  - Phone storage checked before starting ⚡
    "Phone has 18 GB free — OK"
    vs.
    "⚠️ Phone has only 20 GB free.
     This file is 25 GB. Not enough space."
```

---

## Flow 3.5 — Folder Transfer with Structure Preserved ⚡

*LocalSend auto-zips folders, breaking structure. PairDrop doesn't support folders.*

```
User drags a folder: /Projects/ClientWork/ (347 files, 12 subfolders)
        │
        ▼
[FOLDER TRANSFER MODAL]
"Projects/ClientWork/
  347 files · 12 subfolders · 2.4 GB total"

  How to transfer:
  ◉ Preserve folder structure  (recommended)
  ○ Zip first, then send
  ○ Send all files flat (no subfolders)

[ Send ]
        │
        ▼
Phone receives:
  Downloads/DropBeam/ClientWork/
    ├── designs/
    │   ├── logo.ai
    │   └── banner.psd
    ├── docs/
    │   └── brief.pdf
    └── ...
Exact structure preserved. No ZIP needed.
```

---

## Flow 3.6 — Clipboard Sync ⚡

*No file transfer app has this. PushBullet had it but required internet.*

```
[DESKTOP]
User copies: "https://github.com/coolrepo"
DropBeam detects clipboard change
(if auto-sync enabled in settings)
        │
        ▼
[PHONE — notification]
"📋 Clipboard from MacBook Pro"
"https://github.com/coolrepo"
[ Open Link ] [ Copy ] [ Dismiss ]

Or manually:

[DESKTOP HOME — Clipboard section]
  Textarea with content
  [ Sync to Phone ] [ Load system clipboard ]

[PHONE]
  Clipboard section shows synced text
  [ Copy to phone clipboard ] [ Open as link ]
```

---

## Flow 3.7 — Send from Share Sheet (Mobile) ⚡

*The one-touch flow no local transfer app has properly*

```
[USER is in Instagram, saves a reel]
        │
(Tap Share → DropBeam in share sheet)
        │
        ▼
DropBeam opens in mini mode (sheet from bottom)
Shows connected devices:
  ◉ MacBook Pro  (last paired, auto-selected)
  ○ Pixel 8 Pro

[ Send to MacBook Pro ]
        │
        ▼
File sent in background
Notification: "✅ Sent to MacBook Pro"
Returns to Instagram automatically
```

LocalSend users who migrated from PushBullet specifically request this "show targets in share menu" feature — DropBeam's share sheet integration is the direct answer to this top community request.

---

## Flow 3.8 — Receive in Background ⚡

*Top community request: LocalSend users say the biggest flaw is needing the app open on both devices — there is no background receive mode.*

```
[PHONE — app is closed / background]
        │
Desktop sends file while phone screen is off
        │
        ▼
[PHONE — system notification]
"📥 MacBook Pro wants to send vacation.jpg (2.4 MB)"
[ Accept ] [ Decline ]

(Tap Accept from notification — app never opens)
        │
        ▼
Transfer happens in background service
        │
        ▼
"✅ vacation.jpg saved to Downloads/DropBeam"
[ Open ] [ Done ]

Phone never needed to be unlocked.
```

---

# PART 4 — ERROR & EDGE CASE FLOWS

---

## Flow 4.1 — Wrong PIN (3 Attempts)

```
[PHONE — PIN entry]
User enters: 123456 (wrong)
        │
        ▼
"❌ Incorrect PIN. 2 attempts remaining."
Input shakes, clears

User enters: 654321 (wrong again)
"❌ Incorrect PIN. 1 attempt remaining."
Warning color turns red

User enters: 999999 (wrong again)
        │
        ▼
"🚫 Too many wrong attempts.
 Session has been locked for security."

[DESKTOP]
"⚠️ 3 wrong PIN attempts detected.
 Session closed. Generate a new QR to try again."
[ New Session ]

🔒 SECURITY: Session is destroyed server-side,
   keypair is deleted, new session required.
   This prevents brute-force of 6-digit PIN.
```

---

## Flow 4.2 — QR Code Expired

```
[PHONE scans QR]
        │
        ▼
"⏰ This QR code has expired.
 QR codes are valid for 10 minutes.
 Ask the sender to generate a new one."

[DESKTOP]
"🔄 QR expired. Generating new session..."
Auto-generates fresh QR in 2 seconds
```

---

## Flow 4.3 — Not on Same WiFi

```
[PHONE scans QR]
TCP connect attempt to 192.168.1.x fails
        │
        ▼
After 5 second timeout:
"⚠️ Can't reach the desktop.
 Make sure both devices are on the same WiFi.

 Desktop is on: MyHomeWifi
 Your phone is on: Check your WiFi settings

 Or use USB cable instead."

[ Switch to USB ] [ Try Again ] [ Help ]
```

---

## Flow 4.4 — Storage Full on Receiver

```
[MID-TRANSFER — phone receiving 4 GB file]
Phone storage fills up at 3.2 GB
        │
        ▼
[PHONE] "💾 Storage full. Transfer paused."
        "3.2 GB received. 800 MB remaining."
        "Free up space and resume."

[DESKTOP] "⏸️ Receiver storage full. Waiting..."

Phone user deletes some files
(Tap Resume)
        │
        ▼
Resume from chunk where it stopped ⚡
(No re-send of already-transferred data)
```

---

## Flow 4.5 — USB "Charging Only" Mode

```
[DESKTOP — USB detection]
Phone detected but adb returns no devices
        │
        ▼
"🔌 Phone detected but in charging-only mode.

 On your phone:
 1. Pull down notification bar
 2. Tap 'USB for charging'
 3. Change to 'File Transfer' or 'MTP'

 [ I've changed it — Retry ]"
```

---

## Flow 4.6 — iPhone "Trust This Computer" Dismissed

```
[DESKTOP — USB iOS flow]
iPhone connected, usbmuxd detects it
Desktop sends trust request
        │
User taps "Don't Trust" on iPhone
        │
        ▼
"🔒 iPhone didn't trust this computer.

 On your iPhone, unlock it and plug in again.
 A 'Trust This Computer?' dialog will appear.
 Tap 'Trust' to allow USB transfer.

 Or switch to WiFi instead."

[ Switch to WiFi ] [ Try Again ]
```

---

## Flow 4.7 — Transfer Fails Mid-Way (Other Errors)

```
[MID-TRANSFER]
Any unexpected error (network, disk, crypto failure)
        │
        ▼
[BOTH DEVICES]
"❌ Transfer failed: [reason]"
  "vacation.jpg: complete ✅"
  "video.mp4: 43% — FAILED"
  "report.pdf: not started"

[ Retry Failed Files ] [ Skip & Continue ] [ Cancel All ]

(Retry failed files)
        │
        ▼
Re-attempts only the failed file from chunk 0
(or from last confirmed chunk if resume data exists)
```

---

## Flow 4.8 — Incoming Transfer While Already Transferring

```
[DESKTOP — actively sending to Phone A]
Phone B tries to connect
        │
        ▼
[DESKTOP notification]
"📲 Phone B wants to connect.
 You're currently transferring to Phone A."

[ Queue for after current transfer ]
[ Open parallel session ] ⚡
[ Decline ]

(Open parallel session)
        │
        ▼
Two sessions run simultaneously
Transfer health panel shows both:
  Phone A: video.mp4 — 67% — 45 MB/s
  Phone B: Connecting...
```

---

# PART 5 — SETTINGS & POWER USER FLOWS

---

## Flow 5.1 — Auto-Accept from Trusted Device ⚡

```
[SETTINGS — Trusted Devices]
After first successful pairing:

  📱 Sushank's iPhone
  [x] Auto-accept transfers  ← toggle
      "Skip the accept prompt for this device"
  [  ] Auto-accept only photos
  [  ] Auto-accept all file types

When enabled:
  Desktop sends file
  Phone receives silently
  Notification: "✅ 3 files from MacBook Pro"
  No approval prompt needed
```

---

## Flow 5.2 — Scheduled / Watch Folder Transfer ⚡

*No file transfer app has this — completely unique*

```
[SETTINGS — Watch Folders]
[ + Add Watch Folder ]
  Source: ~/Desktop/ToPhone/
  Destination device: Sushank's iPhone
  When: Automatically when device connects
  File types: All / Images only / Custom

When iPhone connects next time:
  Desktop detects files in watch folder
  Auto-sends them without any user action
  Notification: "📤 Auto-sent 4 new files to iPhone"
```

---

## Flow 5.3 — Transfer History & Re-Download ⚡

```
[HISTORY SCREEN — any device]
┌────────────────────────────────────────────┐
│ Today                                      │
│  ✅ video.mp4     847 MB  → iPhone  2:34pm│
│  ✅ 8 photos       24 MB  ← Android 1:12pm│
│                                            │
│ Yesterday                                  │
│  ✅ project.zip   1.2 GB  → iPad   11:05am│
│  ❌ backup.tar   4.5 GB  ← Mac   Failed   │
└────────────────────────────────────────────┘

(Tap "backup.tar — Failed")
        │
        ▼
"Retry this transfer?"
[ Retry ] [ Remove from history ]

(Tap "8 photos ← Android")
        │
        ▼
Shows file list + path where saved
[ Open folder ] [ Re-request from device ] [ Share ]
```

---

## Flow 5.4 — Speed Benchmark Screen ⚡

```
[SETTINGS — Benchmark]
[ Run Speed Test ]
        │
        ▼
Sends a 100 MB test file in memory (no disk I/O)
to connected device and back
        │
        ▼
Results:
  Send:    94.3 MB/s   (96% of WiFi 6 ceiling)
  Receive: 91.7 MB/s
  Mode:    📶 WiFi 6 (5 GHz)
  Ceiling: 96 MB/s theoretical

  "For 1 GB: ~11 seconds"
  "For 10 GB: ~108 seconds"
  "Switch to USB for 3x speed →"
```

---

## Flow 5.5 — Dynamic Island Progress (iOS) ⚡

*Requested by LocalSend community: Users specifically request Dynamic Island support for iOS to show transfer progress when the app is backgrounded.*

```
[TRANSFER IN PROGRESS — app backgrounded]

iPhone 14 Pro / 15 / 16:
  Dynamic Island shows:
  [⚡ DropBeam ▓▓▓▓▓░░ 67%]

Tap Dynamic Island:
  Expands to show:
  "video.mp4 — 67%"
  "568 MB / 847 MB"
  "45 MB/s · 6s left"
```

---

## Flow 5.6 — Windows Explorer / macOS Finder Context Menu ⚡

*LocalSend is missing from the Windows 11 "Share with" context menu entirely — users have been requesting this since 2025.*

```
[WINDOWS EXPLORER]
User right-clicks any file
        │
Context menu shows:
  Open
  Cut / Copy / Paste
  ...
  Send via DropBeam →       ← DropBeam installs this
    📱 Sushank's iPhone
    📱 Pixel 8 Pro
    + New device...

(Hover "Sushank's iPhone")
        │
        ▼
Transfer starts immediately
Taskbar notification: "Sending vacation.jpg..."
```

---

## Flow 5.7 — Notification Action Buttons (Android) ⚡

```
[ANDROID NOTIFICATION — incoming transfer]
"📥 MacBook Pro: vacation.jpg (2.4 MB)"

Notification actions (without opening app):
  [ ✅ Accept ]  [ ❌ Decline ]  [ 📁 Change folder ]

(Tap Accept — app never opens)
        │
        ▼
File saves to default location
"✅ Saved to Downloads/DropBeam/"
```

---

# PART 6 — SPECIAL SCENARIOS

---

## Flow 6.1 — Completely Offline (No WiFi, No Hotspot, USB Only)

```
Scenario: On a plane. No WiFi. No mobile data.
          Just a USB-C cable between laptop and phone.
        │
        ▼
[DESKTOP]
Opens app → USB Cable mode
Detects phone via USB
        │
        ▼
[PHONE — DropBeam opens via deep link]
        │
        ▼
🔒 PIN pairing over USB tunnel
        │
        ▼
Transfer at full USB speed
No internet involved at any stage
No server contacted at any stage ⚡
```

---

## Flow 6.2 — Send to Yourself (Same Device, Different App) ⚡

```
Sometimes you just want to move files between
locations on the same machine.

[DESKTOP]
"Send to: This Device"
  Source: ~/Desktop/photo.jpg
  Dest:   ~/Documents/Archive/

Copies with encryption verification
(checksum comparison confirms integrity)
"✅ photo.jpg moved and verified"
```

---

## Flow 6.3 — Guest Mode (Receive Without Installing) ⚡

*For sending files to someone who doesn't have DropBeam*

```
[DESKTOP]
(Click "Guest Send")
        │
        ▼
"Create a one-time share link"
  Expires after: [ 1 use ] [ 10 min ] [ 1 hour ]
  Files to share: [Add Files]

Generates local URL: http://192.168.1.5:49876/guest/abc123

Shows QR of this URL
        │
        ▼
Guest scans QR → browser opens
No app install needed
Browser shows: "Download vacation.jpg (2.4 MB)"
[ Download ]
        │
        ▼
File downloads directly
Link expires after download or time limit
```

---

## Flow 6.4 — iPhone to iPhone (Via Android Relay) ⚡

```
Two iPhones, no Android, no desktop.
Neither can create a hotspot programmatically.

[PHONE A — iPhone]
Tap "Connect without WiFi"
        │
        ▼
"iPhone can't create a hotspot automatically.
 Options:"

  [ Ask Android device to host ]  ← if Android present
  [ Enable Personal Hotspot manually ]
    "1. Go to Settings → Personal Hotspot
     2. Turn it ON
     3. Note the WiFi password shown
     4. Come back here"
  [ Connect via USB to laptop ]

(User manually enables Personal Hotspot)
(User taps "I've enabled it")
        │
        ▼
Shows QR with:
  - Hotspot credentials entered by user
  - App IP + port on hotspot network

Phone B scans QR → joins hotspot → connects
        │
        ▼
🔒 PIN pairing → ✅ Transfer
```

---

# PART 7 — SUMMARY: UNIQUE FLOWS NO APP HAS

| Flow | What It Is | Which apps have it |
|---|---|---|
| 2.2 | USB cable auto-detect + auto-launch | ❌ None |
| 2.4 | Hotspot QR (one scan joins network + connects) | ❌ None |
| 2.5 | Multi-device simultaneous session | ❌ None |
| 2.6 | Remembered device reconnect (1 second) | ❌ None |
| 3.3 | Transfer resume after disconnect | ❌ None |
| 3.5 | Folder transfer with structure preserved | ⚠️ LocalSend zips only |
| 3.6 | Clipboard sync (no internet) | ❌ None |
| 3.7 | Share sheet with direct device target | ❌ None |
| 3.8 | Background receive without opening app | ❌ None |
| 4.3 | "Not on same WiFi" detection + guidance | ❌ None |
| 4.4 | Storage full → pause → resume | ❌ None |
| 5.2 | Watch folder auto-transfer on connect | ❌ None |
| 5.4 | Speed benchmark with ceiling comparison | ❌ None |
| 5.5 | Dynamic Island transfer progress | ❌ None |
| 5.6 | OS context menu with device list | ⚠️ LocalSend broken on Win11 |
| 6.1 | Fully offline (plane mode, USB only) | ❌ None |
| 6.3 | Guest mode (no install, browser download) | ❌ None |

---

*Every path covered. Every edge case handled. Every competitor gap filled.*

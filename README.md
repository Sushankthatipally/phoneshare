# DropBeam

DropBeam is an offline-first local file transfer project focused on fast desktop-to-phone handoff over WiFi or cable, with a native desktop shell and a Safari-first iPhone web app.

This repository now includes a live JS-first stack:

- `apps/desktop` for the desktop control surface
- `apps/iphone-web` for the Safari/PWA shell
- `apps/mobile` for the Android-focused mobile client scaffold
- `packages/local-backend` for the local Node backend used by the desktop and phone clients today
- `packages/protocol` for shared transport and session contracts
- `packages/shared-ui` for shared UI primitives
- `packages/crypto-core` for pairing and crypto primitives that are ready to be integrated into the live transport path
- `docs/` for architecture, security, and product planning

## Current scope

The current product is intentionally JS/TS-first while Rust/Tauri runtime work remains deferred:

- `packages/local-backend` serves live health, dashboard, clipboard, session, upload, download, history, and SSE endpoints
- Desktop, iPhone web, and mobile clients all talk to that live backend instead of mock services
- Resumable chunk uploads, folder preservation, searchable history, device icons, and shared clipboard sync are available on the JS path
- `apps/desktop/src-tauri` still exists for the future native runtime, but that integration is intentionally out of scope for now

## Getting started

```bash
pnpm install
pnpm dev
```

## Next milestones

1. Replace PIN-over-HTTP pairing with QR-first ECDH pairing and live encryption on the JS stack.
2. Add QR rendering/scanning, richer transfer health views, and guest/multi-device workflows.
3. Install Rust and wire the desktop shell into the full Tauri runtime when the JS feature surface is settled.

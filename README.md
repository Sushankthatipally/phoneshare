# DropBeam

DropBeam is an offline-first local file transfer project focused on fast desktop-to-phone handoff over WiFi, hotspot, QR, or cable, with a native desktop shell and a native mobile scaffold.

This repository now includes the native migration surface and keeps the visual language intentionally dark, glassy, and high-contrast:

- `apps/desktop` for the desktop control surface
- `apps/mobile` for the shared native mobile scaffold
- `packages/local-backend` for the current desktop-side runtime
- `packages/protocol` for shared transport and session contracts
- `packages/shared-ui` for shared UI primitives
- `packages/crypto-core` for pairing and crypto primitives
- `docs/` for architecture, migration notes, and product planning

## Current scope

The current product is migrating toward the native-only plan:

- The legacy `apps/iphone-web` surface has been removed from the active workspace
- `apps/mobile` now contains native-plan scaffolding for QR discovery, mDNS, hotspot, TCP, and transfer flows
- The mobile scaffold stays focused on QR, LAN, hotspot, and USB lanes
- Desktop and protocol work remain in place, but this cleanup keeps the browser/PWA surface out of the active path

## Getting started

```bash
pnpm install
pnpm dev
```

## Next milestones

1. Fill in the native mobile modules for QR scanning, discovery, transport, and file handoff.
2. Wire the desktop runtime to the native wire protocol once the mobile scaffold is stable.
3. Add platform build tooling when you want to move from scaffold to a runnable RN app.

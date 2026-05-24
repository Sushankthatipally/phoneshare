# DropBeam Architecture

DropBeam is moving to an all-native desktop plus mobile shape. The legacy iPhone Safari/PWA surface has been retired and is no longer part of the active workspace.

## Target runtime shape

- Desktop remains the always-on host and source of truth for discovery, pairing, and transfer orchestration.
- Mobile is a shared native app surface for iOS and Android.
- QR discovery, LAN discovery, USB handoff, and Android hotspot support are the connection lanes.
- The mobile plan stays QR, LAN, hotspot, and USB only.
- Shared protocol and crypto packages define the wire contract, while app packages own presentation and platform-specific modules.

## Boundaries

- UI owns presentation and product workflows.
- App packages own platform-specific shells and scaffolding.
- Shared packages own the reusable data models, transport contracts, and design primitives.

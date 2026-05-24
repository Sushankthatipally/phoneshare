# Native MVP Slice

The first native slice should prove the mobile shell, discovery, and transfer orchestration without relying on any browser-based pairing flow.

## In scope

- A native mobile scaffold with Home, Scan, Send, Receive, and History surfaces.
- QR ticket scanning for session discovery.
- mDNS discovery for nearby desktops on the same LAN.
- Android hotspot scaffolding for the no-router connection path.
- TCP and transfer service scaffolding that matches the native wire contract shape.
- Chunk-size negotiation handled by the transfer metadata path instead of hardcoded UI logic.

## Out of scope

- Safari/PWA installation flow.
- Browser camera APIs, WebCrypto, or service worker dependencies.
- Platform build tooling until the scaffold is ready for it.

## Why this slice exists

- It gives the repo a clean native direction without keeping the legacy browser surface alive.
- It lets the mobile shell stay visually consistent while the underlying modules are filled in.
- It keeps the migration focused on the smallest native surface that still proves discovery and transfer.

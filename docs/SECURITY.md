# DropBeam Security Notes

The current desktop runtime is live for QR-ticket pairing, resumable chunk transfer, clipboard sync, and history. When a client pairs with the session ticket, file uploads and secure downloads use X25519 key agreement plus AES-256-GCM chunk encryption. Plain HTTP download links still exist as the desktop-host convenience path.

## Present state

- The active local stack uses QR session tickets, automatic secure pairing, resumable chunk uploads, local-only HTTP/SSE transport, clipboard sync, folder metadata preservation, and persisted history.
- `packages/crypto-core` provides the active X25519, HKDF-SHA256, and AES-256-GCM pairing and chunk-encryption flow used by the shared packages.
- `packages/local-backend` stores pairing keys per session, derives the shared secret after pairing, decrypts encrypted uploads, and re-encrypts secure downloads for the paired client.
- `apps/desktop/src-tauri/src/crypto.rs` and the new `pairing.rs` / `qr.rs` modules describe the deferred native security target, but the Rust runtime is not the active product path yet.

## Intended security flow

### WiFi pairing

1. Desktop generates an ephemeral ECDH keypair.
2. QR contains host, port, public key, session id, and expiry.
3. The mobile client generates its own ECDH keypair.
4. Shared secret derives an AES-256-GCM session key.
5. Transfer chunks travel over the local transport in encrypted envelopes.

### USB pairing

1. Cable establishes physical proximity trust.
2. Desktop and mobile still exchange an ephemeral session ticket.
3. Session encryption activates as soon as the handshake completes.

## Engineering rule

Until every active transfer path routes through the encrypted ticket flow, the UI and docs must distinguish between the encrypted client path and the plain desktop-host download path rather than claiming that every transfer surface is end-to-end encrypted.

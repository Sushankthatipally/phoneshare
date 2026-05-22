// crypto-core/src/rn.ts
// Polyfill globalThis.crypto.subtle for React Native using react-native-quick-crypto.
// Consumers import from this file when running on RN (auto-resolved via the
// package.json "react-native" field).

// Optional dependency — must be installed by the mobile app.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qc = require('react-native-quick-crypto');

if (qc?.install) {
  qc.install();
}

export * from './index.js';

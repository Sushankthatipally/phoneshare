import { Platform } from 'react-native';

import { tokens as baseTokens, getDesignToken, type DesignTokens, type DesignTokenPath } from '@dropbeam/shared-ui';

// The canonical token file carries `fontFamily.sans = "Inter"`, which is fine
// as a CSS family name on desktop (the stack in `font.sans` falls back to
// Segoe UI / system sans), but React Native has no font stacks and Inter is
// not bundled in the app: Android silently falls back while react-native-web
// falls back to the browser default (serif!). Map the token to what desktop
// actually renders per platform: the full CSS stack on web, the system sans
// (undefined) on native.
const fontFamily = {
  sans: Platform.select({
    web: baseTokens.font.sans,
    default: undefined,
  }) as unknown as string,
  mono: Platform.select({
    web: baseTokens.font.mono,
    ios: 'Menlo',
    default: 'monospace',
  }) as string,
};

export const tokens: DesignTokens = { ...baseTokens, fontFamily };
export { getDesignToken };
export type { DesignTokens, DesignTokenPath };

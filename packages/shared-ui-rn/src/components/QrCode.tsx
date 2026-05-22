import { View, StyleSheet } from 'react-native';
import RNQRCode from 'react-native-qrcode-svg';

import { tokens } from '../lib/tokens.js';

export interface QrCodeProps {
  value: string;
  size?: number;
}

/**
 * QR rendered against the panel background to match the desktop spec.
 * Foreground stays white so phone cameras can read the modules reliably.
 */
export function QrCode({ value, size = 220 }: QrCodeProps) {
  return (
    <View style={[styles.frame, { width: size + 32, height: size + 32 }]}>
      <RNQRCode
        value={value}
        size={size}
        backgroundColor={tokens.color.bg}
        color={tokens.color.text}
        quietZone={8}
        ecl="M"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    backgroundColor: tokens.color.bg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
    justifyContent: 'center',
  },
});

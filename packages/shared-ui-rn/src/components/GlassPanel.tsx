import type { PropsWithChildren } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../lib/tokens.js';

export interface GlassPanelProps {
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'strong';
}

export function GlassPanel({ children, style, variant = 'default' }: PropsWithChildren<GlassPanelProps>) {
  return (
    <View
      style={[
        styles.base,
        variant === 'strong' ? styles.strong : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: tokens.color.panelBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
    padding: tokens.spacing.lg,
  },
  strong: {
    backgroundColor: tokens.color.panelBgStrong,
    borderColor: tokens.color.panelBorderStrong,
  },
});

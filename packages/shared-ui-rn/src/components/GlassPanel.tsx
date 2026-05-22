import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../tokens.js';

export interface GlassPanelProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'strong';
}

export function GlassPanel({ children, style, tone = 'default' }: GlassPanelProps) {
  const bg = tone === 'strong' ? tokens.color.panelBgStrong : tokens.color.panelBg;
  const border = tone === 'strong' ? tokens.color.panelBorderStrong : tokens.color.panelBorder;

  return (
    <View style={[styles.panel, { backgroundColor: bg, borderColor: border }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
    shadowColor: tokens.shadow.panel.color,
    shadowOpacity: tokens.shadow.panel.opacity,
    shadowOffset: { width: tokens.shadow.panel.offsetX, height: tokens.shadow.panel.offsetY },
    shadowRadius: tokens.shadow.panel.blur,
    elevation: tokens.shadow.panel.elevation,
  },
});

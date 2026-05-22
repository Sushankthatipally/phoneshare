import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../lib/tokens.js';

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'danger';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

const toneColor: Record<BadgeTone, string> = {
  neutral: tokens.color.textSoft,
  blue: tokens.color.blue,
  green: tokens.color.green,
  amber: tokens.color.amber,
  danger: tokens.color.danger,
};

export function Badge({ children, tone = 'neutral', style }: BadgeProps) {
  const color = toneColor[tone];
  return (
    <View style={[styles.base, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    backgroundColor: tokens.color.inputBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  label: {
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.eyebrow,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.eyebrow,
    textTransform: 'uppercase',
  },
});

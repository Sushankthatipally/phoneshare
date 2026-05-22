import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../tokens.js';

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const color = colorFor(tone);

  return (
    <View style={[styles.badge, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function colorFor(tone: BadgeTone): string {
  switch (tone) {
    case 'blue':
      return tokens.color.blue;
    case 'green':
      return tokens.color.green;
    case 'amber':
      return tokens.color.amber;
    case 'neutral':
    default:
      return tokens.color.textSoft;
  }
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: tokens.spacing.xs + 2,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs + 2,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.surfaceSoft,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: tokens.radius.pill,
  },
  label: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
    lineHeight: tokens.fontSize.xs * tokens.lineHeight.tight,
  },
});

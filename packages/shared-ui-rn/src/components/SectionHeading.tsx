import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../tokens.js';

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeading({ eyebrow, title, description, style }: SectionHeadingProps) {
  return (
    <View style={[styles.wrap, style]}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: tokens.spacing.sm,
  },
  eyebrow: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.widest,
    color: tokens.color.textSoft,
    textTransform: 'uppercase',
    lineHeight: tokens.fontSize.xs * tokens.lineHeight.normal,
  },
  title: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xl,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.tight,
    color: tokens.color.text,
    lineHeight: tokens.fontSize.xl * tokens.lineHeight.tight,
  },
  description: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.base,
    color: tokens.color.textSoft,
    lineHeight: tokens.fontSize.base * tokens.lineHeight.relaxed,
  },
});

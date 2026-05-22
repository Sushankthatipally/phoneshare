import { View, Text, StyleSheet } from 'react-native';

import { tokens } from '../lib/tokens.js';

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function SectionHeading({ eyebrow, title, description }: SectionHeadingProps) {
  return (
    <View style={styles.wrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
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
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.eyebrow,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.eyebrow,
    textTransform: 'uppercase',
  },
  title: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.titleLg,
    fontWeight: tokens.fontWeight.bold,
    letterSpacing: tokens.letterSpacing.tight,
    lineHeight: tokens.fontSize.titleLg * 1.1,
  },
  description: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  },
});

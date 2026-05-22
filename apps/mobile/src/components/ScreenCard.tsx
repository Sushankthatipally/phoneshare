import type { PropsWithChildren } from 'react';

import { Text, View } from '../lib/native.js';

export function ScreenCard({
  children,
  eyebrow,
  title,
  copy,
}: PropsWithChildren<{ eyebrow?: string; title?: string; copy?: string }>) {
  return (
    <View style={styles.card}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {copy ? <Text style={styles.copy}>{copy}</Text> : null}
      {children}
    </View>
  );
}

const styles = {
  card: {
    backgroundColor: '#0d1724',
    borderColor: '#20324a',
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  eyebrow: {
    color: '#86aec7',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.7,
    textTransform: 'uppercase' as const,
  },
  title: {
    color: '#f2f7ff',
    fontSize: 22,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 22,
  },
};

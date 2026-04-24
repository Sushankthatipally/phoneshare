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
    borderStyle: 'solid' as const,
    borderWidth: 1,
    display: 'grid',
    gap: 12,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  eyebrow: {
    color: '#86aec7',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.7,
    textTransform: 'uppercase' as const,
  },
  title: {
    color: '#f2f7ff',
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 1.55,
  },
};

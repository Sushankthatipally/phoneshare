import type { PropsWithChildren } from 'react';

import { Text, View } from '../lib/native.js';

type Tone = 'blue' | 'amber' | 'green' | 'slate';

export function LiveBadge({ children, tone = 'blue' }: PropsWithChildren<{ tone?: Tone }>) {
  return (
    <View style={[styles.badge, toneStyles[tone]]}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = {
  badge: {
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: {
    color: '#dfefff',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
};

const toneStyles: Record<Tone, { backgroundColor: string; borderColor: string }> = {
  blue: { backgroundColor: '#10263d', borderColor: '#274860' },
  amber: { backgroundColor: '#3a2d11', borderColor: '#6f5518' },
  green: { backgroundColor: '#113321', borderColor: '#24583b' },
  slate: { backgroundColor: '#0d1724', borderColor: '#243447' },
};

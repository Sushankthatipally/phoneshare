import type { PropsWithChildren } from 'react';

import { Text, View } from '../lib/native.js';

export function LiveBadge({ children }: PropsWithChildren) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = {
  badge: {
    alignItems: 'center',
    backgroundColor: '#10263d',
    borderColor: '#274860',
    borderRadius: 999,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: {
    color: '#d7f4ff',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
};

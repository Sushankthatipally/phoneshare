import type { PropsWithChildren } from 'react';

import { View } from '../lib/native.js';

export function ScreenCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

const styles = {
  card: {
    backgroundColor: '#0d1724',
    borderColor: '#20324a',
    borderRadius: 24,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
};

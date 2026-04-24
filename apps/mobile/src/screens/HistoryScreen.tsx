import { ScreenCard } from '../components/ScreenCard.js';
import { Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function HistoryScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ display: 'grid', gap: 14 }}>
      <ScreenCard
        eyebrow="History"
        title="Completed transfers"
        copy="A native history view makes it easy to keep the transfer story visible without pulling the old browser shell back in."
      >
        <View style={styles.historyList}>
          {backend.history.map((entry) => (
            <View key={entry.id} style={styles.historyCard}>
              <Text style={styles.historyName}>{entry.name}</Text>
              <Text style={styles.historyMeta}>
                {entry.sizeLabel} · {entry.direction} · {entry.mode}
              </Text>
              <Text style={styles.historyMeta}>{entry.completedAtLabel}</Text>
            </View>
          ))}
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  historyList: {
    display: 'grid',
    gap: 10,
  },
  historyCard: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    display: 'grid',
    gap: 6,
    padding: 12,
  },
  historyName: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: 700,
  },
  historyMeta: {
    color: '#99b4c9',
    lineHeight: 1.4,
  },
};

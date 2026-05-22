import { StyleSheet } from 'react-native';

import { Button, ScrollView, Text, View } from '../lib/native.js';
import { useConnection } from '../lib/connection.js';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return date.toLocaleTimeString();
}

export function HistoryScreen() {
  const { history, clearHistory } = useConnection();

  if (!history.length) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>HISTORY</Text>
          <Text style={styles.title}>Nothing here yet</Text>
          <Text style={styles.copy}>Files you send from this device in this session will show up here.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>HISTORY · {history.length}</Text>
        <Text style={styles.title}>This session</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          {history.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{entry.name}</Text>
                <Text style={styles.rowMeta}>
                  {formatBytes(entry.size)} · {formatTime(entry.createdAt)}
                </Text>
                {entry.status === 'failed' ? <Text style={styles.errText}>error: {entry.error}</Text> : null}
              </View>
              <Text
                style={[
                  styles.badge,
                  entry.status === 'done' ? styles.badgeOk : entry.status === 'failed' ? styles.badgeBad : styles.badgeBusy,
                ]}
              >
                {entry.status === 'uploading' ? `${entry.progress}%` : entry.status}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 12 }}>
          <Button onPress={clearHistory}>Clear history</Button>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: 14,
    padding: 16,
  },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f1f1f',
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  eyebrow: {
    color: '#7a7a7a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  copy: {
    color: '#b8b8b8',
    lineHeight: 20,
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  rowName: {
    color: '#ffffff',
    fontWeight: '700',
  },
  rowMeta: {
    color: '#8a8a8a',
    fontSize: 12,
  },
  errText: {
    color: '#ff9b9b',
    fontSize: 12,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  badgeOk: {
    backgroundColor: '#0e2a14',
    color: '#9ee0a8',
  },
  badgeBad: {
    backgroundColor: '#2a0e0e',
    color: '#ffb0b0',
  },
  badgeBusy: {
    backgroundColor: '#0e1f2a',
    color: '#a8d2ff',
  },
});

import { useState } from 'react';
import { Alert, Modal, StyleSheet } from 'react-native';

import { Button, Pressable, ScrollView, Text, View } from '../lib/native.js';
import { reconnectKnownDevice, uploadGuestFile } from '../lib/api.js';
import { useConnection, type HistoryEntry } from '../lib/connection.js';

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
  const { history, clearHistory, knownDevices, addHistory, updateHistory, setConnection } = useConnection();
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [retrying, setRetrying] = useState(false);

  const closeDetail = () => setSelected(null);

  const retry = async (entry: HistoryEntry) => {
    const fingerprint = entry.peerFingerprint;
    if (!fingerprint) {
      Alert.alert('Cannot retry', 'This entry has no peer fingerprint recorded.');
      return;
    }
    const device = knownDevices.find((d) => d.fingerprint === fingerprint);
    if (!device) {
      Alert.alert('Device unknown', 'The original target device is no longer in your known list.');
      return;
    }
    const files = entry.files ?? [];
    if (!files.length || !files.every((f) => f.uri)) {
      Alert.alert(
        'Cannot retry',
        'The original file URIs aren\'t available anymore. Re-pick the files from the Send tab.',
      );
      return;
    }
    setRetrying(true);
    try {
      const reconnect = await reconnectKnownDevice({ origin: device.origin, fingerprint });
      if (!reconnect.ok || !reconnect.connection) {
        Alert.alert('Cannot reach device', `${device.name} isn't reachable right now.`);
        return;
      }
      setConnection(reconnect.connection);
      for (const file of files) {
        const id = `retry-${Date.now()}-${file.name}`;
        addHistory({
          id,
          name: file.name,
          size: file.size,
          status: 'uploading',
          progress: 0,
          createdAt: Date.now(),
          direction: 'send',
          peerFingerprint: fingerprint,
          files: [file],
        });
        try {
          if (reconnect.connection.kind !== 'guest') {
            updateHistory(id, { status: 'failed', error: 'secure session retry not supported yet' });
            continue;
          }
          const response = await uploadGuestFile({
            connection: reconnect.connection,
            fileUri: file.uri as string,
            name: file.name,
            size: file.size,
            mimeType: 'application/octet-stream',
            onProgress: (pct) => updateHistory(id, { progress: pct }),
          });
          updateHistory(
            id,
            response.ok ? { status: 'done', progress: 100 } : { status: 'failed', error: `HTTP ${response.status}` },
          );
        } catch (err) {
          updateHistory(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
      closeDetail();
    } finally {
      setRetrying(false);
    }
  };

  if (!history.length) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>HISTORY</Text>
          <Text style={styles.title}>Nothing here yet</Text>
          <Text style={styles.copy}>Files you send from this device will show up here, even after restarting the app.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>HISTORY · {history.length}</Text>
          <Text style={styles.title}>Recent transfers</Text>
          <View style={{ marginTop: 8, gap: 8 }}>
            {history.map((entry) => (
              <Pressable key={entry.id} style={styles.row} onPress={() => setSelected(entry)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{entry.name}</Text>
                  <Text style={styles.rowMeta}>
                    {formatBytes(entry.size)} · {formatTime(entry.createdAt)}
                    {entry.direction ? ` · ${entry.direction}` : ''}
                  </Text>
                  {entry.status === 'failed' ? <Text style={styles.errText}>error: {entry.error}</Text> : null}
                </View>
                <Text
                  style={[
                    styles.badge,
                    entry.status === 'done'
                      ? styles.badgeOk
                      : entry.status === 'failed'
                        ? styles.badgeBad
                        : styles.badgeBusy,
                  ]}
                >
                  {entry.status === 'uploading' ? `${entry.progress}%` : entry.status}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <Button onPress={clearHistory}>Clear history</Button>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={selected !== null}
        animationType="slide"
        transparent
        onRequestClose={closeDetail}
        presentationStyle="overFullScreen"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selected ? (
              <ScrollView contentContainerStyle={{ gap: 14, padding: 18 }}>
                <Text style={styles.eyebrow}>DETAIL</Text>
                <Text style={styles.title}>{selected.name}</Text>
                <Text style={styles.copy}>
                  {formatBytes(selected.size)} · {selected.status === 'uploading' ? `${selected.progress}%` : selected.status}
                </Text>
                <Text style={styles.copy}>{formatTime(selected.createdAt)}</Text>
                {selected.peerFingerprint ? (
                  <Text style={styles.copy}>Peer: {selected.peerFingerprint.slice(0, 12)}…</Text>
                ) : null}

                {selected.files?.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.eyebrow}>FILES</Text>
                    {selected.files.map((file) => (
                      <View key={file.name} style={styles.fileRow}>
                        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                        <Text style={styles.fileMeta}>{formatBytes(file.size)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {selected.status === 'failed' && selected.error ? (
                  <Text style={styles.errText}>error: {selected.error}</Text>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button onPress={closeDetail}>Close</Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      disabled={retrying || !selected.peerFingerprint}
                      onPress={() => void retry(selected)}
                    >
                      {retrying ? 'Retrying…' : 'Retry transfer'}
                    </Button>
                  </View>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '85%',
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0f0f0f',
    borderColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fileName: { color: '#ffffff', flex: 1, fontWeight: '700' },
  fileMeta: { color: '#8a8a8a', fontSize: 12 },
});

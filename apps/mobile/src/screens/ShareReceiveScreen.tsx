import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system';

import { Button, Pressable, ScrollView, Text, View } from '../lib/native.js';
import { reconnectKnownDevice, uploadGuestFile } from '../lib/api.js';
import { useConnection, type KnownDevice } from '../lib/connection.js';
import type { SharedItem } from '../lib/share-receive.js';

interface ShareReceiveScreenProps {
  items: SharedItem[];
  onDone: () => void;
}

/**
 * Renders the list of files that arrived from the OS share sheet and lets the
 * user pick a previously paired desktop to send them to. Empty state when no
 * known devices.
 */
export function ShareReceiveScreen({ items, onDone }: ShareReceiveScreenProps) {
  const { knownDevices, addHistory, updateHistory, setConnection } = useConnection();
  const [selected, setSelected] = useState<string | null>(knownDevices[0]?.fingerprint ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSize = useMemo(() => items.reduce((sum, item) => sum + (item.size ?? 0), 0), [items]);

  if (!items.length) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SHARE</Text>
          <Text style={styles.title}>No files</Text>
          <Text style={styles.copy}>This screen lists files shared into DropBeam from other apps. Nothing is queued right now.</Text>
          <Button onPress={onDone}>Close</Button>
        </View>
      </ScrollView>
    );
  }

  if (!knownDevices.length) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SHARE · {items.length} FILE{items.length === 1 ? '' : 'S'}</Text>
          <Text style={styles.title}>Pair a device first</Text>
          <Text style={styles.copy}>
            Files received from the share sheet need a paired desktop to send to. Open the Connect tab, pair via QR,
            and try sharing again.
          </Text>
          <Button onPress={onDone}>OK</Button>
        </View>
      </ScrollView>
    );
  }

  const send = async () => {
    const device = knownDevices.find((d) => d.fingerprint === selected);
    if (!device) {
      setError('Pick a device to send to.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reconnect = await reconnectKnownDevice({ origin: device.origin, fingerprint: device.fingerprint });
      if (!reconnect.ok || !reconnect.connection) {
        setError(`Couldn't reach ${device.name}. Make sure it's on the same network.`);
        return;
      }
      setConnection(reconnect.connection);

      for (const item of items) {
        const info = await readItemMeta(item);
        const id = `share-${Date.now()}-${info.name}`;
        addHistory({
          id,
          name: info.name,
          size: info.size,
          status: 'uploading',
          progress: 0,
          createdAt: Date.now(),
          direction: 'send',
          peerFingerprint: device.fingerprint,
          files: [{ name: info.name, size: info.size, uri: info.uri }],
        });
        try {
          const response = await uploadGuestFile({
            connection: reconnect.connection,
            fileUri: info.uri,
            name: info.name,
            size: info.size,
            mimeType: info.mimeType,
            onProgress: (pct) => updateHistory(id, { progress: pct }),
          });
          updateHistory(id, response.ok ? { status: 'done', progress: 100 } : { status: 'failed', error: `HTTP ${response.status}` });
        } catch (err) {
          updateHistory(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SHARE · {items.length} FILE{items.length === 1 ? '' : 'S'}</Text>
        <Text style={styles.title}>Send to which device?</Text>
        {totalSize > 0 ? (
          <Text style={styles.copy}>Total: {formatBytes(totalSize)}</Text>
        ) : null}

        <View style={{ gap: 6, marginTop: 4 }}>
          {items.map((item) => (
            <View key={item.uri} style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name ?? deriveName(item.uri)}
              </Text>
              {item.size ? <Text style={styles.fileMeta}>{formatBytes(item.size)}</Text> : null}
            </View>
          ))}
        </View>

        <View style={{ gap: 8, marginTop: 8 }}>
          {knownDevices.map((device) => (
            <DeviceRow
              key={device.fingerprint}
              device={device}
              selected={selected === device.fingerprint}
              onSelect={() => setSelected(device.fingerprint)}
            />
          ))}
        </View>

        {error ? <Text style={styles.errText}>{error}</Text> : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Button onPress={onDone}>Cancel</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button disabled={busy || !selected} onPress={() => void send()}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: KnownDevice;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable onPress={onSelect} style={[styles.deviceRow, selected ? styles.deviceRowOn : null]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceMeta}>{device.origin}</Text>
      </View>
      <Text style={[styles.badge, selected ? styles.badgeOn : styles.badgeOff]}>
        {selected ? 'Selected' : 'Pick'}
      </Text>
    </Pressable>
  );
}

async function readItemMeta(item: SharedItem): Promise<{ uri: string; name: string; size: number; mimeType: string }> {
  const name = item.name ?? deriveName(item.uri);
  let size = item.size ?? 0;
  if (!size) {
    try {
      const info = await FileSystem.getInfoAsync(item.uri, { size: true });
      if (info.exists) size = (info as { size?: number }).size ?? 0;
    } catch {
      // size stays 0
    }
  }
  return {
    uri: item.uri,
    name,
    size,
    mimeType: item.mimeType ?? 'application/octet-stream',
  };
}

function deriveName(uri: string): string {
  const tail = uri.split('/').pop() ?? 'file';
  // strip any query string
  return tail.split('?')[0] || 'file';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

const styles = StyleSheet.create({
  scroll: { gap: 14, padding: 16 },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f1f1f',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  eyebrow: { color: '#7a7a7a', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  copy: { color: '#b8b8b8', lineHeight: 20 },
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
  deviceRow: {
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  deviceRowOn: {
    borderColor: '#3a8bff',
    backgroundColor: '#0c1828',
  },
  deviceName: { color: '#ffffff', fontWeight: '700' },
  deviceMeta: { color: '#8a8a8a', fontSize: 12 },
  badge: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  badgeOn: { backgroundColor: '#0e1f2a', color: '#a8d2ff' },
  badgeOff: { backgroundColor: '#1a1a1a', color: '#8a8a8a' },
  errText: {
    color: '#ff9b9b',
    fontSize: 12,
    marginTop: 4,
  },
});

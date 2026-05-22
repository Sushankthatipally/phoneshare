import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';

import { Button, ScrollView, Text, View } from '../lib/native.js';
import { uploadGuestFile } from '../lib/api.js';
import { useConnection } from '../lib/connection.js';
import { pickFolderFiles } from '../lib/folder-send.js';
import { LARGE_TRANSFER_BYTES, checkLocalStorage } from '../lib/storage-check.js';

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

export function SendScreenView() {
  const { connection, history, addHistory, updateHistory } = useConnection();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  if (!connection) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>NOT CONNECTED</Text>
          <Text style={styles.title}>Connect to a desktop first</Text>
          <Text style={styles.copy}>Open the Connect tab to scan a QR or paste the share URL from the desktop app.</Text>
          <Button onPress={() => router.replace('/')}>Go to Connect</Button>
        </View>
      </ScrollView>
    );
  }

  const uploadAssets = async (
    assets: Array<{ uri: string; name: string; size: number; mimeType: string; relativePath?: string }>,
  ) => {
    const totalSize = assets.reduce((sum, a) => sum + (a.size ?? 0), 0);
    if (totalSize >= LARGE_TRANSFER_BYTES) {
      const report = await checkLocalStorage(totalSize);
      if (!report.fits) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Low storage',
            `This phone has ${formatBytes(report.freeBytes)} free but you're sending ${formatBytes(totalSize)}. Send anyway?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Send anyway', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });
        if (!confirmed) return;
      }
    }

    for (const asset of assets) {
      const id = `${Date.now()}-${asset.name}`;
      addHistory({
        id,
        name: asset.relativePath ?? asset.name,
        size: asset.size,
        status: 'uploading',
        progress: 0,
        createdAt: Date.now(),
        direction: 'send',
        peerFingerprint: connection.peerFingerprint,
        files: [{ name: asset.name, size: asset.size, uri: asset.uri }],
      });
      try {
        const response = await uploadGuestFile({
          connection,
          fileUri: asset.uri,
          name: asset.relativePath ?? asset.name,
          size: asset.size,
          mimeType: asset.mimeType,
          onProgress: (pct) => updateHistory(id, { progress: pct }),
        });
        if (response.ok) {
          updateHistory(id, { status: 'done', progress: 100 });
        } else {
          updateHistory(id, { status: 'failed', error: `HTTP ${response.status}` });
        }
      } catch (error) {
        updateHistory(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  const pickAndUploadFiles = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: '*/*',
      });
      if (result.canceled) return;
      await uploadAssets(
        result.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          size: a.size ?? 0,
          mimeType: a.mimeType ?? 'application/octet-stream',
        })),
      );
    } finally {
      setBusy(false);
    }
  };

  const pickAndUploadFolder = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await pickFolderFiles();
      if (!result) return;
      if (result.note) setNote(result.note);
      if (!result.files.length) {
        setNote((current) => current ?? 'No files inside the picked folder.');
        return;
      }
      await uploadAssets(result.files);
    } finally {
      setBusy(false);
    }
  };

  const inFlight = history.filter((h) => h.status === 'uploading');
  const recent = history.slice(0, 5);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SEND</Text>
        <Text style={styles.title}>Upload to {connection.label}</Text>
        <Text style={styles.copy}>Pick one or more files, or a whole folder. Files upload directly to your desktop's DropBeam app.</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button disabled={busy} onPress={() => void pickAndUploadFiles()}>
              {busy ? 'Working…' : 'Pick files'}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button disabled={busy} onPress={() => void pickAndUploadFolder()}>
              Send folder
            </Button>
          </View>
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>

      {inFlight.length ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>IN FLIGHT</Text>
          {inFlight.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{entry.name}</Text>
                <Text style={styles.rowMeta}>{formatBytes(entry.size)} · {entry.progress}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(2, entry.progress)}%` }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {recent.length ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>RECENT</Text>
          {recent.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{entry.name}</Text>
                <Text style={styles.rowMeta}>
                  {formatBytes(entry.size)} ·{' '}
                  {entry.status === 'done' ? 'sent' : entry.status === 'failed' ? `failed (${entry.error})` : `${entry.progress}%`}
                </Text>
              </View>
              <Text style={[styles.badge, entry.status === 'done' ? styles.badgeOk : entry.status === 'failed' ? styles.badgeBad : styles.badgeBusy]}>
                {entry.status}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
    gap: 10,
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
  note: {
    color: '#a8d2ff',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  rowName: {
    color: '#ffffff',
    fontWeight: '700',
  },
  rowMeta: {
    color: '#8a8a8a',
    fontSize: 12,
  },
  progressTrack: {
    backgroundColor: '#1a1a1a',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: 100,
  },
  progressFill: {
    backgroundColor: '#3a8bff',
    height: 6,
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

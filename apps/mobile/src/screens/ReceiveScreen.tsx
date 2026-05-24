import { StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

import { Pressable, ScrollView, Text, View } from '../lib/native.js';
import { QuickSaveToggle } from '../components/QuickSaveToggle.js';
import {
  type BackendEvent,
  type TransferBatch,
  useConnection,
} from '../lib/connection.js';
import { useMobileIdentity } from '../lib/identity.js';

function usePulse() {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(value, { toValue: 0, duration: 1400, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

interface ActiveBatch {
  batch: TransferBatch;
  selected: Set<string>;
}

interface SavedFile {
  name: string;
  uri: string;
  size: number;
  text?: string;
  isText: boolean;
  savedAt: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function ReceiveScreen() {
  const { connection, deviceFingerprint, history, subscribe } = useConnection();
  const identity = useMobileIdentity(deviceFingerprint);
  const pulse = usePulse();
  const sessionId = connection?.sessionId ?? null;

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  const [active, setActive] = useState<ActiveBatch | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);

  useEffect(() => {
    return subscribe((event: BackendEvent) => {
      if (event.type === 'transfer-requested') {
        const e = event as Extract<BackendEvent, { type: 'transfer-requested' }>;
        if (sessionId && e.sessionId !== sessionId) return;
        if (!e.batch) return;
        setActive({ batch: e.batch, selected: new Set(e.batch.files.map((f) => f.id)) });
        setStatusLine(null);
      }
      if (event.type === 'file-uploaded') {
        const file = (event as { file?: { id?: string; name?: string; size?: number } }).file;
        if (!file?.id || !file?.name || !connection) return;
        void (async () => {
          const downloadUrl = `${connection.origin}/api/files/${encodeURIComponent(file.id!)}/download`;
          const safeName = file.name!.replace(/[^a-zA-Z0-9._-]/g, '_');
          const target = `${FileSystem.documentDirectory ?? ''}dropbeam/${Date.now()}-${safeName}`;
          try {
            await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory ?? ''}dropbeam`, { intermediates: true });
          } catch {
            // exists
          }
          try {
            const result = await FileSystem.downloadAsync(downloadUrl, target);
            if (result.status >= 200 && result.status < 300) {
              const isText = /\.txt$/i.test(file.name!) || /^text\//.test('');
              let text: string | undefined;
              if (isText) {
                try {
                  text = await FileSystem.readAsStringAsync(result.uri);
                } catch {
                  text = undefined;
                }
              }
              setSavedFiles((prev) => [
                {
                  name: file.name!,
                  uri: result.uri,
                  size: file.size ?? 0,
                  text,
                  isText,
                  savedAt: new Date().toISOString(),
                },
                ...prev,
              ]);
              setStatusLine(`Saved ${file.name}`);
            }
          } catch (err) {
            setStatusLine(err instanceof Error ? err.message : 'Download failed');
          }
        })();
      }
    });
  }, [subscribe, sessionId, connection]);

  const onAcceptAll = useCallback(async () => {
    if (!active || !sessionId || !connection) return;
    setBusy('accept');
    try {
      const res = await fetch(
        `${connection.origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(active.batch.id)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIds: [] }),
        },
      );
      if (!res.ok) {
        setStatusLine(`Accept failed (HTTP ${res.status})`);
        return;
      }
      setActive(null);
      setStatusLine('Accepted');
    } finally {
      setBusy(null);
    }
  }, [active, sessionId, connection]);

  const onDecline = useCallback(async () => {
    if (!active || !sessionId || !connection) return;
    setBusy('decline');
    try {
      await fetch(
        `${connection.origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(active.batch.id)}/decline`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'declined-by-user' }),
        },
      );
      setActive(null);
      setStatusLine('Declined');
    } finally {
      setBusy(null);
    }
  }, [active, sessionId, connection]);

  const incomingBytes = useMemo(
    () => (active ? active.batch.files.reduce((s, f) => s + (f.size || 0), 0) : 0),
    [active],
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.identityBlock}>
        <View style={styles.pulseWrap}>
          <Animated.View
            style={[styles.pulseRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          />
          <View style={styles.deviceGlyph}>
            <Text style={styles.deviceGlyphText}>📡</Text>
          </View>
        </View>
        <Text style={styles.friendlyName}>{identity.friendlyName}</Text>
        <Text style={styles.hashtag}>{identity.hashtag}</Text>
      </View>

      <GlassPanel style={styles.quickSavePanel}>
        <View>
          <Text style={styles.quickSaveLabel}>Quick Save</Text>
          <Text style={styles.quickSaveCopy}>
            {identity.quickSave === 'on'
              ? 'Auto-accepts every incoming transfer.'
              : identity.quickSave === 'favorites'
              ? 'Auto-accepts only from hearted devices.'
              : 'Manual accept on every transfer.'}
          </Text>
        </View>
        <QuickSaveToggle value={identity.quickSave} onChange={identity.setQuickSave} />
      </GlassPanel>

      {active ? (
        <GlassPanel style={styles.incomingPanel}>
          <Text style={styles.incomingTitle}>
            {active.batch.sourceDeviceName ?? 'Peer'} wants to send {active.batch.files.length} item{active.batch.files.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.incomingMeta}>{formatBytes(incomingBytes)} total</Text>
          <View style={styles.fileList}>
            {active.batch.files.map((f) => (
              <View key={f.id} style={styles.fileRow}>
                <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                <Text style={styles.fileMeta}>{formatBytes(f.size)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Pressable onPress={onDecline} disabled={busy !== null} style={styles.ghostButton}>
              <Text style={styles.ghostButtonText}>{busy === 'decline' ? 'Declining…' : 'Decline'}</Text>
            </Pressable>
            <Pressable onPress={onAcceptAll} disabled={busy !== null} style={styles.primaryButton}>
              {busy === 'accept' ? (
                <ActivityIndicator color={tokens.color.textInverse} />
              ) : (
                <Text style={styles.primaryButtonText}>Accept all</Text>
              )}
            </Pressable>
          </View>
        </GlassPanel>
      ) : null}

      {statusLine ? <Text style={styles.status}>{statusLine}</Text> : null}

      <GlassPanel style={styles.historyPanel}>
        <Text style={styles.historyLabel}>Recent transfers</Text>
        {savedFiles.length === 0 && history.length === 0 ? (
          <Text style={styles.historyEmpty}>Nothing yet. Incoming files will appear here.</Text>
        ) : (
          <View style={styles.historyList}>
            {savedFiles.map((f) => (
              <View key={f.uri} style={styles.historyRow}>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyRowName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.historyRowSub}>{formatBytes(f.size)}</Text>
                  {f.isText && f.text ? (
                    <Text style={styles.historyPreview} numberOfLines={6}>{f.text}</Text>
                  ) : null}
                </View>
              </View>
            ))}
            {history.slice(0, 6).map((entry) => (
              <View key={entry.id} style={styles.historyRow}>
                <Text style={styles.historyRowName} numberOfLines={1}>{entry.name}</Text>
                <Text style={styles.historyRowSub}>{entry.status}</Text>
              </View>
            ))}
          </View>
        )}
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: tokens.color.bg,
  },
  scrollContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.xl,
  },
  identityBlock: {
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingVertical: tokens.spacing.xl,
  },
  pulseWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: tokens.color.blue,
  },
  deviceGlyph: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.panelBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceGlyphText: {
    fontSize: 48,
  },
  friendlyName: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.title,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.text,
    letterSpacing: tokens.letterSpacing.tight,
  },
  hashtag: {
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.base,
    color: tokens.color.textDim,
    letterSpacing: tokens.letterSpacing.wide,
  },
  quickSavePanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  quickSaveLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  quickSaveCopy: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
    marginTop: tokens.spacing.xs,
  },
  incomingPanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  incomingTitle: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  incomingMeta: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
  },
  fileList: {
    gap: tokens.spacing.sm,
  },
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.panelBorder,
  },
  fileName: {
    flex: 1,
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.body,
    color: tokens.color.text,
  },
  fileMeta: {
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
    marginLeft: tokens.spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    justifyContent: 'flex-end',
  },
  primaryButton: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.color.text,
    borderRadius: tokens.radius.lg,
  },
  primaryButtonText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textInverse,
  },
  ghostButton: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
  },
  ghostButtonText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
  },
  status: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    paddingHorizontal: tokens.spacing.sm,
  },
  historyPanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  historyLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  historyEmpty: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textDim,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
  historyList: {
    gap: tokens.spacing.sm,
  },
  historyRow: {
    paddingVertical: tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.panelBorder,
  },
  historyMeta: {
    gap: tokens.spacing.xs,
  },
  historyRowName: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.body,
    color: tokens.color.text,
  },
  historyRowSub: {
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
  },
  historyPreview: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    backgroundColor: tokens.color.surfaceSoft,
    padding: tokens.spacing.sm,
    borderRadius: tokens.radius.md,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
});

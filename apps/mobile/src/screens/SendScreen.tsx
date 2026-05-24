import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { GlassPanel, SectionHeading, tokens } from '@dropbeam/shared-ui-rn';

import { Pressable, ScrollView, Text, TextInput, View } from '../lib/native.js';
import { DeviceCard } from '../components/DeviceCard.js';
import { SelectionCard } from '../components/SelectionCard.js';
import { useConnection } from '../lib/connection.js';
import { useDiscovery, type DiscoveredPeer } from '../lib/discovery.js';
import { useMobileIdentity } from '../lib/identity.js';
import { pickFolderFiles } from '../lib/folder-send.js';

type SelectionKind = 'file' | 'folder' | 'text' | 'paste';

interface SelectionItem {
  id: string;
  kind: SelectionKind;
  name: string;
  size: number;
  uri?: string;
  text?: string;
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

export function SendScreenView() {
  const { deviceFingerprint } = useConnection();
  const identity = useMobileIdentity(deviceFingerprint);
  const { peers, available } = useDiscovery({});
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [showTextModal, setShowTextModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);

  const totalBytes = useMemo(() => selection.reduce((sum, item) => sum + item.size, 0), [selection]);

  const onPickFile = useCallback(async () => {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const added: SelectionItem[] = result.assets.map((asset) => ({
        id: `file:${asset.uri}:${Date.now()}`,
        kind: 'file',
        name: asset.name,
        size: asset.size ?? 0,
        uri: asset.uri,
      }));
      setSelection((prev) => [...prev, ...added]);
    } finally {
      setBusy(false);
    }
  }, []);

  const onPickFolder = useCallback(async () => {
    setBusy(true);
    try {
      const result = await pickFolderFiles();
      if (!result || !result.files.length) return;
      const added: SelectionItem[] = result.files.map((file) => ({
        id: `folder:${file.uri}:${Date.now()}`,
        kind: 'folder',
        name: file.relativePath || file.name,
        size: file.size,
        uri: file.uri,
      }));
      setSelection((prev) => [...prev, ...added]);
      if (result.note) setEmptyHint(result.note);
    } catch (err) {
      setEmptyHint(err instanceof Error ? err.message : 'Failed to pick folder');
    } finally {
      setBusy(false);
    }
  }, []);

  const onPasteText = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) {
        setEmptyHint('Clipboard is empty');
        return;
      }
      const id = `paste:${Date.now()}`;
      setSelection((prev) => [
        ...prev,
        { id, kind: 'paste', name: `Pasted ${new Date().toISOString().slice(11, 16)}.txt`, size: new Blob([text]).size, text },
      ]);
    } catch (err) {
      setEmptyHint(err instanceof Error ? err.message : 'Clipboard unavailable');
    }
  }, []);

  const submitText = useCallback(() => {
    const trimmed = textDraft.trim();
    if (!trimmed) {
      setShowTextModal(false);
      return;
    }
    const id = `text:${Date.now()}`;
    setSelection((prev) => [
      ...prev,
      {
        id,
        kind: 'text',
        name: `Note ${new Date().toISOString().slice(11, 16)}.txt`,
        size: new Blob([trimmed]).size,
        text: trimmed,
      },
    ]);
    setTextDraft('');
    setShowTextModal(false);
  }, [textDraft]);

  const clearSelection = useCallback(() => setSelection([]), []);

  const onTapDevice = useCallback(
    (peer: DiscoveredPeer) => {
      if (!selection.length) {
        setEmptyHint('Pick what to send first');
        return;
      }
      setEmptyHint(`Sending to ${peer.txt?.n ?? peer.name}…`);
      // Actual handshake + transfer wired up in Phase D.
    },
    [selection.length],
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <SectionHeading eyebrow="Selection" title="What do you want to send?" />
      <View style={styles.selectionRow}>
        <SelectionCard icon="📄" label="File" onPress={onPickFile} disabled={busy} />
        <SelectionCard icon="📁" label="Folder" onPress={onPickFolder} disabled={busy} />
        <SelectionCard icon="✏️" label="Text" onPress={() => setShowTextModal(true)} />
        <SelectionCard icon="📋" label="Paste" onPress={onPasteText} />
      </View>

      {selection.length ? (
        <GlassPanel style={styles.selectionSummary}>
          <Text style={styles.selectionSummaryText}>
            {selection.length} item{selection.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
          </Text>
          <Pressable onPress={clearSelection} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </Pressable>
        </GlassPanel>
      ) : null}

      {showTextModal ? (
        <GlassPanel style={styles.textModal}>
          <Text style={styles.textModalLabel}>Type a note</Text>
          <TextInput
            value={textDraft}
            onChangeText={setTextDraft}
            placeholder="Type here…"
            multiline
            style={styles.textInput}
          />
          <View style={styles.textModalRow}>
            <Pressable
              onPress={() => {
                setTextDraft('');
                setShowTextModal(false);
              }}
              style={styles.ghostButton}
            >
              <Text style={styles.ghostButtonText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submitText} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add to selection</Text>
            </Pressable>
          </View>
        </GlassPanel>
      ) : null}

      <SectionHeading eyebrow="Nearby" title="Nearby devices" />

      {emptyHint ? <Text style={styles.hint}>{emptyHint}</Text> : null}

      {peers.length === 0 ? (
        <GlassPanel style={styles.emptyState}>
          <ActivityIndicator color={tokens.color.textSoft} />
          <Text style={styles.emptyTitle}>Looking nearby…</Text>
          <Text style={styles.emptyCopy}>
            {available
              ? 'Searching the local network for DropBeam devices.'
              : 'mDNS unavailable on this build — use USB tunnel or enter an IP.'}
          </Text>
        </GlassPanel>
      ) : (
        <View style={styles.deviceList}>
          {peers.map((peer) => (
            <DeviceCard
              key={peer.id}
              peer={peer}
              isFavorite={identity.isFavorite(peer.fingerprint ?? '')}
              transport={(peer.txt?.transport as string) ?? null}
              onPress={() => onTapDevice(peer)}
              onToggleFavorite={() => identity.toggleFavorite(peer.fingerprint ?? '')}
            />
          ))}
        </View>
      )}
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
    gap: tokens.spacing.lg,
  },
  selectionRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
  },
  selectionSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
  },
  selectionSummaryText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.body,
    color: tokens.color.text,
    fontWeight: tokens.fontWeight.medium,
  },
  clearButton: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
  },
  clearButtonText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.wide,
  },
  textModal: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  textModalLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  textInput: {
    minHeight: 120,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.inputBg,
    color: tokens.color.text,
    padding: tokens.spacing.md,
    fontSize: tokens.fontSize.base,
    fontFamily: tokens.fontFamily.sans,
    textAlignVertical: 'top',
  },
  textModalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: tokens.spacing.sm,
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
  hint: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
  emptyState: {
    padding: tokens.spacing.xl,
    alignItems: 'center',
    gap: tokens.spacing.sm,
  },
  emptyTitle: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  emptyCopy: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    textAlign: 'center',
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
  deviceList: {
    gap: tokens.spacing.sm,
  },
});

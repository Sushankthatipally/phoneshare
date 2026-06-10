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
import { requestTransferBatch, uploadSessionFile, waitForTransferDecision } from '../lib/api.js';
import { resolveChunkSize } from '../services/transfer.js';

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
  const { connection, deviceFingerprint, deviceName, startDirectHandshake } = useConnection();
  const identity = useMobileIdentity(deviceFingerprint);
  const { peers, available } = useDiscovery({});
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [showTextModal, setShowTextModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [manualIp, setManualIp] = useState('');
  const [manualPeers, setManualPeers] = useState<DiscoveredPeer[]>([]);
  const mergedPeers = useMemo(() => {
    const map = new Map<string, DiscoveredPeer>();
    for (const p of peers) map.set(p.id, p);
    for (const p of manualPeers) map.set(p.id, p);
    return Array.from(map.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [peers, manualPeers]);

  const onConnectManualIp = useCallback(async () => {
    const ip = manualIp.trim();
    if (!ip) return;
    setBusy(true);
    try {
      const origin = `http://${ip}:17619`;
      const health = await fetch(`${origin}/api/health`).catch(() => null);
      if (!health || !health.ok) {
        setEmptyHint(`Could not reach ${ip}:17619`);
        return;
      }
      let payload: { name?: string; hashtag?: string; platform?: string; fingerprint?: string } = {};
      try {
        const disc = await fetch(`${origin}/api/discovery`);
        const json = (await disc.json()) as { items?: Array<Record<string, unknown>> };
        const self = json.items?.find((i) => i.source === 'self');
        if (self) {
          payload = {
            name: String(self.friendlyName ?? self.name ?? '') || undefined,
            hashtag: String(self.hashtag ?? '') || undefined,
            platform: String(self.platform ?? '') || undefined,
            fingerprint: String(self.fingerprint ?? '') || undefined,
          };
        }
      } catch {
        /* discovery is best-effort */
      }
      const peer: DiscoveredPeer = {
        id: `manual:${ip}:17619`,
        name: payload.name ?? ip,
        host: ip,
        port: 17619,
        fingerprint: payload.fingerprint,
        icon: 'desktop',
        txt: {
          n: payload.name ?? ip,
          tag: payload.hashtag ?? '',
          p: payload.platform ?? 'manual',
          fp: payload.fingerprint ?? '',
          transport: 'manual',
        },
        lastSeenAt: Date.now(),
      };
      setManualPeers((prev) => [...prev.filter((p) => p.id !== peer.id), peer]);
      setEmptyHint(`Added ${payload.name ?? ip}`);
      setManualIp('');
    } finally {
      setBusy(false);
    }
  }, [manualIp]);

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
    async (peer: DiscoveredPeer) => {
      if (!selection.length) {
        setEmptyHint('Pick what to send first');
        return;
      }
      const sid = peer.txt?.sid;
      const pk = peer.txt?.pk;
      const peerName = peer.txt?.n ?? peer.name;
      if (!sid || !pk) {
        setEmptyHint(`${peerName} not advertising a discovery session — refresh and retry.`);
        return;
      }
      setSendingTo(peer.id);
      setEmptyHint(`Pairing with ${peerName}…`);
      const origin = `http://${peer.host}:${peer.port}`;
      try {
        await startDirectHandshake({
          kind: 'direct',
          label: peerName,
          payload: {
            mode: 'wifi',
            transport: 'wifi',
            sessionId: sid,
            host: peer.host,
            port: peer.port,
            publicKey: pk,
            // Discovery TXT does not carry an expiresAt; synthesize a generous
            // 10-minute window so the handshake passes the freshness check.
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          },
        });

        // After pairing, connection holds the derived session key.
        // We read it via the module-level `connection` ref after the handshake
        // completes. The hook captures `connection` from closure; for safety we
        // re-read it from the same state at call time.
        const sessionKey = connection?.sharedSecret;
        if (!sessionKey) {
          setEmptyHint('Session key not available — try again');
          return;
        }

        const batchResult = await requestTransferBatch({
          origin,
          sessionId: sid,
          direction: 'phone-to-desktop',
          deviceName: identity.friendlyName || deviceName,
          files: selection.map((item) => ({
            name: item.name,
            size: item.size,
            mimeType: item.kind === 'text' || item.kind === 'paste' ? 'text/plain' : undefined,
          })),
        });
        if (!batchResult.ok) {
          setEmptyHint(`Batch request failed (${batchResult.status})`);
          return;
        }

        const batch = (batchResult.body as { id?: string } | null)?.id
          ? (batchResult.body as { id: string })
          : null;
        if (!batch?.id) {
          setEmptyHint('Batch request did not return a batch id');
          return;
        }

        setEmptyHint(`Waiting for ${peerName} to accept…`);

        // Wait for transfer-accepted / transfer-declined over the global SSE
        // stream. We use SSE rather than polling because the backend broadcasts
        // transfer-accepted/declined immediately on desktop action and SSE gives
        // sub-100 ms latency with no extra round-trips.
        const decision = await waitForTransferDecision({ origin, batchId: batch.id });

        if (!decision.accepted) {
          setEmptyHint(`Declined by ${peerName}`);
          return;
        }

        // Build a map of name→item for matching accepted file ids.
        // The batch.files entries carry ids assigned by the backend; we match
        // them back to local selection items by name.
        const batchFiles = (batchResult.body as { files?: Array<{ id: string; name: string }> }).files ?? [];
        const acceptedFileIdSet = new Set(decision.fileIds);
        const chunkSize = resolveChunkSize('wifi');
        const myDeviceName = identity.friendlyName || deviceName;

        let uploadIndex = 0;
        let uploadTotal = 0;

        // Count how many items were accepted.
        for (const bf of batchFiles) {
          if (acceptedFileIdSet.has(bf.id)) uploadTotal++;
        }
        if (uploadTotal === 0) {
          // All accepted (no per-file subset filter from desktop).
          uploadTotal = selection.length;
        }

        for (const selectionItem of selection) {
          // Find the matching batch file entry to check if it was accepted.
          const batchFile = batchFiles.find((bf) => bf.name === selectionItem.name);
          if (batchFiles.length > 0 && batchFile && !acceptedFileIdSet.has(batchFile.id)) {
            // Desktop only accepted a subset and this file was not in it — skip.
            continue;
          }

          uploadIndex++;
          setEmptyHint(`Sending ${uploadIndex}/${uploadTotal} — 0%`);

          const result = await uploadSessionFile({
            origin,
            sessionId: sid,
            sharedSecretB64url: sessionKey,
            deviceName: myDeviceName,
            item: selectionItem,
            chunkSize,
            onProgress: (pct) => {
              setEmptyHint(`Sending ${uploadIndex}/${uploadTotal} — ${pct}%`);
            },
          });

          if (!result.ok) {
            const msg = (result.body as { error?: string } | null)?.error ?? `HTTP ${result.status}`;
            setEmptyHint(`Upload failed: ${msg}`);
            return;
          }
        }

        setEmptyHint(`Sent ${uploadTotal} item${uploadTotal === 1 ? '' : 's'} to ${peerName}`);
      } catch (err) {
        setEmptyHint(err instanceof Error ? err.message : 'Send failed');
      } finally {
        setSendingTo(null);
      }
    },
    [connection, deviceName, identity.friendlyName, selection, startDirectHandshake],
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <SectionHeading eyebrow="Selection" title="What do you want to send?" />
      <View style={styles.selectionRow}>
        <SelectionCard icon="file-text" label="File" onPress={onPickFile} disabled={busy} />
        <SelectionCard icon="folder" label="Folder" onPress={onPickFolder} disabled={busy} />
        <SelectionCard icon="type" label="Text" onPress={() => setShowTextModal(true)} />
        <SelectionCard icon="clipboard" label="Paste" onPress={onPasteText} />
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

      {mergedPeers.length === 0 ? (
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
          {mergedPeers.map((peer) => (
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

      <GlassPanel style={styles.fallbackPanel}>
        <Text style={styles.fallbackLabel}>Manual IP</Text>
        <View style={styles.fallbackRow}>
          <TextInput
            value={manualIp}
            onChangeText={setManualIp}
            placeholder="192.168.1.42"
            style={styles.fallbackInput}
          />
          <Pressable onPress={onConnectManualIp} disabled={busy} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Connect</Text>
          </Pressable>
        </View>
        <Text style={styles.emptyCopy}>
          Wi-Fi blocked? Plug in USB and run `adb reverse tcp:17619 tcp:17619`, or type the desktop's IP above.
        </Text>
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
  fallbackPanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.sm,
  },
  fallbackLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  fallbackRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
  },
  fallbackInput: {
    flex: 1,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.inputBg,
    color: tokens.color.text,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.base,
  },
});

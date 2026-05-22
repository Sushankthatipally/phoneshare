import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ScreenCard } from '../components/ScreenCard.js';
import {
  type BackendEvent,
  type TransferBatch,
  type UploadProgress,
  useConnection,
} from '../lib/connection.js';
import {
  endLiveActivity,
  showIncomingNotification,
  startBackgroundReceive,
  startLiveActivity,
  stopBackgroundReceive,
  updateLiveActivity,
} from '../lib/native-modules.js';
import { Button, Pressable, ScrollView, Text, View } from '../lib/native.js';

interface ActiveBatch {
  batch: TransferBatch;
  selected: Set<string>;
}

interface ActiveTransfer {
  batchId: string;
  acceptedFileIds: Set<string>;
  totalBytes: number;
  bytesTransferred: number;
  completedFileIds: Set<string>;
  activityId: string | null;
}

export function IncomingScreen() {
  const { connection, subscribe } = useConnection();
  const sessionId = connection?.sessionId ?? null;
  const peerName = connection?.peerName ?? connection?.label ?? 'Desktop';

  const [active, setActive] = useState<ActiveBatch | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const transferRef = useRef<ActiveTransfer | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return subscribe((event) => {
      handleEvent(event);
    });
    function handleEvent(event: BackendEvent) {
      if (event.type === 'transfer-requested') {
        const requestedSessionId = (event as Extract<BackendEvent, { type: 'transfer-requested' }>).sessionId;
        if (sessionId && requestedSessionId !== sessionId) return;
        const batch = (event as Extract<BackendEvent, { type: 'transfer-requested' }>).batch;
        if (!batch) return;
        setActive({ batch, selected: new Set(batch.files.map((f) => f.id)) });
        setStatusLine(null);
        if (appStateRef.current !== 'active') {
          const totalBytes = batch.files.reduce((sum, f) => sum + (f.size || 0), 0);
          void showIncomingNotification({
            title: `${batch.sourceDeviceName ?? peerName} wants to send ${batch.files.length} file${batch.files.length === 1 ? '' : 's'}`,
            body: `${formatBytes(totalBytes)} total`,
            sessionId: requestedSessionId,
            batchId: batch.id,
            files: batch.files.length,
            totalBytes,
          });
        }
        return;
      }
      if (event.type === 'upload-progress') {
        const upload = (event as Extract<BackendEvent, { type: 'upload-progress' }>).upload as
          | UploadProgress
          | undefined;
        const transfer = transferRef.current;
        if (!upload || !transfer) return;
        if (!transfer.acceptedFileIds.has(upload.id)) return;
        // Naive aggregate: bytesTransferred is the sum of per-file uploadedBytes for
        // accepted files in this batch. We track the running max per file by id.
        const perFile = new Map<string, number>();
        perFile.set(upload.id, upload.uploadedBytes);
        let aggregate = 0;
        for (const value of perFile.values()) aggregate += value;
        transfer.bytesTransferred = Math.max(transfer.bytesTransferred, aggregate);
        if (transfer.activityId) {
          void updateLiveActivity(transfer.activityId, {
            bytesTransferred: transfer.bytesTransferred,
            totalBytes: transfer.totalBytes,
          });
        }
        return;
      }
      if (event.type === 'file-uploaded') {
        const fileId = (event as { file?: { id?: string } }).file?.id;
        const transfer = transferRef.current;
        if (!transfer || !fileId) return;
        if (!transfer.acceptedFileIds.has(fileId)) return;
        transfer.completedFileIds.add(fileId);
        if (transfer.completedFileIds.size >= transfer.acceptedFileIds.size) {
          if (transfer.activityId) void endLiveActivity(transfer.activityId);
          void stopBackgroundReceive();
          transferRef.current = null;
          setStatusLine(`Received ${transfer.acceptedFileIds.size} file${transfer.acceptedFileIds.size === 1 ? '' : 's'}.`);
        }
      }
    }
  }, [subscribe, sessionId, peerName]);

  const onToggle = useCallback((fileId: string) => {
    setActive((current) => {
      if (!current) return current;
      const selected = new Set(current.selected);
      if (selected.has(fileId)) selected.delete(fileId);
      else selected.add(fileId);
      return { ...current, selected };
    });
  }, []);

  const onAccept = useCallback(
    async (fileIds: string[] | null) => {
      if (!active || !sessionId || !connection) return;
      setBusy('accept');
      try {
        const response = await fetch(
          `${connection.origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(active.batch.id)}/accept`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: fileIds ?? [] }),
          },
        );
        if (!response.ok) {
          setStatusLine(`Accept failed (HTTP ${response.status}).`);
          return;
        }
        const accepted = fileIds ?? active.batch.files.map((f) => f.id);
        const acceptedSet = new Set(accepted);
        const acceptedFiles = active.batch.files.filter((f) => acceptedSet.has(f.id));
        const totalBytes = acceptedFiles.reduce((sum, f) => sum + (f.size || 0), 0);

        const activityId = await startLiveActivity({
          title: acceptedFiles.length === 1 ? acceptedFiles[0].name : `${acceptedFiles.length} files`,
          sessionId,
          peerName: active.batch.sourceDeviceName ?? peerName,
          totalBytes,
        });
        void startBackgroundReceive(sessionId, active.batch.id);

        transferRef.current = {
          batchId: active.batch.id,
          acceptedFileIds: acceptedSet,
          totalBytes,
          bytesTransferred: 0,
          completedFileIds: new Set(),
          activityId,
        };
        setActive(null);
        setStatusLine(`Accepted ${acceptedFiles.length} file${acceptedFiles.length === 1 ? '' : 's'}.`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : 'Accept failed.');
      } finally {
        setBusy(null);
      }
    },
    [active, sessionId, connection, peerName],
  );

  const onDecline = useCallback(async () => {
    if (!active || !sessionId || !connection) return;
    setBusy('decline');
    try {
      const response = await fetch(
        `${connection.origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(active.batch.id)}/decline`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'declined-by-user' }),
        },
      );
      if (!response.ok) {
        setStatusLine(`Decline failed (HTTP ${response.status}).`);
        return;
      }
      setActive(null);
      setStatusLine('Declined.');
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : 'Decline failed.');
    } finally {
      setBusy(null);
    }
  }, [active, sessionId, connection]);

  const selectedCount = active ? active.selected.size : 0;
  const fileCount = active?.batch.files.length ?? 0;
  const totalBytes = useMemo(
    () => (active ? active.batch.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0),
    [active],
  );

  if (!active) {
    return (
      <View style={layoutStyles.wrap}>
        <ScreenCard
          eyebrow="Incoming"
          title="Waiting for a transfer"
          copy={
            sessionId
              ? 'You will be prompted here when a paired device starts sending.'
              : 'Pair with a desktop to start receiving files.'
          }
        >
          {statusLine ? <Text style={layoutStyles.status}>{statusLine}</Text> : null}
        </ScreenCard>
      </View>
    );
  }

  const senderLabel = active.batch.sourceDeviceName ?? peerName;
  return (
    <ScrollView style={layoutStyles.wrap} contentContainerStyle={layoutStyles.scroll}>
      <ScreenCard
        eyebrow="Incoming"
        title={`${senderLabel} wants to send ${fileCount} file${fileCount === 1 ? '' : 's'}`}
        copy={`${formatBytes(totalBytes)} total. Tap a file to toggle, then choose how to respond.`}
      >
        <View style={layoutStyles.fileList}>
          {active.batch.files.map((file) => {
            const checked = active.selected.has(file.id);
            return (
              <Pressable
                key={file.id}
                onPress={() => onToggle(file.id)}
                style={[fileStyles.row, checked ? fileStyles.rowSelected : fileStyles.rowUnselected]}
              >
                <View style={fileStyles.checkbox}>
                  <Text style={fileStyles.checkmark}>{checked ? 'on' : 'off'}</Text>
                </View>
                <View style={fileStyles.meta}>
                  <Text style={fileStyles.name}>{file.name}</Text>
                  <Text style={fileStyles.detail}>
                    {formatBytes(file.size)}
                    {file.mimeType ? ` · ${file.mimeType}` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={layoutStyles.actionRow}>
          <View style={layoutStyles.actionPrimary}>
            <Button disabled={busy !== null} onPress={() => void onAccept(null)}>
              {busy === 'accept' ? 'Accepting…' : 'Accept all'}
            </Button>
          </View>
          <View style={layoutStyles.actionSecondary}>
            <Button
              disabled={busy !== null || selectedCount === 0 || selectedCount === fileCount}
              onPress={() => void onAccept(Array.from(active.selected))}
            >
              {selectedCount === 0
                ? 'Accept selected'
                : `Accept selected (${selectedCount})`}
            </Button>
          </View>
          <View style={layoutStyles.actionDanger}>
            <Button disabled={busy !== null} onPress={() => void onDecline()}>
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
          </View>
        </View>

        {statusLine ? <Text style={layoutStyles.status}>{statusLine}</Text> : null}
      </ScreenCard>
    </ScrollView>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const layoutStyles = {
  wrap: { flex: 1 } as const,
  scroll: { gap: 14, paddingBottom: 24 } as const,
  fileList: { gap: 8, marginTop: 6 } as const,
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 14,
  },
  actionPrimary: { flexBasis: '100%' as const },
  actionSecondary: { flex: 1, minWidth: 140 },
  actionDanger: { flex: 1, minWidth: 100 },
  status: {
    color: '#a9bfd3',
    fontSize: 13,
    marginTop: 10,
  },
};

const fileStyles = {
  row: {
    backgroundColor: '#0c1625',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row' as const,
    gap: 12,
    padding: 12,
  },
  rowSelected: { borderColor: '#3aa9ff' },
  rowUnselected: { borderColor: '#1e2f44' },
  checkbox: {
    alignItems: 'center' as const,
    backgroundColor: '#0a1320',
    borderColor: '#274860',
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center' as const,
    width: 36,
  },
  checkmark: {
    color: '#86aec7',
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  meta: { flex: 1, gap: 4 },
  name: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  detail: { color: '#a9bfd3', fontSize: 12 },
};

import { useEffect, useRef } from 'react';

import { Button } from '@dropbeam/shared-ui';
import { formatBytes, resolveBackendOrigin } from '@dropbeam/protocol';
import type { LiveSessionRecord, PendingTransferBatch } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

const BACKEND_ORIGIN = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);

type PairingItem = { kind: 'pairing'; session: LiveSessionRecord; key: string };
type TransferItem = { kind: 'transfer'; session: LiveSessionRecord; batch: PendingTransferBatch; key: string };
type Item = PairingItem | TransferItem;

export function IncomingBanner({ backend }: { backend: DesktopBackendState }) {
  const pairingItems: PairingItem[] = backend.sessions
    .filter((session) => session.state === 'awaiting-accept' && session.pendingRequest)
    .map((session) => ({ kind: 'pairing', session, key: `pair:${session.id}` }));

  const transferItems: TransferItem[] = backend.sessions.flatMap((session) =>
    (session.pendingTransfers ?? []).map((batch) => ({
      kind: 'transfer' as const,
      session,
      batch,
      key: `xfer:${session.id}:${batch.id}`,
    })),
  );

  const items: Item[] = [...pairingItems, ...transferItems];
  const notifiedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.hidden) return;
    const fresh = items.filter((item) => !notifiedKeysRef.current.has(item.key));
    if (!fresh.length) return;

    const win = window as Window & {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
    };
    const invoke = win.__TAURI_INTERNALS__?.invoke;

    for (const item of fresh) {
      notifiedKeysRef.current.add(item.key);
      const { title, body } = describeNotification(item);
      if (invoke) {
        void invoke('system_notify', { input: { title, body } }).catch(() => undefined);
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(title, { body });
        } catch {
          // ignore
        }
      }
    }
  }, [items]);

  useEffect(() => {
    const liveKeys = new Set(items.map((item) => item.key));
    for (const key of Array.from(notifiedKeysRef.current)) {
      if (!liveKeys.has(key)) notifiedKeysRef.current.delete(key);
    }
  }, [items]);

  if (!items.length) return null;

  return (
    <div className="list" style={{ marginBottom: 16 }}>
      {items.map((item) => {
        if (item.kind === 'pairing') {
          const request = item.session.pendingRequest!;
          return (
            <div className="banner" key={item.key}>
              <div className="banner__copy">
                <strong>{request.peer.name} wants to connect</strong>
                <span>
                  {request.peer.platform} · session {item.session.id.slice(0, 8)} · {new Date(request.requestedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="banner__actions">
                <Button onClick={() => void backend.declineIncoming(item.session.id)} variant="ghost">
                  Decline
                </Button>
                <Button onClick={() => void backend.acceptIncoming(item.session.id, true)} variant="primary">
                  Accept
                </Button>
              </div>
            </div>
          );
        }

        const { session, batch } = item;
        const totalBytes = batch.files.reduce((sum, file) => sum + file.size, 0);
        const sourceLabel = batch.sourceDeviceName ?? session.peerDevice?.name ?? 'Phone';
        return (
          <div className="banner" key={item.key}>
            <div className="banner__copy">
              <strong>
                {sourceLabel} wants to send {batch.files.length} file{batch.files.length === 1 ? '' : 's'}
              </strong>
              <span>
                {formatBytes(totalBytes)} · session {session.id.slice(0, 8)} · {new Date(batch.requestedAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="banner__actions">
              <Button onClick={() => void declineBatch(backend, session.id, batch.id)} variant="ghost">
                Decline
              </Button>
              <Button onClick={() => void acceptBatch(backend, session.id, batch.id)} variant="primary">
                Accept
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function describeNotification(item: Item): { title: string; body: string } {
  if (item.kind === 'pairing') {
    const peer = item.session.pendingRequest?.peer;
    return {
      title: 'DropBeam · device wants to connect',
      body: peer ? `${peer.name} (${peer.platform})` : `Session ${item.session.id.slice(0, 8)}`,
    };
  }
  const totalBytes = item.batch.files.reduce((sum, file) => sum + file.size, 0);
  const source = item.batch.sourceDeviceName ?? item.session.peerDevice?.name ?? 'Phone';
  return {
    title: 'DropBeam · incoming files',
    body: `${source} · ${item.batch.files.length} file${item.batch.files.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`,
  };
}

async function acceptBatch(backend: DesktopBackendState, sessionId: string, batchId: string) {
  await fetch(`${BACKEND_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(batchId)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  await backend.refresh();
}

async function declineBatch(backend: DesktopBackendState, sessionId: string, batchId: string) {
  await fetch(`${BACKEND_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(batchId)}/decline`, {
    method: 'POST',
  });
  await backend.refresh();
}

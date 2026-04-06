import { useEffect, useState } from 'react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Home({ backend }: { backend: DesktopBackendState }) {
  const session = backend.activeSession;
  const [clipboardText, setClipboardText] = useState('');
  const activeUploads = backend.activeUploads.filter((upload) => upload.sessionId === session?.id);

  useEffect(() => {
    setClipboardText(backend.clipboard?.text ?? '');
  }, [backend.clipboard?.text]);

  const summaryCards = [
    {
      label: 'Peer',
      value: session?.peerDevice?.name ?? 'Waiting',
      note: session?.pairing.verifiedAt ? 'Phone is paired and ready.' : 'Share the PIN to complete pairing.',
    },
    {
      label: 'Uploads',
      value: String(activeUploads.length),
      note: activeUploads.length ? 'Chunked uploads are live right now.' : 'No files are currently in flight.',
    },
    {
      label: 'Clipboard',
      value: backend.clipboard?.sourceDeviceName ?? 'Desktop',
      note: backend.clipboard?.updatedAt
        ? `Updated ${new Date(backend.clipboard.updatedAt).toLocaleTimeString()}`
        : 'Clipboard sync is idle.',
    },
  ];

  return (
    <div className="desktop-screen">
      <div className="desktop-home-grid">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Overview"
            title={session ? 'Live transfer session' : 'No live session yet'}
            description={
              session
                ? 'This panel reads directly from the backend session record. It mirrors pairing, clipboard, and transfer progress without placeholder data.'
                : 'Create a new session to expose a PIN, a pairing ticket, and real transfer queues.'
            }
          />

          <div className="desktop-security-strip">
            <Badge tone={session?.pairing.verifiedAt ? 'green' : 'amber'}>
              {session?.pairing.verifiedAt ? 'paired' : 'verification pending'}
            </Badge>
            <Badge tone="blue">{session?.mode ?? backend.settings?.preferredMode ?? 'wifi'}</Badge>
            <Badge>{backend.health?.sessions ?? 0} sessions tracked</Badge>
          </div>

          <div className="desktop-summary-strip">
            {summaryCards.map((item) => (
              <article className="desktop-summary-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.note}</p>
              </article>
            ))}
          </div>

          <div className="desktop-actions">
            <Button disabled={backend.busy === 'create-session'} onClick={() => void backend.createSession()}>
              {session ? 'Open another session' : 'Create session'}
            </Button>
            <Button
              disabled={!session?.pairing.pin}
              onClick={() => {
                void navigator.clipboard?.writeText?.(session?.pairing.pin ?? '');
              }}
              variant="secondary"
            >
              Copy PIN
            </Button>
            <Button onClick={() => void backend.refresh()} variant="ghost">
              Refresh
            </Button>
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-ticket">
          <div>
            <p className="desktop-panel-kicker">Pair</p>
            <strong>{session ? 'Current session ticket' : 'No ticket yet'}</strong>
            <p>
              {session
                ? 'Use the PIN or the phone pairing route to verify the device.'
                : 'Create a session before pairing a phone.'}
            </p>
          </div>

          <div className="desktop-ticket__pin">{session?.pairing.pin ?? '------'}</div>
          <div className="desktop-ticket__qr" aria-hidden="true" />

          <div className="desktop-ticket__meta">
            <div>
              <span className="desktop-ticket__label">Session</span>
              <strong>{session?.id.slice(0, 8) ?? 'Not created'}</strong>
            </div>
            <div>
              <span className="desktop-ticket__label">Mode</span>
              <strong>{session?.mode ?? backend.settings?.preferredMode ?? 'wifi'}</strong>
            </div>
            <div>
              <span className="desktop-ticket__label">Local device</span>
              <strong>{backend.settings?.deviceName ?? 'DropBeam Desktop'}</strong>
            </div>
            <div>
              <span className="desktop-ticket__label">Peer</span>
              <strong>{session?.peerDevice?.name ?? 'Waiting for phone'}</strong>
            </div>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Clipboard"
          title="Share links, notes, and snippets"
          description="Clipboard sync uses the live backend so desktop and phone can exchange text without creating a file transfer."
        />

        <label className="desktop-field">
          <span>Shared clipboard</span>
          <textarea
            className="desktop-field__textarea"
            onChange={(event) => setClipboardText(event.target.value)}
            placeholder="Paste or type text to sync with the paired phone."
            value={clipboardText}
          />
        </label>

        <div className="desktop-actions">
          <Button
            disabled={backend.busy === 'update-clipboard'}
            onClick={() => void backend.updateClipboard(clipboardText)}
          >
            {backend.busy === 'update-clipboard' ? 'Syncing' : 'Sync clipboard'}
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard?.readText?.().then((value) => setClipboardText(value));
            }}
            variant="secondary"
          >
            Load system clipboard
          </Button>
          <Button
            disabled={!backend.clipboard?.text}
            onClick={() => {
              void navigator.clipboard?.writeText?.(backend.clipboard?.text ?? '');
            }}
            variant="ghost"
          >
            Copy live text
          </Button>
        </div>
      </GlassPanel>

      <div className="desktop-two-up">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Transfer health"
            title={activeUploads.length ? `${activeUploads.length} uploads in flight` : 'No active uploads'}
            description="Upload progress is computed from the real chunked transfer pipeline."
          />

          <div className="desktop-progress-list">
            {activeUploads.length ? (
              activeUploads.map((upload) => (
                <article className="desktop-progress-card" key={upload.id}>
                  <div className="desktop-progress-card__header">
                    <div className="desktop-progress-card__copy">
                      <strong>{upload.name}</strong>
                      <p>
                        {formatBytes(upload.uploadedBytes)} / {formatBytes(upload.size)} - {upload.direction}
                      </p>
                    </div>
                    <Badge tone="blue">{upload.progressPercent}%</Badge>
                  </div>
                  <div className="desktop-progress-bar">
                    <div className="desktop-progress-fill" style={{ width: `${upload.progressPercent}%` }} />
                  </div>
                  <div className="desktop-progress-meta">
                    <span>{upload.totalChunks} chunks</span>
                    <span>{formatSpeed(upload.averageBytesPerSecond)}</span>
                  </div>
                </article>
              ))
            ) : (
              <div className="desktop-empty-state">
                <p>Transfers will appear here while files are moving in either direction.</p>
              </div>
            )}
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Recent sessions"
            title="Closed and completed sessions"
            description="The backend persists completed sessions and exposes them here immediately."
          />

          <div className="desktop-history-list">
            {backend.history.length ? (
              backend.history.slice(0, 4).map((entry) => (
                <article className="desktop-history-card" key={entry.id}>
                  <div className="desktop-history-card__copy">
                    <strong>{entry.peerDevice?.name ?? 'Unpaired phone session'}</strong>
                    <p>
                      {entry.summary.totalFiles} files - {formatBytes(entry.summary.totalBytes)}
                    </p>
                  </div>
                  <div className="desktop-history-card__meta">{entry.state}</div>
                </article>
              ))
            ) : (
              <div className="desktop-empty-state">
                <p>No completed sessions have been recorded yet.</p>
              </div>
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function formatSpeed(bytesPerSecond?: number | null) {
  if (!bytesPerSecond) {
    return 'Measuring';
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

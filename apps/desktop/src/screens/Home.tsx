import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, GlassPanel, QrCode, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Home({ backend }: { backend: DesktopBackendState }) {
  const session = backend.activeSession;
  const [clipboardText, setClipboardText] = useState('');
  const activeUploads = backend.activeUploads.filter((upload) => upload.sessionId === session?.id);
  const benchmark = useMemo(() => {
    const mode = session?.mode ?? backend.settings?.preferredMode ?? 'wifi';
    const ceilingBytesPerSecond = theoreticalCeiling(mode);
    const fileSamples = [
      ...(session?.files['desktop-to-phone'] ?? []),
      ...(session?.files['phone-to-desktop'] ?? []),
    ]
      .filter((file) => file.averageBytesPerSecond && file.averageBytesPerSecond > 0)
      .slice()
      .sort((left, right) => Date.parse(right.uploadedAt ?? right.createdAt) - Date.parse(left.uploadedAt ?? left.createdAt))
      .slice(0, 6);
    const uploadSamples = activeUploads
      .filter((upload) => upload.averageBytesPerSecond && upload.averageBytesPerSecond > 0)
      .map((upload) => ({
        label: upload.name,
        speed: upload.averageBytesPerSecond ?? 0,
      }));

    const recentSamples = [...uploadSamples, ...fileSamples.map((file) => ({ label: file.name, speed: file.averageBytesPerSecond ?? 0 }))]
      .filter((sample) => sample.speed > 0)
      .slice(0, 6);

    const observedBytesPerSecond =
      recentSamples.reduce((peak, sample) => Math.max(peak, sample.speed), 0) ||
      activeUploads.reduce((peak, upload) => Math.max(peak, upload.averageBytesPerSecond ?? 0), 0);

    return {
      ceilingBytesPerSecond,
      mode,
      observedBytesPerSecond,
      recentSamples,
      utilization: ceilingBytesPerSecond ? Math.min(100, Math.round((observedBytesPerSecond / ceilingBytesPerSecond) * 100)) : 0,
    };
  }, [activeUploads, backend.settings?.preferredMode, session?.files, session?.mode]);

  useEffect(() => {
    setClipboardText(backend.clipboard?.text ?? '');
  }, [backend.clipboard?.text]);

  const summaryCards = [
    {
      label: 'Peer',
      value: session?.peerDevice?.name ?? 'Waiting',
      note: session?.pairing.verifiedAt ? 'Secure channel is active and ready.' : 'Share the QR ticket to complete pairing.',
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
                : 'Create a new session to expose a QR ticket, a secure handshake lane, and real transfer queues.'
            }
          />

          <div className="desktop-security-strip">
            <Badge tone={session?.pairing.verifiedAt ? 'green' : 'amber'}>
              {session?.pairing.verifiedAt ? 'paired' : 'handshake pending'}
            </Badge>
            <Badge tone="blue">{session?.mode ?? backend.settings?.preferredMode ?? 'wifi'}</Badge>
            <Badge>{session ? 'qr-first pairing' : 'session required'}</Badge>
            <Badge tone={session?.pairing.encrypted ? 'green' : 'amber'}>
              {session?.pairing.encrypted ? 'encrypted lane live' : 'encryption pending'}
            </Badge>
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

          <div className="desktop-benchmark">
            <div className="desktop-benchmark__copy">
              <p className="desktop-panel-kicker">Benchmark</p>
              <strong>{speedLabel(benchmark.observedBytesPerSecond)} observed</strong>
              <p>
                Live throughput is compared to the mode ceiling of {speedLabel(benchmark.ceilingBytesPerSecond)} for{' '}
                {benchmark.mode.toUpperCase()}.
              </p>
            </div>

            <div className="desktop-benchmark__metrics">
              <article className="desktop-benchmark__metric">
                <span>Observed</span>
                <strong>{speedLabel(benchmark.observedBytesPerSecond)}</strong>
                <p>Highest live rate from active uploads or recent completed files.</p>
              </article>
              <article className="desktop-benchmark__metric">
                <span>Theoretical ceiling</span>
                <strong>{speedLabel(benchmark.ceilingBytesPerSecond)}</strong>
                <p>Estimated ceiling for the current transport mode.</p>
              </article>
              <article className="desktop-benchmark__metric">
                <span>Utilization</span>
                <strong>{benchmark.utilization}%</strong>
                <p>Observed throughput relative to the ceiling.</p>
              </article>
            </div>

            <div className="desktop-benchmark__visual">
              <div className="desktop-benchmark__meter" aria-hidden="true">
                <span className="desktop-benchmark__meter-fill" style={{ width: `${benchmark.utilization}%` }} />
              </div>
              {benchmark.recentSamples.length ? (
                <div className="desktop-benchmark__bars" aria-hidden="true">
                  {benchmark.recentSamples.map((sample, index) => {
                    const height = benchmark.ceilingBytesPerSecond
                      ? Math.max(18, Math.min(100, (sample.speed / benchmark.ceilingBytesPerSecond) * 100))
                      : 18;

                    return (
                      <div className="desktop-benchmark__bar" key={`${sample.label}-${index}`}>
                        <span style={{ height: `${height}%` }} />
                        <small>{sample.label}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="desktop-empty-state">
                  <p>Start a transfer to populate the live throughput graph with real chunk samples.</p>
                </div>
              )}
            </div>
          </div>

          <div className="desktop-actions">
            <Button disabled={backend.busy === 'create-session'} onClick={() => void backend.createSession()}>
              {session ? 'Open another session' : 'Create session'}
            </Button>
            <Button
              disabled={!session?.pairing.ticket.qrValue}
              onClick={() => {
                void navigator.clipboard?.writeText?.(session?.pairing.ticket.qrValue ?? '');
              }}
              variant="secondary"
            >
              Copy QR ticket
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
                ? 'Use the QR ticket or local discovery to establish the secure lane.'
                : 'Create a session before pairing a phone.'}
            </p>
          </div>

          <div className="desktop-ticket__pin">{session?.pairing.verifiedAt ? 'LIVE' : 'SCAN'}</div>
          <div className="desktop-ticket__qr">
            <QrCode size={204} value={session?.pairing.ticket.qrValue} />
          </div>

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
            <div>
              <span className="desktop-ticket__label">Handshake</span>
              <strong>Automatic</strong>
            </div>
            <div>
              <span className="desktop-ticket__label">Encryption</span>
              <strong>{session?.pairing.encrypted ? 'Active' : 'Waiting for phone'}</strong>
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

function speedLabel(bytesPerSecond?: number | null) {
  if (!bytesPerSecond) {
    return '0 B/s';
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

function theoreticalCeiling(mode: string) {
  switch (mode) {
    case 'usb':
      return 180 * 1024 * 1024;
    case 'hotspot':
      return 28 * 1024 * 1024;
    default:
      return 96 * 1024 * 1024;
  }
}

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
      label: 'Active peer',
      value: session?.peerDevice?.name ?? 'Waiting for pairing',
      note: session?.pairing.verifiedAt ? 'Phone is paired and ready.' : 'Share the PIN with the phone app.',
    },
    {
      label: 'Uploads in flight',
      value: String(activeUploads.length),
      note: activeUploads.length ? 'Chunked uploads are reporting progress live.' : 'No transfers are currently in flight.',
    },
    {
      label: 'Clipboard source',
      value: backend.clipboard?.sourceDeviceName ?? 'Desktop',
      note: backend.clipboard?.updatedAt ? `Updated ${new Date(backend.clipboard.updatedAt).toLocaleTimeString()}` : 'Clipboard sync has not run yet.',
    },
  ];

  return (
    <div className="desktop-screen">
      <GlassPanel className="desktop-hero">
        <div className="desktop-hero__copy">
          <SectionHeading
            eyebrow="Overview"
            title={session ? 'Live local transfer session' : 'Create the first local session'}
            description={
              session
                ? `Pairing is live. Share PIN ${session.pairing.pin} with the phone.`
                : 'The backend is online. Create a session to expose a real pairing flow and file queue.'
            }
          />
          <div className="desktop-chip-row">
            <Badge tone={session?.pairing.verifiedAt ? 'green' : 'amber'}>
              {session?.pairing.verifiedAt ? 'paired' : 'awaiting phone'}
            </Badge>
            <Badge tone="blue">{session?.mode ?? backend.settings?.preferredMode ?? 'wifi'}</Badge>
            <Badge>{backend.health?.sessions ?? 0} sessions total</Badge>
            <Button disabled={backend.busy === 'create-session'} onClick={() => void backend.createSession()}>
              {session ? 'Open another session' : 'Create session'}
            </Button>
          </div>
        </div>

        <div className="desktop-hero__stats">
          {[
            { label: 'State', value: session?.state ?? 'idle' },
            { label: 'Completed files', value: String(session?.summary.completedFiles ?? 0) },
            { label: 'PIN', value: session?.pairing.pin ?? 'Not created', wide: true },
          ].map((item) => (
            <div className={`desktop-stat-tile${item.wide ? ' desktop-stat-tile--wide' : ''}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </GlassPanel>

      <div className="desktop-summary-strip">
        {summaryCards.map((item) => (
          <article className="desktop-summary-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.note}</p>
          </article>
        ))}
      </div>

      <div className="desktop-two-up">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Current session"
            title={session ? 'Pairing and queue details' : 'No session yet'}
            description="The desktop reflects the current backend session, pairing state, and file queue."
          />
          <div className="desktop-empty-grid">
            <article className="desktop-summary-card">
              <span>Desktop name</span>
              <strong>{backend.settings?.deviceName ?? 'Loading'}</strong>
              <p>Applied when the desktop creates a session.</p>
            </article>
            <article className="desktop-summary-card">
              <span>Phone peer</span>
              <strong>{session?.peerDevice?.name ?? 'Not paired yet'}</strong>
              <p>{session?.peerDevice?.platform ?? 'Phone details appear after PIN verification.'}</p>
            </article>
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Clipboard sync"
            title="Text and links can move without leaving the session."
            description="This clipboard value is stored live in the backend so desktop, iPhone web, and Android can reuse it."
          />
          <label className="desktop-field">
            <span>Shared clipboard</span>
            <textarea
              className="desktop-field__textarea"
              onChange={(event) => setClipboardText(event.target.value)}
              placeholder="Paste text, links, or snippets here"
              value={clipboardText}
            />
          </label>
          <div className="desktop-actions">
            <Button
              disabled={backend.busy === 'update-clipboard'}
              onClick={() => void backend.updateClipboard(clipboardText)}
            >
              {backend.busy === 'update-clipboard' ? 'Syncing...' : 'Sync clipboard'}
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
              Copy live clipboard
            </Button>
          </div>
          <Badge tone="blue">
            {backend.clipboard?.sourceRole ? `${backend.clipboard.sourceRole} updated this clipboard` : 'No clipboard source yet'}
          </Badge>
        </GlassPanel>
      </div>

      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Transfer health"
          title={activeUploads.length ? `${activeUploads.length} uploads are active` : 'No uploads are active'}
          description="These values come from the chunked upload pipeline and update as files move through the local backend."
        />
        <div className="desktop-progress-list">
          {activeUploads.length ? (
            activeUploads.map((upload) => (
              <article className="desktop-progress-card" key={upload.id}>
                <div className="desktop-panel-header">
                  <div className="desktop-history-card__copy">
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
              <p>Transfers appear here while files are uploading in either direction.</p>
            </div>
          )}
        </div>
      </GlassPanel>

      <div className="desktop-two-up">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Recent sessions"
            title="Closed and completed sessions stay in history."
            description="This panel is now fed by the live backend history snapshot."
          />
          <div className="desktop-history-list">
            {backend.history.length ? (
              backend.history.slice(0, 3).map((entry) => (
                <article className="desktop-history-card" key={entry.id}>
                  <div className="desktop-history-card__copy">
                    <strong>{entry.peerDevice?.name ?? 'Unpaired phone session'}</strong>
                    <p>
                      {entry.summary.totalFiles} files - {formatBytes(entry.summary.totalBytes)}
                    </p>
                  </div>
                  <Badge tone="blue">{entry.state}</Badge>
                </article>
              ))
            ) : (
              <div className="desktop-empty-state">
                <p>No completed sessions have been recorded yet.</p>
              </div>
            )}
          </div>
        </GlassPanel>
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Session routing"
            title={backend.sessions.length > 1 ? 'Multiple sessions are live.' : 'Single-session focus'}
            description="The desktop can keep more than one live session open. Switch the active target from the rail to send to another device."
          />
          <div className="desktop-empty-grid">
            <article className="desktop-summary-card">
              <span>Active session</span>
              <strong>{session?.id.slice(0, 8) ?? 'None'}</strong>
              <p>{session ? `${session.localDevice.name} to ${session.peerDevice?.name ?? 'waiting peer'}` : 'Create a session to open a transfer lane.'}</p>
            </article>
            <article className="desktop-summary-card">
              <span>Open sessions</span>
              <strong>{backend.sessions.length}</strong>
              <p>Each session keeps its own PIN, queue, and peer state.</p>
            </article>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function formatSpeed(bytesPerSecond?: number | null) {
  if (!bytesPerSecond) {
    return 'Measuring speed';
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

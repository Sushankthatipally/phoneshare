import { useEffect, useState } from 'react';

import { Badge, Button, QrCode } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import { Countdown } from '../components/Countdown.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Home({ backend, openPicker }: { backend: DesktopBackendState; openPicker: () => void }) {
  const session = backend.activeSession;
  const [clipboardText, setClipboardText] = useState('');

  useEffect(() => {
    setClipboardText(backend.clipboard?.text ?? '');
  }, [backend.clipboard?.text]);

  const stateLabel = session?.pairing.verifiedAt
    ? 'Paired'
    : session?.state === 'awaiting-accept'
      ? 'Awaiting your accept'
      : session
        ? 'Waiting for phone'
        : 'No session';

  return (
    <>
      <section className="card">
        <p className="card__eyebrow">{stateLabel}</p>
        <h2 className="card__title">
          {session?.peerDevice?.name ?? (session ? 'Scan the QR with your phone' : 'Create a session to start')}
        </h2>
        <p className="card__copy">
          {session
            ? 'Your phone can scan the QR, find this desktop on the LAN, or connect via cable/hotspot.'
            : 'New sessions expose a one-time pairing ticket. Verification happens by tapping Accept on the receiving device — no PIN.'}
        </p>

        {session ? (
          <div className="qr-block">
            <QrCode size={180} value={session.pairing.ticket.qrValue} />
            <div className="qr-block__copy">
              <div className="topbar__actions">
                <Badge tone={session.pairing.encrypted ? 'green' : 'amber'}>
                  {session.pairing.encrypted ? 'Encrypted lane' : 'Lane warming'}
                </Badge>
                <Countdown
                  expiresAt={session.expiresAt}
                  onExpire={() => void backend.regenerateSession(session.id)}
                />
              </div>
              <p className="qr-block__hint">
                Session {session.id.slice(0, 8)} · mode {session.mode}
              </p>
              <div className="topbar__actions">
                <Button
                  disabled={!session.pairing.ticket.qrValue}
                  onClick={() => {
                    void navigator.clipboard?.writeText?.(session.pairing.ticket.qrValue ?? '');
                  }}
                  variant="secondary"
                >
                  Copy link
                </Button>
                <Button
                  onClick={() => void backend.regenerateSession(session.id)}
                  variant="ghost"
                >
                  Refresh QR
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="topbar__actions">
            <Button onClick={openPicker} variant="primary">
              Open connection picker
            </Button>
          </div>
        )}
      </section>

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Sessions</span>
          <strong className="stat__value">{backend.health?.sessions ?? 0}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Files</span>
          <strong className="stat__value">{backend.health?.fileCount ?? 0}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Trusted</span>
          <strong className="stat__value">{backend.trustedDevices.length}</strong>
        </div>
      </div>

      <section className="card">
        <p className="card__eyebrow">Clipboard sync</p>
        <h2 className="card__title">Share text with the phone</h2>
        <div className="field">
          <textarea
            className="textarea"
            onChange={(event) => setClipboardText(event.target.value)}
            placeholder="Paste or type text to sync with the paired phone."
            value={clipboardText}
          />
        </div>
        <div className="topbar__actions">
          <Button
            disabled={backend.busy === 'update-clipboard'}
            onClick={() => void backend.updateClipboard(clipboardText)}
            variant="primary"
          >
            {backend.busy === 'update-clipboard' ? 'Syncing' : 'Sync to phone'}
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
      </section>

      {backend.knownDevices.length ? (
        <section className="card">
          <p className="card__eyebrow">Known devices · reconnect</p>
          <h2 className="card__title">Devices you've paired with</h2>
          <div className="list">
            {backend.knownDevices.map((device) => (
              <div className="row" key={device.fingerprint}>
                <div className="row__copy">
                  <strong>{device.name}</strong>
                  <span>
                    {device.platform} · last seen {new Date(device.lastSeenAt).toLocaleString()}
                  </span>
                </div>
                <Button onClick={openPicker} variant="secondary">
                  Reconnect
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {backend.activeUploads.length ? (
        <section className="card">
          <p className="card__eyebrow">In flight</p>
          <h2 className="card__title">{backend.activeUploads.length} upload{backend.activeUploads.length === 1 ? '' : 's'}</h2>
          <div className="list">
            {backend.activeUploads.map((upload) => (
              <div className="row" key={upload.id} style={{ gridTemplateColumns: '1fr' }}>
                <div className="row__copy">
                  <strong>{upload.name}</strong>
                  <span>
                    {formatBytes(upload.uploadedBytes)} / {formatBytes(upload.size)} · {upload.progressPercent}%
                  </span>
                </div>
                <div className="bar">
                  <div className="bar__fill" style={{ width: `${upload.progressPercent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

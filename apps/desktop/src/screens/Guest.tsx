import { useRef, useState } from 'react';

import { Badge, Button, QrCode } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

const TTL_OPTIONS = [
  { label: '10 min', value: 10 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
];

const USE_OPTIONS = [
  { label: '1 use', value: 1 },
  { label: '3 uses', value: 3 },
  { label: '10 uses', value: 10 },
];

export function Guest({ backend }: { backend: DesktopBackendState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queued, setQueued] = useState<File[]>([]);
  const [ttlMs, setTtlMs] = useState(TTL_OPTIONS[1].value);
  const [maxUses, setMaxUses] = useState(USE_OPTIONS[0].value);
  const [share, setShare] = useState<{ token: string; expiresAt: string; lanUrl?: string | null } | null>(null);

  // Prefer the LAN-routable URL returned by the backend so phones on the same Wi-Fi can reach it.
  // Falls back to the desktop's own client origin (loopback) when the backend can't detect a LAN IP.
  const guestLink = share ? share.lanUrl ?? backend.guestUrl(share.token) : null;
  const totalBytes = queued.reduce((s, f) => s + f.size, 0);

  return (
    <>
      <section className="card">
        <p className="card__eyebrow">Guest share</p>
        <h2 className="card__title">Send to anyone — no app needed</h2>
        <p className="card__copy">
          Pick files, choose how long the link lasts and how many downloads it allows, and we'll publish a one-time browser
          download page. Share the QR or the link.
        </p>

        <button className="dropzone" onClick={() => inputRef.current?.click()} type="button">
          <strong>{queued.length ? `${queued.length} file${queued.length === 1 ? '' : 's'} queued` : 'Choose files'}</strong>
          <small>{queued.length ? formatBytes(totalBytes) : 'Up to 2 GB per file works comfortably'}</small>
        </button>
        <input
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) setQueued(files);
            event.target.value = '';
          }}
          ref={inputRef}
          type="file"
        />

        <div className="field">
          <span className="field__label">Expires after</span>
          <div className="topbar__actions">
            {TTL_OPTIONS.map((option) => (
              <Button
                key={option.value}
                onClick={() => setTtlMs(option.value)}
                variant={ttlMs === option.value ? 'primary' : 'secondary'}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Max uses</span>
          <div className="topbar__actions">
            {USE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                onClick={() => setMaxUses(option.value)}
                variant={maxUses === option.value ? 'primary' : 'secondary'}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="topbar__actions">
          <Button
            disabled={!queued.length || backend.busy === 'create-guest'}
            onClick={async () => {
              const result = await backend.createGuestShare({ ttlMs, maxUses }, queued);
              if (result) setShare(result);
            }}
            variant="primary"
          >
            {backend.busy === 'create-guest' ? 'Creating' : 'Create share'}
          </Button>
          {queued.length ? (
            <Button onClick={() => setQueued([])} variant="ghost">
              Clear
            </Button>
          ) : null}
        </div>
      </section>

      {share && guestLink ? (
        <section className="card">
          <p className="card__eyebrow">Share is live</p>
          <h2 className="card__title">Anyone with the link can download</h2>
          <div className="qr-block">
            <QrCode size={180} value={guestLink} />
            <div className="qr-block__copy">
              <Badge tone="green">Expires {new Date(share.expiresAt).toLocaleString()}</Badge>
              <p className="qr-block__hint" style={{ wordBreak: 'break-all' }}>
                {guestLink}
              </p>
              <div className="topbar__actions">
                <Button onClick={() => void navigator.clipboard?.writeText?.(guestLink)} variant="secondary">
                  Copy link
                </Button>
                <a className="link" href={guestLink} rel="noreferrer" target="_blank">
                  Preview page
                </a>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {backend.guestShares.length ? (
        <section className="card">
          <p className="card__eyebrow">Existing shares</p>
          <h2 className="card__title">{backend.guestShares.length} active</h2>
          <div className="list">
            {backend.guestShares.map((s) => (
              <div className="row" key={s.id}>
                <div className="row__copy">
                  <strong>{s.files} file{s.files === 1 ? '' : 's'}</strong>
                  <span>
                    {s.uses}/{s.maxUses} uses · expires {new Date(s.expiresAt).toLocaleString()}
                  </span>
                </div>
                <a className="link" href={backend.guestUrl(s.token)} rel="noreferrer" target="_blank">
                  Open
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

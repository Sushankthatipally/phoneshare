import { useEffect, useState } from 'react';

import { Laptop, QrCode, RefreshCw, Smartphone } from 'lucide-react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import type { PhoneBackendState } from '../services/usePhoneBackend.js';

export function ConnectScreen({ backend }: { backend: PhoneBackendState }) {
  const [pin, setPin] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [pairView, setPairView] = useState<'qr' | 'devices'>('devices');

  useEffect(() => {
    if (backend.activeSession?.pairing.pin && !backend.activeSession.pairing.verifiedAt) {
      setPin(backend.activeSession.pairing.pin);
    }
  }, [backend.activeSession?.pairing.pin, backend.activeSession?.pairing.verifiedAt]);

  useEffect(() => {
    setClipboardText(backend.clipboard?.text ?? '');
  }, [backend.clipboard?.text]);

  return (
    <section className="phone-screen">
      <GlassPanel className="phone-panel phone-panel--spotlight">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Pair a device</p>
            <h2>Choose how to discover the desktop</h2>
            <p className="phone-panel__copy">Use the desktop QR flow or pick a live session from nearby devices.</p>
          </div>
          <Badge tone="blue">{backend.sessions.length} sessions</Badge>
        </div>

        <div className="phone-device-toggle">
          <button
            className={`phone-device-toggle__button${
              pairView === 'qr' ? ' phone-device-toggle__button--active' : ''
            }`}
            onClick={() => setPairView('qr')}
            type="button"
          >
            QR Code
          </button>
          <button
            className={`phone-device-toggle__button${
              pairView === 'devices' ? ' phone-device-toggle__button--active' : ''
            }`}
            onClick={() => setPairView('devices')}
            type="button"
          >
            mDNS Devices
          </button>
        </div>

        {pairView === 'devices' ? (
          <>
            <div className="phone-device-discovery">
              <p>Discovery only works on the same local network.</p>
              <button className="phone-refresh-button" onClick={() => void backend.refresh()} type="button">
                <RefreshCw size={16} strokeWidth={2} />
                Refresh
              </button>
            </div>

            <div className="phone-device-list">
              {backend.sessions.length ? (
                backend.sessions.map((session) => {
                  const DeviceIcon = iconForDevice(session.localDevice.icon);
                  const bars = signalBars(session.mode);

                  return (
                    <button
                      className={`phone-device-card${
                        backend.activeSession?.id === session.id ? ' phone-device-card--active' : ''
                      }`}
                      key={session.id}
                      onClick={() => backend.setSelectedSessionId(session.id)}
                      type="button"
                    >
                      <div className="phone-device-card__icon">
                        <DeviceIcon size={28} strokeWidth={1.9} />
                      </div>

                      <div className="phone-device-card__copy">
                        <strong>{session.localDevice.name}</strong>
                        <div className="phone-device-card__meta">
                          <span>{modeLabel(session.mode)}</span>
                          {session.pairing.verifiedAt ? <small>Verified</small> : <small>PIN {session.pairing.pin}</small>}
                        </div>
                      </div>

                      <div aria-hidden="true" className="phone-device-bars">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <span
                            className={index < bars ? 'phone-device-bars__bar phone-device-bars__bar--active' : 'phone-device-bars__bar'}
                            key={index}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="phone-empty-state">
                  <p>No desktop session is available yet. Create one from the desktop app first.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="phone-qr-placeholder">
            <div className="phone-qr-placeholder__box">
              <QrCode size={54} strokeWidth={1.7} />
            </div>
            <div className="phone-qr-placeholder__copy">
              <strong>Use the QR generated on desktop</strong>
              <p>
                The desktop app owns the live pairing QR. Open the desktop pairing panel and scan it, or use the PIN section below.
              </p>
            </div>
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">PIN</p>
            <h3>Verify this phone</h3>
            <p>Enter the PIN shown by the desktop session to complete pairing.</p>
          </div>
          <Badge tone={backend.activeSession?.pairing.verifiedAt ? 'green' : 'amber'}>
            {backend.activeSession?.pairing.verifiedAt ? 'verified' : 'pending'}
          </Badge>
        </div>

        <form
          className="phone-form"
          onSubmit={(event) => {
            event.preventDefault();
            void backend.pairSession(pin);
          }}
        >
          <label className="phone-field">
            <span>Session PIN</span>
            <input
              className="phone-code-input"
              onChange={(event) => setPin(event.target.value)}
              value={pin}
            />
          </label>

          <div className="phone-button-grid">
            <Button
              className="phone-action-button"
              disabled={!backend.activeSession || backend.busy === 'pair-session'}
              type="submit"
            >
              {backend.busy === 'pair-session' ? 'Pairing' : 'Pair this phone'}
            </Button>
            <Button className="phone-action-button" onClick={() => void backend.refresh()} variant="secondary">
              Refresh
            </Button>
          </div>
        </form>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Clipboard</p>
            <h3>Share text without sending a file</h3>
            <p>Clipboard values persist in the backend and remain available on the desktop.</p>
          </div>
          <Badge tone="blue">{backend.clipboard?.sourceDeviceName ?? 'desktop'}</Badge>
        </div>

        <label className="phone-field">
          <span>Clipboard text</span>
          <textarea
            className="phone-field__textarea"
            onChange={(event) => setClipboardText(event.target.value)}
            placeholder="Paste a link, note, or code snippet to sync."
            rows={4}
            value={clipboardText}
          />
        </label>

        <div className="phone-button-grid">
          <Button
            className="phone-action-button"
            disabled={backend.busy === 'update-clipboard'}
            onClick={() => void backend.updateClipboard(clipboardText)}
          >
            {backend.busy === 'update-clipboard' ? 'Syncing' : 'Sync clipboard'}
          </Button>
          <Button
            className="phone-action-button"
            onClick={() => {
              void navigator.clipboard?.writeText?.(backend.clipboard?.text ?? '');
            }}
            variant="secondary"
          >
            Copy live text
          </Button>
        </div>
      </GlassPanel>

      <div className="phone-security-callout">
        <p className="phone-panel__eyebrow">Security</p>
        <p>Pairing, file queues, and clipboard updates are driven by the live local backend, not a front-end mock layer.</p>
      </div>
    </section>
  );
}

function iconForDevice(icon?: string | null) {
  switch (icon) {
    case 'phone':
    case 'tablet':
      return Smartphone;
    case 'laptop':
      return Laptop;
    default:
      return Laptop;
  }
}

function modeLabel(mode?: string | null) {
  switch (mode) {
    case 'usb':
      return 'USB';
    case 'hotspot':
      return 'HOTSPOT';
    default:
      return 'WIFI';
  }
}

function signalBars(mode?: string | null) {
  switch (mode) {
    case 'usb':
      return 4;
    case 'hotspot':
      return 2;
    default:
      return 3;
  }
}

import { useEffect, useState } from 'react';

import { Cable, RefreshCw, Smartphone, Users, Wifi } from 'lucide-react';

import { Badge, Button, QrCode } from '@dropbeam/shared-ui';

import { Modal } from './Modal.js';
import { Countdown } from './Countdown.js';
import type { ConnectionChoice } from './ConnectionPicker.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

interface Props {
  backend: DesktopBackendState;
  choice: ConnectionChoice;
  onClose: () => void;
}

export function ConnectionScreen({ backend, choice, onClose }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hotspot, setHotspot] = useState<{ ssid: string; password: string } | null>(null);
  const [usbProbeAttempts, setUsbProbeAttempts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await backend.createSession({
        mode: choice === 'usb' ? 'usb' : choice === 'hotspot' ? 'hotspot' : 'wifi',
        multiDevice: choice === 'multi',
        maxDevices: choice === 'multi' ? 4 : 1,
      });
      if (!cancelled && session) setSessionId(session.id);
      if (!cancelled && choice === 'hotspot') {
        setHotspot({
          ssid: `DropBeam-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          password: Math.random().toString(36).slice(2, 14),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  const session = backend.sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (choice !== 'usb') return;
    const handle = setInterval(() => setUsbProbeAttempts((n) => n + 1), 2000);
    return () => clearInterval(handle);
  }, [choice]);

  return (
    <Modal onClose={onClose} size="lg">
      <div className="modal__header">
        <span className="modal__step">
          {choice === 'wifi' ? 'Same WiFi' : choice === 'usb' ? 'USB Cable' : choice === 'hotspot' ? 'Hotspot' : 'Multi-device'}
        </span>
        <h2 className="modal__title">
          {choice === 'wifi' && 'Scan this QR with your phone'}
          {choice === 'usb' && 'Plug your phone into this computer'}
          {choice === 'hotspot' && 'Have your phone join this hotspot'}
          {choice === 'multi' && 'Each phone scans this QR to join'}
        </h2>
      </div>

      {choice === 'wifi' && (
        <div className="connection">
          {session ? (
            <>
              <QrCode size={216} value={session.pairing.ticket.qrValue} />
              <div className="topbar__actions">
                <Countdown
                  expiresAt={session.expiresAt}
                  onExpire={() => sessionId && void backend.regenerateSession(sessionId)}
                />
                <Badge>Connected to: {hostNetworkLabel()}</Badge>
              </div>
              <div className="topbar__actions">
                <Button
                  onClick={() => session && void backend.regenerateSession(session.id)}
                  variant="secondary"
                >
                  <RefreshCw size={14} /> New QR
                </Button>
                <Button
                  onClick={() => {
                    void navigator.clipboard?.writeText?.(session.pairing.ticket.qrValue ?? '');
                  }}
                  variant="ghost"
                >
                  Copy link
                </Button>
              </div>
              <span className="connection__pulse">Waiting for phone to scan…</span>
            </>
          ) : (
            <span className="connection__pulse">Creating session…</span>
          )}
        </div>
      )}

      {choice === 'usb' && (
        <div className="connection">
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">
            Plug your phone in with a cable that supports data transfer (not charge-only).
          </p>
          <span className="connection__pulse">
            Polling for USB devices… attempt {usbProbeAttempts + 1}
          </span>
          {usbProbeAttempts >= 5 ? (
            <Badge tone="amber">
              No device found. Native USB detection (ADB / usbmuxd) needs to be wired in. Switch to WiFi to continue.
            </Badge>
          ) : null}
          <div className="topbar__actions">
            <Button onClick={onClose} variant="ghost">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {choice === 'hotspot' && (
        <div className="connection">
          {session ? (
            <>
              <QrCode size={196} value={JSON.stringify({ kind: 'hotspot', ssid: hotspot?.ssid, password: hotspot?.password, pair: session.pairing.ticket.qrValue })} />
              <div className="connection__credentials">
                <div className="credential">
                  <span>SSID</span>
                  <strong>{hotspot?.ssid ?? '—'}</strong>
                </div>
                <div className="credential">
                  <span>Password</span>
                  <strong>{hotspot?.password ?? '—'}</strong>
                </div>
              </div>
              <Badge tone="amber">
                Real hotspot creation needs Android's WifiManager (native). This screen shows the credentials your phone would use.
              </Badge>
              <span className="connection__pulse">Waiting for phone to join…</span>
            </>
          ) : (
            <span className="connection__pulse">Creating session…</span>
          )}
        </div>
      )}

      {choice === 'multi' && (
        <div className="connection">
          {session ? (
            <>
              <QrCode size={216} value={session.pairing.ticket.qrValue} />
              <div className="topbar__actions">
                <Badge>
                  <Users size={12} style={{ marginRight: 4 }} /> Up to {session.maxDevices ?? 4} devices
                </Badge>
                <Countdown expiresAt={session.expiresAt} />
              </div>
              <p className="card__copy">
                Every phone that scans this code joins the same session. Each will appear in the Accept queue.
              </p>
              <span className="connection__pulse">Waiting for phones to scan…</span>
            </>
          ) : (
            <span className="connection__pulse">Creating session…</span>
          )}
        </div>
      )}

      <div className="modal__actions">
        <Button onClick={onClose} variant="ghost">
          Done
        </Button>
      </div>
    </Modal>
  );
}

function hostNetworkLabel() {
  if (typeof window === 'undefined') return 'local network';
  return window.location.hostname || 'local network';
}

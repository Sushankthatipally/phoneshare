import { useState } from 'react';

import { Cable, Smartphone, Users, Wifi } from 'lucide-react';

import { Button } from '@dropbeam/shared-ui';

import { Modal } from './Modal.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export type ConnectionChoice = 'wifi' | 'usb' | 'hotspot' | 'multi';

export interface ReconnectIntent {
  sessionId: string;
  fingerprint: string;
  deviceName: string;
}

const OPTIONS: Array<{
  id: ConnectionChoice;
  label: string;
  copy: string;
  icon: typeof Wifi;
}> = [
  { id: 'wifi', label: 'Same WiFi', copy: 'Generate a QR code. Your phone scans it to connect over the local network.', icon: Wifi },
  { id: 'usb', label: 'USB Cable', copy: 'Plug your phone in. Auto-detects Android via ADB and iPhone via the Trust dialog.', icon: Cable },
  { id: 'hotspot', label: 'Hotspot', copy: 'Create a private DropBeam hotspot. No shared WiFi or internet needed.', icon: Smartphone },
  { id: 'multi', label: 'Multi-device', copy: 'One QR that multiple phones can scan into the same session.', icon: Users },
];

export function ConnectionPicker({
  backend,
  onClose,
  onChoose,
  onReconnect,
}: {
  backend: DesktopBackendState;
  onClose: () => void;
  onChoose: (choice: ConnectionChoice) => void;
  onReconnect: (intent: ReconnectIntent) => void;
}) {
  const [busyFingerprint, setBusyFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal onClose={onClose}>
      <div className="modal__header">
        <span className="modal__step">New session</span>
        <h2 className="modal__title">How do you want to connect?</h2>
      </div>

      <div className="tile-grid">
        {OPTIONS.map(({ id, label, copy, icon: Icon }) => (
          <button key={id} className="tile" onClick={() => onChoose(id)} type="button">
            <span className="tile__icon">
              <Icon size={18} strokeWidth={2} />
            </span>
            <strong>{label}</strong>
            <span>{copy}</span>
          </button>
        ))}
      </div>

      <div className="modal__actions">
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
      </div>

      {backend.knownDevices.length ? (
        <>
          <p className="card__eyebrow">Known devices · reconnect</p>
          <div className="list">
            {backend.knownDevices.slice(0, 4).map((device) => (
              <div key={device.fingerprint} className="row">
                <div className="row__copy">
                  <strong>{device.name}</strong>
                  <span>
                    Last seen {new Date(device.lastSeenAt).toLocaleString()} · {device.platform}
                  </span>
                </div>
                <Button
                  disabled={busyFingerprint === device.fingerprint}
                  onClick={async () => {
                    setBusyFingerprint(device.fingerprint);
                    setError(null);
                    const session = await backend.reconnectKnownDevice(device.fingerprint);
                    setBusyFingerprint(null);
                    if (!session) {
                      setError(`Could not reach ${device.name}`);
                      return;
                    }
                    onReconnect({
                      sessionId: session.id,
                      fingerprint: device.fingerprint,
                      deviceName: device.name,
                    });
                  }}
                  variant="secondary"
                >
                  {busyFingerprint === device.fingerprint ? 'Connecting…' : 'Reconnect'}
                </Button>
              </div>
            ))}
          </div>
          {error ? <p className="card__copy" style={{ color: 'var(--db-amber)' }}>{error}</p> : null}
        </>
      ) : null}
    </Modal>
  );
}

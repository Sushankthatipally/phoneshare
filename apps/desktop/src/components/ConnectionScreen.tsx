import { useCallback, useEffect, useState } from 'react';

import { Cable, RefreshCw, Users } from 'lucide-react';

import { Badge, Button, QrCode } from '@dropbeam/shared-ui';

import { Modal } from './Modal.js';
import { Countdown } from './Countdown.js';
import type { ConnectionChoice } from './ConnectionPicker.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';
import {
  isTauri,
  usbAndroidEnsureTunnel,
  usbAndroidStatus,
  type AndroidUsbStatus,
} from '../lib/tauri.js';

interface Props {
  backend: DesktopBackendState;
  choice: ConnectionChoice;
  onClose: () => void;
}

type UsbPlatform = 'android' | 'ios';

export function ConnectionScreen({ backend, choice, onClose }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hotspot, setHotspot] = useState<{ ssid: string; password: string } | null>(null);
  const [usbPlatform, setUsbPlatform] = useState<UsbPlatform>('android');
  const [androidStatus, setAndroidStatus] = useState<AndroidUsbStatus | null>(null);
  const [tunnelError, setTunnelError] = useState<string | null>(null);

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

  return (
    <Modal onClose={onClose} size="lg">
      <div className="modal__header">
        <span className="modal__step">
          {choice === 'wifi'
            ? 'Same WiFi'
            : choice === 'usb'
              ? 'USB Cable'
              : choice === 'hotspot'
                ? 'Hotspot'
                : 'Multi-device'}
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
        <UsbTab
          platform={usbPlatform}
          onPlatformChange={setUsbPlatform}
          androidStatus={androidStatus}
          setAndroidStatus={setAndroidStatus}
          tunnelError={tunnelError}
          setTunnelError={setTunnelError}
          onCancel={onClose}
        />
      )}

      {choice === 'hotspot' && (
        <div className="connection">
          {session ? (
            <>
              <QrCode
                size={196}
                value={JSON.stringify({
                  kind: 'hotspot',
                  ssid: hotspot?.ssid,
                  password: hotspot?.password,
                  pair: session.pairing.ticket.qrValue,
                })}
              />
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

interface UsbTabProps {
  platform: UsbPlatform;
  onPlatformChange: (platform: UsbPlatform) => void;
  androidStatus: AndroidUsbStatus | null;
  setAndroidStatus: (status: AndroidUsbStatus) => void;
  tunnelError: string | null;
  setTunnelError: (error: string | null) => void;
  onCancel: () => void;
}

function UsbTab({
  platform,
  onPlatformChange,
  androidStatus,
  setAndroidStatus,
  tunnelError,
  setTunnelError,
  onCancel,
}: UsbTabProps) {
  const tauriAvailable = isTauri();
  const tunnelEstablished =
    androidStatus?.state === 'ready' && tunnelError === null && platform === 'android';

  const poll = useCallback(async () => {
    if (platform !== 'android') return;
    const status = await usbAndroidStatus();
    setAndroidStatus(status);
    if (status.state === 'ready') {
      const tunnel = await usbAndroidEnsureTunnel();
      if (!tunnel.ok) setTunnelError(tunnel.error ?? 'Failed to establish adb reverse tunnel');
      else setTunnelError(null);
    }
  }, [platform, setAndroidStatus, setTunnelError]);

  useEffect(() => {
    if (platform !== 'android') return;
    let cancelled = false;
    void poll();
    const handle = setInterval(() => {
      if (!cancelled) void poll();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [platform, poll]);

  return (
    <div className="connection">
      <div className="usb-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'android'}
          className={`tab${platform === 'android' ? ' tab--active' : ''}`}
          onClick={() => onPlatformChange('android')}
        >
          Android
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'ios'}
          className={`tab${platform === 'ios' ? ' tab--active' : ''}`}
          onClick={() => onPlatformChange('ios')}
        >
          iOS
        </button>
      </div>

      {platform === 'android' ? (
        <AndroidUsbView status={androidStatus} tunnelError={tunnelError} tauriAvailable={tauriAvailable} tunnelOk={tunnelEstablished} />
      ) : (
        <IosUsbView />
      )}

      <div className="topbar__actions">
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface AndroidUsbViewProps {
  status: AndroidUsbStatus | null;
  tunnelError: string | null;
  tauriAvailable: boolean;
  tunnelOk: boolean;
}

function AndroidUsbView({ status, tunnelError, tauriAvailable, tunnelOk }: AndroidUsbViewProps) {
  if (!tauriAvailable) {
    return (
      <>
        <Cable size={48} strokeWidth={1.6} />
        <p className="card__copy">USB transport requires the desktop app. Open DropBeam Desktop to use a cable.</p>
      </>
    );
  }

  if (!status) {
    return <span className="connection__pulse">Initialising adb…</span>;
  }

  switch (status.state) {
    case 'absent':
      return (
        <>
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">Connect your Android phone with a data-transfer USB cable.</p>
          {status.error ? <span className="connection__pulse">{status.error}</span> : <span className="connection__pulse">Polling for device…</span>}
        </>
      );
    case 'detected':
      return (
        <>
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">{status.deviceLabel ? `${status.deviceLabel} detected.` : 'Device detected.'} Waiting for authorization…</p>
          <span className="connection__pulse">Approve the USB debugging prompt on the phone.</span>
        </>
      );
    case 'authorizing':
      return (
        <>
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">Authorize this computer on your phone.</p>
          {status.deviceLabel ? <span className="connection__pulse">{status.deviceLabel}</span> : null}
        </>
      );
    case 'ready':
      return (
        <>
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">
            <strong>{status.deviceLabel ?? 'Android device'}</strong> ready. Tunnel on tcp:17619 active.
          </p>
          {tunnelError ? (
            <span className="connection__pulse">{tunnelError}</span>
          ) : tunnelOk ? (
            <span className="connection__pulse">Open DropBeam on the phone to enter the PIN.</span>
          ) : (
            <span className="connection__pulse">Establishing adb reverse tunnel…</span>
          )}
        </>
      );
    case 'error':
    default:
      return (
        <>
          <Cable size={48} strokeWidth={1.6} />
          <p className="card__copy">{status.error ?? 'Unknown adb error'}</p>
        </>
      );
  }
}

function IosUsbView() {
  return (
    <>
      <Cable size={48} strokeWidth={1.6} />
      <p className="card__copy">
        Connect over Wi-Fi instead — iOS USB transfer is not supported in this build.
      </p>
    </>
  );
}

function hostNetworkLabel() {
  if (typeof window === 'undefined') return 'local network';
  return window.location.hostname || 'local network';
}

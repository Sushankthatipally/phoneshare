import { useEffect, useRef, useState } from 'react';

import { Cable, Check, Loader2, RefreshCw, Users, X } from 'lucide-react';

import { Badge, Button, QrCode } from '@dropbeam/shared-ui';
import type { LiveSessionRecord, MultiDeviceSlot } from '@dropbeam/protocol';

import { Modal } from './Modal.js';
import { Countdown } from './Countdown.js';
import type { ConnectionChoice } from './ConnectionPicker.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

interface Props {
  backend: DesktopBackendState;
  choice: ConnectionChoice;
  existingSessionId?: string | null;
  reconnectLabel?: string | null;
  onClose: () => void;
}

export function ConnectionScreen({ backend, choice, existingSessionId, reconnectLabel, onClose }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(existingSessionId ?? null);
  const [usbProbeAttempts, setUsbProbeAttempts] = useState(0);
  const createdRef = useRef(existingSessionId != null);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    let cancelled = false;
    (async () => {
      const session = await backend.createSession({
        mode: choice === 'usb' ? 'usb' : choice === 'hotspot' ? 'hotspot' : 'wifi',
        multiDevice: choice === 'multi',
      });
      if (!cancelled && session) setSessionId(session.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, choice]);

  const session = backend.sessions.find((s) => s.id === sessionId) ?? null;

  useEffect(() => {
    if (choice !== 'usb') return;
    const handle = setInterval(() => setUsbProbeAttempts((n) => n + 1), 2000);
    return () => clearInterval(handle);
  }, [choice]);

  const closeAndReset = async () => {
    if (sessionId) await backend.closeSession();
    onClose();
  };

  return (
    <Modal onClose={onClose} size="lg">
      <div className="modal__header">
        <span className="modal__step">
          {choice === 'wifi' ? 'Same WiFi' : choice === 'usb' ? 'USB Cable' : choice === 'hotspot' ? 'Hotspot' : 'Multi-device'}
        </span>
        <h2 className="modal__title">{renderTitle(choice, session)}</h2>
      </div>

      {choice === 'wifi' && existingSessionId ? (
        <ReconnectWaiting session={session} label={reconnectLabel ?? null} onCancel={closeAndReset} />
      ) : null}

      {choice === 'wifi' && !existingSessionId && (
        <WifiContent
          session={session}
          onRegenerate={(id) => void backend.regenerateSession(id)}
          onCopy={(value) => void navigator.clipboard?.writeText?.(value)}
          onCloseAndReset={closeAndReset}
        />
      )}

      {choice === 'usb' && (
        <UsbContent
          session={session}
          attempts={usbProbeAttempts}
          onCancel={onClose}
        />
      )}

      {choice === 'hotspot' && (
        <HotspotContent
          session={session}
          onRegenerate={(id) => void backend.regenerateSession(id)}
        />
      )}

      {choice === 'multi' && (
        <MultiContent
          session={session}
          onRegenerate={(id) => void backend.regenerateSession(id)}
        />
      )}

      <div className="modal__actions">
        <Button onClick={onClose} variant="ghost">
          Done
        </Button>
      </div>
    </Modal>
  );
}

function renderTitle(choice: ConnectionChoice, session: LiveSessionRecord | null) {
  if (session?.lockedAt) return 'Session locked';
  if (session?.state === 'paired' || session?.pairing.verifiedAt) return 'Connected';
  if (session?.state === 'pin-required') return 'Enter on your phone';
  if (choice === 'wifi') return 'Scan this QR with your phone';
  if (choice === 'usb') return 'Plug your phone into this computer';
  if (choice === 'hotspot') return 'Have your phone join this hotspot';
  return 'Each phone scans this QR to join';
}

function ReconnectWaiting({
  session,
  label,
  onCancel,
}: {
  session: LiveSessionRecord | null;
  label: string | null;
  onCancel: () => void;
}) {
  if (!session) return <div className="connection"><span className="connection__pulse">Connecting…</span></div>;
  if (session.lockedAt) return <LockedView session={session} onReset={onCancel} />;
  if (session.state === 'paired' || session.pairing.verifiedAt) return <PairedView session={session} />;
  if (session.state === 'pin-required' && session.pairing.pin) {
    return <PinDisplay session={session} onCloseAndReset={onCancel} />;
  }
  return (
    <div className="connection">
      <p className="card__copy">{label ? `Waiting for ${label} to accept` : 'Waiting for device to accept'}</p>
      <span className="connection__pulse">Connecting…</span>
      <Button onClick={onCancel} variant="ghost">Cancel</Button>
    </div>
  );
}

function WifiContent({
  session,
  onRegenerate,
  onCopy,
  onCloseAndReset,
}: {
  session: LiveSessionRecord | null;
  onRegenerate: (sessionId: string) => void;
  onCopy: (value: string) => void;
  onCloseAndReset: () => void;
}) {
  if (!session) return <div className="connection"><span className="connection__pulse">Creating session…</span></div>;

  if (session.lockedAt) {
    return <LockedView session={session} onReset={onCloseAndReset} />;
  }

  if (session.state === 'paired' || session.pairing.verifiedAt) {
    return <PairedView session={session} />;
  }

  if (session.state === 'pin-required' && session.pairing.pin) {
    return <PinDisplay session={session} onCloseAndReset={onCloseAndReset} />;
  }

  return (
    <div className="connection">
      <QrCode size={216} value={session.pairing.ticket.qrValue} />
      <div className="topbar__actions">
        <Countdown
          expiresAt={session.expiresAt}
          onExpire={() => onRegenerate(session.id)}
        />
      </div>
      <div className="topbar__actions">
        <Button onClick={() => onRegenerate(session.id)} variant="secondary">
          <RefreshCw size={14} /> New QR
        </Button>
        <Button
          onClick={() => onCopy(session.pairing.ticket.qrValue ?? '')}
          variant="ghost"
        >
          Copy link
        </Button>
      </div>
      <span className="connection__pulse">Waiting for phone to scan</span>
    </div>
  );
}

function PinDisplay({ session, onCloseAndReset }: { session: LiveSessionRecord; onCloseAndReset: () => void }) {
  const pin = session.pairing.pin ?? '';
  const remaining = session.pairing.pinAttemptsRemaining;

  return (
    <div className="connection">
      <p className="card__copy">Enter on your phone</p>
      <div className="pin-display">
        {pin.split('').map((digit, index) => (
          <span className="pin-display__digit" key={index}>
            {digit}
          </span>
        ))}
      </div>
      {typeof remaining === 'number' && remaining < 3 ? (
        <Badge tone="amber">{remaining} attempt{remaining === 1 ? '' : 's'} remaining</Badge>
      ) : null}
      <span className="connection__pulse">Waiting for phone to confirm</span>
      <Button onClick={onCloseAndReset} variant="ghost">
        Cancel
      </Button>
    </div>
  );
}

function LockedView({ session, onReset }: { session: LiveSessionRecord; onReset: () => void }) {
  const reason = session.lockedReason ?? 'Too many wrong PIN attempts';
  return (
    <div className="connection">
      <div className="pin-display pin-display--locked">
        <X size={32} strokeWidth={2.2} />
      </div>
      <p className="card__copy">{reason}</p>
      <Button onClick={onReset} variant="primary">
        Start over
      </Button>
    </div>
  );
}

function PairedView({ session }: { session: LiveSessionRecord }) {
  const peerName = session.peerDevice?.name ?? session.connectedDevices?.[0]?.name ?? null;
  return (
    <div className="connection">
      <div className="pin-display pin-display--ok">
        <Check size={32} strokeWidth={2.2} />
      </div>
      <p className="card__copy">{peerName ? `Connected to ${peerName}` : 'Connected'}</p>
      <Badge tone="green">Encrypted</Badge>
    </div>
  );
}

function UsbContent({
  session,
  attempts,
  onCancel,
}: {
  session: LiveSessionRecord | null;
  attempts: number;
  onCancel: () => void;
}) {
  if (session?.state === 'pin-required' && session.pairing.pin) {
    return <PinDisplay session={session} onCloseAndReset={onCancel} />;
  }
  if (session?.state === 'paired' || session?.pairing.verifiedAt) {
    return <PairedView session={session} />;
  }

  return (
    <div className="connection">
      <Cable size={48} strokeWidth={1.6} />
      <p className="card__copy">
        Use a cable that supports data transfer (not charge-only).
      </p>
      <span className="connection__pulse">
        Polling for USB devices — attempt {attempts + 1}
      </span>
      <div className="topbar__actions">
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function HotspotContent({
  session,
  onRegenerate,
}: {
  session: LiveSessionRecord | null;
  onRegenerate: (sessionId: string) => void;
}) {
  if (!session) return <div className="connection"><span className="connection__pulse">Creating session…</span></div>;
  if (session.state === 'pin-required' && session.pairing.pin) {
    return <PinDisplay session={session} onCloseAndReset={() => {}} />;
  }
  if (session.state === 'paired' || session.pairing.verifiedAt) {
    return <PairedView session={session} />;
  }
  return (
    <div className="connection">
      <QrCode size={196} value={session.pairing.ticket.qrValue} />
      <Countdown expiresAt={session.expiresAt} onExpire={() => onRegenerate(session.id)} />
      <span className="connection__pulse">Waiting for phone to join</span>
    </div>
  );
}

function MultiContent({
  session,
  onRegenerate,
}: {
  session: LiveSessionRecord | null;
  onRegenerate: (sessionId: string) => void;
}) {
  if (!session) {
    return <div className="connection"><span className="connection__pulse">Creating session…</span></div>;
  }

  const slots = resolveSlots(session);
  const openSlotCount = slots.filter((s) => s.status === 'open').length;
  const showQrHint = openSlotCount > 0;

  return (
    <div className="connection">
      <QrCode size={216} value={session.pairing.ticket.qrValue} />
      <div className="topbar__actions">
        <Badge>
          <Users size={12} style={{ marginRight: 4 }} /> {session.maxDevices ?? slots.length} devices max
        </Badge>
        <Countdown expiresAt={session.expiresAt} onExpire={() => onRegenerate(session.id)} />
      </div>
      {showQrHint ? (
        <p className="card__copy">Single QR, multiple devices — every phone that scans joins the same session.</p>
      ) : null}
      <ul className="slot-list">
        {slots.map((slot) => (
          <SlotRow key={slot.index} slot={slot} />
        ))}
      </ul>
    </div>
  );
}

function SlotRow({ slot }: { slot: MultiDeviceSlot }) {
  return (
    <li className={`slot slot--${slot.status}`}>
      <span className="slot__index">Device {slot.index + 1}</span>
      <span className="slot__status">{renderSlotStatus(slot)}</span>
    </li>
  );
}

function renderSlotStatus(slot: MultiDeviceSlot) {
  if (slot.status === 'open') return <span className="slot__placeholder">Open</span>;
  if (slot.status === 'pending') {
    return (
      <span className="slot__pending">
        <Loader2 size={14} className="slot__spinner" strokeWidth={2.2} />
        {slot.device?.name ?? 'Joining'}
      </span>
    );
  }
  if (slot.status === 'connected') {
    return (
      <span className="slot__connected">
        <Check size={14} strokeWidth={2.4} />
        {slot.device?.name ?? 'Connected'}
      </span>
    );
  }
  return (
    <span className="slot__denied">
      <X size={14} strokeWidth={2.4} />
      <s>{slot.device?.name ?? 'Denied'}</s>
    </span>
  );
}

function resolveSlots(session: LiveSessionRecord): MultiDeviceSlot[] {
  if (session.slots && session.slots.length) return session.slots;
  const max = session.maxDevices ?? 0;
  if (max <= 0) return [];
  const placeholders: MultiDeviceSlot[] = [];
  for (let i = 0; i < max; i += 1) {
    placeholders.push({ index: i, status: 'open' });
  }
  return placeholders;
}

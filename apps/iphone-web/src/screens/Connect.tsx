import { useEffect, useState } from 'react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import type { PhoneBackendState } from '../services/usePhoneBackend.js';

export function ConnectScreen({ backend }: { backend: PhoneBackendState }) {
  const [pin, setPin] = useState('');
  const [clipboardText, setClipboardText] = useState('');

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
        <p className="phone-panel__eyebrow">Connect</p>
        <h2>Choose a live desktop session</h2>
        <p className="phone-panel__copy">
          Sessions below come from the live local backend. Pair with the PIN shown in the desktop app.
        </p>
        <div className="phone-chip-row">
          <Badge tone={backend.activeSession?.pairing.verifiedAt ? 'green' : 'amber'}>
            {backend.activeSession?.pairing.verifiedAt ? 'paired' : 'pin required'}
          </Badge>
          <Badge tone="blue">{backend.sessions.length} sessions</Badge>
          <Button onClick={() => void backend.refresh()} variant="secondary">
            Refresh
          </Button>
        </div>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Sessions</p>
            <h3>Available desktop sessions</h3>
            <p>Select the session you want to pair with on this phone.</p>
          </div>
        </div>

        <div className="phone-session-list">
          {backend.sessions.length ? (
            backend.sessions.map((session) => (
              <button
                className={`phone-session-card${
                  backend.activeSession?.id === session.id ? ' phone-session-card--active' : ''
                }`}
                key={session.id}
                onClick={() => backend.setSelectedSessionId(session.id)}
                type="button"
              >
                <span>{labelForIcon(session.localDevice.icon)} {session.localDevice.name}</span>
                <strong>{session.id.slice(0, 8)}</strong>
                <p>{session.pairing.verifiedAt ? 'Paired and ready' : `PIN ${session.pairing.pin}`}</p>
              </button>
            ))
          ) : (
            <div className="phone-empty-state">
              <p>No desktop session is available yet. Create one from the desktop app first.</p>
            </div>
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">PIN pairing</p>
            <h3>Verify this phone</h3>
            <p>Use the session PIN from the desktop app to complete pairing.</p>
          </div>
          <Badge tone="green">{backend.activeSession?.localDevice.name ?? 'waiting'}</Badge>
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
            <input onChange={(event) => setPin(event.target.value)} value={pin} />
          </label>

          <div className="phone-button-grid">
            <Button
              className="phone-action-button"
              disabled={!backend.activeSession || backend.busy === 'pair-session'}
              type="submit"
            >
              {backend.busy === 'pair-session' ? 'Pairing...' : 'Pair this phone'}
            </Button>
            <Button className="phone-action-button" onClick={() => void backend.refresh()} variant="secondary">
              Refresh session
            </Button>
          </div>
        </form>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Shared clipboard</p>
            <h3>Move text without packaging a file</h3>
            <p>Links, notes, and snippets sync through the live backend and stay available across devices.</p>
          </div>
          <Badge tone="blue">{backend.clipboard?.sourceDeviceName ?? 'desktop'}</Badge>
        </div>

        <label className="phone-field">
          <span>Clipboard text</span>
          <textarea
            className="phone-field__textarea"
            onChange={(event) => setClipboardText(event.target.value)}
            placeholder="Paste a link, code snippet, or note to share with desktop."
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
            {backend.busy === 'update-clipboard' ? 'Syncing...' : 'Sync clipboard'}
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
    </section>
  );
}

function labelForIcon(icon?: string | null) {
  switch (icon) {
    case 'phone':
      return 'Phone';
    case 'tablet':
      return 'Tablet';
    case 'laptop':
      return 'Laptop';
    default:
      return 'Desktop';
  }
}

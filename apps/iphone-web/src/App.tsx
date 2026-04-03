import { startTransition, useMemo, useState } from 'react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import { ConnectScreen } from './screens/Connect.js';
import { ReceiveScreen } from './screens/Receive.js';
import { SendScreen } from './screens/Send.js';
import { useInstallPrompt } from './services/useInstallPrompt.js';
import { usePhoneBackend } from './services/usePhoneBackend.js';

type PhoneScreen = 'connect' | 'receive' | 'send';

const screenMap: Record<PhoneScreen, { title: string; note: string }> = {
  connect: { title: 'Connect', note: 'pair + trust' },
  receive: { title: 'Receive', note: 'desktop files' },
  send: { title: 'Send', note: 'phone files' },
};

export default function App() {
  const [screen, setScreen] = useState<PhoneScreen>('connect');
  const backend = usePhoneBackend();
  const activeSession = backend.activeSession;
  const installPrompt = useInstallPrompt();

  const description = useMemo(() => {
    if (backend.loading) {
      return 'Loading live sessions from the local DropBeam backend.';
    }

    if (backend.error) {
      return backend.error;
    }

    if (!activeSession) {
      return 'Choose a session from the desktop and pair with its PIN.';
    }

    return activeSession.pairing.verifiedAt
      ? `Connected to ${activeSession.localDevice.name} and ready to send or receive real files.`
      : `Enter PIN ${activeSession.pairing.pin} to pair this phone with the desktop session.`;
  }, [activeSession, backend.error, backend.loading]);

  return (
    <main className="phone-shell">
      <div className="phone-shell__ambient phone-shell__ambient--one" />
      <div className="phone-shell__ambient phone-shell__ambient--two" />

      <div className="phone-shell__frame">
        <GlassPanel className="phone-hero">
          <div className="phone-hero__top">
            <div className="phone-hero__copy">
              <p className="phone-eyebrow">DropBeam Safari</p>
              <h1>{activeSession ? 'Live phone transfer lane' : 'Pair to a desktop session'}</h1>
              <p>{description}</p>
            </div>

            <div className="phone-hero__badges">
              <Badge tone={backend.loading ? 'amber' : 'green'}>{backend.loading ? 'loading' : 'local backend'}</Badge>
              <Badge tone="blue">{activeSession?.state ?? 'idle'}</Badge>
            </div>
          </div>

          <div className="phone-summary-grid">
            <article className="phone-summary-card">
              <span>Peer</span>
              <strong>{activeSession?.localDevice.name ?? 'No session selected'}</strong>
              <p>Choose a desktop session and pair with its PIN.</p>
            </article>
            <article className="phone-summary-card">
              <span>Queue</span>
              <strong>{activeSession?.queue.totalFiles ?? 0}</strong>
              <p>Real files uploaded by either side appear live.</p>
            </article>
            <article className="phone-summary-card">
              <span>Clipboard</span>
              <strong>{backend.clipboard?.sourceDeviceName ?? 'Idle'}</strong>
              <p>{backend.clipboard?.updatedAt ? 'Shared text is ready across connected devices.' : 'Clipboard sync has not started yet.'}</p>
            </article>
          </div>

          <nav className="phone-tabbar">
            {(Object.keys(screenMap) as PhoneScreen[]).map((item) => (
              <Button
                key={item}
                variant={screen === item ? 'primary' : 'ghost'}
                className={`phone-tabbar__button${screen === item ? ' phone-tabbar__button--active' : ''}`}
                onClick={() => {
                  startTransition(() => {
                    setScreen(item);
                  });
                }}
              >
                <span>{screenMap[item].title}</span>
                <small>{screenMap[item].note}</small>
              </Button>
            ))}
          </nav>
        </GlassPanel>

        {screen === 'connect' ? <ConnectScreen backend={backend} /> : null}
        {screen === 'receive' ? <ReceiveScreen backend={backend} /> : null}
        {screen === 'send' ? <SendScreen backend={backend} /> : null}

        <GlassPanel className="phone-footer-card">
          <div className="phone-footer-stat">
            <span>Sessions</span>
            <strong>{backend.health?.sessions ?? 0}</strong>
            <p>All current desktop sessions exposed by the backend.</p>
          </div>
          <div className="phone-footer-stat">
            <span>Pairing</span>
            <strong>{activeSession?.pairing.verifiedAt ? 'Verified' : 'Pending'}</strong>
            <p>PIN-based pairing is now backed by live session state.</p>
          </div>
          <div className="phone-footer-stat">
            <span>Uploads in flight</span>
            <strong>{backend.activeUploads.length}</strong>
            <p>Chunked uploads report their progress here while files are moving.</p>
          </div>
        </GlassPanel>

        {installPrompt.canInstall || installPrompt.showIosHint ? (
          <GlassPanel className="phone-install-card">
            <div>
              <p className="phone-panel__eyebrow">Install</p>
              <h3>Add DropBeam to your home screen</h3>
              <p>
                {installPrompt.canInstall
                  ? 'Install the web app for faster relaunches and a more native transfer flow.'
                  : 'On iPhone Safari, tap Share, then choose Add to Home Screen to keep DropBeam one tap away.'}
              </p>
            </div>
            {installPrompt.canInstall ? (
              <Button onClick={() => void installPrompt.install()} variant="secondary">
                Install app
              </Button>
            ) : null}
          </GlassPanel>
        ) : null}
      </div>
    </main>
  );
}

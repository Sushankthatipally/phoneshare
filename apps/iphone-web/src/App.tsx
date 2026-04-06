import { startTransition, useMemo, useState } from 'react';

import { Link2, SendHorizontal, Upload, Zap } from 'lucide-react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import { ConnectScreen } from './screens/Connect.js';
import { ReceiveScreen } from './screens/Receive.js';
import { SendScreen } from './screens/Send.js';
import { useInstallPrompt } from './services/useInstallPrompt.js';
import { usePhoneBackend } from './services/usePhoneBackend.js';

type PhoneScreen = 'connect' | 'receive' | 'send';

const screenMap: Record<PhoneScreen, { title: string; note: string; icon: typeof Link2 }> = {
  connect: { title: 'Connect', note: 'pair + trust', icon: Link2 },
  receive: { title: 'Receive', note: 'desktop files', icon: Upload },
  send: { title: 'Send', note: 'phone files', icon: SendHorizontal },
};

export default function App() {
  const [screen, setScreen] = useState<PhoneScreen>('connect');
  const backend = usePhoneBackend();
  const activeSession = backend.activeSession;
  const installPrompt = useInstallPrompt();

  const description = useMemo(() => {
    if (backend.loading) {
      return 'Loading live desktop sessions from the local backend.';
    }

    if (backend.error) {
      return backend.error;
    }

    if (!activeSession) {
      return 'Choose a desktop session and verify it with the live PIN.';
    }

    return activeSession.pairing.verifiedAt
      ? `Connected to ${activeSession.localDevice.name}. The phone can now send and receive real files.`
      : `Enter PIN ${activeSession.pairing.pin} to verify this phone against the current desktop session.`;
  }, [activeSession, backend.error, backend.loading]);

  return (
    <main className="phone-shell">
      <div className="phone-shell__frame">
        <GlassPanel className="phone-hero">
          <div className="phone-hero__top">
            <div className="phone-hero__copy">
              <p className="phone-eyebrow">DropBeam Phone</p>
              <h1>Live transfer lane</h1>
              <p>{description}</p>
            </div>

            <div className="phone-hero__badges">
              <Badge tone={backend.loading ? 'amber' : 'green'}>
                {backend.loading ? 'loading' : 'backend online'}
              </Badge>
              <Badge tone="blue">{activeSession?.state ?? 'idle'}</Badge>
            </div>
          </div>

          <div className="phone-summary-grid">
            <article className="phone-summary-card">
              <span>Peer</span>
              <strong>{activeSession?.localDevice.name ?? 'No session selected'}</strong>
              <p>Choose a desktop session before pairing.</p>
            </article>
            <article className="phone-summary-card">
              <span>Queue</span>
              <strong>{activeSession?.queue.totalFiles ?? 0}</strong>
              <p>Files move through the backend queue in real time.</p>
            </article>
            <article className="phone-summary-card">
              <span>Clipboard</span>
              <strong>{backend.clipboard?.sourceDeviceName ?? 'Idle'}</strong>
              <p>{backend.clipboard?.updatedAt ? 'Shared text is available live.' : 'Clipboard sync has not run yet.'}</p>
            </article>
          </div>

          <nav className="phone-tabbar">
            {(Object.keys(screenMap) as PhoneScreen[]).map((item) => {
              const Icon = screenMap[item].icon;

              return (
                <Button
                  key={item}
                  variant={screen === item ? 'primary' : 'ghost'}
                  className="phone-tabbar__button"
                  onClick={() => {
                    startTransition(() => {
                      setScreen(item);
                    });
                  }}
                >
                  <span>
                    <Icon size={14} strokeWidth={2.2} />
                    {screenMap[item].title}
                  </span>
                  <small>{screenMap[item].note}</small>
                </Button>
              );
            })}
          </nav>
        </GlassPanel>

        {screen === 'connect' ? <ConnectScreen backend={backend} /> : null}
        {screen === 'receive' ? <ReceiveScreen backend={backend} /> : null}
        {screen === 'send' ? <SendScreen backend={backend} /> : null}

        <GlassPanel className="phone-footer-card">
          <div className="phone-footer-stat">
            <span>Sessions</span>
            <strong>{backend.health?.sessions ?? 0}</strong>
            <p>All live desktop sessions exposed by the backend.</p>
          </div>
          <div className="phone-footer-stat">
            <span>Pairing</span>
            <strong>{activeSession?.pairing.verifiedAt ? 'Verified' : 'Pending'}</strong>
            <p>PIN verification uses the live session state.</p>
          </div>
          <div className="phone-footer-stat">
            <span>Uploads</span>
            <strong>{backend.activeUploads.length}</strong>
            <p>Chunked uploads report their progress here.</p>
          </div>
        </GlassPanel>

        {installPrompt.canInstall || installPrompt.showIosHint ? (
          <GlassPanel className="phone-install-card">
            <div>
              <p className="phone-panel__eyebrow">Install</p>
              <h3>Add DropBeam to the home screen</h3>
              <p>
                {installPrompt.canInstall
                  ? 'Install the web app for faster relaunches and a cleaner transfer flow.'
                  : 'On iPhone Safari, use Share and then Add to Home Screen.'}
              </p>
            </div>

            {installPrompt.canInstall ? (
              <Button onClick={() => void installPrompt.install()} variant="secondary">
                <Zap size={14} strokeWidth={2.2} />
                Install
              </Button>
            ) : (
              <Badge tone="blue">Safari hint</Badge>
            )}
          </GlassPanel>
        ) : null}
      </div>
    </main>
  );
}

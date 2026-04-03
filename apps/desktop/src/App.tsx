import { startTransition, useMemo, useState } from 'react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import { useDesktopBackend } from './features/dashboard/useDesktopBackend.js';
import { History } from './screens/History.js';
import { Home } from './screens/Home.js';
import { Receive } from './screens/Receive.js';
import { Send } from './screens/Send.js';
import { Settings } from './screens/Settings.js';

type DesktopScreen = 'home' | 'send' | 'receive' | 'history' | 'settings';

const screens: Array<{ id: DesktopScreen; label: string; note: string }> = [
  { id: 'home', label: 'Home', note: 'overview' },
  { id: 'send', label: 'Send', note: 'desktop to phone' },
  { id: 'receive', label: 'Receive', note: 'phone to desktop' },
  { id: 'history', label: 'History', note: 'completed sessions' },
  { id: 'settings', label: 'Settings', note: 'backend prefs' },
];

export default function App() {
  const [screen, setScreen] = useState<DesktopScreen>('home');
  const backend = useDesktopBackend();
  const activeSession = backend.activeSession;

  const description = useMemo(() => {
    if (backend.loading) {
      return 'Loading the local backend and current file state.';
    }

    if (backend.error) {
      return backend.error;
    }

    if (!activeSession) {
      return 'Create a local session to generate a live PIN and pairing URL for the phone app.';
    }

    if (!activeSession.pairing.verifiedAt) {
      return `Session is open. Share PIN ${activeSession.pairing.pin} with the phone to finish pairing.`;
    }

    return `Paired with ${activeSession.peerDevice?.name ?? 'a phone'} and ready for live file transfers.`;
  }, [activeSession, backend.error, backend.loading]);

  return (
    <main className="desktop-app">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <p className="desktop-eyebrow">DropBeam desktop</p>
          <h1>{activeSession ? 'Live local transfer control' : 'Start a local session'}</h1>
          <p>{description}</p>
          <div className="desktop-brand__metrics">
            <div className="desktop-brand__metric">
              <span>Sessions</span>
              <strong>{backend.health?.sessions ?? 0}</strong>
            </div>
            <div className="desktop-brand__metric">
              <span>Tracked bytes</span>
              <strong>{formatBytes(backend.health?.totalBytes ?? 0)}</strong>
            </div>
          </div>
        </div>

        <nav className="desktop-nav">
          {screens.map((item) => (
            <button
              className={`desktop-nav__button${screen === item.id ? ' desktop-nav__button--active' : ''}`}
              key={item.id}
              onClick={() => {
                startTransition(() => {
                  setScreen(item.id);
                });
              }}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </nav>

        <GlassPanel className="desktop-sidebar__panel">
          <Badge tone={backend.error ? 'amber' : 'green'}>{backend.error ? 'backend issue' : 'backend online'}</Badge>
          <p>{backend.error ? 'Check the local runtime status and active sessions.' : 'The local transfer service is ready for pairing and file exchange.'}</p>
          <div className="desktop-sidebar__stats">
            <div className="desktop-sidebar__stat">
              <span>Files tracked</span>
              <strong>{backend.health?.fileCount ?? 0}</strong>
            </div>
            <div className="desktop-sidebar__stat">
              <span>Paired sessions</span>
              <strong>{backend.health?.pairedSessions ?? 0}</strong>
            </div>
          </div>
        </GlassPanel>
      </aside>

      <section className="desktop-workspace">
        <header className="desktop-topbar">
          <div className="desktop-topbar__copy">
            <SectionHeading
              eyebrow="Local backend"
              title={activeSession ? `Session ${activeSession.id.slice(0, 8)}` : 'Create a live session'}
              description={description}
            />
          </div>
          <div className="desktop-chip-row">
            <Badge tone={backend.loading ? 'amber' : 'green'}>{backend.loading ? 'loading' : 'live'}</Badge>
            <Badge tone="blue">{activeSession?.state ?? 'idle'}</Badge>
            <Badge>{activeSession?.peerDevice?.name ?? 'no phone paired yet'}</Badge>
            <Button disabled={backend.busy === 'create-session'} onClick={() => void backend.createSession()} variant="secondary">
              {backend.busy === 'create-session' ? 'Creating...' : 'Create session'}
            </Button>
            <Button
              disabled={!activeSession || backend.busy === 'close-session'}
              onClick={() => void backend.closeSession()}
              variant="ghost"
            >
              Close session
            </Button>
          </div>
        </header>

        <div className="desktop-layout">
          <div className="desktop-main">{renderScreen(screen, backend)}</div>
          <aside className="desktop-rail">
            <GlassPanel className="desktop-rail__panel">
              <SectionHeading
                eyebrow="Pairing"
                title={activeSession ? 'Current session' : 'No live session selected'}
                description={
                  activeSession
                    ? `Share PIN ${activeSession.pairing.pin} with the phone to complete pairing.`
                    : 'Create a session to generate a live pairing code.'
                }
              />
              <div className="desktop-rail__facts">
                <div>
                  <span>Status</span>
                  <strong>{activeSession?.state ?? 'idle'}</strong>
                </div>
                <div>
                  <span>Peer</span>
                  <strong>{activeSession?.peerDevice?.name ?? 'Waiting for phone'}</strong>
                </div>
                <div>
                  <span>Files in queue</span>
                  <strong>{activeSession?.queue.totalFiles ?? 0}</strong>
                </div>
              </div>
              {backend.sessions.length ? (
                <div className="desktop-session-switcher">
                  {backend.sessions.map((session) => (
                    <button
                      className={`desktop-session-switcher__button${
                        backend.selectedSessionId === session.id ? ' desktop-session-switcher__button--active' : ''
                      }`}
                      key={session.id}
                      onClick={() => backend.setSelectedSessionId(session.id)}
                      type="button"
                    >
                      <span>{deviceIconGlyph(session.peerDevice?.icon ?? session.localDevice.icon)}</span>
                      <strong>{session.peerDevice?.name ?? session.localDevice.name}</strong>
                      <small>{session.id.slice(0, 8)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </GlassPanel>

            <GlassPanel className="desktop-rail__panel">
              <SectionHeading
                eyebrow="Backend stats"
                title="Live values from the local server"
                description="These counters update from the Node backend as sessions and files change."
              />
              <ul className="desktop-rail__list">
                <li>Active sessions: {backend.health?.activeSessions ?? 0}</li>
                <li>Transferring sessions: {backend.health?.transferringSessions ?? 0}</li>
                <li>Completed sessions: {backend.dashboard?.totals.completed ?? 0}</li>
                <li>Clipboard source: {backend.clipboard?.sourceDeviceName ?? 'none yet'}</li>
              </ul>
            </GlassPanel>
          </aside>
        </div>
      </section>
    </main>
  );
}

function renderScreen(screen: DesktopScreen, backend: ReturnType<typeof useDesktopBackend>) {
  switch (screen) {
    case 'home':
      return <Home backend={backend} />;
    case 'send':
      return <Send backend={backend} />;
    case 'receive':
      return <Receive backend={backend} />;
    case 'history':
      return <History backend={backend} />;
    case 'settings':
      return <Settings backend={backend} />;
    default:
      return null;
  }
}

function deviceIconGlyph(icon?: string | null) {
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

import { startTransition, useMemo, useState } from 'react';

import {
  Download,
  History as HistoryIcon,
  House,
  Laptop,
  QrCode,
  RefreshCw,
  Settings as SettingsIcon,
  SendHorizontal,
  Smartphone,
  Zap,
} from 'lucide-react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import { useDesktopBackend } from './features/dashboard/useDesktopBackend.js';
import { History } from './screens/History.js';
import { Home } from './screens/Home.js';
import { Receive } from './screens/Receive.js';
import { Send } from './screens/Send.js';
import { Settings } from './screens/Settings.js';

type DesktopScreen = 'home' | 'send' | 'receive' | 'history' | 'settings';

const screens: Array<{
  id: DesktopScreen;
  label: string;
  note: string;
  icon: typeof House;
}> = [
  { id: 'home', label: 'Home', note: 'overview', icon: House },
  { id: 'send', label: 'Send', note: 'desktop to phone', icon: SendHorizontal },
  { id: 'receive', label: 'Receive', note: 'phone to desktop', icon: Download },
  { id: 'history', label: 'History', note: 'completed sessions', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', note: 'backend identity', icon: SettingsIcon },
];

export default function App() {
  const [screen, setScreen] = useState<DesktopScreen>('home');
  const [pairView, setPairView] = useState<'qr' | 'devices'>('devices');
  const backend = useDesktopBackend();
  const activeSession = backend.activeSession;

  const description = useMemo(() => {
    if (backend.loading) {
      return 'Loading the local transfer service.';
    }

    if (backend.error) {
      return backend.error;
    }

    if (!activeSession) {
      return 'Create a session to issue a live PIN and open a transfer lane.';
    }

    if (!activeSession.pairing.verifiedAt) {
      return `Session ${activeSession.id.slice(0, 8)} is waiting for phone verification.`;
    }

    return `Paired with ${activeSession.peerDevice?.name ?? 'a phone'} and ready for live transfers.`;
  }, [activeSession, backend.error, backend.loading]);

  return (
    <main className="desktop-app">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <div className="desktop-brand__header">
            <div className="desktop-brand__mark">
              <Zap size={18} strokeWidth={2.3} />
            </div>
            <div>
              <p className="desktop-eyebrow">DropBeam Desktop</p>
              <h1>Transfer console</h1>
              <p>{description}</p>
            </div>
          </div>

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
          {screens.map((item) => {
            const Icon = item.icon;

            return (
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
                <span className="desktop-nav__icon">
                  <Icon size={18} strokeWidth={2.1} />
                </span>
                <span>
                  <span>{item.label}</span>
                  <small>{item.note}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <GlassPanel className="desktop-sidebar__panel">
          <Badge tone={backend.error ? 'amber' : 'green'}>
            {backend.error ? 'backend issue' : 'backend online'}
          </Badge>
          <p>
            {backend.error
              ? 'The local service reported an error.'
              : 'The desktop shell is backed by the live Node transfer service.'}
          </p>
          <div className="desktop-sidebar__stats">
            <div className="desktop-sidebar__stat">
              <span>Paired sessions</span>
              <strong>{backend.health?.pairedSessions ?? 0}</strong>
            </div>
            <div className="desktop-sidebar__stat">
              <span>Files tracked</span>
              <strong>{backend.health?.fileCount ?? 0}</strong>
            </div>
          </div>
        </GlassPanel>
      </aside>

      <section className="desktop-workspace">
        <header className="desktop-topbar">
          <div className="desktop-topbar__copy">
            <SectionHeading
              eyebrow="Session"
              title={activeSession ? activeSession.localDevice.name : 'No active session'}
              description={description}
            />
          </div>
          <div className="desktop-chip-row">
            <Badge tone={backend.loading ? 'amber' : 'green'}>
              {backend.loading ? 'loading' : 'live'}
            </Badge>
            <Badge tone="blue">{activeSession?.state ?? 'idle'}</Badge>
            <Badge>{activeSession?.peerDevice?.name ?? 'waiting for phone'}</Badge>
            <Button
              disabled={backend.busy === 'create-session'}
              onClick={() => void backend.createSession()}
              variant="primary"
            >
              {backend.busy === 'create-session' ? 'Creating' : 'Create session'}
            </Button>
            <Button
              disabled={!activeSession || backend.busy === 'close-session'}
              onClick={() => void backend.closeSession()}
              variant="ghost"
            >
              Close
            </Button>
          </div>
        </header>

        <div className="desktop-layout">
          <div className="desktop-main">{renderScreen(screen, backend)}</div>

          <aside className="desktop-rail">
            <GlassPanel className="desktop-rail__panel">
              <SectionHeading
                eyebrow="Pair"
                title={activeSession ? 'Current pairing lane' : 'Create a session first'}
                description={
                  activeSession
                    ? `Share PIN ${activeSession.pairing.pin} to pair the phone.`
                    : 'No session is currently selected.'
                }
              />

              <div className="desktop-device-toggle">
                <button
                  className={`desktop-device-toggle__button${
                    pairView === 'qr' ? ' desktop-device-toggle__button--active' : ''
                  }`}
                  onClick={() => setPairView('qr')}
                  type="button"
                >
                  QR Code
                </button>
                <button
                  className={`desktop-device-toggle__button${
                    pairView === 'devices' ? ' desktop-device-toggle__button--active' : ''
                  }`}
                  onClick={() => setPairView('devices')}
                  type="button"
                >
                  mDNS Devices
                </button>
              </div>

              {pairView === 'devices' ? (
                <>
                  <div className="desktop-device-discovery">
                    <p>Discovery only works on the same local network.</p>
                    <button className="desktop-refresh-button" onClick={() => void backend.refresh()} type="button">
                      <RefreshCw size={16} strokeWidth={2} />
                      Refresh
                    </button>
                  </div>

                  <div className="desktop-device-list">
                    {backend.sessions.length ? (
                      backend.sessions.map((session) => {
                        const DeviceIcon = iconForDevice(session.peerDevice?.icon ?? session.localDevice.icon);
                        const bars = signalBars(session.mode);

                        return (
                          <button
                            className={`desktop-device-card${
                              backend.selectedSessionId === session.id ? ' desktop-device-card--active' : ''
                            }`}
                            key={session.id}
                            onClick={() => backend.setSelectedSessionId(session.id)}
                            type="button"
                          >
                            <div className="desktop-device-card__icon">
                              <DeviceIcon size={28} strokeWidth={1.9} />
                            </div>

                            <div className="desktop-device-card__copy">
                              <strong>{session.peerDevice?.name ?? `${session.localDevice.name} lane`}</strong>
                              <div className="desktop-device-card__meta">
                                <span>{modeLabel(session.mode)}</span>
                                {session.pairing.verifiedAt ? (
                                  <small>Verified</small>
                                ) : (
                                  <small>PIN {session.pairing.pin}</small>
                                )}
                              </div>
                            </div>

                            <div aria-hidden="true" className="desktop-device-bars">
                              {Array.from({ length: 4 }).map((_, index) => (
                                <span
                                  className={
                                    index < bars
                                      ? 'desktop-device-bars__bar desktop-device-bars__bar--active'
                                      : 'desktop-device-bars__bar'
                                  }
                                  key={index}
                                />
                              ))}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="desktop-empty-state">
                        <p>No live sessions are available yet. Create one from the desktop app first.</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="desktop-qr-placeholder">
                  <div className="desktop-qr-placeholder__box">
                    <QrCode size={54} strokeWidth={1.7} />
                  </div>
                  <div className="desktop-qr-placeholder__copy">
                    <strong>{activeSession ? `PIN ${activeSession.pairing.pin}` : 'No QR session yet'}</strong>
                    <p>
                      Open the phone app and scan the desktop pairing QR, or switch to the devices tab and choose a
                      live session directly.
                    </p>
                  </div>
                </div>
              )}
            </GlassPanel>

            <GlassPanel className="desktop-rail__panel">
              <SectionHeading
                eyebrow="Health"
                title="Live backend counters"
                description="These values come from the current backend snapshot."
              />
              <ul className="desktop-rail__list">
                <li>Active sessions: {backend.health?.activeSessions ?? 0}</li>
                <li>Transferring sessions: {backend.health?.transferringSessions ?? 0}</li>
                <li>Completed sessions: {backend.dashboard?.totals.completed ?? 0}</li>
                <li>Clipboard source: {backend.clipboard?.sourceDeviceName ?? 'none'}</li>
              </ul>
              <Badge tone="blue">Local backend only</Badge>
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

import { useEffect, useState } from 'react';

import { Download, History as HistoryIcon, House, Link2, SendHorizontal, Settings as SettingsIcon, Zap } from 'lucide-react';

import { Button } from '@dropbeam/shared-ui';

import { useDesktopBackend } from './features/dashboard/useDesktopBackend.js';
import { ConnectionPicker, type ConnectionChoice } from './components/ConnectionPicker.js';
import { ConnectionScreen } from './components/ConnectionScreen.js';
import { IncomingBanner } from './components/IncomingBanner.js';
import { Onboarding } from './components/Onboarding.js';
import { History } from './screens/History.js';
import { Home } from './screens/Home.js';
import { Receive } from './screens/Receive.js';
import { Send } from './screens/Send.js';
import { Settings } from './screens/Settings.js';
import { Guest } from './screens/Guest.js';

type Screen = 'home' | 'send' | 'receive' | 'history' | 'guest' | 'settings';

const NAV: Array<{ id: Screen; label: string; icon: typeof House }> = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'send', label: 'Send', icon: SendHorizontal },
  { id: 'receive', label: 'Receive', icon: Download },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'guest', label: 'Guest', icon: Link2 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const TITLES: Record<Screen, string> = {
  home: 'Home',
  send: 'Send',
  receive: 'Receive',
  history: 'History',
  guest: 'Guest share',
  settings: 'Settings',
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionChoice | null>(null);
  const [pendingSendPaths, setPendingSendPaths] = useState<string[]>([]);
  const backend = useDesktopBackend();

  // Pick up files passed in by the Windows "Send via DropBeam" context menu.
  // The Rust main.rs parses --send <path> args and emits a `dropbeam:send` event.
  useEffect(() => {
    const win = window as Window & {
      __TAURI_INTERNALS__?: {
        invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __TAURI__?: {
        event?: { listen: (name: string, handler: (event: { payload: { paths: string[] } }) => void) => Promise<() => void> };
      };
    };

    // Active push path
    let unlisten: (() => void) | undefined;
    if (win.__TAURI__?.event?.listen) {
      void win.__TAURI__.event
        .listen('dropbeam:send', (event) => {
          setPendingSendPaths((current) => [...current, ...(event.payload?.paths ?? [])]);
          setScreen('send');
        })
        .then((dispose) => {
          unlisten = dispose;
        });
    }

    // Pull path for cold launches
    if (win.__TAURI_INTERNALS__?.invoke) {
      void win.__TAURI_INTERNALS__.invoke('get_pending_send_paths').then((value) => {
        const paths = Array.isArray(value) ? (value as string[]) : [];
        if (paths.length) {
          setPendingSendPaths((current) => [...current, ...paths]);
          setScreen('send');
        }
      });
    }

    return () => {
      unlisten?.();
    };
  }, []);

  const needsOnboarding = !backend.loading && backend.settings && !backend.settings.onboardingComplete;

  const statusLabel = backend.loading
    ? 'Booting'
    : backend.error
      ? 'Offline'
      : backend.activeSession?.pairing.verifiedAt
        ? 'Paired'
        : backend.activeSession
          ? backend.activeSession.state === 'awaiting-accept'
            ? 'Accept?'
            : 'Waiting'
          : 'Idle';

  return (
    <div className="app">
      <aside className="app__nav">
        <div className="brand">
          <span className="brand__mark">
            <Zap size={16} strokeWidth={2.4} />
          </span>
          <span className="brand__name">
            <strong>DropBeam</strong>
            <small>Desktop</small>
          </span>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = screen === item.id;
            return (
              <button
                className={`nav__item${active ? ' nav__item--active' : ''}`}
                key={item.id}
                onClick={() => setScreen(item.id)}
                type="button"
              >
                <Icon size={16} strokeWidth={2} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="nav__status">
          <span>Backend</span>
          <strong>{statusLabel}</strong>
        </div>
      </aside>

      <main className="workspace">
        <div className="topbar">
          <h1>{TITLES[screen]}</h1>
          <div className="topbar__actions">
            {backend.activeSession ? (
              <Button
                disabled={backend.busy === 'close-session'}
                onClick={() => void backend.closeSession()}
                variant="ghost"
              >
                Close session
              </Button>
            ) : null}
            <Button
              disabled={backend.busy === 'create-session'}
              onClick={() => setPickerOpen(true)}
              variant="primary"
            >
              New session
            </Button>
          </div>
        </div>

        {backend.error ? (
          <section className="card" style={{ borderColor: 'var(--db-amber)' }}>
            <p className="card__eyebrow">Backend unreachable</p>
            <h2 className="card__title">Can't reach the local service</h2>
            <p className="card__copy">{backend.error}</p>
            <p className="card__copy">
              The bundled backend should auto-start on port 17619. If you see this message:
              <br />· Make sure no other DropBeam (or dev <code>node</code>) instance is holding the port.
              <br />· Run <code>scripts\diagnose-windows.ps1</code> from PowerShell for details.
            </p>
            <div className="topbar__actions">
              <Button onClick={() => void backend.refresh()} variant="primary">
                Retry
              </Button>
            </div>
          </section>
        ) : null}

        <IncomingBanner backend={backend} />

        {renderScreen(screen, backend, () => setPickerOpen(true), pendingSendPaths, () => setPendingSendPaths([]))}
      </main>

      {needsOnboarding ? <Onboarding backend={backend} /> : null}

      {pickerOpen ? (
        <ConnectionPicker
          backend={backend}
          onClose={() => setPickerOpen(false)}
          onChoose={(choice) => {
            setPickerOpen(false);
            setConnection(choice);
          }}
        />
      ) : null}

      {connection ? (
        <ConnectionScreen backend={backend} choice={connection} onClose={() => setConnection(null)} />
      ) : null}
    </div>
  );
}

function renderScreen(
  screen: Screen,
  backend: ReturnType<typeof useDesktopBackend>,
  openPicker: () => void,
  pendingSendPaths: string[],
  clearPendingSendPaths: () => void,
) {
  switch (screen) {
    case 'home':
      return <Home backend={backend} openPicker={openPicker} />;
    case 'send':
      return <Send backend={backend} pendingSendPaths={pendingSendPaths} onClearPending={clearPendingSendPaths} />;
    case 'receive':
      return <Receive backend={backend} />;
    case 'history':
      return <History backend={backend} />;
    case 'guest':
      return <Guest backend={backend} />;
    case 'settings':
      return <Settings backend={backend} />;
    default:
      return null;
  }
}

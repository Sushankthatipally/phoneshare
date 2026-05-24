import { useCallback, useEffect, useRef, useState } from 'react';

import { Download, SendHorizontal, Settings as SettingsIcon, Zap } from 'lucide-react';

import { resolveBackendOrigin } from '@dropbeam/protocol';

import { useDesktopBackend } from './features/dashboard/useDesktopBackend.js';
import { IncomingBanner } from './components/IncomingBanner.js';
import { Onboarding } from './components/Onboarding.js';
import { Receive } from './screens/Receive.js';
import { Send } from './screens/Send.js';
import { Settings } from './screens/Settings.js';
import { listenTauri } from './lib/tauri.js';

interface WatchFolderEvent {
  watchId: string;
  path: string;
  kind: string;
  destinationFingerprint?: string;
}

type Screen = 'receive' | 'send' | 'settings';

const NAV: Array<{ id: Screen; label: string; icon: typeof Download }> = [
  { id: 'receive', label: 'Receive', icon: Download },
  { id: 'send', label: 'Send', icon: SendHorizontal },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const TITLES: Record<Screen, string> = {
  receive: 'Receive',
  send: 'Send',
  settings: 'Settings',
};

const CLIPBOARD_POLL_MS = 2000;
const CLIPBOARD_PREVIEW_CHARS = 80;
const TOAST_LIFETIME_MS = 4000;

type Toast = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
};

type TauriDragDropEvent = {
  payload: {
    paths?: string[];
    position?: { x: number; y: number };
    type?: string;
  };
};

type TauriBridge = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
  };
  __TAURI__?: {
    event?: {
      listen: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
    };
  };
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('receive');
  const [pendingSendPaths, setPendingSendPaths] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const backend = useDesktopBackend();
  const lastClipboardSeenRef = useRef<string | null>(null);
  const lastClipboardEchoRef = useRef<string | null>(null);

  const sourceFingerprint = backend.settings?.deviceName
    ? `desktop:${backend.settings.deviceName}`
    : 'desktop:local';

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, TOAST_LIFETIME_MS);
  }, []);

  const routeDroppedFiles = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setPendingSendPaths((current) => [...current, ...paths]);
    setScreen('send');
  }, []);

  useEffect(() => {
    const win = window as TauriBridge;

    let unlistenSend: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenDropAlt: (() => void) | undefined;
    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;

    if (win.__TAURI__?.event?.listen) {
      void win.__TAURI__.event
        .listen('dropbeam:send', (event) => {
          const payload = event.payload as { paths?: string[] } | undefined;
          routeDroppedFiles(payload?.paths ?? []);
        })
        .then((dispose) => {
          unlistenSend = dispose;
        });

      const dropHandler = (event: { payload: unknown }) => {
        const payload = (event as TauriDragDropEvent).payload;
        if (payload?.paths?.length) {
          routeDroppedFiles(payload.paths);
        }
        setDragActive(false);
      };

      void win.__TAURI__.event.listen('tauri://drag-drop', dropHandler).then((dispose) => {
        unlistenDrop = dispose;
      });
      void win.__TAURI__.event.listen('tauri://file-drop', dropHandler).then((dispose) => {
        unlistenDropAlt = dispose;
      });
      void win.__TAURI__.event
        .listen('tauri://drag-enter', () => setDragActive(true))
        .then((dispose) => {
          unlistenDragEnter = dispose;
        });
      void win.__TAURI__.event
        .listen('tauri://drag-leave', () => setDragActive(false))
        .then((dispose) => {
          unlistenDragLeave = dispose;
        });
    }

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
      unlistenSend?.();
      unlistenDrop?.();
      unlistenDropAlt?.();
      unlistenDragEnter?.();
      unlistenDragLeave?.();
    };
  }, [routeDroppedFiles]);

  useEffect(() => {
    const isEnabled = Boolean(backend.settings?.clipboardSyncEnabled);
    if (!isEnabled) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        timer = window.setTimeout(tick, CLIPBOARD_POLL_MS);
        return;
      }
      if (typeof document !== 'undefined' && !document.hasFocus()) {
        timer = window.setTimeout(tick, CLIPBOARD_POLL_MS);
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        if (cancelled) return;
        if (typeof text === 'string' && text.length && text !== lastClipboardSeenRef.current) {
          lastClipboardSeenRef.current = text;
          lastClipboardEchoRef.current = text;
          await backend.updateClipboard(text);
        }
      } catch {
        // Permission denied or no clipboard.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(tick, CLIPBOARD_POLL_MS);
        }
      }
    };

    timer = window.setTimeout(tick, CLIPBOARD_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [backend, backend.settings?.clipboardSyncEnabled, sourceFingerprint]);

  useEffect(() => {
    const clipboard = backend.clipboard;
    if (!clipboard?.text) return;
    if (clipboard.sourceRole !== 'phone') return;
    if (lastClipboardEchoRef.current === clipboard.text) return;
    lastClipboardEchoRef.current = clipboard.text;
    const preview = clipboard.text.length > CLIPBOARD_PREVIEW_CHARS
      ? `${clipboard.text.slice(0, CLIPBOARD_PREVIEW_CHARS)}…`
      : clipboard.text;
    pushToast({
      eyebrow: 'Clipboard',
      title: `Clipboard from ${clipboard.sourceDeviceName ?? 'phone'}`,
      body: preview,
    });
  }, [backend.clipboard, pushToast]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const origin = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);
    (async () => {
      unlisten = await listenTauri<WatchFolderEvent>('dropbeam:watch', async (event) => {
        const { watchId, path, kind, destinationFingerprint } = event.payload;
        try {
          await fetch(`${origin}/api/watch-folder/file-detected`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              watchId,
              path,
              kind,
              destinationFingerprint: destinationFingerprint ?? null,
            }),
          });
        } catch (error) {
          console.error('failed to notify backend of watch-folder file', error);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const needsOnboarding = !backend.loading && backend.settings && !backend.settings.onboardingComplete;

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget && (event.currentTarget as Node).contains(event.relatedTarget as Node)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const fileList = Array.from(event.dataTransfer.files ?? []);
      if (fileList.length) {
        const namedPaths = fileList
          .map((file) => (file as File & { path?: string }).path ?? file.name)
          .filter((value): value is string => typeof value === 'string' && value.length > 0);
        if (namedPaths.length) {
          routeDroppedFiles(namedPaths);
        }
      }
    },
    [routeDroppedFiles],
  );

  return (
    <div className="app" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
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
      </aside>

      <main className="workspace">
        <div className="topbar">
          <h1>{TITLES[screen]}</h1>
        </div>

        {backend.error ? (
          <section className="card" style={{ borderColor: 'var(--db-amber)' }}>
            <p className="card__eyebrow">Backend unreachable</p>
            <h2 className="card__title">Can't reach the local service</h2>
            <p className="card__copy">{backend.error}</p>
          </section>
        ) : null}

        <IncomingBanner backend={backend} />

        {renderScreen(screen, backend, pendingSendPaths, () => setPendingSendPaths([]))}
      </main>

      {needsOnboarding ? <Onboarding backend={backend} /> : null}

      {dragActive ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__copy">
            <span className="drop-overlay__title">Release to send</span>
            <span className="drop-overlay__hint">Files will queue on the Send screen.</span>
          </div>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              <span className="toast__eyebrow">{toast.eyebrow}</span>
              <span className="toast__title">{toast.title}</span>
              <span className="toast__body">{toast.body}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderScreen(
  screen: Screen,
  backend: ReturnType<typeof useDesktopBackend>,
  pendingSendPaths: string[],
  clearPendingSendPaths: () => void,
) {
  switch (screen) {
    case 'send':
      return <Send backend={backend} pendingSendPaths={pendingSendPaths} onClearPending={clearPendingSendPaths} />;
    case 'receive':
      return <Receive backend={backend} />;
    case 'settings':
      return <Settings backend={backend} />;
    default:
      return null;
  }
}

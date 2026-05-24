import { useEffect, useMemo, useState } from 'react';

import { Badge, Button } from '@dropbeam/shared-ui';
import { formatBytes, resolveBackendOrigin } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';
import { QuickSaveToggle, type QuickSaveValue } from '../components/QuickSaveToggle.js';

const BACKEND_ORIGIN = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);
import {
  isTauri,
  openFolderDialog,
  registerContextMenu,
  startWatchFolder,
  stopWatchFolder,
  unregisterContextMenu,
  type ShellIntegrationResult,
} from '../lib/tauri.js';

type DeviceIcon = 'desktop' | 'laptop' | 'phone' | 'tablet';
type Tab = 'identity' | 'trusted' | 'watch' | 'shell' | 'benchmark';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'trusted', label: 'Trusted devices' },
  { id: 'watch', label: 'Watch folders' },
  { id: 'shell', label: 'Shell integration' },
  { id: 'benchmark', label: 'Benchmark' },
];

export function Settings({ backend }: { backend: DesktopBackendState }) {
  const [tab, setTab] = useState<Tab>('identity');
  const [deviceName, setDeviceName] = useState(backend.settings?.deviceName ?? 'DropBeam Desktop');
  const [deviceIcon, setDeviceIcon] = useState<DeviceIcon>(backend.settings?.deviceIcon ?? 'desktop');
  const [downloadFolder, setDownloadFolder] = useState(backend.settings?.downloadFolder ?? '~/Downloads/DropBeam/');
  const [connectionMode, setConnectionMode] = useState<'auto' | 'wifi' | 'usb'>(backend.settings?.connectionMode ?? 'auto');
  const [autoClose, setAutoClose] = useState(backend.settings?.autoCloseAfterDownload ?? false);
  const [autoAcceptTrusted, setAutoAcceptTrusted] = useState(backend.settings?.autoAcceptTrusted ?? false);
  const [clipboardSyncEnabled, setClipboardSyncEnabled] = useState(backend.settings?.clipboardSyncEnabled ?? false);

  useEffect(() => {
    if (!backend.settings) return;
    setDeviceName(backend.settings.deviceName);
    setDeviceIcon(backend.settings.deviceIcon);
    setDownloadFolder(backend.settings.downloadFolder);
    setConnectionMode(backend.settings.connectionMode);
    setAutoClose(backend.settings.autoCloseAfterDownload);
    setAutoAcceptTrusted(backend.settings.autoAcceptTrusted);
    setClipboardSyncEnabled(backend.settings.clipboardSyncEnabled);
  }, [backend.settings]);

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' tab--active' : ''}`}
            onClick={() => setTab(t.id)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'identity' ? (
        <>
          <ProfilePanel backend={backend} />
          <FavoritesPanel backend={backend} />
        <section className="card">
          <p className="card__eyebrow">Identity</p>
          <h2 className="card__title">Device defaults</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void backend.updateSettings({
                deviceName,
                deviceIcon,
                downloadFolder,
                connectionMode,
                preferredMode: connectionMode === 'usb' ? 'usb' : 'wifi',
                autoCloseAfterDownload: autoClose,
                autoAcceptTrusted,
                clipboardSyncEnabled,
              });
            }}
          >
            <div className="field">
              <span className="field__label">Device name</span>
              <input className="input" onChange={(e) => setDeviceName(e.target.value)} value={deviceName} />
            </div>

            <div className="field">
              <span className="field__label">Device icon</span>
              <select className="select" onChange={(e) => setDeviceIcon(e.target.value as DeviceIcon)} value={deviceIcon}>
                <option value="desktop">Desktop</option>
                <option value="laptop">Laptop</option>
                <option value="phone">Phone</option>
                <option value="tablet">Tablet</option>
              </select>
            </div>

            <div className="field">
              <span className="field__label">Download folder (preference)</span>
              <input className="input" onChange={(e) => setDownloadFolder(e.target.value)} value={downloadFolder} />
            </div>

            <div className="field">
              <span className="field__label">Preferred connection mode</span>
              <select
                className="select"
                onChange={(e) => setConnectionMode(e.target.value as 'auto' | 'wifi' | 'usb')}
                value={connectionMode}
              >
                <option value="auto">Auto · USB if plugged, WiFi otherwise</option>
                <option value="wifi">Always WiFi</option>
                <option value="usb">Always USB</option>
              </select>
            </div>

            <label className="checkbox">
              <input checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} type="checkbox" />
              Close sessions automatically after the last file downloads
            </label>

            <label className="checkbox">
              <input
                checked={autoAcceptTrusted}
                onChange={(e) => setAutoAcceptTrusted(e.target.checked)}
                type="checkbox"
              />
              Auto-accept incoming connections from trusted devices
            </label>

            <label className="checkbox">
              <input
                checked={clipboardSyncEnabled}
                onChange={(e) => setClipboardSyncEnabled(e.target.checked)}
                type="checkbox"
              />
              Clipboard sync — mirror what you copy here to paired phones
            </label>

            <div className="topbar__actions">
              <Button disabled={backend.busy === 'update-settings'} type="submit" variant="primary">
                {backend.busy === 'update-settings' ? 'Saving' : 'Save'}
              </Button>
            </div>
          </form>
        </section>
        </>
      ) : null}

      {tab === 'trusted' ? (
        <section className="card">
          <p className="card__eyebrow">Trusted devices</p>
          <h2 className="card__title">Phones that auto-accept</h2>
          <p className="card__copy">
            Trusted devices skip the Accept prompt when they reconnect. Toggle the master switch on the Identity tab.
          </p>
          {backend.trustedDevices.length ? (
            <div className="list">
              {backend.trustedDevices.map((device) => (
                <div className="row" key={device.fingerprint}>
                  <div className="row__copy">
                    <strong>{device.name}</strong>
                    <span>
                      {device.platform} · trusted {new Date(device.trustedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="topbar__actions">
                    <Badge tone={device.autoAccept ? 'green' : 'neutral'}>
                      {device.autoAccept ? 'auto' : 'manual'}
                    </Badge>
                    <Button onClick={() => void backend.removeTrusted(device.fingerprint)} variant="ghost">
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No trusted devices yet. Pair a phone and tap "Trust this device" on the Accept prompt.</div>
          )}

          {backend.knownDevices.length ? (
            <>
              <p className="card__eyebrow" style={{ marginTop: 12 }}>Known but not trusted</p>
              <div className="list">
                {backend.knownDevices
                  .filter((d) => !backend.trustedDevices.some((t) => t.fingerprint === d.fingerprint))
                  .map((device) => (
                    <div className="row" key={device.fingerprint}>
                      <div className="row__copy">
                        <strong>{device.name}</strong>
                        <span>
                          {device.platform} · last seen {new Date(device.lastSeenAt).toLocaleString()}
                        </span>
                      </div>
                      <Button onClick={() => void backend.setTrusted(device.fingerprint, true)} variant="secondary">
                        Trust
                      </Button>
                    </div>
                  ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'watch' ? <WatchFoldersSection backend={backend} /> : null}

      {tab === 'shell' ? <ShellIntegrationSection /> : null}

      {tab === 'benchmark' ? <BenchmarkSection backend={backend} /> : null}
    </>
  );
}

function WatchFoldersSection({ backend }: { backend: DesktopBackendState }) {
  const folders = useMemo(() => backend.settings?.watchFolders ?? [], [backend.settings]);
  const [destination, setDestination] = useState(backend.knownDevices[0]?.fingerprint ?? '');
  const [pickedPath, setPickedPath] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tauriAvailable = isTauri();

  useEffect(() => {
    if (!destination && backend.knownDevices[0]) setDestination(backend.knownDevices[0].fingerprint);
  }, [backend.knownDevices, destination]);

  // Register watchers for any folders that came back from the backend the
  // first time this tab mounts. start_watch_folder is idempotent by id so
  // re-running is safe.
  useEffect(() => {
    if (!tauriAvailable) return;
    let cancelled = false;
    (async () => {
      for (const folder of folders) {
        if (cancelled) break;
        await startWatchFolder({
          id: folder.id,
          path: folder.path,
          destinationFingerprint: folder.destinationFingerprint,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // We want to re-run only when the folder set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.map((f) => f.id).join('|')]);

  const pickFolder = async () => {
    setError(null);
    const path = await openFolderDialog();
    if (!path) return;
    setPickedPath(path);
  };

  const addFolder = async () => {
    setError(null);
    const target = backend.knownDevices.find((d) => d.fingerprint === destination);
    if (!target || !pickedPath) {
      setError('Pick a folder and a destination device first.');
      return;
    }
    setAdding(true);
    const id = crypto.randomUUID();
    try {
      const ok = await startWatchFolder({
        id,
        path: pickedPath,
        destinationFingerprint: destination,
      });
      if (!ok && tauriAvailable) {
        setError('Failed to start watcher. Check folder permissions.');
        return;
      }
      const nextFolders = [
        ...folders,
        {
          id,
          path: pickedPath,
          destinationFingerprint: destination,
          destinationLabel: target.name,
          fileTypes: 'all' as const,
          trigger: 'on-connect' as const,
        },
      ];
      await backend.updateSettings({ watchFolders: nextFolders });
      setPickedPath('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add watch folder');
    } finally {
      setAdding(false);
    }
  };

  const removeFolder = async (id: string) => {
    setError(null);
    if (tauriAvailable) await stopWatchFolder(id);
    await backend.updateSettings({ watchFolders: folders.filter((f) => f.id !== id) });
  };

  const updateFileTypes = async (id: string, value: 'all' | 'images') => {
    const next = folders.map((f) => (f.id === id ? { ...f, fileTypes: value } : f));
    await backend.updateSettings({ watchFolders: next });
  };

  return (
    <section className="card">
      <p className="card__eyebrow">Watch folders</p>
      <h2 className="card__title">Auto-send when a phone connects</h2>
      <p className="card__copy">
        Add a folder and a destination device. When the device reconnects, anything new in the folder is sent automatically.
      </p>

      <div className="field">
        <span className="field__label">Source folder</span>
        <div className="topbar__actions">
          <Button onClick={() => void pickFolder()} variant="secondary" disabled={!tauriAvailable}>
            Choose folder…
          </Button>
          <span className="card__copy" style={{ marginLeft: 8 }}>
            {pickedPath || (tauriAvailable ? 'No folder selected' : 'Folder picker requires the desktop app')}
          </span>
        </div>
      </div>

      <div className="field">
        <span className="field__label">Destination device</span>
        <select className="select" onChange={(e) => setDestination(e.target.value)} value={destination}>
          <option value="">— pick a known device —</option>
          {backend.knownDevices.map((d) => (
            <option key={d.fingerprint} value={d.fingerprint}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="topbar__actions">
        <Button
          disabled={!pickedPath || !destination || adding}
          onClick={() => void addFolder()}
          variant="primary"
        >
          {adding ? 'Adding…' : 'Add watch folder'}
        </Button>
      </div>

      {error ? <span className="connection__pulse">{error}</span> : null}

      {folders.length ? (
        <div className="list">
          {folders.map((folder) => {
            const currentFileType =
              folder.fileTypes === 'all' || folder.fileTypes === 'images' ? folder.fileTypes : 'all';
            return (
              <div className="row" key={folder.id}>
                <div className="row__copy">
                  <strong>{folder.path}</strong>
                  <span>
                    → {folder.destinationLabel} · {folder.trigger.replace('-', ' ')}
                  </span>
                </div>
                <div className="topbar__actions">
                  <select
                    className="select"
                    onChange={(e) => void updateFileTypes(folder.id, e.target.value as 'all' | 'images')}
                    value={currentFileType}
                  >
                    <option value="all">All files</option>
                    <option value="images">Images only</option>
                  </select>
                  <Button onClick={() => void removeFolder(folder.id)} variant="ghost">
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">No watch folders configured.</div>
      )}
    </section>
  );
}

function ShellIntegrationSection() {
  const tauriAvailable = isTauri();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<ShellIntegrationResult | null>(null);
  const [busy, setBusy] = useState(false);

  const platform = useMemo(() => {
    if (typeof navigator === 'undefined') return 'unknown';
    const p = navigator.platform.toLowerCase();
    if (p.includes('win')) return 'Windows';
    if (p.includes('mac')) return 'macOS';
    if (p.includes('linux')) return 'Linux';
    return navigator.platform;
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const result = next ? await registerContextMenu() : await unregisterContextMenu();
      setStatus(result);
      setEnabled(result.ok && next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <p className="card__eyebrow">Shell integration</p>
      <h2 className="card__title">Send via DropBeam from the file manager</h2>
      <p className="card__copy">
        Installs a "Send via DropBeam" entry in your OS file manager. Selecting files and choosing it launches DropBeam
        with those paths queued in the Send screen.
      </p>

      <label className="checkbox">
        <input
          checked={enabled}
          disabled={!tauriAvailable || busy}
          onChange={(e) => void toggle(e.target.checked)}
          type="checkbox"
        />
        Install "Send via DropBeam" entry ({platform})
      </label>

      {!tauriAvailable ? (
        <p className="card__copy">Shell integration requires the desktop app.</p>
      ) : null}

      {status ? (
        <p className="card__copy">
          {status.ok ? (
            <>Installed at <code>{status.path ?? status.platform}</code>.</>
          ) : (
            <>Failed: {status.error ?? 'unknown error'}</>
          )}
        </p>
      ) : null}

      {platform === 'macOS' ? (
        <p className="card__copy">
          On macOS the Service shell registers under Library/Services. Workflow body generation is a stretch goal — the
          stub appears in System Settings → Keyboard → Services but does not yet launch the binary directly.
        </p>
      ) : null}
    </section>
  );
}

function BenchmarkSection({ backend }: { backend: DesktopBackendState }) {
  const [running, setRunning] = useState(false);
  const [send, setSend] = useState<{ bytesPerSecond: number } | null>(null);
  const [receive, setReceive] = useState<{ bytesPerSecond: number } | null>(null);

  const ceiling = ceilingFor(backend.activeSession?.mode ?? backend.settings?.preferredMode ?? 'wifi');

  return (
    <section className="card">
      <p className="card__eyebrow">Speed benchmark</p>
      <h2 className="card__title">How fast is the active lane?</h2>
      <p className="card__copy">
        Sends and receives a 4 MB blob to the local backend. Real device-to-device throughput will be measured once the
        mobile transport lands; for now this confirms the desktop ↔ backend lane.
      </p>

      <div className="topbar__actions">
        <Button
          disabled={running}
          onClick={async () => {
            setRunning(true);
            setSend(null);
            setReceive(null);
            try {
              const s = await backend.benchmarkSend();
              setSend(s);
              const r = await backend.benchmarkReceive();
              setReceive(r);
            } finally {
              setRunning(false);
            }
          }}
          variant="primary"
        >
          {running ? 'Running…' : 'Run speed test'}
        </Button>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Send</span>
          <strong className="stat__value">{send ? `${formatBytes(send.bytesPerSecond)}/s` : '—'}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Receive</span>
          <strong className="stat__value">{receive ? `${formatBytes(receive.bytesPerSecond)}/s` : '—'}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Ceiling</span>
          <strong className="stat__value">{formatBytes(ceiling)}/s</strong>
        </div>
      </div>

      {send ? (
        <div className="bar">
          <div
            className="bar__fill"
            style={{ width: `${Math.min(100, Math.round((send.bytesPerSecond / ceiling) * 100))}%` }}
          />
        </div>
      ) : null}
    </section>
  );
}

function ProfilePanel({ backend }: { backend: DesktopBackendState }) {
  const friendlyName = (backend.settings?.friendlyName as string | undefined) ?? '';
  const hashtag = (backend.settings?.hashtag as string | undefined) ?? '';
  const quickSave = ((backend.settings?.quickSave as QuickSaveValue | undefined) ?? 'off') as QuickSaveValue;
  const [draft, setDraft] = useState(friendlyName);
  useEffect(() => setDraft(friendlyName), [friendlyName]);

  return (
    <section className="card">
      <p className="card__eyebrow">Profile</p>
      <h2 className="card__title">Friendly name and Quick Save</h2>
      <div className="form">
        <div className="field">
          <span className="field__label">Friendly name</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              type="button"
              onClick={() => {
                void backend.updateSettings({ friendlyName: draft });
              }}
              variant="primary"
            >
              Save
            </Button>
            <Button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch(`${BACKEND_ORIGIN}/api/settings/regenerate-name`, { method: 'POST' });
                  if (res.ok) await backend.refresh?.();
                } catch {
                  /* surfaced via backend error state */
                }
              }}
            >
              Regenerate
            </Button>
          </div>
        </div>
        <div className="field">
          <span className="field__label">Hashtag</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--db-text-dim)' }}>{hashtag || '—'}</span>
        </div>
        <div className="field">
          <span className="field__label">Quick Save</span>
          <QuickSaveToggle
            value={quickSave}
            onChange={(next) => {
              void backend.updateSettings({ quickSave: next });
            }}
          />
        </div>
      </div>
    </section>
  );
}

function FavoritesPanel({ backend }: { backend: DesktopBackendState }) {
  const favorites = (backend.settings?.favorites as string[] | undefined) ?? [];
  return (
    <section className="card">
      <p className="card__eyebrow">Favorites</p>
      <h2 className="card__title">Hearted devices</h2>
      {favorites.length === 0 ? (
        <p className="card__copy">Heart a device on the Send tab to add it here.</p>
      ) : (
        <div className="list">
          {favorites.map((fp) => (
            <div className="row" key={fp} style={{ alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', flex: 1, overflowWrap: 'anywhere' }}>{fp}</span>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    await fetch(`${BACKEND_ORIGIN}/api/favorites/${encodeURIComponent(fp)}`, { method: 'DELETE' });
                    await backend.refresh?.();
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ceilingFor(mode: string) {
  switch (mode) {
    case 'usb':
      return 180 * 1024 * 1024;
    case 'hotspot':
      return 28 * 1024 * 1024;
    default:
      return 96 * 1024 * 1024;
  }
}

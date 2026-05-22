import { useEffect, useState } from 'react';

import { Badge, Button } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

type DeviceIcon = 'desktop' | 'laptop' | 'phone' | 'tablet';
type Tab = 'identity' | 'trusted' | 'watch' | 'benchmark';

export function Settings({ backend }: { backend: DesktopBackendState }) {
  const [tab, setTab] = useState<Tab>('identity');
  const [deviceName, setDeviceName] = useState(backend.settings?.deviceName ?? 'DropBeam Desktop');
  const [deviceIcon, setDeviceIcon] = useState<DeviceIcon>(backend.settings?.deviceIcon ?? 'desktop');
  const [downloadFolder, setDownloadFolder] = useState(backend.settings?.downloadFolder ?? '~/Downloads/DropBeam/');
  const [connectionMode, setConnectionMode] = useState<'auto' | 'wifi' | 'usb'>(backend.settings?.connectionMode ?? 'auto');
  const [autoClose, setAutoClose] = useState(backend.settings?.autoCloseAfterDownload ?? false);
  const [autoAcceptTrusted, setAutoAcceptTrusted] = useState(backend.settings?.autoAcceptTrusted ?? false);

  useEffect(() => {
    if (!backend.settings) return;
    setDeviceName(backend.settings.deviceName);
    setDeviceIcon(backend.settings.deviceIcon);
    setDownloadFolder(backend.settings.downloadFolder);
    setConnectionMode(backend.settings.connectionMode);
    setAutoClose(backend.settings.autoCloseAfterDownload);
    setAutoAcceptTrusted(backend.settings.autoAcceptTrusted);
  }, [backend.settings]);

  return (
    <>
      <div className="tabs">
        {(['identity', 'trusted', 'watch', 'benchmark'] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' tab--active' : ''}`} onClick={() => setTab(t)} type="button">
            {t === 'identity' ? 'Identity' : t === 'trusted' ? 'Trusted devices' : t === 'watch' ? 'Watch folders' : 'Benchmark'}
          </button>
        ))}
      </div>

      {tab === 'identity' ? (
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

            <div className="topbar__actions">
              <Button disabled={backend.busy === 'update-settings'} type="submit" variant="primary">
                {backend.busy === 'update-settings' ? 'Saving' : 'Save'}
              </Button>
            </div>
          </form>
        </section>
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

      {tab === 'benchmark' ? <BenchmarkSection backend={backend} /> : null}
    </>
  );
}

function WatchFoldersSection({ backend }: { backend: DesktopBackendState }) {
  const [folderPath, setFolderPath] = useState('');
  const [destination, setDestination] = useState(backend.knownDevices[0]?.fingerprint ?? '');
  const folders = backend.settings?.watchFolders ?? [];

  return (
    <section className="card">
      <p className="card__eyebrow">Watch folders</p>
      <h2 className="card__title">Auto-send when a phone connects</h2>
      <p className="card__copy">
        Add a folder and a destination device. When the device reconnects, anything new in the folder is sent automatically.
        <br />
        Actual filesystem watching needs a Tauri sidecar — UI is wired now so the configuration persists when that lands.
      </p>

      <div className="field">
        <span className="field__label">Source folder path</span>
        <input
          className="input"
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="~/Desktop/ToPhone"
          value={folderPath}
        />
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
          disabled={!folderPath || !destination}
          onClick={() => {
            const target = backend.knownDevices.find((d) => d.fingerprint === destination);
            if (!target) return;
            const nextFolders = [
              ...folders,
              {
                id: crypto.randomUUID(),
                path: folderPath,
                destinationFingerprint: destination,
                destinationLabel: target.name,
                fileTypes: 'all' as const,
                trigger: 'on-connect' as const,
              },
            ];
            void backend.updateSettings({ watchFolders: nextFolders });
            setFolderPath('');
          }}
          variant="primary"
        >
          Add watch folder
        </Button>
      </div>

      {folders.length ? (
        <div className="list">
          {folders.map((folder) => (
            <div className="row" key={folder.id}>
              <div className="row__copy">
                <strong>{folder.path}</strong>
                <span>
                  → {folder.destinationLabel} · {folder.trigger.replace('-', ' ')}
                </span>
              </div>
              <Button
                onClick={() =>
                  void backend.updateSettings({ watchFolders: folders.filter((f) => f.id !== folder.id) })
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">No watch folders configured.</div>
      )}
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

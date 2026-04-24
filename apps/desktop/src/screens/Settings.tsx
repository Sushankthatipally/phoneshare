import { useEffect, useState } from 'react';

import { MonitorCog } from 'lucide-react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Settings({ backend }: { backend: DesktopBackendState }) {
  const [deviceName, setDeviceName] = useState(backend.settings?.deviceName ?? 'DropBeam Desktop');
  const [deviceIcon, setDeviceIcon] = useState(backend.settings?.deviceIcon ?? 'desktop');
  const [autoCloseAfterDownload, setAutoCloseAfterDownload] = useState(
    backend.settings?.autoCloseAfterDownload ?? false,
  );

  useEffect(() => {
    if (backend.settings) {
      setDeviceName(backend.settings.deviceName);
      setDeviceIcon(backend.settings.deviceIcon);
      setAutoCloseAfterDownload(backend.settings.autoCloseAfterDownload);
    }
  }, [backend.settings]);

  return (
    <section className="desktop-page">
      <div className="desktop-grid desktop-grid--hero">
        <GlassPanel className="desktop-card">
          <div className="desktop-card__header">
            <div>
              <p className="desktop-card__eyebrow">Identity</p>
              <h3>Desktop profile settings</h3>
              <p>Keep the reference shell’s compact settings layout while editing live backend preferences.</p>
            </div>
            <MonitorCog size={18} strokeWidth={1.8} />
          </div>

          <div className="desktop-stat-grid">
            <article className="desktop-stat-card">
              <span>Device name</span>
              <strong>{backend.settings?.deviceName ?? 'Loading'}</strong>
            </article>
            <article className="desktop-stat-card">
              <span>Preferred mode</span>
              <strong>{backend.settings?.preferredMode ?? 'wifi'}</strong>
            </article>
            <article className="desktop-stat-card">
              <span>Device icon</span>
              <strong>{iconLabel(deviceIcon)}</strong>
            </article>
            <article className="desktop-stat-card">
              <span>Handshake</span>
              <strong>Automatic</strong>
            </article>
            <article className="desktop-stat-card">
              <span>Auto-close</span>
              <strong>{autoCloseAfterDownload ? 'Enabled' : 'Disabled'}</strong>
            </article>
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-card">
          <div className="desktop-card__header">
            <div>
              <p className="desktop-card__eyebrow">Live state</p>
              <h3>Current backend configuration</h3>
              <p>These values come from the backend dashboard and update after you save the form.</p>
            </div>
            <Badge tone="blue">{backend.settings?.updatedAt ?? 'No save yet'}</Badge>
          </div>

          <div className="desktop-spec-grid">
            <article>
              <span>Sessions</span>
              <strong>{backend.health?.sessions ?? 0}</strong>
            </article>
            <article>
              <span>Paired</span>
              <strong>{backend.health?.pairedSessions ?? 0}</strong>
            </article>
            <article>
              <span>Transferring</span>
              <strong>{backend.health?.transferringSessions ?? 0}</strong>
            </article>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="desktop-card">
        <div className="desktop-card__header">
          <div>
            <p className="desktop-card__eyebrow">Edit preferences</p>
            <h3>Update new-session defaults</h3>
            <p>These values are applied the next time the desktop creates a live session.</p>
          </div>
        </div>

        <form
          className="desktop-form"
          onSubmit={(event) => {
            event.preventDefault();
            void backend.updateSettings({
              deviceName,
              deviceIcon,
              preferredMode: backend.settings?.preferredMode ?? 'wifi',
              autoCloseAfterDownload,
            });
          }}
        >
          <label className="desktop-form-field">
            <span>Desktop name</span>
            <input
              className="desktop-input"
              onChange={(event) => setDeviceName(event.target.value)}
              value={deviceName}
            />
          </label>

          <label className="desktop-form-field">
            <span>Device icon</span>
            <select
              className="desktop-input"
              onChange={(event) =>
                setDeviceIcon(event.target.value as 'desktop' | 'laptop' | 'phone' | 'tablet')
              }
              value={deviceIcon}
            >
              <option value="desktop">Desktop tower</option>
              <option value="laptop">Laptop</option>
              <option value="phone">Phone</option>
              <option value="tablet">Tablet</option>
            </select>
          </label>

          <label className="desktop-checkbox">
            <input
              checked={autoCloseAfterDownload}
              onChange={(event) => setAutoCloseAfterDownload(event.target.checked)}
              type="checkbox"
            />
            <span>Close sessions automatically after the final download</span>
          </label>

          <div className="desktop-inline-actions">
            <Badge tone="blue">{backend.settings?.updatedAt ?? 'No settings saved yet'}</Badge>
            <Button disabled={backend.busy === 'update-settings'} type="submit">
              {backend.busy === 'update-settings' ? 'Saving' : 'Save settings'}
            </Button>
          </div>
        </form>
      </GlassPanel>
    </section>
  );
}

function iconLabel(value: string) {
  switch (value) {
    case 'laptop':
      return 'Laptop';
    case 'phone':
      return 'Phone';
    case 'tablet':
      return 'Tablet';
    default:
      return 'Desktop tower';
  }
}

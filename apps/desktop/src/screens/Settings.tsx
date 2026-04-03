import { useEffect, useState } from 'react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';

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
    <div className="desktop-screen">
      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Settings"
          title="Local backend preferences"
          description="Update the desktop identity and session defaults used across the live stack."
        />

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Preferred mode</span>
            <strong>{backend.settings?.preferredMode ?? 'wifi'}</strong>
            <p>New sessions inherit this mode preference.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Device icon</span>
            <strong>{iconLabel(deviceIcon)}</strong>
            <p>Shared with new sessions so phones can identify this desktop quickly.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Auto-close</span>
            <strong>{autoCloseAfterDownload ? 'Enabled' : 'Disabled'}</strong>
            <p>Completed sessions can close themselves after the last download finishes.</p>
          </article>
        </div>

        <form
          className="desktop-settings-form"
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
          <label className="desktop-field">
            <span>Desktop name</span>
            <input onChange={(event) => setDeviceName(event.target.value)} value={deviceName} />
          </label>

          <label className="desktop-field">
            <span>Device icon</span>
            <select
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

          <label className="desktop-field__checkbox">
            <input
              checked={autoCloseAfterDownload}
              onChange={(event) => setAutoCloseAfterDownload(event.target.checked)}
              type="checkbox"
            />
            <span>Close sessions automatically after the final download</span>
          </label>

          <div className="desktop-actions">
            <Badge tone="blue">{backend.settings?.updatedAt ?? 'No settings saved yet'}</Badge>
            <Button disabled={backend.busy === 'update-settings'} type="submit">
              {backend.busy === 'update-settings' ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </form>
      </GlassPanel>
    </div>
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

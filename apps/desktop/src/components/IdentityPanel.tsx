import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';
import { QuickSaveToggle, type QuickSaveValue } from './QuickSaveToggle.js';

interface IdentityPanelProps {
  backend: DesktopBackendState;
}

export function IdentityPanel({ backend }: IdentityPanelProps) {
  const settings = backend.settings;
  const friendlyName = (settings?.friendlyName as string | undefined) ?? settings?.deviceName ?? 'DropBeam Desktop';
  const hashtag = (settings?.hashtag as string | undefined) ?? '';
  const quickSave = ((settings?.quickSave as QuickSaveValue | undefined) ?? 'off') as QuickSaveValue;

  return (
    <section className="card">
      <p className="card__eyebrow">This device</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div
          aria-hidden
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            border: '1px solid var(--db-panel-border)',
            background: 'var(--db-panel-bg)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 48,
          }}
        >
          📡
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-title)', fontWeight: 600, letterSpacing: '-0.01em' }}>
            {friendlyName}
          </h2>
          {hashtag ? (
            <span style={{ color: 'var(--db-text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
              {hashtag}
            </span>
          ) : null}
        </div>
        <div style={{ marginLeft: 'auto', display: 'grid', gap: 8, justifyItems: 'end' }}>
          <span
            style={{
              fontSize: 'var(--font-size-caption)',
              fontWeight: 600,
              color: 'var(--db-text-soft)',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Quick Save
          </span>
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

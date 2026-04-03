import { Badge, GlassPanel } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { PhoneBackendState } from '../services/usePhoneBackend.js';

export function ReceiveScreen({ backend }: { backend: PhoneBackendState }) {
  const files = backend.activeSession?.files['desktop-to-phone'] ?? [];
  const activeUploads = backend.activeUploads.filter(
    (upload) => upload.sessionId === backend.activeSession?.id && upload.direction === 'desktop-to-phone',
  );

  return (
    <section className="phone-screen">
      <GlassPanel className="phone-panel phone-panel--spotlight">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Receive</p>
            <h2>Desktop files ready for this phone</h2>
            <p className="phone-panel__copy">
              These rows are backed by real files stored in the local backend.
            </p>
          </div>
          <Badge tone="green">{files.length ? `${files.length} files` : 'waiting'}</Badge>
        </div>

        <div className="phone-metric-grid">
          <article className="phone-metric-card">
            <span>Desktop</span>
            <strong>{backend.activeSession?.localDevice.name ?? 'Not selected'}</strong>
            <p>Choose and pair a session before downloading files.</p>
          </article>
          <article className="phone-metric-card">
            <span>Queue</span>
            <strong>{activeUploads.length || files.length}</strong>
            <p>Desktop uploads stream into this queue and update live as chunks arrive.</p>
          </article>
          <article className="phone-metric-card">
            <span>Bytes ready</span>
            <strong>{formatBytes(files.reduce((total, file) => total + file.size, 0))}</strong>
            <p>Download links stream the real stored content.</p>
          </article>
        </div>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Queue</p>
            <h3>Incoming files</h3>
            <p>Tap download to save each file from the local backend.</p>
          </div>
        </div>

        {activeUploads.length ? (
          <div className="phone-upload-list">
            {activeUploads.map((upload) => (
              <article className="phone-upload-card" key={upload.id}>
                <div className="phone-upload-card__header">
                  <strong>{upload.name}</strong>
                  <Badge tone="blue">{upload.progressPercent}%</Badge>
                </div>
                <div className="phone-upload-bar">
                  <div className="phone-upload-fill" style={{ width: `${upload.progressPercent}%` }} />
                </div>
                <p>{formatBytes(upload.uploadedBytes)} / {formatBytes(upload.size)}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="phone-file-list">
          {files.length ? (
            files.map((file) => (
              <article className="phone-file-card" key={file.id}>
                <div>
                  <strong>{file.name}</strong>
                  <p>
                    {formatBytes(file.size)} - {file.relativePath && file.relativePath !== file.name ? 'folder structure preserved' : file.mimeType}
                  </p>
                </div>
                <a className="phone-link-button" href={backend.downloadUrl(file.id)}>
                  Download
                </a>
              </article>
            ))
          ) : (
            <div className="phone-empty-state">
              <p>No desktop files are waiting for this phone yet.</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </section>
  );
}

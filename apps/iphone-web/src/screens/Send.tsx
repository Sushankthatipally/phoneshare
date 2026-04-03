import { useRef } from 'react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { PhoneBackendState } from '../services/usePhoneBackend.js';

export function SendScreen({ backend }: { backend: PhoneBackendState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const files = backend.activeSession?.files['phone-to-desktop'] ?? [];
  const activeUploads = backend.activeUploads.filter(
    (upload) => upload.sessionId === backend.activeSession?.id && upload.direction === 'phone-to-desktop',
  );

  return (
    <section className="phone-screen">
      <GlassPanel className="phone-panel phone-panel--spotlight">
        <p className="phone-panel__eyebrow">Send</p>
        <h2>Upload real phone files to the desktop</h2>
        <p className="phone-panel__copy">
          Files chosen here are written into the live backend and become downloadable from the desktop receive screen.
        </p>

        <div className="phone-metric-grid">
          <article className="phone-metric-card">
            <span>Desktop peer</span>
            <strong>{backend.activeSession?.localDevice.name ?? 'Not paired'}</strong>
            <p>Pair the phone before uploading files.</p>
          </article>
          <article className="phone-metric-card">
            <span>Queue</span>
            <strong>{activeUploads.length || files.length}</strong>
            <p>Phone-to-desktop uploads report their live chunk progress here.</p>
          </article>
          <article className="phone-metric-card">
            <span>Bytes queued</span>
            <strong>{formatBytes(files.reduce((total, file) => total + file.size, 0))}</strong>
            <p>Actual stored bytes tracked by the backend.</p>
          </article>
        </div>

        <div className="phone-button-grid">
          <input
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files?.length) {
                void backend.uploadFiles(event.target.files);
                event.target.value = '';
              }
            }}
            ref={inputRef}
            type="file"
          />
          <Button
            className="phone-action-button"
            disabled={!backend.activeSession?.pairing.verifiedAt || backend.busy === 'upload-files'}
            onClick={() => inputRef.current?.click()}
          >
            {backend.busy === 'upload-files' ? 'Uploading...' : 'Choose files'}
          </Button>
          <Badge tone="blue">{backend.activeSession?.pairing.verifiedAt ? 'paired and ready' : 'pair first'}</Badge>
        </div>
      </GlassPanel>

      <GlassPanel className="phone-panel">
        <div className="phone-panel__header">
          <div>
            <p className="phone-panel__eyebrow">Outbound queue</p>
            <h3>Phone uploads</h3>
            <p>Uploaded files stay available to the desktop through the local backend.</p>
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
                <Badge tone={file.downloadedAt ? 'green' : 'blue'}>
                  {file.downloadedAt ? 'downloaded on desktop' : file.status}
                </Badge>
              </article>
            ))
          ) : (
            <div className="phone-empty-state">
              <p>No phone files have been uploaded to the desktop yet.</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </section>
  );
}

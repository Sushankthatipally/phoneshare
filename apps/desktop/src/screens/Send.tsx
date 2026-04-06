import { useEffect, useRef } from 'react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Send({ backend }: { backend: DesktopBackendState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const files = backend.activeSession?.files['desktop-to-phone'] ?? [];

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  return (
    <div className="desktop-screen">
      <div className="desktop-send-layout">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Send"
            title="Choose files or a folder"
            description="Everything selected here is uploaded to the live backend and becomes immediately visible on the phone receive lane."
          />

          <div className="desktop-security-strip">
            <Badge tone={backend.activeSession?.pairing.verifiedAt ? 'green' : 'amber'}>
              {backend.activeSession?.pairing.verifiedAt ? 'paired' : 'pair first'}
            </Badge>
            <Badge tone="blue">{backend.activeSession?.mode ?? backend.settings?.preferredMode ?? 'wifi'}</Badge>
            <Badge>{files.length} queued</Badge>
          </div>

          <button className="desktop-drop-zone" onClick={() => inputRef.current?.click()} type="button">
            <strong>Drop or choose desktop files</strong>
            <p>Use the file picker for individual files, or choose a folder to preserve relative paths across the transfer.</p>
          </button>

          <div className="desktop-actions">
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
            <input
              hidden
              multiple
              onChange={(event) => {
                if (event.target.files?.length) {
                  void backend.uploadFiles(event.target.files);
                  event.target.value = '';
                }
              }}
              ref={folderInputRef}
              type="file"
            />
            <Button
              disabled={!backend.activeSession?.pairing.verifiedAt || backend.busy === 'upload-files'}
              onClick={() => inputRef.current?.click()}
            >
              {backend.busy === 'upload-files' ? 'Uploading' : 'Choose files'}
            </Button>
            <Button
              disabled={!backend.activeSession?.pairing.verifiedAt || backend.busy === 'upload-files'}
              onClick={() => folderInputRef.current?.click()}
              variant="secondary"
            >
              Choose folder
            </Button>
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Session"
            title="Delivery state"
            description="The send lane is enabled only after the phone verifies the PIN."
          />

          <div className="desktop-metric-grid">
            <article className="desktop-mode-tile">
              <span>Phone peer</span>
              <strong>{backend.activeSession?.peerDevice?.name ?? 'Not connected'}</strong>
              <p>Pair a phone before starting a live upload.</p>
            </article>
            <article className="desktop-mode-tile">
              <span>Folders preserved</span>
              <strong>{files.filter((file) => file.relativePath && file.relativePath !== file.name).length}</strong>
              <p>Relative paths are stored in the backend for directory rebuilds.</p>
            </article>
            <article className="desktop-mode-tile">
              <span>PIN</span>
              <strong>{backend.activeSession?.pairing.pin ?? 'Not created'}</strong>
              <p>The phone must verify against this session PIN.</p>
            </article>
            <article className="desktop-mode-tile">
              <span>Total bytes</span>
              <strong>{formatBytes(files.reduce((total, file) => total + file.size, 0))}</strong>
              <p>Real stored bytes already accepted by the backend.</p>
            </article>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Queue"
          title={files.length ? 'Desktop uploads' : 'No desktop uploads yet'}
          description="Queued files below already exist in the live backend and remain available until the desktop session is closed."
        />

        {files.length ? (
          <div className="desktop-file-table">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Delivery</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="desktop-file-table__name">
                        <strong>{file.name}</strong>
                        <span>
                          {file.relativePath && file.relativePath !== file.name
                            ? 'Folder structure preserved'
                            : file.mimeType}
                        </span>
                      </div>
                    </td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{file.downloadedAt ? 'Downloaded on phone' : 'Ready on phone'}</td>
                    <td>{file.downloadedAt ? 'downloaded' : file.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desktop-empty-state">
            <p>No desktop files have been uploaded to the phone yet.</p>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

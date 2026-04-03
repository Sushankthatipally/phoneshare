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
      <GlassPanel className="desktop-panel-stack">
        <div className="desktop-panel-header">
          <SectionHeading
            eyebrow="Send lane"
            title="Upload real desktop files to the phone"
            description="Each chosen file is persisted by the local backend and becomes available in the iPhone receive screen."
          />
          <Badge tone={backend.activeSession?.pairing.verifiedAt ? 'green' : 'amber'}>
            {backend.activeSession?.pairing.verifiedAt ? 'paired' : 'waiting for pair'}
          </Badge>
        </div>

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Queue</span>
            <strong>{files.length}</strong>
            <p>Desktop-to-phone files and folders appear here after upload.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Pairing</span>
            <strong>{backend.activeSession?.peerDevice?.name ?? 'Not connected'}</strong>
            <p>Pair a phone before sending live files.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Folders preserved</span>
            <strong>{files.filter((file) => file.relativePath && file.relativePath !== file.name).length}</strong>
            <p>Relative paths are kept so folder structure survives the transfer.</p>
          </article>
        </div>

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
            {backend.busy === 'upload-files' ? 'Uploading...' : 'Choose desktop files'}
          </Button>
          <Button
            disabled={!backend.activeSession?.pairing.verifiedAt || backend.busy === 'upload-files'}
            onClick={() => folderInputRef.current?.click()}
            variant="secondary"
          >
            Choose folder
          </Button>
          <Badge tone="blue">{backend.activeSession ? `PIN ${backend.activeSession.pairing.pin}` : 'Create a session first'}</Badge>
        </div>

        <div className="desktop-history-list">
          {files.length ? (
            files.map((file) => (
              <article className="desktop-history-card" key={file.id}>
                <div className="desktop-history-card__copy">
                  <strong>{file.name}</strong>
                  <p>
                    {formatBytes(file.size)} - {file.relativePath && file.relativePath !== file.name ? 'folder structure preserved' : file.mimeType}
                  </p>
                </div>
                <Badge tone={file.downloadedAt ? 'green' : 'blue'}>
                  {file.downloadedAt ? 'downloaded on phone' : file.status}
                </Badge>
              </article>
            ))
          ) : (
            <div className="desktop-empty-state">
              <p>No desktop files have been uploaded to the phone yet.</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

import { Badge, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Receive({ backend }: { backend: DesktopBackendState }) {
  const files = backend.activeSession?.files['phone-to-desktop'] ?? [];
  const folderReady = files.some((file) => file.relativePath && file.relativePath !== file.name);

  return (
    <div className="desktop-screen">
      <GlassPanel className="desktop-panel-stack">
        <div className="desktop-panel-header">
          <SectionHeading
            eyebrow="Receive lane"
            title="Phone uploads land here with real download links"
            description="The iPhone send screen writes into the live backend, and the desktop can download the actual stored files here."
          />
          <Badge tone="blue">{files.length ? `${files.length} files` : 'inbox ready'}</Badge>
        </div>

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Delivery</span>
            <strong>Live download</strong>
            <p>Incoming files are available immediately through the local transfer service.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Transfers</span>
            <strong>{files.length}</strong>
            <p>Phone-to-desktop items appear as soon as the phone uploads them.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Folders preserved</span>
            <strong>{folderReady ? 'Yes' : 'Flat files'}</strong>
            <p>Use save-all to rebuild nested folders when the sender uploaded a directory.</p>
          </article>
        </div>

        <div className="desktop-actions">
          <Badge tone="blue">
            {folderReady ? 'Folder-aware transfer metadata available' : 'Standard file download mode'}
          </Badge>
          <button
            className="desktop-link-button"
            disabled={!files.length}
            onClick={() => void saveFilesToDirectory(files, backend.downloadUrl)}
            type="button"
          >
            Save all to folder
          </button>
        </div>

        <div className="desktop-history-list">
          {files.length ? (
            files.map((file) => (
              <article className="desktop-history-card" key={file.id}>
                <div className="desktop-history-card__copy">
                  <strong>{file.name}</strong>
                  <p>
                    {formatBytes(file.size)} - {file.sourceDeviceName ?? 'Phone'} - {file.relativePath && file.relativePath !== file.name ? 'folder structure preserved' : 'single file'}
                  </p>
                </div>
                <a className="desktop-link-button" href={backend.downloadUrl(file.id)}>
                  Download
                </a>
              </article>
            ))
          ) : (
            <div className="desktop-empty-state">
              <p>No phone uploads are available yet.</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

async function saveFilesToDirectory(
  files: Array<{ id: string; name: string; relativePath?: string | null }>,
  resolveDownloadUrl: (fileId: string) => string,
) {
  const directoryWindow = window as Window & typeof globalThis & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };

  if (typeof window === 'undefined' || typeof directoryWindow.showDirectoryPicker !== 'function') {
    window.alert('Directory save is only available in compatible Chromium-based desktop browsers.');
    return;
  }

  const root = await directoryWindow.showDirectoryPicker();

  for (const file of files) {
    const relativePath = file.relativePath ?? file.name;
    const parts = relativePath.split('/').filter(Boolean);
    const leafName = parts.pop() ?? file.name;
    let directory = root;

    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }

    const response = await fetch(resolveDownloadUrl(file.id));
    if (!response.ok) {
      throw new Error(`Failed to download ${file.name}`);
    }

    const handle = await directory.getFileHandle(leafName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(await response.blob());
    await writable.close();
  }
}

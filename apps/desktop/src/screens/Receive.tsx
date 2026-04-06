import { Badge, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Receive({ backend }: { backend: DesktopBackendState }) {
  const files = backend.activeSession?.files['phone-to-desktop'] ?? [];
  const folderReady = files.some((file) => file.relativePath && file.relativePath !== file.name);

  return (
    <div className="desktop-screen">
      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Receive"
          title="Phone uploads waiting on desktop"
          description="These files are stored in the live backend. Download individual files or rebuild the original directory structure with save-all."
        />

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Delivery</span>
            <strong>Live download</strong>
            <p>Files are immediately downloadable through the backend once uploaded.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Queue</span>
            <strong>{files.length}</strong>
            <p>Phone-to-desktop items appear here as soon as the phone uploads them.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Folders preserved</span>
            <strong>{folderReady ? 'Yes' : 'Flat files'}</strong>
            <p>Use save-all to recreate nested folders when a directory was uploaded.</p>
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

        {files.length ? (
          <div className="desktop-file-table">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Source</th>
                  <th>Mode</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="desktop-file-table__name">
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size)}</span>
                      </div>
                    </td>
                    <td>{file.sourceDeviceName ?? 'Phone'}</td>
                    <td>
                      {file.relativePath && file.relativePath !== file.name ? 'Folder preserved' : 'Single file'}
                    </td>
                    <td>
                      <a className="desktop-link-button" href={backend.downloadUrl(file.id)}>
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desktop-empty-state">
            <p>No phone uploads are available yet.</p>
          </div>
        )}
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

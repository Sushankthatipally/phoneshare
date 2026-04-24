import { useEffect, useMemo, useState } from 'react';

import { Badge, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function History({ backend }: { backend: DesktopBackendState }) {
  const [query, setQuery] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return backend.history;
    }

    return backend.history.filter((entry) =>
      [
        entry.id,
        entry.peerDevice?.name,
        entry.peerDevice?.platform,
        entry.localDevice.name,
        entry.mode,
        entry.state,
        ...entry.files.flatMap((file) => [file.name, file.relativePath, file.sourceDeviceName]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [backend.history, query]);

  useEffect(() => {
    setSelectedHistoryId((current) => {
      if (current && filteredHistory.some((entry) => entry.id === current)) {
        return current;
      }

      return filteredHistory[0]?.id ?? null;
    });
  }, [filteredHistory]);

  const selectedEntry = filteredHistory.find((entry) => entry.id === selectedHistoryId) ?? filteredHistory[0] ?? null;

  return (
    <div className="desktop-screen">
      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="History"
          title="Completed and closed sessions"
          description="This table is fed by the persisted backend history. There is no mock transfer data in this view."
        />

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Sessions</span>
            <strong>{backend.history.length}</strong>
            <p>Every closed or completed session remains searchable.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Last session</span>
            <strong>{backend.history[0]?.id.slice(0, 8) ?? 'None'}</strong>
            <p>The most recent history item is shown first.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Bytes transferred</span>
            <strong>{formatBytes(backend.history.reduce((total, entry) => total + entry.summary.totalBytes, 0))}</strong>
            <p>Totals are computed from persisted backend summaries.</p>
          </article>
        </div>

        <label className="desktop-field">
          <span>Search history</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by device, platform, mode, or session id"
            value={query}
          />
        </label>

        {filteredHistory.length ? (
          <div className="desktop-file-table">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Peer</th>
                  <th>Mode</th>
                  <th>Files</th>
                  <th>Bytes</th>
                  <th>Status</th>
                  <th>Closed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <div className="desktop-file-table__name">
                        <strong>{entry.id.slice(0, 8)}</strong>
                        <span>{entry.summary.totalFiles} files</span>
                      </div>
                    </td>
                    <td>{entry.peerDevice?.name ?? 'Unpaired phone session'}</td>
                    <td>{entry.mode}</td>
                    <td>
                      <div className="desktop-history-files">
                        {entry.files.length ? (
                          entry.files.slice(0, 3).map((file) => (
                            <a className="desktop-link-button desktop-link-button--inline" href={backend.downloadUrl(file.id)} key={file.id}>
                              {file.name}
                            </a>
                          ))
                        ) : (
                          <span className="desktop-history-card__meta">No files</span>
                        )}
                        {entry.files.length > 3 ? (
                          <span className="desktop-history-card__meta">+{entry.files.length - 3} more</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatBytes(entry.summary.totalBytes)}</td>
                    <td>{entry.state}</td>
                    <td>{entry.closedAt ?? entry.updatedAt}</td>
                    <td>
                      <button
                        className="desktop-link-button desktop-link-button--inline"
                        onClick={() => setSelectedHistoryId(entry.id)}
                        type="button"
                      >
                        {selectedHistoryId === entry.id ? 'Selected' : 'View all'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desktop-empty-state">
            <p>{backend.history.length ? 'No sessions matched that search.' : 'No closed sessions have been persisted yet.'}</p>
          </div>
        )}

        {selectedEntry ? (
          <div className="desktop-panel-stack">
            <SectionHeading
              eyebrow="Re-download"
              title={`Files from session ${selectedEntry.id.slice(0, 8)}`}
              description="Choose any stored file below to download it again from the persisted session history."
            />

            <div className="desktop-summary-strip">
              <article className="desktop-summary-card">
                <span>Peer</span>
                <strong>{selectedEntry.peerDevice?.name ?? 'Unpaired phone session'}</strong>
                <p>{selectedEntry.peerDevice?.platform ?? 'phone'} - {selectedEntry.mode}</p>
              </article>
              <article className="desktop-summary-card">
                <span>Files</span>
                <strong>{selectedEntry.fileCount}</strong>
                <p>{selectedEntry.closedAt ?? selectedEntry.updatedAt}</p>
              </article>
              <article className="desktop-summary-card">
                <span>State</span>
                <strong>{selectedEntry.state}</strong>
                <p>{formatBytes(selectedEntry.summary.totalBytes)} stored in this session.</p>
              </article>
            </div>

            <div className="desktop-history-files">
              {selectedEntry.files.length ? (
                selectedEntry.files.map((file) => (
                  <article className="desktop-history-card" key={file.id}>
                    <div className="desktop-history-card__copy">
                      <strong>{file.name}</strong>
                      <p>
                        {formatBytes(file.size)} - {file.relativePath && file.relativePath !== file.name ? file.relativePath : file.mimeType}
                      </p>
                    </div>
                    <div className="desktop-chip-row">
                      <Badge tone={file.downloadedAt ? 'green' : 'blue'}>{file.status}</Badge>
                      <a className="desktop-link-button desktop-link-button--inline" href={backend.downloadUrl(file.id)}>
                        Download
                      </a>
                    </div>
                  </article>
                ))
              ) : (
                <div className="desktop-empty-state">
                  <p>No files were persisted for this session.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}

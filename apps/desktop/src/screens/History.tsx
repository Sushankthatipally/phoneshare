import { useMemo, useState } from 'react';

import { GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function History({ backend }: { backend: DesktopBackendState }) {
  const [query, setQuery] = useState('');

  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return backend.history;
    }

    return backend.history.filter((entry) =>
      [entry.id, entry.peerDevice?.name, entry.peerDevice?.platform, entry.localDevice.name, entry.mode, entry.state]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [backend.history, query]);

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
                  <th>Bytes</th>
                  <th>Status</th>
                  <th>Closed</th>
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
                    <td>{formatBytes(entry.summary.totalBytes)}</td>
                    <td>{entry.state}</td>
                    <td>{entry.closedAt ?? entry.updatedAt}</td>
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
      </GlassPanel>
    </div>
  );
}

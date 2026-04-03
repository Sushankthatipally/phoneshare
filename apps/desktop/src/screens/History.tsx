import { useMemo, useState } from 'react';

import { Badge, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
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
      [
        entry.id,
        entry.peerDevice?.name,
        entry.peerDevice?.platform,
        entry.localDevice.name,
      ]
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
          description="The backend keeps real session history and total file counts here."
        />

        <div className="desktop-summary-strip">
          <article className="desktop-summary-card">
            <span>Sessions</span>
            <strong>{backend.history.length}</strong>
            <p>Closed sessions stay available after the live run ends.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Last session</span>
            <strong>{backend.history[0]?.id.slice(0, 8) ?? 'None yet'}</strong>
            <p>The latest completed or closed session is shown first.</p>
          </article>
          <article className="desktop-summary-card">
            <span>Bytes in history</span>
            <strong>{formatBytes(backend.history.reduce((total, entry) => total + entry.summary.totalBytes, 0))}</strong>
            <p>Totals come from the persisted backend summaries.</p>
          </article>
        </div>

        <label className="desktop-field">
          <span>Search history</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by device name, platform, or session id"
            value={query}
          />
        </label>

        <div className="desktop-history-list">
          {filteredHistory.length ? (
            filteredHistory.map((entry) => (
              <article className="desktop-history-card desktop-history-card--large" key={entry.id}>
                <div className="desktop-panel-header">
                  <div className="desktop-history-card__copy">
                    <strong>{entry.peerDevice?.name ?? 'Unpaired phone session'}</strong>
                    <p>
                      {entry.summary.totalFiles} files - {formatBytes(entry.summary.totalBytes)} - closed {entry.closedAt ?? entry.updatedAt}
                    </p>
                  </div>
                  <Badge tone="blue">{entry.state}</Badge>
                </div>
              </article>
            ))
          ) : (
            <div className="desktop-empty-state">
              <p>{backend.history.length ? 'No sessions matched that search.' : 'No closed sessions have been persisted yet.'}</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

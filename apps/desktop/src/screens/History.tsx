import { useMemo, useState } from 'react';

import { Badge, Button } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function History({ backend }: { backend: DesktopBackendState }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return backend.history;
    return backend.history.filter((entry) =>
      [entry.id, entry.peerDevice?.name, entry.mode, entry.state, ...entry.files.map((f) => f.name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [backend.history, query]);

  const selectedEntry = filtered.find((entry) => entry.id === selectedId) ?? null;

  return (
    <>
      <section className="card">
        <p className="card__eyebrow">History</p>
        <h2 className="card__title">Past sessions</h2>

        <div className="field">
          <input
            className="input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by peer, mode, or file"
            value={query}
          />
        </div>

        {filtered.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Peer</th>
                <th>Mode</th>
                <th>Files</th>
                <th>Bytes</th>
                <th>State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.id.slice(0, 8)}</td>
                  <td>{entry.peerDevice?.name ?? '—'}</td>
                  <td>{entry.mode}</td>
                  <td>{entry.fileCount}</td>
                  <td>{formatBytes(entry.summary.totalBytes)}</td>
                  <td>
                    <Badge tone={entry.state === 'failed' ? 'amber' : entry.state === 'completed' ? 'green' : 'blue'}>
                      {entry.state}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="link"
                      onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
                      type="button"
                    >
                      {entry.id === selectedId ? 'Hide' : 'View files'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{backend.history.length ? 'No match.' : 'No closed sessions yet.'}</div>
        )}
      </section>

      {selectedEntry ? (
        <section className="card">
          <p className="card__eyebrow">Session {selectedEntry.id.slice(0, 8)}</p>
          <h2 className="card__title">
            {selectedEntry.files.length} stored file{selectedEntry.files.length === 1 ? '' : 's'}
          </h2>
          {selectedEntry.files.length ? (
            <div className="list">
              {selectedEntry.files.map((file) => (
                <div className="row" key={file.id}>
                  <div className="row__copy">
                    <strong>{file.name}</strong>
                    <span>
                      {formatBytes(file.size)} · {file.direction} · {file.status}
                      {file.relativePath && file.relativePath !== file.name ? ` · ${file.relativePath}` : ''}
                    </span>
                  </div>
                  <div className="topbar__actions">
                    <a className="link" href={backend.downloadUrl(file.id)}>
                      {file.downloadedAt ? 'Re-download' : 'Download'}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No files persisted for this session.</div>
          )}
          {selectedEntry.state === 'failed' ? (
            <div className="topbar__actions">
              <Button variant="secondary" onClick={() => void backend.refresh()}>
                Retry transfer (re-pair to continue)
              </Button>
              <Button variant="ghost" onClick={() => setSelectedId(null)}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

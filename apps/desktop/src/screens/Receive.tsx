import { useState } from 'react';

import { Badge, Button } from '@dropbeam/shared-ui';
import { formatBytes, resolveBackendOrigin } from '@dropbeam/protocol';

import { Modal } from '../components/Modal.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

const BACKEND_ORIGIN = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);

export function Receive({ backend }: { backend: DesktopBackendState }) {
  const [acceptSomeBatchId, setAcceptSomeBatchId] = useState<string | null>(null);
  const [pickedFileIds, setPickedFileIds] = useState<Set<string>>(new Set());

  const incomingBatches = backend.sessions.flatMap((session) =>
    (session.pendingTransfers ?? []).map((batch) => ({ session, batch })),
  );

  if (!backend.activeSession && !incomingBatches.length) {
    return (
      <section className="card">
        <p className="card__eyebrow">No active session</p>
        <h2 className="card__title">Start a session to receive files</h2>
        <p className="card__copy">Open Home and create a new session so your phone can connect.</p>
      </section>
    );
  }

  const receivedFiles = backend.sessions.flatMap((s) => s.files['phone-to-desktop'] ?? []);
  const acceptSomeBatch = incomingBatches.find((b) => b.batch.id === acceptSomeBatchId);

  return (
    <>
      {incomingBatches.length ? (
        <section className="card">
          <p className="card__eyebrow">Incoming requests</p>
          <h2 className="card__title">{incomingBatches.length} pending</h2>
          <div className="list">
            {incomingBatches.map(({ session, batch }) => {
              const totalBytes = batch.files.reduce((s, f) => s + f.size, 0);
              return (
                <div className="row" key={batch.id} style={{ gridTemplateColumns: '1fr' }}>
                  <div className="row__copy">
                    <strong>
                      {batch.sourceDeviceName ?? session.peerDevice?.name ?? 'Phone'} wants to send {batch.files.length} file
                      {batch.files.length === 1 ? '' : 's'}
                    </strong>
                    <span>{formatBytes(totalBytes)} · {batch.direction}</span>
                  </div>
                  <div className="topbar__actions">
                    <Button onClick={() => void acceptBatch(session.id, batch.id, null)} variant="primary">
                      Accept All
                    </Button>
                    <Button
                      onClick={() => {
                        setAcceptSomeBatchId(batch.id);
                        setPickedFileIds(new Set(batch.files.map((f) => f.id)));
                      }}
                      variant="secondary"
                    >
                      Accept Some
                    </Button>
                    <Button onClick={() => void declineBatch(session.id, batch.id)} variant="ghost">
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="card">
        <p className="card__eyebrow">From your phone</p>
        <h2 className="card__title">
          {receivedFiles.length ? `${receivedFiles.length} file${receivedFiles.length === 1 ? '' : 's'} ready` : 'Waiting for uploads'}
        </h2>

        {receivedFiles.length ? (
          <div className="list">
            {receivedFiles.map((file) => (
              <div className="row" key={file.id}>
                <div className="row__copy">
                  <strong>{file.name}</strong>
                  <span>
                    {formatBytes(file.size)} · {file.sourceDeviceName ?? 'Phone'}
                    {file.relativePath && file.relativePath !== file.name ? ` · ${file.relativePath}` : ''}
                  </span>
                </div>
                <a className="link" href={backend.downloadUrl(file.id)}>
                  Download
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Files your phone uploads will appear here as soon as you tap Accept on its prompt.</div>
        )}
      </section>

      {acceptSomeBatch ? (
        <Modal onClose={() => setAcceptSomeBatchId(null)}>
          <div className="modal__header">
            <span className="modal__step">Accept some</span>
            <h2 className="modal__title">Pick the files you want</h2>
          </div>
          <div className="list">
            {acceptSomeBatch.batch.files.map((file) => {
              const picked = pickedFileIds.has(file.id);
              return (
                <label
                  className={`row row--selectable${picked ? ' row--selected' : ''}`}
                  key={file.id}
                >
                  <div className="row__copy">
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)} · {file.mimeType}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={(event) => {
                      const next = new Set(pickedFileIds);
                      if (event.target.checked) next.add(file.id);
                      else next.delete(file.id);
                      setPickedFileIds(next);
                    }}
                    style={{ width: 18, height: 18 }}
                  />
                </label>
              );
            })}
          </div>
          <div className="modal__actions">
            <Button onClick={() => setAcceptSomeBatchId(null)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!pickedFileIds.size}
              onClick={() => void acceptBatch(acceptSomeBatch.session.id, acceptSomeBatch.batch.id, [...pickedFileIds])}
              variant="primary"
            >
              Accept {pickedFileIds.size} of {acceptSomeBatch.batch.files.length}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );

  async function acceptBatch(sessionId: string, batchId: string, fileIds: string[] | null) {
    const url = `${BACKEND_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(batchId)}/accept`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fileIds ? { fileIds } : {}),
    });
    setAcceptSomeBatchId(null);
    await backend.refresh();
  }

  async function declineBatch(sessionId: string, batchId: string) {
    const url = `${BACKEND_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/transfers/${encodeURIComponent(batchId)}/decline`;
    await fetch(url, { method: 'POST' });
    await backend.refresh();
  }
}


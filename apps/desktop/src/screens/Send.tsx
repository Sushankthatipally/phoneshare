import { useEffect, useMemo, useRef, useState } from 'react';

import JSZip from 'jszip';

import { Badge, Button } from '@dropbeam/shared-ui';
import { formatBytes, resolveBackendOrigin } from '@dropbeam/protocol';

import { Modal } from '../components/Modal.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

type PeerStorageState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; freeBytes: number; totalBytes: number; reportedAt: string }
  | { status: 'unknown' };

type SendTargetState = {
  message: string;
  progress: number;
  status: 'idle' | 'uploading' | 'complete' | 'failed';
  failedFiles: string[];
};

type FolderMode = 'preserve' | 'zip' | 'flat';

const LARGE_FILE_THRESHOLD = 4 * 1024 * 1024 * 1024;

export function Send({
  backend,
  pendingSendPaths = [],
  onClearPending,
}: {
  backend: DesktopBackendState;
  pendingSendPaths?: string[];
  onClearPending?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [targetState, setTargetState] = useState<Record<string, SendTargetState>>({});
  const [sending, setSending] = useState(false);
  const [folderPrompt, setFolderPrompt] = useState<File[] | null>(null);
  const [folderMode, setFolderMode] = useState<FolderMode>('preserve');
  const [folderZipping, setFolderZipping] = useState(false);
  const [largeFilePrompt, setLargeFilePrompt] = useState(false);
  const [sendToSelf, setSendToSelf] = useState(false);
  const [peerStorage, setPeerStorage] = useState<PeerStorageState>({ status: 'idle' });

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const verifiedSessions = useMemo(
    () => backend.sessions.filter((session) => session.pairing.verifiedAt),
    [backend.sessions],
  );

  const queuedBytes = useMemo(
    () => queuedFiles.reduce((total, file) => total + file.size, 0),
    [queuedFiles],
  );

  const hasLargeFile = queuedFiles.some((f) => f.size >= LARGE_FILE_THRESHOLD);

  useEffect(() => {
    setSelectedSessionIds((current) => current.filter((id) => verifiedSessions.some((s) => s.id === id)));
  }, [verifiedSessions]);

  const targetPeer = useMemo(() => {
    const chosen = verifiedSessions.find((s) => selectedSessionIds.includes(s.id)) ?? verifiedSessions[0];
    if (!chosen) return null;
    const fingerprint = chosen.peerDevice?.fingerprint ?? null;
    return {
      name: chosen.peerDevice?.name ?? 'paired device',
      fingerprint,
    };
  }, [verifiedSessions, selectedSessionIds]);

  useEffect(() => {
    if (!largeFilePrompt) return;
    if (!targetPeer?.fingerprint) {
      setPeerStorage({ status: 'unknown' });
      return;
    }
    let cancelled = false;
    setPeerStorage({ status: 'checking' });
    void backend.peerStorage(targetPeer.fingerprint).then((response) => {
      if (cancelled) return;
      if (response.ok) {
        setPeerStorage({
          status: 'ok',
          freeBytes: response.report.freeBytes,
          totalBytes: response.report.totalBytes,
          reportedAt: response.report.reportedAt,
        });
      } else {
        setPeerStorage({ status: 'unknown' });
      }
    }).catch(() => {
      if (!cancelled) setPeerStorage({ status: 'unknown' });
    });
    return () => {
      cancelled = true;
    };
  }, [largeFilePrompt, targetPeer?.fingerprint, backend]);

  return (
    <>
      {pendingSendPaths.length ? (
        <section className="card">
          <p className="card__eyebrow">From Windows context menu</p>
          <h2 className="card__title">{pendingSendPaths.length} item{pendingSendPaths.length === 1 ? '' : 's'} dropped from Explorer</h2>
          <div className="list">
            {pendingSendPaths.map((path) => (
              <div className="row" key={path}>
                <div className="row__copy">
                  <strong>{path.split(/[\\/]/).pop()}</strong>
                  <span>{path}</span>
                </div>
                <Badge>Native path</Badge>
              </div>
            ))}
          </div>
          <p className="card__copy">
            These paths came from a "Send via DropBeam" right-click. To upload, drag the same files into the file picker below — the desktop's sandboxed file API requires a user gesture before it can read disk contents.
          </p>
          <div className="topbar__actions">
            <Button onClick={() => inputRef.current?.click()} variant="primary">
              Open file picker
            </Button>
            <Button onClick={() => onClearPending?.()} variant="ghost">
              Clear
            </Button>
          </div>
        </section>
      ) : null}

      {!verifiedSessions.length ? (
        <section className="card">
          <p className="card__eyebrow">No paired devices</p>
          <h2 className="card__title">Pair a phone first</h2>
          <p className="card__copy">
            Start a session on Home and tap Accept on your phone. Once paired, this screen lets you queue files, send to multiple targets, and use Guest mode for browser downloads.
          </p>
        </section>
      ) : null}

      <section className="card">
        <p className="card__eyebrow">Step 1 · Files</p>
        <div className="tile-grid">
          <button className="tile" onClick={() => inputRef.current?.click()} type="button">
            <strong>Choose files</strong>
            <span>Pick one or more files from your computer.</span>
          </button>
          <button className="tile" onClick={() => folderInputRef.current?.click()} type="button">
            <strong>Choose folder</strong>
            <span>Folder structure is preserved on the receiver.</span>
          </button>
        </div>
        <input
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) {
              setQueuedFiles(files);
              if (files.some((f) => f.size >= LARGE_FILE_THRESHOLD)) setLargeFilePrompt(true);
            }
            event.target.value = '';
          }}
          ref={inputRef}
          type="file"
        />
        <input
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) setFolderPrompt(files);
            event.target.value = '';
          }}
          ref={folderInputRef}
          type="file"
        />

        {queuedFiles.length ? (
          <div className="topbar__actions">
            <Badge>{queuedFiles.length} files · {formatBytes(queuedBytes)}</Badge>
            {hasLargeFile ? <Badge tone="amber">Large file detected</Badge> : null}
            <Button onClick={() => setQueuedFiles([])} variant="ghost">
              Clear
            </Button>
          </div>
        ) : null}
      </section>

      {verifiedSessions.length ? (
        <section className="card">
          <p className="card__eyebrow">Step 2 · Targets</p>
          <div className="list">
            {verifiedSessions.map((session) => {
              const selected = selectedSessionIds.includes(session.id);
              return (
                <button
                  className={`row row--selectable${selected ? ' row--selected' : ''}`}
                  key={session.id}
                  onClick={() => toggleSelection(session.id, setSelectedSessionIds)}
                  type="button"
                >
                  <div className="row__copy">
                    <strong>{session.peerDevice?.name ?? 'Paired device'}</strong>
                    <span>
                      {session.peerDevice?.platform ?? 'phone'} · {session.mode}
                      {session.peerDevice?.fingerprint && backend.trustedDevices.some((t) => t.fingerprint === session.peerDevice?.fingerprint)
                        ? ' · Trusted'
                        : ''}
                    </span>
                  </div>
                  <Badge tone={selected ? 'green' : 'neutral'}>{selected ? 'Selected' : 'Tap'}</Badge>
                </button>
              );
            })}
            <label className={`row row--selectable${sendToSelf ? ' row--selected' : ''}`}>
              <div className="row__copy">
                <strong>This device</strong>
                <span>Send to yourself — copies the file with checksum verification.</span>
              </div>
              <input
                checked={sendToSelf}
                onChange={(event) => setSendToSelf(event.target.checked)}
                style={{ width: 18, height: 18 }}
                type="checkbox"
              />
            </label>
          </div>
        </section>
      ) : null}

      <section className="card">
        <p className="card__eyebrow">Step 3 · Send</p>
        <div className="topbar__actions">
          <Button
            disabled={!queuedFiles.length || (!selectedSessionIds.length && !sendToSelf) || sending}
            onClick={() => void sendQueuedFiles()}
            variant="primary"
          >
            {sending
              ? 'Sending'
              : `Send to ${selectedSessionIds.length + (sendToSelf ? 1 : 0)} target${selectedSessionIds.length + (sendToSelf ? 1 : 0) === 1 ? '' : 's'}`}
          </Button>
          {Object.values(targetState).some((s) => s.status === 'failed') ? (
            <Button onClick={() => void retryFailed()} variant="secondary">
              Retry failed targets
            </Button>
          ) : null}
        </div>

        {selectedSessionIds.length || sendToSelf ? (
          <div className="list">
            {selectedSessionIds.map((sessionId) => {
              const session = verifiedSessions.find((s) => s.id === sessionId);
              if (!session) return null;
              const state = targetState[sessionId] ?? defaultState();
              return (
                <ProgressRow
                  key={sessionId}
                  label={session.peerDevice?.name ?? 'Paired device'}
                  state={state}
                />
              );
            })}
            {sendToSelf ? (
              <ProgressRow
                key="self"
                label="This device"
                state={targetState.self ?? defaultState()}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {folderPrompt ? (
        <Modal onClose={() => setFolderPrompt(null)}>
          <div className="modal__header">
            <span className="modal__step">Folder transfer</span>
            <h2 className="modal__title">
              {folderPrompt.length} files · {formatBytes(folderPrompt.reduce((s, f) => s + f.size, 0))}
            </h2>
          </div>
          <div className="list">
            {(['preserve', 'zip', 'flat'] as FolderMode[]).map((m) => (
              <button
                key={m}
                className={`row row--selectable${folderMode === m ? ' row--selected' : ''}`}
                onClick={() => setFolderMode(m)}
                type="button"
              >
                <div className="row__copy">
                  <strong>
                    {m === 'preserve' ? 'Preserve folder structure (recommended)' : m === 'zip' ? 'Zip first, then send' : 'Flat — drop all files in one folder'}
                  </strong>
                  <span>
                    {m === 'preserve'
                      ? 'Receiver gets the same directory layout you picked.'
                      : m === 'zip'
                        ? 'One .zip file is uploaded. Decompression happens on the receiver.'
                        : 'Subfolders are flattened. Useful for unsorted picks.'}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="modal__actions">
            <Button onClick={() => setFolderPrompt(null)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={folderZipping}
              onClick={async () => {
                const files = folderPrompt;
                if (!files) return;
                if (folderMode === 'zip') {
                  setFolderZipping(true);
                  try {
                    const zipped = await zipFolder(files);
                    setQueuedFiles([zipped]);
                    setFolderPrompt(null);
                    if (zipped.size >= LARGE_FILE_THRESHOLD) setLargeFilePrompt(true);
                  } finally {
                    setFolderZipping(false);
                  }
                  return;
                }
                setQueuedFiles(folderMode === 'flat' ? files.map((f) => stripPath(f)) : files);
                setFolderPrompt(null);
                if (files.some((f) => f.size >= LARGE_FILE_THRESHOLD)) setLargeFilePrompt(true);
              }}
              variant="primary"
            >
              {folderZipping ? 'Zipping…' : `Continue with ${folderMode}`}
            </Button>
          </div>
        </Modal>
      ) : null}

      {largeFilePrompt ? (
        <Modal onClose={() => setLargeFilePrompt(false)}>
          <div className="modal__header">
            <span className="modal__step">Large transfer</span>
            <h2 className="modal__title">{formatBytes(queuedBytes)} queued — confirm before sending</h2>
          </div>
          <div className="list">
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="row__copy">
                <strong>This transfer is {formatBytes(queuedBytes)}</strong>
                <span>
                  {targetPeer
                    ? renderStorageCopy(peerStorage, targetPeer.name, queuedBytes)
                    : 'No paired device selected yet — pick a target before sending.'}
                </span>
              </div>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="row__copy">
                <strong>USB cable: ~{estimateTime(queuedBytes, 180 * 1024 * 1024)}</strong>
                <span>USB delivers the fastest path for big files.</span>
              </div>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="row__copy">
                <strong>WiFi 6: ~{estimateTime(queuedBytes, 96 * 1024 * 1024)}</strong>
                <span>Default lane.</span>
              </div>
            </div>
            <div className="row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="row__copy">
                <strong>Hotspot: ~{estimateTime(queuedBytes, 28 * 1024 * 1024)}</strong>
                <span>Useful with no WiFi. Slower than WiFi 6.</span>
              </div>
            </div>
          </div>
          <div className="modal__actions">
            <Button onClick={() => setLargeFilePrompt(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={
                peerStorage.status === 'ok' && peerStorage.freeBytes < queuedBytes
              }
              onClick={() => setLargeFilePrompt(false)}
              variant="primary"
            >
              {peerStorage.status === 'unknown' ? 'Proceed anyway' : 'Continue'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );

  async function sendQueuedFiles(override?: { sessionIds?: string[]; sendToSelf?: boolean }) {
    if (!queuedFiles.length || sending) return;
    const effectiveSessionIds = override?.sessionIds ?? selectedSessionIds;
    const effectiveSendToSelf = override?.sendToSelf ?? sendToSelf;
    if (!effectiveSessionIds.length && !effectiveSendToSelf) return;

    setSending(true);
    const selected = verifiedSessions.filter((s) => effectiveSessionIds.includes(s.id));

    setTargetState((current) => {
      const next = { ...current };
      for (const session of selected) next[session.id] = { message: 'Starting…', progress: 0, status: 'uploading', failedFiles: [] };
      if (effectiveSendToSelf) next.self = { message: 'Copying…', progress: 0, status: 'uploading', failedFiles: [] };
      return next;
    });

    const tasks: Promise<void>[] = [];
    const queuedBytesLocal = queuedFiles.reduce((s, f) => s + f.size, 0);

    for (const session of selected) {
      tasks.push(uploadAll(session.id, session.mode));
    }

    if (effectiveSendToSelf) {
      tasks.push(
        (async () => {
          try {
            for (const file of queuedFiles) {
              const url = URL.createObjectURL(file);
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }
            setTargetState((current) => ({
              ...current,
              self: { message: 'Saved with system download manager', progress: 100, status: 'complete', failedFiles: [] },
            }));
          } catch (error) {
            setTargetState((current) => ({
              ...current,
              self: {
                message: error instanceof Error ? error.message : 'Failed',
                progress: 0,
                status: 'failed',
                failedFiles: queuedFiles.map((f) => f.name),
              },
            }));
          }
        })(),
      );
    }

    await Promise.all(tasks);
    await backend.refresh();
    setSending(false);

    async function uploadAll(sessionId: string, mode: 'wifi' | 'usb' | 'hotspot') {
      let completedBytes = 0;
      const failedFiles: string[] = [];

      // Step 1: register a pending-transfer batch and wait for the phone to Accept.
      setTargetState((current) => ({
        ...current,
        [sessionId]: { message: 'Waiting for phone to accept…', progress: 0, status: 'uploading', failedFiles },
      }));

      const origin = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);
      let acceptedNames: Set<string>;
      try {
        const batchRes = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: 'desktop-to-phone',
            deviceName: backend.settings?.deviceName ?? 'DropBeam Desktop',
            files: queuedFiles.map((f) => ({
              name: f.name,
              size: f.size,
              mimeType: f.type || 'application/octet-stream',
              relativePath: getRelativePath(f),
              lastModified: f.lastModified || Date.now(),
            })),
          }),
        });
        if (!batchRes.ok) throw new Error(`batch create failed (HTTP ${batchRes.status})`);
        const batchJson = (await batchRes.json()) as { ok: boolean; batch: { id: string; files: Array<{ id: string; name: string }> } };
        const batchId = batchJson.batch.id;
        const namesById = new Map(batchJson.batch.files.map((f) => [f.id, f.name]));

        acceptedNames = await new Promise<Set<string>>((resolveAccept, reject) => {
          const unsub = backend.subscribeEvent((evt) => {
            const payload = (evt as { type: string; payload?: { batchId?: string; fileIds?: string[] } }).payload ?? {};
            if (payload.batchId !== batchId) return;
            if (evt.type === 'transfer-accepted') {
              unsub();
              const ids = payload.fileIds ?? [];
              const names = new Set(ids.map((id) => namesById.get(id)).filter((n): n is string => Boolean(n)));
              resolveAccept(names);
            } else if (evt.type === 'transfer-declined') {
              unsub();
              reject(new Error('Phone declined the transfer'));
            }
          });
          // 5-minute safety timeout
          setTimeout(() => { unsub(); reject(new Error('Phone did not respond in time')); }, 5 * 60 * 1000);
        });
      } catch (waitError) {
        setTargetState((current) => ({
          ...current,
          [sessionId]: {
            message: waitError instanceof Error ? waitError.message : 'Phone did not accept',
            progress: 0,
            status: 'failed',
            failedFiles: queuedFiles.map((f) => f.name),
          },
        }));
        return;
      }

      const filesToUpload = queuedFiles.filter((f) => acceptedNames.has(f.name));
      if (!filesToUpload.length) {
        setTargetState((current) => ({
          ...current,
          [sessionId]: { message: 'Phone declined all files', progress: 0, status: 'failed', failedFiles: queuedFiles.map((f) => f.name) },
        }));
        return;
      }

      try {
        for (const file of filesToUpload) {
          try {
            await backend.uploadFile(
              sessionId,
              'desktop-to-phone',
              file,
              {
                deviceName: backend.settings?.deviceName ?? 'DropBeam Desktop',
                relativePath: getRelativePath(file),
                transferMode: mode,
              },
              (filePercent) => {
                const fileBytesDone = Math.round((filePercent / 100) * file.size);
                const totalDone = completedBytes + fileBytesDone;
                const progress = queuedBytesLocal ? Math.min(100, Math.round((totalDone / queuedBytesLocal) * 100)) : 0;
                setTargetState((current) => ({
                  ...current,
                  [sessionId]: { message: `Sending ${file.name}`, progress, status: 'uploading', failedFiles },
                }));
              },
            );
            completedBytes += file.size;
          } catch (fileError) {
            failedFiles.push(file.name);
            console.warn('upload failed', file.name, fileError);
          }
        }
        setTargetState((current) => ({
          ...current,
          [sessionId]: {
            message: failedFiles.length ? `Done with ${failedFiles.length} failure(s)` : 'Delivered',
            progress: 100,
            status: failedFiles.length ? 'failed' : 'complete',
            failedFiles,
          },
        }));
      } catch (error) {
        setTargetState((current) => ({
          ...current,
          [sessionId]: {
            message: error instanceof Error ? error.message : 'Failed',
            progress: current[sessionId]?.progress ?? 0,
            status: 'failed',
            failedFiles,
          },
        }));
      }
    }
  }

  async function retryFailed() {
    const failingKeys = Object.entries(targetState).filter(([, s]) => s.status === 'failed').map(([k]) => k);
    if (!failingKeys.length) return;
    const failureSet = new Set(failingKeys);
    const retrySessionIds = selectedSessionIds.filter((id) => failureSet.has(id));
    const retrySelf = sendToSelf && failureSet.has('self');
    if (!retrySessionIds.length && !retrySelf) return;
    await sendQueuedFiles({ sessionIds: retrySessionIds, sendToSelf: retrySelf });
  }
}

function ProgressRow({ label, state }: { label: string; state: SendTargetState }) {
  return (
    <div className="row" style={{ gridTemplateColumns: '1fr' }}>
      <div className="row__copy">
        <strong>{label}</strong>
        <span>{state.message}</span>
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${state.progress}%` }} />
      </div>
    </div>
  );
}

function defaultState(): SendTargetState {
  return { message: 'Ready', progress: 0, status: 'idle', failedFiles: [] };
}

function toggleSelection(
  sessionId: string,
  setSelectedSessionIds: (updater: (current: string[]) => string[]) => void,
) {
  setSelectedSessionIds((current) =>
    current.includes(sessionId) ? current.filter((item) => item !== sessionId) : [...current, sessionId],
  );
}

function getRelativePath(file: File) {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return relativePath || file.name;
}

function stripPath(file: File) {
  const flat = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  return flat;
}

async function zipFolder(files: File[]): Promise<File> {
  const zip = new JSZip();
  for (const file of files) {
    const entryPath = getRelativePath(file);
    zip.file(entryPath, file, { date: new Date(file.lastModified) });
  }
  const firstPath = getRelativePath(files[0] ?? new File([], 'archive'));
  const root = firstPath.split(/[\\/]/)[0] || 'folder';
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new File([blob], `${root}.zip`, { type: 'application/zip', lastModified: Date.now() });
}

function renderStorageCopy(state: PeerStorageState, peerName: string, queuedBytes: number) {
  if (state.status === 'checking') return `Checking free space on ${peerName}…`;
  if (state.status === 'ok') {
    if (state.freeBytes < queuedBytes) {
      return `${peerName} has ${formatBytes(state.freeBytes)} free — not enough for ${formatBytes(queuedBytes)}.`;
    }
    return `${peerName} has ${formatBytes(state.freeBytes)} free of ${formatBytes(state.totalBytes)} — enough room.`;
  }
  if (state.status === 'unknown') {
    return `Free space on ${peerName}: unknown — proceed anyway?`;
  }
  return `Connected device: ${peerName}.`;
}

function estimateTime(bytes: number, bytesPerSecond: number) {
  if (!bytes || !bytesPerSecond) return '—';
  const seconds = Math.ceil(bytes / bytesPerSecond);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

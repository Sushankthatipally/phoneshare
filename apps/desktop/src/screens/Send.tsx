import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, GlassPanel, SectionHeading } from '@dropbeam/shared-ui';
import { chooseTransferChunkSize, formatBytes, resolveBackendOrigin, type LiveSessionRecord } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

const backendOrigin = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);

type SendTargetState = {
  message: string;
  progress: number;
  status: 'idle' | 'uploading' | 'complete' | 'failed';
};

export function Send({ backend }: { backend: DesktopBackendState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [targetState, setTargetState] = useState<Record<string, SendTargetState>>({});
  const [sending, setSending] = useState(false);

  const verifiedSessions = useMemo(() => {
    return backend.sessions
      .filter((session) => session.pairing.verifiedAt)
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(left.pairing.verifiedAt ?? left.updatedAt);
        const rightTime = Date.parse(right.pairing.verifiedAt ?? right.updatedAt);
        return rightTime - leftTime;
      });
  }, [backend.sessions]);

  const selectedSessions = useMemo(() => {
    return verifiedSessions.filter((session) => selectedSessionIds.includes(session.id));
  }, [selectedSessionIds, verifiedSessions]);

  const queuedBytes = useMemo(() => {
    return queuedFiles.reduce((total, file) => total + file.size, 0);
  }, [queuedFiles]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    setSelectedSessionIds((current) => {
      const nextCurrent = current.filter((sessionId) => verifiedSessions.some((session) => session.id === sessionId));
      if (nextCurrent.length) {
        return nextCurrent;
      }

      if (!verifiedSessions.length) {
        return [];
      }

      return verifiedSessions.slice(0, Math.min(2, verifiedSessions.length)).map((session) => session.id);
    });
  }, [verifiedSessions]);

  useEffect(() => {
    setTargetState((current) => {
      const nextState: Record<string, SendTargetState> = {};

      for (const session of selectedSessions) {
        nextState[session.id] = current[session.id] ?? {
          message: 'Ready to send',
          progress: 0,
          status: 'idle',
        };
      }

      return nextState;
    });
  }, [selectedSessions]);

  const quickStats = [
    {
      label: 'Queued files',
      value: String(queuedFiles.length),
      note: queuedFiles.length ? 'Local files are staged for the selected sessions.' : 'Choose files or a folder to build a live send queue.',
    },
    {
      label: 'Targets',
      value: String(selectedSessions.length),
      note: selectedSessions.length
        ? 'Only connected sessions can be selected for delivery.'
        : 'No connected sessions are selected yet.',
    },
    {
      label: 'Queued bytes',
      value: formatBytes(queuedBytes),
      note: queuedBytes ? 'The same file set is sent to every chosen session.' : 'Total upload size will appear here.',
    },
    {
      label: 'Active lane',
      value: backend.activeSession?.peerDevice?.name ?? 'None',
      note: backend.activeSession?.pairing.verifiedAt
        ? 'Current active session is encrypted and ready.'
        : 'There is no connected active session yet.',
    },
  ];

  return (
    <div className="desktop-screen">
      <div className="desktop-send-layout">
        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Send"
            title="Choose files or a folder"
            description="Files selected here are uploaded to each verified session you choose. The screen uses live sessions and live backend uploads only."
          />

          <div className="desktop-security-strip">
            <Badge tone={selectedSessions.length ? 'green' : 'amber'}>
              {selectedSessions.length ? `${selectedSessions.length} connected targets` : 'select connected targets'}
            </Badge>
            <Badge tone="blue">{queuedFiles.length ? `${queuedFiles.length} files queued` : 'no files queued'}</Badge>
            <Badge>{sending ? 'sending live' : 'idle'}</Badge>
          </div>

          <button className="desktop-drop-zone" onClick={() => inputRef.current?.click()} type="button">
            <strong>Drop or choose desktop files</strong>
            <p>
              Use the file picker for individual files, or choose a folder to preserve relative paths across every
              selected session.
            </p>
            <div className="desktop-drop-zone__meta">
              <span>{queuedFiles.length ? `${queuedFiles.length} items staged` : 'No local files staged yet'}</span>
              <span>{queuedBytes ? formatBytes(queuedBytes) : 'Waiting for files'}</span>
            </div>
          </button>

          <div className="desktop-actions">
            <input
              hidden
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length) {
                  setQueuedFiles(files);
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
                if (files.length) {
                  setQueuedFiles(files);
                }
                event.target.value = '';
              }}
              ref={folderInputRef}
              type="file"
            />
            <Button onClick={() => inputRef.current?.click()} variant="primary">
              Choose files
            </Button>
            <Button onClick={() => folderInputRef.current?.click()} variant="secondary">
              Choose folder
            </Button>
            <Button disabled={!queuedFiles.length || !selectedSessions.length || sending} onClick={() => void sendQueuedFiles()}>
              {sending ? 'Sending' : 'Send to selected sessions'}
            </Button>
          </div>
        </GlassPanel>

        <GlassPanel className="desktop-panel-stack">
          <SectionHeading
            eyebrow="Targets"
            title="Connected sessions"
            description="Select one or more connected sessions. The desktop uploads the same queue to every checked target one after another."
          />

          <div className="desktop-summary-strip">
            {quickStats.map((item) => (
              <article className="desktop-summary-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.note}</p>
              </article>
            ))}
          </div>

          <div className="desktop-send-target-actions">
            <Button
              disabled={!verifiedSessions.length}
              onClick={() => setSelectedSessionIds(verifiedSessions.map((session) => session.id))}
              variant="secondary"
            >
              Select all connected
            </Button>
            <Button disabled={!selectedSessionIds.length} onClick={() => setSelectedSessionIds([])} variant="ghost">
              Clear
            </Button>
          </div>

          <div className="desktop-send-targets">
            {verifiedSessions.length ? (
              verifiedSessions.map((session) => (
                <button
                  className={`desktop-send-target-card${
                    selectedSessionIds.includes(session.id) ? ' desktop-send-target-card--selected' : ''
                  }`}
                  key={session.id}
                  onClick={() => toggleTarget(session.id, setSelectedSessionIds)}
                  type="button"
                >
                  <div className="desktop-send-target-card__copy">
                    <strong>{session.peerDevice?.name ?? session.localDevice.name}</strong>
                    <p>
                      {session.peerDevice?.platform ?? 'paired device'} - {session.id.slice(0, 8)}
                    </p>
                  </div>

                  <div className="desktop-send-target-card__meta">
                    <Badge tone="blue">{modeLabel(session.mode)}</Badge>
                    <small>Encrypted lane</small>
                    <small>{session.summary.totalFiles} files</small>
                  </div>

                  <div className="desktop-send-target-card__check" aria-hidden="true">
                    {selectedSessionIds.includes(session.id) ? 'Selected' : 'Tap to select'}
                  </div>
                </button>
              ))
            ) : (
              <div className="desktop-empty-state">
                <p>No connected sessions are available yet. Connect a device first, then choose it as a send target.</p>
              </div>
            )}
          </div>

          <div className="desktop-send-progress">
            {selectedSessions.length ? (
              selectedSessions.map((session) => {
                const state = targetState[session.id] ?? {
                  message: 'Ready to send',
                  progress: 0,
                  status: 'idle',
                };

                return (
                  <article className="desktop-send-progress__row" key={session.id}>
                    <div className="desktop-send-progress__copy">
                      <strong>{session.peerDevice?.name ?? session.localDevice.name}</strong>
                      <p>{state.message}</p>
                    </div>
                    <Badge tone={state.status === 'failed' ? 'amber' : state.status === 'complete' ? 'green' : 'blue'}>
                      {state.status}
                    </Badge>
                    <div className="desktop-send-progress__bar" aria-hidden="true">
                      <span className="desktop-send-progress__fill" style={{ width: `${state.progress}%` }} />
                    </div>
                    <span className="desktop-send-progress__status">{state.progress}%</span>
                  </article>
                );
              })
            ) : (
              <div className="desktop-empty-state">
                <p>Select one or more connected sessions to see per-target send progress here.</p>
              </div>
            )}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="desktop-panel-stack">
        <SectionHeading
          eyebrow="Queue"
          title={queuedFiles.length ? 'Local files staged for delivery' : 'No files queued yet'}
          description="The same file queue is sent to every selected connected session. Folder paths stay intact when a directory is chosen."
        />

        {queuedFiles.length ? (
          <div className="desktop-file-table">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Path</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {queuedFiles.map((file) => (
                  <tr key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <td>
                      <div className="desktop-file-table__name">
                        <strong>{file.name}</strong>
                        <span>{file.type || 'application/octet-stream'}</span>
                      </div>
                    </td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{getRelativePath(file)}</td>
                    <td>{file.webkitRelativePath ? 'Folder item' : 'Single file'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desktop-empty-state">
            <p>No desktop files are staged yet. Pick files or a folder to start a live multi-session send.</p>
          </div>
        )}
      </GlassPanel>
    </div>
  );

  async function sendQueuedFiles() {
    if (!queuedFiles.length || !selectedSessions.length || sending) {
      return;
    }

    setSending(true);
    setTargetState((current) => {
      const nextState = { ...current };

      for (const session of selectedSessions) {
        nextState[session.id] = {
          message: `Sending to ${session.peerDevice?.name ?? session.localDevice.name}`,
          progress: 0,
          status: 'uploading',
        };
      }

      return nextState;
    });

    try {
      await Promise.all(
        selectedSessions.map(async (session) => {
          let uploadedBytes = 0;

          try {
            for (const file of queuedFiles) {
              await uploadFileToSession(session, file, backend.settings?.deviceName ?? 'DropBeam Desktop', (bytesDone) => {
                uploadedBytes += bytesDone;
                const progress = queuedBytes ? Math.min(100, Math.round((uploadedBytes / queuedBytes) * 100)) : 0;

                setTargetState((current) => ({
                  ...current,
                  [session.id]: {
                    message: `Uploading ${file.name}`,
                    progress,
                    status: 'uploading',
                  },
                }));
              });
            }

            setTargetState((current) => ({
              ...current,
              [session.id]: {
                message: 'Delivered to live backend',
                progress: 100,
                status: 'complete',
              },
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send files';
            setTargetState((current) => ({
              ...current,
              [session.id]: {
                message,
                progress: current[session.id]?.progress ?? 0,
                status: 'failed',
              },
            }));
          }
        }),
      );

      await backend.refresh();
    } finally {
      setSending(false);
    }
  }
}

function toggleTarget(
  sessionId: string,
  setSelectedSessionIds: (updater: (current: string[]) => string[]) => void,
) {
  setSelectedSessionIds((current) =>
    current.includes(sessionId) ? current.filter((item) => item !== sessionId) : [...current, sessionId],
  );
}

function modeLabel(mode?: string | null) {
  switch (mode) {
    case 'usb':
      return 'USB';
    case 'hotspot':
      return 'HOTSPOT';
    default:
      return 'WIFI';
  }
}

function getRelativePath(file: File) {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return relativePath || file.name;
}

async function uploadFileToSession(
  session: LiveSessionRecord,
  file: File,
  deviceName: string,
  onChunk: (bytesTransferred: number) => void,
) {
  const chunkSize = chooseTransferChunkSize(session.mode, file.size);
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const upload = await requestJson<{ upload: { id: string; nextChunk: number; totalChunks: number; chunkSize: number } }>(
    `/api/sessions/${encodeURIComponent(session.id)}/uploads/start`,
    {
      method: 'POST',
      body: JSON.stringify({
        direction: 'desktop-to-phone',
        name: file.name,
        relativePath: getRelativePath(file),
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        deviceName,
        chunkSize,
        totalChunks,
      }),
      headers: { 'Content-Type': 'application/json' },
    },
  );

  const startedUpload = upload.upload;

  for (let chunkIndex = startedUpload.nextChunk; chunkIndex < startedUpload.totalChunks; chunkIndex += 1) {
    const start = chunkIndex * startedUpload.chunkSize;
    const end = Math.min(file.size, start + startedUpload.chunkSize);
    const response = await fetch(`${backendOrigin}/api/uploads/${encodeURIComponent(startedUpload.id)}/chunks/${chunkIndex}`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file.slice(start, end),
    });

    await readJson(response);
    onChunk(end - start);
  }

  const completeResponse = await fetch(`${backendOrigin}/api/uploads/${encodeURIComponent(startedUpload.id)}/complete`, {
    method: 'POST',
  });

  await readJson(completeResponse);
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${backendOrigin}${path}`, init);
  return readJson<T>(response);
}

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as { ok: boolean; error?: string } & T;

  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.error ?? `Backend request failed (${response.status})`));
  }

  return payload as T;
}

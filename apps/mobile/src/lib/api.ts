import * as FileSystem from 'expo-file-system';

import type { ConnectionInfo } from './connection.js';

/**
 * Uploads a single file to the desktop's guest endpoint.
 * Wire format (matches packages/local-backend/src/index.js handler):
 *   PUT /api/guest/:token/files
 *   Header: X-File-Meta = encodeURIComponent(JSON.stringify({name, size, mimeType}))
 *   Body: raw file bytes
 *
 * onProgress receives 0..100. expo-file-system's createUploadTask gives byte-level callbacks.
 */
export async function uploadGuestFile(params: {
  connection: ConnectionInfo;
  fileUri: string;
  name: string;
  size: number;
  mimeType: string;
  onProgress?: (percent: number) => void;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { connection, fileUri, name, size, mimeType, onProgress } = params;
  const meta = encodeURIComponent(JSON.stringify({ name, size, mimeType }));
  const endpoint = `${connection.origin}/api/guest/${encodeURIComponent(connection.token)}/files`;

  // expo-file-system supports streaming uploads with progress callbacks.
  const task = FileSystem.createUploadTask(
    endpoint,
    fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'X-File-Meta': meta, 'Content-Type': mimeType || 'application/octet-stream' },
    },
    (progress) => {
      if (!onProgress || progress.totalBytesExpectedToSend <= 0) return;
      const pct = (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100;
      onProgress(Math.max(0, Math.min(100, Math.round(pct))));
    },
  );

  const result = await task.uploadAsync();
  if (!result) {
    return { ok: false, status: 0, body: 'No response' };
  }
  let parsed: unknown = result.body;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    /* keep as text */
  }
  return { ok: result.status >= 200 && result.status < 300, status: result.status, body: parsed };
}

/**
 * Probe the desktop backend health endpoint to verify the share URL is reachable.
 */
export async function probeHealth(connection: ConnectionInfo): Promise<boolean> {
  try {
    const response = await fetch(`${connection.origin}/api/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the desktop to re-issue a guest session bound to a previously paired device
 * fingerprint. The backend route is provisional — call sites must tolerate a 404
 * and fall back to a fresh QR pair.
 */
export async function reconnectKnownDevice(params: {
  origin: string;
  fingerprint: string;
}): Promise<{ ok: boolean; status: number; connection?: ConnectionInfo }> {
  const { origin, fingerprint } = params;
  try {
    const response = await fetch(`${origin}/api/known-devices/${encodeURIComponent(fingerprint)}/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const data = (await response.json()) as { token?: string; label?: string; sessionId?: string };
    if (!data.token) return { ok: false, status: response.status };
    return {
      ok: true,
      status: response.status,
      connection: {
        origin,
        token: data.token,
        label: data.label ?? origin,
        sessionId: data.sessionId,
        peerFingerprint: fingerprint,
      },
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Notify the desktop of this phone's free + total storage so it can warn the
 * user before queueing a transfer that wouldn't fit. The desktop exposes this
 * endpoint (W12); silently no-op if it isn't there.
 */
export async function reportStorage(params: {
  connection: ConnectionInfo;
  freeBytes: number;
  totalBytes: number;
}): Promise<boolean> {
  try {
    const response = await fetch(`${params.connection.origin}/api/peers/storage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guest-Token': params.connection.token,
      },
      body: JSON.stringify({ freeBytes: params.freeBytes, totalBytes: params.totalBytes }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Push the phone's clipboard to the desktop so the desktop's clipboard-sync UI
 * can mirror it. The backend wires this into the SSE channel.
 */
export async function pushClipboard(params: { connection: ConnectionInfo; text: string }): Promise<boolean> {
  try {
    const response = await fetch(`${params.connection.origin}/api/clipboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guest-Token': params.connection.token,
      },
      body: JSON.stringify({ text: params.text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

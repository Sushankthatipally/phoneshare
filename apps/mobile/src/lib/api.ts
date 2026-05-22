import * as FileSystem from 'expo-file-system';

import type { GuestConnection } from './connection.js';

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
  connection: GuestConnection;
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
export async function probeHealth(connection: { origin: string }): Promise<boolean> {
  try {
    const response = await fetch(`${connection.origin}/api/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

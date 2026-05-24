import type { ConnectionInfo } from './connection.js';

/**
 * Probe the desktop backend health endpoint to verify reachability.
 */
export async function probeHealth(connection: { origin: string }): Promise<boolean> {
  try {
    const response = await fetch(`${connection.origin}/api/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Notify the desktop of this phone's free + total storage so it can warn the
 * user before queueing a transfer that wouldn't fit.
 */
export async function reportStorage(params: {
  connection: ConnectionInfo;
  freeBytes: number;
  totalBytes: number;
}): Promise<boolean> {
  try {
    const response = await fetch(`${params.connection.origin}/api/peers/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeBytes: params.freeBytes, totalBytes: params.totalBytes }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface TransferBatchFile {
  name: string;
  size: number;
  mimeType?: string;
  relativePath?: string;
}

/**
 * Request a transfer batch on the desktop backend. The receiver gets a
 * `transfer-requested` SSE event; if Quick Save is on / favorite-matched the
 * desktop auto-accepts and broadcasts `transfer-accepted`.
 */
export async function requestTransferBatch(params: {
  origin: string;
  sessionId: string;
  direction?: 'desktop-to-phone' | 'phone-to-desktop';
  deviceName?: string;
  files: TransferBatchFile[];
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { origin, sessionId, direction = 'phone-to-desktop', deviceName, files } = params;
  const response = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction, deviceName, files }),
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

export async function pushClipboard(params: { connection: ConnectionInfo; text: string }): Promise<boolean> {
  try {
    const response = await fetch(`${params.connection.origin}/api/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: params.text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

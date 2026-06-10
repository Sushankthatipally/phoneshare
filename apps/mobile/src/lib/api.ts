import * as FileSystem from 'expo-file-system';

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

// ─── Encrypted session-based file upload ────────────────────────────────────

/**
 * Decode a base64url string to a Uint8Array using the global crypto / atob
 * implementation that quick-crypto installs on RN.
 */
function decodeBase64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a native base64 string (no padding issues) to Uint8Array.
 * expo-file-system readAsStringAsync returns standard base64 (with + / and =).
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt one plaintext chunk with AES-256-GCM.
 * AAD = `${sessionId}:${fileId}:${chunkIndex}` — matches backend decryptTransferChunk exactly.
 * Requires globalThis.crypto.subtle (installed by react-native-quick-crypto).
 */
async function encryptUploadChunk(params: {
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  plaintext: Uint8Array;
  cryptoKey: CryptoKey;
}): Promise<{ chunkIndex: number; nonce: string; ciphertext: string }> {
  const { sessionId, fileId, chunkIndex, plaintext, cryptoKey } = params;
  const subtle = globalThis.crypto.subtle;
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${sessionId}:${fileId}:${chunkIndex}`);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer, additionalData: aad.buffer as ArrayBuffer, tagLength: 128 },
    cryptoKey,
    plaintext.buffer as ArrayBuffer,
  );
  function encB64url(arr: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < arr.length; i += 0x8000) {
      bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return {
    chunkIndex,
    nonce: encB64url(nonce),
    ciphertext: encB64url(new Uint8Array(cipherBuf)),
  };
}

export interface UploadSessionFileParams {
  origin: string;
  sessionId: string;
  /** base64url of the raw 32-byte HKDF-derived session key (from SecureSession.sharedSecret). */
  sharedSecretB64url: string;
  deviceName?: string;
  item: {
    uri?: string;
    text?: string;
    name: string;
    size: number;
    mimeType?: string;
  };
  chunkSize: number;
  onProgress?: (pct: number) => void;
}

/**
 * Uploads a single item (file or text) to the desktop over an established
 * session using the session-based encrypted-chunk upload protocol:
 *
 *   POST /api/sessions/:sid/uploads/start
 *   PUT  /api/uploads/:id/chunks/:index  (JSON, AES-256-GCM)
 *   POST /api/uploads/:id/complete
 *
 * Wire format matches backend store.receiveEncryptedChunk exactly:
 *   content-type: application/json
 *   body: { encrypted: true, fileId: <uploadId>,
 *           chunk: { chunkIndex, nonce, ciphertext } }
 * AAD string: `${sessionId}:${fileId}:${chunkIndex}`
 */
export async function uploadSessionFile(params: UploadSessionFileParams): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { origin, sessionId, sharedSecretB64url, deviceName, item, chunkSize, onProgress } = params;

  // Import the raw AES-256-GCM key.
  const rawKey = decodeBase64UrlToBytes(sharedSecretB64url);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Resolve plaintext bytes for text items; for file items we read lazily per-chunk.
  let textBytes: Uint8Array | null = null;
  if (item.text !== undefined) {
    textBytes = new TextEncoder().encode(item.text);
  }

  const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize));

  // 1. Start upload.
  const startRes = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/uploads/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      direction: 'phone-to-desktop',
      name: item.name,
      size: item.size,
      mimeType: item.mimeType ?? 'application/octet-stream',
      chunkSize,
      totalChunks,
      deviceName: deviceName ?? undefined,
    }),
  });
  const startBody = await startRes.json().catch(() => null) as Record<string, unknown> | null;
  if (!startRes.ok) {
    return { ok: false, status: startRes.status, body: startBody };
  }
  const upload = (startBody as { upload?: { id: string; nextChunk: number; chunkSize: number; totalChunks: number } }).upload;
  if (!upload?.id) {
    return { ok: false, status: startRes.status, body: 'uploads/start returned no upload.id' };
  }
  const uploadId = upload.id;
  const resumeFrom = upload.nextChunk ?? 0;
  const serverTotalChunks = upload.totalChunks ?? totalChunks;

  // 2. Send chunks in order, starting at resumeFrom.
  for (let idx = resumeFrom; idx < serverTotalChunks; idx++) {
    const byteOffset = idx * chunkSize;
    let plaintext: Uint8Array;

    if (textBytes !== null) {
      plaintext = textBytes.slice(byteOffset, byteOffset + chunkSize);
    } else {
      // Read a chunk slice from the file via expo-file-system.
      // DocumentPicker uses copyToCacheDirectory:true so the URI is a file:// path.
      const sliceLength = Math.min(chunkSize, item.size - byteOffset);
      const b64Slice = await FileSystem.readAsStringAsync(item.uri!, {
        encoding: FileSystem.EncodingType.Base64,
        position: byteOffset,
        length: sliceLength,
      });
      plaintext = base64ToBytes(b64Slice);
    }

    const chunk = await encryptUploadChunk({ sessionId, fileId: uploadId, chunkIndex: idx, plaintext, cryptoKey });

    const chunkRes = await fetch(`${origin}/api/uploads/${encodeURIComponent(uploadId)}/chunks/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: true, fileId: uploadId, chunk }),
    });
    const chunkBody = await chunkRes.json().catch(() => null);
    if (!chunkRes.ok) {
      return { ok: false, status: chunkRes.status, body: chunkBody };
    }

    if (onProgress) {
      onProgress(Math.round(((idx + 1) / serverTotalChunks) * 100));
    }
  }

  // 3. Complete.
  const completeRes = await fetch(`${origin}/api/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const completeBody = await completeRes.json().catch(() => null);
  return { ok: completeRes.ok, status: completeRes.status, body: completeBody };
}

// ─── SSE: wait for transfer accept/decline ──────────────────────────────────

export type TransferDecision =
  | { accepted: true; fileIds: string[] }
  | { accepted: false; reason: string | null };

/**
 * Opens a one-shot SSE connection to GET ${origin}/api/events and resolves
 * when a `transfer-accepted` or `transfer-declined` event for `batchId` arrives,
 * or rejects on timeout.
 *
 * Why SSE over polling: the global /api/events stream is the authoritative
 * broadcast channel; the backend broadcasts transfer-accepted/declined there
 * immediately on desktop action. A 1.5 s poll would add ~0.75 s median latency
 * and extra requests. SSE gives sub-100 ms latency with zero extra round-trips.
 *
 * Note: connection.tsx's subscribeSse points at /api/sessions/:sid/events which
 * does not exist on the backend (only /api/events is registered). So we open our
 * own fetch-based SSE here rather than reusing the context subscriber.
 */
export function waitForTransferDecision(params: {
  origin: string;
  batchId: string;
  timeoutMs?: number;
}): Promise<TransferDecision> {
  const { origin, batchId, timeoutMs = 120_000 } = params;

  return new Promise<TransferDecision>((resolve, reject) => {
    let closed = false;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      closed = true;
      controller.abort();
      reject(new Error('Timed out waiting for desktop to accept or decline'));
    }, timeoutMs);

    (async () => {
      try {
        const res = await fetch(`${origin}/api/events`, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE connect failed (HTTP ${res.status})`);
        }

        const reader = (res.body as unknown as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf('\n\n');
          while (idx !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf('\n\n');

            let eventName = 'message';
            let dataLine = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(dataLine) as Record<string, unknown>;
            } catch {
              continue;
            }

            const type = typeof parsed?.type === 'string' ? parsed.type : eventName;
            const payload = (parsed?.payload ?? parsed) as Record<string, unknown>;

            if (type === 'transfer-accepted' && payload?.batchId === batchId) {
              closed = true;
              clearTimeout(timer);
              controller.abort();
              resolve({ accepted: true, fileIds: Array.isArray(payload.fileIds) ? (payload.fileIds as string[]) : [] });
              return;
            }
            if (type === 'transfer-declined' && payload?.batchId === batchId) {
              closed = true;
              clearTimeout(timer);
              controller.abort();
              resolve({ accepted: false, reason: typeof payload?.reason === 'string' ? payload.reason : null });
              return;
            }
          }
        }
      } catch (err: unknown) {
        if (!closed) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
  });
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

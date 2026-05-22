import type {
  BackendEventEnvelope,
  BackendHealth,
  BackendSettings,
  ClipboardState,
  CreateSessionRequest,
  DiscoveryDeviceRecord,
  DashboardResponse,
  GuestShareSummary,
  HistoryEntry,
  KnownDeviceRecord,
  LanIpsResponse,
  LiveSessionRecord,
  LiveTransferDirection,
  PairSessionRequest,
  PendingTransferBatch,
  SecureDownloadPayload,
  StoredFileRecord,
  TrustedDeviceRecord,
  UpdateClipboardRequest,
  UpdateSettingsRequest,
  UploadSessionRecord,
} from './live-backend.js';
import { chooseTransferChunkSize } from './live-backend.js';
import {
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  generateKeyAgreement,
  importSessionKey,
  type SessionKeyMaterial,
} from '@dropbeam/crypto-core';

interface OkEnvelope<T> {
  ok: boolean;
  [key: string]: T | boolean | undefined;
}

export class DropbeamBackendClient {
  constructor(private readonly origin = resolveBackendOrigin()) {}

  health() {
    return this.request<BackendHealth & { uptimeSeconds: number }>('/api/health');
  }

  dashboard() {
    return this.request<DashboardResponse>('/api/dashboard');
  }

  history(query?: string) {
    const params = new URLSearchParams();
    if (query?.trim()) {
      params.set('query', query.trim());
    }

    const path = params.size ? `/api/history?${params.toString()}` : '/api/history';
    return this.request<{ items: HistoryEntry[] }>(path).then((response) => response.items);
  }

  settings() {
    return this.request<{ settings: BackendSettings }>('/api/settings').then((response) => response.settings);
  }

  discovery() {
    return this.request<{ items: DiscoveryDeviceRecord[] }>('/api/discovery').then((response) => response.items);
  }

  lanIps() {
    return this.request<LanIpsResponse & { ok: boolean }>('/api/discovery/lan-ips').then(({ preferred, candidates }) => ({
      preferred,
      candidates,
    }));
  }

  clipboard() {
    return this.request<{ clipboard: ClipboardState }>('/api/clipboard').then((response) => response.clipboard);
  }

  updateSettings(input: UpdateSettingsRequest) {
    return this.request<{ settings: BackendSettings }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => response.settings);
  }

  updateClipboard(input: UpdateClipboardRequest) {
    return this.request<{ clipboard: ClipboardState }>('/api/clipboard', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => response.clipboard);
  }

  createSession(input: CreateSessionRequest & { origin?: string; deviceName?: string } = {}) {
    return this.request<{ session: LiveSessionRecord }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => response.session);
  }

  sessions() {
    return this.request<{ items: LiveSessionRecord[] }>('/api/sessions').then((response) => response.items);
  }

  session(sessionId: string) {
    return this.request<{ session: LiveSessionRecord }>(`/api/sessions/${encodeURIComponent(sessionId)}`).then(
      (response) => response.session,
    );
  }

  pairSession(sessionId: string, input: PairSessionRequest) {
    return this.pairSessionSecure(sessionId, input);
  }

  private async pairSessionSecure(sessionId: string, input: PairSessionRequest) {
    const ticket = parseTicketValue(input.ticketQrValue);
    let sessionKey: SessionKeyMaterial | null = null;
    let remotePublicKey: string | undefined;

    if (ticket?.publicKey && !isExpired(ticket.expiresAt) && ticket.sessionId === sessionId) {
      const keyAgreement = await generateKeyAgreement();
      sessionKey = await deriveSessionKey({
        keyAgreement,
        remotePublicKey: ticket.publicKey,
        sessionId,
      });
      remotePublicKey = keyAgreement.publicKey;
    }

    try {
      const session = await this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/pair`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          remotePublicKey,
        }),
        headers: { 'Content-Type': 'application/json' },
      },
      ).then((response) => response.session);

      if (sessionKey) {
        persistSessionKey(sessionId, sessionKey);
      }

      return session;
    } catch (error) {
      if (sessionKey) {
        clearPersistedSessionKey(sessionId);
      }
      throw error;
    }
  }

  acceptSession(sessionId: string, trust = false) {
    return this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify({ trust }),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((response) => response.session);
  }

  declineSession(sessionId: string, reason?: string) {
    return this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/decline`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((response) => response.session);
  }

  regenerateSession(sessionId: string) {
    return this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/regenerate`,
      { method: 'POST' },
    ).then((response) => response.session);
  }

  trustedDevices() {
    return this.request<{ items: TrustedDeviceRecord[] }>('/api/trusted-devices').then((r) => r.items);
  }

  knownDevices() {
    return this.request<{ items: KnownDeviceRecord[] }>('/api/known-devices').then((r) => r.items);
  }

  setTrustedDevice(fingerprint: string, autoAccept = true) {
    return this.request<{ trusted: TrustedDeviceRecord }>(
      `/api/trusted-devices/${encodeURIComponent(fingerprint)}`,
      {
        method: 'POST',
        body: JSON.stringify({ autoAccept }),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((r) => r.trusted);
  }

  removeTrustedDevice(fingerprint: string) {
    return this.request<{ ok: boolean }>(`/api/trusted-devices/${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
    });
  }

  createGuestShare(input: { ttlMs?: number; maxUses?: number }) {
    return this.request<{
      share: GuestShareSummary & { token: string };
      lanUrl?: string | null;
      lanOrigin?: string | null;
    }>('/api/guest', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => ({ ...r.share, lanUrl: r.lanUrl ?? null, lanOrigin: r.lanOrigin ?? null }));
  }

  async addGuestFile(token: string, file: File) {
    const meta = JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream' });
    const response = await fetch(`${this.origin}/api/guest/${encodeURIComponent(token)}/files`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Meta': encodeURIComponent(meta),
      },
      body: file,
    });
    return this.readJson<{ file: { id: string; name: string; size: number } }>(response).then((r) => r.file);
  }

  guestUrl(token: string) {
    return `${this.origin}/guest/${encodeURIComponent(token)}`;
  }

  async benchmarkSend(bytes = 4 * 1024 * 1024) {
    const buffer = new Uint8Array(bytes);
    const start = performance.now();
    const response = await fetch(`${this.origin}/api/benchmark/echo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    const json = (await response.json()) as { ok: boolean; bytesPerSecond: number; durationMs: number };
    const rtt = performance.now() - start;
    return { bytesPerSecond: json.bytesPerSecond, durationMs: json.durationMs, roundTripMs: Math.round(rtt) };
  }

  async benchmarkReceive(bytes = 4 * 1024 * 1024) {
    const start = performance.now();
    const response = await fetch(`${this.origin}/api/benchmark/blob?bytes=${bytes}`);
    const blob = await response.blob();
    const ms = performance.now() - start;
    return {
      bytesPerSecond: ms > 0 ? Math.round((blob.size / ms) * 1000) : 0,
      durationMs: Math.round(ms),
    };
  }

  closeSession(sessionId: string, reason?: string) {
    return this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/close`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((response) => response.session);
  }

  listFiles(sessionId: string, direction: LiveTransferDirection) {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/files?direction=${encodeURIComponent(direction)}`;
    return this.request<{ files: StoredFileRecord[] }>(path).then((response) => response.files);
  }

  async uploadFile(
    sessionId: string,
    direction: LiveTransferDirection,
    file: File,
    options: {
      deviceName: string;
      relativePath?: string;
      transferMode?: LiveSessionRecord['mode'];
    },
    onProgress?: (progress: number) => void,
  ) {
    const chunkSize = chooseTransferChunkSize(options.transferMode, file.size);
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const upload = await this.request<{ upload: UploadSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/uploads/start`,
      {
        method: 'POST',
        body: JSON.stringify({
          direction,
          name: file.name,
          relativePath: options.relativePath,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          lastModified: file.lastModified || Date.now(),
          deviceName: options.deviceName,
          chunkSize,
          totalChunks,
        }),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((response) => response.upload);

    const sessionKey = await loadSessionKey(sessionId);

    for (let chunkIndex = upload.nextChunk; chunkIndex < upload.totalChunks; chunkIndex += 1) {
      const start = chunkIndex * upload.chunkSize;
      const end = Math.min(file.size, start + upload.chunkSize);
      const body = sessionKey
        ? JSON.stringify({
            encrypted: true,
            algorithm: sessionKey.algorithm,
            keyId: sessionKey.keyId,
            fileId: upload.id,
            chunk: await encryptChunk({
              sessionKey,
              sessionId,
              fileId: upload.id,
              chunkIndex,
              plaintext: new Uint8Array(await file.slice(start, end).arrayBuffer()),
            }),
          })
        : file.slice(start, end);
      const response = await fetch(
        `${this.origin}/api/uploads/${encodeURIComponent(upload.id)}/chunks/${chunkIndex}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': sessionKey ? 'application/json' : file.type || 'application/octet-stream',
          },
          body,
        },
      );

      await this.readJson<{ upload: UploadSessionRecord }>(response);
      onProgress?.(((chunkIndex + 1) / upload.totalChunks) * 100);
    }

    const response = await fetch(`${this.origin}/api/uploads/${encodeURIComponent(upload.id)}/complete`, {
      method: 'POST',
    });

    return this.readJson<{ file: StoredFileRecord }>(response).then((payload) => payload.file);
  }

  downloadUrl(fileId: string) {
    return `${this.origin}/api/files/${encodeURIComponent(fileId)}/download`;
  }

  async downloadFile(sessionId: string, file: StoredFileRecord) {
    const sessionKey = await loadSessionKey(sessionId);
    if (!sessionKey) {
      return fetch(this.downloadUrl(file.id)).then((response) => response.blob());
    }

    const response = await fetch(
      `${this.origin}/api/files/${encodeURIComponent(file.id)}/payload?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const payload = await this.readJson<SecureDownloadPayload>(response);

    if (!payload.encrypted || !payload.payload) {
      return fetch(this.downloadUrl(file.id)).then((downloadResponse) => downloadResponse.blob());
    }

    const plaintext = await decryptChunk({
      sessionKey,
      sessionId,
      fileId: file.id,
      chunk: payload.payload,
    });

    return new Blob([Uint8Array.from(plaintext).buffer], { type: file.mimeType || 'application/octet-stream' });
  }

  async downloadFileUrl(sessionId: string, file: StoredFileRecord) {
    const blob = await this.downloadFile(sessionId, file);
    return URL.createObjectURL(blob);
  }

  subscribe(onEvent: (event: BackendEventEnvelope) => void) {
    const source = new EventSource(`${this.origin}/api/events`);

    const handler = (raw: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(raw.data) as BackendEventEnvelope);
      } catch (error) {
        console.warn('DropBeam event parse failed', error);
      }
    };

    source.addEventListener('snapshot', handler as EventListener);
    source.addEventListener('session-created', handler as EventListener);
    source.addEventListener('session-paired', handler as EventListener);
    source.addEventListener('session-closed', handler as EventListener);
    source.addEventListener('settings-updated', handler as EventListener);
    source.addEventListener('clipboard-updated', handler as EventListener);
    source.addEventListener('upload-started', handler as EventListener);
    source.addEventListener('upload-progress', handler as EventListener);
    source.addEventListener('file-uploaded', handler as EventListener);
    source.addEventListener('file-downloaded', handler as EventListener);
    source.onmessage = handler;

    return () => {
      source.close();
    };
  }

  private async request<T>(path: string, init?: RequestInit) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${this.origin}${path}`, {
        ...init,
        signal: init?.signal ?? controller.signal,
      });
      return this.readJson<T>(response);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Backend at ${this.origin} did not respond within 8s. Is the sidecar running?`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async readJson<T>(response: Response) {
    const payload = (await response.json()) as OkEnvelope<T>;

    if (!response.ok || payload.ok === false) {
      throw new Error(String((payload as Record<string, unknown>).error ?? `Backend request failed (${response.status})`));
    }

    return payload as T;
  }
}

export function resolveBackendOrigin(override?: string) {
  if (override) {
    return override.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:17619';
  }

  // Inside the Tauri webview the page is served from tauri://localhost or
  // https://tauri.localhost. The Rust backend listens on plain HTTP loopback,
  // so always force http://127.0.0.1:17619 from within the Tauri shell.
  const tauriBridge =
    (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }).__TAURI__ ??
    (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const tauriProtocol =
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'https:' && window.location.hostname.endsWith('tauri.localhost');
  if (tauriBridge || tauriProtocol) {
    return 'http://127.0.0.1:17619';
  }

  const protocol = window.location.protocol || 'http:';
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}//${hostname}:17619`;
}

type StoredSessionKey = {
  keyId: string;
  publicKey: string;
  rawKey: string;
};

type TicketPayload = {
  sessionId: string;
  publicKey: string;
  expiresAt: string;
};

const sessionKeyCache = new Map<string, SessionKeyMaterial>();

async function loadSessionKey(sessionId: string) {
  const cached = sessionKeyCache.get(sessionId);
  if (cached) {
    return cached;
  }

  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  const raw = window.sessionStorage.getItem(storageKey(sessionId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredSessionKey;
    const imported = await importSessionKey({
      rawKey: decodeBase64Url(parsed.rawKey),
      publicKey: parsed.publicKey,
      keyId: parsed.keyId,
    });
    sessionKeyCache.set(sessionId, imported);
    return imported;
  } catch {
    clearPersistedSessionKey(sessionId);
    return null;
  }
}

function persistSessionKey(sessionId: string, sessionKey: SessionKeyMaterial) {
  sessionKeyCache.set(sessionId, sessionKey);

  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  const payload: StoredSessionKey = {
    keyId: sessionKey.keyId,
    publicKey: sessionKey.publicKey,
    rawKey: encodeBase64Url(sessionKey.rawKey),
  };

  window.sessionStorage.setItem(storageKey(sessionId), JSON.stringify(payload));
}

function clearPersistedSessionKey(sessionId: string) {
  sessionKeyCache.delete(sessionId);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.removeItem(storageKey(sessionId));
  }
}

function storageKey(sessionId: string) {
  return `dropbeam-session-key:${sessionId}`;
}

function parseTicketValue(value?: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const encoded = url.hash.startsWith('#pair=') ? url.hash.slice('#pair='.length) : null;
    if (encoded) {
      return JSON.parse(decodeURIComponent(encoded)) as TicketPayload;
    }
  } catch {
    // Fall through to support direct JSON payloads.
  }

  try {
    return JSON.parse(value) as TicketPayload;
  } catch {
    return null;
  }
}

function isExpired(expiresAt?: string) {
  if (!expiresAt) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) ? timestamp <= Date.now() : false;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

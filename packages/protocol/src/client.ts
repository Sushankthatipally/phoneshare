import type {
  BackendEventEnvelope,
  BackendHealth,
  BackendSettings,
  ClipboardState,
  CreateSessionRequest,
  DashboardResponse,
  HistoryEntry,
  LiveSessionRecord,
  LiveTransferDirection,
  PairSessionRequest,
  StoredFileRecord,
  UpdateClipboardRequest,
  UpdateSettingsRequest,
  UploadSessionRecord,
} from './live-backend.js';

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
    return this.request<{ session: LiveSessionRecord }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/pair`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((response) => response.session);
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
    },
    onProgress?: (progress: number) => void,
  ) {
    const chunkSize = chooseChunkSize(file.size);
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

    for (let chunkIndex = upload.nextChunk; chunkIndex < upload.totalChunks; chunkIndex += 1) {
      const start = chunkIndex * upload.chunkSize;
      const end = Math.min(file.size, start + upload.chunkSize);
      const response = await fetch(
        `${this.origin}/api/uploads/${encodeURIComponent(upload.id)}/chunks/${chunkIndex}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file.slice(start, end),
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
    const response = await fetch(`${this.origin}${path}`, init);
    return this.readJson<T>(response);
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

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:17619`;
  }

  return 'http://127.0.0.1:17619';
}

function chooseChunkSize(size: number) {
  if (size >= 1024 * 1024 * 1024) {
    return 4 * 1024 * 1024;
  }

  if (size >= 128 * 1024 * 1024) {
    return 2 * 1024 * 1024;
  }

  return 512 * 1024;
}

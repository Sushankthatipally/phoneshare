import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

export interface HistoryEntry {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'failed';
  progress: number;
  error?: string;
  createdAt: number;
}

export interface ConnectionInfo {
  origin: string;
  token: string;
  label: string;
  // sessionId is set once paired (W14 hands it through after `/api/sessions/:id/connect`).
  // SSE-driven W15 features no-op when absent.
  sessionId?: string;
  peerName?: string;
}

export type BackendEvent =
  | { type: 'transfer-requested'; sessionId: string; batch: TransferBatch }
  | { type: 'transfer-accepted'; sessionId: string; batchId: string; fileIds: string[] }
  | { type: 'transfer-declined'; sessionId: string; batchId: string; reason: string | null }
  | { type: 'upload-progress'; upload: UploadProgress }
  | { type: 'file-uploaded'; session: { id: string }; file: { id: string; name: string; size: number } }
  | { type: 'session-paired'; session: { id: string } }
  | { type: 'session-closed'; session: { id: string } }
  | { type: string; [key: string]: unknown };

export interface TransferBatch {
  id: string;
  direction: string;
  sourceDeviceName: string | null;
  requestedAt: string;
  files: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    relativePath: string;
    lastModified: number | null;
  }>;
}

export interface UploadProgress {
  id: string;
  sessionId: string;
  direction: string;
  name: string;
  size: number;
  uploadedBytes: number;
  progressPercent: number;
  averageBytesPerSecond: number;
}

type EventListener = (event: BackendEvent) => void;

interface ConnectionContextValue {
  connection: ConnectionInfo | null;
  setConnection: (info: ConnectionInfo | null) => void;
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void;
  clearHistory: () => void;
  onboarded: boolean;
  deviceName: string;
  setDeviceName: (name: string) => void;
  markOnboarded: () => void;
  subscribe: (listener: EventListener) => () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [onboarded, setOnboarded] = useState(false);
  const [deviceName, setDeviceName] = useState('My Phone');

  const listenersRef = useRef<Set<EventListener>>(new Set());

  const subscribe = useCallback((listener: EventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // SSE subscription keyed by connection origin. Closes and reopens when origin changes.
  useEffect(() => {
    if (!connection?.origin) return;
    const cancel = openEventStream(connection.origin, (event) => {
      for (const listener of listenersRef.current) listener(event);
    });
    return cancel;
  }, [connection?.origin]);

  const addHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current]);
  }, []);

  const updateHistory = useCallback((id: string, patch: Partial<HistoryEntry>) => {
    setHistory((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);
  const markOnboarded = useCallback(() => setOnboarded(true), []);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      connection,
      setConnection,
      history,
      addHistory,
      updateHistory,
      clearHistory,
      onboarded,
      deviceName,
      setDeviceName,
      markOnboarded,
      subscribe,
    }),
    [
      connection,
      history,
      addHistory,
      updateHistory,
      clearHistory,
      onboarded,
      deviceName,
      markOnboarded,
      subscribe,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}

/**
 * Parse a desktop share URL (typically returned by the desktop's guest share endpoint).
 * Accepts forms:
 *   http://192.168.1.24:17619/guest/<token>
 *   http://192.168.1.24:17619/api/guest/<token>
 *   192.168.1.24:17619/guest/<token>  (no scheme)
 */
export function parseShareUrl(input: string): ConnectionInfo | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const match = url.pathname.match(/\/(?:api\/)?guest\/([^/]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const origin = `${url.protocol}//${url.host}`;
  return { origin, token, label: `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` };
}

/**
 * Minimal SSE reader for React Native. Uses XMLHttpRequest's `onprogress` to read
 * the response body incrementally — RN's fetch does not expose a streaming body on
 * all platforms, but XHR has supported partial responseText since RN 0.60+.
 *
 * Auto-reconnects with backoff on disconnect.
 */
function openEventStream(origin: string, onEvent: (event: BackendEvent) => void): () => void {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  let consumed = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  function connect() {
    if (cancelled) return;
    consumed = 0;
    xhr = new XMLHttpRequest();
    xhr.open('GET', `${origin}/api/events`, true);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');

    let buffer = '';
    xhr.onprogress = () => {
      if (!xhr) return;
      const fresh = xhr.responseText.slice(consumed);
      consumed = xhr.responseText.length;
      buffer += fresh;
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseBlock(block);
        if (event) onEvent(event);
        idx = buffer.indexOf('\n\n');
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt += 1;
      const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
      reconnectTimer = setTimeout(connect, delay);
    };

    xhr.onerror = scheduleReconnect;
    xhr.onloadend = scheduleReconnect;
    xhr.onreadystatechange = () => {
      if (xhr?.readyState === 4 && (xhr.status === 0 || xhr.status >= 400)) {
        scheduleReconnect();
      }
    };

    try {
      xhr.send();
      attempt = 0;
    } catch {
      scheduleReconnect();
    }
  }

  connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    }
  };
}

function parseSseBlock(block: string): BackendEvent | null {
  const lines = block.split('\n');
  let eventType: string | null = null;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    const parsed = JSON.parse(dataLines.join('\n')) as { type?: string; payload?: Record<string, unknown> };
    const type = parsed.type ?? eventType ?? 'message';
    return { type, ...(parsed.payload ?? {}) } as BackendEvent;
  } catch {
    return null;
  }
}

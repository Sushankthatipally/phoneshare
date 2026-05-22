import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

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
}

interface ConnectionContextValue {
  connection: ConnectionInfo | null;
  setConnection: (info: ConnectionInfo | null) => void;
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void;
  clearHistory: () => void;
  // Onboarding state
  onboarded: boolean;
  deviceName: string;
  setDeviceName: (name: string) => void;
  markOnboarded: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [onboarded, setOnboarded] = useState(false);
  const [deviceName, setDeviceName] = useState('My Phone');

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
    }),
    [connection, history, addHistory, updateHistory, clearHistory, onboarded, deviceName, markOnboarded],
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
  // Extract token from /guest/<token> or /api/guest/<token>
  const match = url.pathname.match(/\/(?:api\/)?guest\/([^/]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const origin = `${url.protocol}//${url.host}`;
  return { origin, token, label: `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` };
}

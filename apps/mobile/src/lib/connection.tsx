import AsyncStorage from '@react-native-async-storage/async-storage';
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
  /** Fingerprint of the peer this transfer targeted. Used for "Retry" + reconnect. */
  peerFingerprint?: string;
  /** Optional list of files when a transfer contained multiple assets. */
  files?: Array<{ name: string; size: number; uri?: string }>;
  /** Direction is recorded so the history detail can label the entry correctly. */
  direction?: 'send' | 'receive';
}

export interface ConnectionInfo {
  origin: string;
  token: string;
  label: string;
  /** Optional session id present once W14's pairing handshake completes. */
  sessionId?: string;
  /** Optional shared secret from the ECDH handshake (base64). */
  sharedSecret?: string;
  /** Fingerprint of the desktop, used for reconnect. */
  peerFingerprint?: string;
}

export interface KnownDevice {
  fingerprint: string;
  name: string;
  /** Last known origin (host:port). */
  origin: string;
  lastSeenAt: number;
}

export interface ClientSettings {
  clipboardSyncEnabled: boolean;
  backgroundReceiveEnabled: boolean;
  autoAcceptFingerprints: string[];
}

interface ConnectionContextValue {
  connection: ConnectionInfo | null;
  setConnection: (info: ConnectionInfo | null) => void;
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void;
  clearHistory: () => void;
  knownDevices: KnownDevice[];
  rememberDevice: (device: KnownDevice) => void;
  forgetDevice: (fingerprint: string) => void;
  settings: ClientSettings;
  updateSettings: (patch: Partial<ClientSettings>) => void;
  // Onboarding state
  onboarded: boolean;
  deviceName: string;
  setDeviceName: (name: string) => void;
  markOnboarded: () => void;
  /** True until the persisted state has been loaded from AsyncStorage. */
  hydrated: boolean;
}

const STORAGE_KEYS = {
  onboarded: 'dropbeam.onboarded',
  deviceName: 'dropbeam.deviceName',
  connection: 'dropbeam.connection',
  history: 'dropbeam.history',
  knownDevices: 'dropbeam.knownDevices',
  settings: 'dropbeam.settings',
} as const;

const DEFAULT_SETTINGS: ClientSettings = {
  clipboardSyncEnabled: false,
  backgroundReceiveEnabled: false,
  autoAcceptFingerprints: [],
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnectionState] = useState<ConnectionInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [knownDevices, setKnownDevices] = useState<KnownDevice[]>([]);
  const [onboarded, setOnboarded] = useState(false);
  const [deviceName, setDeviceNameState] = useState('My Phone');
  const [settings, setSettings] = useState<ClientSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate from AsyncStorage once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await AsyncStorage.getMany([
          STORAGE_KEYS.onboarded,
          STORAGE_KEYS.deviceName,
          STORAGE_KEYS.connection,
          STORAGE_KEYS.history,
          STORAGE_KEYS.knownDevices,
          STORAGE_KEYS.settings,
        ]);
        if (cancelled) return;
        if (map[STORAGE_KEYS.onboarded] === '1') setOnboarded(true);
        const storedName = map[STORAGE_KEYS.deviceName];
        if (storedName) setDeviceNameState(storedName);
        const conn = safeParse<ConnectionInfo>(map[STORAGE_KEYS.connection]);
        if (conn) setConnectionState(conn);
        const hist = safeParse<HistoryEntry[]>(map[STORAGE_KEYS.history]);
        if (Array.isArray(hist)) setHistory(hist);
        const known = safeParse<KnownDevice[]>(map[STORAGE_KEYS.knownDevices]);
        if (Array.isArray(known)) setKnownDevices(known);
        const sett = safeParse<ClientSettings>(map[STORAGE_KEYS.settings]);
        if (sett) setSettings({ ...DEFAULT_SETTINGS, ...sett });
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persistence effects (skip pre-hydration writes to avoid clobbering disk).
  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(STORAGE_KEYS.onboarded, onboarded ? '1' : '0');
  }, [onboarded]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(STORAGE_KEYS.deviceName, deviceName);
  }, [deviceName]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (connection) void AsyncStorage.setItem(STORAGE_KEYS.connection, JSON.stringify(connection));
    else void AsyncStorage.removeItem(STORAGE_KEYS.connection);
  }, [connection]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    // Cap history at 200 entries to keep AsyncStorage small.
    void AsyncStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(0, 200)));
  }, [history]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(STORAGE_KEYS.knownDevices, JSON.stringify(knownDevices));
  }, [knownDevices]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  const setConnection = useCallback((info: ConnectionInfo | null) => {
    setConnectionState(info);
    if (info?.peerFingerprint) {
      // Merge into known devices on a successful pairing.
      setKnownDevices((current) => {
        const without = current.filter((d) => d.fingerprint !== info.peerFingerprint);
        return [
          {
            fingerprint: info.peerFingerprint as string,
            name: info.label,
            origin: info.origin,
            lastSeenAt: Date.now(),
          },
          ...without,
        ];
      });
    }
  }, []);

  const addHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current]);
  }, []);

  const updateHistory = useCallback((id: string, patch: Partial<HistoryEntry>) => {
    setHistory((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);
  const rememberDevice = useCallback((device: KnownDevice) => {
    setKnownDevices((current) => {
      const without = current.filter((d) => d.fingerprint !== device.fingerprint);
      return [device, ...without];
    });
  }, []);
  const forgetDevice = useCallback((fingerprint: string) => {
    setKnownDevices((current) => current.filter((d) => d.fingerprint !== fingerprint));
  }, []);
  const updateSettings = useCallback((patch: Partial<ClientSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);
  const markOnboarded = useCallback(() => setOnboarded(true), []);
  const setDeviceName = useCallback((name: string) => setDeviceNameState(name), []);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      connection,
      setConnection,
      history,
      addHistory,
      updateHistory,
      clearHistory,
      knownDevices,
      rememberDevice,
      forgetDevice,
      settings,
      updateSettings,
      onboarded,
      deviceName,
      setDeviceName,
      markOnboarded,
      hydrated,
    }),
    [
      connection,
      history,
      addHistory,
      updateHistory,
      clearHistory,
      knownDevices,
      rememberDevice,
      forgetDevice,
      settings,
      updateSettings,
      onboarded,
      deviceName,
      setDeviceName,
      markOnboarded,
      hydrated,
      setConnection,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}

function safeParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

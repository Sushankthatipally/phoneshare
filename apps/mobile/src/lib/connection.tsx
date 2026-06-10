import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
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

import {
  deriveSessionKey,
  generateKeyAgreement,
  type KeyAgreementMaterial,
  type SessionKeyMaterial,
} from '@dropbeam/crypto-core/rn';
import type {
  ConnectSessionRequest,
  ConnectSessionResponse,
  DeviceIcon,
  DirectPairingPayload,
  HotspotPairingPayload,
} from '@dropbeam/protocol';

import type { DirectSessionPayload, HotspotSessionPayload } from './parseSessionPayload.js';

/**
 * Connection state for the mobile app — encrypted session only. Guest URL
 * pairing and SAS PIN entry were removed; tap-to-send via discovery TXT
 * records is the primary path, with manual IP / USB fallback.
 */

export type SessionKind = 'direct' | 'hotspot';

export type ConnectionState = 'idle' | 'connecting' | 'paired' | 'error';

export interface SecureSession {
  kind: SessionKind;
  sessionId: string;
  origin: string;
  label: string;
  /** Base64url of the raw 32-byte HKDF-derived session key. */
  sharedSecret: string;
  peerPublicKey: string;
  peerName?: string;
  peerFingerprint?: string;
  peerIcon?: DeviceIcon;
  pairedAt?: string;
}

export type ActiveConnection = SecureSession;
export type ConnectionInfo = SecureSession;

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
    relativePath: string | null;
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

export interface HistoryEntry {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'failed';
  progress: number;
  error?: string;
  createdAt: number;
  peerFingerprint?: string;
  direction?: 'send' | 'receive';
  files?: Array<{ name: string; size: number; uri?: string }>;
}

const STORAGE_KEY_SESSION = '@dropbeam/session-v1';
const STORAGE_KEY_DEVICE_NAME = '@dropbeam/device-name';
const STORAGE_KEY_ONBOARDED = '@dropbeam/onboarded';
const STORAGE_KEY_DEVICE_FINGERPRINT = '@dropbeam/device-fingerprint';

interface ConnectionContextValue {
  connection: ActiveConnection | null;
  state: ConnectionState;
  deviceFingerprint: string;
  deviceName: string;
  onboarded: boolean;
  history: HistoryEntry[];
  errorMessage: string | null;

  setDeviceName: (name: string) => void;
  markOnboarded: () => void;

  startDirectHandshake: (payload: DirectSessionPayload) => Promise<void>;
  startHotspotHandshake: (payload: HotspotSessionPayload) => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;

  addHistory: (entry: HistoryEntry) => void;
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void;
  clearHistory: () => void;

  subscribe: (listener: (event: BackendEvent) => void) => () => void;

  knownDevices: Array<{ fingerprint: string; name: string; origin: string }>;
  settings: { clipboardSyncEnabled: boolean; backgroundReceiveEnabled: boolean };
  setConnection: (connection: ActiveConnection | null) => void;
  hydrated: boolean;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function randomFingerprint(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const seg = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${seg()}${seg()}-${seg()}-${seg()}-${seg()}-${seg()}${seg()}${seg()}`;
}

interface PersistedSession {
  kind: SessionKind;
  sessionId: string;
  origin: string;
  label: string;
  sharedSecret: string;
  peerPublicKey: string;
  peerName?: string;
  peerFingerprint?: string;
  peerIcon?: DeviceIcon;
  pairedAt?: string;
}

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnectionRaw] = useState<ActiveConnection | null>(null);
  const [state, setState] = useState<ConnectionState>('idle');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [deviceName, setDeviceNameState] = useState(() => Device.deviceName ?? 'My phone');
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>(() => randomFingerprint());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionMaterialRef = useRef<{
    keyAgreement: KeyAgreementMaterial | null;
    sessionKey: SessionKeyMaterial | null;
    sessionId: string | null;
    origin: string | null;
  }>({ keyAgreement: null, sessionKey: null, sessionId: null, origin: null });

  const sseRef = useRef<{ close: () => void } | null>(null);
  const listenersRef = useRef<Set<(event: BackendEvent) => void>>(new Set());

  const subscribe = useCallback((listener: (event: BackendEvent) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const broadcastToListeners = useCallback((type: string, payload: unknown) => {
    const event = { type, ...((payload as Record<string, unknown>) ?? {}) } as BackendEvent;
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch {}
    }
  }, []);

  const persistSession = useCallback(async (session: SecureSession | null) => {
    if (!session) {
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
      return;
    }
    const record: PersistedSession = {
      kind: session.kind,
      sessionId: session.sessionId,
      origin: session.origin,
      label: session.label,
      sharedSecret: session.sharedSecret,
      peerPublicKey: session.peerPublicKey,
      peerName: session.peerName,
      peerFingerprint: session.peerFingerprint,
      peerIcon: session.peerIcon,
      pairedAt: session.pairedAt,
    };
    await AsyncStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(record));
  }, []);

  const setSecureConnection = useCallback(
    async (session: SecureSession, nextState: ConnectionState) => {
      setConnectionRaw(session);
      setState(nextState);
      setErrorMessage(null);
      await persistSession(session);
    },
    [persistSession],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedSession, storedName, storedOnboarded, storedFingerprint] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_SESSION),
          AsyncStorage.getItem(STORAGE_KEY_DEVICE_NAME),
          AsyncStorage.getItem(STORAGE_KEY_ONBOARDED),
          AsyncStorage.getItem(STORAGE_KEY_DEVICE_FINGERPRINT),
        ]);
        if (cancelled) return;

        if (storedFingerprint) {
          setDeviceFingerprint(storedFingerprint);
        } else {
          const fresh = randomFingerprint();
          setDeviceFingerprint(fresh);
          await AsyncStorage.setItem(STORAGE_KEY_DEVICE_FINGERPRINT, fresh);
        }

        if (storedName) setDeviceNameState(storedName);
        if (storedOnboarded === '1') setOnboarded(true);

        if (storedSession) {
          const parsed = JSON.parse(storedSession) as PersistedSession;
          setConnectionRaw({
            kind: parsed.kind,
            sessionId: parsed.sessionId,
            origin: parsed.origin,
            label: parsed.label,
            sharedSecret: parsed.sharedSecret,
            peerPublicKey: parsed.peerPublicKey,
            peerName: parsed.peerName,
            peerFingerprint: parsed.peerFingerprint,
            peerIcon: parsed.peerIcon,
            pairedAt: parsed.pairedAt,
          });
          setState('paired');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'failed to load persisted state');
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDeviceName = useCallback((name: string) => {
    setDeviceNameState(name);
    void AsyncStorage.setItem(STORAGE_KEY_DEVICE_NAME, name);
  }, []);

  const markOnboarded = useCallback(() => {
    setOnboarded(true);
    void AsyncStorage.setItem(STORAGE_KEY_ONBOARDED, '1');
  }, []);

  const addHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current]);
  }, []);

  const updateHistory = useCallback((id: string, patch: Partial<HistoryEntry>) => {
    setHistory((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const inferOrigin = useCallback((host: string, port: number) => `http://${host}:${port}`, []);
  const inferIcon = useCallback((): DeviceIcon => {
    if (Device.deviceType === Device.DeviceType.TABLET) return 'tablet';
    return 'phone';
  }, []);

  const subscribeSse = useCallback(
    (origin: string, sessionId: string, onEvent: (type: string, payload: unknown) => void) => {
      sseRef.current?.close();

      const controller = new AbortController();
      let closed = false;

      (async () => {
        try {
          // The backend exposes a single global event stream at /api/events —
          // there is no per-session stream. Listeners filter on sessionId in
          // the event payloads themselves.
          const response = await fetch(`${origin}/api/events`, {
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) return;
          const reader = (response.body as unknown as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              idx = buffer.indexOf('\n\n');
              let eventName = 'message';
              let dataLine = '';
              for (const line of chunk.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
              }
              if (!dataLine) continue;
              try {
                const parsed = JSON.parse(dataLine);
                const type = typeof parsed?.type === 'string' ? parsed.type : eventName;
                const payload = parsed?.payload ?? parsed;
                onEvent(type, payload);
                broadcastToListeners(type, payload);
              } catch {
                onEvent(eventName, dataLine);
                broadcastToListeners(eventName, { raw: dataLine });
              }
            }
          }
        } catch {
          // Network errors surface via state.
        }
      })();

      sseRef.current = {
        close: () => {
          closed = true;
          controller.abort();
        },
      };
    },
    [broadcastToListeners],
  );

  const runHandshake = useCallback(
    async (
      kind: SessionKind,
      payload: DirectPairingPayload | HotspotPairingPayload,
      label: string,
    ) => {
      console.info('[dropbeam] handshake start', { kind, sessionId: payload.sessionId, host: payload.host, port: payload.port });
      setState('connecting');
      setErrorMessage(null);

      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        setState('error');
        setErrorMessage('Pairing payload expired. Refresh discovery and try again.');
        return;
      }

      const origin = inferOrigin(payload.host, payload.port);
      let keyAgreement;
      let sessionKey;
      try {
        keyAgreement = await generateKeyAgreement();
        sessionKey = await deriveSessionKey({
          keyAgreement,
          remotePublicKey: payload.publicKey,
          sessionId: payload.sessionId,
        });
      } catch (err) {
        setState('error');
        setErrorMessage(err instanceof Error ? `key derivation: ${err.message}` : 'key derivation failed');
        return;
      }

      sessionMaterialRef.current = {
        keyAgreement,
        sessionKey,
        sessionId: payload.sessionId,
        origin,
      };

      const body: ConnectSessionRequest = {
        publicKey: keyAgreement.publicKey,
        deviceName,
        deviceIcon: inferIcon(),
        deviceFingerprint,
        platform: Device.osName === 'iOS' ? 'ios' : 'android',
      };

      const connectUrl = `${origin}/api/sessions/${encodeURIComponent(payload.sessionId)}/connect`;
      let connectResponse: ConnectSessionResponse;
      try {
        const res = await fetch(connectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<ConnectSessionResponse>;
        if (!res.ok || typeof json !== 'object' || json === null) {
          throw new Error(`HTTP ${res.status}`);
        }
        connectResponse = {
          ok: Boolean(json.ok),
          sessionId: json.sessionId ?? payload.sessionId,
          state: (json.state as ConnectSessionResponse['state']) ?? 'paired',
          serverPublicKey: typeof json.serverPublicKey === 'string' ? json.serverPublicKey : payload.publicKey,
          expiresAt: json.expiresAt ?? null,
        };
      } catch (err) {
        setState('error');
        setErrorMessage(err instanceof Error ? err.message : 'connect failed');
        return;
      }

      const session: SecureSession = {
        kind,
        sessionId: payload.sessionId,
        origin,
        label,
        sharedSecret: encodeBase64Url(sessionKey.rawKey),
        peerPublicKey: connectResponse.serverPublicKey,
        pairedAt: new Date().toISOString(),
      };

      await setSecureConnection(session, 'paired');
      subscribeSse(origin, payload.sessionId, () => undefined);
    },
    [deviceFingerprint, deviceName, inferIcon, inferOrigin, setSecureConnection, subscribeSse],
  );

  const startDirectHandshake = useCallback(
    async (payload: DirectSessionPayload) => {
      await runHandshake('direct', payload.payload, payload.label);
    },
    [runHandshake],
  );

  const startHotspotHandshake = useCallback(
    async (payload: HotspotSessionPayload) => {
      await runHandshake('hotspot', payload.payload, payload.label);
    },
    [runHandshake],
  );

  const disconnect = useCallback(async () => {
    sseRef.current?.close();
    sseRef.current = null;
    sessionMaterialRef.current = { keyAgreement: null, sessionKey: null, sessionId: null, origin: null };
    setConnectionRaw(null);
    setState('idle');
    setErrorMessage(null);
    await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
  }, []);

  useEffect(() => {
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, []);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      connection,
      state,
      deviceFingerprint,
      deviceName,
      onboarded,
      history,
      errorMessage,
      setDeviceName,
      markOnboarded,
      startDirectHandshake,
      startHotspotHandshake,
      disconnect,
      clearError,
      addHistory,
      updateHistory,
      clearHistory,
      subscribe,
      knownDevices: [],
      settings: { clipboardSyncEnabled: false, backgroundReceiveEnabled: false },
      setConnection: (next: ActiveConnection | null) => setConnectionRaw(next),
      hydrated,
    }),
    [
      addHistory,
      clearError,
      clearHistory,
      connection,
      deviceFingerprint,
      deviceName,
      disconnect,
      errorMessage,
      history,
      hydrated,
      markOnboarded,
      onboarded,
      setDeviceName,
      startDirectHandshake,
      startHotspotHandshake,
      state,
      subscribe,
      updateHistory,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export type { ParsedSessionPayload } from './parseSessionPayload.js';
export { parseSessionPayload } from './parseSessionPayload.js';

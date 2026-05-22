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
  derivePinCode,
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
  PinVerificationRequest,
  PinVerificationResponse,
} from '@dropbeam/protocol';

import type { DirectSessionPayload, GuestSessionPayload, HotspotSessionPayload } from './parseSessionPayload.js';

/**
 * Connection / session state machine for the mobile app.
 *
 * Three pairing flavours live in the same context:
 *   - guest      : legacy /guest/<token> HTTP share, no PIN, no ECDH.
 *   - direct     : Flow 2.1 — phone scans Wi-Fi/USB QR, runs ECDH + PIN.
 *   - hotspot    : Flow 2.4 — phone joins SSID, then runs the same handshake.
 *
 * The session is persisted to AsyncStorage so app restart resumes silently
 * (Flow 2.6). Only the resume token + sharedSecret + peer identity persist —
 * the X25519 private key is discarded after key derivation, per spec.
 */

export type SessionKind = 'guest' | 'direct' | 'hotspot';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'pin-required'
  | 'paired'
  | 'locked'
  | 'expired'
  | 'error';

export interface GuestConnection {
  kind: 'guest';
  origin: string;
  token: string;
  label: string;
  sessionId?: undefined;
  peerName?: undefined;
}

export interface SecureSession {
  kind: 'direct' | 'hotspot';
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

export type ActiveConnection = GuestConnection | SecureSession;

export type ConnectionInfo = GuestConnection | SecureSession;

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
  /** Currently active session — guest or secure — or null when idle. */
  connection: ActiveConnection | null;
  /** Detailed state machine for secure sessions. */
  state: ConnectionState;
  /** Local device's stable, persisted fingerprint (random UUID). */
  deviceFingerprint: string;
  /** Device name shown to peers; persisted to AsyncStorage. */
  deviceName: string;
  /** Onboarding flag, persisted. */
  onboarded: boolean;
  /** PIN-attempts remaining when state === 'pin-required'. */
  attemptsRemaining: number;
  /** PIN computed locally from the shared secret; set after ECDH. */
  pin: string | null;
  /** Files queued/uploaded since session start. */
  history: HistoryEntry[];
  /** Most recent error (auth fail, expired QR, network, etc.). */
  errorMessage: string | null;

  setDeviceName: (name: string) => void;
  markOnboarded: () => void;

  /** Establish a plain guest session from a parsed /guest/<token> URL. */
  attachGuestSession: (payload: GuestSessionPayload) => Promise<void>;
  /** Run the ECDH handshake against a direct pairing payload (Flow 2.1). */
  startDirectHandshake: (payload: DirectSessionPayload) => Promise<void>;
  /** Run the ECDH handshake against a hotspot pairing payload (Flow 2.4). */
  startHotspotHandshake: (payload: HotspotSessionPayload) => Promise<void>;
  /** Submit the 6-digit SAS PIN to the backend (Flow 4.1). */
  verifyPin: (pin: string) => Promise<PinVerificationResponse>;
  /** Drop the current session and clear persistence. */
  disconnect: () => Promise<void>;
  /** Clear non-fatal error state without dropping the session. */
  clearError: () => void;

  // Transfer history helpers (consumed by SendScreen)
  addHistory: (entry: HistoryEntry) => void;
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void;
  clearHistory: () => void;

  /** Subscribe to backend SSE events for the active session. */
  subscribe: (listener: (event: BackendEvent) => void) => () => void;

  /** Known devices for reconnect (stub — populated when W16 known-devices store lands). */
  knownDevices: Array<{ fingerprint: string; name: string; origin: string }>;
  /** Client-side settings (clipboardSync, backgroundReceive, autoAccept). */
  settings: { clipboardSyncEnabled: boolean; backgroundReceiveEnabled: boolean };
  /** Replace the active connection (used by share-receive / history-retry). */
  setConnection: (connection: ActiveConnection | null) => void;
  /** True once the persisted state has been loaded from AsyncStorage. */
  hydrated: boolean;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function randomFingerprint(): string {
  // Avoids importing node:crypto; uses Web Crypto polyfilled by quick-crypto.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback — Math.random based, only used when crypto isn't installed yet.
  const seg = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${seg()}${seg()}-${seg()}-${seg()}-${seg()}-${seg()}${seg()}${seg()}`;
}

interface PersistedSession {
  kind: 'direct' | 'hotspot';
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
  const [onboarded, setOnboarded] = useState(false);
  const [deviceName, setDeviceNameState] = useState(() => Device.deviceName ?? 'My phone');
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>(() => randomFingerprint());
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const [pin, setPin] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Per-session crypto material kept in a ref — never touched by React renders.
  const sessionMaterialRef = useRef<{
    keyAgreement: KeyAgreementMaterial | null;
    sessionKey: SessionKeyMaterial | null;
    sessionId: string | null;
    origin: string | null;
  }>({ keyAgreement: null, sessionKey: null, sessionId: null, origin: null });

  // SSE subscription kept in a ref so unmount can close it.
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

  // Hydrate from AsyncStorage on mount.
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
          const resumed: SecureSession = {
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
          };
          setConnectionRaw(resumed);
          setState('paired');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'failed to load persisted state');
        }
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

  // ---- Plain guest session ---------------------------------------------------

  const attachGuestSession = useCallback(
    async (payload: GuestSessionPayload) => {
      const guest: GuestConnection = {
        kind: 'guest',
        origin: payload.origin,
        token: payload.token,
        label: payload.label,
      };
      setConnectionRaw(guest);
      setState('paired');
      setErrorMessage(null);
      sessionMaterialRef.current = { keyAgreement: null, sessionKey: null, sessionId: null, origin: payload.origin };
      // Guest sessions don't persist — they're token-scoped.
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
    },
    [],
  );

  // ---- Secure ECDH handshake -------------------------------------------------

  const inferOrigin = useCallback((host: string, port: number) => `http://${host}:${port}`, []);
  const inferIcon = useCallback((): DeviceIcon => {
    if (Device.deviceType === Device.DeviceType.TABLET) return 'tablet';
    return 'phone';
  }, []);

  const subscribeSse = useCallback(
    (origin: string, sessionId: string, onEvent: (type: string, payload: unknown) => void) => {
      // Close any prior subscription.
      sseRef.current?.close();

      // EventSource is not built into React Native; we use fetch streaming.
      const controller = new AbortController();
      let closed = false;

      (async () => {
        try {
          const response = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/events`, {
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
          // Network errors are surfaced via state machine, not thrown here.
        }
      })();

      sseRef.current = {
        close: () => {
          closed = true;
          controller.abort();
        },
      };
    },
    [],
  );

  const runHandshake = useCallback(
    async (
      kind: 'direct' | 'hotspot',
      payload: DirectPairingPayload | HotspotPairingPayload,
      label: string,
    ) => {
      setState('connecting');
      setErrorMessage(null);
      setPin(null);

      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        setState('expired');
        setErrorMessage('This QR code has expired. Ask the sender to generate a new one.');
        return;
      }

      const origin = inferOrigin(payload.host, payload.port);
      const keyAgreement = await generateKeyAgreement();
      const sessionKey = await deriveSessionKey({
        keyAgreement,
        remotePublicKey: payload.publicKey,
        sessionId: payload.sessionId,
      });

      sessionMaterialRef.current = {
        keyAgreement,
        sessionKey,
        sessionId: payload.sessionId,
        origin,
      };

      const localPin = await derivePinCode(sessionKey.rawKey, payload.sessionId);
      setPin(localPin);

      const body: ConnectSessionRequest = {
        publicKey: keyAgreement.publicKey,
        deviceName,
        deviceIcon: inferIcon(),
        deviceFingerprint,
        platform: Device.osName === 'iOS' ? 'ios' : 'android',
      };

      let connectResponse: ConnectSessionResponse;
      try {
        const res = await fetch(`${origin}/api/sessions/${encodeURIComponent(payload.sessionId)}/connect`, {
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
          state: (json.state as ConnectSessionResponse['state']) ?? 'pin-required',
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
        peerName: undefined,
        peerFingerprint: undefined,
        peerIcon: undefined,
        pairedAt: undefined,
      };

      if (connectResponse.state === 'locked') {
        setConnectionRaw(session);
        setState('locked');
        setErrorMessage('This session is locked. Generate a new QR to try again.');
        return;
      }

      if (connectResponse.state === 'paired') {
        const paired: SecureSession = { ...session, pairedAt: new Date().toISOString() };
        await setSecureConnection(paired, 'paired');
        subscribeSse(origin, payload.sessionId, () => undefined);
        setAttemptsRemaining(3);
        return;
      }

      // pin-required: show PIN screen.
      setConnectionRaw(session);
      setState('pin-required');
      setAttemptsRemaining(3);
      subscribeSse(origin, payload.sessionId, (type) => {
        if (type === 'session-paired') {
          // Backend confirms PIN passed — handled by verifyPin too, but SSE wins if PIN
          // was entered on the desktop side as a fallback verification.
          const paired: SecureSession = { ...session, pairedAt: new Date().toISOString() };
          void setSecureConnection(paired, 'paired');
        } else if (type === 'session-locked') {
          setState('locked');
          setErrorMessage('Too many wrong attempts. Generate a new QR to try again.');
        } else if (type === 'session-expired') {
          setState('expired');
          setErrorMessage('Session expired before pairing finished.');
        }
      });
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

  const verifyPin = useCallback(
    async (submittedPin: string): Promise<PinVerificationResponse> => {
      const material = sessionMaterialRef.current;
      if (!material.sessionId || !material.origin || !(connection?.kind === 'direct' || connection?.kind === 'hotspot')) {
        const noSession: PinVerificationResponse = { ok: false, reason: 'invalid-session', attemptsRemaining: 0 };
        return noSession;
      }

      const body: PinVerificationRequest = {
        pin: submittedPin,
        deviceFingerprint,
      };

      let response: PinVerificationResponse;
      try {
        const res = await fetch(`${material.origin}/api/sessions/${encodeURIComponent(material.sessionId)}/pin-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<PinVerificationResponse>;
        if (json && typeof json === 'object' && 'ok' in json) {
          response = json as PinVerificationResponse;
        } else if (res.status === 423) {
          response = { ok: false, reason: 'locked', attemptsRemaining: 0 };
        } else {
          response = { ok: false, reason: 'mismatch', attemptsRemaining: Math.max(0, attemptsRemaining - 1) };
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'network error');
        return { ok: false, reason: 'mismatch', attemptsRemaining };
      }

      if (response.ok) {
        const paired: SecureSession = {
          ...connection,
          pairedAt: response.session.pairing?.verifiedAt ?? new Date().toISOString(),
        };
        await setSecureConnection(paired, 'paired');
        setAttemptsRemaining(3);
        return response;
      }

      if (response.reason === 'locked') {
        setState('locked');
        setErrorMessage('Too many wrong attempts. Generate a new QR to try again.');
      } else if (response.reason === 'expired') {
        setState('expired');
        setErrorMessage('Session expired. Generate a new QR.');
      } else if (response.reason === 'mismatch') {
        const remaining =
          typeof response.attemptsRemaining === 'number'
            ? response.attemptsRemaining
            : Math.max(0, attemptsRemaining - 1);
        setAttemptsRemaining(remaining);
      }
      return response;
    },
    [attemptsRemaining, connection, deviceFingerprint, setSecureConnection],
  );

  const disconnect = useCallback(async () => {
    sseRef.current?.close();
    sseRef.current = null;
    sessionMaterialRef.current = { keyAgreement: null, sessionKey: null, sessionId: null, origin: null };
    setConnectionRaw(null);
    setState('idle');
    setPin(null);
    setAttemptsRemaining(3);
    setErrorMessage(null);
    await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
  }, []);

  // Tear down SSE on unmount.
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
      attemptsRemaining,
      pin,
      history,
      errorMessage,
      setDeviceName,
      markOnboarded,
      attachGuestSession,
      startDirectHandshake,
      startHotspotHandshake,
      verifyPin,
      disconnect,
      clearError,
      addHistory,
      updateHistory,
      clearHistory,
      subscribe,
      knownDevices: [],
      settings: { clipboardSyncEnabled: false, backgroundReceiveEnabled: false },
      setConnection: (next: ActiveConnection | null) => setConnectionRaw(next),
      hydrated: true,
    }),
    [
      addHistory,
      attachGuestSession,
      attemptsRemaining,
      clearError,
      clearHistory,
      connection,
      deviceFingerprint,
      deviceName,
      disconnect,
      errorMessage,
      history,
      markOnboarded,
      onboarded,
      pin,
      setDeviceName,
      startDirectHandshake,
      startHotspotHandshake,
      state,
      subscribe,
      updateHistory,
      verifyPin,
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
 * Legacy helper preserved for `apps/mobile/app/index.tsx` style consumers.
 * Use `parseSessionPayload` (which supersedes this) for new code paths.
 */
export function parseShareUrl(input: string): GuestConnection | null {
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
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return {
    kind: 'guest',
    origin: `${url.protocol}//${url.host}`,
    token,
    label: `${url.hostname}:${port}`,
  };
}

// Helper kept private — encoding the rawKey for AsyncStorage persistence.
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export type { ParsedSessionPayload } from './parseSessionPayload.js';
export { parseSessionPayload } from './parseSessionPayload.js';

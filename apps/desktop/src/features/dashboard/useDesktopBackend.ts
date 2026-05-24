import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DropbeamBackendClient,
  resolveBackendOrigin,
  type BackendHealth,
  type ClipboardState,
  type DashboardResponse,
  type DiscoveryDeviceRecord,
  type HistoryEntry,
  type KnownDeviceRecord,
  type LiveSessionRecord,
  type ReconnectToKnownDeviceRequest,
  type TransferMode,
  type TrustedDeviceRecord,
  type UploadSessionRecord,
  type UpdateSettingsRequest,
} from '@dropbeam/protocol';

const BACKEND_ORIGIN = resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API);
console.info('[dropbeam] backend origin =', BACKEND_ORIGIN);
const client = new DropbeamBackendClient(BACKEND_ORIGIN);

function resolvePhoneOrigin(hostnameOverride?: string | null) {
  if (typeof window === 'undefined') return 'http://localhost:5174';
  if (import.meta.env.VITE_DROPBEAM_PHONE_ORIGIN) return import.meta.env.VITE_DROPBEAM_PHONE_ORIGIN;
  const hostname = hostnameOverride || window.location.hostname || 'localhost';
  return `${window.location.protocol}//${hostname}:5174`;
}

export function useDesktopBackend() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessions, setSessions] = useState<LiveSessionRecord[]>([]);
  const [devices, setDevices] = useState<DiscoveryDeviceRecord[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceRecord[]>([]);
  const [knownDevices, setKnownDevices] = useState<KnownDeviceRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ensureRef = useRef(false);

  const refresh = useCallback(async () => {
    const [nextHealth, nextDashboard, nextHistory, nextSessions, nextDevices] = await Promise.all([
      client.health(),
      client.dashboard(),
      client.history(),
      client.sessions(),
      client.discovery(),
    ]);
    setHealth(nextHealth);
    setDashboard(nextDashboard);
    setHistory(nextHistory);
    setSessions(nextSessions);
    setDevices(nextDevices);
    setTrustedDevices(nextDashboard.trustedDevices ?? []);
    setKnownDevices(nextDashboard.knownDevices ?? []);
    setSelectedSessionId((current) => {
      if (current && nextSessions.some((s) => s.id === current)) return current;
      return (
        nextSessions.find((s) => !['closed', 'completed', 'failed'].includes(s.state))?.id ??
        nextSessions[0]?.id ??
        null
      );
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        await refresh();
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load desktop backend');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const unsubscribe = client.subscribe(() => {
      void refresh().catch((eventError) => {
        if (!cancelled) setError(eventError instanceof Error ? eventError.message : 'Failed to refresh');
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const activeSession = useMemo(
    () =>
      sessions.find((s) => s.id === selectedSessionId) ??
      sessions.find((s) => !['closed', 'completed', 'failed'].includes(s.state)) ??
      null,
    [selectedSessionId, sessions],
  );

  const settings = dashboard?.settings ?? health?.settings ?? null;
  const clipboard: ClipboardState | null = dashboard?.clipboard ?? null;
  const activeUploads: UploadSessionRecord[] = dashboard?.activeUploads ?? [];

  /**
   * Internalized session creation — runs once at mount so discovery TXT records
   * carry a valid session id + public key. The UI never exposes this.
   */
  const ensureSession = useCallback(async () => {
    if (ensureRef.current) return;
    ensureRef.current = true;
    try {
      const existing = await client.sessions();
      const open = existing.find((s) => !['closed', 'completed', 'failed'].includes(s.state));
      if (open) return;
      const lanHost = devices.find((d) => d.local)?.host ?? null;
      await client.createSession({
        mode: settings?.preferredMode,
        deviceName: settings?.deviceName,
        deviceIcon: settings?.deviceIcon,
        origin: resolvePhoneOrigin(lanHost),
        backendOrigin: replaceOriginHostname(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API), lanHost),
      });
      await refresh();
    } catch (e) {
      console.warn('[dropbeam] ensureSession failed', e);
    }
  }, [devices, refresh, settings?.deviceIcon, settings?.deviceName, settings?.preferredMode]);

  useEffect(() => {
    if (loading) return;
    void ensureSession();
  }, [ensureSession, loading]);

  const reconnectKnownDevice = useCallback(
    async (fingerprint: string, input: { preferTransport?: TransferMode } = {}) => {
      setBusy('reconnect-known-device');
      setError(null);
      try {
        const lanHost = devices.find((d) => d.local)?.host ?? null;
        const session = await client.reconnectKnownDevice(fingerprint, {
          ...input,
          deviceName: settings?.deviceName,
          origin: resolvePhoneOrigin(lanHost),
          backendOrigin: replaceOriginHostname(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API), lanHost),
        } satisfies ReconnectToKnownDeviceRequest);
        setSelectedSessionId(session.id);
        await refresh();
        return session;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to reconnect');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [devices, refresh, settings?.deviceName],
  );

  const acceptIncoming = useCallback(
    async (sessionId: string, trust = false) => {
      setBusy('accept-session');
      try {
        await client.acceptSession(sessionId, trust);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to accept');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const declineIncoming = useCallback(
    async (sessionId: string, reason = 'declined') => {
      setBusy('decline-session');
      try {
        await client.declineSession(sessionId, reason);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to decline');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const closeSession = useCallback(async () => {
    if (!activeSession) return;
    setBusy('close-session');
    try {
      await client.closeSession(activeSession.id, 'Closed from desktop UI');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close');
    } finally {
      setBusy(null);
    }
  }, [activeSession, refresh]);

  const updateSettings = useCallback(
    async (patch: UpdateSettingsRequest) => {
      setBusy('update-settings');
      try {
        await client.updateSettings(patch);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save settings');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const updateClipboard = useCallback(
    async (text: string) => {
      setBusy('update-clipboard');
      try {
        await client.updateClipboard({
          text,
          sourceDeviceName: settings?.deviceName ?? 'DropBeam Desktop',
          sourceRole: 'desktop',
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to sync clipboard');
      } finally {
        setBusy(null);
      }
    },
    [refresh, settings?.deviceName],
  );

  const setTrusted = useCallback(
    async (fingerprint: string, autoAccept = true) => {
      await client.setTrustedDevice(fingerprint, autoAccept);
      await refresh();
    },
    [refresh],
  );

  const removeTrusted = useCallback(
    async (fingerprint: string) => {
      await client.removeTrustedDevice(fingerprint);
      await refresh();
    },
    [refresh],
  );

  return {
    activeSession,
    activeUploads,
    busy,
    clipboard,
    dashboard,
    devices,
    error,
    health,
    history,
    knownDevices,
    loading,
    selectedSessionId,
    sessions,
    settings,
    trustedDevices,
    acceptIncoming,
    closeSession,
    declineIncoming,
    downloadFile: client.downloadFile.bind(client),
    downloadUrl: client.downloadUrl.bind(client),
    benchmarkSend: client.benchmarkSend.bind(client),
    benchmarkReceive: client.benchmarkReceive.bind(client),
    reconnectKnownDevice,
    refresh,
    removeTrusted,
    setSelectedSessionId,
    setTrusted,
    updateClipboard,
    updateSettings,
    uploadFile: client.uploadFile.bind(client),
    peerStorage: client.peerStorage.bind(client),
    subscribeEvent: (handler: (event: { type: string; [key: string]: unknown }) => void) =>
      client.subscribe((envelope) => handler(envelope as unknown as { type: string; [key: string]: unknown })),
  };
}

export type DesktopBackendState = ReturnType<typeof useDesktopBackend>;

function replaceOriginHostname(origin: string, hostnameOverride?: string | null) {
  if (!hostnameOverride) return origin;
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0') {
      url.hostname = hostnameOverride;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return origin;
  }
}

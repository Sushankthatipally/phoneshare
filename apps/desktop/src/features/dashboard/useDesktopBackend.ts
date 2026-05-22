import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DropbeamBackendClient,
  resolveBackendOrigin,
  type BackendHealth,
  type BackendSettings,
  type ClipboardState,
  type DashboardResponse,
  type DiscoveryDeviceRecord,
  type GuestShareSummary,
  type HistoryEntry,
  type KnownDeviceRecord,
  type LiveSessionRecord,
  type TrustedDeviceRecord,
  type UploadSessionRecord,
  type UpdateSettingsRequest,
} from '@dropbeam/protocol';

const client = new DropbeamBackendClient(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API));

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
  const [guestShares, setGuestShares] = useState<GuestShareSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setGuestShares(nextDashboard.guestShares ?? []);
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

  const createSession = useCallback(
    async (input: { mode?: 'wifi' | 'usb' | 'hotspot'; multiDevice?: boolean; maxDevices?: number } = {}) => {
      setBusy('create-session');
      setError(null);
      try {
        const lanHost = devices.find((d) => d.local)?.host ?? null;
        const session = await client.createSession({
          mode: input.mode ?? settings?.preferredMode,
          deviceName: settings?.deviceName,
          deviceIcon: settings?.deviceIcon,
          multiDevice: input.multiDevice,
          maxDevices: input.maxDevices,
          origin: resolvePhoneOrigin(lanHost),
          backendOrigin: replaceOriginHostname(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API), lanHost),
        });
        setSelectedSessionId(session.id);
        await refresh();
        return session;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create session');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [devices, refresh, settings?.deviceIcon, settings?.deviceName, settings?.preferredMode],
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

  const regenerateSession = useCallback(
    async (sessionId: string) => {
      setBusy('regenerate-session');
      try {
        await client.regenerateSession(sessionId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to regenerate');
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

  const createGuestShare = useCallback(
    async (input: { ttlMs?: number; maxUses?: number }, files: File[]) => {
      setBusy('create-guest');
      try {
        const share = await client.createGuestShare(input);
        for (const file of files) {
          await client.addGuestFile(share.token, file);
        }
        await refresh();
        return share;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create guest share');
        return null;
      } finally {
        setBusy(null);
      }
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
    guestShares,
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
    createGuestShare,
    createSession,
    declineIncoming,
    downloadFile: client.downloadFile.bind(client),
    downloadUrl: client.downloadUrl.bind(client),
    guestUrl: client.guestUrl.bind(client),
    benchmarkSend: client.benchmarkSend.bind(client),
    benchmarkReceive: client.benchmarkReceive.bind(client),
    refresh,
    regenerateSession,
    removeTrusted,
    setSelectedSessionId,
    setTrusted,
    updateClipboard,
    updateSettings,
    uploadFile: client.uploadFile.bind(client),
    peerStorage: client.peerStorage.bind(client),
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

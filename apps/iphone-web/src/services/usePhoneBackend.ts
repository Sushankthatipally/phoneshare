import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DropbeamBackendClient,
  resolveBackendOrigin,
  type BackendHealth,
  type ClipboardState,
  type DashboardResponse,
  type LiveSessionRecord,
  type UploadSessionRecord,
} from '@dropbeam/protocol';

const client = new DropbeamBackendClient(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API));

export function usePhoneBackend() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [sessions, setSessions] = useState<LiveSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextHealth, nextDashboard, nextSessions] = await Promise.all([
      client.health(),
      client.dashboard(),
      client.sessions(),
    ]);
    setHealth(nextHealth);
    setDashboard(nextDashboard);
    setSessions(nextSessions);
    setSelectedSessionId((current) => {
      const requestedSessionId = resolveRequestedSessionId();
      if (requestedSessionId && nextSessions.some((session) => session.id === requestedSessionId)) {
        return requestedSessionId;
      }
      if (current && nextSessions.some((session) => session.id === current)) {
        return current;
      }
      return (
        nextSessions.find((session) => session.state !== 'closed' && session.state !== 'completed')?.id ??
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
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load phone backend');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const unsubscribe = client.subscribe(() => {
      void refresh().catch((eventError) => {
        if (!cancelled) {
          setError(eventError instanceof Error ? eventError.message : 'Failed to refresh phone state');
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [selectedSessionId, sessions],
  );
  const clipboard: ClipboardState | null = dashboard?.clipboard ?? null;
  const activeUploads: UploadSessionRecord[] = dashboard?.activeUploads ?? [];

  const pairSession = useCallback(
    async (pin: string) => {
      if (!activeSession) {
        setError('Choose a session before pairing.');
        return;
      }

      setBusy('pair-session');
      setError(null);

      try {
        await client.pairSession(activeSession.id, {
          pin,
          deviceName: 'iPhone Safari',
          deviceIcon: 'phone',
          kind: 'iphone',
          platform: 'ios',
          transport: activeSession.mode,
        });
        await refresh();
      } catch (pairError) {
        setError(pairError instanceof Error ? pairError.message : 'Pairing failed');
      } finally {
        setBusy(null);
      }
    },
    [activeSession, refresh],
  );

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!activeSession?.pairing.verifiedAt) {
        setError('Pair the phone before uploading files.');
        return;
      }

      setBusy('upload-files');
      setError(null);

      try {
        for (const file of Array.from(files)) {
          await client.uploadFile(activeSession.id, 'phone-to-desktop', file, {
            deviceName: 'iPhone Safari',
          });
        }
        await refresh();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Phone upload failed');
      } finally {
        setBusy(null);
      }
    },
    [activeSession, refresh],
  );

  return {
    activeSession,
    activeUploads,
    busy,
    clipboard,
    dashboard,
    error,
    health,
    loading,
    sessions,
    setSelectedSessionId,
    pairSession,
    refresh,
    updateClipboard: async (text: string) => {
      setBusy('update-clipboard');
      setError(null);

      try {
        await client.updateClipboard({
          text,
          sourceDeviceName: 'iPhone Safari',
          sourceRole: 'phone',
        });
        await refresh();
      } catch (clipboardError) {
        setError(clipboardError instanceof Error ? clipboardError.message : 'Clipboard sync failed');
      } finally {
        setBusy(null);
      }
    },
    uploadFiles,
    downloadUrl: client.downloadUrl.bind(client),
  };
}

export type PhoneBackendState = ReturnType<typeof usePhoneBackend>;

function resolveRequestedSessionId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const pathMatch = window.location.pathname.match(/^\/pair\/([^/]+)/);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]);
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('session');
}

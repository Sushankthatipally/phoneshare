import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DropbeamBackendClient,
  resolveBackendOrigin,
  type BackendHealth,
  type BackendSettings,
  type ClipboardState,
  type DashboardResponse,
  type HistoryEntry,
  type LiveSessionRecord,
  type UploadSessionRecord,
  type UpdateSettingsRequest,
} from '@dropbeam/protocol';

const client = new DropbeamBackendClient(resolveBackendOrigin(import.meta.env.VITE_DROPBEAM_API));

function resolvePhoneOrigin() {
  if (typeof window === 'undefined') {
    return 'http://localhost:5174';
  }

  if (import.meta.env.VITE_DROPBEAM_PHONE_ORIGIN) {
    return import.meta.env.VITE_DROPBEAM_PHONE_ORIGIN;
  }

  return `${window.location.protocol}//${window.location.hostname}:5174`;
}

export function useDesktopBackend() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessions, setSessions] = useState<LiveSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextHealth, nextDashboard, nextHistory, nextSessions] = await Promise.all([
      client.health(),
      client.dashboard(),
      client.history(),
      client.sessions(),
    ]);

    setHealth(nextHealth);
    setDashboard(nextDashboard);
    setHistory(nextHistory);
    setSessions(nextSessions);
    setSelectedSessionId((current) => {
      if (current && nextSessions.some((session) => session.id === current)) {
        return current;
      }

      return (
        nextSessions.find((session) => !['closed', 'completed', 'failed'].includes(session.state))?.id ??
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
          setError(loadError instanceof Error ? loadError.message : 'Failed to load desktop backend');
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
          setError(eventError instanceof Error ? eventError.message : 'Failed to refresh live session state');
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const activeSession = useMemo(
    () =>
      sessions.find((session) => session.id === selectedSessionId) ??
      sessions.find(
        (session) =>
          session.state !== 'closed' &&
          session.state !== 'completed' &&
          session.state !== 'failed',
      ) ??
      null,
    [selectedSessionId, sessions],
  );

  const settings = dashboard?.settings ?? health?.settings ?? null;
  const clipboard: ClipboardState | null = dashboard?.clipboard ?? null;
  const activeUploads: UploadSessionRecord[] = dashboard?.activeUploads ?? [];

  const createSession = useCallback(async () => {
    setBusy('create-session');
    setError(null);

    try {
      await client.createSession({
        mode: settings?.preferredMode,
        deviceName: settings?.deviceName,
        deviceIcon: settings?.deviceIcon,
        origin: resolvePhoneOrigin(),
      });
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create session');
    } finally {
      setBusy(null);
    }
  }, [refresh, settings?.deviceIcon, settings?.deviceName, settings?.preferredMode]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!activeSession) {
        setError('Create and pair a session before uploading desktop files.');
        return;
      }

      setBusy('upload-files');
      setError(null);

      try {
        for (const file of Array.from(files)) {
          await client.uploadFile(
            activeSession.id,
            'desktop-to-phone',
            file,
            {
              deviceName: settings?.deviceName ?? 'DropBeam Desktop',
              relativePath: getRelativePath(file),
            },
          );
        }
        await refresh();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Desktop upload failed');
      } finally {
        setBusy(null);
      }
    },
    [activeSession, refresh, settings?.deviceName],
  );

  const closeSession = useCallback(async () => {
    if (!activeSession) {
      return;
    }

    setBusy('close-session');
    setError(null);

    try {
      await client.closeSession(activeSession.id, 'Closed from desktop UI');
      await refresh();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Failed to close session');
    } finally {
      setBusy(null);
    }
  }, [activeSession, refresh]);

  const updateSettings = useCallback(
    async (patch: UpdateSettingsRequest) => {
      setBusy('update-settings');
      setError(null);

      try {
        await client.updateSettings(patch);
        await refresh();
      } catch (settingsError) {
        setError(settingsError instanceof Error ? settingsError.message : 'Failed to update settings');
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
    error,
    health,
    history,
    loading,
    selectedSessionId,
    sessions,
    settings,
    closeSession,
    createSession,
    downloadUrl: client.downloadUrl.bind(client),
    refresh,
    setSelectedSessionId,
    updateSettings,
    updateClipboard: async (text: string) => {
      setBusy('update-clipboard');
      setError(null);

      try {
        await client.updateClipboard({
          text,
          sourceDeviceName: settings?.deviceName ?? 'DropBeam Desktop',
          sourceRole: 'desktop',
        });
        await refresh();
      } catch (clipboardError) {
        setError(clipboardError instanceof Error ? clipboardError.message : 'Failed to sync clipboard');
      } finally {
        setBusy(null);
      }
    },
    uploadFiles,
  };
}

export type DesktopBackendState = ReturnType<typeof useDesktopBackend>;

function getRelativePath(file: File) {
  const candidate = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return candidate?.trim() ? candidate : undefined;
}

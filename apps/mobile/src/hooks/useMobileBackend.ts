import { useCallback, useMemo } from 'react';

import { useConnection } from '../lib/connection.js';
import { useDiscovery, type DiscoveredPeer } from '../lib/discovery.js';
import { DEFAULT_PORT } from '../services/tcp.js';
import { formatBytes, resolveChunkSize, type TransferDirection } from '../services/transfer.js';
import type { TransportMode } from '../services/crypto.js';

/**
 * `useMobileBackend` is the glue for legacy dev-harness screens. The mock
 * beacons, mock transfers, and mock history entries that lived here were
 * removed in W14 — every value now comes from the real connection context
 * or the real mDNS discovery hook. UI surfaces that expect a value the
 * backend doesn't yet provide must render an explicit empty state.
 */

export type ConnectionMode = 'qr' | 'lan' | 'hotspot' | 'usb';

export interface MobileHistoryEntry {
  id: string;
  name: string;
  sizeLabel: string;
  direction: TransferDirection;
  mode: TransportMode;
  completedAtLabel: string;
}

export interface MobileBackendState {
  beacons: DiscoveredPeer[];
  chunkSizeLabel: string;
  connectionLabel: string;
  connectionMode: ConnectionMode;
  discoveryLabel: string;
  history: MobileHistoryEntry[];
  loading: boolean;
  sessionLabel: string;
  sessionTicket: string | null;
  transfers: never[];
  markHistory: (name: string, size: number, direction: TransferDirection, mode: TransportMode) => void;
  refresh: () => void;
  selectConnectionMode: (mode: ConnectionMode) => void;
}

function resolveTransport(mode: ConnectionMode): TransportMode {
  switch (mode) {
    case 'hotspot':
      return 'hotspot';
    case 'usb':
      return 'usb';
    default:
      return 'wifi';
  }
}

function formatTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ms).toLocaleTimeString();
}

export function useMobileBackend(): MobileBackendState {
  const { connection, state, history, addHistory } = useConnection();
  const discovery = useDiscovery();

  // Legacy harness exposes a single `connectionMode`; with real state we
  // simply derive it from the active session and surface it as read-only.
  const connectionMode: ConnectionMode = useMemo(() => {
    if (!connection) return 'qr';
    if (connection.kind === 'guest') return 'qr';
    if (connection.kind === 'hotspot') return 'hotspot';
    return 'lan';
  }, [connection]);

  const transport = resolveTransport(connectionMode);
  const chunkSizeLabel = `${formatBytes(resolveChunkSize(transport))} chunks`;

  const connectionLabel = useMemo(() => {
    if (!connection) return 'Not connected';
    return `${connection.kind.toUpperCase()} · ${connection.label}`;
  }, [connection]);

  const sessionLabel = useMemo(() => {
    if (!connection) return 'No session';
    if (connection.kind === 'guest') return `Guest · ${connection.token.slice(0, 6)}`;
    return `Session ${connection.sessionId.slice(0, 8)}`;
  }, [connection]);

  const sessionTicket = useMemo(() => {
    if (!connection || connection.kind === 'guest') return null;
    // Surface the session id only — the QR's full payload is owned by the desktop side.
    return connection.sessionId;
  }, [connection]);

  const discoveryLabel = useMemo(() => {
    if (!discovery.available) return 'mDNS unavailable — rebuild the native shell to enable nearby discovery.';
    if (discovery.scanning) {
      return discovery.peers.length
        ? `${discovery.peers.length} device${discovery.peers.length === 1 ? '' : 's'} on _dropbeam._tcp`
        : 'Scanning _dropbeam._tcp on this network…';
    }
    return discovery.peers.length ? `${discovery.peers.length} discovered` : 'No nearby devices.';
  }, [discovery]);

  const mobileHistory: MobileHistoryEntry[] = useMemo(
    () =>
      history.map((entry) => ({
        id: entry.id,
        name: entry.name,
        sizeLabel: formatBytes(entry.size),
        direction: 'phone-to-desktop' as const,
        mode: transport,
        completedAtLabel: formatTimeAgo(entry.createdAt),
      })),
    [history, transport],
  );

  const markHistory = useCallback(
    (name: string, size: number) => {
      addHistory({
        id: `${Date.now()}-${name}`,
        name,
        size,
        status: 'done',
        progress: 100,
        createdAt: Date.now(),
      });
    },
    [addHistory],
  );

  const refresh = useCallback(() => {
    // Discovery refreshes itself via the mDNS subscription; there is no
    // imperative "rescan" hook on react-native-zeroconf without restarting
    // the scan. We accept the legacy noop here rather than fabricate state.
  }, []);

  const selectConnectionMode = useCallback(() => {
    // Connection mode is driven by the actual session; the legacy harness's
    // setter is intentionally a noop now.
  }, []);

  return {
    beacons: discovery.peers,
    chunkSizeLabel,
    connectionLabel,
    connectionMode,
    discoveryLabel,
    history: mobileHistory,
    loading: state === 'connecting',
    sessionLabel,
    sessionTicket,
    transfers: [],
    markHistory,
    refresh,
    selectConnectionMode,
  };
}

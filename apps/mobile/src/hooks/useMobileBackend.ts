import { useMemo, useState } from 'react';

import {
  createDeviceFingerprint,
  createHandshakePayload,
  createSessionId,
  describeEncryptionPlan,
  encodeSessionTicket,
  type TransportMode,
} from '../services/crypto.js';
import {
  createHotspotConfig,
  describeHotspotSupport,
} from '../services/hotspot.js';
import {
  createDiscoveryBeacon,
  describeDiscoveryLane,
  type DiscoveryBeacon,
} from '../services/mdns.js';
import { createTcpEndpoint, describeTcpEndpoint, DEFAULT_PORT } from '../services/tcp.js';
import {
  buildTransferJobs,
  formatBytes,
  resolveChunkSize,
  type TransferDirection,
  type TransferDraft,
  type TransferJob,
} from '../services/transfer.js';

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
  beacons: DiscoveryBeacon[];
  chunkSizeLabel: string;
  connectionLabel: string;
  connectionMode: ConnectionMode;
  discoveryLabel: string;
  history: MobileHistoryEntry[];
  loading: boolean;
  sessionLabel: string;
  sessionTicket: string;
  transfers: TransferJob[];
  advanceTransfer: (jobId: string) => void;
  markHistory: (name: string, size: number, direction: TransferDirection, mode: TransportMode) => void;
  queueFiles: (drafts: TransferDraft[]) => void;
  refresh: () => void;
  selectConnectionMode: (mode: ConnectionMode) => void;
}

const DEVICE_NAME = 'DropBeam Mobile';

export function useMobileBackend(): MobileBackendState {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('qr');
  const [refreshTick, setRefreshTick] = useState(0);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [history, setHistory] = useState<MobileHistoryEntry[]>([
    {
      id: 'history-1',
      name: 'Release notes.pdf',
      sizeLabel: formatBytes(1_200_000),
      direction: 'phone-to-desktop',
      mode: 'wifi',
      completedAtLabel: 'Just now',
    },
  ]);

  const transport = resolveTransportMode(connectionMode);
  const beacons = useMemo(() => buildBeacons(transport, refreshTick), [transport, refreshTick]);
  const sessionId = useMemo(() => createSessionId(0xDBEA0000 + refreshTick + 1), [refreshTick]);
  const fingerprint = useMemo(() => createDeviceFingerprint(DEVICE_NAME, 'android'), []);

  const sessionTicket = useMemo(() => {
    const primaryHost = beacons[0]?.host ?? (transport === 'hotspot' ? '192.168.43.1' : '192.168.1.24');
    const payload = createHandshakePayload({
      deviceName: DEVICE_NAME,
      deviceType: 'android',
      sessionId,
      host: primaryHost,
      port: DEFAULT_PORT,
      mode: transport,
    });

    return encodeSessionTicket(payload);
  }, [beacons, sessionId, transport]);

  const sessionLabel = `Session ${fingerprint.slice(0, 6).toUpperCase()}-${sessionId.toString(16).slice(-4).toUpperCase()}`;
  const chunkSizeLabel = `${formatBytes(resolveChunkSize(transport))} chunks`;
  const endpoint = createTcpEndpoint({
    host: beacons[0]?.host ?? (transport === 'hotspot' ? '192.168.43.1' : '192.168.1.24'),
    port: DEFAULT_PORT,
    mode: transport,
  });
  const discoveryLabel = buildDiscoveryLabel(connectionMode, beacons);
  const connectionLabel = `${transport.toUpperCase()} · ${describeTcpEndpoint(endpoint)}`;

  return {
    beacons,
    chunkSizeLabel,
    connectionLabel,
    connectionMode,
    discoveryLabel,
    history,
    loading: false,
    sessionLabel,
    sessionTicket,
    transfers,
    advanceTransfer: (jobId) => {
      let completedJob: TransferJob | null = null;

      setTransfers((current) =>
        current.map((job) => {
          if (job.id !== jobId) {
            return job;
          }

          completedJob = {
            ...job,
            progress: 100,
            state: 'complete',
          };
          return completedJob;
        }),
      );

      if (completedJob) {
        setHistory((current) => [
          {
            id: completedJob!.id,
            name: completedJob!.name,
            sizeLabel: completedJob!.sizeLabel,
            direction: completedJob!.direction,
            mode: completedJob!.mode,
            completedAtLabel: 'Just now',
          },
          ...current,
        ]);
      }
    },
    markHistory: (name, size, direction, mode) => {
      setHistory((current) => [
        {
          id: `history-${current.length + 1}`,
          name,
          sizeLabel: formatBytes(size),
          direction,
          mode,
          completedAtLabel: 'Just now',
        },
        ...current,
      ]);
    },
    queueFiles: (drafts) => {
      setTransfers((current) => [
        ...current,
        ...buildTransferJobs(drafts, 'phone-to-desktop', transport, current.length),
      ]);
    },
    refresh: () => {
      setRefreshTick((current) => current + 1);
    },
    selectConnectionMode: (mode) => {
      setConnectionMode(mode);
    },
  };
}

function resolveTransportMode(mode: ConnectionMode): TransportMode {
  switch (mode) {
    case 'hotspot':
      return 'hotspot';
    case 'usb':
      return 'usb';
    default:
      return 'wifi';
  }
}

function buildBeacons(mode: TransportMode, refreshTick: number): DiscoveryBeacon[] {
  if (mode === 'usb') {
    return [
      createDiscoveryBeacon({
        id: 'desktop-usb',
        name: 'Studio Desktop',
        host: '127.0.0.1',
        port: DEFAULT_PORT,
        mode,
        signal: 'strong',
        lastSeenLabel: `usb ready ${refreshTick + 1}`,
      }),
    ];
  }

  if (mode === 'hotspot') {
    return [
      createDiscoveryBeacon({
        id: 'desktop-hotspot',
        name: 'DropBeam Host',
        host: '192.168.43.1',
        port: DEFAULT_PORT,
        mode,
        signal: 'good',
        lastSeenLabel: `tap ${refreshTick + 1}`,
      }),
    ];
  }

  return [
    createDiscoveryBeacon({
      id: 'desktop-primary',
      name: 'Studio Desktop',
      host: '192.168.1.24',
      port: DEFAULT_PORT,
      mode,
      signal: 'strong',
      lastSeenLabel: 'just now',
    }),
    createDiscoveryBeacon({
      id: 'desktop-lab',
      name: 'Editing Laptop',
      host: '192.168.1.57',
      port: DEFAULT_PORT,
      mode,
      signal: 'good',
      lastSeenLabel: `${refreshTick + 2}s ago`,
    }),
  ];
}

function buildDiscoveryLabel(mode: ConnectionMode, beacons: DiscoveryBeacon[]) {
  if (mode === 'hotspot') {
    return `${describeDiscoveryLane(beacons)} ${describeHotspotSupport()}`;
  }

  if (mode === 'usb') {
    return 'USB tunneling keeps the native path ready when Wi-Fi discovery is unavailable.';
  }

  return `${describeDiscoveryLane(beacons)} ${describeEncryptionPlan()}`;
}

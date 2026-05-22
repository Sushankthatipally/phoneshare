import type { FileDescriptor } from './packets.js';
import type { DeviceKind, TransferMode } from './session.js';

export type PairingTransport = 'usb' | 'wifi' | 'hotspot';

export interface DirectPairingPayload {
  mode: 'usb' | 'wifi';
  sessionId: string;
  transport: Exclude<PairingTransport, 'hotspot'>;
  host: string;
  port: number;
  publicKey: string;
  expiresAt: string;
}

export interface HotspotPairingPayload {
  mode: 'hotspot';
  sessionId: string;
  ssid: string;
  password: string;
  host: string;
  port: number;
  publicKey: string;
  expiresAt: string;
  band?: '2.4GHz' | '5GHz' | null;
}

export type PairingPayload = DirectPairingPayload | HotspotPairingPayload;


export type DeviceIcon = 'desktop' | 'laptop' | 'phone' | 'tablet';

export interface SessionTicket {
  sessionId: string;
  qrValue: string;
  pairingUrl: string;
  guestAllowed?: boolean;
  expiresAt?: string | null;
  hotspot?: HotspotPairingPayload | null;
}

export type MultiDeviceSlotStatus = 'open' | 'pending' | 'connected' | 'denied';

export interface MultiDeviceSlot {
  index: number;
  status: MultiDeviceSlotStatus;
  device?: {
    name: string;
    platform: string;
    icon?: DeviceIcon | null;
    fingerprint?: string | null;
  } | null;
  pendingRequestId?: string | null;
  connectedAt?: string | null;
  deniedAt?: string | null;
  deniedReason?: string | null;
}

export interface MultiDeviceSession {
  multiDevice: true;
  maxDevices: number;
  slots: MultiDeviceSlot[];
}

export interface DiscoveryDeviceRecord {
  id: string;
  name: string;
  icon: DeviceIcon;
  platform: string;
  host: string;
  port: number;
  serviceOrigin: string;
  transport: TransferMode;
  source: string;
  seenAt: string;
  expiresAt: string;
  local: boolean;
  transports?: string[];
  version?: string;
  label?: string;
}

export interface DiscoveryStatus {
  enabled: boolean;
  serviceType: string;
  advertiseHost: string;
  servicePort: number;
  peerCount: number;
}

export interface DiscoveryUpdatePayload {
  items: DiscoveryDeviceRecord[];
  status: DiscoveryStatus;
}

export interface ManualAddDiscoveryRequest {
  host: string;
  port: number;
  label?: string;
}

export interface PeerSeenRequest {
  fullname?: string;
  id?: string;
  name?: string;
  icon?: DeviceIcon;
  host: string;
  port?: number;
  addresses?: string[];
  transports?: string[];
  version?: string;
}

export interface PeerGoneRequest {
  fullname?: string;
  id?: string;
}

export type LiveTransferDirection = 'desktop-to-phone' | 'phone-to-desktop';
export type LiveTransferStatus = 'queued' | 'uploading' | 'ready' | 'downloaded' | 'failed';

export interface StoredFileRecord extends Omit<FileDescriptor, 'lastModified'> {
  sessionId: string;
  direction: LiveTransferDirection;
  relativePath?: string | null;
  sourceDeviceName?: string | null;
  status: LiveTransferStatus;
  downloadUrl: string;
  createdAt: string;
  uploadedAt: string;
  downloadedAt?: string | null;
  lastModified?: number | null;
  averageBytesPerSecond?: number | null;
  durationMs?: number | null;
}

export interface SecureDownloadPayload {
  ok: boolean;
  file: StoredFileRecord;
  encrypted: boolean;
  keyId?: string;
  algorithm?: string;
  payload?: {
    chunkIndex: number;
    nonce: string;
    ciphertext: string;
  };
}

export interface UploadCheckpoint {
  uploadId: string;
  sessionId: string;
  direction: LiveTransferDirection;
  name: string;
  mimeType: string;
  relativePath?: string | null;
  status: 'uploading' | 'complete';
  totalSize: number;
  receivedBytes: number;
  totalChunks: number;
  nextChunk: number;
  file?: StoredFileRecord;
}

export interface LiveQueueItem {
  id: string;
  name: string;
  direction: LiveTransferDirection;
  status: LiveTransferStatus;
  size: number;
  progress: number;
}

export interface LiveQueueState {
  items: LiveQueueItem[];
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
}

export interface LiveSessionSummary {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  state: string;
  pairedAt?: string | null;
  closedAt?: string | null;
}

export interface LiveSessionRecord {
  id: string;
  mode: TransferMode;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  expiresAt?: string | null;
  multiDevice?: boolean;
  maxDevices?: number;
  localDevice: {
    name: string;
    role: 'desktop';
    platform: string;
    icon: DeviceIcon;
  };
  peerDevice?: {
    name: string;
    platform: string;
    transport: TransferMode;
    address?: string | null;
    icon?: DeviceIcon | null;
    fingerprint?: string | null;
  } | null;
  pairing: {
    ticket: SessionTicket;
    guestAllowed?: boolean;
    encrypted?: boolean;
    verifiedAt?: string | null;
    acceptedAt?: string | null;
  };
  pendingRequest?: {
    id: string;
    requestedAt: string;
    peer: {
      name: string;
      platform: string;
      transport: TransferMode;
      icon?: DeviceIcon | null;
      address?: string | null;
      fingerprint?: string | null;
    };
  } | null;
  pendingTransfers?: PendingTransferBatch[];
  files: Record<LiveTransferDirection, StoredFileRecord[]>;
  queue: LiveQueueState;
  summary: LiveSessionSummary;
  closedReason?: string | null;
  eventCount: number;
  slots?: MultiDeviceSlot[];
  awaitingKnownDevice?: { fingerprint: string } | null;
  connectedDevices?: Array<{
    slotIndex: number;
    name: string;
    platform: string;
    icon?: DeviceIcon | null;
    fingerprint?: string | null;
    connectedAt: string;
  }>;
}

export interface HistoryEntry {
  id: string;
  mode: TransferMode;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  localDevice: {
    name: string;
    role: 'desktop';
    platform: string;
    icon: DeviceIcon;
  };
  peerDevice?: {
    name: string;
    platform: string;
    transport: TransferMode;
    address?: string | null;
    icon?: DeviceIcon | null;
  } | null;
  summary: LiveSessionSummary;
  fileCount: number;
  files: StoredFileRecord[];
}

export interface BackendSettings {
  deviceName: string;
  deviceIcon: DeviceIcon;
  preferredMode: TransferMode;
  downloadFolder: string;
  connectionMode: 'auto' | 'wifi' | 'usb';
  autoCloseAfterDownload: boolean;
  autoAcceptTrusted: boolean;
  onboardingComplete: boolean;
  watchFolders: WatchFolderConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface WatchFolderConfig {
  id: string;
  path: string;
  destinationFingerprint: string;
  destinationLabel: string;
  fileTypes?: 'all' | 'images' | string[];
  trigger: 'on-connect' | 'scheduled';
}

export interface TrustedDeviceRecord {
  fingerprint: string;
  name: string;
  platform: string;
  trustedAt: string;
  autoAccept: boolean;
}

export interface KnownDeviceRecord {
  fingerprint: string;
  name: string;
  platform: string;
  icon?: DeviceIcon | null;
  lastSeenAt: string;
}

export interface GuestShareSummary {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  files: number;
}

export interface PendingTransferBatch {
  id: string;
  direction: LiveTransferDirection;
  sourceDeviceName: string | null;
  requestedAt: string;
  files: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    relativePath?: string | null;
    lastModified?: number | null;
  }>;
}

export interface BackendHealth {
  ok: boolean;
  uptimeSeconds: number;
  sessions: number;
  activeSessions: number;
  pairedSessions: number;
  transferringSessions: number;
  fileCount: number;
  totalBytes: number;
  settings: BackendSettings;
}

export interface UploadSessionRecord {
  id: string;
  sessionId: string;
  direction: LiveTransferDirection;
  name: string;
  relativePath?: string | null;
  mimeType: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  nextChunk: number;
  uploadedBytes: number;
  status: 'pending' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
  averageBytesPerSecond?: number | null;
  progressPercent: number;
}

export interface ClipboardState {
  text: string;
  updatedAt?: string | null;
  sourceDeviceName?: string | null;
  sourceRole?: 'desktop' | 'phone' | null;
}

export interface DashboardResponse {
  settings: BackendSettings;
  clipboard: ClipboardState;
  activeUploads: UploadSessionRecord[];
  totals: {
    sessions: number;
    files: number;
    bytes: number;
    paired: number;
    transferring: number;
    completed: number;
    pending: number;
  };
  history: LiveSessionRecord[];
  activeSessions: LiveSessionRecord[];
  trustedDevices: TrustedDeviceRecord[];
  knownDevices: KnownDeviceRecord[];
  guestShares: GuestShareSummary[];
}

export interface CreateSessionRequest {
  mode?: TransferMode;
  deviceName?: string;
  deviceIcon?: DeviceIcon;
  origin?: string;
  backendOrigin?: string;
  multiDevice?: boolean;
  maxDevices?: number;
  hotspot?: {
    ssid: string;
    password: string;
    band?: '2.4GHz' | '5GHz' | null;
  };
}

export interface ReconnectToKnownDeviceRequest {
  preferTransport?: 'wifi' | 'usb' | 'hotspot';
  deviceName?: string;
  deviceIcon?: DeviceIcon;
  origin?: string;
  backendOrigin?: string;
}

export interface ReconnectToKnownDeviceResponse {
  session: LiveSessionRecord;
  ticket: SessionTicket;
  knownDevice: KnownDeviceRecord;
}

export interface SessionFullError {
  error: 'session-full';
  maxDevices: number;
  connectedDevices: number;
}

export interface PairSessionRequest {
  deviceName: string;
  deviceIcon?: DeviceIcon;
  kind?: DeviceKind;
  platform?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  transport?: TransferMode;
  address?: string;
  remotePublicKey?: string;
  ticketQrValue?: string;
}

export interface UpdateSettingsRequest {
  deviceName?: string;
  deviceIcon?: DeviceIcon;
  preferredMode?: TransferMode;
  downloadFolder?: string;
  connectionMode?: 'auto' | 'wifi' | 'usb';
  autoCloseAfterDownload?: boolean;
  autoAcceptTrusted?: boolean;
  onboardingComplete?: boolean;
  watchFolders?: WatchFolderConfig[];
}

export interface UpdateClipboardRequest {
  text: string;
  sourceDeviceName?: string;
  sourceRole?: 'desktop' | 'phone';
}

export interface BackendEventEnvelope<T = unknown> {
  type: string;
  payload: T;
}

export interface PinVerificationRequest {
  pin: string;
  deviceFingerprint: string;
}

export type PinVerificationResponse =
  | {
      ok: true;
      session: LiveSessionRecord;
      attemptsRemaining: number;
    }
  | {
      ok: false;
      reason: 'mismatch';
      attemptsRemaining: number;
    }
  | {
      ok: false;
      reason: 'locked';
      attemptsRemaining: 0;
    };

export interface ResumeToken {
  uploadId: string;
  nextChunk: number;
  fingerprint: string;
  createdAt: number;
}

export interface FolderTransferOptions {
  mode: 'zip' | 'stream';
  preserveStructure: boolean;
  maxDepth?: number;
}

export interface BenchmarkResult {
  peerFingerprint: string;
  throughputMBps: number;
  latencyMs: number;
  transport: 'wifi' | 'usb' | 'hotspot';
  ranAt: number;
}

export interface CreateGuestShareRequest {
  files: string[];
  maxUses?: number;
  expiresInSec?: number;
  password?: string;
}

export interface MultiDeviceSlot {
  slotId: number;
  deviceFingerprint?: string;
  deviceName?: string;
  status: 'open' | 'pending' | 'connected' | 'denied';
}

export interface ReconnectToKnownDeviceRequest {
  fingerprint: string;
  preferTransport?: 'wifi' | 'usb' | 'hotspot';
}


export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatProgress(progress: number) {
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

export function inferTransferKind(fileName: string, mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    fileName.toLowerCase().endsWith('.zip')
  ) {
    return 'archive';
  }

  return 'document';
}

export function chooseTransferChunkSize(mode: TransferMode | undefined, size: number) {
  const normalizedSize = Number.isFinite(size) && size > 0 ? size : 0;
  const base =
    mode === 'usb'
      ? 4 * 1024 * 1024
      : mode === 'hotspot'
        ? 256 * 1024
        : 1024 * 1024;

  if (normalizedSize && normalizedSize <= 512 * 1024) {
    return 64 * 1024;
  }

  if (normalizedSize && normalizedSize <= 4 * 1024 * 1024) {
    return Math.min(base, 256 * 1024);
  }

  if (normalizedSize && normalizedSize <= 64 * 1024 * 1024) {
    return Math.min(base, 512 * 1024);
  }

  return base;
}

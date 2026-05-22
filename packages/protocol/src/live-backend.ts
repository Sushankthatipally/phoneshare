import type { FileDescriptor } from './packets.js';
import type { DeviceKind, TransferMode } from './session.js';

export interface PairingPayload {
  sessionId: string;
  transport: Exclude<TransferMode, 'hotspot'>;
  host: string;
  port: number;
  publicKey: string;
  expiresAt: string;
}

export type DeviceIcon = 'desktop' | 'laptop' | 'phone' | 'tablet';

export interface SessionTicket {
  sessionId: string;
  qrValue: string;
  pairingUrl: string;
  guestAllowed?: boolean;
  expiresAt?: string | null;
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
  nextChunkIndex: number;
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
  clipboardSyncEnabled: boolean;
  watchFolders: WatchFolderConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface PeerStorageReport {
  fingerprint: string;
  freeBytes: number;
  totalBytes: number;
  reportedAt: string;
}

export type PeerStorageResponse =
  | { ok: true; report: PeerStorageReport }
  | { ok: false; error: 'unknown' };

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
  clipboardSyncEnabled?: boolean;
  watchFolders?: WatchFolderConfig[];
}

export interface PeerStorageUpdateRequest {
  fingerprint: string;
  freeBytes: number;
  totalBytes: number;
}

export interface BackendEventMap {
  'snapshot': { dashboard: DashboardResponse };
  'session-created': { session: LiveSessionRecord };
  'session-updated': { session: LiveSessionRecord };
  'session-paired': { session: LiveSessionRecord };
  'session-connect-requested': { session: LiveSessionRecord };
  'session-declined': { session: LiveSessionRecord };
  'session-closed': { session: LiveSessionRecord };
  'settings-updated': { settings: BackendSettings };
  'clipboard-updated': { clipboard: ClipboardState };
  'upload-started': { upload: UploadSessionRecord };
  'upload-progress': { upload: UploadSessionRecord };
  'file-uploaded': { session: LiveSessionRecord; file: StoredFileRecord };
  'file-downloaded': { session: LiveSessionRecord; file: StoredFileRecord };
  'transfer-requested': { sessionId: string; batch: PendingTransferBatch };
  'transfer-accepted': { sessionId: string; batchId: string; fileIds: string[] };
  'transfer-declined': { sessionId: string; batchId: string; reason: string | null };
  'trusted-updated': { trustedDevices: TrustedDeviceRecord[] };
  'peer-storage-updated': { report: PeerStorageReport };
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

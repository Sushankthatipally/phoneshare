import type { FileDescriptor, FileManifest, PacketHeader } from './packets.js';
import type { PairingState, SessionState, TransferMode } from './session.js';
import type {
  BackendSettings,
  ClipboardState,
  DiscoveryUpdatePayload,
  LiveSessionRecord,
  LiveTransferDirection,
  PendingTransferBatch,
  StoredFileRecord,
  TrustedDeviceRecord,
  UploadSessionRecord,
} from './live-backend.js';

export type SystemNotifyKind =
  | 'incoming'
  | 'paired'
  | 'pin'
  | 'error'
  | 'transfer-complete';

export interface SystemNotifyPayload {
  title: string;
  body: string;
  sessionId?: string | null;
  kind: SystemNotifyKind;
  emittedAt: string;
}

export const TRANSFER_EVENT_TYPES = [
  'session-created',
  'session-updated',
  'pairing-updated',
  'manifest-ready',
  'file-queued',
  'file-started',
  'progress-updated',
  'chunk-sent',
  'chunk-received',
  'transfer-complete',
  'transfer-failed'
] as const;
export type TransferEventType = (typeof TRANSFER_EVENT_TYPES)[number];

export interface ProgressState {
  completedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  percent: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
}

export interface QueueItem {
  id: string;
  file: FileDescriptor;
  status: 'queued' | 'sending' | 'paused' | 'done' | 'failed';
  progress: ProgressState;
  position: number;
}

export interface QueueState {
  items: QueueItem[];
  activeItemId?: string;
}

export interface SessionEventBase {
  id: string;
  sessionId: string;
  type: TransferEventType;
  timestamp: string;
  mode: TransferMode;
}

export interface SessionCreatedEvent extends SessionEventBase {
  type: 'session-created';
  state: SessionState;
}

export interface SessionUpdatedEvent extends SessionEventBase {
  type: 'session-updated';
  state: SessionState;
}

export interface PairingUpdatedEvent extends SessionEventBase {
  type: 'pairing-updated';
  pairingState: PairingState;
}

export interface ManifestReadyEvent extends SessionEventBase {
  type: 'manifest-ready';
  manifest: FileManifest;
}

export interface FileQueuedEvent extends SessionEventBase {
  type: 'file-queued';
  file: FileDescriptor;
  queuePosition: number;
}

export interface FileProgressEvent extends SessionEventBase {
  type: 'progress-updated';
  fileId: string;
  progress: ProgressState;
}

export interface ChunkEvent extends SessionEventBase {
  type: 'chunk-sent' | 'chunk-received';
  header: PacketHeader;
  chunkIndex: number;
  fileId: string;
}

export interface TransferCompleteEvent extends SessionEventBase {
  type: 'transfer-complete';
  success: boolean;
  progress: ProgressState;
}

export interface TransferFailedEvent extends SessionEventBase {
  type: 'transfer-failed';
  error: {
    code: string;
    message: string;
  };
}

export type TransferEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | PairingUpdatedEvent
  | ManifestReadyEvent
  | FileQueuedEvent
  | FileProgressEvent
  | ChunkEvent
  | TransferCompleteEvent
  | TransferFailedEvent;

export interface SessionCreatedPayload {
  sessionId: string;
  session: LiveSessionRecord;
  createdAt: string;
}

export interface SessionPairedPayload {
  sessionId: string;
  session: LiveSessionRecord;
  pairedAt: string;
  peerFingerprint?: string | null;
}

export interface SessionLockedPayload {
  sessionId: string;
  reason: 'pin-attempts-exhausted' | 'pin-attempts-exceeded' | 'expired' | 'manual';
  lockedAt: string;
}

export interface PinRequiredPayload {
  sessionId: string;
  deviceFingerprint?: string;
  attemptsRemaining: number;
  expiresAt: string | null;
}

export interface TransferProgressPayload {
  sessionId: string;
  uploadId: string;
  fileId: string;
  direction: LiveTransferDirection;
  bytesTransferred: number;
  totalBytes: number;
  chunkIndex: number;
  totalChunks: number;
  bytesPerSecond: number;
}

export interface TransferCompletedPayload {
  sessionId: string;
  uploadId: string;
  file: StoredFileRecord;
  durationMs: number;
  averageBytesPerSecond: number;
}

export interface TransferFailedPayload {
  sessionId: string;
  uploadId?: string;
  fileId?: string;
  error: {
    code: string;
    message: string;
  };
}

export interface PeerConnectedPayload {
  sessionId: string;
  fingerprint: string;
  name: string;
  transport: TransferMode;
  connectedAt: string;
}

export interface PeerDisconnectedPayload {
  sessionId: string;
  fingerprint: string;
  disconnectedAt: string;
  reason?: string;
}

export interface ClipboardUpdatedPayload {
  clipboard: ClipboardState;
}

export interface WatchFolderFiredPayload {
  watchFolderId: string;
  watchFolderPath: string;
  destinationFingerprint: string;
  destinationLabel: string;
  sessionId: string | null;
  uploadId: string;
  file: {
    name: string;
    relativePath: string | null;
    size: number;
    mimeType: string;
    lastModified: number | null;
    sha256Prefix: string;
  };
  firedAt: string;
}

export interface BackendEventMap {
  'session-created': SessionCreatedPayload;
  'session-updated': { session: LiveSessionRecord };
  'session-connect-requested': { session: LiveSessionRecord };
  'session-paired': SessionPairedPayload;
  'session-declined': { session: LiveSessionRecord };
  'session-closed': { session: LiveSessionRecord };
  'session-locked': SessionLockedPayload;
  'pin-required': PinRequiredPayload;
  'pin-mismatch': { sessionId: string; attemptsRemaining: number };
  'settings-updated': { settings: BackendSettings };
  'clipboard-updated': ClipboardUpdatedPayload;
  'trusted-updated': { trustedDevices: TrustedDeviceRecord[] };
  'transfer-requested': { sessionId: string; batch: PendingTransferBatch };
  'transfer-accepted': { sessionId: string; batchId: string; fileIds: string[] };
  'transfer-declined': { sessionId: string; batchId: string; reason: string | null };
  'transfer-progress': TransferProgressPayload;
  'transfer-completed': TransferCompletedPayload;
  'transfer-failed': TransferFailedPayload;
  'upload-started': { upload: UploadSessionRecord };
  'upload-progress': { upload: UploadSessionRecord };
  'file-uploaded': { session: LiveSessionRecord; file: StoredFileRecord };
  'file-downloaded': { session: LiveSessionRecord; file: StoredFileRecord };
  'peer-connected': PeerConnectedPayload;
  'peer-disconnected': PeerDisconnectedPayload;
  'discovery-update': DiscoveryUpdatePayload;
  'watch-folder-fired': WatchFolderFiredPayload;
  'system-notify': SystemNotifyPayload;
}

export type BackendEventName = keyof BackendEventMap;

export type BackendEvent = {
  [K in BackendEventName]: { type: K; payload: BackendEventMap[K] };
}[BackendEventName];

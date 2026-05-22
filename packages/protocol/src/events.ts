import type { FileDescriptor, FileManifest, PacketHeader } from './packets.js';
import type { PairingState, SessionState, TransferMode } from './session.js';

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
  'system-notify': SystemNotifyPayload;
  'watch-folder-fired': WatchFolderFiredPayload;
}

export type BackendEventType = keyof BackendEventMap;

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

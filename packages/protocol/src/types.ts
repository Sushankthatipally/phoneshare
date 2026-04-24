import type {
  DeviceKind,
  PacketType,
  PairingState,
  SessionState,
  TransferMode,
} from './constants.js';

export type TransferDirection = 'send' | 'receive';

export type TransferStatus =
  | 'queued'
  | 'encrypting'
  | 'transferring'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface TransferItem {
  id: string;
  name: string;
  sizeLabel: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number;
  speedLabel?: string;
  etaLabel?: string;
  kind: 'image' | 'video' | 'archive' | 'document' | 'folder';
}

export interface DeviceIdentity {
  id: string;
  kind: DeviceKind;
  name: string;
  platform?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  isLocal: boolean;
}

export interface PairingDetails {
  state: PairingState;
  sessionId: string;
  expiresAt: string;
  qrPayload?: string;
  verifiedAt?: string;
}

export interface SessionPeer {
  device: DeviceIdentity;
  transport: TransferMode;
  address?: string;
  port?: number;
}

export interface TransferSession {
  id: string;
  mode: TransferMode;
  state: SessionState;
  localDevice: DeviceIdentity;
  remoteDevice?: DeviceIdentity;
  pairing: PairingDetails;
  peer?: SessionPeer;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface SessionSummary {
  sessionId: string;
  mode: TransferMode;
  state: SessionState;
  remoteName?: string;
  totalFiles: number;
  totalBytes: number;
  completedBytes: number;
  startedAt: string;
  endedAt?: string;
}

export interface PacketHeader {
  mode: TransferMode;
  type: PacketType;
  sessionId: string;
  payloadLength: number;
}

export interface EncryptionInfo {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag?: string;
  keyId?: string;
}

export interface HandshakePayload {
  protocolVersion: string;
  deviceId: string;
  deviceName: string;
  publicKey?: string;
}

export interface FileDescriptor {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified?: number;
  checksum?: string;
}

export interface FileManifest {
  transferId: string;
  files: FileDescriptor[];
  totalBytes: number;
  chunkSize: number;
  encryption: EncryptionInfo;
}

export interface ChunkDescriptor {
  fileId: string;
  chunkIndex: number;
  chunkSize: number;
  offset: number;
}

export interface AckPayload {
  transferId: string;
  fileId?: string;
  chunkIndex?: number;
  receivedBytes: number;
}

export interface DonePayload {
  transferId: string;
  success: boolean;
  completedBytes: number;
  message?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

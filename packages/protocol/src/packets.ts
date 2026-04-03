import type { TransferMode } from './session.js';

export const PACKET_TYPES = ['handshake', 'meta', 'chunk', 'ack', 'done', 'error'] as const;
export type PacketType = (typeof PACKET_TYPES)[number];

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
  pin?: string;
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


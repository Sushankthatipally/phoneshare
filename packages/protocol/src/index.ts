export * from './events.js';
export * from './client.js';
export * from './live-backend.js';
export * from './packets.js';
export * from './session.js';

import type { PacketType } from './packets.js';
import type { TransferMode } from './session.js';

export const protocolVersion = '0.1.0';

export const packetTypeCodes = {
  handshake: 0x01,
  meta: 0x02,
  chunk: 0x03,
  ack: 0x04,
  done: 0x05,
} as const;

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

export function resolveChunkSize(mode: TransferMode): number {
  switch (mode) {
    case 'usb':
      return 4 * 1024 * 1024;
    case 'wifi':
      return 1024 * 1024;
    case 'hotspot':
      return 256 * 1024;
    default:
      return 512 * 1024;
  }
}

export function getPacketTypeLabel(type: PacketType): string {
  return type.toUpperCase();
}

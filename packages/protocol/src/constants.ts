export const protocolVersion = '0.2.0-native';

export const PACKET_TYPES = ['handshake', 'meta', 'chunk', 'ack', 'done', 'error'] as const;
export type PacketType = (typeof PACKET_TYPES)[number];

export const packetTypeCodes = {
  handshake: 0x01,
  meta: 0x02,
  chunk: 0x03,
  ack: 0x04,
  done: 0x05,
  error: 0x06,
} as const satisfies Record<PacketType, number>;

export const TRANSFER_MODES = ['usb', 'wifi', 'hotspot'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const DEVICE_KINDS = ['desktop', 'android', 'iphone'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const SESSION_STATES = ['idle', 'discovering', 'pairing', 'paired', 'transferring', 'completed', 'failed'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const PAIRING_STATES = ['unpaired', 'qr-scanned', 'verified', 'expired', 'rejected'] as const;
export type PairingState = (typeof PAIRING_STATES)[number];

const NATIVE_CHUNK_SIZES: Record<TransferMode, number> = {
  usb: 4 * 1024 * 1024,
  wifi: 1024 * 1024,
  hotspot: 256 * 1024,
};

export function resolveChunkSize(mode: TransferMode): number {
  return NATIVE_CHUNK_SIZES[mode] ?? 512 * 1024;
}

export function getPacketTypeLabel(type: PacketType): string {
  return type.toUpperCase();
}

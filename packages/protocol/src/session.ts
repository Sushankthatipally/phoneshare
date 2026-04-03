export const TRANSFER_MODES = ['usb', 'wifi', 'hotspot'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const DEVICE_KINDS = ['desktop', 'android', 'iphone'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const SESSION_STATES = ['idle', 'discovering', 'pairing', 'paired', 'transferring', 'completed', 'failed'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const PAIRING_STATES = ['unpaired', 'qr-scanned', 'pin-required', 'verified', 'expired', 'rejected'] as const;
export type PairingState = (typeof PAIRING_STATES)[number];

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
  pin?: string;
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


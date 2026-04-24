export type DeviceType = 'desktop' | 'android' | 'ios';
export type TransportMode = 'wifi' | 'hotspot' | 'usb';

export interface HandshakePayload {
  version: number;
  device_name: string;
  device_type: DeviceType;
  pub_key: string;
  session_id: number;
  host: string;
  port: number;
  mode: TransportMode;
}

export const CRYPTO_CURVE = 'P-256';
export const HKDF_INFO = 'dropbeam-native-session-v1';

export function createSessionId(seed: number): number {
  return seed >>> 0;
}

export function createDeviceFingerprint(deviceName: string, deviceType: DeviceType) {
  return `${deviceType}:${deviceName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function createHandshakePayload(input: {
  deviceName: string;
  deviceType: DeviceType;
  sessionId: number;
  host: string;
  port: number;
  mode: TransportMode;
}): HandshakePayload {
  return {
    version: 1,
    device_name: input.deviceName,
    device_type: input.deviceType,
    pub_key: `base64:${createDeviceFingerprint(input.deviceName, input.deviceType)}:${input.sessionId}`,
    session_id: input.sessionId,
    host: input.host,
    port: input.port,
    mode: input.mode,
  };
}

export function encodeSessionTicket(payload: HandshakePayload) {
  return JSON.stringify(payload);
}

export function describeEncryptionPlan() {
  return `${CRYPTO_CURVE} + HKDF(${HKDF_INFO}) + AES-256-GCM`;
}

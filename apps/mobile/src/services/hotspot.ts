import type { TransportMode } from './crypto.js';

export interface HotspotConfig {
  enabled: boolean;
  ssid: string;
  passwordLabel: string;
  transport: TransportMode;
}

export function createHotspotConfig(deviceName: string, sessionLabel: string): HotspotConfig {
  return {
    enabled: false,
    ssid: `DropBeam-${deviceName.replace(/\s+/g, '').slice(0, 8) || 'Mobile'}`,
    passwordLabel: `${sessionLabel}-secure`,
    transport: 'hotspot',
  };
}

export function describeHotspotSupport() {
  return 'Android hotspot control is planned through a native module.';
}

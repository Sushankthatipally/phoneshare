import type { TransportMode } from './crypto.js';

export const DISCOVERY_SERVICE = '_dropbeam._tcp';

export interface DiscoveryBeacon {
  id: string;
  name: string;
  host: string;
  port: number;
  mode: TransportMode;
  signal: 'strong' | 'good' | 'fair';
  lastSeenLabel: string;
}

export function createDiscoveryBeacon(input: DiscoveryBeacon): DiscoveryBeacon {
  return input;
}

export function describeDiscoveryLane(beacons: DiscoveryBeacon[]) {
  if (!beacons.length) {
    return `Listening for ${DISCOVERY_SERVICE} on the local network.`;
  }

  return `${beacons.length} nearby desktop${beacons.length === 1 ? '' : 's'} discovered via ${DISCOVERY_SERVICE}.`;
}

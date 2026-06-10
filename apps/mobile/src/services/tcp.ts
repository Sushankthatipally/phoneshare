import type { TransportMode } from './crypto.js';

// Must match the backend HTTP port (packages/local-backend/src/config.js).
// Used as the fallback when an mDNS record carries no port.
export const DEFAULT_PORT = 17619;

export interface TcpEndpoint {
  host: string;
  port: number;
  mode: TransportMode;
}

export function createTcpEndpoint(input: { host: string; port?: number; mode: TransportMode }): TcpEndpoint {
  return {
    host: input.host,
    port: input.port ?? DEFAULT_PORT,
    mode: input.mode,
  };
}

export function describeTcpEndpoint(endpoint: TcpEndpoint) {
  return `${endpoint.host}:${endpoint.port} over ${endpoint.mode}`;
}

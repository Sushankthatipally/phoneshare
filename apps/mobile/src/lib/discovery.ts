import { useEffect, useRef, useState } from 'react';

import { DEFAULT_PORT } from '../services/tcp.js';

/**
 * Real mDNS / Bonjour discovery for nearby DropBeam desktops + phones.
 *
 * Browses _dropbeam._tcp on the local network and surfaces every responder.
 * No mock entries: an empty list means literally nothing is broadcasting on
 * the LAN, which is the correct UX signal to show ("No nearby devices").
 *
 * `react-native-zeroconf` is a native module: in dev/JS-only contexts
 * (Expo Go on first launch, Metro reloads before native build) the require
 * may throw. We swallow that and surface `{ available: false }` so callers
 * can render the empty state instead of crashing.
 */

export const SERVICE_TYPE = 'dropbeam';
export const SERVICE_PROTOCOL = 'tcp';
export const SERVICE_DOMAIN = 'local.';

export interface DiscoveredPeer {
  /** Stable id: name + host, since one host can advertise multiple names. */
  id: string;
  name: string;
  host: string;
  port: number;
  fingerprint?: string;
  icon?: string;
  txt?: Record<string, string>;
  /** ms since epoch this peer was last seen via mDNS. */
  lastSeenAt: number;
}

interface ZeroconfApi {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(event: string): void;
  scan(type: string, protocol: string, domain: string): void;
  stop(): void;
  publishService?(
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txt?: Record<string, string>,
  ): void;
  unpublishService?(name: string): void;
}

interface ZeroconfModule {
  new (): ZeroconfApi;
}

let cached: ZeroconfApi | null = null;
let unavailable = false;

function loadZeroconf(): ZeroconfApi | null {
  if (unavailable) return null;
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-zeroconf');
    const Ctor: ZeroconfModule = (mod && (mod.default ?? mod)) as ZeroconfModule;
    cached = new Ctor();
    return cached;
  } catch {
    unavailable = true;
    return null;
  }
}

interface ZeroconfServiceShape {
  name?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

function toPeer(raw: unknown): DiscoveredPeer | null {
  if (!raw || typeof raw !== 'object') return null;
  const svc = raw as ZeroconfServiceShape;
  const name = typeof svc.name === 'string' ? svc.name : null;
  const host =
    typeof svc.host === 'string' && svc.host.length
      ? svc.host
      : Array.isArray(svc.addresses) && typeof svc.addresses[0] === 'string'
        ? svc.addresses[0]
        : null;
  if (!name || !host) return null;
  const port = typeof svc.port === 'number' && svc.port > 0 ? svc.port : DEFAULT_PORT;
  const txt = svc.txt && typeof svc.txt === 'object' ? svc.txt : undefined;
  return {
    id: `${name}@${host}`,
    name,
    host,
    port,
    fingerprint: txt?.id ?? txt?.fingerprint,
    icon: txt?.icon,
    txt,
    lastSeenAt: Date.now(),
  };
}

export interface UseDiscoveryOptions {
  /** When true, the device also publishes itself so peers can find it. */
  publishSelf?: boolean;
  selfName?: string;
  selfPort?: number;
  selfTxt?: Record<string, string>;
}

export interface DiscoveryState {
  available: boolean;
  scanning: boolean;
  peers: DiscoveredPeer[];
  error?: string;
}

export function useDiscovery(options: UseDiscoveryOptions = {}): DiscoveryState {
  const { publishSelf, selfName, selfPort, selfTxt } = options;
  const [state, setState] = useState<DiscoveryState>({
    available: true,
    scanning: false,
    peers: [],
  });
  const peersRef = useRef<Map<string, DiscoveredPeer>>(new Map());

  useEffect(() => {
    const zc = loadZeroconf();
    if (!zc) {
      setState({ available: false, scanning: false, peers: [] });
      return;
    }

    const flush = () => {
      const next = Array.from(peersRef.current.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      setState((current) => ({ ...current, peers: next }));
    };

    const upsert = (raw: unknown) => {
      const peer = toPeer(raw);
      if (!peer) return;
      peersRef.current.set(peer.id, peer);
      flush();
    };

    const remove = (raw: unknown) => {
      const peer = toPeer(raw);
      if (!peer) return;
      peersRef.current.delete(peer.id);
      flush();
    };

    zc.on('start', () => setState((current) => ({ ...current, scanning: true })));
    zc.on('stop', () => setState((current) => ({ ...current, scanning: false })));
    zc.on('resolved', upsert);
    zc.on('update', flush);
    zc.on('remove', remove);
    zc.on('error', (err: unknown) => {
      setState((current) => ({
        ...current,
        error: err instanceof Error ? err.message : 'zeroconf error',
      }));
    });

    try {
      zc.scan(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_DOMAIN);
    } catch (err) {
      setState({
        available: false,
        scanning: false,
        peers: [],
        error: err instanceof Error ? err.message : 'scan failed',
      });
      return;
    }

    let publishedName: string | null = null;
    if (publishSelf && selfName && selfPort && zc.publishService) {
      try {
        zc.publishService(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_DOMAIN, selfName, selfPort, selfTxt);
        publishedName = selfName;
      } catch {
        // Publishing is best-effort; browsing still works without it.
      }
    }

    return () => {
      try {
        zc.stop();
      } catch {
        // ignore
      }
      if (publishedName && zc.unpublishService) {
        try {
          zc.unpublishService(publishedName);
        } catch {
          // ignore
        }
      }
      zc.removeAllListeners('start');
      zc.removeAllListeners('stop');
      zc.removeAllListeners('resolved');
      zc.removeAllListeners('update');
      zc.removeAllListeners('remove');
      zc.removeAllListeners('error');
      peersRef.current.clear();
    };
  }, [publishSelf, selfName, selfPort, selfTxt]);

  return state;
}

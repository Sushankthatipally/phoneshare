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
  /** Convenience alias for `selfName`; some W16 callers pass this. */
  publishName?: string;
  /** Convenience alias for `selfPort`; some W16 callers pass this. */
  publishPort?: number;
}

export interface DiscoveryState {
  available: boolean;
  scanning: boolean;
  peers: DiscoveredPeer[];
  error?: string;
}

const USB_PROBE_INTERVAL_MS = 5_000;
const USB_PROBE_HOST = 'localhost';
const USB_PROBE_PORT = 17619;

interface UsbDiscoveryPayload {
  fingerprint?: string;
  name?: string;
  hashtag?: string;
  platform?: string;
  publicKey?: string;
  sessionId?: string;
}

// Probe the ADB-tunneled backend on localhost:17619. When it answers, fetch
// /api/discovery to pull the desktop's TXT-equivalent payload (fingerprint,
// session, etc.) so the synthetic USB peer is tap-to-pair-ready.
async function probeUsbPeer(): Promise<DiscoveredPeer | null> {
  try {
    const health = await fetch(`http://${USB_PROBE_HOST}:${USB_PROBE_PORT}/api/health`, { method: 'GET' });
    if (!health.ok) return null;
    let payload: UsbDiscoveryPayload = {};
    try {
      const res = await fetch(`http://${USB_PROBE_HOST}:${USB_PROBE_PORT}/api/discovery`);
      const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const self = json.items?.find((item) => item.source === 'self');
      if (self) {
        payload = {
          fingerprint: String(self.fingerprint ?? '') || undefined,
          name: String(self.friendlyName ?? self.name ?? '') || undefined,
          hashtag: String(self.hashtag ?? '') || undefined,
          platform: String(self.platform ?? '') || undefined,
        };
      }
    } catch {
      /* discovery payload is optional — health is enough to inject the peer */
    }
    return {
      id: `usb:${USB_PROBE_HOST}:${USB_PROBE_PORT}`,
      name: payload.name ?? 'USB Desktop',
      host: USB_PROBE_HOST,
      port: USB_PROBE_PORT,
      fingerprint: payload.fingerprint,
      icon: 'desktop',
      txt: {
        n: payload.name ?? 'USB Desktop',
        tag: payload.hashtag ?? '',
        p: payload.platform ?? 'usb',
        fp: payload.fingerprint ?? '',
        transport: 'usb',
        ...(payload.publicKey ? { pk: payload.publicKey } : {}),
        ...(payload.sessionId ? { sid: payload.sessionId } : {}),
      },
      lastSeenAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function useDiscovery(options: UseDiscoveryOptions = {}): DiscoveryState {
  const { publishSelf, selfName, selfPort, selfTxt } = options;
  const [state, setState] = useState<DiscoveryState>({
    available: true,
    scanning: false,
    peers: [],
  });
  const peersRef = useRef<Map<string, DiscoveredPeer>>(new Map());

  // USB tunnel probe. Runs alongside mDNS so the user gets a USB-pinned peer
  // even when mDNS is blocked (iPhone hotspot, multicast-unfriendly routers).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const peer = await probeUsbPeer();
      if (cancelled) return;
      if (peer) {
        const existing = peersRef.current.get(peer.id);
        peersRef.current.set(peer.id, { ...peer, lastSeenAt: Date.now() });
        if (!existing || existing.fingerprint !== peer.fingerprint) {
          setState((current) => ({
            ...current,
            peers: Array.from(peersRef.current.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
          }));
        }
      } else {
        if (peersRef.current.delete(`usb:${USB_PROBE_HOST}:${USB_PROBE_PORT}`)) {
          setState((current) => ({
            ...current,
            peers: Array.from(peersRef.current.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
          }));
        }
      }
    };
    tick();
    const id = setInterval(tick, USB_PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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

    zc.on('start', () => {
      console.info('[discovery] zeroconf start');
      setState((current) => ({ ...current, scanning: true }));
    });
    zc.on('stop', () => {
      console.info('[discovery] zeroconf stop');
      setState((current) => ({ ...current, scanning: false }));
    });
    zc.on('found', (name: unknown) => console.info('[discovery] found', name));
    zc.on('resolved', (raw: unknown) => {
      console.info('[discovery] resolved', raw);
      upsert(raw);
    });
    zc.on('update', flush);
    zc.on('remove', (raw: unknown) => {
      console.info('[discovery] remove', raw);
      remove(raw);
    });
    zc.on('error', (err: unknown) => {
      console.warn('[discovery] error', err);
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

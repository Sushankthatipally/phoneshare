import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * mDNS / Bonjour helper for `_dropbeam._tcp`.
 *
 * Implementation strategy:
 *   - The native bridge lives in `react-native-zeroconf`, which is NOT yet
 *     compiled into the Expo dev client. We attempt a runtime `require` and
 *     gracefully degrade to a no-op when the module is missing so the JS
 *     bundle still loads in Expo Go and on managed builds.
 *   - When `expo prebuild` is run with the `react-native-zeroconf` config
 *     plugin enabled, this hook publishes the phone's own `_dropbeam._tcp`
 *     service AND browses for peers.
 *   - This file ships a JS-only fallback so screens that consume the hook
 *     don't crash in development; callers should treat an empty `peers`
 *     array as "no peers found yet" rather than "no native support".
 */

export interface DiscoveredPeer {
  /** Stable id (Bonjour service name). */
  name: string;
  host?: string;
  port: number;
  /** TXT record values, lower-cased keys. */
  txt: Record<string, string>;
}

interface ZeroconfBrowserEvent {
  name?: string;
  host?: string;
  port?: number;
  txt?: Record<string, unknown>;
}

interface ZeroconfBridge {
  on(event: string, listener: (data: ZeroconfBrowserEvent) => void): void;
  removeAllListeners?(event?: string): void;
  scan(type: string, protocol: string, domain?: string): void;
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

let cachedBridge: ZeroconfBridge | null | undefined;

function loadBridge(): ZeroconfBridge | null {
  if (cachedBridge !== undefined) return cachedBridge;
  cachedBridge = null;
  try {
    // Indirect require so Metro doesn't fail bundling when the optional
    // peer is absent. The module is added by `expo prebuild` consumers that
    // explicitly install react-native-zeroconf; managed builds will hit this
    // catch branch.
    const moduleId = 'react-native-zeroconf';
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const dynamicRequire = (Function('return require') as () => NodeRequire)();
    const mod = dynamicRequire(moduleId);
    const Zeroconf = mod?.default ?? mod;
    if (typeof Zeroconf === 'function') {
      cachedBridge = new Zeroconf() as ZeroconfBridge;
    }
  } catch {
    cachedBridge = null;
  }
  return cachedBridge;
}

/**
 * Subscribe to `_dropbeam._tcp` peers and publish this device.
 *
 * Returns an array of currently discovered peers and a boolean flag indicating
 * whether the native bridge is operational. When `nativeAvailable` is false,
 * screens should hide the "peers nearby" surface.
 */
export function useDiscovery(options: {
  /** Optional self-publish: phone advertises its own service under this name. */
  publishName?: string;
  publishPort?: number;
  publishTxt?: Record<string, string>;
}): { peers: DiscoveredPeer[]; nativeAvailable: boolean } {
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [nativeAvailable, setNativeAvailable] = useState<boolean>(false);

  useEffect(() => {
    const bridge = loadBridge();
    if (!bridge) {
      setNativeAvailable(false);
      return;
    }
    setNativeAvailable(true);

    const known = new Map<string, DiscoveredPeer>();

    bridge.on('resolved', (service: ZeroconfBrowserEvent) => {
      if (!service?.name) return;
      const txt = Object.fromEntries(
        Object.entries(service.txt ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
      );
      const peer: DiscoveredPeer = {
        name: service.name,
        host: service.host,
        port: typeof service.port === 'number' ? service.port : 0,
        txt,
      };
      known.set(peer.name, peer);
      setPeers(Array.from(known.values()));
    });
    bridge.on('remove', (service: ZeroconfBrowserEvent) => {
      if (!service?.name) return;
      known.delete(service.name);
      setPeers(Array.from(known.values()));
    });

    bridge.scan('dropbeam', 'tcp', 'local.');

    // Publish ourselves so desktops can find this phone.
    if (options.publishName && options.publishPort && bridge.publishService) {
      try {
        bridge.publishService(
          'dropbeam',
          'tcp',
          'local.',
          options.publishName,
          options.publishPort,
          options.publishTxt ?? {},
        );
      } catch {
        // some platforms (iOS without entitlement) will reject publishing.
      }
    }

    return () => {
      try {
        bridge.stop();
      } catch {
        // ignore
      }
      try {
        if (options.publishName && bridge.unpublishService) {
          bridge.unpublishService(options.publishName);
        }
      } catch {
        // ignore
      }
      bridge.removeAllListeners?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.publishName, options.publishPort]);

  // iOS Bonjour requires NSBonjourServices in app.json (already set) plus the
  // user accepting the local-network permission prompt. We can't surface that
  // here, but we record platform for diagnostics.
  if (Platform.OS === 'web') {
    return { peers: [], nativeAvailable: false };
  }
  return { peers, nativeAvailable };
}

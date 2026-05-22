import { useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * Bridge between the Android `MainActivity` share-intent handler and React
 * Native. Files arriving from the system share sheet are surfaced as a list
 * of `content://` URIs.
 *
 * The Android side emits `dropbeam.share-received` once `onCreate` /
 * `onNewIntent` extract `EXTRA_STREAM`. We also support a snapshot getter so a
 * cold-start can retrieve the URIs that arrived before React was mounted.
 *
 * Subscription path: Expo Modules deliver `sendEvent` via the module's
 * NativeEventEmitter; we attempt `addListener` on the bridge object first and
 * fall back to the legacy DeviceEventEmitter so the JS bundle stays compatible
 * with both the new + old architecture builds.
 */

export interface SharedItem {
  uri: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

const EVENT = 'dropbeam.share-received';

interface DropBeamShareNativeModule {
  pullPendingShares?: () => Promise<{ uris: string[]; mimeType?: string }>;
  addListener?: (event: string, callback: (payload: { uris?: string[]; mimeType?: string }) => void) => { remove: () => void } | undefined;
}

function getNativeModule(): DropBeamShareNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules?.DropBeamAndroid as DropBeamShareNativeModule | undefined;
  return mod ?? null;
}

export function useSharedItems(): { items: SharedItem[]; clear: () => void } {
  const [items, setItems] = useState<SharedItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pump = (uris: string[], mimeType?: string) => {
      if (!Array.isArray(uris) || uris.length === 0) return;
      setItems((current) => {
        const seen = new Set(current.map((c) => c.uri));
        const next = [...current];
        for (const uri of uris) {
          if (typeof uri !== 'string' || seen.has(uri)) continue;
          next.push({ uri, mimeType });
        }
        return next;
      });
    };

    const native = getNativeModule();

    // Live events. Expo Modules dispatch via module event emitter and the
    // legacy bridge mirrors them onto DeviceEventEmitter. Subscribe to both
    // and dedupe in the consumer.
    const subs: Array<{ remove: () => void }> = [];
    if (native?.addListener) {
      const s = native.addListener(EVENT, (payload) => pump(payload?.uris ?? [], payload?.mimeType));
      if (s) subs.push(s);
    }
    subs.push(DeviceEventEmitter.addListener(EVENT, (payload: { uris?: string[]; mimeType?: string }) => {
      if (!payload) return;
      pump(payload.uris ?? [], payload.mimeType);
    }));

    // Cold-start drain: ask the native module for anything queued during launch.
    if (native?.pullPendingShares) {
      native
        .pullPendingShares()
        .then((res) => {
          if (cancelled || !res) return;
          pump(res.uris ?? [], res.mimeType);
        })
        .catch(() => {
          /* native bridge not present in this build */
        });
    }

    return () => {
      cancelled = true;
      for (const sub of subs) sub.remove();
    };
  }, []);

  return {
    items,
    clear: () => setItems([]),
  };
}

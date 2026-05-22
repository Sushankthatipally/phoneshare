import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { pushClipboard } from './api.js';
import type { ConnectionInfo } from './connection.js';

/**
 * Polls the system clipboard every 2 seconds while the app is foregrounded
 * and pushes new strings to the desktop. Returns nothing — side effects only.
 *
 * - Only runs while `enabled` is true, the connection exists, and the
 *   AppState is 'active'. This deliberately keeps the implementation cheap;
 *   the iOS UIPasteboard read prompt only triggers when the app is
 *   foregrounded, so background polling would be wasted regardless.
 * - We send only when the string changes; identical reads are skipped.
 */
export function useClipboardSync(params: { connection: ConnectionInfo | null; enabled: boolean }): void {
  const { connection, enabled } = params;
  const lastSent = useRef<string>('');
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const stop = () => {
      if (interval.current) {
        clearInterval(interval.current);
        interval.current = null;
      }
    };

    const start = () => {
      if (interval.current) return;
      interval.current = setInterval(async () => {
        if (!enabled || !connection) return;
        try {
          const text = await Clipboard.getStringAsync();
          if (!text || text === lastSent.current) return;
          lastSent.current = text;
          await pushClipboard({ connection, text });
        } catch {
          // ignore individual poll failures
        }
      }, 2000);
    };

    if (!enabled || !connection) {
      stop();
      return;
    }

    if (AppState.currentState === 'active') start();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [enabled, connection]);
}

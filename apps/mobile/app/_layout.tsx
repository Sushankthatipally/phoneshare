import { Slot, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { ConnectionProvider } from '../src/lib/connection.js';
import { MobileChrome } from '../src/screens/MobileChrome.js';

export default function Layout() {
  return (
    <ConnectionProvider>
      <MobileChrome>
        <DeepLinkBridge />
        <Slot />
      </MobileChrome>
    </ConnectionProvider>
  );
}

/**
 * Listens for `dropbeam://incoming/<batchId>?action=open-folder&sessionId=...`
 * deep links posted by the Android notification FOLDER action and routes the
 * user to the saved-files view (history) for that session.
 */
function DeepLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    function handle(url: string | null) {
      if (!url) return;
      const parsed = Linking.parse(url);
      const action = (parsed.queryParams?.action as string | undefined) ?? null;
      if (parsed.hostname === 'incoming' && action === 'open-folder') {
        router.push('/history');
      }
    }

    Linking.getInitialURL()
      .then(handle)
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => sub.remove();
  }, [router]);

  return null;
}

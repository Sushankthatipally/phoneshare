import { Slot, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { ConnectionProvider } from '../src/lib/connection.js';

export default function Layout() {
  return (
    <ConnectionProvider>
      <DeepLinkBridge />
      <Slot />
    </ConnectionProvider>
  );
}

function DeepLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    function handle(url: string | null) {
      if (!url) return;
      const parsed = Linking.parse(url);
      const action = (parsed.queryParams?.action as string | undefined) ?? null;
      if (parsed.hostname === 'incoming' && action === 'open-folder') {
        router.push('/receive');
      }
    }

    Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => sub.remove();
  }, [router]);

  return null;
}

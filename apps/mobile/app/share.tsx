import { useRouter } from 'expo-router';

import { ShareReceiveScreen } from '../src/screens/ShareReceiveScreen.js';
import { useSharedItems } from '../src/lib/share-receive.js';

export default function ShareRoute() {
  const router = useRouter();
  const { items, clear } = useSharedItems();
  return (
    <ShareReceiveScreen
      items={items}
      onDone={() => {
        clear();
        router.replace('/send');
      }}
    />
  );
}

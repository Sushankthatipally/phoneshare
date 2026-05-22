import { Slot } from 'expo-router';

import { ConnectionProvider } from '../src/lib/connection.js';
import { MobileChrome } from '../src/screens/MobileChrome.js';

export default function Layout() {
  return (
    <ConnectionProvider>
      <MobileChrome>
        <Slot />
      </MobileChrome>
    </ConnectionProvider>
  );
}

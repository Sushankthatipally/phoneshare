import type { PropsWithChildren } from 'react';

import { MobileChrome } from '../src/screens/MobileChrome.js';

export default function Layout({ children }: PropsWithChildren) {
  return <MobileChrome>{children}</MobileChrome>;
}

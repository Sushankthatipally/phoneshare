import type { PropsWithChildren } from 'react';

import { SafeAreaView, ScrollView, View } from '../lib/native.js';

export function MobileChrome({ children }: PropsWithChildren) {
  return (
    <SafeAreaView
      style={{
        backgroundColor: '#07101d',
        color: '#edf5ff',
        minHeight: '100vh',
      }}
    >
      <View
        style={{
          background: 'radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 32%)',
          inset: 0,
          pointerEvents: 'none',
          position: 'fixed',
          zIndex: -1,
        }}
      />
      <View
        style={{
          margin: '0 auto',
          maxWidth: 520,
          padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 16px)',
        }}
      >
        <ScrollView style={{ display: 'grid', gap: 16 }}>{children}</ScrollView>
      </View>
    </SafeAreaView>
  );
}

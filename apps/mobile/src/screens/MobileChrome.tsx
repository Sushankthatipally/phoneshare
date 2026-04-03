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
          margin: '0 auto',
          maxWidth: 480,
          padding: 16,
        }}
      >
        <ScrollView style={{ display: 'grid', gap: 16 }}>{children}</ScrollView>
      </View>
    </SafeAreaView>
  );
}

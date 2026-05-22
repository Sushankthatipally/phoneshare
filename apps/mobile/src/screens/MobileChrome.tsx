import type { PropsWithChildren } from 'react';
import { usePathname, useRouter } from 'expo-router';

import { Pressable, SafeAreaView, Text, View } from '../lib/native.js';
import { useConnection } from '../lib/connection.js';

const TABS: ReadonlyArray<{ path: '/' | '/send' | '/history'; label: string }> = [
  { path: '/', label: 'Connect' },
  { path: '/send', label: 'Send' },
  { path: '/history', label: 'History' },
];

export function MobileChrome({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const { connection } = useConnection();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020202' }}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>⚡</Text>
          </View>
          <View>
            <Text style={styles.brandName}>DropBeam</Text>
            <Text style={styles.brandSub}>Mobile</Text>
          </View>
        </View>
        <View style={[styles.statusPill, connection ? styles.statusPillOn : styles.statusPillOff]}>
          <Text style={styles.statusPillText}>{connection ? `Paired · ${connection.label}` : 'Not connected'}</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>{children}</View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = pathname === tab.path;
          return (
            <Pressable
              key={tab.path}
              onPress={() => router.replace(tab.path)}
              style={[styles.tab, active ? styles.tabActive : null]}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = {
  header: {
    alignItems: 'center' as const,
    backgroundColor: '#020202',
    borderBottomColor: '#1a1a1a',
    borderBottomWidth: 1,
    flexDirection: 'row' as const,
    gap: 12,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  brandRow: {
    alignItems: 'center' as const,
    flexDirection: 'row' as const,
    gap: 10,
  },
  brandMark: {
    alignItems: 'center' as const,
    backgroundColor: '#3a8bff',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center' as const,
    width: 28,
  },
  brandMarkText: {
    color: '#020202',
    fontSize: 16,
    fontWeight: '900' as const,
  },
  brandName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800' as const,
  },
  brandSub: {
    color: '#7a7a7a',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillOn: {
    backgroundColor: '#0e2a14',
    borderColor: '#1e6b34',
  },
  statusPillOff: {
    backgroundColor: '#1a1a1a',
    borderColor: '#333333',
  },
  statusPillText: {
    color: '#dcecdc',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  tabBar: {
    backgroundColor: '#0a0a0a',
    borderTopColor: '#1a1a1a',
    borderTopWidth: 1,
    flexDirection: 'row' as const,
    paddingBottom: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  tab: {
    alignItems: 'center' as const,
    borderRadius: 12,
    flex: 1,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: '#161616',
  },
  tabLabel: {
    color: '#7a7a7a',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  tabLabelActive: {
    color: '#ffffff',
  },
};

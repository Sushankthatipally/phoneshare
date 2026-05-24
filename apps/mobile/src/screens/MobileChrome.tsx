import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import { Pressable, SafeAreaView, Text, View } from '../lib/native.js';
import { useClipboardSync } from '../lib/clipboard-sync.js';
import { useConnection } from '../lib/connection.js';
import { useDiscovery } from '../lib/discovery.js';

const TABS: ReadonlyArray<{ path: '/' | '/receive'; label: string }> = [
  { path: '/', label: 'Send' },
  { path: '/receive', label: 'Receive' },
];

export function MobileChrome({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const { connection, settings, deviceName } = useConnection();

  useClipboardSync({ connection, enabled: settings.clipboardSyncEnabled });

  // Browse + publish `_dropbeam._tcp` so desktops see this phone. Returns an
  // empty list when the native module isn't linked; that's the expected state
  // in Expo Go / managed builds.
  useDiscovery({
    publishName: deviceName ? `DropBeam · ${deviceName}` : undefined,
    publishPort: 0, // 0 lets the OS pick. Real publish happens once W14 binds the listening port.
  });

  // Route to /share when the OS share sheet delivers files, even on cold start.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    const goShare = () => {
      if (!cancelled) router.replace('/share');
    };
    const sub = DeviceEventEmitter.addListener('dropbeam.share-received', (payload: { uris?: string[] }) => {
      if (Array.isArray(payload?.uris) && payload.uris.length > 0) goShare();
    });

    // Cold-start drain.
    const native = NativeModules?.DropBeamAndroid as
      | { pullPendingShares?: () => Promise<{ uris: string[] }> }
      | undefined;
    native?.pullPendingShares?.().then((res) => {
      if (res?.uris?.length) goShare();
    }).catch(() => {
      /* bridge unavailable */
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);

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
        <View style={styles.headerRight}>
          <View style={[styles.statusPill, connection ? styles.statusPillOn : styles.statusPillOff]}>
            <Text style={styles.statusPillText}>{connection ? `Paired · ${connection.label}` : 'Not connected'}</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} style={styles.gearButton}>
            <Text style={styles.gearIcon}>⚙︎</Text>
          </Pressable>
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
  headerRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  gearButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  gearIcon: {
    color: '#cccccc',
    fontSize: 20,
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

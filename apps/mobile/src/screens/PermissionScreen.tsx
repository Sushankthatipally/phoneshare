import { useState } from 'react';
import { StyleSheet, Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Notifications from 'expo-notifications';

import { Button, Pressable, ScrollView, Text, View } from '../lib/native.js';

type Status = 'pending' | 'granted' | 'denied';

interface Row {
  id: string;
  icon: string;
  label: string;
  copy: string;
  request: () => Promise<Status>;
}

export function PermissionScreen({ onContinue }: { onContinue: () => void }) {
  const [cameraPerm, requestCamera] = useCameraPermissions();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  const rows: Row[] = [
    {
      id: 'camera',
      icon: '📷',
      label: 'Camera',
      copy: 'Scan pairing QR codes from the desktop app.',
      request: async () => {
        const r = await requestCamera();
        return r.granted ? 'granted' : 'denied';
      },
    },
    {
      id: 'notifications',
      icon: '🔔',
      label: 'Notifications',
      copy: 'Alert you when files arrive while the app is closed.',
      request: async () => {
        const r = await Notifications.requestPermissionsAsync();
        return r.granted ? 'granted' : 'denied';
      },
    },
  ];

  const currentStatus = (id: string): Status => {
    if (id === 'camera') {
      return cameraPerm?.granted ? 'granted' : cameraPerm && !cameraPerm.canAskAgain ? 'denied' : statuses[id] ?? 'pending';
    }
    return statuses[id] ?? 'pending';
  };

  const grantAll = async () => {
    const next: Record<string, Status> = { ...statuses };
    for (const row of rows) {
      const s = await row.request();
      next[row.id] = s;
    }
    setStatuses(next);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>STEP 1 OF 2</Text>
        <Text style={styles.title}>DropBeam needs these to work</Text>
        <Text style={styles.copy}>
          You can deny any of them — the app still opens, but features that need them stay disabled.
        </Text>

        <View style={{ marginTop: 8, gap: 10 }}>
          {rows.map((row) => {
            const s = currentStatus(row.id);
            return (
              <View key={row.id} style={styles.row}>
                <Text style={styles.rowIcon}>{row.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowCopy}>{row.copy}</Text>
                </View>
                <Text
                  style={[
                    styles.badge,
                    s === 'granted' ? styles.badgeOk : s === 'denied' ? styles.badgeBad : styles.badgeWait,
                  ]}
                >
                  {s === 'granted' ? 'ok' : s === 'denied' ? 'no' : '—'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Button onPress={() => void grantAll()}>Grant all</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={onContinue}>Continue</Button>
          </View>
        </View>

        <Text style={styles.footnote}>
          Tip: if you accidentally denied something, you can re-enable it in Android Settings → DropBeam → Permissions.
        </Text>
        <Pressable onPress={() => void Linking.openSettings()}>
          <Text style={styles.link}>Open settings</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, padding: 16 },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f1f1f',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  eyebrow: {
    color: '#7a7a7a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  copy: {
    color: '#b8b8b8',
    lineHeight: 20,
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderColor: '#1a1a1a',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  rowIcon: { fontSize: 24 },
  rowLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
  rowCopy: {
    color: '#8a8a8a',
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  badge: {
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: 'uppercase',
  },
  badgeOk: { backgroundColor: '#0e2a14', color: '#9ee0a8' },
  badgeBad: { backgroundColor: '#2a0e0e', color: '#ffb0b0' },
  badgeWait: { backgroundColor: '#1a1a1a', color: '#8a8a8a' },
  footnote: {
    color: '#7a7a7a',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  link: {
    color: '#3a8bff',
    textDecorationLine: 'underline',
  },
});

import { useState } from 'react';
import { StyleSheet, Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

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
    <ScrollView style={{ flex: 1, backgroundColor: tokens.color.bg }} contentContainerStyle={styles.scroll}>
      <GlassPanel style={styles.card}>
        <Text style={styles.eyebrow}>STEP 1 OF 2</Text>
        <Text style={styles.title}>DropBeam needs these to work</Text>
        <Text style={styles.copy}>
          You can deny any of them — the app still opens, but features that need them stay disabled.
        </Text>

        <View style={styles.rows}>
          {rows.map((row) => {
            const s = currentStatus(row.id);
            return (
              <View key={row.id} style={styles.row}>
                <Text style={styles.rowIcon}>{row.icon}</Text>
                <View style={styles.rowBody}>
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
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: tokens.spacing.md, padding: tokens.spacing.lg },
  card: {
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
  },
  eyebrow: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textDim,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.text,
    fontSize: tokens.fontSize.xl,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.tight,
  },
  copy: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textSoft,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.fontSize.body * tokens.lineHeight.normal,
  },
  rows: { marginTop: tokens.spacing.xs, gap: tokens.spacing.sm },
  row: {
    alignItems: 'center',
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: tokens.spacing.md,
    padding: tokens.spacing.md,
  },
  rowIcon: { fontSize: tokens.fontSize.xl },
  rowBody: { flex: 1 },
  rowLabel: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.text,
    fontSize: tokens.fontSize.base,
    fontWeight: tokens.fontWeight.semibold,
  },
  rowCopy: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textDim,
    fontSize: tokens.fontSize.caption,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    marginTop: tokens.spacing.sm,
  },
  badge: {
    fontFamily: tokens.fontFamily.sans,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    overflow: 'hidden',
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 3,
    textTransform: 'uppercase',
    letterSpacing: tokens.letterSpacing.wide,
  },
  badgeOk: { borderColor: tokens.color.panelBorder, color: tokens.color.green },
  badgeBad: { borderColor: tokens.color.panelBorder, color: tokens.color.danger },
  badgeWait: { borderColor: tokens.color.panelBorder, color: tokens.color.textDim },
  footnote: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textDim,
    fontSize: tokens.fontSize.caption,
    lineHeight: tokens.fontSize.caption * tokens.lineHeight.normal,
    marginTop: tokens.spacing.sm,
  },
  link: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.text,
    fontWeight: tokens.fontWeight.semibold,
    textDecorationLine: 'underline',
  },
});

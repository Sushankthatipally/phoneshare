import { StyleSheet, Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

import { ScrollView, Text, View } from '../lib/native.js';
import { QuickSaveToggle } from '../components/QuickSaveToggle.js';
import { useConnection } from '../lib/connection.js';
import { useMobileIdentity } from '../lib/identity.js';

function usePulse() {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(value, { toValue: 0, duration: 1400, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

export function ReceiveScreen() {
  const { deviceFingerprint, history } = useConnection();
  const identity = useMobileIdentity(deviceFingerprint);
  const pulse = usePulse();

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.identityBlock}>
        <View style={styles.pulseWrap}>
          <Animated.View
            style={[styles.pulseRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          />
          <View style={styles.deviceGlyph}>
            <Text style={styles.deviceGlyphText}>📡</Text>
          </View>
        </View>
        <Text style={styles.friendlyName}>{identity.friendlyName}</Text>
        <Text style={styles.hashtag}>{identity.hashtag}</Text>
      </View>

      <GlassPanel style={styles.quickSavePanel}>
        <View>
          <Text style={styles.quickSaveLabel}>Quick Save</Text>
          <Text style={styles.quickSaveCopy}>
            {identity.quickSave === 'on'
              ? 'Auto-accepts every incoming transfer.'
              : identity.quickSave === 'favorites'
              ? 'Auto-accepts only from hearted devices.'
              : 'Manual accept on every transfer.'}
          </Text>
        </View>
        <QuickSaveToggle value={identity.quickSave} onChange={identity.setQuickSave} />
      </GlassPanel>

      <GlassPanel style={styles.historyPanel}>
        <Text style={styles.historyLabel}>Recent transfers</Text>
        {history.length === 0 ? (
          <Text style={styles.historyEmpty}>Nothing yet. Incoming files will appear here.</Text>
        ) : (
          <View style={styles.historyList}>
            {history.slice(0, 8).map((entry) => (
              <View key={entry.id} style={styles.historyRow}>
                <Text style={styles.historyRowName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.historyRowMeta}>{entry.status}</Text>
              </View>
            ))}
          </View>
        )}
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: tokens.color.bg,
  },
  scrollContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.xl,
  },
  identityBlock: {
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingVertical: tokens.spacing.xl,
  },
  pulseWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: tokens.color.blue,
  },
  deviceGlyph: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.panelBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceGlyphText: {
    fontSize: 48,
  },
  friendlyName: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.title,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.text,
    letterSpacing: tokens.letterSpacing.tight,
  },
  hashtag: {
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.base,
    color: tokens.color.textDim,
    letterSpacing: tokens.letterSpacing.wide,
  },
  quickSavePanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  quickSaveLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  quickSaveCopy: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
    marginTop: tokens.spacing.xs,
  },
  historyPanel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  historyLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  historyEmpty: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textDim,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
  historyList: {
    gap: tokens.spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.panelBorder,
  },
  historyRowName: {
    flex: 1,
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.body,
    color: tokens.color.text,
  },
  historyRowMeta: {
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
    marginLeft: tokens.spacing.md,
  },
});

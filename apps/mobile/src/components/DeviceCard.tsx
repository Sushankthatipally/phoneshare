import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

import { Icon, type IconName } from './Icon.js';
import type { DiscoveredPeer } from '../lib/discovery.js';

// Map every platform string to one of the three lucide device glyphs the
// desktop uses (Monitor / Smartphone / Tablet).
const PLATFORM_ICONS: Record<string, IconName> = {
  ios: 'smartphone',
  android: 'smartphone',
  phone: 'smartphone',
  tablet: 'tablet',
  darwin: 'monitor',
  win32: 'monitor',
  windows: 'monitor',
  linux: 'monitor',
  desktop: 'monitor',
  laptop: 'monitor',
};

interface DeviceCardProps {
  peer: DiscoveredPeer;
  isFavorite: boolean;
  transport?: string | null;
  onPress: () => void;
  onToggleFavorite: () => void;
}

export function DeviceCard({ peer, isFavorite, transport, onPress, onToggleFavorite }: DeviceCardProps) {
  const platform = (peer.txt?.p ?? peer.icon ?? '').toLowerCase();
  const iconName = PLATFORM_ICONS[platform] ?? 'monitor';
  const friendlyName = peer.txt?.n ?? peer.name;
  const hashtag = peer.txt?.tag ?? '';
  const platformLabel = peer.txt?.p ?? null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <GlassPanel style={styles.row}>
        <View style={styles.iconWrap}>
          <Icon name={iconName} size={24} color={tokens.color.text} />
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{friendlyName}</Text>
          <View style={styles.pillRow}>
            {hashtag ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{hashtag}</Text>
              </View>
            ) : null}
            {platformLabel ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{platformLabel}</Text>
              </View>
            ) : null}
            {transport && transport !== 'wifi' ? (
              <View style={[styles.pill, styles.pillAccent]}>
                <Text style={[styles.pillText, styles.pillTextAccent]}>{transport.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable onPress={onToggleFavorite} hitSlop={12} style={styles.heart}>
          <Icon
            name="heart"
            size={20}
            color={isFavorite ? tokens.color.danger : tokens.color.textSoft}
            fill={isFavorite ? tokens.color.danger : 'none'}
          />
        </Pressable>
      </GlassPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: tokens.spacing.xs,
  },
  name: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.xs,
  },
  pill: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 2,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.surface,
  },
  pillAccent: {
    borderColor: tokens.color.green,
    backgroundColor: tokens.color.surfaceSoft,
  },
  pillText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.wide,
  },
  pillTextAccent: {
    color: tokens.color.green,
  },
  heart: {
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.sm,
  },
});

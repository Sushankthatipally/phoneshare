import type { TransferItem, TransferStatus } from '@dropbeam/protocol';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../tokens.js';

export interface TransferRowProps {
  item: TransferItem;
  style?: StyleProp<ViewStyle>;
}

export function TransferRow({ item, style }: TransferRowProps) {
  const progress = Math.max(0, Math.min(100, item.progress));
  const statusColor = statusColorFor(item.status);

  return (
    <View style={[styles.row, style]}>
      <View style={styles.header}>
        <View style={styles.details}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{item.sizeLabel}</Text>
            <Text style={[styles.metaText, styles.metaDot]}>{'•'}</Text>
            <Text style={styles.metaText}>{item.kind}</Text>
          </View>
        </View>
        <View style={styles.statusPill}>
          <Text style={[styles.statusLabel, { color: statusColor }]} numberOfLines={1}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${progress}%`, backgroundColor: tokens.color.text },
          ]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{progress}%</Text>
        <Text style={[styles.footerText, styles.footerCenter]}>{item.speedLabel ?? '--'}</Text>
        <Text style={[styles.footerText, styles.footerRight]}>{item.etaLabel ?? 'ready'}</Text>
      </View>
    </View>
  );
}

function statusColorFor(status: TransferStatus): string {
  switch (status) {
    case 'queued':
      return tokens.color.amber;
    case 'encrypting':
    case 'verifying':
      return tokens.color.blue;
    case 'transferring':
    case 'complete':
      return tokens.color.green;
    case 'failed':
      return tokens.color.amber;
    default:
      return tokens.color.text;
  }
}

const styles = StyleSheet.create({
  row: {
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.surface,
    gap: tokens.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacing.md,
  },
  details: {
    flex: 1,
    gap: tokens.spacing.xs,
    minWidth: 0,
  },
  name: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.md,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
    lineHeight: tokens.fontSize.md * tokens.lineHeight.snug,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.sm,
    flexWrap: 'wrap',
  },
  metaText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
  },
  metaDot: {
    color: tokens.color.textDim,
  },
  statusPill: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs + 2,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.surfaceSoft,
  },
  statusLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.wider,
  },
  track: {
    height: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.track,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: tokens.radius.pill,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  footerText: {
    flex: 1,
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
  },
  footerCenter: {
    textAlign: 'center',
  },
  footerRight: {
    textAlign: 'right',
  },
});

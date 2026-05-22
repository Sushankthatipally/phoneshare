import { View, Text, StyleSheet } from 'react-native';

import { tokens } from '../lib/tokens.js';

export type TransferRowStatus =
  | 'queued'
  | 'encrypting'
  | 'transferring'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface TransferRowProps {
  name: string;
  sizeLabel: string;
  status: TransferRowStatus;
  progress: number; // 0..100
  speedLabel?: string;
  etaLabel?: string;
  errorMessage?: string;
}

const statusColor: Record<TransferRowStatus, string> = {
  queued: tokens.color.amber,
  encrypting: tokens.color.blue,
  verifying: tokens.color.blue,
  transferring: tokens.color.green,
  complete: tokens.color.green,
  failed: tokens.color.danger,
};

export function TransferRow({ name, sizeLabel, status, progress, speedLabel, etaLabel, errorMessage }: TransferRowProps) {
  const pct = Math.max(0, Math.min(100, progress));
  const color = statusColor[status];

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.details}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.meta}>{sizeLabel}</Text>
        </View>
        <View style={[styles.status, { borderColor: color }]}>
          <Text style={[styles.statusText, { color }]}>{status.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaCell}>{pct.toFixed(0)}%</Text>
        <Text style={[styles.metaCell, styles.metaCenter]}>{speedLabel ?? '—'}</Text>
        <Text style={[styles.metaCell, styles.metaRight]}>{etaLabel ?? '—'}</Text>
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: tokens.color.inputBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    gap: tokens.spacing.sm,
    padding: tokens.spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    justifyContent: 'space-between',
  },
  details: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
  },
  meta: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.caption,
  },
  status: {
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 4,
  },
  statusText: {
    fontFamily: tokens.font.sans,
    fontSize: 10,
    fontWeight: tokens.fontWeight.bold,
    letterSpacing: 1,
  },
  track: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: tokens.radius.pill,
    height: 6,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: tokens.radius.pill,
    height: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaCell: {
    color: tokens.color.textSoft,
    flex: 1,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.caption,
  },
  metaCenter: {
    textAlign: 'center',
  },
  metaRight: {
    textAlign: 'right',
  },
  error: {
    color: tokens.color.danger,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.caption,
  },
});

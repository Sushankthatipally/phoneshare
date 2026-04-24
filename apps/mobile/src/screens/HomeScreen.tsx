import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function HomeScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ display: 'grid', gap: 14 }}>
      <ScreenCard
        eyebrow="Native first"
        title="Transfer without a browser fallback"
        copy="Scan a desktop QR, discover hosts on the LAN, or switch to hotspot and USB scaffolds when the network gets messy."
      >
        <View style={styles.badgeRow}>
          <LiveBadge tone={backend.loading ? 'amber' : 'blue'}>{backend.loading ? 'booting' : 'native ready'}</LiveBadge>
          <LiveBadge tone="green">{backend.connectionLabel}</LiveBadge>
          <LiveBadge tone="slate">{backend.chunkSizeLabel}</LiveBadge>
        </View>

        <View style={styles.summaryGrid}>
          <Summary label="Nearby hosts" value={String(backend.beacons.length)} />
          <Summary label="Active jobs" value={String(backend.transfers.length)} />
          <Summary label="History" value={String(backend.history.length)} />
        </View>
      </ScreenCard>

      <ScreenCard eyebrow="Connection lanes" title="Choose the lane" copy="The scaffold keeps QR, LAN, hotspot, and USB paths visible so the native plan stays concrete.">
        <View style={styles.actionGrid}>
          <Button onPress={() => backend.selectConnectionMode('qr')}>QR</Button>
          <Button onPress={() => backend.selectConnectionMode('lan')}>LAN</Button>
          <Button onPress={() => backend.selectConnectionMode('hotspot')}>Hotspot</Button>
          <Button onPress={() => backend.selectConnectionMode('usb')}>USB</Button>
        </View>
        <Text style={styles.copy}>{backend.discoveryLabel}</Text>
      </ScreenCard>
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = {
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  summaryGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  },
  summaryCard: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    display: 'grid',
    gap: 6,
    padding: 12,
  },
  summaryLabel: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  summaryValue: {
    color: '#eef6ff',
    fontSize: 16,
    fontWeight: 700,
  },
  actionGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 1.5,
  },
};

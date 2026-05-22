import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function HomeScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ gap: 14 }}>
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

      <ScreenCard
        eyebrow="Connection lanes"
        title="Choose the lane"
        copy="The scaffold keeps QR, LAN, hotspot, and USB paths visible so the native plan stays concrete."
      >
        <View style={styles.actionGrid}>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('qr')}>QR</Button>
          </View>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('lan')}>LAN</Button>
          </View>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('hotspot')}>Hotspot</Button>
          </View>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('usb')}>USB</Button>
          </View>
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
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  summaryGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 100,
    gap: 6,
    padding: 12,
  },
  summaryLabel: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  summaryValue: {
    color: '#eef6ff',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  actionGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 20,
  },
};

import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function ScanScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ display: 'grid', gap: 14 }}>
      <ScreenCard
        eyebrow="Discovery"
        title="Scan the desktop session QR"
        copy="The session ticket carries the host, port, device identity, and transport mode."
      >
        <View style={styles.ticketBox}>
          <Text style={styles.ticketLabel}>Session ticket</Text>
          <Text style={styles.ticketValue}>{backend.sessionLabel}</Text>
          <Text style={styles.ticketBody}>{backend.sessionTicket}</Text>
        </View>

        <View style={styles.actionGrid}>
          <Button onPress={() => void backend.refresh()}>Refresh scan data</Button>
          <Button onPress={() => backend.selectConnectionMode('lan')}>Switch to LAN</Button>
        </View>
      </ScreenCard>

      <ScreenCard eyebrow="Nearby desktops" title="Beacon list" copy="mDNS keeps nearby desktops visible without forcing a browser workflow.">
        <View style={styles.deviceList}>
          {backend.beacons.map((beacon) => (
            <View key={beacon.id} style={styles.deviceCard}>
              <Text style={styles.deviceName}>{beacon.name}</Text>
              <Text style={styles.deviceMeta}>
                {beacon.host}:{beacon.port} · {beacon.mode} · {beacon.signal} signal
              </Text>
              <Text style={styles.deviceMeta}>Last seen {beacon.lastSeenLabel}</Text>
            </View>
          ))}
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  ticketBox: {
    backgroundColor: '#09111c',
    border: '1px solid #1b2a3d',
    borderRadius: 18,
    display: 'grid',
    gap: 8,
    padding: 14,
  },
  ticketLabel: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  ticketValue: {
    color: '#f2f7ff',
    fontSize: 18,
    fontWeight: 800,
  },
  ticketBody: {
    color: '#a9bfd3',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.5,
    overflowWrap: 'anywhere' as const,
  },
  actionGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  deviceList: {
    display: 'grid',
    gap: 10,
  },
  deviceCard: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    display: 'grid',
    gap: 6,
    padding: 12,
  },
  deviceName: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: 700,
  },
  deviceMeta: {
    color: '#99b4c9',
    lineHeight: 1.4,
  },
};

import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function ScanScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ gap: 14 }}>
      <ScreenCard
        eyebrow="Discovery"
        title="Scan the desktop session QR"
        copy="The session ticket carries the host, port, device identity, and transport mode."
      >
        <View style={styles.ticketBox}>
          <Text style={styles.ticketLabel}>Session</Text>
          <Text style={styles.ticketValue}>{backend.sessionLabel}</Text>
          <Text style={styles.ticketBody}>
            {backend.sessionTicket ?? 'No session — scan a QR to begin.'}
          </Text>
        </View>

        <View style={styles.actionGrid}>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.refresh()}>Refresh discovery</Button>
          </View>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('lan')}>Switch to LAN</Button>
          </View>
        </View>
      </ScreenCard>

      <ScreenCard
        eyebrow="Nearby desktops"
        title="mDNS browse"
        copy="Real devices advertising _dropbeam._tcp appear here. No fabricated entries."
      >
        <View style={styles.deviceList}>
          {backend.beacons.length === 0 ? (
            <Text style={styles.deviceMeta}>No nearby devices.</Text>
          ) : (
            backend.beacons.map((beacon) => (
              <View key={beacon.id} style={styles.deviceCard}>
                <Text style={styles.deviceName}>{beacon.name}</Text>
                <Text style={styles.deviceMeta}>
                  {beacon.host}:{beacon.port}
                </Text>
                {beacon.fingerprint ? (
                  <Text style={styles.deviceMeta}>fingerprint {beacon.fingerprint.slice(0, 8)}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  ticketBox: {
    backgroundColor: '#09111c',
    borderColor: '#1b2a3d',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  ticketLabel: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  ticketValue: {
    color: '#f2f7ff',
    fontSize: 18,
    fontWeight: '800' as const,
  },
  ticketBody: {
    color: '#a9bfd3',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  actionGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  deviceList: {
    gap: 10,
  },
  deviceCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  deviceName: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  deviceMeta: {
    color: '#99b4c9',
    lineHeight: 18,
  },
};

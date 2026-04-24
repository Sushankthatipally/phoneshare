import { useState } from 'react';

import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import { useMobileBackend } from '../hooks/useMobileBackend.js';
import { HistoryScreen } from './HistoryScreen.js';
import { HomeScreen } from './HomeScreen.js';
import { ReceiveScreen } from './ReceiveScreen.js';
import { ScanScreen } from './ScanScreen.js';
import { SendScreen } from './SendScreen.js';

type Screen = 'home' | 'scan' | 'receive' | 'send' | 'history';

export function MobileApp({ initialScreen = 'home' }: { initialScreen?: Screen }) {
  const backend = useMobileBackend();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  return (
    <View style={{ display: 'grid', gap: 16 }}>
      <ScreenCard
        eyebrow="DropBeam mobile"
        title="Native transfer lane"
        copy="QR discovery, LAN visibility, hotspot scaffolding, and chunked transport all stay inside the native plan."
      >
        <View style={styles.badgeRow}>
          <LiveBadge tone={backend.loading ? 'amber' : 'blue'}>{backend.loading ? 'booting' : 'native ready'}</LiveBadge>
          <LiveBadge tone="green">{backend.connectionLabel}</LiveBadge>
          <LiveBadge tone="slate">{backend.chunkSizeLabel}</LiveBadge>
        </View>

        <View style={styles.summaryGrid}>
          <Summary label="Hosts" value={String(backend.beacons.length)} />
          <Summary label="Jobs" value={String(backend.transfers.length)} />
          <Summary label="History" value={String(backend.history.length)} />
        </View>

        <View style={styles.tabRow}>
          {[
            ['home', 'Home'],
            ['scan', 'Scan'],
            ['receive', 'Receive'],
            ['send', 'Send'],
            ['history', 'History'],
          ].map(([key, label]) => (
            <Button key={key} onPress={() => setScreen(key as Screen)} style={{ flex: 1 }}>
              {label}
            </Button>
          ))}
        </View>
      </ScreenCard>

      {screen === 'home' ? <HomeScreen backend={backend} /> : null}
      {screen === 'scan' ? <ScanScreen backend={backend} /> : null}
      {screen === 'receive' ? <ReceiveScreen backend={backend} /> : null}
      {screen === 'send' ? <SendScreen backend={backend} /> : null}
      {screen === 'history' ? <HistoryScreen backend={backend} /> : null}
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
  tabRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
    marginTop: 16,
  },
};
